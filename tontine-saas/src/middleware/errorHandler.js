// =============================================================================
// FILE: src/middleware/errorHandler.js
// PURPOSE: Global error handler — catches all errors thrown anywhere in the
// app and returns a clean, consistent JSON response to the client.
// Prevents raw error messages (which leak system info) from reaching users.
// =============================================================================

/**
 * Global Error Handler Middleware
 * Must be registered LAST in app.js after all routes
 * Express identifies it as error handler because it has 4 parameters (err, req, res, next)
 */
const errorHandler = (err, req, res, next) => {

    // Log the full error internally for debugging
    console.error('❌ Error:', {
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        path: req.path,
        method: req.method,
    });

    // Default error values
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Internal Server Error';

    // Handle specific PostgreSQL database errors
    if (err.code === '23505') {
        // Unique constraint violation (e.g. duplicate email or phone)
        statusCode = 409;
        message = 'A record with this information already exists.';
    }

    if (err.code === '23503') {
        // Foreign key violation
        statusCode = 400;
        message = 'Referenced record does not exist.';
    }

    if (err.code === '23514') {
        // CHECK constraint violation
        statusCode = 400;
        message = 'Data validation failed at database level.';
    }

    // Handle JWT errors
    if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = 'Invalid authentication token.';
    }

    if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Authentication token has expired. Please log in again.';
    }

    // Send clean error response
    res.status(statusCode).json({
        success: false,
        error: {
            message,
            // Only show detailed error info in development mode
            ...(process.env.NODE_ENV === 'development' && {
                stack: err.stack,
                code: err.code,
            }),
        },
    });
};

/**
 * 404 Handler — catches requests to routes that don't exist
 */
const notFoundHandler = (req, res) => {
    res.status(404).json({
        success: false,
        error: {
            message: `Route ${req.method} ${req.path} not found.`,
        },
    });
};

module.exports = { errorHandler, notFoundHandler }; 
