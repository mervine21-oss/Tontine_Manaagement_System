// =============================================================================
// FILE: src/modules/disbursement/disbursement.controller.js
// PURPOSE: HTTP layer for disbursement engine.
// Handles cycle management and payout triggering requests.
// =============================================================================

const disbursementService = require('./disbursement.service');

// =============================================================================
// START CYCLE
// =============================================================================

/**
 * POST /api/disbursement/:groupId/start-cycle
 * Starts a new contribution cycle. Admin only.
 */
const startCycle = async (req, res, next) => {
    try {
        const result = await disbursementService.startCycle(
            req.user.id,
            req.params.groupId
        );

        res.status(201).json({
            success: true,
            message: 'Contribution cycle started successfully.',
            data: result,
        });

    } catch (err) {
        next(err);
    }
};

// =============================================================================
// ASSIGN PAYOUT SLOTS
// =============================================================================

/**
 * POST /api/disbursement/:groupId/cycles/:cycleId/assign-slots
 * Randomly assigns members to payout slots. Admin only.
 * Enforces new_member lock on slot 1.
 */
const assignPayoutSlots = async (req, res, next) => {
    try {
        const result = await disbursementService.assignPayoutSlots(
            req.user.id,
            req.params.cycleId,
            req.params.groupId
        );

        res.status(200).json({
            success: true,
            message: 'Payout slots assigned successfully.',
            data: result,
        });

    } catch (err) {
        next(err);
    }
};

// =============================================================================
// DISBURSE PAYOUT
// =============================================================================

/**
 * POST /api/disbursement/:groupId/cycles/:cycleId/slots/:slotId/disburse
 * Triggers payout for a specific slot. Admin only.
 * Automatically withholds 15% collateral.
 */
const disbursePayout = async (req, res, next) => {
    try {
        const result = await disbursementService.disbursePayout(
            req.user.id,
            req.params.cycleId,
            req.params.slotId,
            req.params.groupId
        );

        res.status(200).json({
            success: true,
            message: 'Payout disbursed successfully.',
            data: result,
        });

    } catch (err) {
        next(err);
    }
};

// =============================================================================
// GET CYCLE DETAILS
// =============================================================================

/**
 * GET /api/disbursement/:groupId/cycles/:cycleId
 * Returns full cycle details with all payout slots.
 */
const getCycleDetails = async (req, res, next) => {
    try {
        const result = await disbursementService.getCycleDetails(
            req.params.groupId,
            req.params.cycleId,
            req.user.id
        );

        res.status(200).json({
            success: true,
            data: result,
        });

    } catch (err) {
        next(err);
    }
};

module.exports = {
    startCycle,
    assignPayoutSlots,
    disbursePayout,
    getCycleDetails,
};