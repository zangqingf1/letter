// 云函数 letter —— 信件主链路（技术架构文档.md §4.2 / §5.1）
// 数据隔离：一切查询以 openid 为隐式条件，不接受跨用户参数（架构文档 §8）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 集合引用放模块作用域：purgeExpired / removeLetterDeep 等 main 外的函数也要用
const letters = db.collection('letters');

const DAY = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 30; // 废纸篓保留期（BR-11）

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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action;

  try {
    switch (action) {
      // 单封详情：信件 + 邮戳（重读）+ 回信，一次拼装返回（detail 页一屏所需）
      // 已进废纸篓（status=recycled）的信不再可读（BR-11 只保留恢复能力，不保留阅读入口）
      case 'get': {
        const res = await letters.doc(event.id).get().catch(() => null);
        const letter = res && res.data;
        if (!letter || !(await ensureOwned(letter, OPENID, event.id))) return { ok: true, letter: null };
        if (letter.status && letter.status !== 'active') return { ok: true, letter: null };
        const [opens, replies] = await Promise.all([listOpens(OPENID, event.id), listReplies(OPENID, event.id)]);
        return { ok: true, letter: assemble(letter, opens, replies) };
      }

      // 寄出（BR-01 必填由前端校验，服务端再兜底；BR-02 原文存储零加工）
      case 'create': {
        const { name, question, answer, theme_id, theme_version, paper_id, paper_version } = event;
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
            paper_id: paper_id || 'su',
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
        const { id, name, question, answer, theme_id, theme_version, paper_id, paper_version } = event;
        const doc = await letters.doc(id).get().catch(() => null);
        if (!doc || !doc.data || !(await ensureOwned(doc.data, OPENID, event.id))) return { ok: false, error: 'not found' };
        await letters.doc(id).update({
          data: {
            name,
            question,
            answer,
            theme_id: theme_id || doc.data.theme_id,
            theme_version: theme_version || doc.data.theme_version,
            paper_id: paper_id || doc.data.paper_id || 'su',
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

      // 废纸篓列表：先自愈式清理满 30 天的信（cleaner 定时任务为主，此处兜底）
      case 'listRecycle': {
        await purgeExpired(OPENID);
        const res = await letters
          .where({ _openid: OPENID, status: 'recycled' })
          .orderBy('recycled_at', 'desc')
          .limit(1000) // 云数据库 get() 默认只返回 20 条，必须显式放大
          .get();
        return {
          ok: true,
          items: res.data.map((l) => ({
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
    return { ok: false, error: e.message };
  }
};

async function listOpens(openid, letterId) {
  const res = await db
    .collection('open_records')
    .where({ _openid: openid, letter_id: letterId })
    .orderBy('created_at', 'asc')
    .limit(1000) // 云数据库 get() 默认只返回 20 条，邮戳墙会被静默截断
    .get();
  return res.data.map((r) => new Date(r.created_at).getTime());
}

async function listReplies(openid, letterId) {
  const res = await db
    .collection('reply_records')
    .where({ _openid: openid, letter_id: letterId })
    .orderBy('created_at', 'asc')
    .limit(1000) // 云数据库 get() 默认只返回 20 条，回信流会被静默截断
    .get();
  return res.data.map((r) => ({ ts: new Date(r.created_at).getTime(), text: r.content }));
}

function assemble(letter, opens, replies) {
  return Object.assign({}, letter, {
    id: letter._id,
    created_at: new Date(letter.created_at).getTime(),
    updated_at: letter.updated_at ? new Date(letter.updated_at).getTime() : null,
    opens,
    replies
  });
}

async function purgeExpired(openid) {
  const res = await letters
    .where({ _openid: openid, status: 'recycled', purge_at: _.lte(new Date()) })
    .get();
  for (const l of res.data) {
    await removeLetterDeep(openid, l._id);
  }
}

async function removeLetterDeep(openid, letterId) {
  await letters.doc(letterId).remove();
  await db.collection('open_records').where({ _openid: openid, letter_id: letterId }).remove();
  await db.collection('reply_records').where({ _openid: openid, letter_id: letterId }).remove();
}
