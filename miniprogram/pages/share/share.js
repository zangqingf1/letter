// 04 · 分享图 · 明信片预览页
// 单一预览态（功能需求文档 七）：进入即全屏预览，名称/问题/答案/写信日期四项
// 固定全部入图；重读记录与回信永不进入分享图（BR-15）。
// 【信纸自持改版】明信片 = 固定纸色版式（papers.js 六款：extra/blueprint/ticket/
// poster/bauhaus/vinyl）+ 底部小程序条。版式配色不再取主题 palette（主题只管信封），
// 每套版式的装饰在本文件 drawXxxStyle 内以 Canvas 完整重绘，取色一律走
// paper.colors（与 styles/paper.wxss 同源），保证三端渲染完全相同。

const THEMES = require('../write/themes.js');
const PAPERS = require('../write/papers.js');
const { buildView } = require('../write/paper-view.js');
const letterService = require('../../services/letter.js');
const themeService = require('../../services/theme.js');
const analytics = require('../../services/analytics.js');
const cloud = require('../../services/cloud.js');

// 埋点统一走 analytics 服务（事件名见 PRD 第十三节）
function track(event, data) {
  analytics.track(event, data);
}

// ── Canvas 导出规格（宽固定 1080，高随内容自适应）──
const EXPORT_W = 1080;
const K = EXPORT_W / 630; // 预览 rpx 尺寸 → 导出像素换算系数（预览明信片基准宽 630rpx）
const BAR_H = Math.round(88 * K); // 底部小程序条（与预览 88rpx 同源）
const MIN_PAPER_H = EXPORT_W;  // 内容很短时保持一屏比例
const MAX_PAPER_H = 3600;      // Canvas 2d 真机高度上限兜底（超长按字号²比例缩小字号）

function rpx(v) {
  return Math.round(v * K);
}

// ── 字体族（与 styles/paper.wxss --plf-* 同源）──
const FONT_SONG = '"Noto Serif SC","Songti SC","STKaiti","KaiTi",serif';
const FONT_KAI = '"Kaiti SC","STKaiti","KaiTi",serif';
const FONT_HEI = '"PingFang SC","Microsoft YaHei",sans-serif';
const FONT_MONO = '"Courier New",Consolas,monospace';

// ── 十款版式的版面参数（rpx，与 styles/paper.wxss 各版式数值对应）──
// preTop：题名区之前的固定头部高度；titleFrac：题名可用宽度占比（避让出血装饰）；
// qInset/aInset：线框内边距（蓝图）；postA：答案区之后的固定底部装饰高度；
// bottomPad：底部安全边距。字号/行高与 WXSS 各版式一一对应。
const PAPER_SPECS = {
  extra: {
    preTop: 228, // 178 报头区 + 50 顶部留白（与 .pl-extra / drawExtraStyle 同步）
    title: { size: 40, face: FONT_SONG, weight: '900 ', lh: 1.5, frac: 1 },
    titleGap: 22,
    q: { size: 26, face: FONT_HEI, weight: '700 ', lh: 1.9, inset: 0 },
    qGap: 22,
    a: { size: 28, face: FONT_SONG, weight: '', lh: 2.0, inset: 0, drop: true },
    aGap: 26,
    postA: 58, bottomPad: 30
  },
  blueprint: {
    preTop: 200,
    title: { size: 40, face: FONT_HEI, weight: '700 ', lh: 1.4, frac: 1 },
    titleGap: 48,
    q: { size: 26, face: FONT_HEI, weight: '', lh: 1.9, inset: 26, boxed: true },
    qGap: 0,
    a: { size: 28, face: FONT_HEI, weight: '', lh: 2.0, inset: 26, boxed: true },
    aGap: 42,
    postA: 186, bottomPad: 30
  },
  ticket: {
    preTop: 128,
    title: { size: 36, face: FONT_HEI, weight: '700 ', lh: 1.55, frac: 1 },
    titleGap: 64,
    q: { size: 26, face: FONT_HEI, weight: '', lh: 1.95, inset: 0 },
    aGap: 88,
    a: { size: 27, face: FONT_HEI, weight: '', lh: 2.0, inset: 0 },
    postA: 140, bottomPad: 44
  },
  poster: {
    preTop: 100,
    title: { size: 44, face: FONT_HEI, weight: '900 ', lh: 1.45, frac: 0.88 },
    titleGap: 28,
    banner: { h: 64, gapBefore: 28, gapAfter: 38 },
    q: { size: 26, face: FONT_HEI, weight: '', lh: 2.0, inset: 0 },
    aGap: 50,
    a: { size: 27, face: FONT_HEI, weight: '500 ', lh: 2.0, inset: 0 },
    postA: 138, bottomPad: 44
  },
  bauhaus: {
    preTop: 64,
    title: { size: 40, face: FONT_HEI, weight: '900 ', lh: 1.5, frac: 0.7 },
    titleGap: 73,
    q: { size: 26, face: FONT_HEI, weight: '', lh: 1.95, inset: 54, chip: true },
    aGap: 34,
    a: { size: 27, face: FONT_HEI, weight: '', lh: 2.0, inset: 54, chip: true },
    postA: 120, bottomPad: 44
  },
  vinyl: {
    preTop: 96,
    title: { size: 38, face: FONT_KAI, weight: '', lh: 1.6, frac: 0.62 },
    titleGap: 78,
    q: { size: 26, face: FONT_HEI, weight: '', lh: 2.0, inset: 0 },
    aGap: 52,
    a: { size: 27, face: FONT_HEI, weight: '', lh: 2.0, inset: 0 },
    postA: 78, bottomPad: 44
  },
  suwen: {
    // 顶部 52 内边距；题名右侧避让 72rpx 圆邮戳（frac 0.84）
    preTop: 52,
    title: { size: 32, face: FONT_KAI, weight: '', lh: 1.6, frac: 0.84 },
    titleGap: 50, // 下横线（margin 20 + 线 2 + margin 28）
    q: { size: 28, face: FONT_KAI, weight: '', lh: 2.0, inset: 40, insetR: 0 }, // 左侧方章 24 + 间距 16，右侧通栏
    aGap: 28,
    a: { size: 28, face: FONT_KAI, weight: '', lh: 2.0, inset: 40, insetR: 0 },
    postA: 28, // 末行行距（与 WXSS 末行 margin-bottom 28 对齐）+ bottomPad 44
    bottomPad: 44
  },
  liubai: {
    preTop: 52,
    title: { size: 36, face: FONT_SONG, weight: '600 ', lh: 1.5, frac: 1 },
    titleGap: 104, // 黑短线（24+4+40）+ 问 cap（22+14）
    q: { size: 28, face: FONT_HEI, weight: '', lh: 2.1, inset: 0 },
    aGap: 72, // 问题块 margin 36 + 答 cap（22+14）
    a: { size: 28, face: FONT_HEI, weight: '', lh: 2.1, inset: 0 },
    postA: 90, // 页脚（margin 48 + 上线 + padding 16 + 行高）
    bottomPad: 44
  },
  moye: {
    // 顶部 52 内边距 + 金线报头（线 21 + margin 28）
    preTop: 100,
    title: { size: 34, face: FONT_KAI, weight: '', lh: 1.6, frac: 1, center: true },
    titleGap: 70, // 问 margin 36 + cap（22+12）
    q: { size: 28, face: FONT_KAI, weight: '', lh: 2.1, inset: 0 },
    aGap: 68, // 答块 margin 34 + cap（22+12）
    a: { size: 28, face: FONT_KAI, weight: '', lh: 2.1, inset: 0 },
    postA: 70, // 居中落款行
    bottomPad: 44
  },
  airmail2: {
    // 斜纹框 12 + 纸面内边距 36 + head（邮票 82）+ route 带 32 + 题名 margin 28
    preTop: 190,
    title: { size: 34, face: FONT_SONG, weight: '700 ', lh: 1.5, frac: 1 },
    titleGap: 58, // 问 margin 28 + cap（22+8）
    q: { size: 28, face: FONT_HEI, weight: '', lh: 2.0, inset: 0 },
    aGap: 104, // 虚线分隔（22+2+22）+ 答块 margin 28 + cap 30
    a: { size: 28, face: FONT_HEI, weight: '', lh: 2.0, inset: 0 },
    postA: 56, // 页脚行
    bottomPad: 46
  }
};

// 版式安全边距（导出像素）：题名前的固定头部 / 底部固定装饰 / 两侧留白
function paperPads(paperId) {
  const spec = PAPER_SPECS[paperId] || PAPER_SPECS.extra;
  switch (paperId) {
    case 'blueprint':
      return { left: rpx(60), right: rpx(60), top: rpx(spec.preTop), bottom: rpx(spec.bottomPad) };
    case 'ticket':
      // 右侧存根（128rpx）+ 主票右留白
      return { left: rpx(48), right: rpx(170), top: rpx(spec.preTop), bottom: rpx(spec.bottomPad) };
    case 'poster':
      return { left: rpx(48), right: rpx(48), top: rpx(spec.preTop), bottom: rpx(spec.bottomPad) };
    case 'bauhaus':
      return { left: rpx(48), right: rpx(48), top: rpx(spec.preTop), bottom: rpx(spec.bottomPad) };
    case 'vinyl':
      return { left: rpx(48), right: rpx(48), top: rpx(spec.preTop), bottom: rpx(spec.bottomPad) };
    case 'suwen':
    case 'liubai':
    case 'moye':
      return { left: rpx(48), right: rpx(48), top: rpx(spec.preTop), bottom: rpx(spec.bottomPad) };
    case 'airmail2':
      // 斜纹框 12 + 纸面内边距 36
      return { left: rpx(48), right: rpx(48), top: rpx(spec.preTop), bottom: rpx(spec.bottomPad) };
    default: // extra
      return { left: rpx(44), right: rpx(44), top: rpx(spec.preTop), bottom: rpx(spec.bottomPad) };
  }
}

Page({
  data: {
    statusBarHeight: 20,
    handwritingOff: false,
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
      statusBarHeight: win.statusBarHeight || 20,
      handwritingOff: wx.getStorageSync('handwriting_off') === true
    });

    // 与详情页同源：经 letter 服务读取（真实寄出的信优先，否则演示数据预览）；
    // 版式经 theme 服务解析（未知 paper_id 回落第一套）。信纸取色只用 paper.colors。
    Promise.all([letterService.get(options && options.id), themeService.getThemes(), themeService.getPapers()])
      .then(([res, themes, papers]) => {
        const letter = res.letter;
        const theme = themes.find((t) => t.id === letter.theme_id) || themes[0] || THEMES[0];
        this.setData({
          letter,
          theme,
          themeName: theme.name,
          paper: themeService.paperOf(letter.paper_id, papers),
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

  // 版面测量：先按基准字号换行测高（高度随内容自适应）；
  // 超过 MAX_PAPER_H 时按字号²比例缩小字号重测（换行数随字号变小，高度∝字号²）；
  // 极端超长仍超上限时截断答案加省略号兜底
  measureLayout(ctx, view) {
    const paperId = this.data.paper.id;
    const spec = PAPER_SPECS[paperId] || PAPER_SPECS.extra;
    const attempt = (scale) => this.measureAt(ctx, view, spec, scale, paperId);
    let layout = attempt(1);
    if (layout.paperH + BAR_H > MAX_PAPER_H) {
      layout = attempt(Math.max(0.5, Math.sqrt(MAX_PAPER_H / (layout.paperH + BAR_H))));
    }
    if (layout.paperH + BAR_H > MAX_PAPER_H) {
      // 极端兜底：按行高截断答案
      const allowed = Math.max(
        1,
        Math.floor((MAX_PAPER_H - BAR_H - layout.pads.bottom - spec.postA * K - layout.yBeforeA) / layout.aLH)
      );
      layout.aItems = layout.aItems.slice(0, allowed);
      if (layout.aItems.length) {
        const last = layout.aItems[layout.aItems.length - 1];
        layout.aItems[layout.aItems.length - 1] = { text: last.text + '…', dx: last.dx };
      }
      layout.paperH = Math.max(
        MIN_PAPER_H,
        layout.yBeforeA + layout.aItems.length * layout.aLH + (spec.postA + spec.bottomPad) * K
      );
    }
    return layout;
  },

  // 单套版式测高：题名（可换行）→（标语条）→ 问题 → 答案（号外首字下沉特殊换行）
  measureAt(ctx, view, spec, scale, paperId) {
    const pads = paperPads(paperId);
    const contentW = EXPORT_W - pads.left - pads.right;
    const titlePx = Math.round(spec.title.size * K * scale);
    const titleLH = Math.round(titlePx * spec.title.lh);
    const qPx = Math.round(spec.q.size * K * scale);
    const qLH = Math.round(qPx * spec.q.lh);
    const aPx = Math.round(spec.a.size * K * scale);
    const aLH = Math.round(aPx * spec.a.lh);
    const titleW = Math.round(contentW * spec.title.frac);
    // insetR：右侧留白（缺省与 inset 对称）；素问笺左侧方章、右侧通栏即用此参数
    const insetOf = (cfg) => {
      const l = Math.round((cfg.inset || 0) * K * scale);
      const rt = Math.round((cfg.insetR !== undefined ? cfg.insetR : (cfg.inset || 0)) * K * scale);
      return { l, r: rt };
    };
    const qIns = insetOf(spec.q);
    const aIns = insetOf(spec.a);
    const qW = contentW - qIns.l - qIns.r;
    const aW = contentW - aIns.l - aIns.r;

    let y = pads.top;
    ctx.font = spec.title.weight + titlePx + 'px ' + spec.title.face;
    const titleLines = wrapText(ctx, view.name, titleW);
    y += titleLines.length * titleLH + Math.round(spec.titleGap * K * scale);

    let bannerY = 0;
    if (spec.banner) {
      bannerY = y;
      y += Math.round(spec.banner.h * K * scale) + Math.round(spec.banner.gapAfter * K * scale);
    }

    ctx.font = spec.q.weight + qPx + 'px ' + spec.q.face;
    const qLines = wrapText(ctx, view.question, qW);
    const yQ = y;
    y += qLines.length * qLH + Math.round(spec.aGap * K * scale);

    const yBeforeA = y;
    let aItems;
    let dropPx = 0;
    let dropW = 0;
    let dropRows = 0;
    if (spec.a.drop) {
      // 号外头版首字下沉：首行区域让位大字，其后整宽换行
      ctx.font = spec.a.weight + aPx + 'px ' + spec.a.face;
      dropPx = Math.round(72 * K * scale);
      dropW = dropPx + Math.round(12 * K);
      dropRows = Math.max(1, Math.ceil((dropPx * 1.15) / aLH));
      aItems = wrapDrop(ctx, view.answerRest, contentW, dropW, dropRows);
    } else {
      ctx.font = spec.a.weight + aPx + 'px ' + spec.a.face;
      aItems = wrapText(ctx, view.answer, aW).map((t) => ({ text: t, dx: 0 }));
    }
    y += aItems.length * aLH;

    return {
      paperH: Math.max(MIN_PAPER_H, y + Math.round((spec.postA + spec.bottomPad) * K * scale)),
      pads,
      spec,
      scale,
      titleLines,
      qLines,
      aItems,
      qIns,
      aIns,
      yQ,
      yBeforeA,
      bannerY,
      titlePx,
      titleLH,
      qPx,
      qLH,
      aPx,
      aLH,
      dropPx,
      dropW,
      dropRows,
      titleFont: spec.title.weight + titlePx + 'px ' + spec.title.face,
      qFont: spec.q.weight + qPx + 'px ' + spec.q.face,
      aFont: spec.a.weight + aPx + 'px ' + spec.a.face,
      contentW
    };
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
        ctx.textBaseline = 'top';

        // ── 信纸主体：固定纸色 + 版式装饰与内容（BR-15：四项全入图）──
        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, EXPORT_W, layout.paperH);
        this.drawPaperStyle(ctx, layout, colors, view);

        // ── 底部小程序条：火漆 Logo 环 + 品牌文案 + 小程序码 ──
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
        ctx.font = Math.round(20 * K) + 'px ' + FONT_HEI;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('心灵信箱 · 把答案寄给未来', 32 * K + logoD + 14 * K, barMidY);
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

  // ── 版式分发（底色之上的一切：装饰 + 内容；与 styles/paper.wxss 同构）──
  drawPaperStyle(ctx, layout, colors, view) {
    const id = this.data.paper.id;
    if (id === 'blueprint') this.drawBlueprintStyle(ctx, layout, colors, view);
    else if (id === 'ticket') this.drawTicketStyle(ctx, layout, colors, view);
    else if (id === 'poster') this.drawPosterStyle(ctx, layout, colors, view);
    else if (id === 'bauhaus') this.drawBauhausStyle(ctx, layout, colors, view);
    else if (id === 'vinyl') this.drawVinylStyle(ctx, layout, colors, view);
    else if (id === 'suwen') this.drawSuwenStyle(ctx, layout, colors, view);
    else if (id === 'liubai') this.drawLiubaiStyle(ctx, layout, colors, view);
    else if (id === 'moye') this.drawMoyeStyle(ctx, layout, colors, view);
    else if (id === 'airmail2') this.drawAirmailStyle(ctx, layout, colors, view);
    else this.drawExtraStyle(ctx, layout, colors, view);
  },

  // ── 号外头版：报头双线 + 日期栏 + 首字下沉 + 答 毕 ──
  drawExtraStyle(ctx, layout, colors, view) {
    const H = layout.paperH;
    const pads = layout.pads;
    // 报头：粗细双线 + 居中报名 + 日期栏 + 再一道双线
    // mastOff：纸边到报头的留白（与 paper.wxss .pl-extra 顶部 padding 同步）
    const mastOff = rpx(50);
    ctx.fillStyle = colors.ink;
    ctx.fillRect(0, mastOff, EXPORT_W, rpx(6));
    ctx.fillRect(0, mastOff + rpx(10), EXPORT_W, rpx(2));
    ctx.fillStyle = colors.deep;
    ctx.font = '900 ' + rpx(46) + 'px ' + FONT_SONG;
    ctx.textAlign = 'center';
    const mastY = mastOff + rpx(26);
    drawSpaced(ctx, '心灵信箱', EXPORT_W / 2, mastY, rpx(14), 'center');
    const mastW = ctx.measureText('心灵信箱').width + rpx(14) * 3;
    ctx.fillStyle = colors.accent;
    ctx.font = '700 ' + rpx(22) + 'px ' + FONT_HEI;
    ctx.textAlign = 'left';
    ctx.fillText('号 外', EXPORT_W / 2 + mastW / 2 + rpx(10), mastY + rpx(18));
    ctx.fillStyle = colors.sub;
    ctx.font = rpx(19) + 'px ' + FONT_HEI;
    const dateLineY = mastOff + rpx(122);
    ctx.textAlign = 'left';
    ctx.fillText('私人信件 · 仅供本人重读', pads.left, dateLineY);
    ctx.textAlign = 'right';
    ctx.fillText('写于 ' + view.dateLong, EXPORT_W - pads.left, dateLineY);
    ctx.fillStyle = colors.ink;
    ctx.fillRect(0, mastOff + rpx(152), EXPORT_W, rpx(6));
    ctx.fillRect(0, mastOff + rpx(162), EXPORT_W, rpx(2));

    // 题名（居左，可换行）
    const x = pads.left;
    let y = pads.top;
    ctx.textAlign = 'left';
    ctx.fillStyle = colors.deep;
    ctx.font = layout.titleFont;
    layout.titleLines.forEach((ln) => {
      ctx.fillText(ln, x, y);
      y += layout.titleLH;
    });

    // 问题导语：红方块 + 加粗
    y += rpx(22) - 0;
    ctx.fillStyle = colors.accent;
    ctx.fillRect(x, y + rpx(8), rpx(14), rpx(14));
    ctx.fillStyle = colors.sub;
    ctx.font = layout.qFont;
    const qX = x + rpx(26);
    layout.qLines.forEach((ln) => {
      ctx.fillText(ln, qX, y);
      y += layout.qLH;
    });

    // 分隔线 + 答案（首字下沉）：分隔线落在问题与答案之间的间隔带里
    const divY = y + rpx(12);
    ctx.fillStyle = colors.faint;
    ctx.fillRect(x, divY, layout.contentW, Math.max(1, rpx(2)));
    y = layout.yBeforeA;
    ctx.font = layout.aFont;
    ctx.fillStyle = colors.ink;
    // 大字首字
    ctx.font = '900 ' + layout.dropPx + 'px ' + FONT_SONG;
    ctx.fillStyle = colors.accent;
    ctx.fillText(view.dropChar, x, y - rpx(8));
    ctx.font = layout.aFont;
    ctx.fillStyle = colors.ink;
    layout.aItems.forEach((it) => {
      ctx.fillText(it.text, x + it.dx, y);
      y += layout.aLH;
    });

    // 答 毕 + 底部粗线
    const endY = H - rpx(96);
    ctx.fillStyle = colors.accent;
    ctx.font = rpx(20) + 'px ' + FONT_SONG;
    ctx.textAlign = 'center';
    drawSpaced(ctx, '— 答 毕 —', EXPORT_W / 2, endY, rpx(10), 'center');
    ctx.fillStyle = colors.ink;
    ctx.fillRect(0, H - rpx(30), EXPORT_W, rpx(6));
    ctx.textAlign = 'left';
  },

  // ── 工程蓝图：网格 + 裁切角标 + 线框问答 + 标题栏 ──
  drawBlueprintStyle(ctx, layout, colors, view) {
    const H = layout.paperH;
    const pads = layout.pads;
    // 白网格
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = rpx(40); gx < EXPORT_W; gx += rpx(40)) {
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, H);
    }
    for (let gy = rpx(40); gy < H; gy += rpx(40)) {
      ctx.moveTo(0, gy);
      ctx.lineTo(EXPORT_W, gy);
    }
    ctx.stroke();
    // 双线画框
    ctx.strokeStyle = 'rgba(234,242,248,0.75)';
    ctx.lineWidth = Math.max(1.5, rpx(3));
    ctx.strokeRect(1.5, 1.5, EXPORT_W - 3, H - 3);
    ctx.strokeStyle = 'rgba(234,242,248,0.35)';
    ctx.lineWidth = Math.max(1, rpx(1.5));
    const fi = rpx(10);
    ctx.strokeRect(fi, fi, EXPORT_W - fi * 2, H - fi * 2);
    // 四角裁切标
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = Math.max(1.5, rpx(3));
    const c = rpx(22);
    const ci = rpx(12);
    [
      [ci, ci, 1, 1],
      [EXPORT_W - ci, ci, -1, 1],
      [ci, H - ci, 1, -1],
      [EXPORT_W - ci, H - ci, -1, -1]
    ].forEach(([px, py, sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(px + sx * c, py);
      ctx.lineTo(px, py);
      ctx.lineTo(px, py + sy * c);
      ctx.stroke();
    });

    // 眉行
    ctx.fillStyle = 'rgba(234,242,248,0.65)';
    ctx.font = rpx(18) + 'px ' + FONT_MONO;
    ctx.fillText('MENTAL MAILBOX', pads.left, rpx(36));
    ctx.textAlign = 'right';
    ctx.fillText('DWG. ' + view.dwgNo, EXPORT_W - pads.left, rpx(36));
    ctx.textAlign = 'left';

    // 题名 + 短下划线
    let y = pads.top;
    ctx.fillStyle = colors.title;
    ctx.font = layout.titleFont;
    layout.titleLines.forEach((ln) => {
      ctx.fillText(ln, pads.left, y);
      y += layout.titleLH;
    });
    ctx.fillRect(pads.left, y - Math.round(layout.titleGap * layout.scale) + rpx(22), rpx(88), Math.max(2, rpx(3)));
    y = layout.yQ;

    // 问线框
    const boxPad = Math.round(26 * K * layout.scale);
    const qBoxH = layout.qLines.length * layout.qLH + boxPad * 2;
    this.drawBlueprintBox(ctx, pads.left, y - boxPad, layout.contentW, qBoxH, '问 / Q', colors);
    ctx.fillStyle = colors.q;
    ctx.font = layout.qFont;
    layout.qLines.forEach((ln) => {
      ctx.fillText(ln, pads.left + boxPad, y);
      y += layout.qLH;
    });

    // 答线框
    y = layout.yBeforeA;
    const aBoxH = layout.aItems.length * layout.aLH + boxPad * 2;
    this.drawBlueprintBox(ctx, pads.left, y - boxPad, layout.contentW, aBoxH, '答 / A', colors);
    ctx.fillStyle = colors.body;
    ctx.font = layout.aFont;
    layout.aItems.forEach((it) => {
      ctx.fillText(it.text, pads.left + boxPad, y);
      y += layout.aLH;
    });

    // 右下标题栏（三行两列）
    const tbW = rpx(360);
    const rowH = rpx(46);
    const tbH = rowH * 3;
    const tbX = EXPORT_W - pads.left - tbW;
    const tbY = H - rpx(30) - tbH;
    ctx.strokeStyle = 'rgba(234,242,248,0.80)';
    ctx.lineWidth = Math.max(1.5, rpx(2));
    ctx.strokeRect(tbX, tbY, tbW, tbH);
    ctx.strokeStyle = 'rgba(234,242,248,0.35)';
    ctx.lineWidth = Math.max(1, rpx(1));
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(tbX, tbY + rowH * i);
      ctx.lineTo(tbX + tbW, tbY + rowH * i);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(tbX + rpx(150), tbY);
    ctx.lineTo(tbX + rpx(150), tbY + tbH);
    ctx.stroke();
    const rows = [['封存日期', view.dotDate], ['比例', '1 : 1 原文'], ['状态', '已封存']];
    rows.forEach((row, i) => {
      ctx.font = rpx(18) + 'px ' + FONT_HEI;
      ctx.fillStyle = colors.accent;
      ctx.fillText(row[0], tbX + rpx(16), tbY + rowH * i + rpx(15));
      ctx.font = rpx(18) + 'px ' + FONT_MONO;
      ctx.fillStyle = colors.line;
      ctx.fillText(row[1], tbX + rpx(150) + rpx(16), tbY + rowH * i + rpx(15));
    });
  },

  // 蓝图线框 + 浮标
  drawBlueprintBox(ctx, x, y, w, h, label, colors) {
    ctx.strokeStyle = 'rgba(234,242,248,0.80)';
    ctx.lineWidth = Math.max(1.5, rpx(2));
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(x + rpx(18) - rpx(10), y - rpx(14), rpx(110), rpx(28));
    ctx.fillStyle = colors.accent;
    ctx.font = rpx(18) + 'px ' + FONT_HEI;
    ctx.fillText(label, x + rpx(18), y - rpx(11));
  },

  // ── 存根票根：右侧日期存根 + 条码编号 ──
  drawTicketStyle(ctx, layout, colors, view) {
    const H = layout.paperH;
    const pads = layout.pads;
    // 存根：底色带 + 红虚线缝
    const stubW = rpx(128);
    const stubX = EXPORT_W - stubW;
    ctx.fillStyle = 'rgba(194,69,45,0.05)';
    ctx.fillRect(stubX, 0, stubW, H);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = Math.max(1.5, rpx(3));
    ctx.setLineDash([rpx(10), rpx(8)]);
    ctx.beginPath();
    ctx.moveTo(stubX, 0);
    ctx.lineTo(stubX, H);
    ctx.stroke();
    ctx.setLineDash([]);
    // 上下铆钉
    [
      [stubX + stubW / 2, rpx(36)],
      [stubX + stubW / 2, H - rpx(36)]
    ].forEach(([cx, cy]) => {
      ctx.beginPath();
      ctx.arc(cx, cy, rpx(8), 0, Math.PI * 2);
      ctx.fillStyle = colors.bg;
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, rpx(3));
      ctx.stroke();
    });
    // 存根日期
    const stubCX = stubX + stubW / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = colors.accent;
    ctx.font = '700 ' + rpx(18) + 'px ' + FONT_HEI;
    ctx.fillText('写于', stubCX, rpx(72));
    ctx.font = '700 ' + rpx(34) + 'px ' + FONT_MONO;
    ctx.fillText(view.stampText, stubCX, rpx(104));
    ctx.font = '700 ' + rpx(18) + 'px ' + FONT_HEI;
    ctx.fillText(view.yearText, stubCX, rpx(156));
    // 竖排小字（逐字下排）
    ctx.fillStyle = colors.sub;
    ctx.font = rpx(20) + 'px ' + FONT_HEI;
    const noteY0 = H * 0.42;
    view.stubChars.forEach((ch, i) => {
      ctx.fillText(ch, stubCX, noteY0 + i * rpx(34));
    });
    ctx.textAlign = 'left';

    // 主票内容
    const x = pads.left;
    ctx.fillStyle = colors.accent;
    ctx.font = rpx(18) + 'px ' + FONT_HEI;
    ctx.fillText('心灵信箱 · 重读券', x, rpx(44));
    ctx.fillStyle = '#8A8070';
    ctx.font = rpx(20) + 'px ' + FONT_MONO;
    ctx.fillText(view.serial, x, rpx(78));

    let y = pads.top;
    ctx.fillStyle = colors.deep;
    ctx.font = layout.titleFont;
    layout.titleLines.forEach((ln) => {
      ctx.fillText(ln, x, y);
      y += layout.titleLH;
    });

    // 问（红 cap）
    y += rpx(30);
    ctx.fillStyle = colors.accent;
    ctx.font = '700 ' + rpx(18) + 'px ' + FONT_HEI;
    ctx.fillText('问', x, y);
    y += rpx(32);
    ctx.fillStyle = colors.gray;
    ctx.font = layout.qFont;
    layout.qLines.forEach((ln) => {
      ctx.fillText(ln, x, y);
      y += layout.qLH;
    });

    // 虚线分隔
    y = layout.yBeforeA - rpx(30);
    ctx.strokeStyle = colors.divider;
    ctx.lineWidth = Math.max(1, rpx(2));
    ctx.setLineDash([rpx(8), rpx(6)]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + layout.contentW, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 答
    y = layout.yBeforeA;
    ctx.fillStyle = colors.accent;
    ctx.font = '700 ' + rpx(18) + 'px ' + FONT_HEI;
    ctx.fillText('答', x, y);
    y += rpx(32);
    ctx.fillStyle = colors.ink;
    ctx.font = layout.aFont;
    layout.aItems.forEach((it) => {
      ctx.fillText(it.text, x, y);
      y += layout.aLH;
    });

    // 条码 + 编号 + 票脚
    const bcY = H - rpx(140);
    ctx.fillStyle = colors.ink;
    const segs = [3, 6, 5, 3, 2, 7, 3, 7];
    let bx = x;
    let si = 0;
    let on = true;
    while (bx < x + rpx(320)) {
      const w = rpx(segs[si % segs.length]);
      if (on) ctx.fillRect(bx, bcY, w, rpx(48));
      bx += w;
      on = !on;
      si++;
    }
    ctx.font = rpx(18) + 'px ' + FONT_MONO;
    ctx.fillText('2026 MENTAL MAILBOX', x, bcY + rpx(62));
    ctx.fillStyle = colors.sub;
    ctx.font = rpx(19) + 'px ' + FONT_HEI;
    ctx.fillText('写于 ' + view.dateLong + ' · 已封存', x, bcY + rpx(94));
  },

  // ── 大字标语：描边水印 + 斜贴标语条 + 红方章 ──
  drawPosterStyle(ctx, layout, colors, view) {
    const H = layout.paperH;
    const pads = layout.pads;
    const x = pads.left;
    // 右下描边水印「信」（出血）
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, EXPORT_W, H);
    ctx.clip();
    ctx.font = '900 ' + rpx(440) + 'px ' + FONT_SONG;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const wmW = ctx.measureText('信').width;
    const wmX = EXPORT_W - wmW / 2 + rpx(50);
    const wmY = H + rpx(110);
    ctx.fillStyle = 'rgba(150,132,96,0.10)';
    ctx.fillText('信', wmX, wmY);
    ctx.strokeStyle = colors.wm;
    ctx.lineWidth = Math.max(1.5, rpx(3));
    ctx.strokeText('信', wmX, wmY);
    ctx.restore();
    ctx.textBaseline = 'top';

    // kicker
    ctx.textAlign = 'left';
    ctx.fillStyle = '#96784D';
    ctx.font = rpx(19) + 'px ' + FONT_HEI;
    drawSpaced(ctx, '写给未来的一封信', x, rpx(56), rpx(8), 'left');

    // 题名（可换行）
    let y = pads.top;
    ctx.fillStyle = colors.deep;
    ctx.font = layout.titleFont;
    layout.titleLines.forEach((ln) => {
      ctx.fillText(ln, x, y);
      y += layout.titleLH;
    });

    // 红色斜贴标语条
    const banY = layout.bannerY;
    const banH = Math.round(64 * K * layout.scale);
    const banText = '答案已封存 · ' + view.dotDate;
    ctx.font = rpx(20) + 'px ' + FONT_HEI;
    const banW = ctx.measureText(banText).width + rpx(44);
    ctx.save();
    ctx.translate(x + banW / 2, banY + banH / 2);
    ctx.rotate((-1.5 * Math.PI) / 180);
    ctx.fillStyle = colors.red;
    ctx.fillRect(-banW / 2, -banH / 2, banW, banH);
    ctx.fillStyle = colors.cream;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(banText, 0, 0);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // 问
    let cy = layout.yQ;
    ctx.fillStyle = colors.red;
    ctx.font = '700 ' + rpx(19) + 'px ' + FONT_HEI;
    ctx.fillText('问', x, cy);
    cy += rpx(32);
    ctx.fillStyle = colors.gray;
    ctx.font = layout.qFont;
    layout.qLines.forEach((ln) => {
      ctx.fillText(ln, x, cy);
      cy += layout.qLH;
    });

    // 答
    cy = layout.yBeforeA;
    ctx.fillStyle = colors.red;
    ctx.font = '700 ' + rpx(19) + 'px ' + FONT_HEI;
    ctx.fillText('答', x, cy);
    cy += rpx(32);
    ctx.fillStyle = colors.ink;
    ctx.font = layout.aFont;
    layout.aItems.forEach((it) => {
      ctx.fillText(it.text, x, cy);
      cy += layout.aLH;
    });

    // 右下：日期 + 旋转红方章（心灵信箱 2×2）
    const sealS = rpx(92);
    const sealX = EXPORT_W - pads.left - sealS;
    const sealY = H - rpx(44) - sealS;
    ctx.fillStyle = colors.gray;
    ctx.font = rpx(19) + 'px ' + FONT_HEI;
    ctx.textAlign = 'right';
    ctx.fillText('写于 ' + view.dotDate, sealX - rpx(20), sealY + sealS / 2 - rpx(12));
    ctx.save();
    ctx.translate(sealX + sealS / 2, sealY + sealS / 2);
    ctx.rotate((4 * Math.PI) / 180);
    ctx.fillStyle = colors.cream;
    ctx.fillRect(-sealS / 2 - rpx(5), -sealS / 2 - rpx(5), sealS + rpx(10), sealS + rpx(10));
    ctx.fillStyle = colors.red;
    ctx.fillRect(-sealS / 2 - rpx(3), -sealS / 2 - rpx(3), sealS + rpx(6), sealS + rpx(6));
    ctx.fillRect(-sealS / 2, -sealS / 2, sealS, sealS);
    ctx.fillStyle = colors.cream;
    ctx.font = '700 ' + rpx(28) + 'px ' + FONT_KAI;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const sq = sealS / 4;
    ['心', '灵', '信', '箱'].forEach((ch, i) => {
      const cx2 = -sq + (i % 2) * sq * 2;
      const cy2 = -sq + Math.floor(i / 2) * sq * 2;
      ctx.fillText(ch, cx2, cy2);
    });
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  },

  // ── 包豪斯几何：出血几何群 + 色块标注 + 硬阴影日期块 ──
  drawBauhausStyle(ctx, layout, colors, view) {
    const H = layout.paperH;
    const pads = layout.pads;
    const x = pads.left;
    // 几何群（右上出血）：红圆 / 蓝三角 / 黑杆 / 黄点
    const circR = rpx(100);
    ctx.fillStyle = colors.red;
    ctx.beginPath();
    ctx.arc(EXPORT_W - circR + rpx(50), rpx(44), circR, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(EXPORT_W - rpx(112), rpx(168));
    ctx.rotate((14 * Math.PI) / 180);
    ctx.fillStyle = colors.blue;
    ctx.beginPath();
    ctx.moveTo(-rpx(56), -rpx(50));
    ctx.lineTo(rpx(56), -rpx(50));
    ctx.lineTo(0, rpx(50));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(EXPORT_W - rpx(187), rpx(105));
    ctx.rotate((24 * Math.PI) / 180);
    ctx.fillStyle = colors.ink;
    ctx.fillRect(-rpx(9), -rpx(75), rpx(18), rpx(150));
    ctx.restore();
    ctx.fillStyle = colors.yellow;
    ctx.beginPath();
    ctx.arc(EXPORT_W - rpx(134), rpx(210), rpx(14), 0, Math.PI * 2);
    ctx.fill();

    // 题名（避让几何群，可换行）
    let y = pads.top;
    ctx.fillStyle = colors.ink;
    ctx.font = layout.titleFont;
    layout.titleLines.forEach((ln) => {
      ctx.fillText(ln, x, y);
      y += layout.titleLH;
    });

    // 粗黑线
    ctx.fillRect(x, y + rpx(14), layout.contentW, Math.max(2, rpx(5)));

    // 问（红色块标注）
    let cy = layout.yQ;
    this.drawBauhausChip(ctx, x, cy, '问', colors.red, layout);
    ctx.fillStyle = colors.gray;
    ctx.font = layout.qFont;
    layout.qLines.forEach((ln) => {
      ctx.fillText(ln, x + rpx(54), cy);
      cy += layout.qLH;
    });

    // 答（蓝色块标注）
    cy = layout.yBeforeA;
    this.drawBauhausChip(ctx, x, cy, '答', colors.blue, layout);
    ctx.fillStyle = colors.ink;
    ctx.font = layout.aFont;
    layout.aItems.forEach((it) => {
      ctx.fillText(it.text, x + rpx(54), cy);
      cy += layout.aLH;
    });

    // 黄底黑框硬阴影日期块
    const dbText = '写于 ' + view.dateLong;
    ctx.font = '700 ' + rpx(20) + 'px ' + FONT_HEI;
    const dbW = ctx.measureText(dbText).width + rpx(44);
    const dbH = rpx(52);
    const dbY = H - rpx(44) - dbH - rpx(12);
    ctx.fillStyle = colors.ink;
    ctx.fillRect(x + rpx(12), dbY + rpx(12), dbW, dbH);
    ctx.fillStyle = colors.yellow;
    ctx.fillRect(x, dbY, dbW, dbH);
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = Math.max(1.5, rpx(3));
    ctx.strokeRect(x, dbY, dbW, dbH);
    ctx.fillStyle = colors.ink;
    ctx.fillText(dbText, x + rpx(22), dbY + rpx(14));
  },

  drawBauhausChip(ctx, x, y, label, color, layout) {
    const s = rpx(36);
    ctx.fillStyle = color;
    ctx.fillRect(x, y + rpx(2), s, s);
    ctx.fillStyle = '#FAF7EF';
    ctx.font = '700 ' + rpx(19) + 'px ' + FONT_HEI;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + s / 2, y + rpx(2) + s / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  },

  // ── 黑胶唱片：同心圆盘 + 红盘芯 + 暗纸排版 ──
  drawVinylStyle(ctx, layout, colors, view) {
    const H = layout.paperH;
    const pads = layout.pads;
    const x = pads.left;
    // 唱片盘（右上出血）：底圆 + 同心纹 + 高光
    const R = rpx(200);
    const cx = EXPORT_W - R + rpx(86);
    const cy2 = -rpx(57);
    ctx.fillStyle = '#131215';
    ctx.beginPath();
    ctx.arc(cx, cy2, R, 0, Math.PI * 2);
    ctx.fill();
    const labelR = rpx(75);
    ctx.lineWidth = 2;
    for (let r = labelR + rpx(8); r < R; r += rpx(5)) {
      ctx.strokeStyle = (Math.floor(r / rpx(5)) % 2 === 0) ? '#201E22' : '#16151A';
      ctx.beginPath();
      ctx.arc(cx, cy2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const grad = ctx.createRadialGradient(cx - R * 0.2, cy2 - R * 0.25, rpx(10), cx, cy2, R);
    grad.addColorStop(0, 'rgba(255,255,255,0.10)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.02)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy2, R, 0, Math.PI * 2);
    ctx.fill();
    // 红盘芯 + 中孔
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(cx, cy2, labelR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#F4E8D8';
    ctx.textAlign = 'center';
    ctx.font = rpx(15) + 'px ' + FONT_HEI;
    ctx.fillText('心灵信箱', cx, cy2 - rpx(30));
    ctx.font = '700 ' + rpx(26) + 'px ' + FONT_MONO;
    ctx.fillText(view.stampText, cx, cy2 - rpx(6));
    ctx.font = rpx(14) + 'px ' + FONT_HEI;
    ctx.fillText(view.yearText, cx, cy2 + rpx(28));
    ctx.fillStyle = '#1B1A1C';
    ctx.beginPath();
    ctx.arc(cx, cy2 + rpx(48), rpx(7), 0, Math.PI * 2);
    ctx.fill();

    // 曲目行
    ctx.textAlign = 'left';
    ctx.fillStyle = colors.accent;
    ctx.font = rpx(18) + 'px ' + FONT_MONO;
    ctx.fillText('A1 · ' + view.serialNo, x, rpx(56));

    // 题名（避让盘面，可换行；手写体开关回落黑体）
    let y = pads.top;
    const handOff = this.data.handwritingOff;
    ctx.fillStyle = colors.bright;
    ctx.font = (handOff ? '' : '') + layout.titleFont.replace(FONT_KAI, handOff ? FONT_HEI : FONT_KAI);
    layout.titleLines.forEach((ln) => {
      ctx.fillText(ln, x, y);
      y += layout.titleLH;
    });

    // 问（红色 cap 延伸线）
    let cy3 = layout.yQ;
    this.drawVinylCap(ctx, x, cy3, '问', colors, layout);
    cy3 += rpx(30);
    ctx.fillStyle = colors.gray;
    ctx.font = layout.qFont;
    layout.qLines.forEach((ln) => {
      ctx.fillText(ln, x, cy3);
      cy3 += layout.qLH;
    });

    // 答
    cy3 = layout.yBeforeA;
    this.drawVinylCap(ctx, x, cy3, '答', colors, layout);
    cy3 += rpx(30);
    ctx.fillStyle = colors.text;
    ctx.font = layout.aFont;
    layout.aItems.forEach((it) => {
      ctx.fillText(it.text, x, cy3);
      cy3 += layout.aLH;
    });

    // 页脚：SIDE A + 录于
    const footY = H - rpx(52);
    ctx.fillStyle = colors.dim;
    ctx.font = rpx(16) + 'px ' + FONT_MONO;
    ctx.fillText('SIDE A · MENTAL MAILBOX', x, footY);
    ctx.textAlign = 'right';
    ctx.fillStyle = colors.accent;
    ctx.font = rpx(19) + 'px ' + FONT_HEI;
    ctx.fillText('录于 ' + view.dateLong, EXPORT_W - pads.right, footY);
    ctx.textAlign = 'left';
  },

  drawVinylCap(ctx, x, y, label, colors, layout) {
    ctx.fillStyle = colors.accent;
    ctx.font = rpx(18) + 'px ' + FONT_HEI;
    ctx.fillText(label, x, y);
    const lw = ctx.measureText(label).width;
    ctx.strokeStyle = 'rgba(194,74,46,0.35)';
    ctx.lineWidth = Math.max(1, rpx(1));
    ctx.beginPath();
    ctx.moveTo(x + lw + rpx(12), y + rpx(10));
    ctx.lineTo(EXPORT_W - layout.pads.right, y + rpx(10));
    ctx.stroke();
  },

  // ── 素问笺：右上斜盖邮戳 + 问/答朱印对帖（与 .pl-suwen 同构）──
  drawSuwenStyle(ctx, layout, colors, view) {
    const pads = layout.pads;
    const x = pads.left;
    const handOff = this.data.handwritingOff;
    const rep = (f) => f.replace(FONT_KAI, handOff ? FONT_HEI : FONT_KAI);

    // 右上邮戳：虚线圆框 写于/08.30/2026（rotate -9°）
    ctx.save();
    const pmR = rpx(36);
    const pmCx = EXPORT_W - rpx(32) - pmR;
    const pmCy = rpx(28) + pmR;
    ctx.translate(pmCx, pmCy);
    ctx.rotate((-9 * Math.PI) / 180);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = Math.max(1, rpx(1.5));
    ctx.setLineDash([rpx(4), rpx(4)]);
    ctx.beginPath();
    ctx.arc(0, 0, pmR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colors.accent;
    ctx.textAlign = 'center';
    ctx.font = rpx(12) + 'px ' + FONT_HEI;
    ctx.fillText('写 于', 0, -rpx(20));
    ctx.font = rpx(18) + 'px ' + FONT_SONG;
    ctx.fillText(view.stampText, 0, -rpx(7));
    ctx.font = rpx(12) + 'px ' + FONT_HEI;
    ctx.fillText(view.yearText, 0, rpx(8));
    ctx.restore();
    ctx.textAlign = 'left';

    // 题名（楷体，右侧避让邮戳）
    let y = pads.top;
    ctx.fillStyle = colors.deep;
    ctx.font = rep(layout.titleFont);
    layout.titleLines.forEach((ln) => {
      ctx.fillText(ln, x, y);
      y += layout.titleLH;
    });

    // 分隔横线
    ctx.fillStyle = colors.line;
    ctx.fillRect(x, y + rpx(20), layout.contentW, Math.max(1, rpx(2)));

    // 问行：描边红方章 + 楷体问题
    let cy = layout.yQ;
    this.drawSuwenSeal(ctx, x, cy, '问', colors, false);
    ctx.fillStyle = colors.gray;
    ctx.font = rep(layout.qFont);
    layout.qLines.forEach((ln) => {
      ctx.fillText(ln, x + rpx(40), cy);
      cy += layout.qLH;
    });

    // 答行：实底红方章 + 楷体答案
    cy = layout.yBeforeA;
    this.drawSuwenSeal(ctx, x, cy, '答', colors, true);
    ctx.fillStyle = colors.ink;
    ctx.font = rep(layout.aFont);
    layout.aItems.forEach((it) => {
      ctx.fillText(it.text, x + rpx(40), cy);
      cy += layout.aLH;
    });
  },

  drawSuwenSeal(ctx, x, y, label, colors, filled) {
    const s = rpx(24);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (filled) {
      ctx.fillStyle = colors.accent;
      ctx.fillRect(x, y + rpx(4), s, s);
      ctx.fillStyle = colors.bg;
    } else {
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = Math.max(1, rpx(1.5));
      ctx.strokeRect(x, y + rpx(4), s, s);
      ctx.fillStyle = colors.accent;
    }
    ctx.font = rpx(16) + 'px ' + FONT_SONG;
    ctx.fillText(label, x + s / 2, y + rpx(4) + s / 2 + rpx(1));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  },

  // ── 留白志：宋体大标题 + 黑短线 + cap 细线 + 页脚（与 .pl-liubai 同构）──
  drawLiubaiStyle(ctx, layout, colors, view) {
    const H = layout.paperH;
    const pads = layout.pads;
    const x = pads.left;

    // 题名（宋体 600）
    let y = pads.top;
    ctx.fillStyle = colors.deep;
    ctx.font = layout.titleFont;
    layout.titleLines.forEach((ln) => {
      ctx.fillText(ln, x, y);
      y += layout.titleLH;
    });

    // 黑短线（题名下 24rpx）
    ctx.fillRect(x, y + rpx(24), rpx(40), rpx(4));

    // 问块
    let cy = layout.yQ;
    this.drawLiubaiCap(ctx, x, cy, '问', colors, layout);
    ctx.fillStyle = colors.gray;
    ctx.font = layout.qFont;
    layout.qLines.forEach((ln) => {
      ctx.fillText(ln, x, cy);
      cy += layout.qLH;
    });

    // 答块
    cy = layout.yBeforeA;
    this.drawLiubaiCap(ctx, x, cy, '答', colors, layout);
    ctx.fillStyle = colors.ink;
    ctx.font = layout.aFont;
    layout.aItems.forEach((it) => {
      ctx.fillText(it.text, x, cy);
      cy += layout.aLH;
    });

    // 页脚：上细线 + 品牌左 / 日期右
    const borderY = H - rpx(86);
    ctx.fillStyle = colors.line;
    ctx.fillRect(x, borderY, layout.contentW, Math.max(1, rpx(2)));
    ctx.fillStyle = colors.fainter;
    ctx.font = rpx(18) + 'px ' + FONT_HEI;
    ctx.fillText('心灵信箱', x, borderY + rpx(18));
    ctx.textAlign = 'right';
    ctx.fillStyle = colors.date;
    ctx.fillText('写于 ' + view.dateLong, EXPORT_W - pads.right, borderY + rpx(18));
    ctx.textAlign = 'left';
  },

  drawLiubaiCap(ctx, x, y, label, colors, layout) {
    const capTop = y - rpx(36); // cap 行占问题文本上方 22+14
    ctx.fillStyle = colors.faint;
    ctx.font = rpx(16) + 'px ' + FONT_HEI;
    ctx.fillText(label, x, capTop);
    const lw = ctx.measureText(label).width;
    ctx.fillStyle = colors.line;
    ctx.fillRect(x + lw + rpx(12), capTop + rpx(10), EXPORT_W - layout.pads.right - (x + lw + rpx(12)), Math.max(1, rpx(2)));
  },

  // ── 墨夜笺：径向渐变暗夜底 + 金线报头 + 金 cap + 居中落款（与 .pl-moye 同构）──
  drawMoyeStyle(ctx, layout, colors, view) {
    const H = layout.paperH;
    const pads = layout.pads;
    const x = pads.left;
    const handOff = this.data.handwritingOff;
    const rep = (f) => f.replace(FONT_KAI, handOff ? FONT_HEI : FONT_KAI);

    // 暗夜径向底色：椭圆（中心 50% 20%），用缩放坐标系复刻 CSS ellipse
    ctx.save();
    ctx.translate(0, H * 0.2);
    ctx.scale(1, 0.6);
    const grad = ctx.createRadialGradient(EXPORT_W / 2, 0, rpx(30), EXPORT_W / 2, 0, EXPORT_W * 0.8);
    grad.addColorStop(0, colors.bg1);
    grad.addColorStop(0.6, colors.bg2);
    grad.addColorStop(1, colors.bg3);
    ctx.fillStyle = grad;
    ctx.fillRect(0, -H * 0.2 / 0.6, EXPORT_W, (H + H * 0.2) / 0.6);
    ctx.restore();

    // 金线报头：双细线夹「心灵信箱」
    ctx.fillStyle = colors.goldDim;
    ctx.fillRect(x, rpx(62), EXPORT_W / 2 - rpx(40) - x, Math.max(1, rpx(2)));
    ctx.fillRect(EXPORT_W / 2 + rpx(40), rpx(62), EXPORT_W - pads.right - (EXPORT_W / 2 + rpx(40)), Math.max(1, rpx(2)));
    ctx.fillStyle = colors.gold;
    ctx.font = rpx(14) + 'px ' + FONT_HEI;
    ctx.textAlign = 'center';
    drawSpaced(ctx, '心灵信箱', EXPORT_W / 2, rpx(55), rpx(6), 'center');
    ctx.textAlign = 'left';

    // 题名（居中楷体）
    let y = pads.top;
    ctx.fillStyle = colors.bright;
    ctx.font = rep(layout.titleFont);
    ctx.textAlign = 'center';
    layout.titleLines.forEach((ln) => {
      ctx.fillText(ln, EXPORT_W / 2, y);
      y += layout.titleLH;
    });
    ctx.textAlign = 'left';

    // 问块
    let cy = layout.yQ;
    this.drawMoyeCap(ctx, x, cy, '问', colors, layout);
    ctx.fillStyle = colors.gray;
    ctx.font = rep(layout.qFont);
    layout.qLines.forEach((ln) => {
      ctx.fillText(ln, x, cy);
      cy += layout.qLH;
    });

    // 答块
    cy = layout.yBeforeA;
    this.drawMoyeCap(ctx, x, cy, '答', colors, layout);
    ctx.fillStyle = colors.text;
    ctx.font = rep(layout.aFont);
    layout.aItems.forEach((it) => {
      ctx.fillText(it.text, x, cy);
      cy += layout.aLH;
    });

    // 居中落款
    ctx.textAlign = 'center';
    ctx.fillStyle = colors.gold;
    ctx.font = rpx(18) + 'px ' + FONT_HEI;
    ctx.fillText('— 写于 ' + view.dateLong + ' —', EXPORT_W / 2, H - rpx(70));
    ctx.textAlign = 'left';
  },

  drawMoyeCap(ctx, x, y, label, colors, layout) {
    const capTop = y - rpx(34); // cap 行占问题文本上方 22+12
    ctx.fillStyle = colors.gold;
    ctx.font = rpx(16) + 'px ' + FONT_HEI;
    ctx.fillText(label, x, capTop);
    const lw = ctx.measureText(label).width;
    ctx.fillStyle = colors.goldFaint;
    ctx.fillRect(x + lw + rpx(12), capTop + rpx(10), EXPORT_W - layout.pads.right - (x + lw + rpx(12)), Math.max(1, rpx(2)));
  },

  // ── 航空笺：全幅斜纹画框 + 签条/邮票/邮戳（与 .pl-airmail 同构）──
  drawAirmailStyle(ctx, layout, colors, view) {
    const H = layout.paperH;
    const pads = layout.pads;
    const x = pads.left;
    const sheetR = EXPORT_W - rpx(48);

    // 全幅 45° 斜纹（红 13 / 米 9 / 蓝 13 / 米 9，周期 44rpx）
    ctx.save();
    ctx.translate(EXPORT_W / 2, H / 2);
    ctx.rotate(Math.PI / 4);
    const diag = Math.ceil(Math.sqrt(EXPORT_W * EXPORT_W + H * H));
    for (let sx = -diag; sx < diag; ) {
      ctx.fillStyle = colors.stripe1;
      ctx.fillRect(sx, -diag, rpx(13), diag * 2);
      sx += rpx(13);
      ctx.fillStyle = colors.stripe2;
      ctx.fillRect(sx, -diag, rpx(9), diag * 2);
      sx += rpx(9);
      ctx.fillStyle = colors.stripe3;
      ctx.fillRect(sx, -diag, rpx(13), diag * 2);
      sx += rpx(13);
      ctx.fillStyle = colors.stripe2;
      ctx.fillRect(sx, -diag, rpx(9), diag * 2);
      sx += rpx(9);
    }
    ctx.restore();

    // 内层纸面
    ctx.fillStyle = colors.bg;
    ctx.fillRect(rpx(12), rpx(12), EXPORT_W - rpx(24), H - rpx(24));

    // 头部：PAR AVION 签条（左）+ 邮票（右）+ 出血圆形邮戳
    const headTop = rpx(48);
    const avX = x;
    const avY = headTop;
    const avW = rpx(132);
    const avH = rpx(64);
    ctx.strokeStyle = colors.blue;
    ctx.lineWidth = Math.max(1, rpx(1.5));
    ctx.strokeRect(avX, avY, avW, avH);
    ctx.fillStyle = colors.blue;
    ctx.textAlign = 'center';
    ctx.font = '700 ' + rpx(16) + 'px ' + FONT_SONG;
    ctx.fillText('PAR AVION', avX + avW / 2, avY + rpx(10));
    ctx.font = rpx(14) + 'px ' + FONT_HEI;
    drawSpaced(ctx, '航空邮件', avX + avW / 2, avY + rpx(38), rpx(6), 'center');
    ctx.textAlign = 'left';

    // 邮票（70×82，内框 135° 细斜纹）
    const stW = rpx(70);
    const stH = rpx(82);
    const stX = sheetR - stW;
    const stY = headTop;
    ctx.fillStyle = colors.stampPaper;
    ctx.fillRect(stX, stY, stW, stH);
    const frX = stX + rpx(8);
    const frY = stY + rpx(8);
    const frW = stW - rpx(16);
    const frH = stH - rpx(16);
    ctx.save();
    ctx.beginPath();
    ctx.rect(frX, frY, frW, frH);
    ctx.clip();
    ctx.strokeStyle = 'rgba(51,85,126,0.10)';
    ctx.lineWidth = rpx(4);
    for (let i = -frH; i < frW + frH; i += rpx(8)) {
      ctx.beginPath();
      ctx.moveTo(frX + i, frY + frH);
      ctx.lineTo(frX + i + frH, frY);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = colors.blue;
    ctx.lineWidth = Math.max(1.5, rpx(3));
    ctx.strokeRect(frX, frY, frW, frH);
    ctx.fillStyle = colors.blue;
    ctx.textAlign = 'center';
    ctx.font = '700 ' + rpx(24) + 'px ' + FONT_SONG;
    ctx.fillText(view.stampText, frX + frW / 2, frY + rpx(14));
    ctx.font = rpx(12) + 'px ' + FONT_HEI;
    ctx.fillText(view.yearText, frX + frW / 2, frY + rpx(48));
    ctx.textAlign = 'left';

    // route 行（右对齐）
    ctx.fillStyle = colors.tan;
    ctx.font = rpx(14) + 'px ' + FONT_HEI;
    ctx.textAlign = 'right';
    ctx.fillText('BY MENTAL MAILBOX · 寄给未来', sheetR, stY + stH + rpx(12));
    ctx.textAlign = 'left';

    // 题名（宋体 700）
    let y = pads.top;
    ctx.fillStyle = colors.ink;
    ctx.font = layout.titleFont;
    layout.titleLines.forEach((ln) => {
      ctx.fillText(ln, x, y);
      y += layout.titleLH;
    });

    // 问 cap（红）+ 问题
    let cy = layout.yQ;
    this.drawAirmailCap(ctx, x, cy, '问', colors);
    ctx.fillStyle = colors.qGray;
    ctx.font = layout.qFont;
    layout.qLines.forEach((ln) => {
      ctx.fillText(ln, x, cy);
      cy += layout.qLH;
    });

    // 虚线分隔
    const qEnd = layout.yQ + layout.qLines.length * layout.qLH;
    ctx.strokeStyle = colors.dash;
    ctx.lineWidth = Math.max(1, rpx(1.5));
    ctx.setLineDash([rpx(6), rpx(5)]);
    ctx.beginPath();
    ctx.moveTo(x, qEnd + rpx(22));
    ctx.lineTo(sheetR, qEnd + rpx(22));
    ctx.stroke();
    ctx.setLineDash([]);

    // 答 cap + 答案
    cy = layout.yBeforeA;
    this.drawAirmailCap(ctx, x, cy, '答', colors);
    ctx.fillStyle = colors.aBlue;
    ctx.font = layout.aFont;
    layout.aItems.forEach((it) => {
      ctx.fillText(it.text, x, cy);
      cy += layout.aLH;
    });

    // 页脚：VIA AIR MAIL 左 / 日期右
    const footY = H - rpx(70);
    ctx.fillStyle = colors.tan;
    ctx.font = rpx(14) + 'px ' + FONT_SONG;
    ctx.fillText('VIA AIR MAIL', x, footY);
    ctx.textAlign = 'right';
    ctx.fillStyle = colors.blue;
    ctx.font = rpx(18) + 'px ' + FONT_HEI;
    ctx.fillText('写于 ' + view.dateLong, sheetR, footY);
    ctx.textAlign = 'left';
  },

  drawAirmailCap(ctx, x, y, label, colors) {
    const capTop = y - rpx(30); // cap 行占文本上方 22+8
    ctx.fillStyle = colors.red;
    ctx.font = '700 ' + rpx(16) + 'px ' + FONT_HEI;
    ctx.fillText(label, x, capTop);
  },

  // Canvas createImage() 不认 cloud:// fileID：须经 cloud 服务换本地临时路径再绘制；
  // 本地/网络路径原样使用
  loadImage(src) {
    const toLocal = src && src.indexOf('cloud://') === 0
      ? cloud.downloadFile(src)
      : Promise.resolve(src);
    return toLocal.then(
      (path) =>
        new Promise((resolve, reject) => {
          const img = this._canvas.createImage();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = path;
        })
    );
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

// 换行测量（按字符逐个试宽，CJK 场景够用；支持 \n 分段；maxWidth 可传函数按行号给宽）
function wrapText(ctx, text, maxWidth) {
  const widthAt = typeof maxWidth === 'function' ? maxWidth : () => maxWidth;
  const str = String(text || '');
  const lines = [];
  str.split('\n').forEach((para) => {
    if (!para) {
      lines.push('');
      return;
    }
    const chars = para.split('');
    let line = '';
    while (chars.length) {
      const ch = chars.shift();
      if (ctx.measureText(line + ch).width > widthAt(lines.length) && line) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    if (line) lines.push(line);
  });
  return lines.length ? lines : [''];
}

// 首字下沉换行（号外头版）：前 dropRows 行让位大字用窄宽，其后整宽 → [{text, dx}]
function wrapDrop(ctx, text, fullW, dropW, dropRows) {
  const items = [];
  const str = String(text || '');
  str.split('\n').forEach((para, pi) => {
    const chars = para.split('');
    let line = '';
    const flush = () => {
      if (line !== '' || items.length) {
        const idx = items.length;
        items.push({ text: line, dx: idx < dropRows ? dropW : 0 });
      }
      line = '';
    };
    while (chars.length) {
      const ch = chars.shift();
      const limit = items.length < dropRows ? fullW - dropW : fullW;
      if (ctx.measureText(line + ch).width > limit && line) {
        items.push({ text: line, dx: items.length < dropRows ? dropW : 0 });
        line = ch;
      } else {
        line += ch;
      }
    }
    if (pi === str.split('\n').length - 1) {
      items.push({ text: line, dx: items.length < dropRows ? dropW : 0 });
    } else {
      flush();
    }
  });
  return items.length ? items : [{ text: '', dx: 0 }];
}

// 逐字距绘制（报头/kicker 等需要拉开字距的场景；canvas 无通用 letterSpacing）
function drawSpaced(ctx, text, x, y, spacing, align) {
  const chars = String(text).split('');
  const total = chars.reduce((acc, ch) => acc + ctx.measureText(ch).width, 0) + spacing * (chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : x;
  chars.forEach((ch) => {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  });
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
