// 云函数 open —— 拆信重读记录（BR-09，技术架构文档.md §4.3）
// 服务端按 (openid, letter_id, open_date) 幂等去重：同日重复拆信只记一条。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const crypto = require('crypto');
const db = cloud.database();

function todayKey() {
  const n = new Date();
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
  if (event.action !== 'add') return { ok: false, error: 'unknown action' };

  try {
    if (await isBanned(OPENID)) return { ok: false, error: 'banned' };
    const letterId = event.letter_id;
    // 信件归属校验与「今日是否已记录」互不依赖，一次并发取回（旧版串行，多一个往返）。
    // 去重查询按 (openid, letter_id, open_date) 自限，与信件归属无因果关系，提前发出无副作用。
    const openDate = todayKey();
    const [letter, dup] = await Promise.all([
      db.collection('letters').doc(letterId).get().catch(() => null),
      db
        .collection('open_records')
        .where({ _openid: OPENID, letter_id: letterId, open_date: openDate })
        .count()
    ]);
    if (!letter || !letter.data) {
      return { ok: false, error: 'not found' };
    }
    // 旧数据自愈：无 _openid 的遗留信件认领给当前用户（与 letter/today 云函数 ensureOwned 同策略）
    if (!letter.data._openid) {
      await db.collection('letters').doc(letterId).update({ data: { _openid: OPENID } });
    } else if (letter.data._openid !== OPENID) {
      return { ok: false, error: 'not found' };
    }

    if (dup.total === 0) {
      // 确定性 _id：并发同投时第二条 add 会主键冲突而失败，修掉「先查后写」竞态导致的重复邮戳。
      // 保留上方 count 判断是为兼容历史随机 _id 的旧记录。
      const recordId = crypto.createHash('md5').update(OPENID + '|' + letterId + '|' + openDate).digest('hex');
      try {
        await db.collection('open_records').add({
          data: {
            _id: recordId,
            _openid: OPENID,
            letter_id: letterId,
            open_date: openDate,
            created_at: db.serverDate()
          }
        });
      } catch (e) {
        // 已存在（并发重复请求）：幂等，忽略
        console.warn('[open] 邮戳已存在，忽略重复写入', e && e.message);
      }
    }

    const all = await db
      .collection('open_records')
      .where({ _openid: OPENID, letter_id: letterId })
      .orderBy('created_at', 'asc')
      .limit(1000) // 云数据库 get() 默认只返回 20 条，邮戳墙会被静默截断
      .get();
    return {
      ok: true,
      opens: all.data.map((r) => new Date(r.created_at).getTime())
    };
  } catch (e) {
    // 错误详情只进日志：不回传 DB/SDK 原始 message
    console.error('[open] add 失败', e);
    return { ok: false, error: 'internal error' };
  }
};
