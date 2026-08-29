// 云函数 reply —— 回信（BR-10：用户主动新增，日期服务端生成且接口不提供修改）
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
    // BR-11：废纸篓内的信件不可新增回信
    if (letter.data.status !== 'active') {
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

    const all = await db
      .collection('reply_records')
      .where({ _openid: OPENID, letter_id: letterId })
      .orderBy('created_at', 'asc')
      .get();
    return {
      ok: true,
      replies: all.data.map((r) => ({ ts: new Date(r.created_at).getTime(), text: r.content }))
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
