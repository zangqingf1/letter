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

// 会员专属内容（member_items 集合 seed，与 miniprogram/pages/member/premium.js 同源手工同步）。
// 本期后台预置 + 小程序端仍是演示态（premium.js 硬编码色样展示）；真实接入三端同构后，
// 由本表驱动写信页专属版式/主题的解锁与下发。
const SEED_MEMBER_ITEMS = [
  { kind: 'paper', item_id: 'gold', name: '鎏金笺', desc: '暖金细线 · 专属', version: 1, colors: { bg: '#FAF4E6', ink: '#4A4033', gold: '#C6A870' } },
  { kind: 'paper', item_id: 'canglan', name: '苍蓝笺', desc: '静谧深青 · 专属', version: 1, colors: { bg: '#DDEDEA', ink: '#2E4440', gold: '#9FC8C0' } },
  { kind: 'paper', item_id: 'yinxiang', name: '银厢笺', desc: '墨银浮雕 · 专属', version: 1, colors: { bg: '#EDF0EE', ink: '#3A4240', gold: '#B9C4C0' } },
  { kind: 'theme', item_id: 'guiniao', name: '归鸟', desc: '归途晚照 · 专属', version: 1, swatch: '#D9C3B2', palette: { base: '#E9DCCF', title: '#5A4634', text: '#4A3B2C', tag: '#9C8B78' }, desk: '#DFD2C4' },
  { kind: 'theme', item_id: 'xingxi', name: '星汐', desc: '夜海微光 · 专属', version: 1, swatch: '#B8C4CF', palette: { base: '#C8D2DC', title: '#2E3A46', text: '#27323C', tag: '#74808C' }, desk: '#BDC9D4' }
];

// 会员套餐中文名（memberGrant 写入 members.plan_name）
const PLAN_NAMES = { month: '月卡', quarter: '季卡', year: '年卡', custom: '自定义' };

// 正则转义，供昵称模糊搜索拼接（userList keyword）
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 管理员密钥：只读环境变量 ADMIN_KEY（在 CloudBase 控制台配置）。
// 未配置时 checkKey 直接拒绝一切请求（密钥不得落入仓库，历史泄露的密钥须视为已失效并轮换）。
function checkKey(event) {
  const key = process.env.ADMIN_KEY || '';
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

// 按 (kind, item_id) upsert 一条会员专属版式/主题文档
async function upsertMemberItem(data) {
  const now = new Date();
  const doc = Object.assign(pick(data, ['kind', 'item_id', 'name', 'desc', 'version', 'status', 'sort', 'colors', 'swatch', 'palette', 'desk']), {
    updated_at: now
  });
  if (data.assets && typeof data.assets === 'object') doc.assets = data.assets;
  const found = await db.collection('member_items').where({ kind: data.kind, item_id: data.item_id }).limit(1).get();
  if (found.data.length) {
    await db.collection('member_items').doc(found.data[0]._id).update({ data: doc });
    return { id: found.data[0]._id, updated: true };
  }
  doc.created_at = now;
  const added = await db.collection('member_items').add({ data: doc });
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
    .field({ nickname: true, avatar_url: true, status: true, banned_at: true, created_at: true })
    .limit(1)
    .get();
  const [letters, recycled, opens, replies, drafts] = await Promise.all([
    db.collection('letters').where({ _openid: openid, status: 'active' }).count(),
    db.collection('letters').where({ _openid: openid, status: 'recycled' }).count(),
    db.collection('open_records').where({ _openid: openid }).count(),
    db.collection('reply_records').where({ _openid: openid }).count(),
    db.collection('drafts').where({ _openid: openid }).count()
  ]);
  const m = await db.collection('members').where({ _openid: openid }).limit(1).get();
  const member = m.data[0] || null;
  return {
    user: u.data[0] || null,
    letterTotal: letters.total,
    recycleTotal: recycled.total,
    rereadTotal: opens.total,
    replyTotal: replies.total,
    draftTotal: drafts.total,
    member: member
      ? {
          state: member.state || 'free',
          level: member.level || '',
          plan_name: member.plan_name || '',
          expires_at: member.expires_at || null,
          renew: !!member.renew,
          granted_at: member.granted_at || null
        }
      : null
  };
}

// 一批 openid 在 members 集合里的会员状态（key=openid）
async function memberMapByOpenid(openIds) {
  if (!openIds.length) return {};
  const res = await db
    .collection('members')
    .where({ _openid: _.in(openIds), state: 'vip', expires_at: _.gte(new Date()) })
    .field({ _openid: true, state: true, level: true, expires_at: true, plan_name: true })
    .get();
  const map = {};
  for (const row of res.data) map[row._openid] = row;
  return map;
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
        const where = {};
        if (event.status && event.status !== 'all') where.status = event.status;
        if (event.keyword && String(event.keyword).trim()) {
          where.nickname = db.RegExp({ regexp: escapeRegExp(String(event.keyword).trim()), options: 'i' });
        }
        const base = Object.keys(where).length ? db.collection('users').where(where) : db.collection('users');
        const total = (await base.count()).total;
        const res = await base
          .orderBy('created_at', 'desc')
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .field({ _openid: true, nickname: true, avatar_url: true, status: true, banned_at: true, created_at: true })
          .get();
        const openIds = res.data.map((u) => u._openid);
        const [letters, opens, replies, memberMap] = await Promise.all([
          countByOpenid('letters', openIds),
          countByOpenid('open_records', openIds),
          countByOpenid('reply_records', openIds),
          memberMapByOpenid(openIds)
        ]);
        return {
          ok: true,
          page,
          pageSize,
          total,
          users: res.data.map((u) => {
            const vip = memberMap[u._openid];
            return {
              openid: u._openid,
              nickname: u.nickname || '',
              avatar: u.avatar_url || '',
              status: u.status || 'active',
              banned_at: u.banned_at || null,
              created_at: u.created_at,
              letterTotal: letters[u._openid] || 0,
              rereadTotal: opens[u._openid] || 0,
              replyTotal: replies[u._openid] || 0,
              memberState: vip ? 'vip' : 'free',
              memberLevel: vip ? vip.level : ''
            };
          })
        };
      }
      case 'userBan': {
        if (!event.openid) return { ok: false, error: 'openid 必填' };
        await db.collection('users').where({ _openid: event.openid }).update({
          data: { status: 'banned', banned_at: new Date() }
        });
        return { ok: true };
      }
      case 'userUnban': {
        if (!event.openid) return { ok: false, error: 'openid 必填' };
        await db.collection('users').where({ _openid: event.openid }).update({
          data: { status: 'active', banned_at: null }
        });
        return { ok: true };
      }
      case 'userDetail': {
        if (!event.openid) return { ok: false, error: 'openid 必填' };
        const d = await userDetail(event.openid);
        return { ok: true, ...d };
      }

      // ── 会员管理（members 集合：VIP 用户状态，后台预置，小程序本期仍为演示态）──
      case 'memberList': {
        const pageSize = 20;
        const page = Math.max(1, Number(event.page) || 1);
        const where = {};
        if (event.state && event.state !== 'all') where.state = event.state;
        const base = Object.keys(where).length ? db.collection('members').where(where) : db.collection('members');
        const total = (await base.count()).total;
        const res = await base
          .orderBy('updated_at', 'desc')
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .get();
        const openIds = res.data.map((m) => m._openid);
        const userRows = openIds.length
          ? await db.collection('users')
              .where({ _openid: _.in(openIds) })
              .field({ _openid: true, nickname: true, avatar_url: true, created_at: true })
              .get()
          : { data: [] };
        const userMap = {};
        for (const u of userRows.data) userMap[u._openid] = u;
        return {
          ok: true,
          page,
          pageSize,
          total,
          members: res.data.map((m) => ({
            openid: m._openid,
            nickname: (userMap[m._openid] && userMap[m._openid].nickname) || '',
            avatar: (userMap[m._openid] && userMap[m._openid].avatar_url) || '',
            userCreatedAt: (userMap[m._openid] && userMap[m._openid].created_at) || null,
            state: m.state || 'free',
            level: m.level || '',
            plan_name: m.plan_name || '',
            expires_at: m.expires_at || null,
            renew: !!m.renew,
            granted_at: m.granted_at || null,
            updated_at: m.updated_at || null,
            granted_by: m.granted_by || ''
          }))
        };
      }
      case 'memberGrant': {
        const openid = (event.openid || '').trim();
        if (!openid) return { ok: false, error: 'openid 必填' };
        const plan = event.plan || 'month';
        const days = Number(event.days);
        if (!(days > 0) || days > 3650) return { ok: false, error: '有效期天数需为 1–3650' };
        const userExists = (await db.collection('users').where({ _openid: openid }).count()).total > 0;
        if (!userExists) return { ok: false, error: '该 openid 未建档（无此用户）' };
        const now = new Date();
        const found = await db.collection('members').where({ _openid: openid }).limit(1).get();
        let base = now.getTime();
        if (found.data.length && found.data[0].state === 'vip' && found.data[0].expires_at) {
          const t = new Date(found.data[0].expires_at).getTime();
          if (t > base) base = t;
        }
        const expiresAt = new Date(base + days * DAY);
        const doc = {
          state: 'vip',
          level: plan,
          plan_name: PLAN_NAMES[plan] || '自定义',
          expires_at: expiresAt,
          renew: !!event.renew,
          granted_at: now,
          granted_by: 'admin',
          updated_at: now
        };
        if (found.data.length) {
          doc.total_days = (found.data[0].total_days || 0) + days;
          await db.collection('members').doc(found.data[0]._id).update({ data: doc });
          return { ok: true, updated: true };
        }
        doc.total_days = days;
        await db.collection('members').add({ data: Object.assign({ _openid: openid }, doc) });
        return { ok: true, updated: false };
      }
      case 'memberRevoke': {
        if (!event.openid) return { ok: false, error: 'openid 必填' };
        const r = await db.collection('members').where({ _openid: event.openid }).update({
          data: { state: 'free', updated_at: new Date() }
        });
        return { ok: true, updated: (r.stats && r.stats.updated) || 0 };
      }

      // ── 会员专属内容（member_items 集合：专属版式/主题，后台增删改查）──
      case 'memberItemList': {
        const where = {};
        if (event.kind && event.kind !== 'all') where.kind = event.kind;
        const base = Object.keys(where).length ? db.collection('member_items').where(where) : db.collection('member_items');
        const res = await base.orderBy('sort', 'asc').limit(200).get();
        return { ok: true, items: res.data };
      }
      case 'memberItemSave': {
        const item = event.item || {};
        if (!item.kind || (item.kind !== 'paper' && item.kind !== 'theme')) {
          return { ok: false, error: 'kind 必须为 paper / theme' };
        }
        if (!item.item_id || !item.name) return { ok: false, error: 'item_id 与 name 必填' };
        const r = await upsertMemberItem(item);
        return { ok: true, ...r };
      }
      case 'memberItemDelete': {
        if (!event.kind || !event.item_id) return { ok: false, error: 'kind 与 item_id 必填' };
        const r = await db.collection('member_items').where({ kind: event.kind, item_id: event.item_id }).remove();
        return { ok: true, removed: r.stats.removed };
      }
      case 'memberItemSeed': {
        let seeded = 0;
        for (const it of SEED_MEMBER_ITEMS) {
          const exists = await db.collection('member_items').where({ kind: it.kind, item_id: it.item_id }).limit(1).get();
          if (!exists.data.length) {
            await db.collection('member_items').add({
              data: Object.assign({}, it, {
                status: 'online',
                sort: SEED_MEMBER_ITEMS.indexOf(it),
                created_at: new Date(),
                updated_at: new Date()
              })
            });
            seeded++;
          }
        }
        return { ok: true, seeded, skipped: SEED_MEMBER_ITEMS.length - seeded };
      }

      default:
        return { ok: false, error: 'unknown action' };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
