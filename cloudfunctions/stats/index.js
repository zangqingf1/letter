// 云函数 stats —— 「我的」页统计聚合（PRD 第八节，一次返回全部口径）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const IDS_PAGE = 1000; // 云函数内单次 get 上限
const IN_SHARD = 100; // where in 单次 _id 数量：一次塞太多会顶到查询请求体上限
const SHARD_CONCURRENCY = 5; // 分片 count 的并发上限

// 「还在信箱里」的信件 _id 全集（status: 'active'）。
// 为什么需要它：删除进废纸篓的信件仍保留自己的重读记录与回信（取回时原样恢复），
// 但「我的」页这两个数字只统计信箱里还在的信件 —— 只能按 letter_id 正向过滤，
// 不能用「全量 count − 废纸篓 count」的减法：彻底删除虽由 removeLetterDeep 连带清记录，
// 但历史残留的孤儿记录用减法仍会被算进总数。
// 游标分页（_id 递增）而非 skip：信件多时深分页会随页数线性变慢。
async function activeLetterIds(openid) {
  const ids = [];
  let cursor = '';
  for (;;) {
    const base = { _openid: openid, status: 'active' };
    const res = await db
      .collection('letters')
      .where(cursor ? Object.assign({ _id: _.gt(cursor) }, base) : base)
      .field({ _id: true })
      .orderBy('_id', 'asc')
      .limit(IDS_PAGE)
      .get();
    for (const l of res.data) ids.push(l._id);
    if (res.data.length < IDS_PAGE) return ids;
    cursor = ids[ids.length - 1];
  }
}

// 这些信件名下的记录条数：按 IN_SHARD 分片并发 count 后累加（空集合直接返回 0，不打查询）
async function countByLetters(collection, openid, ids) {
  if (!ids.length) return 0;
  const shards = [];
  for (let i = 0; i < ids.length; i += IN_SHARD) shards.push(ids.slice(i, i + IN_SHARD));

  let total = 0;
  for (let i = 0; i < shards.length; i += SHARD_CONCURRENCY) {
    const parts = await Promise.all(
      shards
        .slice(i, i + SHARD_CONCURRENCY)
        .map((shard) => db.collection(collection).where({ _openid: openid, letter_id: _.in(shard) }).count())
    );
    for (const p of parts) total += p.total;
  }
  return total;
}

exports.main = async (event) => {
  if (event.action !== 'get') return { ok: false, error: 'unknown action' };
  const { OPENID } = cloud.getWXContext();

  try {
    // 封禁校验与在匣信件集合一次并发取回：users 文档本来就要读（注册天数），
    // 旧版先 await isBanned()（同一条 users 查询）再并发，等于同一文档读两遍、多一个往返。
    // 封禁语义不变：判定失败仍按未封禁放行，命中 banned 仍整单拒绝。
    const [ids, users, pinned, recycled] = await Promise.all([
      activeLetterIds(OPENID),
      db.collection('users').where({ _openid: OPENID }).limit(1).get().catch(() => null),
      db.collection('letters').where({ _openid: OPENID, status: 'active', pinned: true }).count(),
      db.collection('letters').where({ _openid: OPENID, status: 'recycled' }).count()
    ]);

    const u = users && users.data[0];
    if (u && u.status === 'banned') return { ok: false, error: 'banned' };

    // 重读 / 回信只算在匣信件的记录：放在封禁判定之后，被封禁的账号不必白算这批分片查询
    const [rereadTotal, replyTotal] = await Promise.all([
      countByLetters('open_records', OPENID, ids),
      countByLetters('reply_records', OPENID, ids)
    ]);

    const registerDays = u && u.created_at
      ? Math.max(1, Math.floor((Date.now() - new Date(u.created_at).getTime()) / 86400000) + 1)
      : 1;

    return {
      ok: true,
      // 信件总数即上面那批 active 信件本身（与 ids 同源，少打一次 count，也杜绝两者不一致）
      letterTotal: ids.length,
      rereadTotal,
      replyTotal,
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
