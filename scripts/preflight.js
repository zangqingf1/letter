#!/usr/bin/env node
/**
 * 心灵信箱 · 提交前静态预检（零依赖，node scripts/preflight.js）
 *
 * 本仓库无测试框架与构建命令，这个脚本承担「机器能判的部分」，把人工测试的
 * 精力留给真机交互。它只读代码、不修改任何文件。
 *
 * 判定分两档：
 *   FAIL —— 违反架构硬约束（隐私红线、密钥外泄、数据层被绕过），必须修
 *   WARN —— 需人工确认的疑似问题（通常是漏 limit 或投影字段）
 *
 * 退出码：有 FAIL 时为 1，否则 0（WARN 不阻断）。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const results = [];

function record(level, title, details) {
  results.push({ level, title, details: details || [] });
}

function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const read = (p) => fs.readFileSync(p, 'utf8');

const miniJs = walk(path.join(ROOT, 'miniprogram'), (f) => f.endsWith('.js'));
const pageJs = walk(path.join(ROOT, 'miniprogram', 'pages'), (f) => f.endsWith('.js'));
const serviceJs = walk(path.join(ROOT, 'miniprogram', 'services'), (f) => f.endsWith('.js'));
const adminJs = walk(path.join(ROOT, 'admin'), (f) => f.endsWith('.js'));
const testsJs = walk(path.join(ROOT, 'tests'), (f) => f.endsWith('.js'));
const scriptsJs = walk(path.join(ROOT, 'scripts'), (f) => f.endsWith('.js'));
const fnDirs = fs.existsSync(path.join(ROOT, 'cloudfunctions'))
  ? fs.readdirSync(path.join(ROOT, 'cloudfunctions'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  : [];
const fnEntries = fnDirs
  .map((n) => path.join(ROOT, 'cloudfunctions', n, 'index.js'))
  .filter((p) => fs.existsSync(p));

// ── 1. 语法：所有 JS 能被 Node 解析 ─────────────────────────────────────
(function checkSyntax() {
  const targets = [...miniJs, ...adminJs, ...testsJs, ...scriptsJs, ...fnEntries,
    ...fnDirs.map((n) => path.join(ROOT, 'cloudfunctions', n, 'config.js')).filter((p) => fs.existsSync(p))];
  const bad = [];
  for (const f of targets) {
    try {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    } catch (e) {
      bad.push(`${rel(f)}\n    ${String(e.stderr || e.message).split('\n').slice(0, 3).join('\n    ')}`);
    }
  }
  record(bad.length ? 'FAIL' : 'PASS', `语法检查（${targets.length} 个文件）`, bad);
})();

// ── 2. 数据层：页面不得直连 wx.cloud，必须走 services ────────────────────
(function checkNoCloudInPages() {
  const bad = [];
  for (const f of pageJs) {
    read(f).split('\n').forEach((line, i) => {
      if (/wx\.cloud/.test(line)) bad.push(`${rel(f)}:${i + 1}  ${line.trim()}`);
    });
  }
  record(bad.length ? 'FAIL' : 'PASS', '数据层：页面未直连 wx.cloud', bad);
})();

// ── 3. 数据层：页面不得直读数据 storage 键（UI 标记键不在此列）──────────
// 黑名单与 miniprogram/services/user.js 的 USER_DATA_KEYS 同源，只排除纯 UI 标记
// （letter_just_arrived / user_sealed_once 属页面可自持的状态位）。
(function checkNoDirectStorage() {
  const DATA_KEYS = [
    'letters_mock', 'recycle_mock', 'letter_drafts', 'letter_draft_current',
    'letter_edit_current', 'demo_removed_ids', 'recycle_demo_seeded',
    'member_demo_state', 'member_demo_expire_at', 'feedback_local',
    'theme_cache', 'papers_cache', 'account_profile'
  ];
  const bad = [];
  for (const f of pageJs) {
    read(f).split('\n').forEach((line, i) => {
      for (const k of DATA_KEYS) {
        if (line.includes(`'${k}'`) || line.includes(`"${k}"`)) {
          bad.push(`${rel(f)}:${i + 1}  直读数据键 ${k}`);
        }
      }
    });
  }
  record(bad.length ? 'FAIL' : 'PASS', '数据层：页面未直读数据 storage 键', bad);
})();

// ── 4. 密钥：不得把密钥写进代码字面量 ────────────────────────────────────
(function checkSecrets() {
  const SECRET = /(APP_KEY|APP_SECRET|APPSECRET|ADMIN_KEY|OFFER_ID|MCH_KEY|API_KEY)\s*[:=]\s*['"][A-Za-z0-9_\-]{8,}['"]/;
  const bad = [];
  for (const f of [...miniJs, ...adminJs, ...fnEntries,
    ...fnDirs.map((n) => path.join(ROOT, 'cloudfunctions', n, 'config.js')).filter((p) => fs.existsSync(p))]) {
    read(f).split('\n').forEach((line, i) => {
      if (line.trim().startsWith('//')) return;
      if (SECRET.test(line)) bad.push(`${rel(f)}:${i + 1}  ${line.trim()}`);
    });
  }
  record(bad.length ? 'FAIL' : 'PASS', '密钥：代码内无硬编码密钥字面量', bad);
})();

// ── 5. 隐私红线：admin 云函数永不读取信件正文与回信内容 ─────────────────
(function checkAdminPrivacy() {
  const file = path.join(ROOT, 'cloudfunctions', 'admin', 'index.js');
  if (!fs.existsSync(file)) return record('FAIL', '隐私红线：admin 云函数存在', ['缺 cloudfunctions/admin/index.js']);
  const src = read(file);
  const FLAGGED = ['letters', 'reply_records'];
  const bad = [];

  // 逐条语句粗切：按 `db.collection('letters')` 出现位置向后取 400 字符窗口，
  // 窗口内必须出现 count() / aggregate() / field( 之一，否则视为可能整文档读取。
  for (const coll of FLAGGED) {
    const re = new RegExp(`collection\\('${coll}'\\)`, 'g');
    let m;
    while ((m = re.exec(src)) !== null) {
      const win = src.slice(m.index, m.index + 400);
      if (!/\.count\(\)|\.aggregate\(\)|\.field\(/.test(win)) {
        const line = src.slice(0, m.index).split('\n').length;
        bad.push(`cloudfunctions/admin/index.js:${line}  collection('${coll}') 附近缺 count()/field() 投影`);
      }
    }
  }
  record(bad.length ? 'FAIL' : 'PASS', '隐私红线：admin 不整读信件/回信文档', bad);
})();

// ── 6. 云端列表查询：显式 limit（云数据库默认 20 条截断）────────────────
(function checkLimit() {
  const bad = [];
  for (const f of fnEntries) {
    const src = read(f);
    const re = /\.get\(\)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const before = src.slice(0, m.index);
      const mark = before.lastIndexOf('.collection(');
      if (mark < 0) continue;                       // 非集合链（普通对象方法等）
      const chain = src.slice(mark, m.index);
      if (!/\.where\(/.test(chain)) continue;        // 单文档 doc().get() 或已知 bounded
      if (/\.limit\(/.test(chain)) continue;
      if (/\.aggregate\(\)/.test(chain)) continue;
      if (/\.in\(/.test(chain)) continue;            // _.in(list) 天然以 list 长度封顶
      const line = before.split('\n').length;
      bad.push(`${rel(f)}:${line}  where().get() 未见 limit()`);
    }
  }
  record(bad.length ? 'WARN' : 'PASS', '查询：集合 where().get() 显式 limit', bad);
})();

// ── 7. 契约：services 调用的 action 必须存在于对应云函数 ─────────────────
(function checkContract() {
  const bad = [];
  const callRe = /call\(\s*'([a-zA-Z]+)'\s*,\s*'([a-zA-Z]+)'/g;
  for (const f of serviceJs) {
    const src = read(f);
    let m;
    while ((m = callRe.exec(src)) !== null) {
      const [, fn, action] = m;
      const target = path.join(ROOT, 'cloudfunctions', fn, 'index.js');
      if (!fs.existsSync(target)) {
        bad.push(`${rel(f)} 调用 ${fn}.${action} → 云函数目录不存在`);
        continue;
      }
      const fnSrc = read(target);
      // 本仓库有两种分发写法：多 action 用 switch/case，单 action 用 `event.action !== 'x'` 守卫
      const hasCase = new RegExp(`case\\s+'${action}'\\s*:`).test(fnSrc);
      const hasGuard = new RegExp(`action\\s*[!=]==\\s*'${action}'`).test(fnSrc);
      if (!hasCase && !hasGuard) {
        bad.push(`${rel(f)} 调用 ${fn}.${action} → cloudfunctions/${fn}/index.js 未分发该 action`);
      }
    }
  }
  record(bad.length ? 'FAIL' : 'PASS', '契约：services ↔ 云函数 action 一致', bad);
})();

// ── 8. 页面注册：app.json 的每个页面文件齐全 ─────────────────────────────
(function checkPages() {
  const appJson = JSON.parse(read(path.join(ROOT, 'miniprogram', 'app.json')));
  const bad = [];
  for (const p of appJson.pages) {
    for (const ext of ['.js', '.wxml', '.json']) {
      const f = path.join(ROOT, 'miniprogram', `${p}${ext}`);
      if (!fs.existsSync(f)) bad.push(`缺 miniprogram/${p}${ext}`);
    }
  }
  // 反向：pages 目录下有页面未注册
  for (const f of walk(path.join(ROOT, 'miniprogram', 'pages'), (x) => x.endsWith('.wxml'))) {
    const p = rel(f).replace(/^miniprogram\//, '').replace(/\.wxml$/, '');
    if (!appJson.pages.includes(p)) bad.push(`未注册进 app.json：${p}`);
  }
  record(bad.length ? 'FAIL' : 'PASS', `页面注册：app.json ${appJson.pages.length} 个页面文件齐全`, bad);
})();

// ── 9. 项目配置：根目录与 miniprogram 的 appid 一致 ──────────────────────
(function checkAppId() {
  const a = JSON.parse(read(path.join(ROOT, 'project.config.json'))).appid;
  const miniCfg = path.join(ROOT, 'miniprogram', 'project.config.json');
  if (!fs.existsSync(miniCfg)) return record('WARN', '项目配置：appid 一致性', ['缺 miniprogram/project.config.json']);
  const b = JSON.parse(read(miniCfg)).appid;
  record(a === b ? 'PASS' : 'FAIL', '项目配置：两份 project.config.json appid 一致',
    a === b ? [] : [`根目录 ${a} ≠ miniprogram/${b}`]);
})();

// ── 10. WXML 样式：hover-class 不得与元素自身 class 同名 ─────────────────
// 微信的按下态是按类名增删的：hover 结束时移除 hover-class，若该名字同时也挂在元素
// 自身上，被一并摘掉的就是基础类 —— 按钮点一次就变成一段裸文字，且 class 绑定值没变、
// 框架 diff 不会重设，要重进页面才恢复（会员页「立即开通/续费/确认支付」曾如此）。
// 全仓约定是按下态另起一个 xxx-hover 类。
(function checkHoverClassSameName() {
  const bad = [];
  for (const f of walk(path.join(ROOT, 'miniprogram'), (x) => x.endsWith('.wxml'))) {
    const src = read(f);
    // [^>] 可跨行：本仓有把 class/hover-class 分行写的多行标签
    const tagRe = /<[^>]*hover-class\s*=\s*"([^"]+)"[^>]*>/g;
    let m;
    while ((m = tagRe.exec(src)) !== null) {
      const hover = m[1].trim();
      if (!hover || hover === 'none') continue;
      const cls = m[0].match(/\sclass\s*=\s*"([^"]*)"/); // \s 前缀避免匹配 hover-class 自身
      if (!cls) continue;
      if (cls[1].split(/\s+/).indexOf(hover) === -1) continue;
      const line = src.slice(0, m.index).split('\n').length;
      bad.push(`${rel(f)}:${line}  hover-class="${hover}" 与自身 class 同名（点击后会丢样式）`);
    }
  }
  record(bad.length ? 'FAIL' : 'PASS', '样式：hover-class 未与自身 class 同名', bad);
})();

// ── 11. 分享图版面：paper-specs.js 必须与 paper.wxss 数值一致 ─────────────
// 分享图的 Canvas 绘制曾经在 pages/share/share.js 里自带一套版面常量，与
// styles/paper.wxss 长期漂移，真机上就是「预览一个样、存下来的图另一个样」：
// 会员专属版式（gold/canglan/yinxiang）因为只写了字面量键 'premium' 而整篇按号外头版
// 排版；蓝图的下划线读了 measureAt 从不返回的 titleGap，坐标变 NaN 静默丢失。
// 现在版面数值集中在 pages/write/paper-specs.js（paper.wxss 的机器可读镜像），
// 这里把两侧逐项比对：每款的 padding / border 精确比对，flow 里声明的字号与行高
// 必须在该款的 WXSS 块里找得到。任何一侧改了数值而另一侧没跟上，提交前就会 FAIL。
(function checkShareSpecs() {
  const modPath = path.join(ROOT, 'miniprogram', 'pages', 'write', 'paper-specs.js');
  if (!fs.existsSync(modPath)) {
    return record('FAIL', '分享图版面：paper-specs.js 存在', ['缺 miniprogram/pages/write/paper-specs.js']);
  }
  const wxss = read(path.join(ROOT, 'miniprogram', 'styles', 'paper.wxss'));
  const shareSrc = read(path.join(ROOT, 'miniprogram', 'pages', 'share', 'share.js'));
  const specs = require(modPath);
  const bad = [];
  if (shareSrc.indexOf('paper-specs') === -1) {
    bad.push('pages/share/share.js 未从 paper-specs.js 取版面数值（不得再自带一套常量）');
  }

  // 按分隔注释切块：每块是一款版式的全部规则
  const chunks = wxss.split(/\n(?=\/\* ─{20,})/);
  const esc = (s) => s.replace('.', '\\.');
  const chunkOf = (sel) =>
    chunks.filter((c) => new RegExp('(?:^|\\n)\\s*' + esc(sel) + '\\s*\\{').test(c))[0];
  const ruleOf = (chunk, sel) => {
    const m = new RegExp('(?:^|\\n)\\s*' + esc(sel) + '\\s*\\{([^}]*)\\}').exec(chunk);
    return m ? m[1] : null;
  };
  const padOf = (body) => {
    const m = /padding:\s*([^;]+)/.exec(body || '');
    if (!m) return null;
    const v = m[1].trim().split(/\s+/).map((x) => parseFloat(x));
    if (v.some((n) => !Number.isFinite(n))) return null;
    if (v.length === 1) return [v[0], v[0], v[0], v[0]];
    if (v.length === 2) return [v[0], v[1], v[0], v[1]];
    if (v.length === 3) return [v[0], v[1], v[2], v[1]];
    return [v[0], v[1], v[2], v[3]];
  };

  const seen = new Set();
  for (const key of Object.keys(specs.SPECS)) {
    const spec = specs.SPECS[key];
    if (!spec || seen.has(spec)) continue; // 会员专属三款共用同一份规格，只查一次
    seen.add(spec);
    const sel = spec.css;
    const chunk = chunkOf(sel);
    if (!chunk) {
      bad.push(`${sel} 在 paper.wxss 里找不到对应版式块`);
      continue;
    }
    const body = ruleOf(chunk, sel);
    const pad = padOf(body);
    if (!pad) bad.push(`${sel} 缺 padding`);
    else if (pad.join(' ') !== spec.pad.join(' ')) {
      bad.push(`${sel} padding 不一致：WXSS ${pad.join(' ')} vs paper-specs ${spec.pad.join(' ')}`);
    }
    const bm = /border:\s*([\d.]+)rpx/.exec(body || '');
    const wxBorder = bm ? parseFloat(bm[1]) : 0;
    const spBorder = spec.border ? spec.border[0] : 0;
    if (wxBorder !== spBorder) {
      bad.push(`${sel} border 不一致：WXSS ${wxBorder}rpx vs paper-specs ${spBorder}rpx`);
    }
    // 内层纸面（航空笺：.pla-sheet）
    if (spec.sheetCss) {
      const sChunk = chunkOf(spec.sheetCss);
      const sBody = sChunk ? ruleOf(sChunk, spec.sheetCss) : null;
      const sPad = padOf(sBody);
      if (!sPad) bad.push(`${spec.sheetCss} 缺 padding`);
      else if (sPad.join(' ') !== spec.sheet.join(' ')) {
        bad.push(`${spec.sheetCss} padding 不一致：WXSS ${sPad.join(' ')} vs paper-specs ${spec.sheet.join(' ')}`);
      }
    }

    // 该款 WXSS 里声明过的字号与行高
    const sizes = new Set((chunk.match(/font-size:\s*([\d.]+)rpx/g) || []).map((t) => parseFloat(/([\d.]+)/.exec(t)[1])));
    const lhUnitless = new Set(
      (chunk.match(/line-height:\s*[\d.]+(?![\d.]*rpx)/g) || []).map((t) => parseFloat(/([\d.]+)/.exec(t)[1]))
    );
    const lhRpx = new Set((chunk.match(/line-height:\s*[\d.]+rpx/g) || []).map((t) => parseFloat(/([\d.]+)/.exec(t)[1])));

    // flow 里声明的字号 / 行高逐项对照（size / fontSize 视为字号，lh 视为行高）
    const pairs = [];
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      const sz = typeof node.size === 'number' ? node.size : typeof node.fontSize === 'number' ? node.fontSize : null;
      if (sz !== null) pairs.push({ sz, lh: typeof node.lh === 'number' ? node.lh : null, at: key });
      for (const kk of Object.keys(node)) {
        if (kk === 'size' || kk === 'fontSize' || kk === 'lh') continue;
        walk(node[kk]);
      }
    };
    walk(spec.flow);
    for (const pr of pairs) {
      if (!sizes.has(pr.sz)) {
        bad.push(`${sel} 的 ${pr.sz}rpx 字号在 paper.wxss 该版式块里找不到（paper-specs 抄错或 WXSS 已改）`);
      }
      if (pr.lh !== null) {
        const asRatio = lhUnitless.has(pr.lh);
        const asRpx = Array.from(sizes).some((s) => lhRpx.has(Math.round(s * pr.lh * 100) / 100));
        if (!asRatio && !asRpx) {
          bad.push(`${sel} 的 line-height ${pr.lh}（字号 ${pr.sz}rpx）在 paper.wxss 该版式块里找不到`);
        }
      }
    }
  }
  // 票根条码下的编号行：paper.wxml 与 paper-specs.js 都必须取信件的「写于」年份。
  // 这两处曾各自写死 2026 —— 分享图与预览一致，但跨年就一起显旧。
  const wxml = read(path.join(ROOT, 'miniprogram', 'styles', 'paper.wxml'));
  const under = /class="plt-under"[^>]*>([^<]*)</.exec(wxml);
  const ticketSpec = specs.SPECS.ticket;
  const specUnder = ticketSpec.flow.filter((it) => String(it.text || '').indexOf('MENTAL MAILBOX') > -1)[0];
  const YEAR = /(?:19|20)\d{2}/; // 四位年份字面量：出现即说明写死了
  if (!under) bad.push('paper.wxml 找不到 .plt-under（票根编号行）');
  else if (!/\{\{\s*v\.yearText\s*\}\}/.test(under[1]) || YEAR.test(under[1])) {
    bad.push('paper.wxml 的 .plt-under 年份写死了：' + under[1].trim() + '（应改为 {{v.yearText}}）');
  }
  if (!specUnder) bad.push('paper-specs.js 找不到票根编号行');
  else if (specUnder.text.indexOf('{{yearText}}') === -1 || YEAR.test(specUnder.text)) {
    bad.push('paper-specs.js 的票根编号行年份写死了：' + specUnder.text);
  }

  record(bad.length ? 'FAIL' : 'PASS', '分享图版面：paper-specs.js 与 paper.wxss/wxml 一致', bad);
})();

// ── 12. 云函数离线测试（假 SDK + 内存库，约 1s）──────────────────────────
// 静态检查只证明「没破坏架构约束」，这一项才验证「业务行为对不对」。
(function checkOfflineTests() {
  const runner = path.join(ROOT, 'tests', 'run.js');
  if (!fs.existsSync(runner)) return record('WARN', '离线测试：tests/run.js 存在', ['未找到测试入口']);
  try {
    const out = execFileSync(process.execPath, [runner], { cwd: ROOT, encoding: 'utf8' });
    const m = out.match(/合计 (\d+) 条：(\d+) 通过 \/ (\d+) 失败/);
    record('PASS', `离线测试：${m ? m[0] : '全部通过'}`, []);
  } catch (e) {
    // 失败时把测试报告里的失败行挑出来，避免刷屏
    const out = String(e.stdout || '');
    const lines = out.split('\n').filter((l) => /✗/.test(l));
    const m = out.match(/合计 (\d+) 条：(\d+) 通过 \/ (\d+) 失败/);
    record('FAIL', `离线测试：${m ? m[0] : '存在失败用例'}`,
      lines.length ? lines.map((l) => l.trim()) : ['运行 node tests/run.js 查看详情']);
  }
})();

// ── 输出 ────────────────────────────────────────────────────────────────
const ICON = { PASS: '[PASS]', WARN: '[WARN]', FAIL: '[FAIL]' };
console.log('\n心灵信箱 · 提交前静态预检\n' + '='.repeat(60));
for (const r of results) {
  console.log(`${ICON[r.level]} ${r.title}`);
  for (const d of r.details) console.log(`       ${d}`);
}
const fail = results.filter((r) => r.level === 'FAIL').length;
const warn = results.filter((r) => r.level === 'WARN').length;
console.log('='.repeat(60));
console.log(`合计 ${results.length} 项：${results.length - fail - warn} 通过 / ${warn} 待确认 / ${fail} 不通过`);
if (fail) console.log('存在 FAIL，先修复再做人工测试。');
console.log('');
process.exitCode = fail ? 1 : 0;
