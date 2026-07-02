// =============================================================================
// FILE: src/modules/wallets/wallets.controller.js
// PURPOSE: HTTP layer for wallet operations.
// Handles contribution and savings deposit requests.
// =============================================================================

const { validationResult } = require('express-validator');
const walletsService = require('./wallets.service');

// =============================================================================
// GET WALLET BALANCES
// =============================================================================

/**
 * GET /api/wallets/:groupId/balances
 * Returns both wallet balances for the authenticated user in a group.
 */
const getWalletBalances = async (req, res, next) => {
    try {
        const balances = await walletsService.getWalletBalances(
            req.user.id,
            req.params.groupId
        );

        res.status(200).json({
            success: true,
            data: balances,
        });

    } catch (err) {
        next(err);
    }
};

// =============================================================================
// MAKE CONTRIBUTION
// =============================================================================

/**
 * POST /api/wallets/:groupId/contribute
 * Deposits fixed contribution amount into rotational wallet.
 */
const makeContribution = async (req, res, next) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: { message: 'Validation failed.', details: errors.array() }
            });
        }

        const result = await walletsService.makeContribution(
            req.user.id,
            req.params.groupId,
            req.body
        );

        res.status(201).json({
            success: true,
            message: 'Contribution recorded successfully.',
            data: result,
        });

    } catch (err) {
        next(err);
    }
};

// =============================================================================
// MAKE SAVINGS DEPOSIT
// =============================================================================

/**
 * POST /api/wallets/:groupId/savings
 * Deposits voluntary amount into savings wallet.
 */
const makeSavingsDeposit = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: { message: 'Validation failed.', details: errors.array() }
            });
        }

        const result = await walletsService.makeSavingsDeposit(
            req.user.id,
            req.params.groupId,
            req.body
        );

        res.status(201).json({
            success: true,
            message: 'Savings deposit recorded successfully.',
            data: result,
        });

    } catch (err) {
        next(err);
    }
};

// =============================================================================
// GET TRANSACTION HISTORY
// =============================================================================

/**
 * GET /api/wallets/:groupId/transactions
 * Returns transaction history for authenticated user in a group.
 */
const getTransactionHistory = async (req, res, next) => {
    try {
        const transactions = await walletsService.getTransactionHistory(
            req.user.id,
            req.params.groupId
        );

        res.status(200).json({
            success: true,
            count: transactions.length,
            data: { transactions },
        });

    } catch (err) {
        next(err);
    }
};

module.exports = {
    getWalletBalances,
    makeContribution,
    makeSavingsDeposit,
    getTransactionHistory,
};