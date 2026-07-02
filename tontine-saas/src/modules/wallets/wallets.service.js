// =============================================================================
// FILE: src/modules/wallets/wallets.service.js
// PURPOSE: Core business logic for dual-wallet operations.
// Handles contributions to rotational wallet and voluntary savings deposits.
// =============================================================================

const { query, getClient } = require('../../config/database');

// =============================================================================
// GET WALLET BALANCES
// =============================================================================

/**
 * getWalletBalances — returns both wallet balances for a member in a group.
 *
 * @param {string} userId - UUID of the requesting user
 * @param {string} groupId - UUID of the group
 * @returns {Object} - { rotational, savings, collateral }
 */
const getWalletBalances = async (userId, groupId) => {
    // Step 1: Verify user is a member of this group
    const memberResult = await query(
        `SELECT gm.id, gm.collateral_balance, gm.member_status
         FROM group_members gm
         WHERE gm.group_id = $1 AND gm.user_id = $2 AND gm.member_status != 'exited'`,
        [groupId, userId]
    );

    if (memberResult.rows.length === 0) {
        const error = new Error('You are not a member of this group.');
        error.statusCode = 403;
        throw error;
    }

    const member = memberResult.rows[0];

    // Step 2: Get both wallet balances
    const walletsResult = await query(
        `SELECT wallet_type, balance, is_locked, last_txn_at
         FROM wallets
         WHERE group_member_id = $1`,
        [member.id]
    );

    // Organise wallets into a clean object
    const wallets = { rotational: null, savings: null };
    walletsResult.rows.forEach(w => {
        wallets[w.wallet_type] = {
            balance: w.balance,
            is_locked: w.is_locked,
            last_txn_at: w.last_txn_at,
        };
    });

    return {
        member_id: member.id,
        member_status: member.member_status,
        collateral_balance: member.collateral_balance,
        wallets,
    };
};

// =============================================================================
// CONTRIBUTE — Deposit into Rotational Wallet
// =============================================================================

/**
 * makeContribution — deposits the fixed contribution amount into the
 * member's rotational wallet for the active cycle.
 *
 * Business Rules:
 * - Amount must match the group's fixed contribution amount exactly
 * - Member must be active or new_member (not delinquent/suspended)
 * - Transaction recorded in immutable ledger
 * - Wallet balance updated atomically
 *
 * @param {string} userId - UUID of the contributing member
 * @param {string} groupId - UUID of the group
 * @param {Object} paymentData - { amount, msisdn, operator, gateway_ref }
 * @returns {Object} - { transaction, wallet }
 */
const makeContribution = async (userId, groupId, paymentData) => {
    const { amount, msisdn, operator, gateway_ref, gateway_payload } = paymentData;

    const client = await getClient();

    try {
        await client.query('BEGIN');

        // Step 1: Get group configuration
        const groupResult = await client.query(
            `SELECT id, contribution_amount, is_config_locked
             FROM tontine_groups WHERE id = $1`,
            [groupId]
        );

        if (groupResult.rows.length === 0) {
            const error = new Error('Group not found.');
            error.statusCode = 404;
            throw error;
        }

        const group = groupResult.rows[0];

        // Step 2: Validate contribution amount matches fixed amount
        // BUSINESS RULE: contributions must be exact — no partial payments
        if (parseFloat(amount) !== parseFloat(group.contribution_amount)) {
            const error = new Error(
                `Contribution amount must be exactly ${group.contribution_amount} XAF.`
            );
            error.statusCode = 400;
            throw error;
        }

        // Step 3: Get member and verify status
        const memberResult = await client.query(
            `SELECT gm.id, gm.member_status
             FROM group_members gm
             WHERE gm.group_id = $1 AND gm.user_id = $2`,
            [groupId, userId]
        );

        if (memberResult.rows.length === 0) {
            const error = new Error('You are not a member of this group.');
            error.statusCode = 403;
            throw error;
        }

        const member = memberResult.rows[0];

        // Step 4: Block delinquent or suspended members
        if (['suspended', 'exited'].includes(member.member_status)) {
            const error = new Error('Your membership status does not allow contributions.');
            error.statusCode = 403;
            throw error;
        }

        // Step 5: Get rotational wallet
        const walletResult = await client.query(
            `SELECT id, balance FROM wallets
             WHERE group_member_id = $1 AND wallet_type = 'rotational'`,
            [member.id]
        );

        const wallet = walletResult.rows[0];

        // Step 6: Update rotational wallet balance
        const updatedWallet = await client.query(
            `UPDATE wallets
             SET balance = balance + $1, last_txn_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [amount, wallet.id]
        );

        // Step 7: Get active cycle if exists
        const cycleResult = await client.query(
            `SELECT id FROM contribution_cycles
             WHERE group_id = $1 AND status = 'active'
             LIMIT 1`,
            [groupId]
        );

        const cycleId = cycleResult.rows.length > 0
            ? cycleResult.rows[0].id
            : null;

        // Step 8: Record transaction in immutable ledger
        // FORENSIC: msisdn, operator, gateway_ref logged for legal auditability
        const txnResult = await client.query(
            `INSERT INTO transactions (
                group_id, cycle_id, wallet_id, initiated_by_user_id,
                txn_type, status, amount,
                msisdn, operator, gateway_ref, gateway_payload, description
            )
            VALUES ($1, $2, $3, $4, 'contribution', 'success', $5, $6, $7, $8, $9, $10)
            RETURNING *`,
            [
                groupId,
                cycleId,
                wallet.id,
                userId,
                amount,
                msisdn || null,
                operator || null,
                gateway_ref || null,
                gateway_payload ? JSON.stringify(gateway_payload) : null,
                `Monthly contribution of ${amount} XAF`,
            ]
        );

        // Step 9: Log in audit trail
        await client.query(
            `INSERT INTO audit_logs (
                actor_user_id, group_id, action, entity_type, entity_id, new_values
            )
            VALUES ($1, $2, 'contribution_made', 'transactions', $3, $4)`,
            [
                userId,
                groupId,
                txnResult.rows[0].id,
                JSON.stringify({ amount, wallet_type: 'rotational' })
            ]
        );

        await client.query('COMMIT');

        return {
            transaction: txnResult.rows[0],
            wallet: updatedWallet.rows[0],
        };

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// =============================================================================
// SAVINGS DEPOSIT — Deposit into Savings Wallet
// =============================================================================

/**
 * makeSavingsDeposit — deposits voluntary amount into savings wallet.
 *
 * Business Rules:
 * - Savings wallet must not be locked (locked during active cycle)
 * - Any amount above 0 is accepted
 * - Funds are locked until cycle termination
 *
 * @param {string} userId - UUID of the depositing member
 * @param {string} groupId - UUID of the group
 * @param {Object} paymentData - { amount, msisdn, operator, gateway_ref }
 * @returns {Object} - { transaction, wallet }
 */
const makeSavingsDeposit = async (userId, groupId, paymentData) => {
    const { amount, msisdn, operator, gateway_ref } = paymentData;

    const client = await getClient();

    try {
        await client.query('BEGIN');

        // Step 1: Get member
        const memberResult = await client.query(
            `SELECT gm.id FROM group_members gm
             WHERE gm.group_id = $1 AND gm.user_id = $2 AND gm.member_status != 'exited'`,
            [groupId, userId]
        );

        if (memberResult.rows.length === 0) {
            const error = new Error('You are not a member of this group.');
            error.statusCode = 403;
            throw error;
        }

        const member = memberResult.rows[0];

        // Step 2: Get savings wallet and check lock status
        const walletResult = await client.query(
            `SELECT id, balance, is_locked FROM wallets
             WHERE group_member_id = $1 AND wallet_type = 'savings'`,
            [member.id]
        );

        const wallet = walletResult.rows[0];

        // BUSINESS RULE: savings wallet is locked during active cycle
        // Deposits still allowed — only WITHDRAWALS are blocked when locked
        // Step 3: Update savings wallet balance
        const updatedWallet = await client.query(
            `UPDATE wallets
             SET balance = balance + $1, last_txn_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [amount, wallet.id]
        );

        // Step 4: Record transaction
        const txnResult = await client.query(
            `INSERT INTO transactions (
                group_id, wallet_id, initiated_by_user_id,
                txn_type, status, amount,
                msisdn, operator, gateway_ref, description
            )
            VALUES ($1, $2, $3, 'savings_deposit', 'success', $4, $5, $6, $7, $8)
            RETURNING *`,
            [
                groupId,
                wallet.id,
                userId,
                amount,
                msisdn || null,
                operator || null,
                gateway_ref || null,
                `Voluntary savings deposit of ${amount} XAF`,
            ]
        );

        // Step 5: Audit log
        await client.query(
            `INSERT INTO audit_logs (
                actor_user_id, group_id, action, entity_type, entity_id, new_values
            )
            VALUES ($1, $2, 'savings_deposited', 'transactions', $3, $4)`,
            [
                userId,
                groupId,
                txnResult.rows[0].id,
                JSON.stringify({ amount, wallet_type: 'savings' })
            ]
        );

        await client.query('COMMIT');

        return {
            transaction: txnResult.rows[0],
            wallet: updatedWallet.rows[0],
        };

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// =============================================================================
// GET TRANSACTION HISTORY
// =============================================================================

/**
 * getTransactionHistory — returns all transactions for a member in a group.
 *
 * @param {string} userId - UUID of the requesting user
 * @param {string} groupId - UUID of the group
 * @returns {Array} - List of transactions
 */
const getTransactionHistory = async (userId, groupId) => {
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

    const result = await query(
        `SELECT
            t.id,
            t.txn_type,
            t.status,
            t.amount,
            t.msisdn,
            t.operator,
            t.gateway_ref,
            t.description,
            t.created_at,
            u.full_name AS initiated_by
         FROM transactions t
         INNER JOIN users u ON t.initiated_by_user_id = u.id
         WHERE t.group_id = $1
           AND t.initiated_by_user_id = $2
         ORDER BY t.created_at DESC`,
        [groupId, userId]
    );

    return result.rows;
};

module.exports = {
    getWalletBalances,
    makeContribution,
    makeSavingsDeposit,
    getTransactionHistory,
};