// 心灵信箱 · Web 管理后台前端
// 纯静态单页（无构建）：原生 fetch 直连 HTTP 网关路由 → admin 云函数。
// 不依赖 js-sdk / 匿名登录 / Web 安全域名；鉴权靠管理员密钥（云函数逐一校验）。
// 隐私：所有视图只展示统计数字与用户 profile，永不请求/展示信件正文（后端亦不返回）。

const CONFIG = {
  // HTTP 网关路由地址：控制台「HTTP 网关 → 路由管理」添加指向 admin 云函数的路由后，
  // 把「默认域名 + 路由路径」填到这里，例如：
  // 'https://cloudbase-xxxx-1477338373.ap-shanghai.app.tcloudbase.com/admin'
  API_URL: 'https://cloudbase-d1gp46d6he3bbf9f0-1477338373.ap-shanghai.app.tcloudbase.com/admin'
};

const KEY_STORAGE = 'hb_admin_key';
let key = localStorage.getItem(KEY_STORAGE) || '';

const $ = (sel) => document.querySelector(sel);
const content = () => $('#content');

// ── 工具 ──
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
function fmtDate(d) {
  if (!d) return '—';
  const t = new Date(d);
  return isNaN(t.getTime()) ? '—' : t.toLocaleString('zh-CN', { hour12: false });
}
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

// ── 云调用（fetch 直连 HTTP 网关路由）──
async function api(action, data) {
  if (!CONFIG.API_URL) {
    throw new Error('未配置 API_URL：请把 HTTP 网关路由地址填进 app.js 顶部 CONFIG.API_URL');
  }
  let res;
  try {
    res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action, key }, data || {}))
    });
  } catch (e) {
    throw new Error('网络请求失败：' + e.message);
  }
  const r = await res.json().catch(() => null);
  if (!r) throw new Error('响应不是合法 JSON（请检查路由是否指向 admin 云函数）');
  if (r.ok === false) {
    if (r.error === 'unauthorized') { logout(); throw new Error('密钥无效，请重新登录'); }
    throw new Error(r.error || '请求失败');
  }
  return r;
}

// ── 登录 / 退出 ──
function showLogin() {
  $('#view-login').classList.remove('hidden');
  $('#view-main').classList.add('hidden');
}
function showMain() {
  $('#view-login').classList.add('hidden');
  $('#view-main').classList.remove('hidden');
}
function logout() {
  localStorage.removeItem(KEY_STORAGE);
  key = '';
  showLogin();
}

async function tryLogin(inputKey) {
  key = inputKey;
  try {
    await api('auth');
    localStorage.setItem(KEY_STORAGE, key);
    showMain();
    switchNav('dashboard');
  } finally {
    // 失败时 api 内部不清除 key（仅 unauthorized 才登出），交给调用方提示
  }
}

// ── 导航 ──
const NAV_RENDER = {
  dashboard: renderDashboard,
  themes: renderThemes,
  papers: renderPapers,
  users: renderUsers
};
let currentNav = 'dashboard';

function switchNav(nav) {
  currentNav = nav;
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === nav);
  });
  NAV_RENDER[nav]();
}

// ── 抽屉表单 ──
function openDrawer(html) {
  $('#drawer-body').innerHTML = html;
  $('#drawer').classList.remove('hidden');
  $('#drawer-mask').classList.remove('hidden');
}
function closeDrawer() {
  $('#drawer').classList.add('hidden');
  $('#drawer-mask').classList.add('hidden');
}

function field(label, inner) {
  return `<div class="field"><label>${esc(label)}</label>${inner}</div>`;
}
function textField(name, label, value, opts) {
  const o = opts || {};
  return field(label, `<input type="text" data-f="${name}" value="${esc(value == null ? '' : value)}" ${o.disabled ? 'disabled' : ''} placeholder="${esc(o.placeholder || '')}">`);
}
function numField(name, label, value) {
  return field(label, `<input type="number" data-f="${name}" value="${value == null ? 1 : value}">`);
}
// 颜色字段：文本框为真值源 + 原生取色器联动（rgba() 等非 hex 值取色器不联动）
function colorField(name, label, value) {
  const v = value || '';
  const hex = /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#ffffff';
  return field(label, `<div class="color-pair">
    <input type="color" data-c="${name}" value="${hex}">
    <input type="text" data-f="${name}" value="${esc(v)}" placeholder="#RRGGBB / rgba()">
  </div>`);
}
function bindColorPairs(scope) {
  scope.querySelectorAll('input[type="color"][data-c]').forEach((cp) => {
    cp.addEventListener('input', () => {
      const t = scope.querySelector(`input[type="text"][data-f="${cp.dataset.c}"]`);
      if (t) t.value = cp.value;
    });
  });
}
function formValues(scope) {
  const out = {};
  scope.querySelectorAll('[data-f]').forEach((el) => { out[el.dataset.f] = el.value; });
  return out;
}

// colors 键值对编辑器（版式配色键名各版式不同，动态增删行）
function kvEditor(containerId, colors) {
  const el = $(containerId);
  const rowHtml = (k, v) => `<div class="kv-row">
    <input type="text" class="k" value="${esc(k)}" placeholder="键名，如 bg">
    <input type="text" class="v" value="${esc(v)}" placeholder="#RRGGBB / rgba()">
    <span class="chip" style="background:${esc(/^#[0-9a-fA-F]{3,8}|^rgba?/.test(v) ? v : 'transparent')}"></span>
    <button type="button" class="del" title="删除该色">✕</button>
  </div>`;
  el.innerHTML = Object.keys(colors || {}).map((k) => rowHtml(k, colors[k])).join('')
    + `<button type="button" class="btn small" id="kv-add">＋ 加一色</button>`;
  el.querySelectorAll('.kv-row').forEach((row) => {
    row.querySelector('.del').addEventListener('click', () => {
      row.remove();
      if (!el.querySelector('.kv-row')) el.insertAdjacentHTML('afterbegin', rowHtml('', ''));
    });
    row.querySelector('.v').addEventListener('input', () => {
      row.querySelector('.chip').style.background = /^#[0-9a-fA-F]{3,8}|^rgba?/.test(row.querySelector('.v').value) ? row.querySelector('.v').value : 'transparent';
    });
  });
  el.querySelector('#kv-add').addEventListener('click', () => {
    el.querySelector('#kv-add').insertAdjacentHTML('beforebegin', rowHtml('', ''));
    const rows = el.querySelectorAll('.kv-row');
    const row = rows[rows.length - 1];
    row.querySelector('.del').addEventListener('click', () => row.remove());
    row.querySelector('.k').focus();
  });
}
function kvValues(containerId) {
  const out = {};
  $(containerId).querySelectorAll('.kv-row').forEach((row) => {
    const k = row.querySelector('.k').value.trim();
    const v = row.querySelector('.v').value.trim();
    if (k) out[k] = v;
  });
  return out;
}

// ════════ 数据看板 ════════
async function renderDashboard() {
  content().innerHTML = '<p class="empty-tip">加载中…</p>';
  try {
    const [ov, ev] = await Promise.all([api('statsOverview'), api('eventsSummary')]);
    content().innerHTML = `
      <h2 class="page-title">数据看板</h2>
      <p class="page-sub">全局统计仅计数聚合，不包含任何信件内容。</p>
      <div class="stat-grid">
        ${[['userTotal', '用户总数'], ['letterTotal', '在匣信件'], ['recycleTotal', '废纸篓'], ['draftTotal', '草稿'], ['rereadTotal', '重读次数'], ['replyTotal', '回信条数']]
          .map(([k, label]) => `<div class="stat-card"><div class="v">${ov[k] ?? 0}</div><div class="k">${label}</div></div>`).join('')}
      </div>
      <div class="card">
        <h3>事件埋点（events 集合）</h3>
        ${ev.events.length ? `<table><tr><th>事件名</th><th>累计次数</th><th>近 7 天</th></tr>
          ${ev.events.map((e) => `<tr><td>${esc(e.name)}</td><td class="num">${e.total}</td><td class="num">${e.last7}</td></tr>`).join('')}
        </table>` : '<p class="empty-tip">暂无埋点数据</p>'}
      </div>
      <div class="card">
        <h3>趋势
          <button class="btn small" data-days="7" style="margin-left:10px">近 7 天</button>
          <button class="btn small" data-days="30">近 30 天</button>
        </h3>
        <div id="trend-box"><p class="empty-tip">加载中…</p></div>
      </div>`;
    content().querySelectorAll('[data-days]').forEach((b) => {
      b.addEventListener('click', () => loadTrend(Number(b.dataset.days)));
    });
    loadTrend(7);
  } catch (e) {
    content().innerHTML = `<p class="empty-tip">加载失败：${esc(e.message)}</p>`;
  }
}

async function loadTrend(days) {
  const box = $('#trend-box');
  if (!box) return;
  box.innerHTML = '<p class="empty-tip">加载中…</p>';
  try {
    const r = await api('statsTrend', { days });
    box.innerHTML = `<table>
      <tr><th>日期</th><th>新增用户</th><th>新写信件</th><th>重读</th><th>回信</th></tr>
      ${r.trend.map((d) => `<tr><td>${d.day}</td><td class="num">${d.users}</td><td class="num">${d.letters}</td><td class="num">${d.opens}</td><td class="num">${d.replies}</td></tr>`).join('')}
    </table>`;
  } catch (e) {
    box.innerHTML = `<p class="empty-tip">加载失败：${esc(e.message)}</p>`;
  }
}

// ════════ 主题管理 ════════
async function renderThemes() {
  content().innerHTML = '<p class="empty-tip">加载中…</p>';
  try {
    const r = await api('themeList');
    content().innerHTML = `
      <h2 class="page-title">主题管理</h2>
      <p class="page-sub">themes 集合：主题绑定信封素材与桌面底色；信纸配色由版式（papers）自持。上架中的主题在写信页横滑卡片可见。</p>
      <div class="toolbar">
        <button class="btn primary" id="theme-new">＋ 新建主题</button>
        <button class="btn" id="theme-seed">导入官方 7 套</button>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:12px">共 ${r.themes.length} 套</span>
      </div>
      <div class="card">
        ${r.themes.length ? `<table>
          <tr><th>排序</th><th>ID</th><th>名称</th><th>状态</th><th>版本</th><th>信封素材</th><th style="text-align:right">操作</th></tr>
          ${r.themes.map((t) => `<tr>
            <td class="num">${t.sort ?? ''}</td>
            <td>${esc(t.theme_id)}</td>
            <td>${esc(t.name)}</td>
            <td><span class="badge ${t.status === 'online' ? 'online' : 'offline'}">${t.status === 'online' ? '上架' : '下架'}</span></td>
            <td class="num">v${t.version || 1}</td>
            <td>${t.assets && t.assets.envelope ? '有' : '—'}</td>
            <td style="text-align:right">
              <button class="btn small" data-edit="${esc(t.theme_id)}">编辑</button>
              <button class="btn small" data-toggle="${esc(t.theme_id)}">${t.status === 'online' ? '下架' : '上架'}</button>
              <button class="btn small danger" data-del="${esc(t.theme_id)}">删除</button>
            </td>
          </tr>`).join('')}
        </table>` : '<p class="empty-tip">themes 集合为空。可点「导入官方 7 套」一键建立，或手动新建。</p>'}
      </div>`;
    $('#theme-new').addEventListener('click', () => themeDrawer(null, r.themes.length));
    $('#theme-seed').addEventListener('click', async () => {
      if (!confirm('导入官方 7 套主题？已存在的同 ID 主题会跳过。')) return;
      const res = await api('themeSeed');
      toast(`已导入 ${res.seeded} 套，跳过 ${res.skipped} 套`);
      renderThemes();
    });
    content().querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const t = r.themes.find((x) => x.theme_id === b.dataset.edit);
      themeDrawer(t);
    }));
    content().querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      const t = r.themes.find((x) => x.theme_id === b.dataset.toggle);
      await api('themeSave', { theme: Object.assign({}, t, { status: t.status === 'online' ? 'offline' : 'online' }) });
      toast(t.status === 'online' ? '已下架' : '已上架');
      renderThemes();
    }));
    content().querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const t = r.themes.find((x) => x.theme_id === b.dataset.del);
      if (!confirm(`彻底删除主题「${t.name}」？此操作不可恢复；正在使用该主题的历史信件会回落默认主题。`)) return;
      await api('themeDelete', { theme_id: t.theme_id });
      toast('已删除');
      renderThemes();
    }));
  } catch (e) {
    content().innerHTML = `<p class="empty-tip">加载失败：${esc(e.message)}</p>`;
  }
}

function themeDrawer(t, nextSort) {
  const isNew = !t;
  t = t || { theme_id: '', name: '', desc: '', version: 1, status: 'online', sort: nextSort || 0, swatch: '', palette: {}, desk: '', assets: {} };
  const p = t.palette || {};
  const a = t.assets || {};
  openDrawer(`
    <h3>${isNew ? '新建主题' : '编辑主题 · ' + esc(t.name)}</h3>
    ${textField('theme_id', '主题 ID（字母，创建后作为唯一键）', t.theme_id, { disabled: !isNew })}
    ${textField('name', '名称', t.name)}
    ${textField('desc', '描述', t.desc)}
    <div class="field-row">
      ${numField('version', '版本号', t.version)}
      ${numField('sort', '排序（小在前）', t.sort)}
    </div>
    ${field('状态', `<select data-f="status">
      <option value="online" ${t.status === 'online' ? 'selected' : ''}>上架</option>
      <option value="offline" ${t.status !== 'online' ? 'selected' : ''}>下架</option>
    </select>`)}
    ${colorField('swatch', '色样（无信封素材时选择卡片显示）', t.swatch)}
    ${colorField('desk', '预览区桌面底色', t.desk)}
    <p style="font-size:12px;color:var(--muted);margin:14px 0 8px">信纸配色（palette：底色 + 三档墨色）</p>
    <div class="field-row">
      ${colorField('palette.base', '底色 base', p.base)}
      ${colorField('palette.title', '标题 title', p.title)}
    </div>
    <div class="field-row">
      ${colorField('palette.text', '正文 text', p.text)}
      ${colorField('palette.tag', '标签 tag', p.tag)}
    </div>
    <p style="font-size:12px;color:var(--muted);margin:14px 0 8px">信封素材（小程序包内路径，如 /assets/theme/xiaowangzi/envelope.jpg；留空则回落默认信封）</p>
    ${textField('assets.envelope', '信封大图 envelope', a.envelope || '')}
    ${textField('assets.envelopeThumb', '信封缩略图 envelopeThumb', a.envelopeThumb || '')}
    <div class="form-actions">
      <button class="btn ghost" id="drawer-cancel">取消</button>
      <button class="btn primary" id="drawer-save">保存</button>
    </div>`);
  const drawer = $('#drawer-body');
  bindColorPairs(drawer);
  $('#drawer-cancel').addEventListener('click', closeDrawer);
  $('#drawer-save').addEventListener('click', async () => {
    const v = formValues(drawer);
    const theme = {
      theme_id: (v.theme_id || '').trim(),
      name: (v.name || '').trim(),
      desc: v.desc || '',
      version: Number(v.version) || 1,
      sort: Number(v.sort) || 0,
      status: v.status,
      swatch: v.swatch || '',
      desk: v.desk || '',
      palette: { base: v['palette.base'] || '', title: v['palette.title'] || '', text: v['palette.text'] || '', tag: v['palette.tag'] || '' },
      assets: { envelope: v['assets.envelope'] || '', envelopeThumb: v['assets.envelopeThumb'] || '' }
    };
    try {
      await api('themeSave', { theme });
      toast('已保存');
      closeDrawer();
      renderThemes();
    } catch (e) {
      alert('保存失败：' + e.message);
    }
  });
}

// ════════ 版式管理 ════════
async function renderPapers() {
  content().innerHTML = '<p class="empty-tip">加载中…</p>';
  try {
    const r = await api('paperList');
    content().innerHTML = `
      <h2 class="page-title">版式管理</h2>
      <p class="page-sub">papers 集合：信纸 = 固定纸色 + 固定排版，此处只管理名称/描述/配色 colors/上下架/排序/版本。
      版式的视觉结构在小程序代码三端同构（styles/paper.wxml + paper.wxss + share.js），新增版式结构必须改代码发版，后台无法凭空创建。</p>
      <div class="toolbar">
        <button class="btn primary" id="paper-new">＋ 新建版式</button>
        <button class="btn" id="paper-seed">导入官方 10 套</button>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:12px">共 ${r.papers.length} 套</span>
      </div>
      <div class="card">
        ${r.papers.length ? `<table>
          <tr><th>排序</th><th>ID</th><th>名称</th><th>状态</th><th>版本</th><th>配色数</th><th>底色</th><th style="text-align:right">操作</th></tr>
          ${r.papers.map((p) => `<tr>
            <td class="num">${p.sort ?? ''}</td>
            <td>${esc(p.paper_id)}</td>
            <td>${esc(p.name)}</td>
            <td><span class="badge ${p.status === 'online' ? 'online' : 'offline'}">${p.status === 'online' ? '上架' : '下架'}</span></td>
            <td class="num">v${p.version || 1}</td>
            <td class="num">${Object.keys(p.colors || {}).length}</td>
            <td><span class="chip" style="display:inline-block;width:22px;height:22px;border-radius:5px;border:1px solid var(--line);background:${esc(p.colors && p.colors.bg) || 'transparent'}"></span></td>
            <td style="text-align:right">
              <button class="btn small" data-edit="${esc(p.paper_id)}">编辑</button>
              <button class="btn small" data-toggle="${esc(p.paper_id)}">${p.status === 'online' ? '下架' : '上架'}</button>
              <button class="btn small danger" data-del="${esc(p.paper_id)}">删除</button>
            </td>
          </tr>`).join('')}
        </table>` : '<p class="empty-tip">papers 集合为空。可点「导入官方 10 套」一键建立（未导入时小程序自动使用内置配置，不受影响）。</p>'}
      </div>`;
    $('#paper-new').addEventListener('click', () => paperDrawer(null, r.papers.length));
    $('#paper-seed').addEventListener('click', async () => {
      if (!confirm('导入官方 10 套版式？已存在的同 ID 版式会跳过。')) return;
      const res = await api('paperSeed');
      toast(`已导入 ${res.seeded} 套，跳过 ${res.skipped} 套`);
      renderPapers();
    });
    content().querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const p = r.papers.find((x) => x.paper_id === b.dataset.edit);
      paperDrawer(p);
    }));
    content().querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      const p = r.papers.find((x) => x.paper_id === b.dataset.toggle);
      await api('paperSave', { paper: Object.assign({}, p, { status: p.status === 'online' ? 'offline' : 'online' }) });
      toast(p.status === 'online' ? '已下架' : '已上架');
      renderPapers();
    }));
    content().querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const p = r.papers.find((x) => x.paper_id === b.dataset.del);
      if (!confirm(`彻底删除版式「${p.name}」？正在使用该版式的历史信件将回落第一套版式渲染。`)) return;
      await api('paperDelete', { paper_id: p.paper_id });
      toast('已删除');
      renderPapers();
    }));
  } catch (e) {
    content().innerHTML = `<p class="empty-tip">加载失败：${esc(e.message)}</p>`;
  }
}

function paperDrawer(p, nextSort) {
  const isNew = !p;
  p = p || { paper_id: '', name: '', desc: '', version: 1, status: 'online', sort: nextSort || 0, colors: {} };
  openDrawer(`
    <h3>${isNew ? '新建版式' : '编辑版式 · ' + esc(p.name)}</h3>
    ${textField('paper_id', '版式 ID（字母，创建后作为唯一键，需与小程序 drawXxxStyle 对应）', p.paper_id, { disabled: !isNew })}
    ${textField('name', '名称', p.name)}
    ${textField('desc', '描述', p.desc)}
    <div class="field-row">
      ${numField('version', '版本号', p.version)}
      ${numField('sort', '排序（小在前）', p.sort)}
    </div>
    ${field('状态', `<select data-f="status">
      <option value="online" ${p.status === 'online' ? 'selected' : ''}>上架</option>
      <option value="offline" ${p.status !== 'online' ? 'selected' : ''}>下架</option>
    </select>`)}
    <p style="font-size:12px;color:var(--muted);margin:14px 0 8px">配色 colors（键名必须与该版式 WXSS/Canvas 绘制代码使用的键一致）</p>
    <div id="kv-box"></div>
    <div class="form-actions">
      <button class="btn ghost" id="drawer-cancel">取消</button>
      <button class="btn primary" id="drawer-save">保存</button>
    </div>`);
  kvEditor('#kv-box', p.colors);
  $('#drawer-cancel').addEventListener('click', closeDrawer);
  $('#drawer-save').addEventListener('click', async () => {
    const v = formValues($('#drawer-body'));
    const paper = {
      paper_id: (v.paper_id || '').trim(),
      name: (v.name || '').trim(),
      desc: v.desc || '',
      version: Number(v.version) || 1,
      sort: Number(v.sort) || 0,
      status: v.status,
      colors: kvValues('#kv-box')
    };
    try {
      await api('paperSave', { paper });
      toast('已保存');
      closeDrawer();
      renderPapers();
    } catch (e) {
      alert('保存失败：' + e.message);
    }
  });
}

// ════════ 用户管理 ════════
let userPage = 1;

async function renderUsers() {
  content().innerHTML = '<p class="empty-tip">加载中…</p>';
  try {
    const r = await api('userList', { page: userPage });
    // 头像多为 cloud:// fileID（需 js-sdk 换临时链接，本页不引入 SDK），显示首字占位；
    // 若是 http(s) 直链则正常显示。
    const avatarHtml = (u) => {
      const url = u.avatar && u.avatar.indexOf('http') === 0 ? u.avatar : '';
      return url
        ? `<img class="avatar" src="${esc(url)}" onerror="this.outerHTML='<span class=&quot;avatar-fallback&quot;>${esc((u.nickname || '客')[0])}</span>'">`
        : `<span class="avatar-fallback">${esc((u.nickname || '客')[0])}</span>`;
    };
    content().innerHTML = `
      <h2 class="page-title">用户管理</h2>
      <p class="page-sub">users 集合：仅昵称、注册时间与内容数量统计。依据产品原则，本后台不提供任何信件正文的查看能力。</p>
      <div class="card">
        <table>
          <tr><th>用户</th><th>状态</th><th>注册时间</th><th style="text-align:right">信件</th><th style="text-align:right">重读</th><th style="text-align:right">回信</th></tr>
          ${r.users.map((u) => `<tr class="clickable" data-openid="${esc(u.openid)}" title="点击查看统计详情">
            <td>${avatarHtml(u)} <span style="margin-left:6px">${esc(u.nickname || '（未设置昵称）')}</span></td>
            <td><span class="badge ${u.status === 'active' ? 'online' : 'deactivated'}">${u.status === 'active' ? '正常' : '已注销'}</span></td>
            <td>${fmtDate(u.created_at)}</td>
            <td class="num">${u.letterTotal}</td>
            <td class="num">${u.rereadTotal}</td>
            <td class="num">${u.replyTotal}</td>
          </tr>`).join('')}
        </table>
        ${r.users.length === 0 ? '<p class="empty-tip">暂无用户</p>' : ''}
        <div class="toolbar" style="margin:14px 0 0">
          <button class="btn small" id="u-prev" ${r.page <= 1 ? 'disabled' : ''}>上一页</button>
          <span style="font-size:12px;color:var(--muted)">第 ${r.page} 页 · 共 ${r.total} 人</span>
          <button class="btn small" id="u-next" ${r.page * r.pageSize >= r.total ? 'disabled' : ''}>下一页</button>
        </div>
      </div>`;
    $('#u-prev').addEventListener('click', () => { userPage--; renderUsers(); });
    $('#u-next').addEventListener('click', () => { userPage++; renderUsers(); });
    content().querySelectorAll('tr[data-openid]').forEach((tr) => {
      tr.addEventListener('click', () => toggleUserDetail(tr.dataset.openid, tr));
    });
  } catch (e) {
    content().innerHTML = `<p class="empty-tip">加载失败：${esc(e.message)}</p>`;
  }
}

async function toggleUserDetail(openid, tr) {
  const existed = tr.nextElementSibling;
  if (existed && existed.classList.contains('detail-row')) { existed.remove(); return; }
  document.querySelectorAll('.detail-row').forEach((el) => el.remove());
  try {
    const d = await api('userDetail', { openid });
    const u = d.user || {};
    tr.insertAdjacentHTML('afterend', `<tr class="detail-row"><td colspan="6">
      <div class="detail-grid">
        <span><b>昵称：</b>${esc(u.nickname || '（未设置）')}</span>
        <span><b>注册时间：</b>${fmtDate(u.created_at)}</span>
        <span><b>状态：</b>${u.status === 'active' ? '正常' : '已注销'}</span>
        <span><b>在匣信件：</b>${d.letterTotal}</span>
        <span><b>废纸篓：</b>${d.recycleTotal}</span>
        <span><b>重读：</b>${d.rereadTotal}</span>
        <span><b>回信：</b>${d.replyTotal}</span>
        <span><b>openid：</b>${esc(openid)}</span>
      </div>
    </td></tr>`);
  } catch (e) {
    toast('获取详情失败：' + e.message);
  }
}

// ── 事件绑定与启动 ──
document.querySelectorAll('#nav a').forEach((a) => {
  a.addEventListener('click', () => switchNav(a.dataset.nav));
});
$('#logout-btn').addEventListener('click', logout);
$('#drawer-mask').addEventListener('click', closeDrawer);
$('#login-btn').addEventListener('click', doLogin);
$('#login-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const input = $('#login-key').value.trim();
  const err = $('#login-err');
  if (!input) { err.textContent = '请输入管理员密钥'; return; }
  $('#login-btn').disabled = true;
  err.textContent = '';
  try {
    await tryLogin(input);
  } catch (e) {
    err.textContent = e.message === 'unauthorized' || /密钥/.test(e.message)
      ? '密钥不正确，请检查 admin 云函数里的 FALLBACK_KEY'
      : '连接失败：' + e.message;
  }
  $('#login-btn').disabled = false;
}

(async function boot() {
  if (!key) { showLogin(); return; }
  try {
    await tryLogin(key);
  } catch (e) {
    const err = $('#login-err');
    err.textContent = '自动登录失败：' + e.message;
    showLogin();
  }
})();
