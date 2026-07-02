 // =============================================================================
// FILE: server.js
// PURPOSE: Entry point — starts the Express server and connects to database.
// Run this file to launch the entire Tontine SaaS API.
// =============================================================================

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const app = require('./src/app');
const { startLateFeeJob } = require('./src/modules/cronjobs/lateFee.job');
const { pool } = require('./src/config/database');

const PORT = process.env.PORT || 3000;

// =============================================================================
// START SERVER
// =============================================================================

const startServer = async () => {
    try {
        // Step 1: Test database connection before starting server
        await pool.query('SELECT NOW()');
        console.log('✅ Database connection verified.');

        // Step 2: Start Express server
        app.listen(PORT, () => {
            console.log('==============================================');
            console.log(`🚀 Tontine SaaS API is running`);
            console.log(`🌍 Environment : ${process.env.NODE_ENV}`);
            console.log(`🔗 URL         : http://localhost:${PORT}`);
            console.log(`❤️  Health check: http://localhost:${PORT}/api/health`);
            console.log('==============================================');
        });
        // Start automated late fee cron job
startLateFeeJob();

    } catch (err) {
        console.error('❌ Failed to start server:', err.message);
        process.exit(1);
    }
};

// Handle uncaught exceptions — prevents silent crashes
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err.message);
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
    process.exit(1);
});

// Graceful shutdown on CTRL+C
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await pool.end();
    console.log('✅ Database pool closed.');
    process.exit(0);
});

startServer();
