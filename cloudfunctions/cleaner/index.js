// 云函数 cleaner —— 废纸篓 30 天到期清理（BR-11/BR-12，技术架构文档.md §5.1）
// 定时触发器：每日 03:00（config.json）；物理删除到期信件及其重读记录与回信。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 限并发的批量清理：串行在积压时线性变慢，全量并发又会把写请求一次性打满。
// 定时任务对延迟不敏感，取保守的 5 路并发。
async function eachLimited(items, limit, fn) {
  let cursor = 0;
  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i += 1) {
    workers.push(
      (async () => {
        while (cursor < items.length) {
          const idx = cursor;
          cursor += 1;
          await fn(items[idx]);
        }
      })()
    );
  }
  await Promise.all(workers);
}

exports.main = async () => {
  // 只允许定时触发器调用：触发器调用上下文不带用户 OPENID，而小程序端 wx.cloud.callFunction
  // 必然带 OPENID。旧版无任何校验，任意客户端都能触发一次全库到期清理（全局越权写）。
  // 即便此判断失效，清理范围也仅限已过 30 天保留期、本就该删的信件，且 letter.listRecycle 有兜底。
  const { OPENID } = cloud.getWXContext();
  if (OPENID) {
    console.warn('[cleaner] 拒绝来自客户端的调用 openid=', OPENID);
    return { ok: false, error: 'forbidden' };
  }
  try {
    const res = await db
      .collection('letters')
      .where({ status: 'recycled', purge_at: _.lte(new Date()) })
      .limit(1000) // 云数据库 get() 默认只返回 20 条，积压时单次最多清 20 封
      .get();

    let purged = 0;
    await eachLimited(res.data, 5, async (letter) => {
      // 一封信的三个集合互不依赖：并发删除（旧版单封信内也是三个串行往返）
      await Promise.all([
        db.collection('letters').doc(letter._id).remove(),
        db.collection('open_records').where({ letter_id: letter._id }).remove(),
        db.collection('reply_records').where({ letter_id: letter._id }).remove()
      ]);
      purged += 1;
    });
    return { ok: true, purged };
  } catch (e) {
    // 错误详情只进日志：不回传 DB/SDK 原始 message
    console.error('[cleaner] 清理失败', e);
    return { ok: false, error: 'internal error' };
  }
};
