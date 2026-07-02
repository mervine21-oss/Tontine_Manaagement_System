const { query } = require('./src/config/database');
const fetch = require('node-fetch');

(async () => {
  try {
    const user = await query("SELECT token FROM users WHERE email = 'vanou@gmail.com' LIMIT 1");
    console.log('USER_TOKEN', user.rows);
  } catch (err) {
    console.error('DB_ERROR', err.message);
  }
  process.exit(0);
})();
