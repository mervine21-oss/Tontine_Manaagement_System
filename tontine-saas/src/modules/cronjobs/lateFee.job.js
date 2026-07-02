// =============================================================================
// FILE: src/modules/cronjobs/lateFee.job.js
// PURPOSE: Automated late fee engine — runs on a schedule to detect
// missed contributions, mark members as delinquent, and levy penalties.
// This implements the RISK MITIGATION layer of the tontine system.
// =============================================================================

const cron = require('node-cron');
const { query, getClient } = require('../../config/database');

// =============================================================================
// CORE LATE FEE DETECTION ALGORITHM
// =============================================================================

/**
 * processLateFees — scans all active cycles for missed contributions
 * and levies penalties on delinquent members.
 *
 * Algorithm:
 * 1. Find all active cycles
 * 2. For each cycle find members who have not contributed
 * 3. Check if grace period has passed
 * 4. Mark member as delinquent
 * 5. Levy late fee based on group config
 * 6. Record everything in audit trail
 */
const processLateFees = async () => {
    console.log('⏰ Late fee cron job started:', new Date().toISOString());

    const client = await getClient();

    try {
        await client.query('BEGIN');

        // Step 1: Get all active cycles with their group late fee configs
        const activeCyclesResult = await client.query(
            `SELECT
                cc.id AS cycle_id,
                cc.group_id,
                cc.snapshot_contribution_amt,
                cc.started_at,
                lfc.grace_period_hours,
                lfc.fee_type,
                lfc.fee_amount,
                tg.contribution_frequency
             FROM contribution_cycles cc
             INNER JOIN tontine_groups tg ON cc.group_id = tg.id
             INNER JOIN late_fee_configs lfc ON lfc.group_id = tg.id
             WHERE cc.status = 'active' AND lfc.is_active = true`
        );

        const activeCycles = activeCyclesResult.rows;

        if (activeCycles.length === 0) {
            console.log('✅ No active cycles found. Cron job complete.');
            await client.query('COMMIT');
            return;
        }

        let totalFeesLevied = 0;
        let totalDelinquent = 0;

        for (const cycle of activeCycles) {
            // Step 2: Calculate contribution deadline based on frequency
            const deadline = calculateDeadline(
                cycle.started_at,
                cycle.contribution_frequency,
                cycle.grace_period_hours
            );

            // Only process if deadline has passed
            if (new Date() < deadline) {
                console.log(`⏳ Cycle ${cycle.cycle_id} deadline not yet passed.`);
                continue;
            }

            // Step 3: Find members who have NOT contributed this cycle
            const nonContributorsResult = await client.query(
                `SELECT
                    gm.id AS member_id,
                    gm.user_id,
                    gm.member_status,
                    u.full_name,
                    u.phone_msisdn
                 FROM group_members gm
                 INNER JOIN users u ON gm.user_id = u.id
                 WHERE gm.group_id = $1
                   AND gm.member_status NOT IN ('exited', 'suspended')
                   AND gm.id NOT IN (
                       -- Exclude members who already contributed this cycle
                       SELECT DISTINCT gm2.id
                       FROM transactions t
                       INNER JOIN wallets w ON t.wallet_id = w.id
                       INNER JOIN group_members gm2 ON w.group_member_id = gm2.id
                       WHERE t.cycle_id = $2
                         AND t.txn_type = 'contribution'
                         AND t.status = 'success'
                         AND gm2.group_id = $1
                   )`,
                [cycle.group_id, cycle.cycle_id]
            );

            const nonContributors = nonContributorsResult.rows;

            for (const member of nonContributors) {
                // Step 4: Check if late fee already levied this cycle
                const existingFee = await client.query(
                    `SELECT id FROM transactions
                     WHERE cycle_id = $1
                       AND initiated_by_user_id = $2
                       AND txn_type = 'late_fee'
                       AND status = 'success'`,
                    [cycle.cycle_id, member.user_id]
                );

                // Skip if fee already levied
                if (existingFee.rows.length > 0) continue;

                // Step 5: Calculate fee amount
                let feeAmount;
                if (cycle.fee_type === 'percentage') {
                    // Percentage of contribution amount
                    feeAmount = parseFloat(
                        (parseFloat(cycle.snapshot_contribution_amt) *
                        parseFloat(cycle.fee_amount) / 100).toFixed(2)
                    );
                } else {
                    // Flat fee in XAF
                    feeAmount = parseFloat(cycle.fee_amount);
                }

                // Step 6: Mark member as delinquent
                await client.query(
                    `UPDATE group_members
                     SET member_status = 'delinquent',
                         status_changed_at = NOW()
                     WHERE id = $1 AND member_status != 'delinquent'`,
                    [member.member_id]
                );

                // Step 7: Record late fee transaction in immutable ledger
                await client.query(
                    `INSERT INTO transactions (
                        group_id, cycle_id, initiated_by_user_id,
                        txn_type, status, amount, description
                    )
                    VALUES ($1, $2, $3, 'late_fee', 'success', $4, $5)`,
                    [
                        cycle.group_id,
                        cycle.cycle_id,
                        member.user_id,
                        feeAmount,
                        `Late fee for missed contribution — ${member.full_name} — ${feeAmount} XAF`,
                    ]
                );

                // Step 8: Record in audit trail
                await client.query(
                    `INSERT INTO audit_logs (
                        target_user_id, group_id, action,
                        entity_type, new_values
                    )
                    VALUES ($1, $2, 'late_fee_levied', 'group_members', $3)`,
                    [
                        member.user_id,
                        cycle.group_id,
                        JSON.stringify({
                            member_name: member.full_name,
                            fee_amount: feeAmount,
                            fee_type: cycle.fee_type,
                            new_status: 'delinquent',
                        })
                    ]
                );

                // Step 9: Record status change in audit trail
                await client.query(
                    `INSERT INTO audit_logs (
                        target_user_id, group_id, action,
                        entity_type, new_values
                    )
                    VALUES ($1, $2, 'member_status_changed', 'group_members', $3)`,
                    [
                        member.user_id,
                        cycle.group_id,
                        JSON.stringify({
                            old_status: member.member_status,
                            new_status: 'delinquent',
                            reason: 'missed_contribution',
                        })
                    ]
                );

                totalFeesLevied += feeAmount;
                totalDelinquent++;

                console.log(
                    `💸 Late fee levied: ${member.full_name} — ${feeAmount} XAF`
                );
            }
        }

        await client.query('COMMIT');

        console.log('✅ Late fee cron job completed:', {
            cycles_processed: activeCycles.length,
            members_penalised: totalDelinquent,
            total_fees_levied: `${totalFeesLevied} XAF`,
            timestamp: new Date().toISOString(),
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Late fee cron job failed:', err.message);
    } finally {
        client.release();
    }
};

// =============================================================================
// DEADLINE CALCULATOR
// =============================================================================

/**
 * calculateDeadline — computes the contribution deadline based on
 * cycle start date, contribution frequency, and grace period.
 *
 * @param {Date} startedAt - When the cycle started
 * @param {string} frequency - weekly|monthly|bi_monthly|annually
 * @param {number} gracePeriodHours - Hours after deadline before penalty
 * @returns {Date} - The deadline including grace period
 */
const calculateDeadline = (startedAt, frequency, gracePeriodHours) => {
    const start = new Date(startedAt);
    const deadline = new Date(start);

    switch (frequency) {
        case 'weekly':
            deadline.setDate(deadline.getDate() + 7);
            break;
        case 'monthly':
            deadline.setMonth(deadline.getMonth() + 1);
            break;
        case 'bi_monthly':
            deadline.setMonth(deadline.getMonth() + 2);
            break;
        case 'annually':
            deadline.setFullYear(deadline.getFullYear() + 1);
            break;
        default:
            deadline.setMonth(deadline.getMonth() + 1);
    }

    // Add grace period
    deadline.setHours(deadline.getHours() + gracePeriodHours);

    return deadline;
};

// =============================================================================
// CRON SCHEDULE
// =============================================================================

/**
 * startLateFeeJob — registers the cron job on a schedule.
 *
 * Schedule: runs every hour at minute 0
 * Cron syntax: '0 * * * *'
 * - 0      = minute 0
 * - *      = every hour
 * - *      = every day
 * - *      = every month
 * - *      = every day of week
 *
 * For testing you can change to '* * * * *' (every minute)
 */
const startLateFeeJob = () => {
    console.log('⏰ Late fee cron job scheduler started.');

    // Run every hour
    cron.schedule('0 * * * *', async () => {
        await processLateFees();
    });

    // Also run immediately on startup for testing
    // Comment this out in production
    processLateFees();
};

module.exports = { startLateFeeJob, processLateFees };