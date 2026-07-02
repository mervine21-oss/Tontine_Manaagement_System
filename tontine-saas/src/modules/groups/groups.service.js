// =============================================================================
// FILE: src/modules/groups/groups.service.js
// PURPOSE: Core business logic for tontine group management.
// Handles group creation, joining via invite code, and member management.
// =============================================================================

const { query, getClient } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

// =============================================================================
// HELPER — Generate unique invite code
// Creates a random 8-character alphanumeric code for group invitations
// =============================================================================

const generateInviteCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
};

// =============================================================================
// CREATE GROUP
// =============================================================================

/**
 * createGroup — creates a new tontine group and makes the creator the Admin.
 *
 * Business Rules:
 * - Creator automatically becomes group Admin
 * - Creator is added as first member with 'active' status (not 'new_member')
 * - Two wallets are auto-provisioned by database trigger
 * - Invite code is unique and randomly generated
 * - Late fee config is auto-created with default values
 *
 * @param {string} adminUserId - UUID of the user creating the group
 * @param {Object} groupData - { group_name, max_members, contribution_amount,
 *                               contribution_frequency, description }
 * @returns {Object} - { group, membership }
 */
const createGroup = async (adminUserId, groupData) => {
    const {
        group_name,
        max_members,
        contribution_amount,
        contribution_frequency,
        description,
    } = groupData;

    // Use a database transaction — if ANY step fails, ALL steps are rolled back
    // This guarantees we never have a group without an admin member
    const client = await getClient();

    try {
        await client.query('BEGIN');

        // Step 1: Generate a unique invite code
        let invite_code;
        let codeExists = true;

        // Keep generating until we find a unique code
        while (codeExists) {
            invite_code = generateInviteCode();
            const check = await client.query(
                'SELECT id FROM tontine_groups WHERE invite_code = $1',
                [invite_code]
            );
            codeExists = check.rows.length > 0;
        }

        // Step 2: Create the tontine group
        const groupResult = await client.query(
            `INSERT INTO tontine_groups (
                admin_user_id, group_name, description, max_members,
                contribution_amount, contribution_frequency, invite_code
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *`,
            [
                adminUserId,
                group_name,
                description || null,
                max_members,
                contribution_amount,
                contribution_frequency,
                invite_code,
            ]
        );

        const newGroup = groupResult.rows[0];

        // Step 3: Add creator as first member with Admin privileges
        // Admin gets 'active' status immediately — not 'new_member'
        const memberResult = await client.query(
            `INSERT INTO group_members (group_id, user_id, is_admin, member_status)
             VALUES ($1, $2, true, 'active')
             RETURNING *`,
            [newGroup.id, adminUserId]
        );

        const membership = memberResult.rows[0];

        // Step 4: Create default late fee configuration for this group
        await client.query(
            `INSERT INTO late_fee_configs (group_id, grace_period_hours, fee_type, fee_amount)
             VALUES ($1, 48, 'flat', 500.00)`,
            [newGroup.id]
        );

        // Step 5: Log group creation in audit trail
        await client.query(
            `INSERT INTO audit_logs (
                actor_user_id, group_id, action, entity_type, entity_id, new_values
            )
            VALUES ($1, $2, 'group_created', 'tontine_groups', $3, $4)`,
            [
                adminUserId,
                newGroup.id,
                newGroup.id,
                JSON.stringify({
                    group_name,
                    max_members,
                    contribution_amount,
                    contribution_frequency,
                })
            ]
        );

        await client.query('COMMIT');

        return { group: newGroup, membership };

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release(); // Always release client back to pool
    }
};

// =============================================================================
// GET ALL GROUPS FOR A USER
// =============================================================================

/**
 * getUserGroups — returns all groups a user belongs to.
 *
 * @param {string} userId - UUID of the requesting user
 * @returns {Array} - List of groups with membership details
 */
const getUserGroups = async (userId) => {
    const result = await query(
        `SELECT
            g.id,
            g.group_name,
            g.description,
            g.max_members,
            g.current_member_count,
            g.contribution_amount,
            g.contribution_frequency,
            g.collateral_rate,
            g.invite_code,
            g.is_config_locked,
            g.created_at,
            gm.is_admin,
            gm.member_status,
            gm.joined_at,
            -- Count available seats
            (g.max_members - g.current_member_count) AS available_seats
         FROM tontine_groups g
         INNER JOIN group_members gm ON g.id = gm.group_id
         WHERE gm.user_id = $1 AND gm.member_status != 'exited'
         ORDER BY gm.joined_at DESC`,
        [userId]
    );

    return result.rows;
};

// =============================================================================
// GET SINGLE GROUP
// =============================================================================

/**
 * getGroupById — returns details of a specific group.
 * Only accessible to members of that group.
 *
 * @param {string} groupId - UUID of the group
 * @param {string} userId - UUID of the requesting user
 * @returns {Object} - Group details
 */
const getGroupById = async (groupId, userId) => {
    // Verify user is a member of this group
    const memberCheck = await query(
        `SELECT id FROM group_members
         WHERE group_id = $1 AND user_id = $2 AND member_status != 'exited'`,
        [groupId, userId]
    );

    if (memberCheck.rows.length === 0) {
        const error = new Error('Group not found or you are not a member.');
        error.statusCode = 404;
        throw error;
    }

    const result = await query(
        `SELECT
            g.*,
            (g.max_members - g.current_member_count) AS available_seats,
            u.full_name AS admin_name,
            u.phone_msisdn AS admin_phone
         FROM tontine_groups g
         INNER JOIN users u ON g.admin_user_id = u.id
         WHERE g.id = $1`,
        [groupId]
    );

    return result.rows[0];
};

// =============================================================================
// JOIN GROUP VIA INVITE CODE
// =============================================================================

/**
 * joinGroup — allows a user to join a group using an invite code.
 *
 * Business Rules:
 * - Invite code must be valid and not expired
 * - Group must not be at full capacity
 * - User cannot join the same group twice
 * - New members get 'new_member' status (blocks slot 1 assignment)
 * - Two wallets auto-provisioned by database trigger
 *
 * @param {string} userId - UUID of the user joining
 * @param {string} invite_code - The group's invite code
 * @returns {Object} - { group, membership }
 */
const joinGroup = async (userId, invite_code) => {
    const client = await getClient();

    try {
        await client.query('BEGIN');

        // Step 1: Find group by invite code
        const groupResult = await client.query(
            `SELECT * FROM tontine_groups
             WHERE invite_code = $1
             AND (invite_expires_at IS NULL OR invite_expires_at > NOW())`,
            [invite_code.toUpperCase()]
        );

        if (groupResult.rows.length === 0) {
            const error = new Error('Invalid or expired invite code.');
            error.statusCode = 404;
            throw error;
        }

        const group = groupResult.rows[0];

        // Step 2: Check if group is full
        if (group.current_member_count >= group.max_members) {
            const error = new Error('This group has reached its maximum capacity.');
            error.statusCode = 400;
            throw error;
        }

        // Step 3: Check if user is already a member
        const existingMember = await client.query(
            `SELECT id, member_status FROM group_members
             WHERE group_id = $1 AND user_id = $2`,
            [group.id, userId]
        );

        if (existingMember.rows.length > 0) {
            const error = new Error('You are already a member of this group.');
            error.statusCode = 409;
            throw error;
        }

        // Step 4: Add user as new member
        // RISK RULE: new members get 'new_member' status
        // This blocks them from being assigned payout slot #1
        const memberResult = await client.query(
            `INSERT INTO group_members (group_id, user_id, is_admin, member_status)
             VALUES ($1, $2, false, 'new_member')
             RETURNING *`,
            [group.id, userId]
        );

        const membership = memberResult.rows[0];

        // Step 5: Log join event in audit trail
        await client.query(
            `INSERT INTO audit_logs (
                actor_user_id, group_id, action, entity_type, entity_id, new_values
            )
            VALUES ($1, $2, 'member_joined', 'group_members', $3, $4)`,
            [
                userId,
                group.id,
                membership.id,
                JSON.stringify({ invite_code, member_status: 'new_member' })
            ]
        );

        await client.query('COMMIT');

        return { group, membership };

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// =============================================================================
// GET GROUP MEMBERS
// =============================================================================

/**
 * getGroupMembers — returns all members of a group with their wallet balances.
 *
 * @param {string} groupId - UUID of the group
 * @param {string} userId - UUID of the requesting user (must be a member)
 * @returns {Array} - List of members with wallet info
 */
const getGroupMembers = async (groupId, userId) => {
    // Verify requesting user is a member
    const memberCheck = await query(
        `SELECT id FROM group_members
         WHERE group_id = $1 AND user_id = $2 AND member_status != 'exited'`,
        [groupId, userId]
    );

    if (memberCheck.rows.length === 0) {
        const error = new Error('You are not a member of this group.');
        error.statusCode = 403;
        throw error;
    }

    const result = await query(
        `SELECT
            gm.id AS member_id,
            gm.is_admin,
            gm.member_status,
            gm.collateral_balance,
            gm.joined_at,
            u.id AS user_id,
            u.full_name,
            u.phone_msisdn,
            u.telecom_operator,
            -- Rotational wallet balance
            rw.balance AS rotational_balance,
            -- Savings wallet balance
            sw.balance AS savings_balance
         FROM group_members gm
         INNER JOIN users u ON gm.user_id = u.id
         LEFT JOIN wallets rw ON rw.group_member_id = gm.id
            AND rw.wallet_type = 'rotational'
         LEFT JOIN wallets sw ON sw.group_member_id = gm.id
            AND sw.wallet_type = 'savings'
         WHERE gm.group_id = $1 AND gm.member_status != 'exited'
         ORDER BY gm.joined_at ASC`,
        [groupId]
    );

    return result.rows;
};

module.exports = {
    createGroup,
    getUserGroups,
    getGroupById,
    joinGroup,
    getGroupMembers,
};