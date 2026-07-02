// =============================================================================
// FILE: src/modules/wallets/wallets.routes.js
// PURPOSE: Defines all wallet and contribution API endpoints.
// All routes are protected — valid JWT token required.
// =============================================================================

const express = require('express');
const { body } = require('express-validator');
const walletsController = require('./wallets.controller');
const { protect } = require('../../middleware/auth');

const router = express.Router({ mergeParams: true }); // mergeParams gets :groupId from parent

// =============================================================================
// VALIDATION RULES
// =============================================================================

const contributionValidation = [
    body('amount')
        .notEmpty().withMessage('Amount is required.')
        .isFloat({ min: 1 }).withMessage('Amount must be greater than 0.'),

    body('msisdn')
        .optional()
        .matches(/^\+[1-9]\d{6,14}$/).withMessage('Phone must be in E.164 format.'),

    body('operator')
        .optional()
        .isIn(['mtn_momo', 'orange_money', 'other'])
        .withMessage('Operator must be mtn_momo, orange_money, or other.'),

    body('gateway_ref')
        .optional()
        .isString().withMessage('Gateway reference must be a string.'),
];

const savingsValidation = [
    body('amount')
        .notEmpty().withMessage('Amount is required.')
        .isFloat({ min: 1 }).withMessage('Amount must be greater than 0.'),

    body('msisdn')
        .optional()
        .matches(/^\+[1-9]\d{6,14}$/).withMessage('Phone must be in E.164 format.'),

    body('operator')
        .optional()
        .isIn(['mtn_momo', 'orange_money', 'other'])
        .withMessage('Operator must be mtn_momo, orange_money, or other.'),
];

// =============================================================================
// ROUTES
// =============================================================================

// Get both wallet balances for a group
router.get('/balances', protect, walletsController.getWalletBalances);

// Make a contribution to rotational wallet
router.post('/contribute', protect, contributionValidation, walletsController.makeContribution);

// Make a voluntary savings deposit
router.post('/savings', protect, savingsValidation, walletsController.makeSavingsDeposit);

// Get transaction history
router.get('/transactions', protect, walletsController.getTransactionHistory);

module.exports = router;