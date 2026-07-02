// =============================================================================
// FILE: src/modules/payments/payment.controller.js
// PURPOSE: HTTP layer for payment gateway operations.
// Handles payment initiation and webhook callbacks from telecoms.
// =============================================================================

const paymentService = require('./payment.service');

// =============================================================================
// INITIATE MTN MOMO PAYMENT
// =============================================================================

/**
 * POST /api/payments/:groupId/mtn/pay
 * Initiates an MTN Mobile Money USSD push payment.
 */
const initiateMtnPayment = async (req, res, next) => {
    try {
        const { amount, msisdn, paymentType } = req.body;

        // Validate required fields
        if (!amount || !msisdn) {
            return res.status(400).json({
                success: false,
                error: { message: 'Amount and msisdn are required.' }
            });
        }

        const result = await paymentService.initiateMtnMomoPayment(
            req.user.id,
            req.params.groupId,
            { amount, msisdn, paymentType }
        );

        res.status(200).json({
            success: true,
            message: result.message,
            data: {
                gateway_ref: result.gateway_ref,
                transaction_id: result.transaction.id,
                status: 'pending',
                amount,
                operator: 'mtn_momo',
            }
        });

    } catch (err) {
        next(err);
    }
};

// =============================================================================
// INITIATE ORANGE MONEY PAYMENT
// =============================================================================

/**
 * POST /api/payments/:groupId/orange/pay
 * Initiates an Orange Money payment request.
 */
const initiateOrangePayment = async (req, res, next) => {
    try {
        const { amount, msisdn, paymentType } = req.body;

        if (!amount || !msisdn) {
            return res.status(400).json({
                success: false,
                error: { message: 'Amount and msisdn are required.' }
            });
        }

        const result = await paymentService.initiateOrangeMoneyPayment(
            req.user.id,
            req.params.groupId,
            { amount, msisdn, paymentType }
        );

        res.status(200).json({
            success: true,
            message: result.message,
            data: {
                gateway_ref: result.gateway_ref,
                transaction_id: result.transaction.id,
                status: 'pending',
                amount,
                operator: 'orange_money',
            }
        });

    } catch (err) {
        next(err);
    }
};

// =============================================================================
// MTN MOMO WEBHOOK
// =============================================================================

/**
 * POST /api/payments/webhooks/mtn
 * Receives payment confirmation callbacks from MTN.
 * This endpoint is called by MTN servers — NOT by the client.
 *
 * SECURITY: In production verify webhook signature before processing.
 */
const mtnWebhook = async (req, res, next) => {
    try {
        console.log('📥 MTN Webhook received:', JSON.stringify(req.body));

        const result = await paymentService.handleMtnWebhook(req.body);

        // Always return 200 to MTN — otherwise they keep retrying
        res.status(200).json({
            success: true,
            message: 'Webhook processed.',
            data: result,
        });

    } catch (err) {
        // Still return 200 to prevent MTN retries
        console.error('❌ MTN webhook error:', err.message);
        res.status(200).json({
            success: false,
            message: 'Webhook received but processing failed.',
        });
    }
};

// =============================================================================
// ORANGE MONEY WEBHOOK
// =============================================================================

/**
 * POST /api/payments/webhooks/orange
 * Receives payment confirmation callbacks from Orange Money.
 */
const orangeWebhook = async (req, res, next) => {
    try {
        console.log('📥 Orange Money Webhook received:', JSON.stringify(req.body));

        const result = await paymentService.handleOrangeWebhook(req.body);

        // Always return 200 to Orange Money
        res.status(200).json({
            success: true,
            message: 'Webhook processed.',
            data: result,
        });

    } catch (err) {
        console.error('❌ Orange webhook error:', err.message);
        res.status(200).json({
            success: false,
            message: 'Webhook received but processing failed.',
        });
    }
};

// =============================================================================
// CHECK PAYMENT STATUS
// =============================================================================

/**
 * GET /api/payments/status/:gateway_ref
 * Checks the status of a payment by gateway reference.
 */
const checkPaymentStatus = async (req, res, next) => {
    try {
        const { gateway_ref } = req.params;

        const result = await require('../../config/database').query(
            `SELECT
                id, txn_type, status, amount,
                msisdn, operator, gateway_ref,
                gateway_status, description, created_at
             FROM transactions
             WHERE gateway_ref = $1
               AND initiated_by_user_id = $2`,
            [gateway_ref, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: { message: 'Transaction not found.' }
            });
        }

        res.status(200).json({
            success: true,
            data: { transaction: result.rows[0] }
        });

    } catch (err) {
        next(err);
    }
};

module.exports = {
    initiateMtnPayment,
    initiateOrangePayment,
    mtnWebhook,
    orangeWebhook,
    checkPaymentStatus,
};