// =============================================================================
// FILE: src/modules/groups/groups.controller.js
// PURPOSE: HTTP layer for group management — handles requests and responses.
// Controllers only handle HTTP concerns — business logic stays in service.
// =============================================================================

const { validationResult } = require('express-validator');
const groupsService = require('./groups.service');

// =============================================================================
// CREATE GROUP
// =============================================================================

/**
 * POST /api/groups
 * Creates a new tontine group. Authenticated user becomes the Admin.
 */
const createGroup = async (req, res, next) => {
    try {
        // Step 1: Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: { message: 'Validation failed.', details: errors.array() }
            });
        }

        // Step 2: Call service with authenticated user's ID
        const result = await groupsService.createGroup(req.user.id, req.body);

        // Step 3: Return created group
        res.status(201).json({
            success: true,
            message: 'Tontine group created successfully.',
            data: result,
        });

    } catch (err) {
        next(err);
    }
};

// =============================================================================
// GET ALL USER GROUPS
// =============================================================================

/**
 * GET /api/groups
 * Returns all groups the authenticated user belongs to.
 */
const getUserGroups = async (req, res, next) => {
    try {
        const groups = await groupsService.getUserGroups(req.user.id);

        res.status(200).json({
            success: true,
            count: groups.length,
            data: { groups },
        });

    } catch (err) {
        next(err);
    }
};

// =============================================================================
// GET SINGLE GROUP
// =============================================================================

/**
 * GET /api/groups/:groupId
 * Returns details of a specific group. User must be a member.
 */
const getGroupById = async (req, res, next) => {
    try {
        const group = await groupsService.getGroupById(
            req.params.groupId,
            req.user.id
        );

        res.status(200).json({
            success: true,
            data: { group },
        });

    } catch (err) {
        next(err);
    }
};

// =============================================================================
// JOIN GROUP
// =============================================================================

/**
 * POST /api/groups/join
 * Allows authenticated user to join a group using an invite code.
 */
const joinGroup = async (req, res, next) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: { message: 'Validation failed.', details: errors.array() }
            });
        }

        const result = await groupsService.joinGroup(
            req.user.id,
            req.body.invite_code
        );

        res.status(200).json({
            success: true,
            message: `You have successfully joined ${result.group.group_name}.`,
            data: result,
        });

    } catch (err) {
        next(err);
    }
};

// =============================================================================
// GET GROUP MEMBERS
// =============================================================================

/**
 * GET /api/groups/:groupId/members
 * Returns all members of a group with their wallet balances.
 */
const getGroupMembers = async (req, res, next) => {
    try {
        const members = await groupsService.getGroupMembers(
            req.params.groupId,
            req.user.id
        );

        res.status(200).json({
            success: true,
            count: members.length,
            data: { members },
        });

    } catch (err) {
        next(err);
    }
};

module.exports = {
    createGroup,
    getUserGroups,
    getGroupById,
    joinGroup,
    getGroupMembers,
};