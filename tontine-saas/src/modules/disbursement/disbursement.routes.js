// =============================================================================
// FILE: src/modules/disbursement/disbursement.routes.js
// PURPOSE: Defines all disbursement engine API endpoints.
// All routes are protected — valid JWT token required.
// =============================================================================

const express = require('express');
const disbursementController = require('./disbursement.controller');
const { protect, requireGroupAdmin } = require('../../middleware/auth');

const router = express.Router({ mergeParams: true });

// =============================================================================
// ROUTES
// =============================================================================

// Start a new contribution cycle (Admin only)
router.post(
    '/:groupId/start-cycle',
    protect,
    disbursementController.startCycle
);

// Assign payout slots to members (Admin only)
router.post(
    '/:groupId/cycles/:cycleId/assign-slots',
    protect,
    disbursementController.assignPayoutSlots
);

// Disburse payout for a specific slot (Admin only)
router.post(
    '/:groupId/cycles/:cycleId/slots/:slotId/disburse',
    protect,
    disbursementController.disbursePayout
);

// Get cycle details with all slots
router.get(
    '/:groupId/cycles/:cycleId',
    protect,
    disbursementController.getCycleDetails
);

module.exports = router;