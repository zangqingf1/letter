// 04 · 分享图 · 明信片预览页
// 单一预览态（功能需求文档 七）：进入即全屏预览，名称/问题/答案/写信日期四项
// 固定全部入图；重读记录与回信永不进入分享图（BR-15）。
//
// 【版面口径】明信片的渲染基准是 styles/paper.wxss + styles/paper.wxml（预览/详情/写信
// 预览三端共用）。本文件只负责把同一套版面在 Canvas 上重绘，数值全部来自
// pages/write/paper-specs.js —— 它是 paper.wxss 的机器可读镜像，paper.wxss 改数值时
// preflight 第 12 项静态检查会拦住不同步。
//
// 绘制分两个阶段，职责不重叠：
//   1. layoutFlow()：按 CSS 文档流顺序算出每个块的绝对坐标（含基线）与 paperH，
//      产出「ops」数组；绝不在这里画东西。
//   2. drawOps()：只消费 ops，不再自己推算任何 y。
// 这样就不会再出现「测量按一套、绘制按另一套」的漂移（旧版蓝图的下划线正是因此
// 读了不存在的 layout.titleGap，坐标变 NaN 而静默丢失）。
// position:absolute 的出血装饰（包豪斯几何群、黑胶圆盘、素问邮戳、航空框、票根存根、
// 蓝图网格、海报水印）不属于文档流，各自在 drawAbsXxx 里按 CSS 的 top/right 换算绘制。

const THEMES = require('../write/themes.js');
const PAPERS = require('../write/papers.js');
const { buildView } = require('../write/paper-view.js');
const { METRICS, specOf, resolveColor, fmt, lineBox } = require('../write/paper-specs.js');
const letterService = require('../../services/letter.js');
const themeService = require('../../services/theme.js');
const memberService = require('../../services/member.js');
const analytics = require('../../services/analytics.js');
const cloud = require('../../services/cloud.js');

// 埋点统一走 analytics 服务（事件名见 PRD 第十三节）
function track(event, data) {
  analytics.track(event, data);
}

// ── Canvas 导出规格（宽固定 1080，高严格随内容）──
const EXPORT_W = 1080;
const K = EXPORT_W / 630; // 预览 rpx 尺寸 → 导出像素换算系数（预览明信片基准宽 630rpx）
const BAR_H = Math.round(88 * K); // 底部小程序条（与预览 88rpx 同源）
// Canvas 2d 真机有尺寸上限。预览是 CSS 流式（超长可滚动），导出图必须落在画布能力
// 之内，超过时按「高度 ∝ 字号²」缩小字号重排 —— 这是唯一一处刻意与预览不同的兜底。
const MAX_PAPER_H = 3600;

function rpx(v) {
  return Math.round(v * K);
}

// ── 字体族（与 styles/paper.wxss --plf-* 同源）──
const FONT_FAMILY = {
  song: '"Noto Serif SC","Songti SC","STKaiti","KaiTi",serif',
  kai: '"Kaiti SC","STKaiti","KaiTi",serif',
  hei: 'system-ui,"PingFang SC","Microsoft YaHei",sans-serif',
  mono: '"Courier New",Consolas,monospace'
};

function fontStr(size, face, weight) {
  return (weight || '') + size + 'px ' + (FONT_FAMILY[face] || FONT_FAMILY.hei);
}

// 字宽：canvas 没有通用 letterSpacing，CSS 的 letter-spacing 是「每个字之后」加间距
// （含最后一个字），所以这里也把末位的间距算进去 —— 居中/两端对齐的口径才与 WXSS 一致。
function adv(ctx, str, ls) {
  const s = String(str == null ? '' : str);
  if (!ls) return ctx.measureText(s).width;
  let w = 0;
  for (let i = 0; i < s.length; i += 1) w += ctx.measureText(s[i]).width + ls;
  return w;
}

// 一个文本 run 的行盒几何：CSS 的半行距 + 字体上升部/下降部。
// half 是行盒顶到内容区顶的距离（可为负，lh < normal 时 CSS 也这样）；
// base 是行盒顶到基线的距离，below 是基线到行盒底的距离（base + below = boxH）。
function runBox(size, face, lh, k) {
  const px = Math.round(size * k);
  const boxH = Math.round(lineBox(size, face, lh) * k);
  const m = METRICS[face] || METRICS.hei;
  const half = (boxH - (m.asc + m.desc) * px) / 2;
  return { size: px, boxH, half, asc: m.asc, desc: m.desc, base: half + m.asc * px, below: half + m.desc * px };
}

// 绘制侧用的行盒几何：入参 size / lh 都已经是导出像素（ops 里存的坐标一律是像素），
// 所以这里不能再乘 K —— 否则「行盒高」与「文字基线」会各按一套单位算，文字错位。
function runBoxPx(size, face, lh) {
  const m = METRICS[face] || METRICS.hei;
  const boxH = size * (lh || m.asc + m.desc);
  const half = (boxH - (m.asc + m.desc) * size) / 2;
  return { size, boxH, half, asc: m.asc, desc: m.desc, base: half + m.asc * size, below: half + m.desc * size };
}

// 换行：分「词 / 空白 / 单字」三种 token。CJK 逐字断行、Latin 单词整体换行
// （单个词比整行还宽时才逐字硬断），\n 强制断行 —— 与 WXSS 的 white-space: pre-wrap
// + 默认 word-break 同口径。widthAt(行号) 让首字下沉/行首符号能把前几行变窄。
function tokenize(s) {
  const out = [];
  const re = /[A-Za-z0-9'’]+|\s+|[\s\S]/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const t = m[0];
    out.push({ type: /^\s+$/.test(t) ? 'space' : /^[A-Za-z0-9'’]/.test(t) ? 'word' : 'char', text: t });
  }
  return out;
}

function wrapLines(ctx, text, widthAt, ls) {
  const out = [];
  const str = String(text == null ? '' : text);
  if (str === '') return [{ text: '', end: true }];
  const paras = str.split('\n');
  for (let pi = 0; pi < paras.length; pi += 1) {
    const para = paras[pi];
    if (para === '') {
      out.push({ text: '', end: true });
      continue;
    }
    const tokens = tokenize(para);
    let line = '';
    let lineW = 0;
    const flush = (end) => {
      out.push({ text: line.replace(/\s+$/, ''), end });
      line = '';
      lineW = 0;
    };
    for (let i = 0; i < tokens.length; i += 1) {
      const tk = tokens[i];
      if (tk.type === 'space') {
        // 空白折叠：行首空白丢弃，行中空白能放下才留
        if (line === '') continue;
        const sw = adv(ctx, tk.text, ls);
        if (lineW + sw <= widthAt(out.length)) {
          line += tk.text;
          lineW += sw;
        }
        continue;
      }
      const tw = adv(ctx, tk.text, ls);
      if (lineW + tw > widthAt(out.length) && line !== '') flush(false);
      if (tk.type === 'word' && tw > widthAt(out.length)) {
        // 单词本身超过整行宽：逐字硬断
        const chars = tk.text.split('');
        for (let j = 0; j < chars.length; j += 1) {
          const cw = adv(ctx, chars[j], ls);
          if (lineW + cw > widthAt(out.length) && line !== '') flush(false);
          line += chars[j];
          lineW += cw;
        }
        continue;
      }
      line += tk.text;
      lineW += tw;
    }
    flush(true);
  }
  return out.length ? out : [{ text: '', end: true }];
}

// ────────────────────────────────────────────────
// 版面：按 CSS 文档流算出全部坐标（不绘制）
// ────────────────────────────────────────────────
function layoutFlow(ctx, spec, view, scale) {
  const k = K * scale;
  const R = (v) => Math.round(v * k);
  const pad = spec.pad;
  const bd = spec.border || [0, 0, 0, 0];
  const sheet = spec.sheet || [0, 0, 0, 0];
  const left = R(pad[3] + bd[3] + sheet[3]);
  const right = EXPORT_W - R(pad[1] + bd[1] + sheet[1]);
  const contentW = right - left;
  const cx = left + contentW / 2;
  let y = R(pad[0] + bd[0] + sheet[0]);
  const ops = [];

  const C = (key) => resolveColor(key, spec.__colors);

  // 通用文本块：返回块底。item.box 时先出一枚 boxrect（线框 + 悬浮标签）。
  function textBlock(item, top) {
    const size = R(item.size);
    const rb = runBox(item.size, item.face, item.lh, k);
    const ls = item.ls ? R(item.ls) : 0;
    const box = item.box || null;
    const boxPad = box ? box.border.h * k + box.px * k : 0;
    const insetL = R(item.insetL || 0) + (box ? Math.round(boxPad) : 0);

    // 首字下沉（号外）：浮块宽 = 大字宽 + 右内边距，占前若干行
    let drop = null;
    if (item.drop) {
      const dSize = R(item.drop.size);
      const padTop = item.drop.pt ? R(item.drop.pt) : 0;
      const rows = Math.max(1, Math.ceil(((dSize * item.drop.lh) + padTop) / rb.boxH));
      drop = {
        char: String(view.dropChar || ''),
        size: dSize,
        face: item.drop.face,
        weight: item.drop.weight,
        pt: padTop,
        pr: R(item.drop.pr),
        w: dSize + R(item.drop.pr),
        rows,
        color: item.drop.color
      };
    }
    // 行首符号（号外的「■ 」）：::before 继承父级字体族，只改字号与颜色
    let prefix = null;
    if (item.prefix) {
      const ps = R(item.prefix.size);
      prefix = {
        text: item.prefix.text,
        size: ps,
        face: item.face,
        weight: item.weight,
        color: item.prefix.color,
        w: 0
      };
      prefix.w = adv(ctx, prefix.text, 0);
    }

    const avail = contentW - insetL - R(item.insetR || 0) - (box ? Math.round(boxPad) : 0);
    const maxW = item.frac ? Math.round(avail * item.frac) : avail;
    ctx.font = fontStr(size, item.face, item.weight);
    const text = item.drop ? String(view.answerRest || '') : item.f ? String(view[item.f] || '') : fmt(item.text, view);

    const widthAt = (i) => {
      let w = maxW;
      if (prefix && i === 0) w -= prefix.w;
      if (drop && i < drop.rows) w = maxW - drop.w;
      return w;
    };
    const lines = wrapLines(ctx, text, widthAt, ls).map((ln) => ({
      text: ln.text,
      end: ln.end,
      w: adv(ctx, ln.text, ls)
    }));

    const x0 = left + insetL;
    let inner = top;
    if (item.border) {
      ops.push({ k: 'line', x: x0, y: top, w: avail, h: R(item.border.h), color: item.border.color, dash: item.border.dash });
      inner += R(item.border.h);
    }
    if (box) {
      const bh = R(box.border.h);
      const boxH = bh * 2 + R(box.pt) + lines.length * rb.boxH + R(box.pb);
      const lbl = box.label;
      let label = null;
      if (lbl) {
        const lSize = R(lbl.size);
        const lRun = runBox(lbl.size, lbl.face, lbl.lh, k);
        ctx.font = fontStr(lSize, lbl.face, lbl.weight);
        const lw = adv(ctx, lbl.text, lbl.ls ? R(lbl.ls) : 0) + R(lbl.px) * 2;
        label = {
          x: x0 + R(lbl.left) - R(lbl.px),
          y: top + R(lbl.top),
          w: lw,
          h: lRun.boxH,
          text: lbl.text,
          size: lSize,
          face: lbl.face,
          weight: lbl.weight,
          ls: lbl.ls ? R(lbl.ls) : 0,
          color: lbl.color,
          bg: C('bg'),
          base: top + R(lbl.top) + lRun.base
        };
      }
      ops.push({ k: 'boxrect', x: x0, y: top, w: avail, h: boxH, color: box.border.color, lw: bh, label });
      inner += bh + R(box.pt);
      ctx.font = fontStr(size, item.face, item.weight);
    } else if (item.pt) {
      inner += R(item.pt);
    }

    const baseOffset = rb.half + rb.asc * size;
    const op = {
      k: 'text',
      x: x0,
      y: inner,
      avail: maxW,
      lines: lines.map((ln, i) => ({ text: ln.text, end: ln.end, w: ln.w, y: inner + i * rb.boxH + baseOffset })),
      lh: rb.boxH,
      size,
      face: item.face,
      weight: item.weight,
      ls,
      align: item.align || 'left',
      justify: !!item.justify,
      indent: item.indent ? R(item.indent) : 0,
      color: item.color,
      field: item.f || null,
      prefix,
      drop,
      dash: null,
      sup: null
    };
    if (item.dash) {
      const dRun = runBox(item.dash.size, item.dash.face, item.dash.lh, k);
      ctx.font = fontStr(R(item.dash.size), item.dash.face, item.dash.weight);
      op.dash = {
        text: item.dash.text,
        size: R(item.dash.size),
        face: item.dash.face,
        weight: item.dash.weight,
        color: item.dash.color,
        w: adv(ctx, item.dash.text, 0),
        gap: R(item.dash.gap),
        base: 0
      };
      // 破折号比正文大：按「同一行盒内两条 run 基线对齐」补一次基线偏移
      const bodyBase = rb.half + rb.asc * size;
      op.dash.dy = (dRun.half + dRun.asc * dRun.size) - bodyBase;
    }
    if (item.sup) {
      const sup = item.sup;
      ctx.font = fontStr(R(sup.size), sup.face, sup.weight);
      op.sup = {
        text: sup.text,
        size: R(sup.size),
        face: sup.face,
        weight: sup.weight,
        color: sup.color,
        ls: sup.ls ? R(sup.ls) : 0,
        w: adv(ctx, sup.text, sup.ls ? R(sup.ls) : 0),
        gap: R(sup.gap || 0),
        dy: -R(sup.va || 0)
      };
    }

    // cap 的延伸细线：flex 行内 align-items:center → 线的中线 = 行盒中线
    if (item.rule) {
      const rh = R(item.rule.h);
      const gap = R(item.rule.gap || 0);
      const ry = inner + (rb.boxH - rh) / 2;
      ctx.font = fontStr(size, item.face, item.weight);
      const tw = adv(ctx, fmt(item.text, view), ls);
      if (item.rule.both) {
        const ts = item.align === 'center' ? cx - tw / 2 : x0;
        ops.push({ k: 'line', x: x0, y: ry, w: Math.max(0, ts - gap - x0), h: rh, color: item.rule.color });
        ops.push({ k: 'line', x: ts + tw + gap, y: ry, w: Math.max(0, right - (ts + tw + gap)), h: rh, color: item.rule.color });
      } else {
        ops.push({ k: 'line', x: x0 + tw + gap, y: ry, w: Math.max(0, right - (x0 + tw + gap)), h: rh, color: item.rule.color });
      }
    }

    ops.push(op);
    let bottom = inner + lines.length * rb.boxH;
    if (box) bottom += R(box.pb) + R(box.border.h);
    if (item.pb) bottom += R(item.pb);
    return bottom;
  }

  // 两端对齐的一行两段（报头日期栏 / 眉行 / 页脚）
  function lrBlock(item, top) {
    const l = runBox(item.left.size, item.left.face, item.left.lh, k);
    const r = runBox(item.right.size, item.right.face, item.right.lh, k);
    const base = Math.max(l.base, r.base);
    const rowH = base + Math.max(l.below, r.below);
    const px = R(item.px || 0);
    let inner = top;
    if (item.border) {
      ops.push({ k: 'line', x: left, y: top, w: contentW, h: R(item.border.h), color: item.border.color });
      inner += R(item.border.h);
    }
    if (item.pt) inner += R(item.pt);
    ops.push({
      k: 'runs',
      runs: [
        { text: fmt(item.left.text, view), x: left + px, y: inner + base, align: 'left', ...l, ls: item.left.ls ? R(item.left.ls) : 0, face: item.left.face, weight: item.left.weight, color: item.left.color },
        { text: fmt(item.right.text, view), x: right - px, y: inner + base, align: 'right', ...r, ls: item.right.ls ? R(item.right.ls) : 0, face: item.right.face, weight: item.right.weight, color: item.right.color }
      ]
    });
    return inner + rowH + R(item.pb || 0);
  }

  const flow = spec.flow || [];
  for (let i = 0; i < flow.length; i += 1) {
    const it = flow[i];
    if (it.mt) y += R(it.mt);

    if (it.k === 'line') {
      const h = R(it.h);
      const w = it.w ? R(it.w) : Math.round(contentW * (it.frac || 1));
      let lx = left;
      if (it.align === 'center') lx = Math.round(cx - w / 2);
      else if (it.align === 'right') lx = right - w;
      ops.push({ k: 'line', x: lx, y, w, h, color: it.color, dash: it.dash });
      y += h + R(it.mb || 0);
    } else if (it.k === 'text') {
      y = textBlock(it, y) + R(it.mb || 0);
    } else if (it.k === 'lr') {
      y = lrBlock(it, y) + R(it.mb || 0);
    } else if (it.k === 'gap') {
      y += R(it.v);
    } else if (it.k === 'row') {
      const lead = it.lead;
      const leadX = lead.style === 'outline' ? R(lead.border || 0) : 0;
      const leadOuter = R(lead.w) + leadX * 2 + R(lead.gap);
      const body = Object.assign({}, it.body, { insetL: leadOuter });
      const bodyTop = y;
      const bottom = textBlock(body, bodyTop);
      const leadH = R(lead.mt || 0) + R(lead.h) + leadX * 2;
      ops.push({
        k: 'rowlead',
        x: left,
        y: bodyTop + R(lead.mt || 0),
        w: R(lead.w) + leadX * 2,
        h: R(lead.h) + leadX * 2,
        lw: leadX,
        radius: R(lead.radius || 0),
        style: lead.style || 'fill',
        color: lead.color,
        text: lead.text,
        size: R(lead.size),
        lhRatio: lead.lh || 0,
        face: lead.face,
        weight: lead.weight,
        textColor: lead.textColor
      });
      y = Math.max(bottom, bodyTop + leadH) + R(it.mb || 0);
    } else if (it.k === 'banner') {
      const size = R(it.size);
      const ls = it.ls ? R(it.ls) : 0;
      ctx.font = fontStr(size, it.face, it.weight);
      const text = fmt(it.text, view);
      const w = adv(ctx, text, ls) + R(it.padX) * 2;
      const h = R(it.padY) * 2 + Math.round(lineBox(it.size, it.face, it.lh) * k);
      ops.push({ k: 'banner', x: left, y, w, h, padY: R(it.padY), rotate: it.rotate || 0, text, size, face: it.face, weight: it.weight, ls, color: it.color, bg: it.bg });
      y += h + R(it.mb || 0);
    } else if (it.k === 'dateblock') {
      const size = R(it.size);
      const ls = it.ls ? R(it.ls) : 0;
      ctx.font = fontStr(size, it.face, it.weight);
      const text = fmt(it.text, view);
      const bw = R(it.border || 0);
      const w = R(it.padX) * 2 + bw * 2 + adv(ctx, text, ls);
      const h = R(it.padY) * 2 + bw * 2 + Math.round(lineBox(it.size, it.face, it.lh) * k);
      ops.push({
        k: 'dateblock',
        x: left,
        y,
        w,
        h,
        text,
        size,
        face: it.face,
        weight: it.weight,
        ls,
        color: it.color,
        bg: it.bg,
        lw: bw,
        shadow: R(it.shadow || 0),
        padX: R(it.padX),
        padY: R(it.padY)
      });
      y += h + R(it.mb || 0);
    } else if (it.k === 'tblock') {
      const bw = R(it.border);
      const rb = R(it.rowBorder);
      const padX = R(it.padX);
      const padY = R(it.padY);
      const keyW = R(it.keyW) + padX * 2 + rb;
      const rowLH = Math.max(lineBox(it.key.size, it.key.face), lineBox(it.val.size, it.val.face));
      const rowH = Math.round(rowLH * k) + padY * 2;
      const w = R(it.w) + bw * 2;
      const h = bw * 2 + it.rows.length * (rowH + rb);
      const kRun = runBox(it.key.size, it.key.face, it.key.lh, k);
      const vRun = runBox(it.val.size, it.val.face, it.val.lh, k);
      ops.push({
        k: 'tblock',
        x: right - w,
        y,
        w,
        h,
        bw,
        rb,
        rowH,
        keyW,
        padX,
        padY,
        keyBase: padY + Math.max(kRun.base, vRun.base),
        key: { size: R(it.key.size), face: it.key.face, weight: it.key.weight, ls: it.key.ls ? R(it.key.ls) : 0, color: it.key.color },
        val: { size: R(it.val.size), face: it.val.face, weight: it.val.weight, ls: it.val.ls ? R(it.val.ls) : 0, color: it.val.color },
        rows: it.rows.map((r) => [fmt(r[0], view), fmt(r[1], view)])
      });
      y += h + R(it.mb || 0);
    } else if (it.k === 'barcode') {
      const h = R(it.h);
      const w = Math.min(R(it.maxW), contentW);
      ops.push({ k: 'barcode', x: left, y, w, h, segs: it.segs.map(R), color: it.color });
      y += h + R(it.mb || 0);
    } else if (it.k === 'sealzone') {
      const sz = R(it.seal.box);
      const dRun = runBox(it.date.size, it.date.face, it.date.lh, k);
      const rowH = Math.max(sz, dRun.boxH);
      const sealX = right - sz;
      ops.push({
        k: 'sealzone',
        y,
        rowH,
        date: {
          text: fmt(it.date.text, view),
          x: sealX - R(it.date.gap),
          y: y + (rowH - dRun.boxH) / 2 + dRun.base,
          size: dRun.size,
          face: it.date.face,
          weight: it.date.weight,
          ls: it.date.ls ? R(it.date.ls) : 0,
          color: it.date.color
        },
        seal: {
          x: sealX,
          y: y + (rowH - sz) / 2,
          box: sz,
          rotate: it.seal.rotate || 0,
          bg: it.seal.bg,
          ring: (it.seal.ring || []).map(R),
          text: it.seal.text,
          textSize: R(it.seal.fontSize),
          face: it.seal.face,
          color: it.seal.color
        }
      });
      y += rowH + R(it.mb || 0);
    } else if (it.k === 'head') {
      const h = R(it.h);
      const av = it.avion;
      const lSize = R(av.labelSize);
      const cSize = R(av.cnSize);
      const lRun = runBox(av.labelSize, av.labelFace, av.lh, k);
      const cRun = runBox(av.cnSize, av.face || 'hei', av.lh, k);
      ctx.font = fontStr(lSize, av.labelFace, av.weight);
      const lW = adv(ctx, av.label, R(av.labelLs));
      ctx.font = fontStr(cSize, av.face || 'hei', av.weight);
      const cW = adv(ctx, av.cn, R(av.cnLs));
      const avW = Math.max(lW, cW) + R(av.padX) * 2 + R(av.border) * 2;
      const avH = R(av.border) * 2 + R(av.padY) * 2 + lRun.boxH + cRun.boxH;
      const st = it.stamp;
      ops.push({
        k: 'head',
        left,
        right,
        y,
        h,
        avion: {
          x: left,
          y,
          w: avW,
          h: avH,
          lw: R(av.border),
          label: av.label,
          labelSize: lSize,
          labelFace: av.labelFace,
          labelWeight: av.weight,
          labelLs: R(av.labelLs),
          labelBase: y + R(av.border) + R(av.padY) + lRun.base,
          cn: av.cn,
          cnSize: cSize,
          cnFace: av.face || 'hei',
          cnWeight: av.weight,
          cnLs: R(av.cnLs),
          cnIndent: R(av.cnIndent || 0),
          cnBase: y + R(av.border) + R(av.padY) + lRun.boxH + cRun.base,
          color: av.color
        },
        stamp: {
          x: right - R(st.w),
          y,
          w: R(st.w),
          h: R(st.h),
          lw: R(st.border),
          pad: R(st.pad),
          frame: R(st.frame),
          paper: st.paper,
          borderColor: st.borderColor,
          hatch: st.hatch,
          date: fmt(st.date, view),
          dateSize: R(st.dateSize),
          dateFace: st.dateFace,
          year: fmt(st.year, view),
          yearSize: R(st.yearSize),
          yearLs: R(st.yearLs),
          color: st.color
        }
      });
      y += h;
    }
  }

  const paperH = y + R(pad[2] + bd[2] + sheet[2]);
  return { paperH, left, right, contentW, cx, ops, scale, spec, k };
}

Page({
  data: {
    statusBarHeight: 20,
    letter: { name: '', question: '', answer: '' },
    theme: THEMES[0],
    themeName: THEMES[0].name,
    paper: PAPERS[0],
    view: buildView({ name: '', question: '', answer: '' }, { created: new Date() }),
    drawing: false
  },

  onLoad(options) {
    const win = wx.getWindowInfo();
    this.setData({
      statusBarHeight: win.statusBarHeight || 20
    });

    // 与详情页同源：经 letter 服务读取（真实寄出的信优先，否则演示数据预览）；
    // 版式经 theme 服务解析（未知 paper_id 回落第一套；非 VIP 专属版式同样回落默认）。
    // 信纸取色只用 paper.colors。
    Promise.all([letterService.get(options && options.id), themeService.getThemes(), themeService.getPapers(), memberService.getMembership()])
      .then(([res, themes, papers, m]) => {
        const letter = res.letter;
        const isVip = !!(m && m.state === 'vip');
        // 非 VIP 时专属主题按默认主题渲染（会员过期后老信回退，开通后自动恢复）
        let theme = themes.find((t) => t.id === letter.theme_id) || themes[0] || THEMES[0];
        if (theme.premium && !isVip) theme = themes[0] || theme;
        this.setData({
          letter,
          theme,
          themeName: theme.name,
          paper: themeService.paperOf(letter.paper_id, papers, isVip),
          view: buildView(letter, { created: letter.created_at })
        });
      })
      .catch((err) => {
        console.error('[share] 信件读取失败', err);
        wx.showToast({ title: '这封信暂时取不出来，稍后再来试试', icon: 'none' });
      });
  },

  onTapBack() {
    wx.navigateBack();
  },

  // ── 生成分享图（首次导出时上报传播行为埋点，PRD 第十三节）──
  trackGenerateOnce() {
    if (this._tracked) return;
    this._tracked = true;
    track('share_image_generate', { theme_id: this.data.theme.id });
  },

  // ── Canvas 导出：按预览样式绘制明信片，返回临时文件 ──
  exportPostcard() {
    if (this._exporting) return Promise.reject(new Error('busy'));
    this._exporting = true;
    this.trackGenerateOnce();
    this.setData({ drawing: true });
    return this.getExportCanvas()
      .then((canvas) => this.drawPostcard(canvas))
      .then((canvas) => this.canvasToFile(canvas))
      .then(
        (filePath) => {
          this._exporting = false;
          this.setData({ drawing: false });
          return filePath;
        },
        (e) => {
          this._exporting = false;
          this.setData({ drawing: false });
          throw e;
        }
      );
  },

  getExportCanvas() {
    if (this._canvas) return Promise.resolve(this._canvas);
    return new Promise((resolve, reject) => {
      const query = wx.createSelectorQuery();
      query
        .select('#share-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const canvas = res && res[0] && res[0].node;
          if (!canvas) {
            reject(new Error('canvas not found'));
            return;
          }
          this._canvas = canvas;
          resolve(canvas);
        });
    });
  },

  // 版面测量：高度严格随内容；超出画布上限时按「高度 ∝ 字号²」缩小字号重排
  measureLayout(ctx, view) {
    const spec = this.spec();
    let layout = layoutFlow(ctx, spec, view, 1);
    if (layout.paperH + BAR_H > MAX_PAPER_H) {
      layout = layoutFlow(ctx, spec, view, Math.max(0.5, Math.sqrt(MAX_PAPER_H / (layout.paperH + BAR_H))));
    }
    return layout;
  },

  // 当前版式的版面规格（含配色表，供 resolveColor 用键名取色）
  spec() {
    const paper = this.data.paper;
    const spec = Object.assign({}, specOf(paper));
    spec.__colors = paper.colors || PAPERS[0].colors;
    return spec;
  },

  // 绘制整张明信片（异步等待小程序码加载完成后返回 canvas）
  drawPostcard(canvas) {
    const ctx = canvas.getContext('2d');
    const view = this.data.view;
    const paper = this.data.paper;
    const colors = paper.colors || PAPERS[0].colors; // 纸色自持：配色只来自 papers.js
    const layout = this.measureLayout(ctx, view);

    canvas.width = EXPORT_W;
    canvas.height = layout.paperH + BAR_H;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    return this.loadImage(QR_SRC)
      .catch(() => null)
      .then((qrImg) => {
        // 与 CSS 一致：.pl-paper 是 overflow:auto 的滚动画布，出血装饰一律裁到纸面内
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, EXPORT_W, layout.paperH);
        ctx.clip();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic'; // 装饰与正文统一按 CSS 基线口径落位
        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, EXPORT_W, layout.paperH);
        if (layout.spec.abs) this.drawAbs(ctx, layout, colors, view);
        this.drawOps(ctx, layout, colors, view);
        ctx.restore();

        // ── 底部小程序条：火漆 Logo 环 + 品牌文案 + 小程序码 ──
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#6B8E85';
        ctx.fillRect(0, layout.paperH, EXPORT_W, BAR_H);
        const barMidY = layout.paperH + BAR_H / 2;
        const logoD = 30 * K;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 3 * K;
        ctx.beginPath();
        ctx.arc(32 * K + logoD / 2, barMidY, logoD / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        const sloganRun = runBoxPx(rpx(20), 'hei', null);
        ctx.font = fontStr(Math.round(20 * K), 'hei', '');
        ctx.textAlign = 'left';
        // 与 .pc-brand 的 flex 居中同口径：行盒中线落在小程序条中线上
        drawSpaced(ctx, '心灵信箱 · 把答案寄给未来', 32 * K + logoD + 14 * K, barMidY - sloganRun.boxH / 2 + sloganRun.base, rpx(1), 'left');
        // 小程序码：白色圆角衬底 + 真实小程序码图（预览同源素材，加载失败回落暗格占位）
        const qrS = 62 * K;
        const qrX = EXPORT_W - 24 * K - qrS;
        const qrY = barMidY - qrS / 2;
        ctx.fillStyle = '#FFFFFF';
        roundRectPath(ctx, qrX, qrY, qrS, qrS, 8 * K);
        ctx.fill();
        if (qrImg) {
          const pad = 5 * K;
          ctx.drawImage(qrImg, qrX + pad, qrY + pad, qrS - pad * 2, qrS - pad * 2);
        } else {
          ctx.fillStyle = '#2E3330';
          const cell = 14 * K;
          const gap = (qrS - 10 * K - cell * 3) / 2;
          for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
              ctx.fillRect(qrX + 5 * K + c * (cell + gap), qrY + 5 * K + r * (cell + gap), cell, cell);
            }
          }
        }
        return canvas;
      });
  },

  // ── 绘制：只读 layout.ops 的坐标，不再自己推算位置 ──
  drawOps(ctx, layout, colors, view) {
    const C = (key) => resolveColor(key, colors);
    const ops = layout.ops;
    for (let i = 0; i < ops.length; i += 1) {
      const op = ops[i];
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';

      if (op.k === 'line') {
        ctx.fillStyle = C(op.color);
        if (op.dash) {
          ctx.save();
          ctx.strokeStyle = C(op.color);
          ctx.lineWidth = op.h;
          ctx.setLineDash(op.dash.map(rpx));
          ctx.beginPath();
          ctx.moveTo(op.x, op.y + op.h / 2);
          ctx.lineTo(op.x + op.w, op.y + op.h / 2);
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.fillRect(op.x, op.y, op.w, Math.max(1, op.h));
        }
      } else if (op.k === 'boxrect') {
        ctx.strokeStyle = C(op.color);
        ctx.lineWidth = Math.max(1, op.lw);
        ctx.strokeRect(op.x + op.lw / 2, op.y + op.lw / 2, op.w - op.lw, op.h - op.lw);
        if (op.label) {
          const lb = op.label;
          ctx.fillStyle = lb.bg;
          ctx.fillRect(lb.x, lb.y, lb.w, lb.h);
          ctx.fillStyle = C(lb.color);
          ctx.font = fontStr(lb.size, lb.face, lb.weight);
          drawSpaced(ctx, lb.text, lb.x + rpx(10), lb.base, lb.ls, 'left');
        }
      } else if (op.k === 'rowlead') {
        const lw = Math.max(1, op.lw);
        if (op.style === 'outline') {
          ctx.strokeStyle = C(op.color);
          ctx.lineWidth = lw;
          if (op.radius) roundRectPath(ctx, op.x + lw / 2, op.y + lw / 2, op.w - lw, op.h - lw, op.radius);
          else { ctx.beginPath(); ctx.rect(op.x + lw / 2, op.y + lw / 2, op.w - lw, op.h - lw); }
          ctx.stroke();
          ctx.fillStyle = C(op.textColor);
        } else {
          ctx.fillStyle = C(op.color);
          if (op.radius) { roundRectPath(ctx, op.x, op.y, op.w, op.h, op.radius); ctx.fill(); }
          else ctx.fillRect(op.x, op.y, op.w, op.h);
          ctx.fillStyle = C(op.textColor);
        }
        const run = runBoxPx(op.size, op.face, op.lhRatio || null);
        ctx.font = fontStr(op.size, op.face, op.weight);
        ctx.textAlign = 'center';
        ctx.fillText(op.text, op.x + op.w / 2, op.y + (op.h - run.boxH) / 2 + run.base);
      } else if (op.k === 'runs') {
        op.runs.forEach((r) => {
          ctx.fillStyle = C(r.color);
          ctx.font = fontStr(r.size, r.face, r.weight);
          ctx.textAlign = r.align === 'right' ? 'right' : 'left';
          if (r.ls) drawSpaced(ctx, r.text, r.x, r.y, r.ls, r.align);
          else ctx.fillText(r.text, r.x, r.y);
        });
      } else if (op.k === 'banner') {
        ctx.save();
        ctx.translate(op.x + op.w / 2, op.y + op.h / 2);
        ctx.rotate((op.rotate * Math.PI) / 180);
        ctx.fillStyle = C(op.bg);
        ctx.fillRect(-op.w / 2, -op.h / 2, op.w, op.h);
        ctx.fillStyle = C(op.color);
        const run = runBoxPx(op.size, op.face, null);
        ctx.font = fontStr(op.size, op.face, op.weight);
        ctx.textAlign = 'center';
        // op.padY 已是导出像素：别再走 rpx()（那是二次换算，文字会掉到标语条下沿）
        drawSpaced(ctx, op.text, 0, -op.h / 2 + op.padY + run.base, op.ls, 'center');
        ctx.restore();
      } else if (op.k === 'dateblock') {
        if (op.shadow) {
          ctx.fillStyle = C(op.color);
          ctx.fillRect(op.x + op.shadow, op.y + op.shadow, op.w, op.h);
        }
        ctx.fillStyle = C(op.bg);
        ctx.fillRect(op.x, op.y, op.w, op.h);
        ctx.strokeStyle = C(op.color);
        ctx.lineWidth = Math.max(1, op.lw);
        ctx.strokeRect(op.x + op.lw / 2, op.y + op.lw / 2, op.w - op.lw, op.h - op.lw);
        const run = runBoxPx(op.size, op.face, null);
        ctx.fillStyle = C(op.color);
        ctx.font = fontStr(op.size, op.face, op.weight);
        drawSpaced(ctx, op.text, op.x + op.lw + op.padX, op.y + op.lw + op.padY + run.base, op.ls, 'left');
      } else if (op.k === 'tblock') {
        ctx.strokeStyle = 'rgba(234,242,248,0.80)';
        ctx.lineWidth = Math.max(1, op.bw);
        ctx.strokeRect(op.x + op.bw / 2, op.y + op.bw / 2, op.w - op.bw, op.h - op.bw);
        op.rows.forEach((row, i) => {
          // .plb-trow { border-top: 1rpx } → 每行顶部一道横线；键列右侧一道竖线
          const ry = op.y + op.bw + i * (op.rowH + op.rb);
          ctx.strokeStyle = 'rgba(234,242,248,0.35)';
          ctx.lineWidth = Math.max(1, op.rb);
          ctx.beginPath();
          ctx.moveTo(op.x + op.bw, ry + op.rb / 2);
          ctx.lineTo(op.x + op.w - op.bw, ry + op.rb / 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(op.x + op.bw + op.keyW, ry);
          ctx.lineTo(op.x + op.bw + op.keyW, ry + op.rowH + op.rb);
          ctx.stroke();
          const tx = ry + op.rb + op.keyBase;
          ctx.fillStyle = C(op.key.color);
          ctx.font = fontStr(op.key.size, op.key.face, op.key.weight);
          drawSpaced(ctx, row[0], op.x + op.bw + op.padX, tx, op.key.ls, 'left');
          ctx.fillStyle = C(op.val.color);
          ctx.font = fontStr(op.val.size, op.val.face, op.val.weight);
          drawSpaced(ctx, row[1], op.x + op.bw + op.keyW + op.padX, tx, op.val.ls, 'left');
        });
      } else if (op.k === 'barcode') {
        ctx.fillStyle = C(op.color);
        let bx = op.x;
        let si = 0;
        let on = true;
        while (bx < op.x + op.w) {
          const w = op.segs[si % op.segs.length];
          if (on) ctx.fillRect(bx, op.y, Math.min(w, op.x + op.w - bx), op.h);
          bx += w;
          on = !on;
          si += 1;
        }
      } else if (op.k === 'sealzone') {
        const s = op.seal;
        ctx.save();
        ctx.translate(s.x + s.box / 2, s.y + s.box / 2);
        ctx.rotate((s.rotate * Math.PI) / 180);
        // .plp-seal 的 box-shadow: 0 0 0 4rpx #F0E9DA, 0 0 0 6rpx #B5342A
        // —— 两层都画在方章之外：先铺大的红圈，再叠米圈，最后盖方章
        for (let ri = s.ring.length - 1; ri >= 0; ri -= 1) {
          ctx.fillStyle = ri === 0 ? C('cream') : C(s.bg);
          const r = s.ring[ri];
          ctx.fillRect(-s.box / 2 - r, -s.box / 2 - r, s.box + r * 2, s.box + r * 2);
        }
        ctx.fillStyle = C(s.bg);
        ctx.fillRect(-s.box / 2, -s.box / 2, s.box, s.box);
        const run = runBoxPx(s.textSize, s.face, 1.2);
        ctx.fillStyle = C(s.color);
        ctx.font = fontStr(s.textSize, s.face, '700 ');
        ctx.textAlign = 'center';
        const cell = (s.box - rpx(16)) / 2;
        const rows = 2 * run.boxH;
        const top0 = -rows / 2;
        const chars = String(s.text).split('');
        chars.forEach((ch, i) => {
          const cxx = -cell / 2 + (i % 2) * cell;
          const cyy = top0 + Math.floor(i / 2) * run.boxH + run.base;
          ctx.fillText(ch, cxx, cyy);
        });
        ctx.restore();
        ctx.textAlign = 'right';
        ctx.fillStyle = C(op.date.color);
        ctx.font = fontStr(op.date.size, op.date.face, op.date.weight);
        drawSpaced(ctx, op.date.text, op.date.x, op.date.y, op.date.ls, 'right');
        ctx.textAlign = 'left';
      } else if (op.k === 'head') {
        const av = op.avion;
        ctx.strokeStyle = C(av.color);
        ctx.lineWidth = Math.max(1, av.lw);
        ctx.strokeRect(av.x + av.lw / 2, av.y + av.lw / 2, av.w - av.lw, av.h - av.lw);
        ctx.fillStyle = C(av.color);
        ctx.textAlign = 'center';
        ctx.font = fontStr(av.labelSize, av.labelFace, av.labelWeight);
        drawSpaced(ctx, av.label, av.x + av.w / 2, av.labelBase, av.labelLs, 'center');
        ctx.font = fontStr(av.cnSize, av.cnFace, av.cnWeight);
        drawSpaced(ctx, av.cn, av.x + av.w / 2 + av.cnIndent / 2, av.cnBase, av.cnLs, 'center');
        ctx.textAlign = 'left';
        // 邮票：外框 + 内框（135° 细斜纹）+ 日期/年份
        const st = op.stamp;
        ctx.fillStyle = C(st.paper);
        ctx.fillRect(st.x, st.y, st.w, st.h);
        ctx.strokeStyle = C(st.borderColor);
        ctx.lineWidth = Math.max(1, st.lw);
        ctx.strokeRect(st.x + st.lw / 2, st.y + st.lw / 2, st.w - st.lw, st.h - st.lw);
        // .pla-stamp { width:70; height:82; border:2rpx; padding:8rpx; box-sizing:border-box }
        // → 内框（.pla-frame）的外沿要再让开那道 2rpx 边框
        const inset = st.pad + st.lw;
        const frX = st.x + inset;
        const frY = st.y + inset;
        const frW = st.w - inset * 2;
        const frH = st.h - inset * 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(frX, frY, frW, frH);
        ctx.clip();
        ctx.strokeStyle = st.hatch;
        ctx.lineWidth = rpx(4);
        for (let i = -frH; i < frW + frH; i += rpx(8)) {
          ctx.beginPath();
          ctx.moveTo(frX + i, frY + frH);
          ctx.lineTo(frX + i + frH, frY);
          ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = C(st.color);
        ctx.lineWidth = Math.max(1.5, st.frame);
        ctx.strokeRect(frX + st.frame / 2, frY + st.frame / 2, frW - st.frame, frH - st.frame);
        const dRun = runBoxPx(st.dateSize, st.dateFace, 1.2);
        const yRun = runBoxPx(st.yearSize, st.cnFace || 'hei', 1.2);
        const innerTop = frY + st.frame;
        const innerH = frH - st.frame * 2;
        const stack = dRun.boxH + yRun.boxH;
        const gap = Math.max(0, (innerH - stack) / 2);
        ctx.fillStyle = C(st.color);
        ctx.textAlign = 'center';
        ctx.font = fontStr(st.dateSize, st.dateFace, '700 ');
        ctx.fillText(st.date, frX + frW / 2, innerTop + gap + dRun.base);
        ctx.font = fontStr(st.yearSize, 'hei', '');
        drawSpaced(ctx, st.year, frX + frW / 2, innerTop + gap + dRun.boxH + yRun.base, st.yearLs, 'center');
        ctx.textAlign = 'left';
      } else if (op.k === 'text') {
        this.drawTextOp(ctx, op, C);
      }
    }
  },

  // 文本块：逐行按对齐口径算 x（左/中/右/两端对齐），字距用逐字绘制
  drawTextOp(ctx, op, C) {
    ctx.fillStyle = C(op.color);
    ctx.font = fontStr(op.size, op.face, op.weight);
    const single = op.lines.length === 1;

    // 行首符号（::before）：占首行左侧，颜色独立
    if (op.prefix && op.lines.length) {
      ctx.fillStyle = C(op.prefix.color);
      ctx.font = fontStr(op.prefix.size, op.prefix.face, op.prefix.weight);
      ctx.fillText(op.prefix.text, op.x, op.lines[0].y);
      ctx.fillStyle = C(op.color);
      ctx.font = fontStr(op.size, op.face, op.weight);
    }

    op.lines.forEach((ln, i) => {
      const shift = op.prefix && i === 0 ? op.prefix.w : 0;
      const limit = op.avail - shift - (op.drop && i < op.drop.rows ? op.drop.w : 0);
      const base = op.x + shift + (op.drop && i < op.drop.rows ? op.drop.w : 0);

      if (op.dash && single) {
        // 居中「— 答 毕 —」：破折号与正文一起参与居中
        const total = op.dash.w * 2 + op.dash.gap * 2 + ln.w;
        let dx = base + (op.avail - total) / 2 + op.indent;
        ctx.fillStyle = C(op.dash.color);
        ctx.font = fontStr(op.dash.size, op.dash.face, op.dash.weight);
        ctx.fillText(op.dash.text, dx, ln.y + (op.dash.dy || 0));
        dx += op.dash.w + op.dash.gap;
        ctx.fillStyle = C(op.color);
        ctx.font = fontStr(op.size, op.face, op.weight);
        if (op.ls) drawSpaced(ctx, ln.text, dx, ln.y, op.ls, 'left');
        else ctx.fillText(ln.text, dx, ln.y);
        dx += ln.w + op.dash.gap;
        ctx.fillStyle = C(op.dash.color);
        ctx.font = fontStr(op.dash.size, op.dash.face, op.dash.weight);
        ctx.fillText(op.dash.text, dx, ln.y + (op.dash.dy || 0));
        return;
      }

      let tx;
      if (op.align === 'center') tx = base + (limit - ln.w) / 2 + op.indent;
      else if (op.align === 'right') tx = base + limit - ln.w;
      else tx = base;

      if (op.justify && !ln.end && ln.text.length > 1) {
        // 两端对齐：把余量平摊到字与字之间（末行不拉伸，与 CSS 一致）
        const extra = (limit - ln.w) / (ln.text.length - 1);
        let cxx = tx;
        const chars = ln.text.split('');
        for (let ci = 0; ci < chars.length; ci += 1) {
          ctx.fillText(chars[ci], cxx, ln.y);
          cxx += ctx.measureText(chars[ci]).width + op.ls + extra;
        }
      } else if (op.ls) {
        drawSpaced(ctx, ln.text, tx, ln.y, op.ls, 'left');
      } else {
        ctx.fillText(ln.text, tx, ln.y);
      }

      if (op.sup && i === 0) {
        ctx.fillStyle = C(op.sup.color);
        ctx.font = fontStr(op.sup.size, op.sup.face, op.sup.weight);
        const sx = tx + ln.w + op.sup.gap;
        if (op.sup.ls) drawSpaced(ctx, op.sup.text, sx, ln.y + op.sup.dy, op.sup.ls, 'left');
        else ctx.fillText(op.sup.text, sx, ln.y + op.sup.dy);
        ctx.fillStyle = C(op.color);
        ctx.font = fontStr(op.size, op.face, op.weight);
      }
    });

    // 首字下沉（号外）：浮块在答案首行左侧，基线按 CSS lh:1 的半行距算
    if (op.drop) {
      const d = op.drop;
      const run = runBoxPx(d.size, d.face, 1);
      ctx.fillStyle = C(d.color);
      ctx.font = fontStr(d.size, d.face, d.weight);
      ctx.fillText(d.char, op.x, op.y + d.pt + run.base);
      ctx.fillStyle = C(op.color);
      ctx.font = fontStr(op.size, op.face, op.weight);
    }
  },

  // ── position:absolute 的出血装饰（按 CSS top/right/width/height 换算）──
  // 这些元素在 paper.wxml 里都是容器的前几个子节点，所以统一在 ops 之前绘制（= 垫在文字下层）。
  drawAbs(ctx, layout, colors, view) {
    const which = layout.spec.abs;
    if (which === 'blueprint') this.drawAbsBlueprint(ctx, layout, colors);
    else if (which === 'ticket') this.drawAbsTicket(ctx, layout, colors, view);
    else if (which === 'poster') this.drawAbsPoster(ctx, layout, colors);
    else if (which === 'bauhaus') this.drawAbsBauhaus(ctx, layout, colors);
    else if (which === 'vinyl') this.drawAbsVinyl(ctx, layout, colors, view);
    else if (which === 'suwen') this.drawAbsSuwen(ctx, layout, colors, view);
    else if (which === 'airmail2') this.drawAbsAirmail(ctx, layout, colors);
  },

  // 工程蓝图：背景白线网格 + 纸边细框 + 四角裁切标
  // （.pl-bp 的 box-shadow 外圈在预览里被 .pl-paper 的 overflow:auto 裁掉，所以不画）
  drawAbsBlueprint(ctx, layout, colors) {
    const H = layout.paperH;
    ctx.fillStyle = colors.grid;
    const step = rpx(40);
    const th = Math.max(1, rpx(2));
    for (let gy = 0; gy < H; gy += step) ctx.fillRect(0, gy, EXPORT_W, th);
    for (let gx = 0; gx < EXPORT_W; gx += step) ctx.fillRect(gx, 0, th, H);
    // 纸边细框（border: 2rpx solid rgba(234,242,248,0.75)）
    ctx.strokeStyle = 'rgba(234,242,248,0.75)';
    ctx.lineWidth = Math.max(1, rpx(2));
    const lw = rpx(2) / 2;
    ctx.strokeRect(lw, lw, EXPORT_W - lw * 2, H - lw * 2);
    // 四角裁切标：22×22，两条 3rpx 边，内缩 12rpx
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = Math.max(1, rpx(3));
    const c = rpx(22);
    const ci = rpx(12);
    [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1]
    ].forEach(([sx, sy]) => {
      const px = sx > 0 ? ci : EXPORT_W - ci;
      const py = sy > 0 ? ci : H - ci;
      ctx.beginPath();
      ctx.moveTo(px + sx * c, py);
      ctx.lineTo(px, py);
      ctx.lineTo(px, py + sy * c);
      ctx.stroke();
    });
  },

  // 存根票根：右侧整条存根（虚线缝 + 上下铆钉 + 日期 + 竖排小字），flex space-between 分布
  drawAbsTicket(ctx, layout, colors, view) {
    const H = layout.paperH;
    const w = rpx(128);
    const sx = EXPORT_W - w;
    ctx.fillStyle = 'rgba(194,69,45,0.05)';
    ctx.fillRect(sx, 0, w, H);
    ctx.save();
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = Math.max(1, rpx(3));
    ctx.setLineDash([10, 8].map(rpx));
    const seamX = sx + Math.max(1, rpx(3)) / 2; // border-box：虚线缝落在存根内沿
    ctx.beginPath();
    ctx.moveTo(seamX, 0);
    ctx.lineTo(seamX, H);
    ctx.stroke();
    ctx.restore();

    // 子项按 space-between 分布（padding 28rpx 0）
    const padY = rpx(28);
    const rivet = rpx(16) + rpx(3) * 2;
    const dcx = sx + w / 2;
    const r1 = runBox(18, 'hei', null, K);
    const d1 = runBox(34, 'mono', null, K);
    const nRun = runBox(20, 'hei', 1.6, K);
    const stubDate = r1.boxH + rpx(6) + d1.boxH + rpx(4) + r1.boxH;
    const chars = String(view.stubChars || '');
    const noteH = chars.length * nRun.boxH;
    const total = rivet * 2 + stubDate + noteH;
    const gap = Math.max(0, (H - padY * 2 - total) / 3);
    const y1 = padY;
    const y2 = y1 + rivet + gap;
    const y3 = y2 + stubDate + gap;
    const y4 = y3 + noteH + gap;

    // 上下铆钉（16×16 圆 + 3rpx 边）
    [y1, y4].forEach((ry) => {
      ctx.beginPath();
      ctx.arc(dcx, ry + rivet / 2, rpx(8), 0, Math.PI * 2);
      ctx.fillStyle = colors.bg;
      ctx.fill();
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = Math.max(1, rpx(3));
      ctx.stroke();
    });

    // 存根日期：写于 / 08.30 / 2026（居中）
    ctx.textAlign = 'center';
    ctx.fillStyle = colors.accent;
    let ty = y2;
    ctx.font = fontStr(r1.size, 'hei', '700 ');
    drawSpaced(ctx, '写于', dcx, ty + r1.base, rpx(3), 'center');
    ty += r1.boxH + rpx(6);
    ctx.font = fontStr(d1.size, 'mono', '700 ');
    drawSpaced(ctx, view.stampText, dcx, ty + d1.base, rpx(1), 'center');
    ty += d1.boxH + rpx(4);
    ctx.font = fontStr(r1.size, 'hei', '700 ');
    drawSpaced(ctx, view.yearText, dcx, ty + r1.base, rpx(3), 'center');

    // 竖排小字（逐字下排，20rpx / line-height 1.6）
    ctx.fillStyle = colors.sub;
    ctx.font = fontStr(nRun.size, 'hei', '');
    for (let i = 0; i < chars.length; i += 1) {
      ctx.fillText(chars[i], dcx, y3 + i * nRun.boxH + nRun.base);
    }
    ctx.textAlign = 'left';
  },

  // 大字标语：右下描边水印「信」（右下出血，由外层裁到纸面内）
  drawAbsPoster(ctx, layout, colors) {
    const size = rpx(440);
    ctx.font = fontStr(size, 'song', '900 ');
    const w = ctx.measureText('信').width;
    const run = runBox(440, 'song', 1, K);
    // bottom: -110rpx → 行盒底边落在纸底下方 110rpx
    const boxTop = layout.paperH + rpx(110) - run.boxH;
    const x = EXPORT_W + rpx(50) - w;
    const y = boxTop + run.base;
    ctx.fillStyle = 'rgba(150,132,96,0.10)';
    ctx.fillText('信', x, y);
    ctx.strokeStyle = colors.wm;
    ctx.lineWidth = Math.max(1.5, rpx(3));
    ctx.strokeText('信', x, y);
  },

  // 包豪斯几何：右上出血的红圆 / 蓝三角（朝上）/ 黑杆 / 黄点
  drawAbsBauhaus(ctx, layout, colors) {
    const R = (right, w) => EXPORT_W - rpx(right) - rpx(w); // 按 CSS right + width 反推左边缘
    // 红圆：top -56 / right -50 / 200×200
    ctx.fillStyle = colors.red;
    ctx.beginPath();
    ctx.arc(R(-50, 200) + rpx(100), -rpx(56) + rpx(100), rpx(100), 0, Math.PI * 2);
    ctx.fill();
    // 蓝三角：top 118 / right 56，border-left/right 56 transparent + border-bottom 100
    // 边框盒 112×100，中心即旋转中心；border-bottom 画出的三角形尖朝上
    const triW = rpx(112);
    const triH = rpx(100);
    const triCX = R(56, 112) + triW / 2;
    const triCY = rpx(118) + triH / 2;
    ctx.save();
    ctx.translate(triCX, triCY);
    ctx.rotate((14 * Math.PI) / 180);
    ctx.fillStyle = colors.blue;
    ctx.beginPath();
    ctx.moveTo(0, -triH / 2);
    ctx.lineTo(triW / 2, triH / 2);
    ctx.lineTo(-triW / 2, triH / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 黑杆：top 30 / right 196 / 18×150，rotate 24°
    const barW = rpx(18);
    const barH = rpx(150);
    ctx.save();
    ctx.translate(R(196, 18) + barW / 2, rpx(30) + barH / 2);
    ctx.rotate((24 * Math.PI) / 180);
    ctx.fillStyle = colors.ink;
    ctx.fillRect(-barW / 2, -barH / 2, barW, barH);
    ctx.restore();
    // 黄点：top 196 / right 148 / 28×28
    ctx.fillStyle = colors.yellow;
    ctx.beginPath();
    ctx.arc(R(148, 28) + rpx(14), rpx(196) + rpx(14), rpx(14), 0, Math.PI * 2);
    ctx.fill();
  },

  // 黑胶唱片：右上出血圆盘（同心纹周期 12rpx：暗 9 + 亮 3）+ 红盘芯 + 盘芯印字
  drawAbsVinyl(ctx, layout, colors, view) {
    const R = rpx(200);
    const cx = EXPORT_W - rpx(-120) - R; // right: -120rpx / width 400rpx
    const cy = -rpx(150) + R;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#131215';
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    // repeating-radial-gradient(circle at center, #131215 0 9rpx, #201E22 9rpx 12rpx)
    ctx.strokeStyle = '#201E22';
    ctx.lineWidth = rpx(3);
    for (let r = rpx(9) + rpx(1.5); r < R; r += rpx(12)) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 高光：radial-gradient(circle at 32% 28%, rgba(255,255,255,0.10), transparent 42%)
    const hx = cx - R + R * 2 * 0.32;
    const hy = cy - R + R * 2 * 0.28;
    const hR = R * 2 * Math.sqrt(0.68 * 0.68 + 0.72 * 0.72) * 0.42;
    const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, hR);
    grad.addColorStop(0, 'rgba(255,255,255,0.10)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();

    // 红盘芯（150×150）+ 印字（15 hei / 26 mono / 14 hei / 中孔 14）
    const lr = rpx(75);
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, lr, 0, Math.PI * 2);
    ctx.fill();
    const r1 = runBox(15, 'hei', null, K);
    const r2 = runBox(26, 'mono', null, K);
    const r3 = runBox(14, 'hei', null, K);
    const hole = rpx(14);
    const stack = r1.boxH + rpx(3) + r2.boxH + rpx(2) + r3.boxH + rpx(6) + hole;
    let ty = cy - stack / 2;
    ctx.fillStyle = '#F4E8D8';
    ctx.textAlign = 'center';
    ctx.font = fontStr(r1.size, 'hei', '');
    drawSpaced(ctx, '心灵信箱', cx, ty + r1.base, rpx(3), 'center');
    ty += r1.boxH + rpx(3);
    ctx.font = fontStr(r2.size, 'mono', '700 ');
    ctx.fillText(view.stampText, cx, ty + r2.base);
    ty += r2.boxH + rpx(2);
    ctx.font = fontStr(r3.size, 'hei', '');
    drawSpaced(ctx, view.yearText, cx, ty + r3.base, rpx(2), 'center');
    ty += r3.boxH + rpx(6);
    ctx.fillStyle = '#1B1A1C';
    ctx.beginPath();
    ctx.arc(cx, ty + hole / 2, hole / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
  },

  // 素问笺：右上斜盖邮戳（虚线圆框 + 写于/08.30/2026，opacity 0.85，rotate -9°）
  drawAbsSuwen(ctx, layout, colors, view) {
    const size = rpx(72);
    const x = EXPORT_W - rpx(32) - size;
    const y = rpx(28);
    const lw = Math.max(1, rpx(2));
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.translate(x + size / 2, y + size / 2);
    ctx.rotate((-9 * Math.PI) / 180);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = lw;
    ctx.setLineDash([rpx(4), rpx(4)]);
    ctx.beginPath();
    ctx.arc(0, 0, size / 2 - lw / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const r1 = runBox(12, 'hei', null, K);
    const r2 = runBox(18, 'song', null, K);
    const gap = rpx(2);
    const stack = r1.boxH + gap + r2.boxH + gap + r1.boxH;
    let ty = -stack / 2;
    ctx.fillStyle = colors.accent;
    ctx.textAlign = 'center';
    ctx.font = fontStr(r1.size, 'hei', '');
    drawSpaced(ctx, '写 于', 0, ty + r1.base, rpx(4), 'center');
    ty += r1.boxH + gap;
    ctx.font = fontStr(r2.size, 'song', '');
    drawSpaced(ctx, view.stampText, 0, ty + r2.base, rpx(2), 'center');
    ty += r2.boxH + gap;
    ctx.font = fontStr(r1.size, 'hei', '');
    drawSpaced(ctx, view.yearText, 0, ty + r1.base, rpx(2), 'center');
    ctx.restore();
    ctx.textAlign = 'left';
  },

  // 航空笺：全幅 45° 斜纹画框（红 13 / 米 9 / 蓝 13 / 米 9）+ 内层纸面
  drawAbsAirmail(ctx, layout, colors) {
    const H = layout.paperH;
    ctx.save();
    ctx.translate(EXPORT_W / 2, H / 2);
    ctx.rotate(Math.PI / 4);
    const diag = Math.ceil(Math.sqrt(EXPORT_W * EXPORT_W + H * H));
    let sx = -diag;
    const band = [['stripe1', 13], ['stripe2', 9], ['stripe3', 13], ['stripe2', 9]];
    while (sx < diag) {
      for (let i = 0; i < band.length; i += 1) {
        ctx.fillStyle = resolveColor(band[i][0], colors);
        const w = rpx(band[i][1]);
        ctx.fillRect(sx, -diag, w, diag * 2);
        sx += w;
      }
    }
    ctx.restore();
    // .pla-sheet：纸面内缩 12rpx，自身再留 36/36/34 内边距（由 spec.sheet 参与排版）
    ctx.fillStyle = colors.bg;
    ctx.fillRect(rpx(12), rpx(12), EXPORT_W - rpx(24), H - rpx(24));
  },

  // Canvas createImage() 不认 cloud:// fileID：须经 cloud 服务换本地临时路径再绘制；
  // 本地/网络路径原样使用。
  // 同一 src 只解码一次（缓存的是 Promise，并发调用也不会重复解码）：小程序码与信封图
  // 在一次导出中被反复使用，连续「保存到相册」「发给好友」旧版会各自重新解码一遍。
  // 解码失败不缓存，下次仍可重试；图片对象归属本页 canvas，页面销毁即随之释放。
  loadImage(src) {
    this._imgCache = this._imgCache || {};
    if (this._imgCache[src]) return this._imgCache[src];
    const toLocal = src && src.indexOf('cloud://') === 0
      ? cloud.downloadFile(src)
      : Promise.resolve(src);
    const pending = toLocal.then(
      (path) =>
        new Promise((resolve, reject) => {
          const img = this._canvas.createImage();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = path;
        })
    );
    this._imgCache[src] = pending;
    pending.catch(() => {
      delete this._imgCache[src];
    });
    return pending;
  },

  canvasToFile(canvas) {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        fileType: 'jpg',
        quality: 0.92,
        destWidth: canvas.width,
        destHeight: canvas.height,
        success: (res) => resolve(res.tempFilePath),
        fail: reject
      });
    });
  },

  // ── 保存到相册（失败含相册权限引导）──
  onSave() {
    this.exportPostcard()
      .then((filePath) => {
        wx.saveImageToPhotosAlbum({
          filePath,
          success: () => {
            // 埋点：保存图片（传播完成行为，PRD 第十三节）
            track('share_image_save', { theme_id: this.data.theme.id });
            wx.showToast({ title: '已保存到相册', icon: 'success' });
          },
          fail: (res) => {
            if (res.errMsg && res.errMsg.indexOf('auth') > -1) {
              wx.showModal({
                title: '需要相册权限',
                content: '把明信片收进相册需要相册权限，去设置里打开吧。',
                confirmText: '去设置',
                success: (r) => {
                  if (r.confirm) wx.openSetting();
                }
              });
            } else if (res.errMsg && res.errMsg.indexOf('cancel') === -1) {
              wx.showToast({ title: '保存没有成功，再试一次吧', icon: 'none' });
            }
          }
        });
      })
      .catch((e) => this.handleExportError(e));
  },

  // ── 发给微信好友（微信图片分享面板）──
  onSend() {
    this.exportPostcard()
      .then((filePath) => {
        if (wx.showShareImageMenu) {
          wx.showShareImageMenu({
            path: filePath,
            success: () => {
              // 埋点：分享（传播完成行为，PRD 第十三节）
              track('share_send', { theme_id: this.data.theme.id });
            }
          });
        } else {
          // 低版本基础库兜底：提示长按保存后转发
          wx.previewImage({ urls: [filePath] });
          wx.showToast({ title: '长按图片可发送给朋友', icon: 'none', duration: 2500 });
        }
      })
      .catch((e) => this.handleExportError(e));
  },

  handleExportError(e) {
    if (e && e.message === 'busy') return; // 正在生成中的重复点击直接忽略
    console.error('[share] export failed', e);
    wx.showToast({ title: '生成没有成功，再试一次吧', icon: 'none' });
  }
});

// 真实小程序码（品牌区扫码入口，预览与导出同源）
const QR_SRC = '/assets/qrcode.jpg';

// 逐字距绘制（canvas 无通用 letterSpacing）
// 这里逐字给的是「左边缘」坐标，所以绘制期间必须强制 textAlign: left ——
// 否则调用方若设了 center/right，每个字会各自再偏移半个字宽，整行向左跑。
function drawSpaced(ctx, text, x, y, spacing, align) {
  const chars = String(text).split('');
  const total = chars.reduce((acc, ch) => acc + ctx.measureText(ch).width, 0) + spacing * (chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  chars.forEach((ch) => {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  });
  ctx.textAlign = prev;
  return total;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
