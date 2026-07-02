const { query } = require('./src/config/database');

(async () => {
  try {
    const res = await query(
      'SELECT id, full_name, email, phone_msisdn, telecom_operator, status, email_verified, verification_token, created_at FROM users WHERE email = $1 OR phone_msisdn = $2',
      ['vanou@gmail.com', '+237678965476']
    );
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err.message);
  }
  process.exit(0);
})();
