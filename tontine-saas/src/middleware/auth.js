 // =============================================================================
// FILE: src/middleware/auth.js
// PURPOSE: JWT Authentication middleware — protects private API routes.
// Any route that requires a logged-in user must use this middleware.
// It verifies the token and attaches the user's data to req.user.
// =============================================================================

const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
require('dotenv').config();

/**
 * protect — verifies JWT token on every protected request.
 *
 * How it works:
 * 1. Client sends: Authorization: Bearer <token> in request header
 * 2. We extract and verify the token
 * 3. We fetch the user from the database to confirm they still exist
 * 4. We attach user data to req.user for use in controllers
 */
const protect = async (req, res, next) => {
    try {
        // Step 1: Extract token from Authorization header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: { message: 'Access denied. No token provided.' }
            });
        }

        const token = authHeader.split(' ')[1];

        // Step 2: Verify the token using our secret key
        // This will throw an error if token is invalid or expired
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Step 3: Check user still exists in database
        // Prevents use of valid tokens for deleted/suspended accounts
        const result = await query(
            `SELECT id, full_name, email, phone_msisdn, 
                    telecom_operator, status, email_verified
             FROM users 
             WHERE id = $1 AND status = 'active'`,
            [decoded.id]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                error: { message: 'User no longer exists or has been suspended.' }
            });
        }

        // Step 4: Attach user to request object
        // Controllers can now access req.user.id, req.user.email etc.
        req.user = result.rows[0];

        next(); // Proceed to the actual route controller

    } catch (err) {
        next(err); // Pass JWT errors to global error handler
    }
};

/**
 * requireGroupAdmin — checks if the logged-in user is the admin
 * of a specific group. Must be used AFTER protect middleware.
 *
 * Usage: router.patch('/groups/:groupId', protect, requireGroupAdmin, controller)
 */
const requireGroupAdmin = async (req, res, next) => {
    try {
        const { groupId } = req.params;
        const userId = req.user.id;

        const result = await query(
            `SELECT id FROM group_members 
             WHERE group_id = $1 AND user_id = $2 AND is_admin = true`,
            [groupId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(403).json({
                success: false,
                error: { message: 'Access denied. You are not the admin of this group.' }
            });
        }

        next();

    } catch (err) {
        next(err);
    }
};

module.exports = { protect, requireGroupAdmin };
