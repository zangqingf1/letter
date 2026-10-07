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
  if (event.action !== 'mailbox') return { ok: false, error: 'unknown action' };

  try {
    if (await isBanned(OPENID)) return { ok: false, error: 'banned' };
    const today = todayKey();

    // BR-08：草稿不进网格、不参与今日来信随机；首页草稿横条只需数量。
    // 草稿计数、封禁检查与信件列表互不依赖，一次并发取回（封禁检查原先串行挡在
    // 最前面，多付一次 DB 往返；封禁属运营管控非安全边界，晚几毫秒返回无碍）。
    // 信件查询加 field 投影：网格只需要 5 个字段，不把 answer（单封可达 2000 字）、
    // replies、opens 拉进函数内存 —— 100 封信匣时少传输约 90% 的文档体积。
    const [banned, draftRes, res] = await Promise.all([
      isBanned(OPENID),
      db.collection('drafts').where({ _openid: OPENID }).count(),
      db
        .collection('letters')
        .where({ _openid: OPENID, status: 'active' })
        .orderBy('created_at', 'desc')
        .limit(100)
        .field({ _id: true, name: true, theme_id: true, pinned: true, created_at: true, today_letter_of: true })
        .get()
    ]);
    if (banned) return { ok: false, error: 'banned' };
    const draftCount = draftRes.total;
    let all = res.data;

    // 旧数据自愈：早期版本 create 漏写 _openid 的信件按 openid 永远查不到（联调期遗留），
    // 这里把无归属人的信认领给当前用户，与 letter 云函数 ensureOwned 同策略。
    // 门槛：仅在当前用户信匣为空时执行 —— 孤儿信的主人信匣必为空，认领后即非空不再进入；
    // 避免每次拉信匣都对全库做一次无 openid 条件的全表扫描
    if (all.length === 0) {
      try {
        const meRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get();
        const myCreatedAt =
          meRes.data[0] && meRes.data[0].created_at ? new Date(meRes.data[0].created_at).getTime() : 0;
        // 仅认领「写于本账号建档之后」的孤儿信：账号必然先于自己写的信存在，
        // 因此新建的陌生账号无法再一次性认领历史遗留信件（旧版无此约束，是跨用户认领入口）。
        if (myCreatedAt) {
          const orphanRes = await db
            .collection('letters')
            .where({ status: 'active', _openid: _.or(_.eq(null), _.exists(false)) })
            .limit(100)
            .get();
          for (const doc of orphanRes.data) {
            const t = doc.created_at ? new Date(doc.created_at).getTime() : 0;
            if (!t || myCreatedAt > t) continue;
            await db.collection('letters').doc(doc._id).update({ data: { _openid: OPENID } });
            doc._openid = OPENID;
            all = all.concat(doc);
          }
        }
      } catch (e) {
        console.error('[today] 孤儿信认领失败', e);
      }
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
    // 错误详情只进日志：不回传 DB/SDK 原始 message
    console.error('[today] mailbox 失败', e);
    return { ok: false, error: 'internal error' };
  }
};
