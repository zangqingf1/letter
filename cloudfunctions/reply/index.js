// 云函数 reply —— 回信（BR-10：用户主动新增，日期服务端生成且接口不提供修改）
// action：add 新增回信 / remove 按 created_at 时间戳撕掉单条回信（物理删除不进废纸篓）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function todayKey() {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}

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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();

  try {
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

      await db.collection('reply_records').add({
        data: {
          _openid: OPENID,
          letter_id: letterId,
          content: String(event.content || ''),
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
    return { ok: false, error: e.message };
  }
};
