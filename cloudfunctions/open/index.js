// 云函数 open —— 拆信重读记录（BR-09，技术架构文档.md §4.3）
// 服务端按 (openid, letter_id, open_date) 幂等去重：同日重复拆信只记一条。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function todayKey() {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (event.action !== 'add') return { ok: false, error: 'unknown action' };

  try {
    const letterId = event.letter_id;
    const letter = await db.collection('letters').doc(letterId).get().catch(() => null);
    if (!letter || !letter.data || letter.data._openid !== OPENID) {
      return { ok: false, error: 'not found' };
    }

    const openDate = todayKey();
    const dup = await db
      .collection('open_records')
      .where({ _openid: OPENID, letter_id: letterId, open_date: openDate })
      .count();
    if (dup.total === 0) {
      await db.collection('open_records').add({
        data: { _openid: OPENID, letter_id: letterId, open_date: openDate, created_at: db.serverDate() }
      });
    }

    const all = await db
      .collection('open_records')
      .where({ _openid: OPENID, letter_id: letterId })
      .orderBy('created_at', 'asc')
      .get();
    return {
      ok: true,
      opens: all.data.map((r) => new Date(r.created_at).getTime())
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
