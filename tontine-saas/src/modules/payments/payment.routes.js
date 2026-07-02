// =============================================================================
// FILE: src/modules/payments/payment.routes.js
// PURPOSE: Defines all payment gateway API endpoints.
// Payment initiation routes are protected.
// Webhook routes are PUBLIC — called directly by telecom servers.
// =============================================================================

const express = require('express');
const paymentController = require('./payment.controller');
const { protect } = require('../../middleware/auth');

const router = express.Router();

// =============================================================================
// PAYMENT INITIATION ROUTES (Protected — JWT required)
// =============================================================================

// Initiate MTN Mobile Money payment
router.post(
    '/:groupId/mtn/pay',
    protect,
    paymentController.initiateMtnPayment
);

// Initiate Orange Money payment
router.post(
    '/:groupId/orange/pay',
    protect,
    paymentController.initiateOrangePayment
);

// Check payment status by gateway reference
router.get(
    '/status/:gateway_ref',
    protect,
    paymentController.checkPaymentStatus
);

// =============================================================================
// WEBHOOK ROUTES (Public — called by telecom servers)
// These routes do NOT use JWT authentication because they are called
// by MTN and Orange Money servers, not by our client app.
// SECURITY: In production verify webhook signatures instead.
// =============================================================================

// MTN Mobile Money webhook callback
router.post('/webhooks/mtn', paymentController.mtnWebhook);

// Orange Money webhook callback
router.post('/webhooks/orange', paymentController.orangeWebhook);

module.exports = router;