// 云函数 stats —— 「我的」页统计聚合（PRD 第八节，一次返回全部口径）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  if (event.action !== 'get') return { ok: false, error: 'unknown action' };
  const { OPENID } = cloud.getWXContext();

  try {
    const [letters, opens, replies, users, pinned, recycled] = await Promise.all([
      db.collection('letters').where({ _openid: OPENID, status: 'active' }).count(),
      db.collection('open_records').where({ _openid: OPENID }).count(),
      db.collection('reply_records').where({ _openid: OPENID }).count(),
      db.collection('users').where({ _openid: OPENID }).limit(1).get(),
      db.collection('letters').where({ _openid: OPENID, status: 'active', pinned: true }).count(),
      db.collection('letters').where({ _openid: OPENID, status: 'recycled' }).count()
    ]);

    const u = users.data[0];
    const registerDays = u && u.created_at
      ? Math.max(1, Math.floor((Date.now() - new Date(u.created_at).getTime()) / 86400000) + 1)
      : 1;

    return {
      ok: true,
      letterTotal: letters.total,
      rereadTotal: opens.total,
      replyTotal: replies.total,
      registerDays,
      pinnedCount: pinned.total,
      recycleCount: recycled.total
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
