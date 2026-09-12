// 云函数 analytics —— 埋点批量入库（技术架构文档.md §7）
// events 集合；事件名以 PRD 第十三节为准。不采集信件正文。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 封禁拦截：后台把 users.status 置为 'banned' 后，本函数与 user 云函数一致拒绝服务。
// 查询失败按「未封禁」处理（可用性优先；封禁属运营管控，不作为数据安全边界）。
async function isBanned(openid) {
  if (!openid) return false;
  try {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
    return !!(res.data[0] && res.data[0].status === 'banned');
  } catch (e) {
    console.error('[ban] users 查询失败，按未封禁处理', e);
    return false;
  }
}

// 限并发的批量执行：单批最多 50 条写请求，全量并发容易打满云函数出网连接，
// 串行又慢；固定 8 路并发取得稳定的吞吐/成功率平衡。任一失败即抛出，由外层统一响应。
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

exports.main = async (event) => {
  if (event.action !== 'batch') return { ok: false, error: 'unknown action' };
  const { OPENID } = cloud.getWXContext();
  const events = Array.isArray(event.events) ? event.events.slice(0, 50) : [];

  try {
    if (await isBanned(OPENID)) return { ok: false, error: 'banned' };
    // 先做纯 CPU 的字段归一化，再限并发落库。
    // 旧版在 for 里逐条 await add：单批最多 50 条 = 最坏 50 个串行往返（埋点是最热的写路径）。
    const docs = [];
    for (const ev of events) {
      // 事件名与 props 均做上限约束：旧版原样入库，可写入任意嵌套对象/超长文本撑大存储。
      // 埋点不采集正文，故 props 只接受浅层、值为标量的键值对。
      const name = typeof ev.name === 'string' ? ev.name.slice(0, 64) : '';
      if (!name) continue;
      const props = ev.props && typeof ev.props === 'object' && !Array.isArray(ev.props) ? ev.props : {};
      const safeProps = {};
      let budget = 1024;
      for (const k of Object.keys(props)) {
        if (k.length > 40) continue;
        const v = props[k];
        if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue;
        const cost = k.length + String(v).length;
        if (cost > budget) break;
        budget -= cost;
        safeProps[k] = v;
      }
      const ts = ev.client_ts ? new Date(ev.client_ts) : null;
      docs.push({
        _openid: OPENID,
        name,
        props: safeProps,
        client_ts: ts && !isNaN(ts.getTime()) ? ts : null,
        created_at: db.serverDate()
      });
    }
    await eachLimited(docs, 8, (doc) => db.collection('events').add({ data: doc }));
    return { ok: true, saved: events.length };
  } catch (e) {
    // 错误详情只进日志：不回传 DB/SDK 原始 message
    console.error('[analytics] batch 失败', e);
    return { ok: false, error: 'internal error' };
  }
};
