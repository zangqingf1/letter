// 云函数 analytics —— 埋点批量入库（技术架构文档.md §7）
// events 集合；事件名以 PRD 第十三节为准。不采集信件正文。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  if (event.action !== 'batch') return { ok: false, error: 'unknown action' };
  const { OPENID } = cloud.getWXContext();
  const events = Array.isArray(event.events) ? event.events.slice(0, 50) : [];

  try {
    for (const ev of events) {
      await db.collection('events').add({
        data: {
          _openid: OPENID,
          name: String(ev.name || ''),
          props: ev.props || {},
          client_ts: ev.client_ts ? new Date(ev.client_ts) : null,
          created_at: db.serverDate()
        }
      });
    }
    return { ok: true, saved: events.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
