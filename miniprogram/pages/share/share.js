// 04 · 分享图 · 明信片预览页
// 单一预览态（功能需求文档 七）：进入即全屏预览，名称/问题/答案/创建时间四项
// 固定全部入图；重读记录与回信永不进入分享图（BR-15）。
// 【方案B 改版】信纸不再使用纸张图片：明信片 = 主题配色底 + 纯排版文字 + 底部小程序条，
// 宽固定、高度随内容自适应，不再有版面截断（字数上限由写信页管理）。

const THEMES = require('../write/themes.js');
const PAPERS = require('../write/papers.js');
const letterService = require('../../services/letter.js');
const themeService = require('../../services/theme.js');
const analytics = require('../../services/analytics.js');
const cloud = require('../../services/cloud.js');

// 埋点统一走 analytics 服务（事件名见 PRD 第十三节）
function track(event, data) {
  analytics.track(event, data);
}

// ── Canvas 导出规格（方案B：配色信纸 = 底色 + 纯排版；宽固定 1080，高随内容自适应）──
const EXPORT_W = 1080;
const K = EXPORT_W / 630; // 预览 rpx 尺寸 → 导出像素换算系数（预览明信片基准宽 630rpx）
const BAR_H = Math.round(88 * K); // 底部小程序条（与预览 88rpx 同源）
const TITLE_FONT = Math.round(34 * K); // 与预览 pc-title 34rpx 同源
const HAND_FONT = Math.round(28 * K);  // 与预览 pc-hand 28rpx 同源
const DATE_FONT = Math.round(22 * K);  // 与预览 pc-date 22rpx 同源
const MIN_PAPER_H = EXPORT_W;  // 内容很短时保持一屏比例
const MAX_PAPER_H = 3600;      // Canvas 2d 真机高度上限兜底（超长按字号²比例缩小字号）

// 版式边距（papers.js 四款各自的内容安全区，单位按导出宽比例；装饰侵入文字区时加大）：
// 航空笺顶部要放下标签框 + 邮票框行；笔记本左侧留边线/装订孔；织纹笺四周留双框
function paperPads(paperId) {
  switch (paperId) {
    case 'airmail':
      return { side: Math.round(EXPORT_W * 0.16), top: Math.round(EXPORT_W * 0.36), bottom: Math.round(EXPORT_W * 0.12) };
    case 'notebook':
      return { side: Math.round(EXPORT_W * 0.17), top: Math.round(EXPORT_W * 0.1), bottom: Math.round(EXPORT_W * 0.08) };
    case 'weave':
      return { side: Math.round(EXPORT_W * 0.15), top: Math.round(EXPORT_W * 0.14), bottom: Math.round(EXPORT_W * 0.11) };
    default:
      return { side: Math.round(EXPORT_W * 0.12), top: Math.round(EXPORT_W * 0.1), bottom: Math.round(EXPORT_W * 0.08) };
  }
}

const C_LINE = '#C58A6A';       // 信纸头线（陶土色，与写信/详情页 headline 同源）
const C_BRAND_BG = '#6B8E85';
const C_QR_DARK = '#2E3330';
const FONT_HEADING = '"Noto Serif SC","Songti SC","STKaiti","KaiTi",serif';
const FONT_HAND = '"Kaiti SC","STKaiti","KaiTi",cursive';
// 真实小程序码（品牌区扫码入口，预览与导出同源）
const QR_SRC = '/assets/qrcode.jpg';

Page({
  data: {
    statusBarHeight: 20,
    handwritingOff: false,
    letter: { name: '', question: '', answer: '' },
    theme: THEMES[0],
    themeName: THEMES[0].name,
    paper: PAPERS[0],
    stampText: '',
    dateText: '',
    drawing: false
  },

  onLoad(options) {
    const win = wx.getWindowInfo();
    this.setData({
      statusBarHeight: win.statusBarHeight || 20,
      handwritingOff: wx.getStorageSync('handwriting_off') === true
    });

    // 与详情页同源：经 letter 服务读取（真实寄出的信优先，否则演示数据预览）；
    // 主题/信纸版式统一经 theme 服务解析（与信匣/写信第二步同口径）
    Promise.all([letterService.get(options && options.id), themeService.getThemes(), themeService.getPapers()])
      .then(([res, themes, papers]) => {
        const letter = res.letter;
        const theme = themes.find((t) => t.id === letter.theme_id) || themes[0] || THEMES[0];
        const created = new Date(letter.created_at);
        this.setData({
          letter,
          theme,
          themeName: theme.name,
          paper: themeService.paperOf(letter.paper_id, papers),
          stampText: (created.getMonth() + 1) + '.' + created.getDate(),
          dateText: created.getFullYear() + '年' + (created.getMonth() + 1) + '月' + created.getDate() + '日'
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

  // ── Canvas 导出：按预览样式绘制配色明信片，返回临时文件 ──
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
  measureLayout(ctx, letter, handFace) {
    const pads = paperPads(this.data.paper.id);
    const attempt = (scale) => this.measureAt(ctx, letter, handFace, scale, pads);
    let layout = attempt(1);
    if (layout.paperH + BAR_H > MAX_PAPER_H) {
      layout = attempt(Math.max(0.5, Math.sqrt(MAX_PAPER_H / (layout.paperH + BAR_H))));
    }
    if (layout.paperH + BAR_H > MAX_PAPER_H) {
      const allowed = Math.max(
        1,
        Math.floor((MAX_PAPER_H - BAR_H - pads.bottom - layout.dateGap - layout.dateH - layout.yBeforeAnswer) / layout.lineH)
      );
      layout.aLines = layout.aLines.slice(0, allowed);
      if (layout.aLines.length) layout.aLines[layout.aLines.length - 1] += '…';
      layout.paperH = Math.max(
        MIN_PAPER_H,
        layout.yBeforeAnswer + layout.aLines.length * layout.lineH + layout.dateGap + layout.dateH + pads.bottom
      );
    }
    return layout;
  },

  measureAt(ctx, letter, handFace, scale, pads) {
    const contentW = EXPORT_W - pads.side * 2;
    const titlePx = Math.round(TITLE_FONT * scale);
    const handPx = Math.round(HAND_FONT * scale);
    const lineH = Math.round(handPx * 1.8);
    const titleLineH = Math.round(titlePx * 1.3);
    const gapQA = Math.round(32 * K);
    const dateGap = Math.round(36 * K);
    const dateH = Math.round(DATE_FONT * 1.4);

    let y = pads.top;
    // 标题：居中单行，超宽截断加省略号
    ctx.font = 'bold ' + titlePx + 'px ' + FONT_HEADING;
    const title = clipLine(ctx, String(letter.name || ''), contentW);
    y += titleLineH + Math.round(24 * K);

    ctx.font = handPx + 'px ' + handFace;
    const qStartY = y;
    const qLines = wrapText(ctx, letter.question, contentW);
    y += qLines.length * lineH + gapQA;
    const yBeforeAnswer = y;
    const aStartY = y;
    const aLines = wrapText(ctx, letter.answer, contentW);
    y += aLines.length * lineH + dateGap + dateH;

    return {
      paperH: Math.max(MIN_PAPER_H, y + pads.bottom),
      pads,
      title,
      qLines,
      aLines,
      qStartY,
      aStartY,
      yBeforeAnswer,
      titlePx,
      lineH,
      titleLineH,
      gapQA,
      dateGap,
      dateH,
      handFont: handPx + 'px ' + handFace,
      titleFont: 'bold ' + titlePx + 'px ' + FONT_HEADING
    };
  },

  // 绘制整张明信片（异步等待小程序码加载完成后返回 canvas）
  drawPostcard(canvas) {
    const ctx = canvas.getContext('2d');
    const letter = this.data.letter;
    const pal = this.data.theme.palette || THEMES[0].palette;
    const handFace = this.data.handwritingOff ? FONT_UI_CANVAS : FONT_HAND;
    const layout = this.measureLayout(ctx, letter, handFace);

    canvas.width = EXPORT_W;
    canvas.height = layout.paperH + BAR_H;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    return this.loadImage(QR_SRC)
      .catch(() => null)
      .then((qrImg) => {
        ctx.textBaseline = 'top';
        const pads = layout.pads;

        // ── 信纸主体：主题底色 + 版式装饰层 + 信纸头线 + 纯排版内容
        //（BR-15：名称/问题/答案/创建时间全入图）──
        ctx.fillStyle = pal.base;
        ctx.fillRect(0, 0, EXPORT_W, layout.paperH);
        this.drawPaperDecor(ctx, layout, pal);
        ctx.fillStyle = C_LINE;
        ctx.fillRect(pads.side, pads.top - Math.round(24 * K), EXPORT_W - pads.side * 2, Math.max(2, Math.round(3 * K)));

        const textX = pads.side;
        let y = pads.top;
        // 标题（居中）
        ctx.fillStyle = pal.title;
        ctx.font = layout.titleFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(layout.title, EXPORT_W / 2, y);
        y += layout.titleLineH + Math.round(24 * K);
        // 问题 / 答案（手写体逐行换行，不截断——高度随内容走）
        y = drawLines(ctx, layout.qLines, textX, y, layout.handFont, pal.text, layout.lineH);
        y += layout.gapQA;
        drawLines(ctx, layout.aLines, textX, y, layout.handFont, pal.text, layout.lineH);
        // 落款右对齐
        ctx.fillStyle = pal.tag;
        ctx.font = Math.round(DATE_FONT) + 'px ' + FONT_UI_CANVAS;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('—— 写于 ' + this.data.dateText, EXPORT_W - pads.side, layout.paperH - pads.bottom - layout.dateH);

        // ── 底部小程序条：火漆 Logo 环 + 品牌文案 + 小程序码 ──
        ctx.fillStyle = C_BRAND_BG;
        ctx.fillRect(0, layout.paperH, EXPORT_W, BAR_H);
        const barMidY = layout.paperH + BAR_H / 2;
        const logoD = 30 * K;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 3 * K;
        ctx.beginPath();
        ctx.arc(32 * K + logoD / 2, barMidY, logoD / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = Math.round(20 * K) + 'px ' + FONT_UI_CANVAS;
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
          ctx.fillStyle = C_QR_DARK;
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

  // ── 版式装饰层（底色之上、正文之下；与预览 WXSS 同构，装饰色仅固定暖色锚点）──
  drawPaperDecor(ctx, layout, pal) {
    const paperId = this.data.paper.id;
    if (paperId === 'airmail') this.drawAirmailDecor(ctx, layout, pal);
    else if (paperId === 'notebook') this.drawNotebookDecor(ctx, layout);
    else if (paperId === 'weave') this.drawWeaveDecor(ctx, layout);
  },

  // 航空笺：整面斜纹带后盖内层底色留出边框 + 标签框/邮票框/双环邮戳
  drawAirmailDecor(ctx, layout, pal) {
    const bw = Math.round(16 * K);
    const H = layout.paperH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, EXPORT_W, H);
    ctx.clip();
    drawDiagBand(ctx, EXPORT_W, H, 'rgba(197,138,106,0.38)', Math.round(16 * K), 0);
    drawDiagBand(ctx, EXPORT_W, H, 'rgba(125,133,128,0.30)', Math.round(16 * K), Math.round(24 * K));
    ctx.restore();
    // 内层底色（覆盖中部斜纹，只留边框带）
    ctx.fillStyle = pal.base;
    ctx.fillRect(bw, bw, EXPORT_W - bw * 2, H - bw * 2);

    const rowX = bw + Math.round(30 * K);
    const rowY = bw + Math.round(30 * K);
    // PAR AVION 标签框
    const labelW = Math.round(200 * K);
    const labelH = Math.round(84 * K);
    ctx.strokeStyle = 'rgba(125,133,128,0.5)';
    ctx.lineWidth = Math.max(1.5, 2 * K);
    ctx.setLineDash([]);
    ctx.strokeRect(rowX, rowY, labelW, labelH);
    ctx.fillStyle = '#9A9284';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = Math.round(18 * K) + 'px ' + FONT_UI_CANVAS;
    ctx.fillText('心 灵 信 箱', rowX + labelW / 2, rowY + Math.round(14 * K));
    ctx.font = Math.round(15 * K) + 'px ' + FONT_UI_CANVAS;
    ctx.fillText('P A R   A V I O N', rowX + labelW / 2, rowY + Math.round(46 * K));
    // 邮票框（虚线）+ 主题名
    const stW = Math.round(120 * K);
    const stH = Math.round(140 * K);
    const stX = EXPORT_W - rowX - stW;
    ctx.setLineDash([Math.round(8 * K), Math.round(6 * K)]);
    ctx.strokeRect(stX, rowY, stW, stH);
    ctx.setLineDash([]);
    const miniW = Math.round(48 * K);
    const miniH = Math.round(60 * K);
    ctx.fillStyle = 'rgba(197,138,106,0.28)';
    ctx.fillRect(stX + (stW - miniW) / 2, rowY + Math.round(20 * K), miniW, miniH);
    ctx.fillStyle = '#5A4F3E';
    ctx.font = 'bold ' + Math.round(24 * K) + 'px ' + FONT_HEADING;
    ctx.fillText('信', stX + stW / 2, rowY + Math.round(34 * K));
    ctx.fillStyle = '#9A9284';
    ctx.font = Math.round(16 * K) + 'px ' + FONT_UI_CANVAS;
    ctx.fillText(this.data.themeName, stX + stW / 2, rowY + Math.round(94 * K));
    // 双环邮戳（压在邮票框左下角）
    const pmR = Math.round(46 * K);
    const pmX = stX - Math.round(6 * K);
    const pmY = rowY + stH - Math.round(6 * K);
    ctx.save();
    ctx.translate(pmX, pmY);
    ctx.rotate((-12 * Math.PI) / 180);
    ctx.strokeStyle = 'rgba(125,133,128,0.75)';
    ctx.lineWidth = Math.max(1.5, 3 * K);
    ctx.beginPath();
    ctx.arc(0, 0, pmR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, 2 * K);
    ctx.beginPath();
    ctx.arc(0, 0, pmR - Math.round(10 * K), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#7D8580';
    ctx.font = 'bold ' + Math.round(20 * K) + 'px ' + FONT_HEADING;
    ctx.textBaseline = 'middle';
    ctx.fillText(this.data.stampText, 0, 0);
    ctx.restore();
    ctx.textBaseline = 'top';
  },

  // 笔记本：陶土左边线 + 装订孔 + 正文踩线横格（与行盒对齐，基线下方 0.86 行高处）
  drawNotebookDecor(ctx, layout) {
    const pads = layout.pads;
    const H = layout.paperH;
    ctx.fillStyle = 'rgba(197,138,106,0.55)';
    ctx.fillRect(Math.round(pads.side * 0.42), 0, Math.max(2, Math.round(3 * K)), H);
    ctx.fillStyle = 'rgba(80,100,90,0.1)';
    const holeR = Math.round(13 * K);
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(Math.round(pads.side * 0.16), (H * i) / 4, holeR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(125,133,128,0.26)';
    ctx.lineWidth = Math.max(1, 2 * K);
    const x1 = pads.side;
    const x2 = EXPORT_W - pads.side;
    const drawRows = (startY, count) => {
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const ly = Math.round(startY + (i + 1) * layout.lineH - layout.lineH * 0.14);
        ctx.moveTo(x1, ly);
        ctx.lineTo(x2, ly);
      }
      ctx.stroke();
    };
    drawRows(layout.qStartY, layout.qLines.length);
    drawRows(layout.aStartY, layout.aLines.length);
  },

  // 织纹笺：淡织纹网格 + 双线内框 + 四角陶土菱饰
  drawWeaveDecor(ctx, layout) {
    const H = layout.paperH;
    ctx.strokeStyle = 'rgba(46,51,48,0.03)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < EXPORT_W; x += Math.round(14 * K)) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y2 = 0; y2 < H; y2 += Math.round(14 * K)) {
      ctx.moveTo(0, y2);
      ctx.lineTo(EXPORT_W, y2);
    }
    ctx.stroke();
    const inset = Math.round(24 * K);
    ctx.strokeStyle = 'rgba(125,133,128,0.4)';
    ctx.lineWidth = Math.max(1.5, 2 * K);
    ctx.strokeRect(inset, inset, EXPORT_W - inset * 2, H - inset * 2);
    const inset2 = inset + Math.round(14 * K);
    ctx.strokeStyle = 'rgba(125,133,128,0.18)';
    ctx.lineWidth = Math.max(1, 1.5 * K);
    ctx.strokeRect(inset2, inset2, EXPORT_W - inset2 * 2, H - inset2 * 2);
    ctx.strokeStyle = '#C58A6A';
    ctx.lineWidth = Math.max(2, 3 * K);
    const cs = Math.round(9 * K);
    [
      [inset, inset],
      [EXPORT_W - inset, inset],
      [inset, H - inset],
      [EXPORT_W - inset, H - inset]
    ].forEach((pt) => {
      ctx.save();
      ctx.translate(pt[0], pt[1]);
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-cs / 2, -cs / 2, cs, cs);
      ctx.restore();
    });
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

// 导出图系统 UI 字体（手写体关闭态与品牌区文字用）
const FONT_UI_CANVAS = '"PingFang SC","Microsoft YaHei",sans-serif';

// 换行测量（按字符逐个试宽，CJK 场景够用；支持 \n 分段）→ 行数组
function wrapText(ctx, text, maxWidth) {
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
      if (ctx.measureText(line + ch).width > maxWidth && line) {
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

// 单行截断加省略号（标题等单行场景）
function clipLine(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '…';
}

// 逐行绘制（textBaseline=top），返回新 y
function drawLines(ctx, lines, x, y, font, color, lineH) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  lines.forEach((ln) => {
    ctx.fillText(ln, x, y);
    y += lineH;
  });
  return y;
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

// 画一层 -45° 斜线带（航空笺边框纹；band 为带宽，offset 为相位平移）
function drawDiagBand(ctx, w, h, color, band, offset) {
  ctx.strokeStyle = color;
  ctx.lineWidth = band;
  const step = band * 3;
  ctx.beginPath();
  for (let x = -h + offset - step; x < w + h; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x + h, h);
  }
  ctx.stroke();
}
