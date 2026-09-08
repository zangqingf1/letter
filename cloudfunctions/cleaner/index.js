// 云函数 cleaner —— 废纸篓 30 天到期清理（BR-11/BR-12，技术架构文档.md §5.1）
// 定时触发器：每日 03:00（config.json）；物理删除到期信件及其重读记录与回信。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async () => {
  try {
    const res = await db
      .collection('letters')
      .where({ status: 'recycled', purge_at: _.lte(new Date()) })
      .limit(1000) // 云数据库 get() 默认只返回 20 条，积压时单次最多清 20 封
      .get();

    let purged = 0;
    for (const letter of res.data) {
      await db.collection('letters').doc(letter._id).remove();
      await db.collection('open_records').where({ letter_id: letter._id }).remove();
      await db.collection('reply_records').where({ letter_id: letter._id }).remove();
      purged += 1;
    }
    return { ok: true, purged };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
