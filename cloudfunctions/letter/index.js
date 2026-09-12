// 云函数 letter —— 信件主链路（技术架构文档.md §4.2 / §5.1）
// 数据隔离：一切查询以 openid 为隐式条件，不接受跨用户参数（架构文档 §8）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const crypto = require('crypto');
const db = cloud.database();
const _ = db.command;

// 集合引用放模块作用域：purgeExpired / removeLetterDeep 等 main 外的函数也要用
const letters = db.collection('letters');

const DAY = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 30; // 废纸篓保留期（BR-11）

// 写入上限：与前端常量逐一对齐（write.js NAME_MAX/QUESTION_MAX/ANSWER_MAX、详情回信 maxlength=300）。
// 服务端兜底校验，避免绕过客户端写入超长内容撑大存储。
const NAME_MAX = 20;
const QUESTION_MAX = 500;
const ANSWER_MAX = 2000;
const REPLY_MAX = 300; // 与详情页输入框 maxlength、reply 云函数的 REPLY_MAX 三处一致

// 文本字段校验：仅接受字符串、非空、不超长；合法时返回**原文**（不 trim，
// 遵循「原文存储零加工」产品原则），非法返回 null。
function textField(v, max) {
  if (typeof v !== 'string') return null;
  if (!v.trim() || v.length > max) return null;
  return v;
}

// 旧数据自愈：早期版本 create 漏写 _openid 的历史信件（无归属人），首次被访问时
// 认领给当前用户。只对完全没有 _openid 的文档生效，正式归属数据不受影响。
// 返回该文档当前用户是否可用（认领成功或本就归属当前用户）。
async function ensureOwned(letterDoc, openid, letterId) {
  if (!letterDoc._openid) {
    await letters.doc(letterId).update({ data: { _openid: openid } });
    letterDoc._openid = openid;
    return true;
  }
  return letterDoc._openid === openid;
}

// 封禁拦截：后台把 users.status 置为 'banned' 后，本函数与 user 云函数一致拒绝服务。
// 旧版仅 user.ensure/getProfile 校验，被封禁者绕过客户端即可继续调用其它函数。
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

// 限并发的批量执行（废纸篓到期清理用）：串行在积压时线性变慢，全量并发又会把
// 写请求一次性打满，固定小幅并发兼顾两者。任一失败即抛出，由外层统一响应。
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
  const { OPENID } = cloud.getWXContext();
  const action = event.action;
  try {
    if (await isBanned(OPENID)) return { ok: false, error: 'banned' };
    switch (action) {
      // 单封详情：信件 + 邮戳（重读）+ 回信，一次拼装返回（detail 页一屏所需）
      // 已进废纸篓（status=recycled）的信不再可读（BR-11 只保留恢复能力，不保留阅读入口）
      // record=true：拆信同时落重读记录（BR-09），与邮戳列表读取在同一次调用内完成。
      // 详情页曾先 get 再单独调 open.add，两轮云函数往返串在渲染路径上（数据慢时才出内容）；
      // 合并后详情页只需一轮。分享页预览不传该参数 —— 预览不是拆信，不得产生邮戳。
      case 'get': {
        const res = await letters.doc(event.id).get().catch(() => null);
        const letter = res && res.data;
        if (!letter || !(await ensureOwned(letter, OPENID, event.id))) return { ok: true, letter: null };
        if (letter.status && letter.status !== 'active') return { ok: true, letter: null };
        const [opens, replies] = await Promise.all([
          event.record === true ? stampToday(OPENID, event.id) : listOpens(OPENID, event.id),
          listReplies(OPENID, event.id)
        ]);
        return { ok: true, letter: assemble(letter, opens || [], replies) };
      }

      // 回信：新增 / 撕掉（BR-10 日期服务端生成、接口不提供修改；BR-11 废纸篓内不得新增）。
      // 详情页在本函数内读写回信：拆信时本函数已被调用过（热实例），不必再去叫一个冷启动的
      // 独立函数 —— 原 reply 云函数的 add/remove 保留为旧客户端入口，两边口径必须一致。
      // 归属校验与 get 同一套：只有信件属主能读写它名下的回信。
      case 'addReply':
      case 'removeReply': {
        const doc = await letters.doc(event.id).get().catch(() => null);
        const letter = doc && doc.data;
        if (!letter || !(await ensureOwned(letter, OPENID, event.id))) return { ok: false, error: 'not found' };

        if (action === 'addReply') {
          if (letter.status && letter.status !== 'active') return { ok: false, error: 'letter not active' };
          const content = textField(event.content, REPLY_MAX);
          if (!content) return { ok: false, error: 'content required' };
          await db.collection('reply_records').add({
            data: {
              _openid: OPENID,
              letter_id: event.id,
              content,
              reply_date: todayKey(),
              created_at: db.serverDate()
            }
          });
          return { ok: true, replies: await listReplies(OPENID, event.id) };
        }

        // 撕掉：按创建时间戳精确定位单条（ts 即 listReplies 里 created_at 的毫秒值）。
        // 与 reply 云函数一致，不限制信件状态 —— 旧实现只拦新增，此处保持同一语义。
        const ts = Number(event.ts);
        const all = await db
          .collection('reply_records')
          .where({ _openid: OPENID, letter_id: event.id })
          .limit(1000) // 云数据库 get() 默认只返回 20 条，回信流会被静默截断
          .get();
        const target = all.data.find((r) => stampTs(r) === ts);
        if (!target) return { ok: false, error: 'reply not found' };
        await db.collection('reply_records').doc(target._id).remove();
        return { ok: true, replies: all.data.filter((r) => r._id !== target._id).map(toReply) };
      }

      // 寄出（BR-01 必填由前端校验，服务端再兜底；BR-02 原文存储零加工）
      case 'create': {
        const { theme_id, theme_version, paper_id, paper_version } = event;
        const name = textField(event.name, NAME_MAX);
        const question = textField(event.question, QUESTION_MAX);
        const answer = textField(event.answer, ANSWER_MAX);
        if (!name || !question || !answer) return { ok: false, error: 'name/question/answer required' };
        const now = new Date();
        // 云函数写入不自动补 _openid，必须显式落归属人（today/stats 均按 _openid 查询）
        const res = await letters.add({
          data: {
            _openid: OPENID,
            name,
            question,
            answer,
            theme_id: theme_id || '',
            theme_version: theme_version || 1,
            paper_id: paper_id || 'liubai',
            paper_version: paper_version || 1,
            pinned: false,
            status: 'active',
            created_at: now,
            updated_at: null,
            recycled_at: null,
            purge_at: null,
            today_letter_of: ''
          }
        });
        return { ok: true, id: res._id };
      }

      // 编辑保存（PRD 5.6）：只更新内容/主题/theme_version/信纸版式并记 updated_at；
      // 重读记录与回信是独立集合，天然不受影响
      case 'update': {
        const { id, theme_id, theme_version, paper_id, paper_version } = event;
        const name = textField(event.name, NAME_MAX);
        const question = textField(event.question, QUESTION_MAX);
        const answer = textField(event.answer, ANSWER_MAX);
        if (!name || !question || !answer) return { ok: false, error: 'name/question/answer required' };
        const doc = await letters.doc(id).get().catch(() => null);
        if (!doc || !doc.data || !(await ensureOwned(doc.data, OPENID, event.id))) return { ok: false, error: 'not found' };
        await letters.doc(id).update({
          data: {
            name,
            question,
            answer,
            theme_id: theme_id || doc.data.theme_id,
            theme_version: theme_version || doc.data.theme_version,
            paper_id: paper_id || doc.data.paper_id || 'liubai',
            paper_version: paper_version || doc.data.paper_version || 1,
            updated_at: new Date()
          }
        });
        return { ok: true };
      }

      // 回形针（BR-06：只改排序与角标）
      case 'pin': {
        const doc = await letters.doc(event.id).get().catch(() => null);
        if (!doc || !doc.data || !(await ensureOwned(doc.data, OPENID, event.id))) return { ok: false, error: 'not found' };
        await letters.doc(event.id).update({ data: { pinned: !!event.pinned } });
        return { ok: true, pinned: !!event.pinned };
      }

      // 删除 → 废纸篓（BR-11）：信件原样保留，只置状态与保留期时间
      case 'moveToRecycle': {
        const doc = await letters.doc(event.id).get().catch(() => null);
        if (!doc || !doc.data || !(await ensureOwned(doc.data, OPENID, event.id))) return { ok: false, error: 'not found' };
        const now = new Date();
        await letters.doc(event.id).update({
          data: {
            status: 'recycled',
            recycled_at: now,
            purge_at: new Date(now.getTime() + KEEP_DAYS * DAY),
            today_letter_of: ''
          }
        });
        return { ok: true };
      }

      // 废纸篓列表：兜底清理满 30 天的信（cleaner 定时任务为主，此处第二条通道）。
      // 清理与列表查询互不依赖 —— 并发执行，再按 purge_at 过滤掉本次正在清理的那几封；
      // 旧版先 await 清理再查列表，积压时会把清理耗时串行压进列表首屏。
      case 'listRecycle': {
        const now = Date.now();
        const [, res] = await Promise.all([
          purgeExpired(OPENID),
          letters
            .where({ _openid: OPENID, status: 'recycled' })
            .orderBy('recycled_at', 'desc')
            .limit(1000) // 云数据库 get() 默认只返回 20 条，必须显式放大
            .get()
        ]);
        return {
          ok: true,
          items: res.data
            .filter((l) => !(l.purge_at && new Date(l.purge_at).getTime() <= now))
            .map((l) => ({
              id: l._id,
              name: l.name,
              theme_id: l.theme_id,
              deleted_at: new Date(l.recycled_at).getTime()
            }))
        };
      }

      // 取回：原样恢复（含重读记录与回信 —— 独立集合未动，即原样恢复）
      case 'restore': {
        const doc = await letters.doc(event.id).get().catch(() => null);
        if (!doc || !doc.data || !(await ensureOwned(doc.data, OPENID, event.id))) return { ok: false, error: 'not found' };
        await letters.doc(event.id).update({
          data: { status: 'active', recycled_at: null, purge_at: null }
        });
        return { ok: true };
      }

      // 彻底删除（BR-12：物理删除不可恢复，含其重读记录与回信）
      case 'purge': {
        const doc = await letters.doc(event.id).get().catch(() => null);
        if (!doc || !doc.data || !(await ensureOwned(doc.data, OPENID, event.id))) return { ok: false, error: 'not found' };
        await removeLetterDeep(OPENID, event.id);
        return { ok: true };
      }

      default:
        return { ok: false, error: 'unknown action: ' + action };
    }
  } catch (e) {
    // 错误详情只进日志：不回传 DB/SDK 原始 message（集合名等便于侦察）
    console.error('[letter] action 失败', action, e);
    return { ok: false, error: 'internal error' };
  }
};

async function listOpenRows(openid, letterId) {
  const res = await db
    .collection('open_records')
    .where({ _openid: openid, letter_id: letterId })
    .orderBy('created_at', 'asc')
    .limit(1000) // 云数据库 get() 默认只返回 20 条，邮戳墙会被静默截断
    .get();
  return res.data;
}

async function listOpens(openid, letterId) {
  return (await listOpenRows(openid, letterId)).map(stampTs);
}

function stampTs(row) {
  return new Date(row.created_at).getTime();
}

function dateKeyOf(d) {
  const n = new Date(d);
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}

function todayKey() {
  return dateKeyOf(new Date());
}

// 拆信重读（BR-09）：与 open 云函数同一套幂等口径 —— 今日已有邮戳（含早期随机 _id 的旧记录，
// 按 created_at 回落判断）直接返回现有列表，否则以确定性 _id 写入，并发同投时第二条主键冲突被忽略。
// 失败一律不上抛：记不上邮戳只应表现为「今天这枚没记上」，不该让整封信读不出来。
async function stampToday(openid, letterId) {
  const openDate = todayKey();
  try {
    const rows = await listOpenRows(openid, letterId);
    if (rows.some((r) => r.open_date === openDate || dateKeyOf(r.created_at) === openDate)) {
      return rows.map(stampTs);
    }
    const _id = crypto.createHash('md5').update(openid + '|' + letterId + '|' + openDate).digest('hex');
    try {
      await db.collection('open_records').add({
        data: { _id, _openid: openid, letter_id: letterId, open_date: openDate, created_at: db.serverDate() }
      });
      return rows.map(stampTs).concat([Date.now()]);
    } catch (e) {
      // 主键冲突（并发同投）或写入失败：以服务端事实为准重查，避免邮戳墙少一枚
      console.warn('[letter] 邮戳写入未成功，改读服务端记录', e && e.message);
      return (await listOpenRows(openid, letterId)).map(stampTs);
    }
  } catch (e) {
    console.error('[letter] 重读记录失败，仅影响邮戳墙', e);
    return null;
  }
}

async function listReplies(openid, letterId) {
  const res = await db
    .collection('reply_records')
    .where({ _openid: openid, letter_id: letterId })
    .orderBy('created_at', 'asc')
    .limit(1000) // 云数据库 get() 默认只返回 20 条，回信流会被静默截断
    .get();
  return res.data.map(toReply);
}

// 回信行 → 前端形状（ts 即 created_at 毫秒值，撕掉按它精确定位单条）
function toReply(row) {
  return { ts: stampTs(row), text: row.content };
}

function assemble(letter, opens, replies) {
  // 只回传页面所需字段：旧版 Object.assign({}, letter, ...) 会把 _openid 等内部字段一并下发，
  // 既属信息泄露，也让客户端拿到自己的 openid（可被用于伪造发货推送等场景）。
  return {
    id: letter._id,
    name: letter.name,
    question: letter.question,
    answer: letter.answer,
    theme_id: letter.theme_id,
    theme_version: letter.theme_version,
    paper_id: letter.paper_id,
    paper_version: letter.paper_version,
    pinned: !!letter.pinned,
    created_at: new Date(letter.created_at).getTime(),
    updated_at: letter.updated_at ? new Date(letter.updated_at).getTime() : null,
    opens,
    replies
  };
}

async function purgeExpired(openid) {
  const res = await letters
    .where({ _openid: openid, status: 'recycled', purge_at: _.lte(new Date()) })
    .limit(1000) // 云数据库 get() 默认只返回 20 条，积压时每次只清 20 封
    .get();
  // 逐封串行会在积压时线性变慢；限制并发逐封清理，避免一次并发过多写请求
  await eachLimited(res.data, 5, (l) => removeLetterDeep(openid, l._id));
}

async function removeLetterDeep(openid, letterId) {
  // 三个集合互不依赖，一次并发删除（旧版逐个 await，单封就要三个串行往返）
  await Promise.all([
    letters.doc(letterId).remove(),
    db.collection('open_records').where({ _openid: openid, letter_id: letterId }).remove(),
    db.collection('reply_records').where({ _openid: openid, letter_id: letterId }).remove()
  ]);
}
