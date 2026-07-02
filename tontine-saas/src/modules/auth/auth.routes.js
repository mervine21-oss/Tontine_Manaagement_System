 // =============================================================================
// FILE: src/modules/auth/auth.routes.js
// PURPOSE: Defines all authentication API endpoints.
// Each route has input validation rules applied before hitting the controller.
// =============================================================================

const express = require('express');
const { body } = require('express-validator');
const authController = require('./auth.controller');
const { protect } = require('../../middleware/auth');

const router = express.Router();

// =============================================================================
// VALIDATION RULES
// These run before the controller — invalid requests are rejected early.
// =============================================================================

const registerValidation = [
    body('full_name')
        .trim()
        .notEmpty().withMessage('Full name is required.')
        .isLength({ min: 2, max: 120 }).withMessage('Full name must be between 2 and 120 characters.'),

    body('email')
        .trim()
        .notEmpty().withMessage('Email is required.')
        .isEmail().withMessage('Please provide a valid email address.')
        .normalizeEmail(),

    body('phone_msisdn')
        .trim()
        .notEmpty().withMessage('Phone number is required.')
        .matches(/^\+[1-9]\d{6,14}$/).withMessage('Phone must be in E.164 format e.g. +237671234567'),

    body('telecom_operator')
        .notEmpty().withMessage('Telecom operator is required.')
        .isIn(['mtn_momo', 'orange_money', 'other']).withMessage('Operator must be mtn_momo, orange_money, or other.'),

    body('password')
        .notEmpty().withMessage('Password is required.')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase, and a number.'),
];

const loginValidation = [
    body('email')
        .trim()
        .notEmpty().withMessage('Email is required.')
        .isEmail().withMessage('Please provide a valid email address.'),

    body('password')
        .notEmpty().withMessage('Password is required.'),
];

// =============================================================================
// ROUTES
// =============================================================================

// Public routes — no token required
router.post('/register', registerValidation, authController.register);
router.post('/login',    loginValidation,    authController.login);
router.get('/verify-email/:token',          authController.verifyEmail);

// Protected route — valid JWT token required
router.get('/me', protect, authController.getMe);

module.exports = router;
