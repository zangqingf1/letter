// 云函数 reply —— 回信（BR-10：用户主动新增，日期服务端生成且接口不提供修改）
// action：add 新增回信 / remove 按 created_at 时间戳撕掉单条回信（物理删除不进废纸篓）
//
// 说明：详情页已改走 letter 云函数的 addReply/removeReply —— 拆信时 letter 必然已被调用过
// （热实例），省掉本函数每次会话首次写回信时的冷启动。本函数保留为独立入口（旧客户端仍在用），
// 与 letter 里那份实现必须保持同一口径：同一条回信两边都能读到、都能按 ts 撕掉。
// 改动任一份都要同步另一份（回归用例见 tests/suites/data-rules.test.js「回信 · 两个写入入口」）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function todayKey() {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}

// 回信正文上限：与详情页输入框 maxlength=300 对齐（服务端兜底，防绕过客户端写超长内容）
const REPLY_MAX = 300;

// 校验信件归属（旧数据无 _openid 时认领给当前用户，与 letter/today 云函数 ensureOwned 同策略）
async function ensureOwned(letterId, OPENID) {
  const letter = await db.collection('letters').doc(letterId).get().catch(() => null);
  if (!letter || !letter.data) return null;
  if (!letter.data._openid) {
    await db.collection('letters').doc(letterId).update({ data: { _openid: OPENID } });
  } else if (letter.data._openid !== OPENID) {
    return null;
  }
  return letter.data;
}

async function listReplies(OPENID, letterId) {
  // 云数据库 get() 默认只返回 20 条，回信流会被静默截断，显式拉满
  const all = await db
    .collection('reply_records')
    .where({ _openid: OPENID, letter_id: letterId })
    .orderBy('created_at', 'asc')
    .limit(1000)
    .get();
  return all.data.map((r) => ({ ts: new Date(r.created_at).getTime(), text: r.content }));
}

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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();

  try {
    if (await isBanned(OPENID)) return { ok: false, error: 'banned' };
    const letterId = event.letter_id;
    const letterData = await ensureOwned(letterId, OPENID);
    if (!letterData) {
      return { ok: false, error: 'not found' };
    }

    if (event.action === 'add') {
      // BR-11：废纸篓内的信件不可新增回信
      if (letterData.status !== 'active') {
        return { ok: false, error: 'letter not active' };
      }
      // 仅接受非空字符串且不超长；原文存储不过度加工（仅去掉首尾空白用于空值判断）
      const content = typeof event.content === 'string' ? event.content : '';
      if (!content.trim()) return { ok: false, error: 'content required' };
      if (content.length > REPLY_MAX) return { ok: false, error: 'content too long' };

      await db.collection('reply_records').add({
        data: {
          _openid: OPENID,
          letter_id: letterId,
          content,
          reply_date: todayKey(),
          created_at: db.serverDate()
        }
      });

      return { ok: true, replies: await listReplies(OPENID, letterId) };
    }

    if (event.action === 'remove') {
      // 按创建时间戳定位单条回信（ts 即 listReplies 里 created_at 的毫秒值）
      const ts = Number(event.ts);
      const all = await db
        .collection('reply_records')
        .where({ _openid: OPENID, letter_id: letterId })
        .limit(1000)
        .get();
      const target = all.data.find((r) => new Date(r.created_at).getTime() === ts);
      if (!target) {
        return { ok: false, error: 'reply not found' };
      }
      await db.collection('reply_records').doc(target._id).remove();
      return {
        ok: true,
        replies: all.data
          .filter((r) => r._id !== target._id)
          .map((r) => ({ ts: new Date(r.created_at).getTime(), text: r.content }))
      };
    }

    return { ok: false, error: 'unknown action' };
  } catch (e) {
    // 错误详情只进日志：不回传 DB/SDK 原始 message
    console.error('[reply] 处理失败', e);
    return { ok: false, error: 'internal error' };
  }
};
