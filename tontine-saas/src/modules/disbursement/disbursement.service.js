// =============================================================================
// FILE: src/modules/disbursement/disbursement.service.js
// PURPOSE: Core disbursement engine — manages contribution cycles,
// payout slot assignment, collateral withholding, and pot disbursement.
// This is the most critical financial module in the entire system.
// =============================================================================

const { query, getClient } = require('../../config/database');

// =============================================================================
// START CYCLE
// =============================================================================

/**
 * startCycle — initiates a new contribution cycle for a group.
 *
 * Business Rules:
 * - Only the group Admin can start a cycle
 * - Only one active cycle allowed per group at a time
 * - Group config is locked once cycle starts
 * - Payout slots are created for each member
 * - Savings wallets are locked for all members
 *
 * @param {string} adminUserId - UUID of the admin starting the cycle
 * @param {string} groupId - UUID of the group
 * @returns {Object} - { cycle, slots }
 */
const startCycle = async (adminUserId, groupId) => {
    const client = await getClient();

    try {
        await client.query('BEGIN');

        // Step 1: Verify admin privileges
        const adminCheck = await client.query(
            `SELECT id FROM group_members
             WHERE group_id = $1 AND user_id = $2 AND is_admin = true`,
            [groupId, adminUserId]
        );

        if (adminCheck.rows.length === 0) {
            const error = new Error('Only the group admin can start a cycle.');
            error.statusCode = 403;
            throw error;
        }

        // Step 2: Check no active cycle exists
        const activeCycle = await client.query(
            `SELECT id FROM contribution_cycles
             WHERE group_id = $1 AND status = 'active'`,
            [groupId]
        );

        if (activeCycle.rows.length > 0) {
            const error = new Error('A cycle is already active for this group.');
            error.statusCode = 400;
            throw error;
        }

        // Step 3: Get group configuration
        const groupResult = await client.query(
            `SELECT * FROM tontine_groups WHERE id = $1`,
            [groupId]
        );

        const group = groupResult.rows[0];

        // Step 4: Get all active members
        const membersResult = await client.query(
            `SELECT id, user_id, member_status
             FROM group_members
             WHERE group_id = $1 AND member_status != 'exited'
             ORDER BY joined_at ASC`,
            [groupId]
        );

        const members = membersResult.rows;

        if (members.length < 2) {
            const error = new Error('At least 2 members are required to start a cycle.');
            error.statusCode = 400;
            throw error;
        }

        // Step 5: Get next cycle number
        const cycleCountResult = await client.query(
            `SELECT COUNT(*) FROM contribution_cycles WHERE group_id = $1`,
            [groupId]
        );

        const cycleNumber = parseInt(cycleCountResult.rows[0].count) + 1;

        // Step 6: Calculate total pot value
        const totalPotValue = parseFloat(group.contribution_amount) * members.length;

        // Step 7: Create the cycle with snapshotted config
        // Snapshots freeze the financial config at cycle start for immutable records
        const cycleResult = await client.query(
            `INSERT INTO contribution_cycles (
                group_id, cycle_number, status,
                snapshot_contribution_amt, snapshot_collateral_rate,
                snapshot_member_count, total_pot_value, started_at
            )
            VALUES ($1, $2, 'active', $3, $4, $5, $6, NOW())
            RETURNING *`,
            [
                groupId,
                cycleNumber,
                group.contribution_amount,
                group.collateral_rate,
                members.length,
                totalPotValue,
            ]
        );

        const cycle = cycleResult.rows[0];

        // Step 8: Lock group configuration
        await client.query(
            `UPDATE tontine_groups SET is_config_locked = true WHERE id = $1`,
            [groupId]
        );

        // Step 9: Create payout slots for each member
        // RISK RULE: slot 1 cannot be assigned to a 'new_member'
        // We create empty slots here — assignment happens separately
        const slots = [];
        for (let i = 1; i <= members.length; i++) {
            const slotResult = await client.query(
                `INSERT INTO payout_slots (cycle_id, slot_number, status)
                 VALUES ($1, $2, 'unassigned')
                 RETURNING *`,
                [cycle.id, i]
            );
            slots.push(slotResult.rows[0]);
        }

        // Step 10: Lock savings wallets for all members
        await client.query(
            `UPDATE wallets w
             SET is_locked = true
             FROM group_members gm
             WHERE w.group_member_id = gm.id
               AND gm.group_id = $1
               AND w.wallet_type = 'savings'`,
            [groupId]
        );

        // Step 11: Audit log
        await client.query(
            `INSERT INTO audit_logs (
                actor_user_id, group_id, action, entity_type, entity_id, new_values
            )
            VALUES ($1, $2, 'cycle_started', 'contribution_cycles', $3, $4)`,
            [
                adminUserId,
                groupId,
                cycle.id,
                JSON.stringify({ cycle_number: cycleNumber, total_pot: totalPotValue })
            ]
        );

        await client.query('COMMIT');

        return { cycle, slots };

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// =============================================================================
// ASSIGN PAYOUT SLOTS
// =============================================================================

/**
 * assignPayoutSlots — assigns members to payout slots randomly.
 *
 * RISK RULE ENFORCEMENT:
 * - Members with 'new_member' status CANNOT be assigned to slot 1
 * - If all members are new_members the admin is assigned slot 1
 *
 * @param {string} adminUserId - UUID of the admin
 * @param {string} cycleId - UUID of the active cycle
 * @param {string} groupId - UUID of the group
 * @returns {Object} - { slots }
 */
const assignPayoutSlots = async (adminUserId, cycleId, groupId) => {
    const client = await getClient();

    try {
        await client.query('BEGIN');

        // Step 1: Verify admin
        const adminCheck = await client.query(
            `SELECT id FROM group_members
             WHERE group_id = $1 AND user_id = $2 AND is_admin = true`,
            [groupId, adminUserId]
        );

        if (adminCheck.rows.length === 0) {
            const error = new Error('Only the group admin can assign payout slots.');
            error.statusCode = 403;
            throw error;
        }

        // Step 2: Get all eligible members
        const membersResult = await client.query(
            `SELECT id, user_id, member_status
             FROM group_members
             WHERE group_id = $1 AND member_status != 'exited'
             ORDER BY joined_at ASC`,
            [groupId]
        );

        const members = membersResult.rows;

        // Step 3: Shuffle members randomly for fair slot assignment
        const shuffled = [...members].sort(() => Math.random() - 0.5);

        // Step 4: RISK RULE — ensure slot 1 is not assigned to a new_member
        // Find the first non-new_member to place in slot 1
        const slot1Index = shuffled.findIndex(m => m.member_status !== 'new_member');

        if (slot1Index > 0) {
            // Swap the first eligible member to position 0 (slot 1)
            [shuffled[0], shuffled[slot1Index]] = [shuffled[slot1Index], shuffled[0]];
        } else if (slot1Index === -1) {
            // All members are new_members — admin takes slot 1 by default
            const adminMember = shuffled.find(m =>
                members.find(mem => mem.user_id === adminUserId && mem.id === m.id)
            );
            if (adminMember) {
                const adminIdx = shuffled.indexOf(adminMember);
                [shuffled[0], shuffled[adminIdx]] = [shuffled[adminIdx], shuffled[0]];
            }
        }

        // Step 5: Assign each member to their slot
        const assignedSlots = [];
        for (let i = 0; i < shuffled.length; i++) {
            const member = shuffled[i];
            const slotNumber = i + 1;

            const slotResult = await client.query(
                `UPDATE payout_slots
                 SET group_member_id = $1, status = 'assigned'
                 WHERE cycle_id = $2 AND slot_number = $3
                 RETURNING *`,
                [member.id, cycleId, slotNumber]
            );

            assignedSlots.push(slotResult.rows[0]);

            // Audit log each assignment
            await client.query(
                `INSERT INTO audit_logs (
                    actor_user_id, group_id, action, entity_type, entity_id, new_values
                )
                VALUES ($1, $2, 'slot_assigned', 'payout_slots', $3, $4)`,
                [
                    adminUserId,
                    groupId,
                    slotResult.rows[0].id,
                    JSON.stringify({
                        slot_number: slotNumber,
                        member_id: member.id,
                        member_status: member.member_status
                    })
                ]
            );
        }

        await client.query('COMMIT');

        return { slots: assignedSlots };

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// =============================================================================
// DISBURSE PAYOUT
// =============================================================================

/**
 * disbursePayout — pays out the pot to the winner of a specific slot.
 *
 * Business Rules:
 * - COLLATERAL WITHHOLDING: 15% of gross pot is withheld as security buffer
 * - Net payout = gross pot - collateral withheld
 * - Collateral balance updated on winner's membership record
 * - Transaction recorded immutably with forensic fields
 * - Cycle ends automatically after last slot is paid
 *
 * @param {string} adminUserId - UUID of the admin triggering disbursement
 * @param {string} cycleId - UUID of the active cycle
 * @param {string} slotId - UUID of the payout slot to disburse
 * @param {string} groupId - UUID of the group
 * @returns {Object} - { transaction, slot }
 */
const disbursePayout = async (adminUserId, cycleId, slotId, groupId) => {
    const client = await getClient();

    try {
        await client.query('BEGIN');

        // Step 1: Verify admin
        const adminCheck = await client.query(
            `SELECT id FROM group_members
             WHERE group_id = $1 AND user_id = $2 AND is_admin = true`,
            [groupId, adminUserId]
        );

        if (adminCheck.rows.length === 0) {
            const error = new Error('Only the group admin can trigger disbursements.');
            error.statusCode = 403;
            throw error;
        }

        // Step 2: Get slot details with cycle and group info
        const slotResult = await client.query(
            `SELECT
                ps.*,
                cc.total_pot_value,
                cc.snapshot_collateral_rate,
                cc.group_id,
                gm.user_id AS winner_user_id,
                u.phone_msisdn AS winner_msisdn,
                u.telecom_operator AS winner_operator
             FROM payout_slots ps
             INNER JOIN contribution_cycles cc ON ps.cycle_id = cc.id
             INNER JOIN group_members gm ON ps.group_member_id = gm.id
             INNER JOIN users u ON gm.user_id = u.id
             WHERE ps.id = $1 AND ps.cycle_id = $2`,
            [slotId, cycleId]
        );

        if (slotResult.rows.length === 0) {
            const error = new Error('Payout slot not found.');
            error.statusCode = 404;
            throw error;
        }

        const slot = slotResult.rows[0];

        // Step 3: Verify slot is assigned and not already paid
        if (slot.status !== 'assigned') {
            const error = new Error(`Slot cannot be disbursed. Current status: ${slot.status}`);
            error.statusCode = 400;
            throw error;
        }

        // Step 4: Calculate disbursement amounts
        // COLLATERAL WITHHOLDING ALGORITHM (15% security buffer)
        const grossPayout = parseFloat(slot.total_pot_value);
        const collateralRate = parseFloat(slot.snapshot_collateral_rate);
        const collateralWithheld = parseFloat((grossPayout * collateralRate).toFixed(2));
        const netPayout = parseFloat((grossPayout - collateralWithheld).toFixed(2));

        // Step 5: Update payout slot with financial details
        const updatedSlot = await client.query(
            `UPDATE payout_slots
             SET
                status = 'paid_out',
                gross_payout_amount = $1,
                collateral_withheld = $2,
                net_payout_amount = $3,
                actual_payout_at = NOW()
             WHERE id = $4
             RETURNING *`,
            [grossPayout, collateralWithheld, netPayout, slotId]
        );

        // Step 6: Update winner's collateral balance
        // This withheld amount auto-covers future defaults by this member
        await client.query(
            `UPDATE group_members
             SET collateral_balance = collateral_balance + $1
             WHERE id = $2`,
            [collateralWithheld, slot.group_member_id]
        );

        // Step 7: Update cycle collateral pool total
        await client.query(
            `UPDATE contribution_cycles
             SET collateral_pool_total = collateral_pool_total + $1
             WHERE id = $2`,
            [collateralWithheld, cycleId]
        );

        // Step 8: Record disbursement transaction in immutable ledger
        const txnResult = await client.query(
            `INSERT INTO transactions (
                group_id, cycle_id, payout_slot_id,
                initiated_by_user_id, txn_type, status, amount,
                msisdn, operator, description
            )
            VALUES ($1, $2, $3, $4, 'payout_disbursement', 'success', $5, $6, $7, $8)
            RETURNING *`,
            [
                groupId,
                cycleId,
                slotId,
                adminUserId,
                netPayout,
                slot.winner_msisdn,
                slot.winner_operator,
                `Payout disbursement: gross ${grossPayout} XAF - collateral ${collateralWithheld} XAF = net ${netPayout} XAF`,
            ]
        );

        // Step 9: Record collateral capture transaction
        await client.query(
            `INSERT INTO transactions (
                group_id, cycle_id, payout_slot_id,
                initiated_by_user_id, txn_type, status, amount, description
            )
            VALUES ($1, $2, $3, $4, 'collateral_capture', 'success', $5, $6)`,
            [
                groupId,
                cycleId,
                slotId,
                adminUserId,
                collateralWithheld,
                `Collateral captured: ${collateralRate * 100}% of ${grossPayout} XAF pot`,
            ]
        );

        // Step 10: Check if all slots are paid — end cycle if so
        const unpaidSlots = await client.query(
            `SELECT COUNT(*) FROM payout_slots
             WHERE cycle_id = $1 AND status != 'paid_out'`,
            [cycleId]
        );

        if (parseInt(unpaidSlots.rows[0].count) === 0) {
            // All slots paid — end the cycle
            await client.query(
                `UPDATE contribution_cycles
                 SET status = 'completed', ended_at = NOW()
                 WHERE id = $1`,
                [cycleId]
            );

            // Unlock savings wallets for all members
            await client.query(
                `UPDATE wallets w
                 SET is_locked = false
                 FROM group_members gm
                 WHERE w.group_member_id = gm.id
                   AND gm.group_id = $1
                   AND w.wallet_type = 'savings'`,
                [groupId]
            );

            // Upgrade new_members to active status
            await client.query(
                `UPDATE group_members
                 SET member_status = 'active', status_changed_at = NOW()
                 WHERE group_id = $1 AND member_status = 'new_member'`,
                [groupId]
            );

            // Audit log cycle end
            await client.query(
                `INSERT INTO audit_logs (
                    actor_user_id, group_id, action, entity_type, entity_id
                )
                VALUES ($1, $2, 'cycle_ended', 'contribution_cycles', $3)`,
                [adminUserId, groupId, cycleId]
            );
        }

        // Step 11: Audit log disbursement
        await client.query(
            `INSERT INTO audit_logs (
                actor_user_id, group_id, action, entity_type, entity_id, new_values
            )
            VALUES ($1, $2, 'payout_triggered', 'payout_slots', $3, $4)`,
            [
                adminUserId,
                groupId,
                slotId,
                JSON.stringify({
                    gross_payout: grossPayout,
                    collateral_withheld: collateralWithheld,
                    net_payout: netPayout,
                    winner_msisdn: slot.winner_msisdn,
                })
            ]
        );

        await client.query('COMMIT');

        return {
            transaction: txnResult.rows[0],
            slot: updatedSlot.rows[0],
            summary: {
                gross_payout: grossPayout,
                collateral_withheld: collateralWithheld,
                net_payout: netPayout,
                collateral_rate_applied: `${collateralRate * 100}%`,
            }
        };

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// =============================================================================
// GET CYCLE DETAILS
// =============================================================================

/**
 * getCycleDetails — returns full details of a cycle including all slots.
 *
 * @param {string} groupId - UUID of the group
 * @param {string} cycleId - UUID of the cycle
 * @param {string} userId - UUID of the requesting user
 * @returns {Object} - { cycle, slots }
 */
const getCycleDetails = async (groupId, cycleId, userId) => {
    // Verify membership
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

    // Get cycle
    const cycleResult = await query(
        `SELECT * FROM contribution_cycles WHERE id = $1 AND group_id = $2`,
        [cycleId, groupId]
    );

    if (cycleResult.rows.length === 0) {
        const error = new Error('Cycle not found.');
        error.statusCode = 404;
        throw error;
    }

    // Get all slots with member details
    const slotsResult = await query(
        `SELECT
            ps.*,
            u.full_name AS winner_name,
            u.phone_msisdn AS winner_phone,
            gm.member_status
         FROM payout_slots ps
         LEFT JOIN group_members gm ON ps.group_member_id = gm.id
         LEFT JOIN users u ON gm.user_id = u.id
         WHERE ps.cycle_id = $1
         ORDER BY ps.slot_number ASC`,
        [cycleId]
    );

    return {
        cycle: cycleResult.rows[0],
        slots: slotsResult.rows,
    };
};

module.exports = {
    startCycle,
    assignPayoutSlots,
    disbursePayout,
    getCycleDetails,
};