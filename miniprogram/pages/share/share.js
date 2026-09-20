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
// 默认款（services/theme.js 显式按 id 解析，与列表顺序无关）：主题璀璨如初 / 信纸留白志
const DEFAULT_THEME_ID = require('../../services/theme.js').DEFAULT_THEME_ID;
const DEFAULT_PAPER_ID = require('../../services/theme.js').DEFAULT_PAPER_ID;
const defTheme = (list) => (list || []).find((t) => t.id === DEFAULT_THEME_ID) || (list || [])[0];
const defPaper = (list) => (list || []).find((p) => p.id === DEFAULT_PAPER_ID) || (list || [])[0];
const { buildView } = require('../write/paper-view.js');
const { METRICS, specOf, resolveColor, fmt, lineBox } = require('../write/paper-specs.js');
const letterService = require('../../services/letter.js');
const themeService = require('../../services/theme.js');
const memberService = require('../../services/member.js');
const analytics = require('../../services/analytics.js');
const privacyService = require('../../services/privacy.js');
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

// 富文本换行（结业证书 verdict）：segs = [{t, weight, color}]，逐段携带自己的字重/颜色
// 参与同一版断行 —— 空白折叠、CJK 逐字断、Latin 整词换行的口径与 wrapLines 一致。
// 段宽按各段自己的字体实测累加；行宽超出 maxW 即换行。
function wrapRich(ctx, segs, item, sizePx, maxW, ls) {
  const out = [];
  let cur = [];
  let curW = 0;
  const flush = () => {
    if (cur.length) {
      out.push({ parts: cur, w: curW });
      cur = [];
      curW = 0;
    }
  };
  for (let si = 0; si < segs.length; si += 1) {
    const seg = segs[si];
    ctx.font = fontStr(sizePx, item.face, seg.weight || item.weight);
    const color = seg.color || item.color;
    const weight = seg.weight || item.weight;
    const toks = tokenize(String(seg.t == null ? '' : seg.t));
    for (let ti = 0; ti < toks.length; ti += 1) {
      const tk = toks[ti];
      if (tk.type === 'space') {
        if (!cur.length) continue; // 行首空白丢弃，与 CSS 一致
        const sw = adv(ctx, tk.text, ls);
        if (curW + sw <= maxW) {
          cur.push({ text: tk.text, weight, color });
          curW += sw;
        }
        continue;
      }
      const tw = adv(ctx, tk.text, ls);
      if (curW + tw > maxW && cur.length) flush();
      if (tk.type === 'word' && tw > maxW) {
        const chars = tk.text.split('');
        for (let j = 0; j < chars.length; j += 1) {
          const cw = adv(ctx, chars[j], ls);
          if (curW + cw > maxW && cur.length) flush();
          cur.push({ text: chars[j], weight, color });
          curW += cw;
        }
        continue;
      }
      cur.push({ text: tk.text, weight, color });
      curW += tw;
    }
  }
  flush();
  if (!out.length) out.push({ parts: [], w: 0 });
  return out;
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
    // 行首符号（号外的「■ 」、裁切笺的「Q/A」）：::before 继承父级字体族，可覆盖字重
    let prefix = null;
    if (item.prefix) {
      const ps = R(item.prefix.size);
      prefix = {
        text: item.prefix.text,
        size: ps,
        face: item.face,
        weight: item.prefix.weight || item.weight,
        color: item.prefix.color,
        w: 0
      };
      ctx.font = fontStr(ps, item.face, prefix.weight);
      prefix.w = adv(ctx, prefix.text, 0);
      ctx.font = fontStr(size, item.face, item.weight);
    }

    // 首行缩进（版心笺 text-indent）：只压缩首行可宽；居中/右对齐的 indent 是字距补偿，不走这条
    const firstIndent = item.indent && item.align !== 'center' && item.align !== 'right' ? R(item.indent) : 0;

    const widthAt = (i) => {
      let w = maxW;
      if (prefix && i === 0) w -= prefix.w;
      if (drop && i < drop.rows) w = maxW - drop.w;
      if (firstIndent && i === 0) w -= firstIndent;
      return w;
    };

    const avail = contentW - insetL - R(item.insetR || 0) - (box ? Math.round(boxPad) : 0);
    const maxW = item.frac ? Math.round(avail * item.frac) : avail;
    ctx.font = fontStr(size, item.face, item.weight);
    const text = item.drop ? String(view.answerRest || '') : item.f ? String(view[item.f] || '') : fmt(item.text, view);

    // 富文本（证书结业词）：一句里两种字色/字重，逐段携带样式参与同一版断行
    let lines;
    if (item.rich) {
      const richSegs = item.rich.map((s) => Object.assign({}, s, { t: fmt(s.t, view) }));
      lines = wrapRich(ctx, richSegs, item, size, maxW, ls).map((ln) => ({
        text: ln.parts.map((p) => p.text).join(''),
        end: true,
        w: ln.w,
        parts: ln.parts
      }));
    } else {
      lines = wrapLines(ctx, text, widthAt, ls).map((ln) => ({
        text: ln.text,
        end: ln.end,
        w: adv(ctx, ln.text, ls)
      }));
    }

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
      rich: item.rich ? lines.map((ln) => ({ parts: ln.parts, w: ln.w })) : null,
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
      if (sup.block) {
        // 实心块光标（终端笺）：只带几何与颜色，不参与文本测量
        op.sup = { block: true, w: R(sup.w), h: R(sup.h), gap: R(sup.gap || 0), color: sup.color };
      } else {
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
    }

    // cap 的延伸细线：flex 行内 align-items:center → 线的中线 = 行盒中线；
    // 有 prefix 时（证书 cap 的 ◆）线要从「前缀 + 文字」之后开始
    if (item.rule) {
      const rh = R(item.rule.h);
      const gap = R(item.rule.gap || 0);
      const ry = inner + (rb.boxH - rh) / 2;
      ctx.font = fontStr(size, item.face, item.weight);
      const tw = adv(ctx, fmt(item.text, view), ls) + (prefix ? prefix.w : 0);
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

  // 两端对齐的一行两段（报头日期栏 / 眉行 / 页脚）。
  // full: 整幅出血（日历撕线/月份带，越过纸面左右内边距贴到纸边）；
  // bg: 整块铺色（月份带）；border.bottom: 分隔线落在文字下方（撕线）。
  function lrBlock(item, top) {
    const bl = item.full ? 0 : left;
    const br = item.full ? EXPORT_W : right;
    const l = runBox(item.left.size, item.left.face, item.left.lh, k);
    const r = runBox(item.right.size, item.right.face, item.right.lh, k);
    const base = Math.max(l.base, r.base);
    const rowH = base + Math.max(l.below, r.below);
    const px = R(item.px || 0);
    let inner = top;
    const bdBottom = !!(item.border && item.border.bottom);
    if (item.border && !bdBottom) {
      ops.push({ k: 'line', x: bl, y: top, w: br - bl, h: R(item.border.h), color: item.border.color, dash: item.border.dash });
      inner += R(item.border.h);
    }
    if (item.pt) inner += R(item.pt);
    const runsY = inner + base;
    const runsBottom = inner + rowH;
    let bottom = runsBottom + R(item.pb || 0);
    if (bdBottom) bottom += R(item.border.h);
    if (item.bg) ops.push({ k: 'rect', x: bl, y: top, w: br - bl, h: bottom - top, color: item.bg });
    if (bdBottom) {
      ops.push({ k: 'line', x: bl, y: runsBottom, w: br - bl, h: R(item.border.h), color: item.border.color, dash: item.border.dash });
    }
    ops.push({
      k: 'runs',
      runs: [
        { text: fmt(item.left.text, view), x: bl + px, y: runsY, align: 'left', ...l, ls: item.left.ls ? R(item.left.ls) : 0, face: item.left.face, weight: item.left.weight, color: item.left.color },
        { text: fmt(item.right.text, view), x: br - px, y: runsY, align: 'right', ...r, ls: item.right.ls ? R(item.right.ls) : 0, face: item.right.face, weight: item.right.weight, color: item.right.color }
      ]
    });
    return bottom;
  }

  // 竖排块（竖排笺）：writing-mode: vertical-rl 的 Canvas 复刻。
  // 列从内容区右缘向左排；每列容量 = floor(块高 / 单字步进)（竖排单字步进取 1em + 字距），
  // 列距 = 字号 × 行高。整组放不进内容宽时整体缩小字号重排 —— 导出图必须完整呈现，
  // 与 MAX_PAPER_H 的兜底同口径（预览侧超长信向左溢出、由横向滚动兜底）。
  function vbodyBlock(item, top) {
    const H = item.h; // rpx，固定块高（预览与导出同值）
    const contentR = contentW / k; // 内容区宽（rpx）
    const items = item.cols || [];

    // 某缩放系数下的排布计划（rpx）：各元素的列集与距右缘的起位
    function planAt(s) {
      const plan = [];
      let cursor = 0;
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i];
        const size = it.size * s;
        const ls = (it.ls || 0) * s;
        const gap = (it.gap || 0) * s;
        if (it.tag) {
          const chipW = lineBox(it.size, it.face) * s + (it.padX + it.border) * 2 * s;
          plan.push({ it, tag: true, chipW, cursor });
          cursor += chipW + gap;
        } else {
          const text = it.f ? String(view[it.f] || '') : fmt(it.text, view);
          const capacity = Math.max(1, Math.floor(H / (size + ls)));
          const cols = [];
          String(text).split('\n').forEach((para) => {
            const chars = para.split('');
            for (let c = 0; c < chars.length; c += capacity) cols.push(chars.slice(c, c + capacity));
          });
          if (!cols.length) cols.push(['']);
          const pitch = it.lh ? size * it.lh : lineBox(it.size, it.face) * s;
          plan.push({ it, cols, pitch, cursor });
          cursor += cols.length * pitch + gap;
        }
      }
      return { plan, width: cursor };
    }

    let s = 1;
    let out = planAt(s);
    while (out.width * k > contentW && s > 0.45) {
      s = Math.max(0.45, s * 0.92);
      out = planAt(s);
    }

    for (let i = 0; i < out.plan.length; i += 1) {
      const p = out.plan[i];
      const it = p.it;
      if (p.tag) {
        ops.push({
          k: 'vtag',
          x: left + R(contentR - (p.cursor + p.chipW)),
          y: top,
          w: R(p.chipW),
          h: R(it.size * s + (it.pt + it.pb + it.border * 2) * s),
          ch: it.tag,
          size: R(it.size * s),
          face: it.face,
          color: it.color,
          bg: it.fill ? it.chipBg : null,
          line: it.line,
          lw: R(it.border * s),
          chY: top + R((it.border + it.pt + it.size / 2) * s)
        });
      } else {
        const colOps = [];
        for (let c = 0; c < p.cols.length; c += 1) {
          colOps.push({ x: left + R(contentR - (p.cursor + c * p.pitch + p.pitch / 2)), chars: p.cols[c] });
        }
        ops.push({
          k: 'text',
          field: it.f || null,
          vertical: {
            top: top + R((it.pt || 0) * s),
            advance: R((it.size + (it.ls || 0)) * s),
            cols: colOps
          },
          x: 0,
          y: top,
          lines: [],
          size: R(it.size * s),
          face: it.face,
          weight: '',
          ls: R((it.ls || 0) * s),
          align: 'left',
          color: it.color
        });
      }
    }
    return top + R(H);
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
      const bodyTop = y;
      let bottom;
      if (lead.style === 'plain') {
        // 纯文字引头（处方笺 Rp）：实测宽度参与正文缩进，不画色块；body 可为多段
        const bodies = Array.isArray(it.body) ? it.body : [it.body];
        ctx.font = fontStr(R(lead.size), lead.face, lead.weight);
        const leadW = adv(ctx, lead.text, 0);
        const leadOuter = leadW + R(lead.gap);
        let yy = bodyTop;
        bottom = bodyTop;
        for (let bi = 0; bi < bodies.length; bi += 1) {
          const b = Object.assign({}, bodies[bi], { insetL: (bodies[bi].insetL || 0) + leadOuter });
          yy = textBlock(b, yy) + R(bodies[bi].mb || 0);
          bottom = Math.max(bottom, yy);
        }
        const lRun = runBox(lead.size, lead.face, lead.lh, k);
        ops.push({
          k: 'rowlead',
          style: 'plain',
          x: left,
          y: bodyTop + R(lead.mt || 0),
          text: lead.text,
          size: R(lead.size),
          face: lead.face,
          weight: lead.weight,
          textColor: lead.color,
          textBase: bodyTop + R(lead.mt || 0) + lRun.base
        });
        bottom = Math.max(bottom, bodyTop + R(lead.mt || 0) + lRun.boxH);
      } else {
        const leadX = lead.style === 'outline' ? R(lead.border || 0) : 0;
        const leadOuter = R(lead.w) + leadX * 2 + R(lead.gap);
        const body = Object.assign({}, it.body, { insetL: leadOuter });
        bottom = textBlock(body, bodyTop);
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
        bottom = Math.max(bottom, bodyTop + leadH);
      }
      y = bottom + R(it.mb || 0);
    } else if (it.k === 'datehead') {
      // 日历撕页日期头：左侧特大日期数字 + 右侧星期/黄历角签（flex-end 底对齐）
      const big = it.big;
      const bRun = runBox(big.size, big.face, big.lh, k);
      ctx.font = fontStr(R(big.size), big.face, big.weight);
      const bigText = big.f ? String(view[big.f] || '') : fmt(big.text, view);
      const bigW = adv(ctx, bigText, big.ls ? R(big.ls) : 0);
      const wRun = runBox(it.wk.size, it.wk.face, it.wk.lh, k);
      ctx.font = fontStr(R(it.wk.size), it.wk.face, it.wk.weight);
      const wkText = fmt(it.wk.text, view);
      const wkW = adv(ctx, wkText, it.wk.ls ? R(it.wk.ls) : 0);
      const al = it.alm;
      const aRun = runBox(al.size, al.face, al.lh, k);
      ctx.font = fontStr(R(al.size), al.face, al.weight);
      const almText = fmt(al.text, view);
      const abw = R(al.border);
      const apx = R(al.padX);
      const apy = R(al.padY);
      const almW = abw * 2 + apx * 2 + adv(ctx, almText, al.ls ? R(al.ls) : 0);
      const almH = abw * 2 + apy * 2 + aRun.boxH;
      const rowH = bRun.boxH;
      const asideX = left + bigW + R(it.gap);
      const almY = y + rowH - R(it.asidePb) - almH;
      const wkY = almY - R(it.almMt) - wRun.boxH;
      ops.push({
        k: 'datehead',
        y: y,
        big: { text: bigText, x: left, base: y + bRun.base, size: R(big.size), face: big.face, weight: big.weight || '', ls: big.ls ? R(big.ls) : 0, color: big.color },
        wk: { text: wkText, x: asideX, base: wkY + wRun.base, size: R(it.wk.size), face: it.wk.face, weight: it.wk.weight || '', ls: it.wk.ls ? R(it.wk.ls) : 0, color: it.wk.color },
        alm: {
          text: almText, x: asideX, y: almY, w: almW, h: almH, lw: abw,
          tx: asideX + abw + apx, base: almY + abw + apy + aRun.base,
          size: R(al.size), face: al.face, weight: al.weight || '', ls: al.ls ? R(al.ls) : 0, color: al.color
        }
      });
      y += rowH + R(it.mb || 0);
    } else if (it.k === 'rxhead') {
      // 处方笺抬头：左诊所名两行 + 右上 Rx 编号框（顶对齐）
      const cRun = runBox(it.cn.size, it.cn.face, it.cn.lh, k);
      const eRun = runBox(it.en.size, it.en.face, it.en.lh, k);
      const ch = it.chip;
      const chipRun = runBox(ch.size, ch.face, ch.lh, k);
      ctx.font = fontStr(R(ch.size), ch.face, ch.weight);
      const chipText = fmt(ch.text, view);
      const cbw = R(ch.border);
      const cpx = R(ch.padX);
      const cpy = R(ch.padY);
      const chipW = cbw * 2 + cpx * 2 + adv(ctx, chipText, ch.ls ? R(ch.ls) : 0);
      const chipH = cbw * 2 + cpy * 2 + chipRun.boxH;
      const enMt = R(it.en.mt || 0);
      const rowH = Math.max(cRun.boxH + enMt + eRun.boxH, chipH);
      ops.push({
        k: 'rxhead',
        y: y,
        cn: { text: fmt(it.cn.text, view), x: left, base: y + cRun.base, size: R(it.cn.size), face: it.cn.face, weight: it.cn.weight || '', ls: it.cn.ls ? R(it.cn.ls) : 0, color: it.cn.color },
        en: { text: fmt(it.en.text, view), x: left, base: y + cRun.boxH + enMt + eRun.base, size: R(it.en.size), face: it.en.face, weight: it.en.weight || '', ls: it.en.ls ? R(it.en.ls) : 0, color: it.en.color },
        chip: {
          text: chipText, x: right - chipW, y: y, w: chipW, h: chipH, lw: cbw,
          tx: right - chipW + cbw + cpx, base: y + cbw + cpy + chipRun.base,
          size: R(ch.size), face: ch.face, weight: ch.weight || '', ls: ch.ls ? R(ch.ls) : 0, color: ch.color
        }
      });
      y += rowH + R(it.mb || 0);
    } else if (it.k === 'fields') {
      // 处方笺表单栏：N 格横排，每格「小标签 + 值」+ 底边线。
      // 值直接以 text op 落进 ops（带 field 的格计入「名称入图」口径）；
      // 值超格宽时在格内换行（WXSS 侧由 flex 格自然换行），行高撑底边线。
      const gap = R(it.gap);
      const n = it.cells.length;
      const cellW = Math.floor((contentW - gap * (n - 1)) / n);
      const ks = it.ks;
      const vs = it.vs;
      const kRun = runBox(ks.size, ks.face, ks.lh, k);
      const vRun = runBox(vs.size, vs.face, vs.lh, k);
      const base = Math.max(kRun.base, vRun.base);
      const rowBox = base + Math.max(kRun.below, vRun.below);
      const lsK = ks.ls ? R(ks.ls) : 0;
      const lsV = vs.ls ? R(vs.ls) : 0;
      const kGapPx = R(it.kGap || 0);
      const cellsData = it.cells.map((c, i) => {
        const cx0 = left + i * (cellW + gap);
        ctx.font = fontStr(R(ks.size), ks.face, ks.weight);
        const kText = fmt(c.k, view);
        const kW = adv(ctx, kText, lsK);
        ctx.font = fontStr(R(vs.size), vs.face, vs.weight);
        const vText = c.f ? String(view[c.f] || '') : fmt(c.v, view);
        const vAvail = Math.max(0, cellW - kW - kGapPx);
        const vLines = wrapLines(ctx, vText, () => vAvail, lsV).map((ln) => ({
          text: ln.text,
          end: ln.end,
          w: adv(ctx, ln.text, lsV)
        }));
        return { c, cx0, kText, kW, vLines };
      });
      const maxLines = Math.max.apply(null, cellsData.map((d) => d.vLines.length));
      const cellH = rowBox + (maxLines - 1) * vRun.boxH + R(it.pb || 0);
      const mkCellText = (spec2, r2, text, x, lineBaseY, availW, field) => ({
        k: 'text',
        x,
        y: lineBaseY - r2.base,
        avail: availW,
        lines: [{ text, end: true, w: 0, y: lineBaseY }],
        lh: r2.boxH,
        size: R(spec2.size),
        face: spec2.face,
        weight: spec2.weight || '',
        ls: spec2.ls ? R(spec2.ls) : 0,
        align: 'left',
        justify: false,
        indent: 0,
        color: spec2.color,
        field: field || null,
        prefix: null,
        drop: null,
        rich: null,
        dash: null,
        sup: null,
        vertical: null
      });
      for (const d of cellsData) {
        ops.push({ k: 'line', x: d.cx0, y: y + cellH, w: cellW, h: R(it.lw || 2), color: it.lineColor });
        ops.push(mkCellText(ks, kRun, d.kText, d.cx0, y + base, cellW, null));
        d.vLines.forEach((ln, li) => {
          ops.push(mkCellText(vs, vRun, ln.text, d.cx0 + d.kW + kGapPx, y + base + li * vRun.boxH, Math.max(0, cellW - d.kW - kGapPx), li === 0 ? d.c.f : null));
        });
      }
      y += cellH + R(it.mb || 0);
    } else if (it.k === 'rxsig') {
      // 处方笺签名区：左用法两行（底对齐）+ 右红圈章/医师签名栏（底对齐）
      const us = it.usage;
      const uRun = runBox(us.size, us.face, us.lh, k);
      const usageLines = fmt(us.text, view).split('\n');
      ctx.font = fontStr(R(us.size), us.face, us.weight);
      const usageH = usageLines.length * uRun.boxH;
      const s = it.seal;
      const sz = R(s.box);
      const aRun = runBox(s.textSize, s.face, s.lh || 1.2, k);
      const bRun = runBox(s.subSize, s.subFace, s.lh || 1.2, k);
      const doc = it.doctor;
      const dRun = runBox(doc.size, doc.face, doc.lh, k);
      ctx.font = fontStr(R(doc.size), doc.face, doc.weight);
      const docText = fmt(doc.text, view);
      const docW = adv(ctx, docText, doc.ls ? R(doc.ls) : 0) + R(doc.padX) * 2;
      const sk = it.sigk;
      const skRun = runBox(sk.size, sk.face, sk.lh, k);
      ctx.font = fontStr(R(sk.size), sk.face, sk.weight);
      const skW = adv(ctx, fmt(sk.text, view), sk.ls ? R(sk.ls) : 0);
      const colW = Math.max(sz, docW, skW);
      const colX = right - colW;
      const docBlockH = R(doc.mt) + dRun.boxH + R(doc.pb) + R(doc.lineH);
      const colH = sz + docBlockH + R(sk.mt) + skRun.boxH;
      const rowH = Math.max(usageH, colH);
      const sealY = y + rowH - colH;
      const docTop = sealY + sz + R(doc.mt);
      const skTop = sealY + sz + docBlockH + R(sk.mt);
      const usageBottom = y + rowH;
      ops.push({
        k: 'rxsig',
        y: y,
        rowH,
        usage: usageLines.map((t, i) => ({ text: t, x: left, y: usageBottom - (usageLines.length - i) * uRun.boxH + uRun.base })),
        uRun: { size: R(us.size), face: us.face, weight: us.weight || '', ls: us.ls ? R(us.ls) : 0, color: us.color },
        seal: {
          x: colX + (colW - sz) / 2, y: sealY, box: sz, rotate: s.rotate || 0,
          lw: R(s.lw), ring: s.ring, innerColor: s.innerColor, innerR: R(s.inner), innerLw: R(s.innerLw),
          text: s.text, textSize: R(s.textSize), face: s.face, weight: s.weight || '', ls: s.ls ? R(s.ls) : 0, color: s.color,
          aBase: -(aRun.boxH + R(s.subGap) + bRun.boxH) / 2 + aRun.base,
          sub: s.sub, subSize: R(s.subSize), subFace: s.subFace, subLs: s.subLs ? R(s.subLs) : 0, subColor: s.subColor,
          bBase: -(aRun.boxH + R(s.subGap) + bRun.boxH) / 2 + aRun.boxH + R(s.subGap) + bRun.base
        },
        doctor: {
          text: docText, cx: colX + colW / 2, base: docTop + dRun.base,
          size: R(doc.size), face: doc.face, weight: doc.weight || '', ls: doc.ls ? R(doc.ls) : 0, color: doc.color,
          w: docW, lineY: docTop + dRun.boxH + R(doc.pb), lineH: R(doc.lineH), lineColor: doc.line
        },
        sigk: {
          text: fmt(sk.text, view), cx: colX + colW / 2, base: skTop + skRun.base,
          size: R(sk.size), face: sk.face, weight: sk.weight || '', ls: sk.ls ? R(sk.ls) : 0, color: sk.color
        }
      });
      y += rowH + R(it.mb || 0);
    } else if (it.k === 'zssig') {
      // 证书落款区：左颁发栏两行（底对齐）+ 右红印与缎带（底对齐）
      const oRun = runBox(it.orgRun.size, it.orgRun.face, it.orgLh, k);
      const kkRun = runBox(it.orgK.size, it.orgK.face, it.orgK.lh, k);
      const orgLines = it.org.map((o) => {
        ctx.font = fontStr(R(it.orgRun.size), it.orgRun.face, it.orgRun.weight);
        const tW = adv(ctx, fmt(o.text, view), it.orgRun.ls ? R(it.orgRun.ls) : 0);
        ctx.font = fontStr(R(it.orgK.size), it.orgK.face, it.orgK.weight);
        const kW2 = adv(ctx, fmt(o.prefix, view), it.orgK.ls ? R(it.orgK.ls) : 0);
        return { prefix: fmt(o.prefix, view), text: fmt(o.text, view), kW: kW2, w: kW2 + R(it.orgGap) + tW };
      });
      const s = it.seal;
      const sz = R(s.box);
      const sRun = runBox(s.size, s.face, s.lh || 1.2, k);
      const rb2 = it.ribbon;
      const ribW = R(rb2.w) * 2 + R(rb2.gap);
      const colW = Math.max(sz, ribW);
      const colH = sz + R(rb2.h) + R(rb2.mt);
      const orgH = orgLines.length * oRun.boxH;
      const rowH = Math.max(orgH, colH);
      const sealY = y + rowH - colH;
      const orgW = Math.max.apply(null, orgLines.map((l) => l.w));
      ops.push({
        k: 'zssig',
        y: y,
        rowH,
        orgGap: R(it.orgGap),
        orgLines: orgLines.map((l, i) => {
          const lineBottom = y + rowH - (orgLines.length - 1 - i) * oRun.boxH;
          return Object.assign({}, l, { x: left, base: lineBottom - oRun.below });
        }),
        orgW,
        orgRun: { size: R(it.orgRun.size), face: it.orgRun.face, weight: it.orgRun.weight || '', ls: it.orgRun.ls ? R(it.orgRun.ls) : 0, color: it.orgRun.color },
        orgK: { size: R(it.orgK.size), face: it.orgK.face, weight: it.orgK.weight || '', ls: it.orgK.ls ? R(it.orgK.ls) : 0, color: it.orgK.color },
        seal: {
          x: right - colW + (colW - sz) / 2, y: sealY, box: sz, rotate: s.rotate || 0,
          bg: s.bg, color: s.color, text: s.text, size: R(s.size), face: s.face, weight: s.weight || '',
          ls: s.ls ? R(s.ls) : 0, base: sRun.base, boxH: sRun.boxH
        },
        ribbon: { x: right - colW + colW / 2, y: sealY + sz + R(rb2.mt), w: R(rb2.w), h: R(rb2.h), gap: R(rb2.gap), color: rb2.color }
      });
      y += rowH + R(it.mb || 0);
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
    } else if (it.k === 'vbody') {
      y = vbodyBlock(it, y);
    } else if (it.k === 'sep') {
      // 居中笺分隔：两段细线夹一枚旋转 45° 的菱形（.pljz-sep）
      const d = R(it.d);
      const w = R(it.w);
      ops.push({
        k: 'sep',
        x: Math.round(cx - w / 2),
        y,
        w,
        d,
        seg: Math.max(0, R((it.w - it.d) / 2 - it.gap)),
        color: it.color,
        dColor: it.dColor
      });
      y += d + R(it.mb || 0);
    }
  }

  const paperH = y + R(pad[2] + bd[2] + sheet[2]);
  return { paperH, left, right, contentW, cx, ops, scale, spec, k };
}

Page({
  data: {
    statusBarHeight: 20,
    letter: { name: '', question: '', answer: '' },
    theme: defTheme(THEMES),
    themeName: defTheme(THEMES).name,
    paper: defPaper(PAPERS),
    view: buildView({ name: '', question: '', answer: '' }, { created: new Date() }),
    // 预览区三态：loading 出图中 / shot 已是成品图 / fallback 出图失败回落 WXML 版式预览
    stage: 'loading',
    // 成品图临时路径：预览显示的就是这个文件，保存/分享复用它，不再二次绘制
    shotSrc: '',
    // 成品图在预览宽度下的显示高（rpx）：骨架先按成品高度占位，换图时不跳高
    shotH: 0
  },

  onLoad(options) {
    const win = wx.getWindowInfo();
    this.setData({
      statusBarHeight: win.statusBarHeight || 20
    });

    // 与详情页同源：经 letter 服务读取（真实寄出的信优先，否则演示数据预览）；
    // 版式经 theme 服务解析（未知 paper_id 回落默认款留白志；非 VIP 专属版式同样回落默认）。
    // 信纸取色只用 paper.colors。
    Promise.all([letterService.get(options && options.id), themeService.getThemes(), themeService.getPapers(), memberService.getMembership()])
      .then(([res, themes, papers, m]) => {
        const letter = res.letter;
        const isVip = !!(m && m.state === 'vip');
        // 非 VIP 时专属主题按默认主题渲染（会员过期后老信回退，开通后自动恢复）；
        // 未知 theme_id 同样回落默认款（璀璨如初，按 id 显式解析）
        let theme = themes.find((t) => t.id === letter.theme_id) || defTheme(themes) || defTheme(THEMES);
        if (theme.premium && !isVip) theme = defTheme(themes) || theme;
        this.commit(
          {
            letter,
            theme,
            themeName: theme.name,
            paper: themeService.paperOf(letter.paper_id, papers, isVip),
            view: buildView(letter, { created: letter.created_at })
          },
          () => {
            // 数据落定后立刻出图（setData 回调里 canvas 节点已就绪）。
            // 预览区显示的就是这一张图，所以预览与导出件天然是同一份像素。
            this.ensureShot().catch(() => {});
          }
        );
      })
      .catch((err) => {
        console.error('[share] 信件读取失败', err);
        this.commit({ stage: 'fallback' });
        wx.showToast({ title: '这封信暂时取不出来，稍后再来试试', icon: 'none' });
      });
  },

  onTapBack() {
    wx.navigateBack();
  },

  onUnload() {
    this._destroyed = true;
  },

  // ── 生成分享图（首次导出时上报传播行为埋点，PRD 第十三节）──
  trackGenerateOnce() {
    if (this._tracked) return;
    this._tracked = true;
    track('share_image_generate', { theme_id: this.data.theme.id });
  },

  // ── 出图：整页只生成一次，预览 / 保存 / 分享共用同一个文件 ──
  // 【为什么这样组织】预览区直接显示这张图，于是「预览的像素」就是「导出件的像素」，
  // 不再存在 WXML 版式与 Canvas 版式两套口径的漂移（圆角/投影、字体度量、断行、
  // 渐变与旋转这几类差异全部随之消失）。代价是进页面要等一次绘制，用骨架过渡。
  // 失败时不静默：回落 WXML 版式预览（stage='fallback'），保存/分享时再重试一次。
  ensureShot() {
    if (this._shotFile) return Promise.resolve(this._shotFile);
    // 生成中再来一次（连点保存）直接等同一张，不重复绘制
    if (this._shotPending) return this._shotPending;
    this.trackGenerateOnce();
    const pending = this.getExportCanvas()
      .then((canvas) => {
        // 先把骨架高度按成品等比占住（预览同宽 630rpx），换图时不跳高。
        // 顺手把这份 layout 交给 drawPostcard 复用，避免测量两遍。
        const layout = this.measureLayout(canvas.getContext('2d'), this.data.view);
        this.commit({ shotH: Math.round((layout.paperH + BAR_H) / K) });
        return this.drawPostcard(canvas, layout);
      })
      .then((canvas) => this.canvasToFile(canvas))
      .then(
        (filePath) => {
          this._shotPending = null;
          this._shotFile = filePath;
          this.commit({ stage: 'shot', shotSrc: filePath });
          return filePath;
        },
        (e) => {
          this._shotPending = null;
          this.commit({ stage: 'fallback' });
          throw e;
        }
      );
    this._shotPending = pending;
    return pending;
  },

  // 出图是页面级异步：用户可能在出图完成前返回，避免在已卸载的页面上 setData
  commit(patch, cb) {
    if (this._destroyed) return;
    this.setData(patch, cb);
  },

  // 连点去重：出图已缓存、不再耗时，但一次点击仍不能触发两遍相册写入 / 分享面板
  actOnShot(run) {
    if (this._acting) return;
    this._acting = true;
    const done = () => {
      this._acting = false;
    };
    this.ensureShot().then(
      (filePath) => {
        done();
        run(filePath);
      },
      (e) => {
        done();
        this.handleExportError(e);
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
    spec.__colors = paper.colors || defPaper(PAPERS).colors;
    return spec;
  },

  // 绘制整张明信片（异步等待小程序码加载完成后返回 canvas）
  // preset：调用方已经量好的版面（ensureShot 为保证骨架高度先量过一次），
  // 传进来即复用，不再重复 measureLayout。
  drawPostcard(canvas, preset) {
    const ctx = canvas.getContext('2d');
    const view = this.data.view;
    const paper = this.data.paper;
    const colors = paper.colors || defPaper(PAPERS).colors; // 纸色自持：配色只来自 papers.js
    const layout = preset || this.measureLayout(ctx, view);

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
      } else if (op.k === 'vtag') {
        // 竖排笺问/答小签：描边空心签 / 实心签，字符顶格（pt 后）居中
        if (op.bg) {
          ctx.fillStyle = C(op.bg);
          ctx.fillRect(op.x, op.y, op.w, op.h);
        }
        ctx.strokeStyle = C(op.line);
        ctx.lineWidth = Math.max(1, op.lw);
        ctx.strokeRect(op.x + op.lw / 2, op.y + op.lw / 2, op.w - op.lw, op.h - op.lw);
        ctx.fillStyle = C(op.color);
        ctx.font = fontStr(op.size, op.face, '');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(op.ch, op.x + op.w / 2, op.chY);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      } else if (op.k === 'sep') {
        const midY = op.y + op.d / 2;
        const lw = Math.max(1, rpx(2));
        ctx.fillStyle = C(op.color);
        ctx.fillRect(op.x, midY - lw / 2, op.seg, lw);
        ctx.fillRect(op.x + op.w - op.seg, midY - lw / 2, op.seg, lw);
        ctx.save();
        ctx.translate(op.x + op.w / 2, midY);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = C(op.dColor);
        ctx.fillRect(-op.d / 2, -op.d / 2, op.d, op.d);
        ctx.restore();
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
        if (op.style === 'plain') {
          // 纯文字引头（处方笺 Rp 斜体落款）：无色块，按自己的基线落位
          ctx.fillStyle = C(op.textColor);
          ctx.font = fontStr(op.size, op.face, op.weight);
          ctx.fillText(op.text, op.x, op.textBase);
        } else {
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
        }
      } else if (op.k === 'rect') {
        // 整幅出血色带（日历月份带）
        ctx.fillStyle = C(op.color);
        ctx.fillRect(op.x, op.y, op.w, op.h);
      } else if (op.k === 'datehead') {
        // 日历日期头：特大数字 + 星期 + 黄历角签
        ctx.fillStyle = C(op.big.color);
        ctx.font = fontStr(op.big.size, op.big.face, op.big.weight);
        drawSpaced(ctx, op.big.text, op.big.x, op.big.base, op.big.ls, 'left');
        ctx.fillStyle = C(op.wk.color);
        ctx.font = fontStr(op.wk.size, op.wk.face, op.wk.weight);
        drawSpaced(ctx, op.wk.text, op.wk.x, op.wk.base, op.wk.ls, 'left');
        ctx.strokeStyle = C(op.alm.color);
        ctx.lineWidth = Math.max(1, op.alm.lw);
        ctx.strokeRect(op.alm.x + op.alm.lw / 2, op.alm.y + op.alm.lw / 2, op.alm.w - op.alm.lw, op.alm.h - op.alm.lw);
        ctx.fillStyle = C(op.alm.color);
        ctx.font = fontStr(op.alm.size, op.alm.face, op.alm.weight);
        drawSpaced(ctx, op.alm.text, op.alm.tx, op.alm.base, op.alm.ls, 'left');
      } else if (op.k === 'rxhead') {
        // 处方笺抬头：诊所名两行 + Rx 编号框
        ctx.fillStyle = C(op.cn.color);
        ctx.font = fontStr(op.cn.size, op.cn.face, op.cn.weight);
        drawSpaced(ctx, op.cn.text, op.cn.x, op.cn.base, op.cn.ls, 'left');
        ctx.fillStyle = C(op.en.color);
        ctx.font = fontStr(op.en.size, op.en.face, op.en.weight);
        drawSpaced(ctx, op.en.text, op.en.x, op.en.base, op.en.ls, 'left');
        ctx.strokeStyle = C(op.chip.color);
        ctx.lineWidth = Math.max(1, op.chip.lw);
        ctx.strokeRect(op.chip.x + op.chip.lw / 2, op.chip.y + op.chip.lw / 2, op.chip.w - op.chip.lw, op.chip.h - op.chip.lw);
        ctx.fillStyle = C(op.chip.color);
        ctx.font = fontStr(op.chip.size, op.chip.face, op.chip.weight);
        drawSpaced(ctx, op.chip.text, op.chip.tx, op.chip.base, op.chip.ls, 'left');
      } else if (op.k === 'rxsig') {
        // 处方笺签名区：用法两行 + 红圈章（内圈细线 + 双行印字）+ 医师签名栏
        ctx.fillStyle = C(op.uRun.color);
        ctx.font = fontStr(op.uRun.size, op.uRun.face, op.uRun.weight);
        op.usage.forEach((ln) => drawSpaced(ctx, ln.text, ln.x, ln.y, op.uRun.ls, 'left'));
        const s = op.seal;
        ctx.save();
        ctx.translate(s.x + s.box / 2, s.y + s.box / 2);
        ctx.rotate((s.rotate * Math.PI) / 180);
        ctx.strokeStyle = C(s.ring);
        ctx.lineWidth = Math.max(1, s.lw);
        ctx.beginPath();
        ctx.arc(0, 0, s.box / 2 - s.lw / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = C(s.innerColor);
        ctx.lineWidth = Math.max(1, s.innerLw);
        ctx.beginPath();
        ctx.arc(0, 0, s.box / 2 - s.innerR - s.innerLw / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = C(s.color);
        ctx.font = fontStr(s.textSize, s.face, s.weight);
        ctx.textAlign = 'center';
        drawSpaced(ctx, s.text, 0, s.aBase, s.ls, 'center');
        ctx.fillStyle = C(s.subColor);
        ctx.font = fontStr(s.subSize, s.subFace, '');
        ctx.fillText(s.sub, 0, s.bBase);
        ctx.restore();
        ctx.textAlign = 'left';
        ctx.fillStyle = C(op.doctor.color);
        ctx.font = fontStr(op.doctor.size, op.doctor.face, op.doctor.weight);
        drawSpaced(ctx, op.doctor.text, op.doctor.cx, op.doctor.base, op.doctor.ls, 'center');
        ctx.fillStyle = C(op.doctor.lineColor);
        ctx.fillRect(op.doctor.cx - op.doctor.w / 2, op.doctor.lineY, op.doctor.w, Math.max(1, op.doctor.lineH));
        ctx.fillStyle = C(op.sigk.color);
        ctx.font = fontStr(op.sigk.size, op.sigk.face, op.sigk.weight);
        drawSpaced(ctx, op.sigk.text, op.sigk.cx, op.sigk.base, op.sigk.ls, 'center');
      } else if (op.k === 'zssig') {
        // 证书落款区：颁发栏两行 + 红印（双圈描边 box-shadow）+ 双缎带
        op.orgLines.forEach((ln) => {
          ctx.fillStyle = C(op.orgK.color);
          ctx.font = fontStr(op.orgK.size, op.orgK.face, op.orgK.weight);
          drawSpaced(ctx, ln.prefix, ln.x, ln.base, op.orgK.ls, 'left');
          ctx.fillStyle = C(op.orgRun.color);
          ctx.font = fontStr(op.orgRun.size, op.orgRun.face, op.orgRun.weight);
          drawSpaced(ctx, ln.text, ln.x + ln.kW + op.orgGap, ln.base, op.orgRun.ls, 'left');
        });
        const s = op.seal;
        ctx.save();
        ctx.translate(s.x + s.box / 2, s.y + s.box / 2);
        ctx.rotate((s.rotate * Math.PI) / 180);
        [[7, 'redRing'], [4, 'cream']].forEach(([rw, ck]) => {
          ctx.fillStyle = C(ck);
          ctx.beginPath();
          ctx.arc(0, 0, s.box / 2 + rpx(rw), 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.fillStyle = C(s.bg);
        ctx.beginPath();
        ctx.arc(0, 0, s.box / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C(s.color);
        ctx.font = fontStr(s.size, s.face, s.weight);
        ctx.textAlign = 'center';
        drawSpaced(ctx, s.text, 0, -s.boxH / 2 + s.base, s.ls, 'center');
        ctx.restore();
        ctx.textAlign = 'left';
        const rb = op.ribbon;
        const tan = Math.tan((14 * Math.PI) / 180);
        [-1, 1].forEach((sd) => {
          ctx.save();
          ctx.translate(rb.x + sd * (rb.w / 2 + rb.gap / 2), rb.y + rb.h / 2);
          ctx.transform(1, sd * tan, 0, 1, 0, 0);
          ctx.fillStyle = C(rb.color);
          ctx.fillRect(-rb.w / 2, -rb.h / 2, rb.w, rb.h);
          ctx.restore();
        });
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
        const y = -rows / 2;
        const chars = String(s.text).split('');
        chars.forEach((ch, i) => {
          const cxx = -cell / 2 + (i % 2) * cell;
          const cyy = y + Math.floor(i / 2) * run.boxH + run.base;
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
    // 竖排文本（竖排笺）：逐字沿列下排、列心对齐；Latin/数字按 text-orientation: mixed 旋转 90°
    if (op.vertical) {
      ctx.fillStyle = C(op.color);
      ctx.font = fontStr(op.size, op.face, op.weight);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const latin = /[A-Za-z0-9]/;
      op.vertical.cols.forEach((col) => {
        col.chars.forEach((ch, i) => {
          const cy = op.vertical.top + (i + 0.5) * op.vertical.advance;
          if (latin.test(ch)) {
            ctx.save();
            ctx.translate(col.x, cy);
            ctx.rotate(Math.PI / 2);
            ctx.fillText(ch, 0, 0);
            ctx.restore();
          } else {
            ctx.fillText(ch, col.x, cy);
          }
        });
      });
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      return;
    }

    ctx.fillStyle = C(op.color);
    ctx.font = fontStr(op.size, op.face, op.weight);
    const single = op.lines.length === 1;

    // 富文本（证书结业词）：每行按段落的样式接力绘制
    if (op.rich) {
      op.rich.forEach((ln, i) => {
        const y = op.lines[i].y;
        let tx;
        if (op.align === 'center') tx = op.x + (op.avail - ln.w) / 2 + op.indent;
        else if (op.align === 'right') tx = op.x + op.avail - ln.w;
        else tx = op.x;
        let cx = tx;
        ln.parts.forEach((p) => {
          ctx.fillStyle = C(p.color);
          ctx.font = fontStr(op.size, op.face, p.weight);
          if (op.ls) cx += drawSpaced(ctx, p.text, cx, y, op.ls, 'left') + op.ls;
          else {
            ctx.fillText(p.text, cx, y);
            cx += adv(ctx, p.text, 0);
          }
        });
      });
      return;
    }

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
      // 首行缩进（版心笺）：text-indent 只作用于首行（居中/右对齐的 indent 是字距补偿，不在此列）
      const ind = i === 0 && op.align !== 'center' && op.align !== 'right' ? op.indent : 0;

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
      else tx = base + ind;

      if (op.justify && !ln.end && ln.text.length > 1) {
        // 两端对齐：把余量平摊到字与字之间（末行不拉伸，与 CSS 一致）
        const extra = (limit - ind - ln.w) / (ln.text.length - 1);
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
        const sx = tx + ln.w + op.sup.gap;
        if (op.sup.block) {
          // 实心块光标（终端笺）：vertical-align:-2rpx → 底缘在基线下方 4rpx
          ctx.fillStyle = C(op.sup.color);
          ctx.fillRect(sx, ln.y + rpx(4) - op.sup.h, op.sup.w, op.sup.h);
        } else {
          ctx.fillStyle = C(op.sup.color);
          ctx.font = fontStr(op.sup.size, op.sup.face, op.sup.weight);
          if (op.sup.ls) drawSpaced(ctx, op.sup.text, sx, ln.y + op.sup.dy, op.sup.ls, 'left');
          else ctx.fillText(op.sup.text, sx, ln.y + op.sup.dy);
        }
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
    else if (which === 'yixian') this.drawAbsYixian(ctx, layout, colors);
    else if (which === 'juzhong') this.drawAbsJuzhong(ctx, layout, colors);
    else if (which === 'caiqie') this.drawAbsCaiqie(ctx, layout, colors);
    else if (which === 'xingtu') this.drawAbsXingtu(ctx, layout, colors);
    else if (which === 'jiaopian') this.drawAbsFilm(ctx, layout, colors, view);
    else if (which === 'zhongduan') this.drawAbsTerminal(ctx, layout, colors);
    else if (which === 'zhengshu') this.drawAbsCert(ctx, layout, colors);
  },

  // 一线笺：左侧一根贯纸细线 + 线顶空心圆（全部装饰仅此而已）
  drawAbsYixian(ctx, layout, colors) {
    const H = layout.paperH;
    ctx.fillStyle = colors.line;
    ctx.fillRect(rpx(85), rpx(66), Math.max(1, rpx(2)), H - rpx(66) - rpx(50));
    const lw = Math.max(1, rpx(2));
    ctx.beginPath();
    ctx.arc(rpx(78) + rpx(8), rpx(44) + rpx(8), rpx(8) - lw / 2, 0, Math.PI * 2);
    ctx.fillStyle = colors.bg;
    ctx.fill();
    ctx.strokeStyle = colors.ring;
    ctx.lineWidth = lw;
    ctx.stroke();
  },

  // 居中笺：纸面顶部一点微光渐变（radial-gradient ellipse at 50% 0% 的圆形近似）
  drawAbsJuzhong(ctx, layout, colors) {
    const grad = ctx.createRadialGradient(EXPORT_W / 2, 0, 0, EXPORT_W / 2, 0, EXPORT_W * 0.6);
    grad.addColorStop(0, 'rgba(255,253,246,0.8)');
    grad.addColorStop(1, 'rgba(255,253,246,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, EXPORT_W, layout.paperH);
  },

  // 裁切笺：四角出血裁切线（与角保持一段距离，不是画框）
  drawAbsCaiqie(ctx, layout, colors) {
    const H = layout.paperH;
    const inset = rpx(36);
    const arm = rpx(32);
    ctx.strokeStyle = colors.mark;
    ctx.lineWidth = Math.max(1, rpx(2));
    [
      [inset, inset, 1, 1],
      [EXPORT_W - inset, inset, -1, 1],
      [inset, H - inset, 1, -1],
      [EXPORT_W - inset, H - inset, -1, -1]
    ].forEach(([x, y, sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(x + sx * arm, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * arm);
      ctx.stroke();
    });
  },

  // 星图观测笺：夜空网格 + 上下金色刻度尺 + 四角角标 + 右上出血星座连线群
  drawAbsXingtu(ctx, layout, colors) {
    const H = layout.paperH;
    // 细网格（repeating-linear-gradient 双向 47rpx 周期）
    ctx.fillStyle = colors.grid;
    const step = rpx(47);
    const th = Math.max(1, rpx(2));
    for (let gy = 0; gy < H; gy += step) ctx.fillRect(0, gy, EXPORT_W, th);
    for (let gx = 0; gx < EXPORT_W; gx += step) ctx.fillRect(gx, 0, th, H);
    // 上下刻度尺（顶 24rpx 密刻 / 底 47rpx 疏刻）
    ctx.fillStyle = 'rgba(216,178,106,0.55)';
    for (let x = rpx(44); x < EXPORT_W - rpx(44); x += rpx(24)) ctx.fillRect(x, rpx(29), th, rpx(13));
    for (let x = rpx(44); x < EXPORT_W - rpx(44); x += step) ctx.fillRect(x, H - rpx(42), th, rpx(13));
    // 四角金色角标
    ctx.strokeStyle = colors.gold;
    ctx.lineWidth = Math.max(1, rpx(3));
    const ci = rpx(22);
    const c = rpx(25);
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
    // 星座：六星连五线（.plxt-sky 容器 right:-33rpx / top:-47rpx / 454×381rpx）
    const x0 = EXPORT_W - rpx(454) + rpx(33);
    const y0 = -rpx(47);
    const stars = [
      [54, 272, 9],
      [154, 172, 14],
      [272, 218, 9],
      [218, 72, 13],
      [372, 127, 9],
      [418, 27, 7]
    ];
    const cs = stars.map(([x, y, d]) => [x0 + rpx(x) + rpx(d) / 2, y0 + rpx(y) + rpx(d) / 2]);
    ctx.strokeStyle = colors.starLine;
    ctx.lineWidth = Math.max(1, rpx(2));
    [
      [0, 1],
      [1, 2],
      [1, 3],
      [3, 4],
      [4, 5]
    ].forEach(([a, b]) => {
      ctx.beginPath();
      ctx.moveTo(cs[a][0], cs[a][1]);
      ctx.lineTo(cs[b][0], cs[b][1]);
      ctx.stroke();
    });
    ctx.save();
    ctx.shadowColor = 'rgba(232,201,138,0.65)';
    ctx.shadowBlur = rpx(15);
    ctx.fillStyle = colors.star;
    stars.forEach(([,, d], i) => {
      if (i === 5) ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(cs[i][0], cs[i][1], rpx(d) / 2, 0, Math.PI * 2);
      ctx.fill();
      if (i === 5) ctx.globalAlpha = 1;
    });
    ctx.restore();
  },

  // 胶片底片：上下齿孔条 + 片边橙色印字 + 白线画幅框 + 框内角标
  drawAbsFilm(ctx, layout, colors, view) {
    const H = layout.paperH;
    // 齿孔条（29rpx 孔 / 73rpx 周期，左右内缩 44rpx）
    ctx.fillStyle = colors.perf;
    const pw = rpx(29);
    for (let x = rpx(44); x < EXPORT_W - rpx(44); x += rpx(73)) {
      const w = Math.min(pw, EXPORT_W - rpx(44) - x);
      if (w <= 0) break;
      ctx.fillRect(x, rpx(18), w, rpx(36));
      ctx.fillRect(x, H - rpx(54), w, rpx(36));
    }
    // 片边印字（上下居中一行，位于齿孔条与画幅框之间）
    ctx.fillStyle = colors.accent;
    ctx.font = fontStr(rpx(20), 'mono', '');
    const eRun = runBox(20, 'mono', null, K);
    ctx.textAlign = 'center';
    drawSpaced(ctx, fmt('{{dwgNo}} ▸ MENTAL MAILBOX SAFETY FILM 400 ▸ 24', view), EXPORT_W / 2, rpx(66) + eRun.base, rpx(9), 'center');
    drawSpaced(ctx, fmt('▸▸ KEEP THIS FRAME FOREVER ▸▸ {{mon2}}{{day2}}', view), EXPORT_W / 2, H - rpx(62) - eRun.below, rpx(9), 'center');
    // 画幅框（WXSS 用 box-shadow 0 0 0 3rpx 模拟 border：外扩 3rpx 描一圈）
    ctx.strokeStyle = colors.frame;
    ctx.lineWidth = Math.max(1, rpx(3));
    const fx = rpx(42);
    const fy = rpx(106);
    const fw = EXPORT_W - rpx(84);
    const fh = H - rpx(210);
    ctx.strokeRect(fx - rpx(1.5), fy - rpx(1.5), fw + rpx(3), fh + rpx(3));
    // 框内角标：FRAME 24A（左上）/ 35MM（右下）
    ctx.fillStyle = colors.mark;
    ctx.font = fontStr(rpx(18), 'mono', '');
    const mRun = runBox(18, 'mono', null, K);
    ctx.textAlign = 'left';
    drawSpaced(ctx, 'FRAME 24A', fx + rpx(18), fy + rpx(14) + mRun.base, rpx(5), 'left');
    drawSpaced(ctx, '35MM', fx + fw - rpx(18), fy + fh - rpx(14) - mRun.below, rpx(5), 'right');
    ctx.textAlign = 'left';
  },

  // 终端笺：扫描细线 + 琥珀辉光 + 内框；文字辉光（text-shadow）借 shadowBlur 传给正文
  drawAbsTerminal(ctx, layout, colors) {
    const H = layout.paperH;
    ctx.fillStyle = 'rgba(255,255,255,0.028)';
    const th = Math.max(1, rpx(2));
    for (let y = 0; y < H; y += rpx(8)) ctx.fillRect(0, y, EXPORT_W, th);
    const grad = ctx.createRadialGradient(EXPORT_W / 2, H * 0.3, 0, EXPORT_W / 2, H * 0.3, EXPORT_W * 0.6);
    grad.addColorStop(0, 'rgba(232,163,61,0.07)');
    grad.addColorStop(1, 'rgba(232,163,61,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, EXPORT_W, H);
    ctx.strokeStyle = colors.frame;
    ctx.lineWidth = Math.max(1, rpx(3));
    ctx.strokeRect(rpx(22), rpx(22), EXPORT_W - rpx(44), H - rpx(44));
    // CRT 文字辉光：设一次随 drawOps 的全部文字生效，外层 restore 统一还原
    ctx.shadowColor = 'rgba(232,163,61,0.35)';
    ctx.shadowBlur = rpx(11);
  },

  // 结业证书：古铜双线框 + 四角角花
  drawAbsCert(ctx, layout, colors) {
    const H = layout.paperH;
    ctx.strokeStyle = colors.frame;
    ctx.lineWidth = Math.max(1, rpx(5));
    ctx.strokeRect(rpx(18), rpx(18), EXPORT_W - rpx(36), H - rpx(36));
    ctx.strokeStyle = colors.innerFrame;
    ctx.lineWidth = Math.max(1, rpx(2));
    ctx.strokeRect(rpx(36), rpx(36), EXPORT_W - rpx(72), H - rpx(72));
    ctx.strokeStyle = colors.frame;
    ctx.lineWidth = Math.max(1, rpx(5));
    const ci = rpx(43);
    const c = rpx(47);
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

  // ── 保存到相册（先确保隐私授权，失败含相册系统权限引导）──
  onSave() {
    // 写入相册属隐私接口（相册·仅写入）：未授权时 saveImageToPhotosAlbum 会直接 fail，
    // 白等一次 Canvas 导出，所以把授权检查放在导出之前
    privacyService.ensure().then((ok) => {
      if (!ok) {
        wx.showToast({ title: '需同意隐私政策后才能保存', icon: 'none' });
        return;
      }
      this.savePostcard();
    });
  },

  savePostcard() {
    this.actOnShot((filePath) => {
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
    });
  },

  // ── 发给微信好友（微信图片分享面板）──
  onSend() {
    this.actOnShot((filePath) => {
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
    });
  },

  // ── 点开成品图全屏查看（长图在页面里是等比缩放的，放大才能看清）──
  onPreviewShot() {
    if (!this._shotFile) return;
    wx.previewImage({ urls: [this._shotFile], current: this._shotFile });
  },

  handleExportError(e) {
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
