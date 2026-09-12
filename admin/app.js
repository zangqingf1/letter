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
// 密钥存 sessionStorage（仅当前标签页会话有效），不用 localStorage：
// 缩小窗口期，降低 XSS/共用电脑下密钥被长期读取的风险。
let key = sessionStorage.getItem(KEY_STORAGE) || '';

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

// 头像加载失败回落：图片 error 事件不冒泡，必须用捕获阶段监听。
// 取代原来的内联 onerror —— 本页启用了 CSP script-src 'self'，内联事件处理器会被浏览器拦截。
// 用 textContent 写入首字（不解析 HTML），即使昵称含特殊字符也不会形成注入。
document.addEventListener('error', (e) => {
  const el = e.target;
  if (!el || el.tagName !== 'IMG' || !el.dataset || el.dataset.fallback === undefined) return;
  const span = document.createElement('span');
  span.className = 'avatar-fallback';
  span.textContent = el.dataset.fallback || '客';
  if (el.parentNode) el.parentNode.replaceChild(span, el);
}, true);

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
  sessionStorage.removeItem(KEY_STORAGE);
  key = '';
  showLogin();
}

async function tryLogin(inputKey) {
  key = inputKey;
  try {
    await api('auth');
    sessionStorage.setItem(KEY_STORAGE, key);
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
  users: renderUsers,
  members: renderMembers,
  feedback: renderFeedback
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

// 上移/下移箭头按钮（用于主题/版式排序）
function orderArrows(i, len) {
  return `<button type="button" class="btn small arrow" data-order="${i}" data-dir="up" title="上移" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn small arrow" data-order="${i}" data-dir="down" title="下移" ${i === len - 1 ? 'disabled' : ''}>↓</button>`;
}
// 绑定排序按钮：与相邻行交换 sort 后各保存一次，再重渲染当前视图。
// saveFn(item) 调对应 api；rerender 为当前列表渲染函数。
function bindOrder(list, saveFn, rerender) {
  content().querySelectorAll('[data-order]').forEach((b) => b.addEventListener('click', async () => {
    const i = Number(b.dataset.order);
    const j = b.dataset.dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    const a = list[i], c = list[j];
    const aSort = a.sort == null ? i : a.sort;
    const cSort = c.sort == null ? j : c.sort;
    await Promise.all([
      saveFn(Object.assign({}, a, { sort: cSort })),
      saveFn(Object.assign({}, c, { sort: aSort }))
    ]);
    toast('顺序已调整');
    rerender();
  }));
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
        <button class="btn" id="theme-seed">导入官方 1 套</button>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:12px">共 ${r.themes.length} 套</span>
      </div>
      <div class="card">
        ${r.themes.length ? `<table>
          <tr><th>排序</th><th>ID</th><th>名称</th><th>状态</th><th>版本</th><th>信封素材</th><th style="text-align:right">操作</th></tr>
          ${r.themes.map((t, i) => `<tr>
            <td class="num">${t.sort ?? ''}</td>
            <td>${esc(t.theme_id)}</td>
            <td>${esc(t.name)}</td>
            <td><span class="badge ${t.status === 'online' ? 'online' : 'offline'}">${t.status === 'online' ? '上架' : '下架'}</span></td>
            <td class="num">v${t.version || 1}</td>
            <td>${t.assets && t.assets.envelope ? '有' : '—'}</td>
            <td style="text-align:right;white-space:nowrap">
              ${orderArrows(i, r.themes.length)}
              <button class="btn small" data-edit="${esc(t.theme_id)}">编辑</button>
              <button class="btn small" data-toggle="${esc(t.theme_id)}">${t.status === 'online' ? '下架' : '上架'}</button>
              <button class="btn small danger" data-del="${esc(t.theme_id)}">删除</button>
            </td>
          </tr>`).join('')}
        </table>` : '<p class="empty-tip">themes 集合为空。可点「导入官方 1 套」一键建立，或手动新建。</p>'}
      </div>`;
    $('#theme-new').addEventListener('click', () => themeDrawer(null, r.themes.length));
    $('#theme-seed').addEventListener('click', async () => {
      if (!confirm('导入官方 1 套主题？已存在的同 ID 主题会跳过。')) return;
      const res = await api('themeSeed');
      toast(`已导入 ${res.seeded} 套，跳过 ${res.skipped} 套`);
      renderThemes();
    });
    bindOrder(r.themes, (theme) => api('themeSave', { theme }), renderThemes);
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
          ${r.papers.map((p, i) => `<tr>
            <td class="num">${p.sort ?? ''}</td>
            <td>${esc(p.paper_id)}</td>
            <td>${esc(p.name)}</td>
            <td><span class="badge ${p.status === 'online' ? 'online' : 'offline'}">${p.status === 'online' ? '上架' : '下架'}</span></td>
            <td class="num">v${p.version || 1}</td>
            <td class="num">${Object.keys(p.colors || {}).length}</td>
            <td><span class="chip" style="display:inline-block;width:22px;height:22px;border-radius:5px;border:1px solid var(--line);background:${esc(p.colors && p.colors.bg) || 'transparent'}"></span></td>
            <td style="text-align:right;white-space:nowrap">
              ${orderArrows(i, r.papers.length)}
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
    bindOrder(r.papers, (paper) => api('paperSave', { paper }), renderPapers);
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
let userKeyword = '';
let userStatus = 'all';

const USER_STATUS_LABEL = { active: '正常', deactivated: '已注销', banned: '已封禁' };

async function renderUsers() {
  content().innerHTML = '<p class="empty-tip">加载中…</p>';
  try {
    const r = await api('userList', { page: userPage, keyword: userKeyword, status: userStatus });
    // 头像多为 cloud:// fileID（需 js-sdk 换临时链接，本页不引入 SDK），显示首字占位；
    // 若是 http(s) 直链则正常显示。
    const avatarHtml = (u) => {
      // 仅接受 https 直链（cloud:// 需 js-sdk，本页不引入）：避免向任意 http 主机发请求泄露管理员 IP。
      // 加载失败由全局捕获监听回落到 data-fallback 首字，不用内联 onerror（CSP script-src 'self'）。
      const url = u.avatar && u.avatar.indexOf('https://') === 0 ? u.avatar : '';
      const ch = (u.nickname || '客')[0] || '客';
      return url
        ? `<img class="avatar" src="${esc(url)}" data-fallback="${esc(ch)}" referrerpolicy="no-referrer">`
        : `<span class="avatar-fallback">${esc(ch)}</span>`;
    };
    const statusBadge = (status) =>
      `<span class="badge ${status === 'active' ? 'online' : status === 'banned' ? 'banned' : 'deactivated'}">${USER_STATUS_LABEL[status] || status}</span>`;
    const vipBadge = (u) =>
      u.memberState === 'vip'
        ? `<span class="badge vip" title="${esc(u.memberLevel || '')} 会员">👑 VIP</span>`
        : '<span class="badge offline">普通</span>';
    content().innerHTML = `
      <h2 class="page-title">用户管理</h2>
      <p class="page-sub">users 集合：仅昵称、注册时间与内容数量统计；支持昵称搜索与状态筛选，可封禁/解封账号。依据产品原则，本后台不提供任何信件正文的查看能力。</p>
      <div class="toolbar">
        <input id="u-keyword" type="text" placeholder="按昵称搜索…" value="${esc(userKeyword)}" style="width:200px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff">
        <select id="u-status" style="padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff">
          <option value="all" ${userStatus === 'all' ? 'selected' : ''}>全部状态</option>
          <option value="active" ${userStatus === 'active' ? 'selected' : ''}>正常</option>
          <option value="banned" ${userStatus === 'banned' ? 'selected' : ''}>已封禁</option>
          <option value="deactivated" ${userStatus === 'deactivated' ? 'selected' : ''}>已注销</option>
        </select>
        <button class="btn" id="u-search">搜索</button>
        <button class="btn ghost" id="u-reset">重置</button>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:12px">共 ${r.total} 人</span>
      </div>
      <div class="card">
        <table>
          <tr><th>用户</th><th>状态</th><th>会员</th><th>注册时间</th><th style="text-align:right">信件</th><th style="text-align:right">重读</th><th style="text-align:right">回信</th><th style="text-align:right">操作</th></tr>
          ${r.users.map((u) => `<tr class="clickable" data-openid="${esc(u.openid)}" title="点击查看统计详情">
            <td>${avatarHtml(u)} <span style="margin-left:6px">${esc(u.nickname || '（未设置昵称）')}</span></td>
            <td>${statusBadge(u.status)}</td>
            <td>${vipBadge(u)}</td>
            <td>${fmtDate(u.created_at)}</td>
            <td class="num">${u.letterTotal}</td>
            <td class="num">${u.rereadTotal}</td>
            <td class="num">${u.replyTotal}</td>
            <td style="text-align:right">
              ${u.status === 'banned'
                ? `<button class="btn small" data-unban="${esc(u.openid)}">解封</button>`
                : `<button class="btn small danger" data-ban="${esc(u.openid)}">封禁</button>`}
            </td>
          </tr>`).join('')}
        </table>
        ${r.users.length === 0 ? '<p class="empty-tip">暂无符合条件的用户</p>' : ''}
        <div class="toolbar" style="margin:14px 0 0">
          <button class="btn small" id="u-prev" ${r.page <= 1 ? 'disabled' : ''}>上一页</button>
          <span style="font-size:12px;color:var(--muted)">第 ${r.page} 页</span>
          <button class="btn small" id="u-next" ${r.page * r.pageSize >= r.total ? 'disabled' : ''}>下一页</button>
        </div>
      </div>`;
    $('#u-search').addEventListener('click', () => { userKeyword = $('#u-keyword').value.trim(); userPage = 1; renderUsers(); });
    $('#u-keyword').addEventListener('keydown', (e) => { if (e.key === 'Enter') { userKeyword = $('#u-keyword').value.trim(); userPage = 1; renderUsers(); } });
    $('#u-status').addEventListener('change', (e) => { userStatus = e.target.value; userPage = 1; renderUsers(); });
    $('#u-reset').addEventListener('click', () => { userKeyword = ''; userStatus = 'all'; userPage = 1; renderUsers(); });
    $('#u-prev').addEventListener('click', () => { userPage--; renderUsers(); });
    $('#u-next').addEventListener('click', () => { userPage++; renderUsers(); });
    content().querySelectorAll('[data-ban]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const u = r.users.find((x) => x.openid === b.dataset.ban);
      if (!confirm(`封禁用户「${u.nickname || u.openid}」？该用户在小程序端将被拒绝使用（可在用户管理解封）。`)) return;
      await api('userBan', { openid: u.openid });
      toast('已封禁');
      renderUsers();
    }));
    content().querySelectorAll('[data-unban]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const u = r.users.find((x) => x.openid === b.dataset.unban);
      if (!confirm(`解封用户「${u.nickname || u.openid}」？该用户可恢复正常使用。`)) return;
      await api('userUnban', { openid: u.openid });
      toast('已解封');
      renderUsers();
    }));
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
    const m = d.member;
    const memberHtml = m
      ? (m.state === 'vip'
        ? `👑 ${esc(m.plan_name || '会员')} · 到期 ${fmtDate(m.expires_at)}${m.renew ? ' · 自动续费' : ''}`
        : '已取消')
      : '—（未开通）';
    tr.insertAdjacentHTML('afterend', `<tr class="detail-row"><td colspan="8">
      <div class="detail-grid">
        <span><b>昵称：</b>${esc(u.nickname || '（未设置）')}</span>
        <span><b>注册时间：</b>${fmtDate(u.created_at)}</span>
        <span><b>状态：</b>${USER_STATUS_LABEL[u.status] || u.status}</span>
        <span><b>在匣信件：</b>${d.letterTotal}</span>
        <span><b>废纸篓：</b>${d.recycleTotal}</span>
        <span><b>草稿：</b>${d.draftTotal}</span>
        <span><b>重读：</b>${d.rereadTotal}</span>
        <span><b>回信：</b>${d.replyTotal}</span>
        <span><b>会员：</b>${memberHtml}</span>
        <span><b>openid：</b><code>${esc(openid)}</code></span>
      </div>
      <div class="detail-actions">
        ${m && m.state === 'vip'
          ? `<button class="btn small" id="d-revoke">取消会员</button>`
          : `<button class="btn small" id="d-grant">设为会员</button>`}
      </div>
    </td></tr>`);
    const grantBtn = tr.nextElementSibling.querySelector('#d-grant');
    if (grantBtn) grantBtn.addEventListener('click', () => memberGrantDrawer(null, openid));
    const revokeBtn = tr.nextElementSibling.querySelector('#d-revoke');
    if (revokeBtn) revokeBtn.addEventListener('click', async () => {
      if (!confirm('取消该用户会员资格？')) return;
      await api('memberRevoke', { openid });
      toast('已取消会员');
      renderUsers();
    });
  } catch (e) {
    toast('获取详情失败：' + e.message);
  }
}

// ════════ 会员管理 ════════
let memberTab = 'users';
let memberPage = 1;
let memberStateFilter = 'vip';
let memberItemKind = 'paper';

const MEMBER_KIND_LABEL = { paper: '信纸', theme: '信封' };

const MEMBER_PLAN_DAYS = { month: 30, quarter: 90, year: 365 };

function avatarImg(avatar, nickname) {
  // 同 avatarHtml：仅 https 直链 + data-fallback，加载失败由全局捕获监听回落（无内联 onerror）
  const url = avatar && avatar.indexOf('https://') === 0 ? avatar : '';
  const ch = ((nickname || '客')[0] || '客');
  return url
    ? `<img class="avatar" src="${esc(url)}" data-fallback="${esc(ch)}" referrerpolicy="no-referrer">`
    : `<span class="avatar-fallback">${esc(ch)}</span>`;
}

async function renderMembers() {
  content().innerHTML = `
    <h2 class="page-title">会员管理</h2>
    <p class="page-sub">members 集合维护 VIP 用户状态（后台开通/小程序发货推送共同写入），member_items 集合维护专属版式/主题内容。小程序端已接入真实虚拟支付，发货推送由 member 云函数写本表。</p>
    <div class="tabs">
      <button class="tab-btn ${memberTab === 'users' ? 'active' : ''}" data-mtab="users">VIP 用户</button>
      <button class="tab-btn ${memberTab === 'items' ? 'active' : ''}" data-mtab="items">专属内容</button>
    </div>
    <div id="member-body"><p class="empty-tip">加载中…</p></div>`;
  content().querySelectorAll('[data-mtab]').forEach((b) => {
    b.addEventListener('click', () => { memberTab = b.dataset.mtab; renderMembers(); });
  });
  if (memberTab === 'users') renderMemberUsers();
  else renderMemberItems();
}

async function renderMemberUsers() {
  const box = $('#member-body');
  try {
    const r = await api('memberList', { page: memberPage, state: memberStateFilter });
    box.innerHTML = `
      <div class="toolbar">
        <select id="m-state" style="padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff">
          <option value="vip" ${memberStateFilter === 'vip' ? 'selected' : ''}>仅 VIP</option>
          <option value="all" ${memberStateFilter === 'all' ? 'selected' : ''}>全部</option>
          <option value="free" ${memberStateFilter === 'free' ? 'selected' : ''}>仅已取消</option>
        </select>
        <button class="btn primary" id="m-grant-new">＋ 开通会员</button>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:12px">共 ${r.total} 条</span>
      </div>
      <div class="card">
        <table>
          <tr><th>用户</th><th>状态</th><th>套餐</th><th>到期时间</th><th>开通时间</th><th style="text-align:right">操作</th></tr>
          ${r.members.length ? r.members.map((m) => `<tr>
            <td>${avatarImg(m.avatar, m.nickname)} <span style="margin-left:6px">${esc(m.nickname || '（未设置昵称）')}</span>
              <div style="font-size:11px;color:var(--muted)"><code>${esc(m.openid)}</code></div></td>
            <td>${m.state === 'vip' ? '<span class="badge vip">VIP</span>' : '<span class="badge offline">已取消</span>'}</td>
            <td>${esc(m.plan_name || '—')}</td>
            <td>${m.state === 'vip' ? fmtDate(m.expires_at) : '—'}</td>
            <td>${fmtDate(m.granted_at)}</td>
            <td style="text-align:right">
              ${m.state === 'vip'
                ? `<button class="btn small" data-renew="${esc(m.openid)}">续期</button>
                   <button class="btn small danger" data-revoke="${esc(m.openid)}">取消</button>`
                : `<button class="btn small" data-reopen="${esc(m.openid)}">重新开通</button>`}
            </td>
          </tr>`).join('') : '<tr><td colspan="6" class="empty-tip" style="padding:24px 0">暂无会员记录，可点「＋ 开通会员」按 openid 开通</td></tr>'}
        </table>
        <div class="toolbar" style="margin:14px 0 0">
          <button class="btn small" id="m-prev" ${r.page <= 1 ? 'disabled' : ''}>上一页</button>
          <span style="font-size:12px;color:var(--muted)">第 ${r.page} 页</span>
          <button class="btn small" id="m-next" ${r.page * r.pageSize >= r.total ? 'disabled' : ''}>下一页</button>
        </div>
      </div>`;
    $('#m-state').addEventListener('change', (e) => { memberStateFilter = e.target.value; memberPage = 1; renderMemberUsers(); });
    $('#m-grant-new').addEventListener('click', () => memberGrantDrawer(null, ''));
    $('#m-prev').addEventListener('click', () => { memberPage--; renderMemberUsers(); });
    $('#m-next').addEventListener('click', () => { memberPage++; renderMemberUsers(); });
    content().querySelectorAll('[data-renew]').forEach((b) => b.addEventListener('click', () => {
      const m = r.members.find((x) => x.openid === b.dataset.renew);
      memberGrantDrawer(m);
    }));
    content().querySelectorAll('[data-reopen]').forEach((b) => b.addEventListener('click', () => {
      const m = r.members.find((x) => x.openid === b.dataset.reopen);
      memberGrantDrawer(m);
    }));
    content().querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
      const m = r.members.find((x) => x.openid === b.dataset.revoke);
      if (!confirm(`取消用户「${m.nickname || m.openid}」的会员资格？`)) return;
      await api('memberRevoke', { openid: m.openid });
      toast('已取消会员');
      renderMemberUsers();
    }));
  } catch (e) {
    box.innerHTML = `<p class="empty-tip">加载失败：${esc(e.message)}</p>`;
  }
}

// 开通/续期抽屉。m 为已有 member（续期/重开），prefillOpenid 供用户管理详情页快捷传入。
function memberGrantDrawer(m, prefillOpenid) {
  const isEdit = !!(m && m.state === 'vip');
  const openid = m ? m.openid : (prefillOpenid || '');
  const plan = (m && m.level) || 'month';
  let days = 30;
  if (m && m.state === 'vip') {
    days = Math.max(1, Math.ceil((new Date(m.expires_at) - Date.now()) / 86400000));
  }
  openDrawer(`
    <h3>${isEdit ? '续期会员 · ' + esc(m.nickname || openid) : '开通会员'}</h3>
    ${textField('openid', '用户 openid（可在用户管理点行展开复制）', openid, { disabled: !!m })}
    ${field('套餐', `<select data-f="plan">
      <option value="month" ${plan === 'month' ? 'selected' : ''}>月卡 · 30 天</option>
      <option value="quarter" ${plan === 'quarter' ? 'selected' : ''}>季卡 · 90 天</option>
      <option value="year" ${plan === 'year' ? 'selected' : ''}>年卡 · 365 天</option>
      <option value="custom" ${plan === 'custom' ? 'selected' : ''}>自定义天数</option>
    </select>`)}
    ${numField('days', '有效期（天，1–3650）', days)}
    ${field('自动续费标记', `<select data-f="renew">
      <option value="0" ${!m || !m.renew ? 'selected' : ''}>否</option>
      <option value="1" ${m && m.renew ? 'selected' : ''}>是（仅标记，本期无真实扣款）</option>
    </select>`)}
    <div class="form-actions">
      <button class="btn ghost" id="drawer-cancel">取消</button>
      <button class="btn primary" id="drawer-save">${isEdit ? '续期' : '开通'}</button>
    </div>`);
  const drawer = $('#drawer-body');
  drawer.querySelector('[data-f="plan"]').addEventListener('change', (e) => {
    const daysEl = drawer.querySelector('[data-f="days"]');
    if (MEMBER_PLAN_DAYS[e.target.value]) daysEl.value = MEMBER_PLAN_DAYS[e.target.value];
  });
  $('#drawer-cancel').addEventListener('click', closeDrawer);
  $('#drawer-save').addEventListener('click', async () => {
    const v = formValues(drawer);
    const oid = (v.openid || '').trim();
    if (!oid) { alert('请填写 openid'); return; }
    const days = Number(v.days);
    if (!(days > 0) || days > 3650) { alert('有效期天数需为 1–3650'); return; }
    try {
      await api('memberGrant', { openid: oid, plan: v.plan, days, renew: isEdit ? v.renew === '1' : !!m && v.renew === '1' });
      toast(isEdit ? '已续期' : '已开通会员');
      closeDrawer();
      // 从会员页进入则刷新会员列表；从用户管理详情进入则刷新用户列表（会员徽标同步）
      if (currentNav === 'members') renderMemberUsers();
      else renderUsers();
    } catch (e) {
      alert('保存失败：' + e.message);
    }
  });
}

async function renderMemberItems() {
  const box = $('#member-body');
  try {
    const r = await api('memberItemList', { kind: memberItemKind });
    const swatchOf = (it) => (it.kind === 'theme' ? it.swatch : (it.colors && it.colors.bg)) || '';
    box.innerHTML = `
      <div class="tabs">
        <button class="tab-btn ${memberItemKind === 'paper' ? 'active' : ''}" data-mikind="paper">信纸</button>
        <button class="tab-btn ${memberItemKind === 'theme' ? 'active' : ''}" data-mikind="theme">信封</button>
      </div>
      <div class="toolbar">
        <button class="btn primary" id="mi-new">＋ 新建专属${MEMBER_KIND_LABEL[memberItemKind]}</button>
        <button class="btn" id="mi-seed">导入官方 5 款</button>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:12px">共 ${r.items.length} 款</span>
      </div>
      <div class="card">
        ${r.items.length ? `<table>
          <tr><th>排序</th><th>ID</th><th>名称</th><th>状态</th><th>色样</th><th style="text-align:right">操作</th></tr>
          ${r.items.map((it) => `<tr>
            <td class="num">${it.sort ?? ''}</td>
            <td>${esc(it.item_id)}</td>
            <td>${esc(it.name)} <span style="color:var(--muted)">· ${esc(it.desc || '')}</span></td>
            <td><span class="badge ${it.status === 'online' ? 'online' : 'offline'}">${it.status === 'online' ? '上架' : '下架'}</span></td>
            <td><span class="chip" style="display:inline-block;width:22px;height:22px;border-radius:5px;border:1px solid var(--line);background:${esc(swatchOf(it)) || 'transparent'}"></span></td>
            <td style="text-align:right">
              <button class="btn small" data-edit="${esc(it.kind)}|${esc(it.item_id)}">编辑</button>
              <button class="btn small" data-toggle="${esc(it.kind)}|${esc(it.item_id)}">${it.status === 'online' ? '下架' : '上架'}</button>
              <button class="btn small danger" data-del="${esc(it.kind)}|${esc(it.item_id)}">删除</button>
            </td>
          </tr>`).join('')}
        </table>` : `<p class="empty-tip">暂无专属${MEMBER_KIND_LABEL[memberItemKind]}。可点「＋ 新建」手动创建，或从已有${MEMBER_KIND_LABEL[memberItemKind]}中挑选加入。</p>`}
      </div>`;
    box.querySelectorAll('[data-mikind]').forEach((b) => {
      b.addEventListener('click', () => { memberItemKind = b.dataset.mikind; renderMemberItems(); });
    });
    $('#mi-new').addEventListener('click', () => memberItemDrawer(null, r.items.length, memberItemKind));
    $('#mi-seed').addEventListener('click', async () => {
      if (!confirm('导入官方 5 款专属内容（3 信纸 + 2 信封）？已存在的同 ID 会跳过。')) return;
      const res = await api('memberItemSeed');
      toast(`已导入 ${res.seeded} 款，跳过 ${res.skipped} 款`);
      renderMemberItems();
    });
    box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const [kind, id] = b.dataset.edit.split('|');
      const it = r.items.find((x) => x.kind === kind && x.item_id === id);
      memberItemDrawer(it);
    }));
    box.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      const [kind, id] = b.dataset.toggle.split('|');
      const it = r.items.find((x) => x.kind === kind && x.item_id === id);
      await api('memberItemSave', { item: Object.assign({}, it, { status: it.status === 'online' ? 'offline' : 'online' }) });
      toast(it.status === 'online' ? '已下架' : '已上架');
      renderMemberItems();
    }));
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const [kind, id] = b.dataset.del.split('|');
      const it = r.items.find((x) => x.kind === kind && x.item_id === id);
      if (!confirm(`彻底删除专属款「${it.name}」？`)) return;
      await api('memberItemDelete', { kind, item_id: id });
      toast('已删除');
      renderMemberItems();
    }));
  } catch (e) {
    box.innerHTML = `<p class="empty-tip">加载失败：${esc(e.message)}</p>`;
  }
}

// 专属内容抽屉。it 为已有项（编辑）；nextSort 为新建时的初始排序；
// presetKind 由「信纸/信封」子 Tab 决定，新建时类型固定（与子 Tab 一致）。
async function memberItemDrawer(it, nextSort, presetKind) {
  const isNew = !it;
  const kind = presetKind || (it && it.kind) || 'paper';
  const kindLabel = MEMBER_KIND_LABEL[kind];
  it = it || { kind, item_id: '', name: '', desc: '', version: 1, status: 'online', sort: nextSort || 0, colors: {}, swatch: '', assets: {} };
  // 候选来源：从已有的 papers/themes 中挑选加入（失败则仅保留手动新建）
  let candidates = [];
  try {
    const src = await api(kind === 'paper' ? 'paperList' : 'themeList');
    candidates = (kind === 'paper' ? src.papers : src.themes) || [];
  } catch (e) { /* 忽略，保留手动新建 */ }
  const candidateIdOf = (c) => (kind === 'paper' ? c.paper_id : c.theme_id);
  const candidateLabelOf = (c) => `${c.name}（${candidateIdOf(c)}）`;
  openDrawer(`
    <h3>${isNew ? '新建专属' + kindLabel : '编辑专属款 · ' + esc(it.name)}</h3>
    ${field('类型', `<span style="font-size:13px;color:var(--ink)">专属${kindLabel}（${kind === 'paper' ? '信纸版式' : '主题信封'}）</span>`)}
    ${isNew ? field('来源', `<select data-f="source">
      <option value="">— 手动新建 —</option>
      ${candidates.map((c) => `<option value="${esc(candidateIdOf(c))}">${esc(candidateLabelOf(c))}</option>`).join('')}
    </select><p style="font-size:11px;color:var(--muted);margin-top:4px">从已有${kindLabel}中挑选，自动带入 ID/名称/配色，可修改后保存为会员专属款</p>`) : ''}
    ${textField('item_id', 'ID（字母，创建后作为唯一键）', it.item_id, { disabled: !isNew })}
    ${textField('name', '名称', it.name)}
    ${textField('desc', '描述', it.desc)}
    <div class="field-row">
      ${numField('version', '版本号', it.version)}
      ${numField('sort', '排序（小在前）', it.sort)}
    </div>
    ${field('状态', `<select data-f="status">
      <option value="online" ${it.status === 'online' ? 'selected' : ''}>上架</option>
      <option value="offline" ${it.status !== 'online' ? 'selected' : ''}>下架</option>
    </select>`)}
    <div id="mi-kind-body"></div>
    <div class="form-actions">
      <button class="btn ghost" id="drawer-cancel">取消</button>
      <button class="btn primary" id="drawer-save">保存</button>
    </div>`);
  const drawer = $('#drawer-body');
  const renderKindBody = () => {
    const body = drawer.querySelector('#mi-kind-body');
    if (kind === 'paper') {
      body.innerHTML = '<p style="font-size:12px;color:var(--muted);margin:14px 0 8px">配色 colors（键名与该版式绘制代码一致）</p><div id="kv-box"></div>';
      kvEditor('#kv-box', it.colors);
    } else {
      const a = it.assets || {};
      const pal = it.palette || {};
      body.innerHTML = `
        <p style="font-size:12px;color:var(--muted);margin:14px 0 8px">主题色样 swatch（无信封素材时选择卡片显示色样）</p>
        <div id="mi-swatch"></div>
        <p style="font-size:12px;color:var(--muted);margin:14px 0 8px">桌面底色 desk（写信第二步预览区背景）与信纸基础底色 palette.base（卡片/拆信兜底色）</p>
        <div id="mi-desk"></div>
        <div id="mi-palette-base"></div>
        <p style="font-size:12px;color:var(--muted);margin:14px 0 8px">信封素材（小程序包内路径或云存储 fileID，留空则回落默认信封；会员中心/写信页卡片显示真实信封图）</p>
        <div id="mi-env-envelope"></div>
        <div id="mi-env-thumb"></div>`;
      document.querySelector('#mi-swatch').innerHTML = colorField('swatch', '色样 swatch', it.swatch);
      document.querySelector('#mi-desk').innerHTML = colorField('desk', '桌面底色 desk', it.desk || '');
      document.querySelector('#mi-palette-base').innerHTML = colorField('paletteBase', '信纸底色 palette.base', pal.base || '');
      document.querySelector('#mi-env-envelope').innerHTML = textField('envEnvelope', '信封大图 envelope', a.envelope || '');
      document.querySelector('#mi-env-thumb').innerHTML = textField('envThumb', '信封缩略图 envelopeThumb', a.envelopeThumb || '');
      bindColorPairs(body);
    }
  };
  renderKindBody();
  const sourceSel = drawer.querySelector('[data-f="source"]');
  if (sourceSel) {
    sourceSel.addEventListener('change', (e) => {
      const cand = candidates.find((c) => candidateIdOf(c) === e.target.value);
      drawer.querySelector('[data-f="item_id"]').value = cand ? candidateIdOf(cand) : '';
      drawer.querySelector('[data-f="name"]').value = cand ? (cand.name || '') : '';
      drawer.querySelector('[data-f="desc"]').value = cand ? (cand.desc || '') : '';
      it.colors = cand && kind === 'paper' ? (cand.colors || {}) : {};
      it.swatch = cand && kind === 'theme' ? (cand.swatch || '') : '';
      it.palette = cand && kind === 'theme' ? (cand.palette || {}) : {};
      it.desk = cand && kind === 'theme' ? (cand.desk || '') : '';
      it.assets = cand && kind === 'theme' ? (cand.assets || {}) : {};
      renderKindBody();
    });
  }
  $('#drawer-cancel').addEventListener('click', closeDrawer);
  $('#drawer-save').addEventListener('click', async () => {
    const v = formValues(drawer);
    const item = {
      kind,
      item_id: (v.item_id || '').trim(),
      name: (v.name || '').trim(),
      desc: v.desc || '',
      version: Number(v.version) || 1,
      sort: Number(v.sort) || 0,
      status: v.status
    };
    if (kind === 'paper') item.colors = kvValues('#kv-box');
    else {
      item.swatch = v.swatch || '';
      item.desk = v.desk || '';
      // 保留未在抽屉编辑的 palette 其余键（title/text/tag），只覆盖 base
      const pal = (it && it.palette) || {};
      item.palette = Object.assign({}, pal, v.paletteBase ? { base: v.paletteBase } : {});
      item.assets = { envelope: v.envEnvelope || '', envelopeThumb: v.envThumb || '' };
    }
    try {
      await api('memberItemSave', { item });
      toast('已保存');
      closeDrawer();
      renderMemberItems();
    } catch (e) {
      alert('保存失败：' + e.message);
    }
  });
}

// ════════ 问题反馈 ════════
let fbPage = 1;
let fbStatus = 'all';

const FB_STATUS_LABEL = { new: '待处理', done: '已处理' };

function fbStatusBadge(status) {
  return `<span class="badge ${status === 'done' ? 'online' : 'new'}">${FB_STATUS_LABEL[status] || status}</span>`;
}

async function renderFeedback() {
  content().innerHTML = '<p class="empty-tip">加载中…</p>';
  try {
    const r = await api('feedbackList', { page: fbPage, status: fbStatus });
    content().innerHTML = `
      <h2 class="page-title">问题反馈</h2>
      <p class="page-sub">feedback 集合：用户主动提交给开发者的问题反馈（非信件正文，属隐私红线例外），可查看全文与截图、标记已处理/恢复待处理，或删除单条（连同云端截图）。</p>
      <div class="toolbar">
        <select id="fb-status" style="padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff">
          <option value="all" ${fbStatus === 'all' ? 'selected' : ''}>全部状态</option>
          <option value="new" ${fbStatus === 'new' ? 'selected' : ''}>待处理</option>
          <option value="done" ${fbStatus === 'done' ? 'selected' : ''}>已处理</option>
        </select>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:12px">共 ${r.total} 条</span>
      </div>
      <div class="card">
        <table>
          <tr><th>状态</th><th>内容摘要</th><th>联系方式</th><th style="text-align:center">截图</th><th>提交时间</th><th style="text-align:right">操作</th></tr>
          ${r.items.map((it) => `<tr class="clickable" data-fid="${esc(it.id)}" title="点击查看详情">
            <td>${fbStatusBadge(it.status)}</td>
            <td style="max-width:340px"><span class="fb-snip">${esc(it.content)}</span></td>
            <td>${esc(it.contact || '—')}</td>
            <td style="text-align:center">${it.imageCount ? '📷 ' + it.imageCount : '—'}</td>
            <td>${fmtDate(it.created_at)}</td>
            <td style="text-align:right;white-space:nowrap">
              ${it.status === 'new'
                ? `<button class="btn small" data-fb-done="${esc(it.id)}">标记已处理</button>`
                : `<button class="btn small" data-fb-pending="${esc(it.id)}">恢复待处理</button>`}
              <button class="btn small danger" data-fb-del="${esc(it.id)}">删除</button>
            </td>
          </tr>`).join('')}
        </table>
        ${r.items.length === 0 ? '<p class="empty-tip">暂无反馈</p>' : ''}
        <div class="toolbar" style="margin:14px 0 0">
          <button class="btn small" id="fb-prev" ${r.page <= 1 ? 'disabled' : ''}>上一页</button>
          <span style="font-size:12px;color:var(--muted)">第 ${r.page} 页</span>
          <button class="btn small" id="fb-next" ${r.page * r.pageSize >= r.total ? 'disabled' : ''}>下一页</button>
        </div>
      </div>`;
    $('#fb-status').addEventListener('change', (e) => { fbStatus = e.target.value; fbPage = 1; renderFeedback(); });
    $('#fb-prev').addEventListener('click', () => { if (fbPage > 1) { fbPage--; renderFeedback(); } });
    $('#fb-next').addEventListener('click', () => { fbPage++; renderFeedback(); });
    bindFeedbackActions(r.items);
    content().querySelectorAll('tr[data-fid]').forEach((tr) => {
      tr.addEventListener('click', () => toggleFeedbackDetail(tr.dataset.fid, tr));
    });
  } catch (e) {
    content().innerHTML = `<p class="empty-tip">加载失败：${esc(e.message)}</p>`;
  }
}

// 行内操作：标记已处理 / 恢复待处理 / 删除（数据即当页 items，按 id 反查对象）
function bindFeedbackActions(items) {
  content().querySelectorAll('[data-fb-done]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await api('feedbackUpdate', { id: b.dataset.fbDone, status: 'done' });
      toast('已标记为已处理');
      renderFeedback();
    } catch (err) { toast(err.message); }
  }));
  content().querySelectorAll('[data-fb-pending]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await api('feedbackUpdate', { id: b.dataset.fbPending, status: 'new' });
      toast('已恢复为待处理');
      renderFeedback();
    } catch (err) { toast(err.message); }
  }));
  content().querySelectorAll('[data-fb-del]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const it = items.find((x) => x.id === b.dataset.fbDel);
    if (!confirm(`删除这条反馈？将连同其云端截图一并删除，不可恢复。${it && it.contact ? '\n联系线索：' + it.contact : ''}`)) return;
    try {
      await api('feedbackDelete', { id: it.id });
      toast('已删除');
      renderFeedback();
    } catch (err) { toast(err.message); }
  }));
}

async function toggleFeedbackDetail(id, tr) {
  const existed = tr.nextElementSibling;
  if (existed && existed.classList.contains('detail-row')) { existed.remove(); return; }
  document.querySelectorAll('.detail-row').forEach((el) => el.remove());
  try {
    const d = await api('feedbackDetail', { id });
    const f = d.detail;
    const viewable = f.images.filter((img) => img.url);
    const shotsHtml = f.images.length
      ? `<div class="fb-shots">${f.images.map((img) => img.url
        ? `<img class="fb-thumb" src="${esc(img.url)}" data-lb="${viewable.indexOf(img)}" alt="反馈截图" title="点击放大预览">`
        : `<span class="fb-fileid" title="${esc(img.fileID)}">${esc(img.fileID)}</span>`).join('')}</div>`
      : '<p class="fb-none">未附截图</p>';
    tr.insertAdjacentHTML('afterend', `<tr class="detail-row"><td colspan="6">
      <div class="fb-box">
        <div class="fb-kv">
          <span>${fbStatusBadge(f.status)}</span>
          <span><b>提交时间：</b>${fmtDate(f.created_at)}</span>
          ${f.status === 'done' ? `<span><b>处理时间：</b>${fmtDate(f.handled_at)}</span>` : ''}
          <span><b>联系方式：</b>${esc(f.contact || '（未填）')}</span>
          <span><b>设备：</b>${esc(f.device || '—')}</span>
          <span><b>openid：</b><code>${esc(f.openid)}</code></span>
        </div>
        <p class="fb-label"><b>反馈全文：</b></p>
        <p class="fb-full">${esc(f.content)}</p>
        <p class="fb-label"><b>截图预览（${f.images.length} 张，点击放大）：</b></p>
        ${shotsHtml}
      </div>
      <div class="detail-actions">
        ${f.status === 'new'
          ? `<button class="btn small" id="fb-d-done">标记已处理</button>`
          : `<button class="btn small" id="fb-d-pending">恢复待处理</button>`}
        <button class="btn small danger" id="fb-d-del">删除这条反馈</button>
      </div>
    </td></tr>`);
    const row = tr.nextElementSibling;
    const act = (btnId, status, msg) => {
      const btn = row.querySelector(btnId);
      if (!btn) return;
      btn.addEventListener('click', async () => {
        try {
          await api('feedbackUpdate', { id, status });
          toast(msg);
          renderFeedback();
        } catch (err) { toast(err.message); }
      });
    };
    act('#fb-d-done', 'done', '已标记为已处理');
    act('#fb-d-pending', 'new', '已恢复为待处理');
    row.querySelector('#fb-d-del').addEventListener('click', async () => {
      if (!confirm('删除这条反馈？将连同其云端截图一并删除，不可恢复。')) return;
      try {
        await api('feedbackDelete', { id });
        toast('已删除');
        renderFeedback();
      } catch (err) { toast(err.message); }
    });
    // 截图点击 → 页内灯箱放大预览（不再新开标签，避免云端临时链接被浏览器直接下载）
    row.querySelectorAll('.fb-thumb').forEach((im) => im.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openLightbox(viewable, Number(im.dataset.lb));
    }));
  } catch (e) {
    toast('获取详情失败：' + e.message);
  }
}

// ── 截图灯箱预览 ──
let lightboxList = [];
let lightboxIndex = 0;

function openLightbox(list, index) {
  lightboxList = (list || []).filter((im) => im && im.url);
  if (!lightboxList.length) return;
  lightboxIndex = Math.min(Math.max(0, index || 0), lightboxList.length - 1);
  renderLightbox();
  $('#lightbox').classList.remove('hidden');
}

function renderLightbox() {
  const cur = lightboxList[lightboxIndex];
  if (!cur) return;
  $('#lightbox-img').src = cur.url;
  $('#lightbox-count').textContent = `${lightboxIndex + 1} / ${lightboxList.length}`;
  const multi = lightboxList.length > 1;
  $('#lightbox-prev').style.display = multi ? '' : 'none';
  $('#lightbox-next').style.display = multi ? '' : 'none';
}

function closeLightbox() {
  $('#lightbox').classList.add('hidden');
  $('#lightbox-img').src = '';
}

function lightboxStep(step) {
  if (lightboxList.length < 2) return;
  lightboxIndex = (lightboxIndex + step + lightboxList.length) % lightboxList.length;
  renderLightbox();
}

// ── 事件绑定与启动 ──
document.querySelectorAll('#nav a').forEach((a) => {
  a.addEventListener('click', () => switchNav(a.dataset.nav));
});
$('#logout-btn').addEventListener('click', logout);
$('#drawer-mask').addEventListener('click', closeDrawer);
// 灯箱：点遮罩或 ✕ 关闭；←/→ 翻图；Esc 关闭
$('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
$('#lightbox-close').addEventListener('click', closeLightbox);
$('#lightbox-prev').addEventListener('click', (e) => { e.stopPropagation(); lightboxStep(-1); });
$('#lightbox-next').addEventListener('click', (e) => { e.stopPropagation(); lightboxStep(1); });
document.addEventListener('keydown', (e) => {
  if ($('#lightbox').classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') lightboxStep(-1);
  else if (e.key === 'ArrowRight') lightboxStep(1);
});
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
      ? '密钥不正确：请检查控制台里 admin 云函数的环境变量 ADMIN_KEY'
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
