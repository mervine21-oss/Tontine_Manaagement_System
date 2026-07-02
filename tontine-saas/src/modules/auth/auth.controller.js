 // =============================================================================
// FILE: src/modules/auth/auth.controller.js
// PURPOSE: HTTP layer for authentication — handles incoming requests,
// validates input, calls the service layer, and sends responses.
// Controllers never contain business logic — they only handle HTTP concerns.
// =============================================================================

const { validationResult } = require('express-validator');
const authService = require('./auth.service');

// =============================================================================
// REGISTER
// =============================================================================

/**
 * POST /api/auth/register
 * Creates a new user account.
 */
const register = async (req, res, next) => {
    try {
        // Step 1: Check for validation errors from express-validator
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: { message: 'Validation failed.', details: errors.array() }
            });
        }

        // Step 2: Call service layer with validated data
        const result = await authService.registerUser(req.body);

        // Step 3: Send success response
        // 201 = Created (standard HTTP code for new resource creation)
        res.status(201).json({
            success: true,
            message: 'Account created successfully. Please verify your email.',
            data: {
                user: result.user,
                token: result.token,
                // In production: send verification_token via email, not in response
                verification_token: result.verification_token,
            }
        });

    } catch (err) {
        next(err); // Pass to global error handler
    }
};

// =============================================================================
// LOGIN
// =============================================================================

/**
 * POST /api/auth/login
 * Authenticates a user and returns a JWT token.
 */
const login = async (req, res, next) => {
    try {
        // Step 1: Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: { message: 'Validation failed.', details: errors.array() }
            });
        }

        // Step 2: Call service layer
        const result = await authService.loginUser(req.body);

        // Step 3: Send success response with token
        res.status(200).json({
            success: true,
            message: 'Login successful.',
            data: {
                user: result.user,
                token: result.token,
            }
        });

    } catch (err) {
        next(err);
    }
};

// =============================================================================
// VERIFY EMAIL
// =============================================================================

/**
 * GET /api/auth/verify-email/:token
 * Activates a user account via email verification token.
 */
const verifyEmail = async (req, res, next) => {
    try {
        const { token } = req.params;
        const result = await authService.verifyEmail(token);

        res.status(200).json({
            success: true,
            message: result.message,
        });

    } catch (err) {
        next(err);
    }
};

// =============================================================================
// GET CURRENT USER (Me)
// =============================================================================

/**
 * GET /api/auth/me
 * Returns the currently logged-in user's profile.
 * Protected route — requires valid JWT token.
 */
const getMe = async (req, res, next) => {
    try {
        // req.user is attached by the protect middleware
        res.status(200).json({
            success: true,
            data: { user: req.user }
        });

    } catch (err) {
        next(err);
    }
};

module.exports = { register, login, verifyEmail, getMe };
