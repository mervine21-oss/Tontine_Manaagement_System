// =============================================================================
// FILE: src/modules/payments/payment.service.js
// PURPOSE: Payment gateway integration for MTN Mobile Money and Orange Money.
// =============================================================================

const { query, getClient } = require('../../config/database');

// =============================================================================
// PAYMENT GATEWAY CONFIGURATION
// =============================================================================
const GATEWAY_CONFIG = {
    mtn_momo: {
        baseUrl: process.env.MTN_MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com',
        currency: 'XAF',
    },
    orange_money: {
        baseUrl: process.env.ORANGE_MONEY_BASE_URL || 'https://api.orange.com/orange-money-webpay/dev/v1',
        currency: 'XAF',
    },
};

// =============================================================================
// INITIATE MTN MOMO PAYMENT
// =============================================================================
const initiateMtnMomoPayment = async (userId, groupId, paymentData) => {
    const { amount, msisdn, paymentType = 'contribution' } = paymentData;
    const client = await getClient();

    try {
        await client.query('BEGIN');

        const memberCheck = await client.query(
            `SELECT gm.id, w.id AS wallet_id
             FROM group_members gm
             INNER JOIN wallets w ON w.group_member_id = gm.id
             WHERE gm.group_id = $1 AND gm.user_id = $2
               AND w.wallet_type = 'rotational'`,
            [groupId, userId]
        );

        if (memberCheck.rows.length === 0) {
            const error = new Error('Member not found in this group.');
            error.statusCode = 404;
            throw error;
        }

        const member = memberCheck.rows[0];
        const gateway_ref = `MTN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

        const txnResult = await client.query(
            `INSERT INTO transactions (
                group_id, wallet_id, initiated_by_user_id,
                txn_type, status, amount,
                msisdn, operator, gateway_ref, description
            )
            VALUES ($1, $2, $3, $4, 'pending', $5, $6, 'mtn_momo', $7, $8)
            RETURNING *`,
            [
                groupId, member.wallet_id, userId,
                paymentType, amount, msisdn,
                gateway_ref,
                `MTN MoMo ${paymentType} payment request — ${amount} XAF`,
            ]
        );

        const pendingTxn = txnResult.rows[0];
        const gatewayResponse = await sendMtnUssdPush({ amount, msisdn, gateway_ref });

        await client.query(
            `INSERT INTO audit_logs (
                actor_user_id, group_id, action, entity_type, entity_id, new_values
            ) VALUES ($1, $2, 'webhook_received', 'transactions', $3, $4)`,
            [userId, groupId, pendingTxn.id,
             JSON.stringify({ gateway_ref, operator: 'mtn_momo', status: 'pending', amount })]
        );

        await client.query('COMMIT');

        return {
            transaction: pendingTxn,
            gateway_ref,
            message: `Payment request sent to ${msisdn}. Please confirm on your phone.`,
            gateway_response: gatewayResponse,
        };

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// =============================================================================
// INITIATE ORANGE MONEY PAYMENT
// =============================================================================
const initiateOrangeMoneyPayment = async (userId, groupId, paymentData) => {
    const { amount, msisdn, paymentType = 'contribution' } = paymentData;
    const client = await getClient();

    try {
        await client.query('BEGIN');

        const memberCheck = await client.query(
            `SELECT gm.id, w.id AS wallet_id
             FROM group_members gm
             INNER JOIN wallets w ON w.group_member_id = gm.id
             WHERE gm.group_id = $1 AND gm.user_id = $2
               AND w.wallet_type = 'rotational'`,
            [groupId, userId]
        );

        if (memberCheck.rows.length === 0) {
            const error = new Error('Member not found in this group.');
            error.statusCode = 404;
            throw error;
        }

        const member = memberCheck.rows[0];
        const gateway_ref = `OM-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

        const txnResult = await client.query(
            `INSERT INTO transactions (
                group_id, wallet_id, initiated_by_user_id,
                txn_type, status, amount,
                msisdn, operator, gateway_ref, description
            )
            VALUES ($1, $2, $3, $4, 'pending', $5, $6, 'orange_money', $7, $8)
            RETURNING *`,
            [
                groupId, member.wallet_id, userId,
                paymentType, amount, msisdn,
                gateway_ref,
                `Orange Money ${paymentType} payment request — ${amount} XAF`,
            ]
        );

        const pendingTxn = txnResult.rows[0];
        const gatewayResponse = await sendOrangeMoneyRequest({ amount, msisdn, gateway_ref });

        await client.query(
            `INSERT INTO audit_logs (
                actor_user_id, group_id, action, entity_type, entity_id, new_values
            ) VALUES ($1, $2, 'webhook_received', 'transactions', $3, $4)`,
            [userId, groupId, pendingTxn.id,
             JSON.stringify({ gateway_ref, operator: 'orange_money', status: 'pending', amount })]
        );

        await client.query('COMMIT');

        return {
            transaction: pendingTxn,
            gateway_ref,
            message: `Payment request sent to ${msisdn}. Please confirm on your phone.`,
            gateway_response: gatewayResponse,
        };

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// =============================================================================
// WEBHOOK HANDLER — MTN MOMO
// =============================================================================
const handleMtnWebhook = async (webhookPayload) => {
    const { externalId, status, payer, financialTransactionId } = webhookPayload;
    const client = await getClient();

    try {
        await client.query('BEGIN');

        // Find pending transaction by gateway_ref
        const txnResult = await client.query(
            `SELECT * FROM transactions
             WHERE gateway_ref = $1
               AND operator = 'mtn_momo'
               AND status = 'pending'`,
            [externalId]
        );

        if (txnResult.rows.length === 0) {
            console.warn('⚠️ MTN webhook for unknown ref:', externalId);
            await client.query('ROLLBACK');
            return { success: false, message: 'Transaction not found.' };
        }

        const txn = txnResult.rows[0];
        const isSuccess = status === 'SUCCESSFUL';

        if (isSuccess) {
            // Insert NEW success transaction — immutability rule
            await client.query(
                `INSERT INTO transactions (
                    group_id, wallet_id, initiated_by_user_id,
                    txn_type, status, amount, msisdn, operator,
                    gateway_ref, gateway_status, gateway_payload, description
                )
                VALUES ($1, $2, $3, $4, 'success', $5, $6, 'mtn_momo', $7, $8, $9, $10)`,
                [
                    txn.group_id, txn.wallet_id, txn.initiated_by_user_id,
                    txn.txn_type, txn.amount,
                    payer?.partyId || txn.msisdn,
                    financialTransactionId || externalId,
                    status,
                    JSON.stringify(webhookPayload),
                    `MTN MoMo confirmed — ${txn.amount} XAF`,
                ]
            );

            // Credit the rotational wallet
            await client.query(
                `UPDATE wallets
                 SET balance = balance + $1, last_txn_at = NOW()
                 WHERE id = $2`,
                [txn.amount, txn.wallet_id]
            );

            console.log(`✅ MTN MoMo confirmed: ${externalId} — ${txn.amount} XAF`);

        } else {
            // Insert NEW failed transaction record
            await client.query(
                `INSERT INTO transactions (
                    group_id, wallet_id, initiated_by_user_id,
                    txn_type, status, amount, msisdn, operator,
                    gateway_ref, gateway_status, gateway_payload,
                    failure_reason, description
                )
                VALUES ($1, $2, $3, $4, 'failed', $5, $6, 'mtn_momo', $7, $8, $9, $10, $11)`,
                [
                    txn.group_id, txn.wallet_id, txn.initiated_by_user_id,
                    txn.txn_type, txn.amount, txn.msisdn,
                    externalId, status,
                    JSON.stringify(webhookPayload),
                    `MTN payment failed: ${status}`,
                    `MTN MoMo failed — ${txn.amount} XAF`,
                ]
            );

            console.log(`❌ MTN payment failed: ${externalId}`);
        }

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (
                group_id, action, entity_type, entity_id, new_values
            ) VALUES ($1, 'webhook_received', 'transactions', $2, $3)`,
            [
                txn.group_id, txn.id,
                JSON.stringify({ operator: 'mtn_momo', gateway_ref: externalId, status })
            ]
        );

        await client.query('COMMIT');
        return { success: isSuccess, transaction: txn };

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ MTN webhook processing failed:', err.message);
        throw err;
    } finally {
        client.release();
    }
};

// =============================================================================
// WEBHOOK HANDLER — ORANGE MONEY
// =============================================================================
const handleOrangeWebhook = async (webhookPayload) => {
    const { notif_token, status, txnid, msisdn } = webhookPayload;
    const client = await getClient();

    try {
        await client.query('BEGIN');

        const txnResult = await client.query(
            `SELECT * FROM transactions
             WHERE gateway_ref = $1
               AND operator = 'orange_money'
               AND status = 'pending'`,
            [notif_token]
        );

        if (txnResult.rows.length === 0) {
            console.warn('⚠️ Orange webhook for unknown ref:', notif_token);
            await client.query('ROLLBACK');
            return { success: false, message: 'Transaction not found.' };
        }

        const txn = txnResult.rows[0];
        const isSuccess = status === 'SUCCESS';

        if (isSuccess) {
            // Insert NEW success transaction
            await client.query(
                `INSERT INTO transactions (
                    group_id, wallet_id, initiated_by_user_id,
                    txn_type, status, amount, msisdn, operator,
                    gateway_ref, gateway_status, gateway_payload, description
                )
                VALUES ($1, $2, $3, $4, 'success', $5, $6, 'orange_money', $7, $8, $9, $10)`,
                [
                    txn.group_id, txn.wallet_id, txn.initiated_by_user_id,
                    txn.txn_type, txn.amount,
                    msisdn || txn.msisdn,
                    txnid || notif_token,
                    status,
                    JSON.stringify(webhookPayload),
                    `Orange Money confirmed — ${txn.amount} XAF`,
                ]
            );

            // Credit the rotational wallet
            await client.query(
                `UPDATE wallets
                 SET balance = balance + $1, last_txn_at = NOW()
                 WHERE id = $2`,
                [txn.amount, txn.wallet_id]
            );

            console.log(`✅ Orange Money confirmed: ${notif_token} — ${txn.amount} XAF`);

        } else {
            // Insert NEW failed transaction
            await client.query(
                `INSERT INTO transactions (
                    group_id, wallet_id, initiated_by_user_id,
                    txn_type, status, amount, msisdn, operator,
                    gateway_ref, gateway_status, gateway_payload,
                    failure_reason, description
                )
                VALUES ($1, $2, $3, $4, 'failed', $5, $6, 'orange_money', $7, $8, $9, $10, $11)`,
                [
                    txn.group_id, txn.wallet_id, txn.initiated_by_user_id,
                    txn.txn_type, txn.amount, txn.msisdn,
                    notif_token, status,
                    JSON.stringify(webhookPayload),
                    `Orange payment failed: ${status}`,
                    `Orange Money failed — ${txn.amount} XAF`,
                ]
            );

            console.log(`❌ Orange payment failed: ${notif_token}`);
        }

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (
                group_id, action, entity_type, entity_id, new_values
            ) VALUES ($1, 'webhook_received', 'transactions', $2, $3)`,
            [
                txn.group_id, txn.id,
                JSON.stringify({ operator: 'orange_money', gateway_ref: notif_token, status, txnid })
            ]
        );

        await client.query('COMMIT');
        return { success: isSuccess, transaction: txn };

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Orange webhook processing failed:', err.message);
        throw err;
    } finally {
        client.release();
    }
};

// =============================================================================
// GATEWAY SIMULATORS (Sandbox Mode)
// =============================================================================
const sendMtnUssdPush = async ({ amount, msisdn, gateway_ref }) => {
    console.log(`📱 MTN MoMo USSD push sent to ${msisdn}: ${amount} XAF [ref: ${gateway_ref}]`);
    return {
        status: 202,
        message: 'USSD push sent successfully.',
        gateway_ref,
        timestamp: new Date().toISOString(),
    };
};

const sendOrangeMoneyRequest = async ({ amount, msisdn, gateway_ref }) => {
    console.log(`📱 Orange Money request sent to ${msisdn}: ${amount} XAF [ref: ${gateway_ref}]`);
    return {
        status: 200,
        message: 'Orange Money request sent successfully.',
        gateway_ref,
        timestamp: new Date().toISOString(),
    };
};

module.exports = {
    initiateMtnMomoPayment,
    initiateOrangeMoneyPayment,
    handleMtnWebhook,
    handleOrangeWebhook,
};