 // =============================================================================
// FILE: src/app.js
// PURPOSE: Express application setup — registers all middleware and routes.
// This file configures the app but does NOT start the server.
// Server startup is handled separately in server.js.
// =============================================================================

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

// Import routes
const authRoutes = require('./modules/auth/auth.routes');
const groupsRoutes = require('./modules/groups/groups.routes');
const walletsRoutes = require('./modules/wallets/wallets.routes');
const disbursementRoutes = require('./modules/disbursement/disbursement.routes');
const paymentRoutes = require('./modules/payments/payment.routes');

// Import error handlers
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Initialize Express app
const app = express();

// Serve frontend files from workspace root in development
if (process.env.NODE_ENV !== 'production') {
    const staticRoot = path.join(__dirname, '..', '..');
    app.use(express.static(staticRoot));
}

// =============================================================================
// SECURITY MIDDLEWARE (OWASP Best Practices)
// =============================================================================

// helmet — sets secure HTTP headers to protect against common attacks
// Prevents clickjacking, XSS, MIME sniffing, etc.
app.use(helmet());

// cors — controls which domains can call our API
app.use(cors({
    origin: (origin, callback) => {
        if (process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }

        const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);

        if (!origin) {
            return callback(new Error('CORS origin not allowed'), false);
        }

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error('CORS origin not allowed'), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
}));

// =============================================================================
// GENERAL MIDDLEWARE
// =============================================================================

// Parse incoming JSON request bodies
app.use(express.json({ limit: '10kb' })); // limit body size to prevent abuse

// Parse URL-encoded form data
app.use(express.urlencoded({ extended: true }));

// morgan — logs all incoming HTTP requests in development
if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
}

// =============================================================================
// HEALTH CHECK ROUTE
// Quick endpoint to verify the API is running
// =============================================================================

app.get('/api/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Tontine SaaS API is running.',
        environment: process.env.NODE_ENV,
        timestamp: new Date().toISOString(),
    });
});

// =============================================================================
// API ROUTES
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/wallets/:groupId', walletsRoutes);
app.use('/api/disbursement', disbursementRoutes);
app.use('/api/payments', paymentRoutes);
// =============================================================================
// ERROR HANDLING (must be registered LAST)
// =============================================================================

// 404 handler — catches requests to undefined routes
app.use(notFoundHandler);

// Global error handler — catches all errors thrown in controllers/services
app.use(errorHandler);

module.exports = app;
