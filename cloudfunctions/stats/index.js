// 云函数 stats —— 「我的」页统计聚合（PRD 第八节，一次返回全部口径）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  if (event.action !== 'get') return { ok: false, error: 'unknown action' };
  const { OPENID } = cloud.getWXContext();

  try {
    // 封禁校验与六项统计一次并发取回：users 文档本来就要读（注册天数），
    // 旧版先 await isBanned()（同一条 users 查询）再并发，等于同一文档读两遍、多一个往返。
    // 封禁语义不变：判定失败仍按未封禁放行，命中 banned 仍整单拒绝。
    const [letters, opens, replies, users, pinned, recycled] = await Promise.all([
      db.collection('letters').where({ _openid: OPENID, status: 'active' }).count(),
      db.collection('open_records').where({ _openid: OPENID }).count(),
      db.collection('reply_records').where({ _openid: OPENID }).count(),
      db.collection('users').where({ _openid: OPENID }).limit(1).get().catch(() => null),
      db.collection('letters').where({ _openid: OPENID, status: 'active', pinned: true }).count(),
      db.collection('letters').where({ _openid: OPENID, status: 'recycled' }).count()
    ]);

    const u = users && users.data[0];
    if (u && u.status === 'banned') return { ok: false, error: 'banned' };
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
    // 错误详情只进日志：不回传 DB/SDK 原始 message
    console.error('[stats] get 失败', e);
    return { ok: false, error: 'internal error' };
  }
};
