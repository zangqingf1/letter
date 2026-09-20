'use strict';
/**
 * 分享图版面：Canvas 导出必须与 styles/paper.wxss 的预览渲染同构
 * （pages/share/share.js、pages/write/paper-specs.js）。
 *
 * 为什么值得离线测：分享图的 Canvas 绘制原本在 share.js 里自带一套版面常量，
 * 与 paper.wxss 长期漂移，真机上表现为「预览一个样、存下来的图另一个样」。三处结构性病根：
 *   1. 会员专属版式的 key 没命中 —— PAPER_SPECS 里只写了字面量 'premium'，而专属版式的
 *      id 是 gold/canglan/yinxiang，于是三款专属笺整篇按「号外头版」的参数排版；
 *   2. 测量一套、绘制另一套 —— 蓝图的下划线读 layout.titleGap（measureAt 从没返回过它），
 *      y 变 NaN，整条线静默丢失；
 *   3. 底部装饰用「纸底 − 固定值」定位 + MIN_PAPER_H 强制见方 —— 短信时分享图被撑成
 *      正方形、页脚贴底，而预览是纯 CSS 流式。
 *
 * 这里桩掉 wx / Page 与 canvas 2d 上下文（不连云、不起真机），断言的是版面契约：
 * 每款版式命中自己的规格、坐标里不出现 NaN、高度严格随内容、测高与绘制共用同一组坐标。
 *
 * 注意：本文件设置全局 wx / Page 供 require 期读取；其他 suite 只用 harness 伪造
 * wx-server-sdk，不读这两个全局，因此不会互相影响。
 */
const path = require('path');
const fs = require('fs');
const { suite, test, ok, eq } = require('../runner');

const MINI_ROOT = path.resolve(__dirname, '..', '..', 'miniprogram') + path.sep;
const K = 1080 / 630;
const R = (v) => Math.round(v * K);
const EXPORT_W = 1080;

// ── canvas 2d 上下文桩：只做确定性度量与调用记录 ──
// 字宽模型：CJK 与全角标点 1em、西文 0.5em、空格 0.25em。数值不求还原真机，
// 只求「同一份输入永远得到同一份版面」，让坐标级的回归能被断言。
function fakeCtx() {
  const calls = [];
  const ctx = {
    font: '16px sans-serif',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    calls,
    _size() {
      const m = /(\d+(?:\.\d+)?)px/.exec(this.font);
      return m ? parseFloat(m[1]) : 16;
    },
    measureText(s) {
      const size = this._size();
      let w = 0;
      for (const ch of String(s)) {
        const c = ch.codePointAt(0);
        if (c >= 0x2e80) w += size;
        else if (c === 32) w += size * 0.25;
        else w += size * 0.5;
      }
      return { width: w };
    },
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, transform() {}, clip() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, rect() {}, arcTo() {},
    arc(x, y, r) {
      assertFinite('arc', [x, y, r]);
      calls.push({ op: 'arc', x, y, r });
    },
    setLineDash() {},
    stroke() {}, fill() {},
    createRadialGradient() { return { addColorStop() {} }; },
    drawImage() {}, clearRect() {},
    // 坐标必须是有限值：版面里一旦出现 NaN（旧版读不存在的字段就是这样），
    // 真机上表现为「整条装饰静默不画」，这里直接抛错把它顶到测试面上。
    fillText(t, x, y) {
      assertFinite('fillText', [x, y]);
      calls.push({ op: 'fillText', t, x, y });
    },
    strokeText(t, x, y) { assertFinite('strokeText', [x, y]); },
    fillRect(x, y, w, h) {
      assertFinite('fillRect', [x, y, w, h]);
      calls.push({ op: 'fillRect', x, y, w, h });
    },
    strokeRect(x, y, w, h) { assertFinite('strokeRect', [x, y, w, h]); }
  };
  return ctx;
}

// wx 桩。其他 suite（我的页首屏等）会在自己的用例里重设 global.wx，
// 而整套测试是「先 require 全部 suite、再逐条跑用例」，所以导出链路的用例开头要再装一次。
function wxStub() {
  return {
    cloud: { init() {}, callFunction: () => Promise.resolve({ result: { ok: true } }) },
    getWindowInfo: () => ({ statusBarHeight: 44 }),
    getStorageSync: () => null,
    setStorageSync() {},
    removeStorageSync() {},
    showToast() {},
    createSelectorQuery: () => ({ select: () => ({ fields: () => ({ exec() {} }) }) }),
    canvasToTempFilePath: ({ success }) => success({ tempFilePath: '/tmp/share.jpg' }),
    saveImageToPhotosAlbum: () => {}
  };
}

function load() {
  for (const k of Object.keys(require.cache)) {
    if (k.indexOf(MINI_ROOT) === 0) delete require.cache[k];
  }
  global.wx = wxStub();
  let def = null;
  global.Page = (d) => { def = d; };
  require(path.join(MINI_ROOT, 'pages', 'share', 'share.js'));
  const PAPERS = require(path.join(MINI_ROOT, 'pages', 'write', 'papers.js'));
  const specs = require(path.join(MINI_ROOT, 'pages', 'write', 'paper-specs.js'));
  return { page: def, PAPERS, specs };
}

const VIEW = {
  name: '留白',
  question: '我为什么总在深夜想明白事情？',
  answer: '因为夜里没有人打扰，判断力回来了。',
  dropChar: '因',
  answerRest: '为夜里没有人打扰，判断力回来了。',
  stubChars: '凭此信·随时重读'.split(''),
  stampText: '09.12',
  yearText: '2026',
  dotDate: '2026.09.12',
  dateLong: '2026年9月12日',
  serial: 'NO.20260912',
  serialNo: '20260912',
  dwgNo: '2026-0912',
  mon2: '09',
  day2: '12',
  dayNum: '12',
  cnMonth: '九月',
  enMonth: 'SEPTEMBER',
  weekdayCn: '星期六'
};

const json = (v) => JSON.parse(JSON.stringify(v));

function assertFinite(what, nums) {
  for (const n of nums) {
    if (!Number.isFinite(n)) throw new Error(what + ' 收到非有限坐标：' + JSON.stringify(nums));
  }
}

/** 递归扫出所有 NaN / Infinity —— 覆盖「读了不存在的字段」这类静默错位 */
function scanNumbers(node, bad, pathStr) {
  if (typeof node === 'number') {
    if (!Number.isFinite(node)) bad.push(pathStr + ' = ' + node);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const k of Object.keys(node)) scanNumbers(node[k], bad, pathStr ? pathStr + '.' + k : k);
}

suite('分享图版面（Canvas ↔ paper.wxss 同构）', () => {
  const { page, PAPERS, specs } = load();

  // 用某款版式跑一次完整排版；paper 由 papers.js 的条目构造（与真机同形）
  function lay(paperId, view) {
    const paper = PAPERS.find((p) => p.id === paperId);
    ok(paper, 'papers.js 里应有 ' + paperId);
    page.data.paper = paper;
    page.data.view = Object.assign({}, VIEW, view || {});
    return page.measureLayout(fakeCtx(), page.data.view);
  }
  const texts = (l, field) => l.ops.filter((o) => o.k === 'text' && (!field || o.field === field));

  test('papers.js 每款版式都有版面规格，会员专属三款命中专属模板', () => {
    for (const p of PAPERS) {
      const spec = specs.specOf(p);
      ok(spec, p.id + ' 应有版面规格');
      if (p.premium) {
        eq(spec, specs.SPECS.premium, p.id + '（会员专属）必须走 .pl-premium 模板');
        ok(spec !== specs.SPECS.extra, p.id + ' 不得回落到号外头版');
      } else {
        eq(spec, specs.SPECS[p.id], p.id + ' 应命中同名规格');
      }
    }
  });

  test('未知 paper_id 回落黑胶唱片（与 paper.wxml 的 wx:else 同口径）', () => {
    eq(specs.specOf({ id: 'su-v1-removed' }), specs.SPECS.vinyl, '旧版式 id 应回落 vinyl');
    eq(specs.specOf({ id: 'airmail-old' }), specs.SPECS.vinyl);
  });

  test('会员专属复用官方 id 时仍按官方版式渲染（专属黑胶不丢样式）', () => {
    // 后台「从已有款挑选加入专属」会复用官方 id（member_items.item_id='vinyl'），
    // theme 云函数 mergeLists 让专属款覆盖同 id 官方款 → 下发的 papers 里
    // vinyl 带 premium:true。导出侧 specOf 先按 id 命中，天然落在黑胶规格；
    // 预览侧 paper.wxml 的专属分支若只判 premium，黑胶（唯一的 wx:else catch-all）
    // 会被通用金线笺顶掉 —— 盘面/曲轨全丢，且与导出图两端不一致。
    eq(specs.specOf({ id: 'vinyl', premium: true }), specs.SPECS.vinyl, '导出侧：专属黑胶仍按黑胶规格');
    eq(specs.specOf({ id: 'gold', premium: true }), specs.SPECS.premium, '导出侧：无官方版面的专属 id 仍走专属模板');
    // 预览侧：专属分支的条件必须把黑胶让回给 wx:else（黑胶是唯一 catch-all 官方款）
    const wxml = fs.readFileSync(path.join(MINI_ROOT, 'styles', 'paper.wxml'), 'utf8');
    const m = wxml.match(/wx:elif="\{\{paper\.premium([^}]*)\}\}"/);
    ok(m, 'paper.wxml 应有会员专属分支');
    ok(/paper\.id !== 'vinyl'/.test(m[1]), '专属分支必须把黑胶 id 让回官方版式分支，不得只判 premium');
    const premiumPos = m.index;
    const vinylPos = wxml.indexOf('pl-paper pl-vinyl');
    ok(vinylPos > premiumPos, '黑胶分支应排在专属分支之后（作为 catch-all 兜底）');
  });

  test('会员专属版式按 .pl-premium 排版（修复：旧版整篇按号外头版）', () => {
    const l = lay('gold');
    // .pl-premium { padding: 60rpx 56rpx 48rpx } → 左右 56rpx = 96px
    eq(l.left, R(56), '专属笺左边距应取 .pl-premium 的 56rpx');
    eq(l.right, EXPORT_W - R(56));
    const title = texts(l, 'name')[0];
    eq(title.size, R(44), '.plpm-name 字号 44rpx');
    eq(title.face, 'song');
    // 顶部金线（4rpx，margin-bottom 34rpx）之后才是题名
    const rule = l.ops.find((o) => o.k === 'line');
    eq(rule.h, R(4));
    eq(rule.y, R(60), '顶部金线落在 padding-top 60rpx 处');
    ok(title.lines[0].y > rule.y + R(34), '题名基线在金线 + 34rpx 之下');
  });

  test('侧边距取自 WXSS padding（蓝图含 2rpx 边框，票根右 160rpx）', () => {
    // .pl-bp { padding: 36rpx 44rpx 44rpx; border: 2rpx } → 内容左缩 46rpx
    eq(lay('blueprint').left, R(46), '蓝图内容区要算上 2rpx 边框');
    // .pl-tk { padding: 44rpx 160rpx 44rpx 48rpx } → 右 160rpx（旧版错写 170rpx）
    eq(lay('ticket').right, EXPORT_W - R(160));
    // .pl-extra { padding: 50rpx 44rpx 36rpx }
    eq(lay('extra').left, R(44));
    // .pl-airmail{padding:12} + .pla-sheet{padding:36} → 内容左缩 48rpx
    eq(lay('airmail2').left, R(48));
  });

  test('蓝图标题下划线落在题名下 22rpx（旧版读不存在的 titleGap，坐标 NaN 静默丢失）', () => {
    const l = lay('blueprint');
    const title = texts(l, 'name')[0];
    const underline = l.ops.filter((o) => o.k === 'line' && o.w === R(88))[0];
    ok(underline, '.plb-underline（88rpx 宽）必须被画出来');
    eq(underline.h, R(3), '.plb-underline 高 3rpx');
    eq(underline.x, l.left, '下划线左对齐内容区');
    const lastLineY = title.lines[title.lines.length - 1].y;
    ok(underline.y > lastLineY, '下划线应在题名末行基线之下');
    const qBox = l.ops.find((o) => o.k === 'boxrect');
    ok(qBox, '蓝图应有问/答线框');
    ok(underline.y < qBox.y, '下划线应在问题线框之上');
  });

  test('版面里不出现 NaN / Infinity（同类静默错位的通用回归）', () => {
    for (const p of PAPERS) {
      const l = lay(p.id);
      const bad = [];
      scanNumbers(json(l).ops, bad, p.id);
      scanNumbers({ paperH: l.paperH, left: l.left, right: l.right }, bad, p.id + '.layout');
      eq(bad, [], p.id + ' 的版面坐标不得出现 NaN');
    }
  });

  test('高度严格随内容：去掉 1080px 见方下限，答案越长纸越高', () => {
    const short = lay('liubai');
    ok(short.paperH < EXPORT_W, '短信用高度应随内容（旧版被 MIN_PAPER_H 顶到 ≥1080px）');

    const longView = { answer: '测'.repeat(200), answerRest: '测'.repeat(199) };
    const long = lay('liubai', longView);
    const sOp = texts(short, 'answer')[0];
    const lOp = texts(long, 'answer')[0];
    const delta = long.paperH - short.paperH;
    eq(delta, (lOp.lines.length - sOp.lines.length) * lOp.lh, '增高量应正好等于多出的行数 × 行盒高');
    ok(delta > 0);
  });

  test('同一份 view 两次排版结果完全一致（测高与绘制共用同一组坐标）', () => {
    for (const p of PAPERS) {
      const a = json(lay(p.id).ops);
      const b = json(lay(p.id).ops);
      eq(a, b, p.id + ' 的版面必须可复现');
    }
  });

  test('字距进 spec：带 letter-spacing 的文本按逐字距绘制', () => {
    const l = lay('extra');
    const mast = l.ops.filter((o) => o.k === 'text' && o.sup)[0];
    ok(mast, '号外报头应是一条带「号外」上标的文本 op');
    eq(mast.ls, R(14), '.plx-mast letter-spacing: 14rpx');
    eq(mast.align, 'center');
    ok(mast.sup.w > 0, '上标宽度需实测（参与居中）');
    ok(mast.indent > 0, 'text-indent 补偿要参与居中');

    const moye = lay('moye');
    const cap = moye.ops.filter((o) => o.k === 'text' && o.ls === R(6))[0];
    ok(cap, '墨夜笺的 cap（letter-spacing: 6rpx）应保留字距');
  });

  test('字体度量参与排版：半行距让首行基线与 CSS 行盒一致', () => {
    const l = lay('liubai');
    const q = texts(l, 'question')[0];
    // .pll-txt { font-size: 28rpx; line-height: 2.1 } → 行盒 58.8rpx
    eq(q.lh, R(58.8));
    eq(q.size, R(28));
    // 基线 = 块顶 + (行盒 − (上升部+下降部)×字号)/2 + 上升部×字号
    const size = R(28);
    const half = (R(58.8) - (specs.METRICS.hei.asc + specs.METRICS.hei.desc) * size) / 2;
    const expect = q.lines[0].y - q.y;
    ok(Math.abs(expect - (half + specs.METRICS.hei.asc * size)) < 0.001, '首行基线要按半行距下移');
    ok(expect > (q.lh - size) / 2, '基线不得停在行盒顶（旧版 textBaseline:top 的做法）');
  });

  test('每款版式都能完成测量与绘制（不抛错、正文四项齐全）', () => {
    for (const p of PAPERS) {
      const l = lay(p.id);
      const ctx = fakeCtx();
      const colors = p.colors;
      page.drawOps(ctx, l, colors, page.data.view);
      if (l.spec.abs) page.drawAbs(ctx, l, colors, page.data.view);
      ok(ctx.calls.length > 0, p.id + ' 应产生绘制调用');
      ok(texts(l, 'name').length === 1, p.id + ' 题名入图');
      ok(texts(l, 'question').length === 1, p.id + ' 问题入图');
      ok(texts(l, 'answer').length === 1, p.id + ' 答案入图');
      ok(
        JSON.stringify(l.ops).indexOf('{{') === -1,
        p.id + ' 所有 {{...}} 都应在排版期解析成文本（不能留模板占位）'
      );
    }
  });

  test('已换算成像素的量在绘制侧不得再乘 K（海报标语条文字要垂直居中）', () => {
    const l = lay('poster');
    const band = l.ops.find((o) => o.k === 'banner');
    ok(band, '大字标语应有标语条 op');
    ok(typeof band.padY === 'number', 'banner op 必须带上 padY（像素），否则绘制侧无从定位');
    const ctx = fakeCtx();
    page.drawOps(ctx, l, PAPERS.find((p) => p.id === 'poster').colors, page.data.view);
    // 标语条文字是逐字画在「以色块中心为原点」的局部坐标里的
    const drawn = ctx.calls.filter((c) => c.op === 'fillText' && c.t === '答');
    ok(drawn.length, '标语条文字应被画出来');
    const size = R(20); // .plp-banner font-size: 20rpx
    const boxH = R(size / K * (specs.METRICS.hei.asc + specs.METRICS.hei.desc));
    const base = (boxH - (specs.METRICS.hei.asc + specs.METRICS.hei.desc) * size) / 2 + specs.METRICS.hei.asc * size;
    const lineTop = drawn[0].y - base;
    ok(Math.abs(lineTop + boxH / 2) < 1, '标语条文字应垂直居中于色块（实测偏移 ' + (lineTop + boxH / 2).toFixed(1) + 'px）');
  });

  test('票根条码下的年份取信件的写于年份（曾两边都写死 2026，跨年显旧）', () => {
    const l = lay('ticket', { yearText: '2031' });
    const caption = l.ops.filter(
      (o) => o.k === 'text' && o.lines[0] && o.lines[0].text.indexOf('MENTAL MAILBOX') > -1
    )[0];
    ok(caption, '票根应有条码下的编号行');
    eq(caption.lines[0].text, '2031 MENTAL MAILBOX', '年份应随信件走，不能是字面量');
  });

  test('出血装饰按 CSS 的 top/right 换算（几何群的位置曾整体偏移）', () => {
    const draw = (id) => {
      const p = PAPERS.find((x) => x.id === id);
      page.data.paper = p;
      page.data.view = Object.assign({}, VIEW);
      const l = page.measureLayout(fakeCtx(), page.data.view);
      const ctx = fakeCtx();
      page.drawAbs(ctx, l, p.colors, page.data.view);
      return { l, ctx };
    };

    // 黑胶盘：.plv-disc { top:-150rpx; right:-120rpx; width:400rpx } → 盘心 (550rpx, 50rpx)、半径 200rpx
    const vinyl = draw('vinyl');
    const disc = vinyl.ctx.calls.filter((c) => c.op === 'arc')[0];
    ok(Math.abs(disc.x - R(550)) <= 1, '盘心 x 应为 550rpx（实际 ' + (disc.x / K).toFixed(1) + 'rpx）');
    ok(Math.abs(disc.y - R(50)) <= 1, '盘心 y 应为 50rpx（实际 ' + (disc.y / K).toFixed(1) + 'rpx）');
    eq(disc.r, R(200));
    // 同心纹周期 12rpx（repeating-radial-gradient 9rpx 暗 + 3rpx 亮）
    const rings = vinyl.ctx.calls.filter((c) => c.op === 'arc');
    eq(rings[2].r - rings[1].r, R(12), '纹路周期应为 12rpx');

    // 包豪斯：红圆 right:-50rpx → 圆心 580rpx；黄点 right:148rpx / 28rpx → 圆心 468rpx
    const bh = draw('bauhaus');
    const arcs = bh.ctx.calls.filter((c) => c.op === 'arc');
    eq(arcs.length, 2, '包豪斯几何群含红圆与黄点两个圆');
    ok(Math.abs(arcs[0].x - R(580)) <= 2, '红圆圆心 x 应为 580rpx（实际 ' + (arcs[0].x / K).toFixed(1) + 'rpx）');
    eq(arcs[0].r, R(100));
    ok(Math.abs(arcs[1].x - R(468)) <= 2, '黄点圆心 x 应为 468rpx（实际 ' + (arcs[1].x / K).toFixed(1) + 'rpx）');
    ok(Math.abs(arcs[1].y - R(210)) <= 2, '黄点圆心 y 应为 210rpx');

    // 蓝图网格：2rpx 线 / 40rpx 周期，铺满整纸
    const bp = draw('blueprint');
    const grid = bp.ctx.calls.filter((c) => c.op === 'fillRect' && c.h === R(2) && c.w === EXPORT_W);
    ok(grid.length > 0, '蓝图画横向网格线');
    eq(grid[0].y, 0);
    eq(grid[1].y, R(40), '网格周期 40rpx');

    // 海报水印：right:-50rpx / bottom:-110rpx，400rpx 大字压在纸底之下
    const po = draw('poster');
    const wm = po.ctx.calls.filter((c) => c.op === 'fillText' && c.t === '信').filter((c) => c.y > po.l.paperH)[0];
    ok(wm, '水印「信」应压在纸面下沿');
    ok(wm.y < po.l.paperH + R(200), '水印基线不应远离纸底');
  });

  test('整条导出链路（绘制 → 出图）不抛错，坐标全部有限、尺寸随内容', async () => {
    global.wx = wxStub(); // 见 wxStub 注释：本用例依赖出图 API，装一次自己的
    for (const p of PAPERS) {
      page.data.paper = p;
      page.data.view = Object.assign({}, VIEW);
      page.data.theme = { id: 'xiaowangzi' };
      const ctx = fakeCtx();
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        // 小程序码解码回调：本地路径直接 onload，避免用例挂在图片加载上
        createImage: () => ({
          set src(v) { setTimeout(() => this.onload && this.onload(), 0); }
        })
      };
      page._canvas = canvas;
      await page.drawPostcard(canvas);
      eq(canvas.width, EXPORT_W, p.id + ' 导出宽固定 1080');
      ok(canvas.height > 0, p.id + ' 导出高必须为正');
      const file = await page.canvasToFile(canvas);
      eq(file, '/tmp/share.jpg');
    }
  });

  test('abs 装饰名都有对应的绘制分支（写错名字不会静默不画）', () => {
    const handled = ['blueprint', 'ticket', 'poster', 'bauhaus', 'vinyl', 'suwen', 'airmail2', 'yixian', 'juzhong', 'caiqie', 'xingtu', 'jiaopian', 'zhongduan', 'zhengshu'];
    for (const p of PAPERS) {
      const abs = specs.SPECS[p.id].abs;
      if (!abs) continue;
      ok(handled.indexOf(abs) > -1, p.id + ' 的 abs=' + abs + ' 必须有 drawAbs 分支');
    }
    // 需要出血装饰的版式一个都不能漏
    for (const id of ['blueprint', 'ticket', 'poster', 'bauhaus', 'vinyl', 'suwen', 'airmail2', 'yixian', 'juzhong', 'caiqie', 'xingtu', 'jiaopian', 'zhongduan', 'zhengshu']) {
      ok(specs.SPECS[id].abs, id + ' 缺 abs 分派');
    }
  });
});
