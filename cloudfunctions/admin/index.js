// 云函数 admin —— Web 后台管理系统唯一后端入口（技术架构文档.md「Web 后台」一节）
// 鉴权：环境变量 ADMIN_KEY（在 CloudBase 控制台配置）；Web 端每次请求携带 event.key 比对，
// 未配置密钥时默认拒绝全部请求（fail closed）。
// 隐私红线（产品原则「内容属于用户」）：本函数任何 action 都不读取信件正文——
// letters 只做 count 聚合、userList/userDetail 显式 field projection，永不返回
// name/question/answer 与回信 content。改动时必须维持这条红线。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

const TZ = '+0800';
const DAY = 86400000;

// ── 官方默认配置 seed（与 miniprogram/pages/write/themes.js / papers.js 同源手工同步）──
// 仅 xiaowangzi 有信封素材（小程序包内路径）；其余主题无素材，由 theme 服务回落默认信封。
const SEED_THEMES = [
  { theme_id: 'xiaowangzi', name: '小王子', desc: '温柔童话', version: 2, swatch: '', palette: { base: '#F9F3E4', title: '#5A4F3E', text: '#4A4438', tag: '#9A9284' }, desk: '#EDE9DC', assets: { envelope: '/assets/theme/xiaowangzi/envelope.jpg', envelopeThumb: '/assets/theme/xiaowangzi/envelope-thumb.jpg' } },
  { theme_id: 'chenyu', name: '晨光', desc: '温暖明亮', version: 1, swatch: '#F3EADB', palette: { base: '#F3EADB', title: '#5A4F3E', text: '#4A4438', tag: '#9A9284' }, desk: '#EFE6D3', assets: {} },
  { theme_id: 'yuye', name: '雨夜', desc: '安静陪伴', version: 1, swatch: '#C4CBD3', palette: { base: '#DDE2E6', title: '#4C5560', text: '#3E4750', tag: '#8A939C' }, desk: '#D4DADF', assets: {} },
  { theme_id: 'niupizhi', name: '牛皮纸', desc: '朴实有趣', version: 1, swatch: '#D8C4A4', palette: { base: '#E7D9BC', title: '#6B5636', text: '#57462C', tag: '#9C8B6C' }, desk: '#DCD0B2', assets: {} },
  { theme_id: 'mianma', name: '棉麻', desc: '极简高级', version: 1, swatch: '#E3DECF', palette: { base: '#EBE7DA', title: '#5C594C', text: '#4C4A40', tag: '#98948A' }, desk: '#E0DCCB', assets: {} },
  { theme_id: 'huajian', name: '花笺', desc: '柔美治愈', version: 1, swatch: '#E7CFCB', palette: { base: '#F1DFDB', title: '#6E514C', text: '#5C443F', tag: '#AB8B85' }, desk: '#E8D3CE', assets: {} },
  { theme_id: 'kafeizi', name: '咖啡渍', desc: '手账有趣', version: 1, swatch: '#CBB693', palette: { base: '#E4D8BE', title: '#66543A', text: '#52442C', tag: '#9D8F73' }, desk: '#D8CBB0', assets: {} }
];

// 十款信纸版式：后台只管名称/描述/配色/上下架/排序/版本；版式视觉结构在
// 小程序代码三端同构（styles/paper.wxml + paper.wxss + share.js drawXxxStyle），
// 新增版式结构必须改代码发版，后台无法凭空创建。
const SEED_PAPERS = [
  { paper_id: 'liubai', name: '留白志', desc: '编辑部极简 · 短线页脚', version: 1, colors: { bg: '#FEFEFC', ink: '#33302A', deep: '#1D1B17', gray: '#8A8478', faint: '#B3AC9C', fainter: '#A29B8A', line: '#ECE8DE', date: '#6E695E' } },
  { paper_id: 'extra', name: '号外头版', desc: '报纸头版 · 首字下沉', version: 1, colors: { bg: '#F5EFDE', ink: '#262219', deep: '#1E1B14', sub: '#5A5240', accent: '#A33B24', faint: '#B9AE93' } },
  { paper_id: 'blueprint', name: '工程蓝图', desc: '白线网格 · 标题栏落日期', version: 1, colors: { bg: '#16324F', line: '#EAF2F8', title: '#FFFFFF', body: '#EAF2F8', q: '#C9DCEA', accent: '#9CC4E4', grid: 'rgba(234,242,248,0.10)' } },
  { paper_id: 'ticket', name: '存根票根', desc: '凭证票面 · 条码编号', version: 1, colors: { bg: '#F6EDDC', ink: '#2E2A26', deep: '#26221D', accent: '#C2452D', sub: '#8A6A5A', gray: '#6E675C', divider: '#C9BBA0' } },
  { paper_id: 'poster', name: '大字标语', desc: '海报直给 · 描边水印方章', version: 1, colors: { bg: '#F0E9DA', ink: '#221E18', deep: '#17140F', red: '#B5342A', cream: '#F5EFE0', gray: '#6E6552', wm: 'rgba(150,132,96,0.30)' } },
  { paper_id: 'bauhaus', name: '包豪斯几何', desc: '红圆蓝角黄块', version: 1, colors: { bg: '#FAF7EF', ink: '#17150F', red: '#D9402A', blue: '#1F4FA0', yellow: '#E8B33C', gray: '#5C584C' } },
  { paper_id: 'vinyl', name: '黑胶唱片', desc: '暗纸盘芯 · 深夜重读', version: 1, colors: { bg: '#1B1A1C', text: '#D9D2C4', bright: '#F0E9D8', accent: '#C24A2E', gray: '#9C9484', dim: '#6E685C' } },
  { paper_id: 'suwen', name: '素问笺', desc: '问答朱印对帖 · 斜盖邮戳', version: 1, colors: { bg: '#FAF7F0', ink: '#3B372F', deep: '#2E2B25', accent: '#A63B2A', line: '#D8D2C2', gray: '#6B6557' } },
  { paper_id: 'moye', name: '墨夜笺', desc: '暗夜纸面 · 暖金细线', version: 1, colors: { bg: '#1D2027', bg1: '#2A2F3A', bg2: '#22262E', bg3: '#1D2027', text: '#DDD6C6', bright: '#F0E9D8', gold: '#C6A870', goldDim: 'rgba(198,168,112,0.45)', goldFaint: 'rgba(198,168,112,0.28)', gray: '#B4AD9D' } },
  { paper_id: 'airmail2', name: '航空笺', desc: '全幅斜纹画框 · 邮票邮戳', version: 1, colors: { bg: '#FCFBF4', stripe1: '#C2452D', stripe2: '#F3EFE2', stripe3: '#33557E', ink: '#22303E', red: '#C2452D', blue: '#33557E', qGray: '#6B7B8A', aBlue: '#29405A', tan: '#A8A18C', dash: '#C9C2AC', stampPaper: '#F4F0E1', stampLine: '#CFC8B2' } }
];

// 管理员密钥：优先读环境变量 ADMIN_KEY；若控制台配不了环境变量，把 FALLBACK_KEY
// 改成你的强密钥并重新部署即可（两者都不配置时拒绝一切请求）。
const FALLBACK_KEY = 'hb-9x7k2m-qwer8765';

function checkKey(event) {
  const key = process.env.ADMIN_KEY || FALLBACK_KEY;
  if (!key) return false;
  return typeof event.key === 'string' && event.key === key;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

// 按 idKey upsert 一条主题/版式文档
async function upsertConfig(coll, idKey, data) {
  const now = new Date();
  const doc = Object.assign(pick(data, [idKey, 'name', 'desc', 'version', 'status', 'sort', 'swatch', 'palette', 'desk', 'colors']), {
    updated_at: now
  });
  if (idKey === 'theme_id') doc.assets = data.assets || {};
  const found = await db.collection(coll).where({ [idKey]: data[idKey] }).limit(1).get();
  if (found.data.length) {
    await db.collection(coll).doc(found.data[0]._id).update({ data: doc });
    return { id: found.data[0]._id, updated: true };
  }
  doc.created_at = now;
  const added = await db.collection(coll).add({ data: doc });
  return { id: added._id, updated: false };
}

// 按天聚合某集合的 created_at（东八区日期串）
async function countByDay(coll, since) {
  const res = await db
    .collection(coll)
    .aggregate()
    .match({ created_at: _.gte(since) })
    .addFields({ day: $.dateToString({ date: '$created_at', format: '%Y-%m-%d', timezone: TZ }) })
    .group({ _id: '$day', count: $.sum(1) })
    .end();
  const map = {};
  for (const row of res.list) map[row._id] = row.count;
  return map;
}

// 近 N 天的日期串列表（今天起倒推，东八区）
function dayKeys(days) {
  const keys = [];
  const nowCn = Date.now() + 8 * 3600000;
  for (let i = 0; i < days; i++) {
    keys.push(new Date(nowCn - i * DAY).toISOString().slice(0, 10));
  }
  return keys.reverse();
}

// 一批 openid 在指定集合里的条数（不取任何内容字段）
async function countByOpenid(coll, openIds) {
  if (!openIds.length) return {};
  const res = await db
    .collection(coll)
    .aggregate()
    .match({ _openid: _.in(openIds) })
    .group({ _id: '$_openid', count: $.sum(1) })
    .end();
  const map = {};
  for (const row of res.list) map[row._id] = row.count;
  return map;
}

async function userDetail(openid) {
  const u = await db
    .collection('users')
    .where({ _openid: openid })
    .field({ nickname: true, avatar_url: true, status: true, created_at: true })
    .limit(1)
    .get();
  const [letters, recycled, opens, replies] = await Promise.all([
    db.collection('letters').where({ _openid: openid, status: 'active' }).count(),
    db.collection('letters').where({ _openid: openid, status: 'recycled' }).count(),
    db.collection('open_records').where({ _openid: openid }).count(),
    db.collection('reply_records').where({ _openid: openid }).count()
  ]);
  return {
    user: u.data[0] || null,
    letterTotal: letters.total,
    recycleTotal: recycled.total,
    rereadTotal: opens.total,
    replyTotal: replies.total
  };
}

// HTTP 网关调用适配：路由直连本函数时，event 为 HTTP 请求结构（body 是 JSON 串），
// 需解析后走同一套 action 分发，并按 HTTP 响应格式返回；OPTIONS 预检直接放行。
function parseHttpEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const method = event.httpMethod || (event.requestContext && event.requestContext.http && event.requestContext.http.method);
  if (!method) return null;
  if (method.toUpperCase() === 'OPTIONS') return { options: true };
  let body = event.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
  }
  return body && typeof body === 'object' ? body : {};
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.main = async (event) => {
  const http = parseHttpEvent(event);
  if (!http) return handleAction(event);
  if (http.options) return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  const result = await handleAction(http);
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(result) };
};

async function handleAction(event) {
  if (!checkKey(event)) return { ok: false, error: 'unauthorized' };
  const action = event.action;

  try {
    switch (action) {
      // ── 鉴权 ──
      case 'auth':
        return { ok: true, role: 'admin' };

      // ── 主题管理 ──
      case 'themeList': {
        const res = await db.collection('themes').orderBy('sort', 'asc').limit(200).get();
        return { ok: true, themes: res.data };
      }
      case 'themeSave': {
        if (!event.theme || !event.theme.theme_id || !event.theme.name) {
          return { ok: false, error: 'theme_id 与 name 必填' };
        }
        const r = await upsertConfig('themes', 'theme_id', event.theme);
        return { ok: true, ...r };
      }
      case 'themeDelete': {
        if (!event.theme_id) return { ok: false, error: 'theme_id 必填' };
        const r = await db.collection('themes').where({ theme_id: event.theme_id }).remove();
        return { ok: true, removed: r.stats.removed };
      }
      case 'themeSeed': {
        let seeded = 0;
        for (const t of SEED_THEMES) {
          const exists = await db.collection('themes').where({ theme_id: t.theme_id }).limit(1).get();
          if (!exists.data.length) {
            await db.collection('themes').add({
              data: Object.assign({}, t, {
                pending: false,
                status: 'online',
                sort: SEED_THEMES.indexOf(t),
                created_at: new Date(),
                updated_at: new Date()
              })
            });
            seeded++;
          }
        }
        return { ok: true, seeded, skipped: SEED_THEMES.length - seeded };
      }

      // ── 版式管理 ──
      case 'paperList': {
        const res = await db.collection('papers').orderBy('sort', 'asc').limit(200).get();
        return { ok: true, papers: res.data };
      }
      case 'paperSave': {
        if (!event.paper || !event.paper.paper_id || !event.paper.name) {
          return { ok: false, error: 'paper_id 与 name 必填' };
        }
        const r = await upsertConfig('papers', 'paper_id', event.paper);
        return { ok: true, ...r };
      }
      case 'paperDelete': {
        if (!event.paper_id) return { ok: false, error: 'paper_id 必填' };
        const r = await db.collection('papers').where({ paper_id: event.paper_id }).remove();
        return { ok: true, removed: r.stats.removed };
      }
      case 'paperSeed': {
        let seeded = 0;
        for (let i = 0; i < SEED_PAPERS.length; i++) {
          const p = SEED_PAPERS[i];
          const exists = await db.collection('papers').where({ paper_id: p.paper_id }).limit(1).get();
          if (!exists.data.length) {
            await db.collection('papers').add({
              data: Object.assign({}, p, {
                status: 'online',
                sort: i,
                created_at: new Date(),
                updated_at: new Date()
              })
            });
            seeded++;
          }
        }
        return { ok: true, seeded, skipped: SEED_PAPERS.length - seeded };
      }

      // ── 数据看板（全部 count / 聚合，零正文）──
      case 'statsOverview': {
        const [users, letters, recycled, drafts, opens, replies] = await Promise.all([
          db.collection('users').count(),
          db.collection('letters').where({ status: 'active' }).count(),
          db.collection('letters').where({ status: 'recycled' }).count(),
          db.collection('drafts').count(),
          db.collection('open_records').count(),
          db.collection('reply_records').count()
        ]);
        return {
          ok: true,
          userTotal: users.total,
          letterTotal: letters.total,
          recycleTotal: recycled.total,
          draftTotal: drafts.total,
          rereadTotal: opens.total,
          replyTotal: replies.total
        };
      }
      case 'statsTrend': {
        const days = Number(event.days) === 30 ? 30 : 7;
        const since = new Date(Date.now() - days * DAY);
        const [users, letters, opens, replies] = await Promise.all([
          countByDay('users', since),
          countByDay('letters', since),
          countByDay('open_records', since),
          countByDay('reply_records', since)
        ]);
        const keys = dayKeys(days);
        return {
          ok: true,
          days: days,
          trend: keys.map((d) => ({
            day: d,
            users: users[d] || 0,
            letters: letters[d] || 0,
            opens: opens[d] || 0,
            replies: replies[d] || 0
          }))
        };
      }
      case 'eventsSummary': {
        const since7 = new Date(Date.now() - 7 * DAY);
        const all = await db
          .collection('events')
          .aggregate()
          .group({ _id: '$name', count: $.sum(1) })
          .end();
        const recent = await db
          .collection('events')
          .aggregate()
          .match({ created_at: _.gte(since7) })
          .group({ _id: '$name', count: $.sum(1) })
          .end();
        const recentMap = {};
        for (const row of recent.list) recentMap[row._id] = row.count;
        return {
          ok: true,
          events: all.list
            .map((r) => ({ name: r._id || '(空)', total: r.count, last7: recentMap[r._id] || 0 }))
            .sort((a, b) => b.total - a.total)
        };
      }

      // ── 用户管理（profile + count，零内容字段）──
      case 'userList': {
        const pageSize = 20;
        const page = Math.max(1, Number(event.page) || 1);
        const total = (await db.collection('users').count()).total;
        const res = await db
          .collection('users')
          .orderBy('created_at', 'desc')
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .field({ _openid: true, nickname: true, avatar_url: true, status: true, created_at: true })
          .get();
        const openIds = res.data.map((u) => u._openid);
        const [letters, opens, replies] = await Promise.all([
          countByOpenid('letters', openIds),
          countByOpenid('open_records', openIds),
          countByOpenid('reply_records', openIds)
        ]);
        return {
          ok: true,
          page,
          pageSize,
          total,
          users: res.data.map((u) => ({
            openid: u._openid,
            nickname: u.nickname || '',
            avatar: u.avatar_url || '',
            status: u.status || 'active',
            created_at: u.created_at,
            letterTotal: letters[u._openid] || 0,
            rereadTotal: opens[u._openid] || 0,
            replyTotal: replies[u._openid] || 0
          }))
        };
      }
      case 'userDetail': {
        if (!event.openid) return { ok: false, error: 'openid 必填' };
        const d = await userDetail(event.openid);
        return { ok: true, ...d };
      }

      default:
        return { ok: false, error: 'unknown action' };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
