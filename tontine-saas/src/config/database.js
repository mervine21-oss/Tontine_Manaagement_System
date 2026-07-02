const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: 'aws-0-eu-west-1.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.lufycmjyhwivhzsqwohd',
    password: 'xxeCF2247LTEA1qa',
    ssl: {
        rejectUnauthorized: false
    },
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 30000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
});

// Keep connection alive by pinging every 4 minutes
setInterval(async () => {
    try {
        await pool.query('SELECT 1');
        console.log('💓 Database keepalive ping sent.');
    } catch (err) {
        console.error('❌ Keepalive ping failed:', err.message);
    }
}, 4 * 60 * 1000);

pool.on('connect', () => {
    console.log('✅ Connected to Supabase PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ Unexpected database error:', err.message);
});

const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

module.exports = { query, getClient, pool };