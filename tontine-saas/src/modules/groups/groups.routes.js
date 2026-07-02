// =============================================================================
// FILE: src/modules/groups/groups.routes.js
// PURPOSE: Defines all group management API endpoints.
// All routes are protected — valid JWT token required.
// =============================================================================

const express = require('express');
const { body } = require('express-validator');
const groupsController = require('./groups.controller');
const { protect, requireGroupAdmin } = require('../../middleware/auth');

const router = express.Router();

// =============================================================================
// VALIDATION RULES
// =============================================================================

const createGroupValidation = [
    body('group_name')
        .trim()
        .notEmpty().withMessage('Group name is required.')
        .isLength({ min: 2, max: 150 }).withMessage('Group name must be between 2 and 150 characters.'),

    body('max_members')
        .notEmpty().withMessage('Maximum members is required.')
        .isInt({ min: 2, max: 100 }).withMessage('Maximum members must be between 2 and 100.'),

    body('contribution_amount')
        .notEmpty().withMessage('Contribution amount is required.')
        .isFloat({ min: 1 }).withMessage('Contribution amount must be greater than 0.'),

    body('contribution_frequency')
        .notEmpty().withMessage('Contribution frequency is required.')
        .isIn(['weekly', 'monthly', 'bi_monthly', 'annually'])
        .withMessage('Frequency must be weekly, monthly, bi_monthly, or annually.'),

    body('description')
        .optional()
        .trim()
        .isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters.'),
];

const joinGroupValidation = [
    body('invite_code')
        .trim()
        .notEmpty().withMessage('Invite code is required.')
        .isLength({ min: 8, max: 8 }).withMessage('Invite code must be exactly 8 characters.'),
];

// =============================================================================
// ROUTES
// All routes require authentication (protect middleware)
// =============================================================================

// Create a new tontine group
router.post('/', protect, createGroupValidation, groupsController.createGroup);

// Get all groups for logged in user
router.get('/', protect, groupsController.getUserGroups);

// Join a group using invite code
router.post('/join', protect, joinGroupValidation, groupsController.joinGroup);

// Get a specific group by ID
router.get('/:groupId', protect, groupsController.getGroupById);

// Get all members of a group
router.get('/:groupId/members', protect, groupsController.getGroupMembers);

module.exports = router;