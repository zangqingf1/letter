'use strict';
/**
 * admin Web 后台 · 界面测试用 mock 后端（对应 测试流程.md §8）
 *
 * 为什么是 mock 而不是真网关：真网关要 ADMIN_KEY、会动真数据，且测不出「分页/筛选/灯箱
 * 这些前端逻辑对不对」。此处把网络这一层换掉（与云函数离线测试换掉 wx-server-sdk 同理），
 * admin/app.js 本身一行未改，所以测的仍是真实前端代码。
 *
 * 静态托管 admin/ 原文件，并在 index.html 里**额外注入一段同源脚本**挂载 mock fetch
 * （CSP 是 script-src 'self'，不许内联，所以只能用外部文件）。
 *
 * 启动：node tests/admin-ui/mock-server.js [port]
 *   → http://127.0.0.1:8799/
 *
 * 页面里可用 window.__ui 读取调用记录与改 mock 数据：
 *   __ui.calls            本次会话的 { action, data } 列表
 *   __ui.reset()          清空调用记录
 *   __ui.failNext(action) 让下一个该 action 返回业务错误（测错误分支）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ADMIN_DIR = path.resolve(__dirname, '..', '..', 'admin');
const PORT = Number(process.argv[2]) || 8799;
const DAY = 86400000;

// ── mock 数据（可被页面侧 __ui 改写）──────────────────────────────────
function makeData() {
  const users = [];
  for (let i = 1; i <= 25; i += 1) {
    const n = String(i).padStart(2, '0');
    users.push({
      openid: 'openid-u' + n,
      nickname: i === 3 ? '' : '用户' + n,
      avatar_url: '',
      status: i === 5 ? 'banned' : i === 7 ? 'deactivated' : 'active',
      banned_at: i === 5 ? new Date(Date.now() - 2 * DAY) : null,
      created_at: new Date(Date.now() - i * DAY),
      letterTotal: i,
      rereadTotal: i * 2,
      replyTotal: i,
      memberState: i % 4 === 0 ? 'vip' : '',
      memberLevel: i % 4 === 0 ? '守候' : ''
    });
  }
  const feedback = [];
  for (let i = 1; i <= 23; i += 1) {
    const n = String(i).padStart(2, '0');
    feedback.push({
      id: 'fb' + n,
      openid: 'openid-u' + n,
      content: '第 ' + i + ' 条反馈：' + '详细描述'.repeat(20),
      contact: i % 3 === 0 ? '' : 'user' + n + '@example.com',
      images: i % 2 === 0 ? [{ fileID: 'cloud://env.a/fb' + n + '-1.png', url: '/shot.png?n=' + n }, { fileID: 'cloud://env.a/fb' + n + '-2.png', url: '' }] : [],
      imageCount: i % 2 === 0 ? 2 : 0,
      device: 'iOS 17 / 微信 8.0.60',
      status: i % 3 === 0 ? 'done' : 'new',
      handled_at: i % 3 === 0 ? new Date(Date.now() - DAY) : null,
      handled_by: i % 3 === 0 ? 'admin' : '',
      created_at: new Date(Date.now() - i * 3600000)
    });
  }
  const themes = [
    { theme_id: 'xiaowangzi', name: '小王子', desc: '默认主题', version: 1, status: 'online', sort: 0, swatch: '#2E4756', palette: { base: '#F9F3E4' }, desk: '#EDE9DC', assets: {} },
    { theme_id: 'moye', name: '墨夜', desc: '深色', version: 1, status: 'offline', sort: 1, swatch: '#111111', palette: { base: '#1D2027' }, desk: '#15181E', assets: {} }
  ];
  const papers = [
    { paper_id: 'liubai', name: '留白志', desc: '默认', version: 1, status: 'online', sort: 0, colors: { bg: '#F7F5EF', ink: '#2E2A24' } },
    { paper_id: 'extra', name: '号外头版', desc: '报纸头版', version: 1, status: 'online', sort: 1, colors: { bg: '#F5EFDE', ink: '#262219', accent: '#A33B24' } },
    { paper_id: 'blueprint', name: '工程蓝图', desc: '白线网格', version: 2, status: 'offline', sort: 2, colors: { bg: '#16324F', line: '#EAF2F8' } },
    { paper_id: 'ticket', name: '存根票根', desc: '凭证票面', version: 1, status: 'online', sort: 3, colors: { bg: '#F6EDDC', ink: '#2E2A26', accent: '#C2452D' } },
    { paper_id: 'vinyl', name: '黑胶', desc: '复古', version: 1, status: 'online', sort: 4, colors: { bg: '#141414', ink: '#EFE7D6' } }
  ];
  const members = users.filter((u) => u.memberState === 'vip').map((u) => ({
    openid: u.openid,
    nickname: u.nickname,
    state: 'vip',
    level: 'quarter',
    plan_name: '季卡',
    expires_at: new Date(Date.now() + 40 * DAY),
    granted_at: new Date(Date.now() - 50 * DAY),
    total_days: 130,
    renew: false
  }));
  const memberItems = [
    { id: 'mi1', kind: 'paper', item_id: 'pl-premium', name: '专属·鎏金', desc: 'VIP 专属版式', version: 1, status: 'online', sort: 0, colors: { bg: '#1B1B1B', ink: '#F0E6D2', gold: '#C8A24A' } },
    { id: 'mi2', kind: 'theme', item_id: 'th-premium', name: '专属·夜航', desc: 'VIP 专属主题', version: 1, status: 'online', sort: 0, swatch: '#0B1B2B', palette: { base: '#0B1B2B' }, desk: '#0A1622', assets: {} },
    // 与 papers/themes 同 id 的两条：模拟「从已有款挑选新建专属」（后台会复用原 id），
    // 用于验证「版式管理 / 主题管理」状态列上的 👑 会员 标签
    { id: 'mi3', kind: 'paper', item_id: 'vinyl', name: '黑胶 · 专属版', desc: 'VIP 专属版式', version: 1, status: 'online', sort: 1, colors: { bg: '#1B1A1C', ink: '#F0E6D2', gold: '#C6A870' } },
    { id: 'mi4', kind: 'theme', item_id: 'xiaowangzi', name: '小王子 · 专属版', desc: 'VIP 专属主题', version: 1, status: 'online', sort: 1, swatch: '#D9C3B2', palette: { base: '#E9DCCF' }, desk: '#DFD2C4', assets: {} }
  ];
  return { users, feedback, themes, papers, members, memberItems };
}

// ── 与 admin 云函数同形状的响应 ────────────────────────────────────────
// 注意：本函数会被 toString() 序列化后注入页面，因此**不能引用任何模块作用域的变量**
// （DAY / pageOf 等一律在函数内部定义），否则页面里会变成 undefined。
function handle(data, payload) {
  var DAY = 86400000;
  var pageSize = 20;
  function pageOf(list, page) {
    return list.slice((page - 1) * pageSize, page * pageSize);
  }
  const action = payload.action;

  switch (action) {
    case 'auth':
      return { ok: true, role: 'admin' };

    case 'statsOverview':
      return {
        ok: true,
        userTotal: data.users.length,
        letterTotal: data.users.reduce((s, u) => s + u.letterTotal, 0),
        recycleTotal: 3, draftTotal: 5, rereadTotal: 120, replyTotal: 41
      };

    case 'eventsSummary':
      return {
        ok: true,
        events: data.users.length
          ? [{ name: 'letter_open', total: 88, last7: 12 }, { name: 'share_send', total: 5, last7: 1 }]
          : []
      };

    case 'statsTrend': {
      const days = Number(payload.days) || 7;
      const trend = [];
      for (let i = days - 1; i >= 0; i -= 1) {
        trend.push({
          day: new Date(Date.now() - i * DAY).toISOString().slice(0, 10),
          users: 1 + (i % 3), letters: 2 + (i % 4), opens: i, replies: i % 2
        });
      }
      return { ok: true, trend };
    }

    case 'userList': {
      let list = data.users.slice();
      if (payload.status && payload.status !== 'all') list = list.filter((u) => u.status === payload.status);
      if (payload.keyword) list = list.filter((u) => (u.nickname || '').includes(payload.keyword));
      const page = Math.max(1, Number(payload.page) || 1);
      return { ok: true, page, pageSize, total: list.length, users: pageOf(list, page) };
    }

    case 'userDetail': {
      const u = data.users.find((x) => x.openid === payload.openid);
      if (!u) return { ok: false, error: '用户不存在' };
      return {
        ok: true,
        user: { nickname: u.nickname, avatar_url: u.avatar_url, status: u.status, banned_at: u.banned_at, created_at: u.created_at },
        letterTotal: u.letterTotal, recycleTotal: 1, rereadTotal: u.rereadTotal,
        replyTotal: u.replyTotal, draftTotal: 2,
        member: u.memberState === 'vip'
          ? { state: 'vip', level: 'quarter', plan_name: '季卡', expires_at: new Date(Date.now() + 40 * DAY), renew: false, granted_at: new Date() }
          : null
      };
    }

    case 'userBan': {
      const u = data.users.find((x) => x.openid === payload.openid);
      if (!u) return { ok: false, error: 'openid 非法' };
      u.status = 'banned';
      u.banned_at = new Date();
      return { ok: true };
    }

    case 'userUnban': {
      const u = data.users.find((x) => x.openid === payload.openid);
      if (!u) return { ok: false, error: 'openid 非法' };
      u.status = 'active';
      u.banned_at = null;
      return { ok: true };
    }

    case 'memberList': {
      let list = data.members.slice();
      if (payload.state && payload.state !== 'all') list = list.filter((m) => m.state === payload.state);
      const page = Math.max(1, Number(payload.page) || 1);
      return { ok: true, page, pageSize, total: list.length, members: pageOf(list, page) };
    }

    case 'memberGrant': {
      const u = data.users.find((x) => x.openid === payload.openid);
      if (!u) return { ok: false, error: '该 openid 未建档（无此用户）' };
      const days = Number(payload.days);
      if (!(days > 0) || days > 3650) return { ok: false, error: '有效期天数需为 1–3650' };
      const existing = data.members.find((m) => m.openid === payload.openid);
      const PLAN = { month: '月卡', quarter: '季卡', year: '年卡' };
      const plan = PLAN[payload.plan] ? payload.plan : 'month';
      if (existing) {
        existing.total_days += days;
        existing.expires_at = new Date(Date.now() + days * DAY);
      } else {
        data.members.push({
          openid: payload.openid, nickname: u.nickname, state: 'vip', level: plan,
          plan_name: PLAN[plan], expires_at: new Date(Date.now() + days * DAY),
          granted_at: new Date(), total_days: days, renew: !!payload.renew
        });
      }
      return { ok: true };
    }

    case 'memberRevoke': {
      const m = data.members.find((x) => x.openid === payload.openid);
      if (!m) return { ok: false, error: 'openid 非法' };
      m.state = 'free';
      return { ok: true, updated: 1 };
    }

    case 'memberItemList': {
      let list = data.memberItems.slice();
      if (payload.kind) list = list.filter((i) => i.kind === payload.kind);
      return { ok: true, items: list };
    }

    case 'memberItemSeed':
      return { ok: true, seeded: 0, skipped: data.memberItems.length };

    case 'memberItemSave': {
      const it = payload.item || {};
      const ex = data.memberItems.find((x) => x.kind === it.kind && x.item_id === it.item_id);
      if (ex) Object.assign(ex, it);
      else data.memberItems.push(Object.assign({ id: 'mi' + (data.memberItems.length + 1) }, it));
      return { ok: true };
    }

    case 'memberItemDelete': {
      const i = data.memberItems.findIndex((x) => x.kind === payload.kind && x.item_id === payload.item_id);
      if (i >= 0) data.memberItems.splice(i, 1);
      return { ok: true, removed: 1 };
    }

    // premium 标记与 admin 云函数一致：该 id 在 member_items（同 kind）里已有专属款。
    // 状态列据此多挂一枚 👑 会员 标签（member item 自己的上下架不参与判断）。
    // 排序也照云函数来（orderBy sort asc）：拖动改序后重渲染才能看出新顺序。
    case 'themeList': {
      const premium = {};
      data.memberItems.forEach((x) => { if (x.kind === 'theme') premium[x.item_id] = true; });
      return {
        ok: true,
        themes: data.themes.slice()
          .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
          .map((t) => Object.assign({}, t, { premium: !!premium[t.theme_id] }))
      };
    }

    case 'themeSeed':
      return { ok: true, seeded: 0, skipped: data.themes.length };

    case 'themeSave': {
      const t = payload.theme || {};
      const ex = data.themes.find((x) => x.theme_id === t.theme_id);
      if (ex) Object.assign(ex, t);
      else data.themes.push(t);
      return { ok: true };
    }

    case 'themeDelete': {
      const i = data.themes.findIndex((x) => x.theme_id === payload.theme_id);
      if (i < 0) return { ok: false, error: 'theme_id 非法' };
      data.themes.splice(i, 1);
      return { ok: true, removed: 1 };
    }

    case 'paperList': {
      const premium = {};
      data.memberItems.forEach((x) => { if (x.kind === 'paper') premium[x.item_id] = true; });
      return {
        ok: true,
        papers: data.papers.slice()
          .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
          .map((p) => Object.assign({}, p, { premium: !!premium[p.paper_id] }))
      };
    }

    case 'paperSeed':
      return { ok: true, seeded: 0, skipped: data.papers.length };

    case 'paperSave': {
      const p = payload.paper || {};
      const ex = data.papers.find((x) => x.paper_id === p.paper_id);
      if (ex) Object.assign(ex, p);
      else data.papers.push(p);
      return { ok: true };
    }

    case 'paperDelete': {
      const i = data.papers.findIndex((x) => x.paper_id === payload.paper_id);
      if (i < 0) return { ok: false, error: 'paper_id 非法' };
      data.papers.splice(i, 1);
      return { ok: true, removed: 1 };
    }

    case 'feedbackList': {
      let list = data.feedback.slice();
      if (payload.status && payload.status !== 'all') list = list.filter((f) => f.status === payload.status);
      const page = Math.max(1, Number(payload.page) || 1);
      return {
        ok: true, page, pageSize, total: list.length,
        items: pageOf(list, page).map((f) => ({
          id: f.id, openid: f.openid, content: f.content, contact: f.contact,
          imageCount: f.imageCount, status: f.status, created_at: f.created_at
        }))
      };
    }

    case 'feedbackDetail': {
      const f = data.feedback.find((x) => x.id === payload.id);
      if (!f) return { ok: false, error: '反馈不存在' };
      return { ok: true, detail: Object.assign({}, f) };
    }

    case 'feedbackUpdate': {
      const f = data.feedback.find((x) => x.id === payload.id);
      if (!f) return { ok: false, error: 'id 非法' };
      if (payload.status !== 'new' && payload.status !== 'done') return { ok: false, error: 'status 需为 new / done' };
      f.status = payload.status;
      f.handled_at = payload.status === 'done' ? new Date() : null;
      f.handled_by = payload.status === 'done' ? 'admin' : '';
      return { ok: true, updated: 1 };
    }

    case 'feedbackDelete': {
      const i = data.feedback.findIndex((x) => x.id === payload.id);
      if (i < 0) return { ok: false, error: 'id 非法' };
      data.feedback.splice(i, 1);
      return { ok: true, removed: 1 };
    }

    default:
      return { ok: false, error: 'unknown action' };
  }
}

// ── 桌面端注入脚本 ─────────────────────────────────────────────────────
function mockScript(initialData) {
  return `(function () {
  var DATA = ${JSON.stringify(initialData)};
  var calls = [];
  var failing = [];
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  window.__ui = {
    calls: calls,
    data: DATA,
    reset: function () { calls.length = 0; failing.length = 0; },
    failNext: function (action) { failing.push(action); },
    callsOf: function (action) { return calls.filter(function (c) { return c.action === action; }); }
  };
  var realFetch = window.fetch;
  window.fetch = function (url, opts) {
    var payload = {};
    try { payload = JSON.parse((opts && opts.body) || '{}'); } catch (e) { payload = {}; }
    calls.push({ action: payload.action, data: clone(payload) });
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (failing.indexOf(payload.action) !== -1) {
          failing.splice(failing.indexOf(payload.action), 1);
          resolve(mk({ ok: false, error: '模拟失败：' + payload.action }));
          return;
        }
        resolve(mk(__mockHandle(DATA, payload)));
      }, 10);
    });
  };
  function mk(obj) {
    return { ok: true, status: 200, json: function () { return Promise.resolve(clone(obj)); } };
  }
  window.__realFetch = realFetch;
})();`;
}

// 把 handle 函数源码也塞进页面（避免复制两份逻辑）
function mockScriptFull(initialData) {
  return (
    'window.__mockHandle = ' + handle.toString() + ';\n' + mockScript(initialData)
  );
}

// ── HTTP 服务 ──────────────────────────────────────────────────────────
const MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const data = makeData();

  if (url === '/__mock-api.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'] });
    res.end(mockScriptFull(makeData()));
    return;
  }

  // 1×1 透明 PNG，供截图灯箱测试
  if (url === '/shot.png') {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(png);
    return;
  }

  const rel = url === '/' ? 'index.html' : url.replace(/^\//, '');
  const file = path.join(ADMIN_DIR, rel);
  if (!file.startsWith(ADMIN_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }

  let body = fs.readFileSync(file);
  const ext = path.extname(file);
  if (rel === 'index.html') {
    // 只能注入同源外部脚本：CSP 是 script-src 'self'
    body = String(body).replace(
      '<script src="app.js"></script>',
      '<script src="/__mock-api.js"></script>\n<script src="app.js"></script>'
    );
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(body);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('admin mock server → http://127.0.0.1:' + PORT + '/');
  console.log('  mock 数据：25 个用户（20 条/页，第 5 个已封禁）/ 23 条反馈 / 2 主题 / 2 版式');
});
