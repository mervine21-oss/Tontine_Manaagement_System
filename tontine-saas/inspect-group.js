const { query } = require('./src/config/database');

(async () => {
  try {
    const groupRes = await query('SELECT id FROM tontine_groups ORDER BY created_at DESC LIMIT 1');
    if (groupRes.rows.length === 0) {
      console.log('NO_GROUP_FOUND');
      process.exit(0);
    }
    const groupId = groupRes.rows[0].id;
    console.log('GROUP_ID', groupId);
    const groupDetail = await query('SELECT * FROM tontine_groups WHERE id = $1', [groupId]);
    console.log('GROUP_DETAIL', JSON.stringify(groupDetail.rows, null, 2));
  } catch (err) {
    console.error(err.message);
  }
  process.exit(0);
})();
