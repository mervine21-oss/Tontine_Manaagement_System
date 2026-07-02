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

    const groups = await query(
      `SELECT g.id, g.group_name, g.description, g.current_member_count, g.max_members, g.contribution_amount, g.contribution_frequency, gm.member_status, gm.is_admin
       FROM tontine_groups g
       INNER JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1 AND gm.member_status != 'exited'`,
      [user.id]
    );
    console.log('GROUPS', JSON.stringify(groups.rows, null, 2));
  } catch (err) {
    console.error(err.message);
  }
  process.exit(0);
})();
