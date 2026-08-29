// 云函数 today —— 信匣聚合 + 今日来信（BR-07，技术架构文档.md §5.2）
// 今日来信在服务端按「用户 + 日期」确定性生成并落库，跨设备同日结果一致。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function todayKey(d) {
  const n = d || new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (event.action !== 'mailbox') return { ok: false, error: 'unknown action' };

  try {
    const today = todayKey();

    // BR-08：草稿不进网格、不参与今日来信随机；首页草稿横条只需数量
    const draftCount = (await db.collection('drafts').where({ _openid: OPENID }).count()).total;

    const res = await db
      .collection('letters')
      .where({ _openid: OPENID, status: 'active' })
      .orderBy('created_at', 'desc')
      .limit(100)
      .get();
    let all = res.data;

    // 旧数据自愈：早期版本 create 漏写 _openid 的信件按 openid 永远查不到（联调期遗留），
    // 这里把无归属人的信认领给当前用户，与 letter 云函数 ensureOwned 同策略；
    // 自愈失败（如查询命令不支持）不影响正常信匣读取
    try {
      const orphanRes = await db
        .collection('letters')
        .where({ status: 'active', _openid: _.or(_.eq(null), _.exists(false)) })
        .limit(100)
        .get();
      for (const doc of orphanRes.data) {
        await db.collection('letters').doc(doc._id).update({ data: { _openid: OPENID } });
        doc._openid = OPENID;
        all = all.concat(doc);
      }
    } catch (e) {
      console.error('[today] 孤儿信认领失败', e);
    }

    // 1. 当日已选定 → 直接命中（当日固定）
    let todayLetter = all.find((l) => l.today_letter_of === today) || null;

    // 2. 未命中：确定性随机选一封并写回（并发重复请求因种子一致而收敛为同一封）
    if (!todayLetter && all.length > 0) {
      const stable = all.slice().sort((a, b) => String(a._id).localeCompare(String(b._id)));
      const n = new Date();
      const seed = n.getFullYear() * 366 + (n.getMonth() + 1) * 31 + n.getDate();
      todayLetter = stable[seed % stable.length];
      await db.collection('letters').doc(todayLetter._id).update({ data: { today_letter_of: today } });
    }

    const letters = all.map((l) => ({
      id: l._id,
      name: l.name,
      theme_id: l.theme_id,
      pinned: !!l.pinned,
      created_at: new Date(l.created_at).getTime()
    }));

    return {
      ok: true,
      letters,
      draftCount,
      todayId: todayLetter ? todayLetter._id : ''
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
