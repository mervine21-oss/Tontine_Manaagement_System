 // =============================================================================
// FILE: src/modules/auth/auth.service.js
// PURPOSE: Core business logic for authentication.
// Handles user registration and login — completely separate from HTTP layer.
// Controllers call these functions and return the results to the client.
// =============================================================================

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../../config/database');
require('dotenv').config();

/**
 * Generates a signed JWT token for a user.
 * Token contains the user's ID and expires based on .env config.
 *
 * @param {string} userId - The user's UUID
 * @returns {string} - Signed JWT token
 */
const generateToken = (userId) => {
    return jwt.sign(
        { id: userId },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
    );
};

// =============================================================================
// REGISTER — Create a new user account
// =============================================================================

/**
 * registerUser — validates, hashes password, and creates a new user.
 *
 * Security measures:
 * - Password hashed with bcrypt (cost=12) before storage
 * - Parameterized query prevents SQL injection
 * - Duplicate email/phone caught by DB unique constraints
 *
 * @param {Object} userData - { full_name, email, phone_msisdn, telecom_operator, password }
 * @returns {Object} - { user, token }
 */
const registerUser = async (userData) => {
    const { full_name, email, phone_msisdn, telecom_operator, password } = userData;

    // Step 1: Check if email already exists
    // (DB unique constraint also catches this, but we give a cleaner message)
    const existingUser = await query(
        'SELECT id FROM users WHERE email = $1 OR phone_msisdn = $2',
        [email.toLowerCase(), phone_msisdn]
    );

    if (existingUser.rows.length > 0) {
        const error = new Error('An account with this email or phone number already exists.');
        error.statusCode = 409;
        throw error;
    }

    // Step 2: Hash the password with bcrypt
    // Cost factor 12 means 2^12 = 4096 hashing rounds — very secure
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Step 3: Generate email verification token
    const verification_token = uuidv4();
    const token_expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Step 4: Insert user into database using parameterized query
    const result = await query(
        `INSERT INTO users (
            full_name, email, phone_msisdn, telecom_operator,
            password_hash, verification_token, token_expires_at, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_verification')
        RETURNING id, full_name, email, phone_msisdn, telecom_operator, status, created_at`,
        [
            full_name,
            email.toLowerCase(), // always store email in lowercase
            phone_msisdn,
            telecom_operator,
            password_hash,
            verification_token,
            token_expires_at,
        ]
    );

    const newUser = result.rows[0];

    // Step 5: Log registration in audit trail
    await query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, new_values)
         VALUES ($1, 'user_registered', 'users', $2, $3)`,
        [
            newUser.id,
            newUser.id,
            JSON.stringify({ email: newUser.email, full_name: newUser.full_name })
        ]
    );

    // Step 6: Generate JWT token for immediate login after registration
    const token = generateToken(newUser.id);

    return {
        user: newUser,
        token,
        verification_token, // In production, send this via email
    };
};

// =============================================================================
// LOGIN — Authenticate an existing user
// =============================================================================

/**
 * loginUser — verifies credentials and returns a JWT token.
 *
 * Security measures:
 * - bcrypt.compare() safely compares password to hash
 * - Generic error message prevents user enumeration attacks
 * - Last login timestamp updated on success
 *
 * @param {Object} credentials - { email, password }
 * @returns {Object} - { user, token }
 */
const loginUser = async (credentials) => {
    const { email, password } = credentials;

    // Step 1: Find user by email
    const result = await query(
        `SELECT id, full_name, email, phone_msisdn, telecom_operator,
                password_hash, status, email_verified
         FROM users
         WHERE email = $1`,
        [email.toLowerCase()]
    );

    // Step 2: Generic error if user not found
    // SECURITY: We never reveal whether the email exists or not
    if (result.rows.length === 0) {
        const error = new Error('Invalid email or password.');
        error.statusCode = 401;
        throw error;
    }

    const user = result.rows[0];

    // Step 3: Check if account is suspended
    if (user.status === 'suspended') {
        const error = new Error('Your account has been suspended. Contact support.');
        error.statusCode = 403;
        throw error;
    }

    // Step 4: Compare submitted password with stored hash
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
        // SECURITY: Same generic message as user-not-found
        const error = new Error('Invalid email or password.');
        error.statusCode = 401;
        throw error;
    }

    // Step 5: Update last login timestamp
    await query(
        'UPDATE users SET last_login_at = NOW() WHERE id = $1',
        [user.id]
    );

    // Step 6: Log login event in audit trail
    await query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id)
         VALUES ($1, 'user_login', 'users', $1)`,
        [user.id]
    );

    // Step 7: Generate and return JWT token
    const token = generateToken(user.id);

    // Remove password hash before sending user data back
    delete user.password_hash;

    return { user, token };
};

// =============================================================================
// VERIFY EMAIL
// =============================================================================

/**
 * verifyEmail — activates a user account via the verification token.
 *
 * @param {string} token - The UUID token sent to user's email
 * @returns {Object} - { message }
 */
const verifyEmail = async (token) => {
    const result = await query(
        `UPDATE users
         SET email_verified = true,
             status = 'active',
             verification_token = NULL,
             token_expires_at = NULL
         WHERE verification_token = $1
           AND token_expires_at > NOW()
         RETURNING id, email`,
        [token]
    );

    if (result.rows.length === 0) {
        const error = new Error('Invalid or expired verification token.');
        error.statusCode = 400;
        throw error;
    }

    return { message: 'Email verified successfully. Your account is now active.' };
};

module.exports = { registerUser, loginUser, verifyEmail };
