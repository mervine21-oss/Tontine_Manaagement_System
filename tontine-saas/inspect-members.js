const { query } = require('./src/config/database');

(async () => {
  try {
    const userRes = await query("SELECT id, email FROM users WHERE email = 'vanou@gmail.com' LIMIT 1");
    if (userRes.rows.length === 0) {
      console.log('USER_NOT_FOUND');
      return process.exit(0);
    }
    const user = userRes.rows[0];
    console.log('USER', user);

    const groupRes = await query("SELECT id FROM tontine_groups ORDER BY created_at DESC LIMIT 1");
    if (groupRes.rows.length === 0) {
      console.log('NO_GROUP_FOUND');
      return process.exit(0);
    }
    const groupId = groupRes.rows[0].id;
    console.log('GROUP_ID', groupId);

    const membership = await query(
      'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user.id]
    );
    console.log('MEMBERSHIP', JSON.stringify(membership.rows, null, 2));
  } catch (err) {
    console.error(err.message);
  }
  process.exit(0);
})();
