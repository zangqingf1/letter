// 04 · 分享图 · 明信片预览页
// 三状态（功能需求文档 七）：勾选抽屉（界面1，默认滑出）→ 全屏预览+操作（界面2）
// → 重新勾选（界面3，勾选项保留）。重读记录与回信永不进入分享图（BR-15），
// 本页预览与 Canvas 导出均只渲染名称/问题/答案/创建时间四项勾选内容。

const THEMES = require('../write/themes.js');
const letterService = require('../../services/letter.js');
const analytics = require('../../services/analytics.js');

// 埋点统一走 analytics 服务（事件名见 PRD 第十三节）
function track(event, data) {
  analytics.track(event, data);
}

// ── Canvas 导出规格（1080×1440，3:4；布局比例与预览 WXML 一一对应）──
const EXPORT_W = 1080;
const EXPORT_H = 1440;
const PAPER_RATIO = 896 / 1200;   // 信纸素材宽高比（与预览 fitPostcard 同源）
const BRAND_RATIO = 88 / 840;     // 品牌区高度占明信片比例
// 预览 rpx 尺寸 → 导出像素换算系数（预览明信片基准宽 630rpx）
const K = EXPORT_W / 630;

const C_CARD_BG = '#EDE9DC';
const C_TITLE = '#5A4F3E';
const C_HAND = '#4A4438';
const C_DATE = '#9A9284';
const C_BRAND_BG = '#6B8E85';
const C_QR_DARK = '#2E3330';
const FONT_HEADING = '"Noto Serif SC","Songti SC","STKaiti","KaiTi",serif';
const FONT_HAND = '"Kaiti SC","STKaiti","KaiTi",cursive';

Page({
  data: {
    statusBarHeight: 20,
    handwritingOff: false,
    letter: { name: '', question: '', answer: '' },
    theme: THEMES[0],
    themeName: THEMES[0].name,
    dateText: '',
    qrCells: [0, 1, 2, 3, 4, 5, 6, 7, 8], // 二维码占位格
    cardW: 0,
    cardH: 0,
    paperW: 0,
    paperH: 0,
    brandH: 0,
    padTop: 0,
    padBottom: 0,
    padSide: 0,
    // ── 勾选抽屉（界面1/3）：默认全选，重读记录与回信不可选（BR-15）──
    sheetOpen: true,
    hasGenerated: false,
    sel: { name: true, question: true, answer: true, date: true },
    drawing: false
  },

  onLoad(options) {
    const win = wx.getWindowInfo();
    this.setData({
      statusBarHeight: win.statusBarHeight || 20,
      handwritingOff: wx.getStorageSync('handwriting_off') === true
    });

    // 与详情页同源：经 letter 服务读取（真实寄出的信优先，否则演示数据预览）
    letterService.get(options && options.id).then((res) => {
      const letter = res.letter;
      const theme = THEMES.find((t) => t.id === letter.theme_id) || THEMES[0];
      const created = new Date(letter.created_at);
      this.setData({
        letter,
        theme,
        themeName: theme.name,
        dateText: created.getFullYear() + '年' + (created.getMonth() + 1) + '月' + created.getDate() + '日'
      });
    })
    .catch((err) => console.error('[share] 信件读取失败', err));
  },

  onReady() {
    this.fitPostcard();
  },

  // 明信片按预览区实测空间等比缩放（3:4）。信纸主体按素材比例（896×1200）完整缩放，
  // 不被品牌区遮挡；文字区留白随信纸实际尺寸换算，始终落在信纸的横线排版区内
  fitPostcard() {
    const query = wx.createSelectorQuery();
    query.select('.stage').boundingClientRect();
    query.exec((res) => {
      const rect = res && res[0];
      if (!rect || !rect.width || !rect.height) return;
      const w = Math.min(rect.width, rect.height * 0.75);
      const h = w / 0.75;
      // 品牌区高度按卡片等比（88/840），信纸主体占其余全部空间并按素材比例完整缩放
      const brandH = Math.round(h * BRAND_RATIO);
      const paperH = h - brandH;
      const paperW = Math.min(w, Math.round(paperH * PAPER_RATIO));
      this.setData({
        cardW: Math.floor(w),
        cardH: Math.floor(h),
        brandH,
        paperW,
        paperH,
        padTop: Math.round(paperH * 0.35),
        padBottom: Math.round(paperH * 0.17),
        padSide: Math.round(paperW * 0.127)
      });
    });
  },

  onTapBack() {
    wx.navigateBack();
  },

  // ── 勾选抽屉（界面1/3）──
  onToggleSel(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    this.setData({ ['sel.' + key]: !this.data.sel[key] });
  },

  // 生成分享图：收起抽屉进入预览（界面2）
  onTapGenerate() {
    if (!this.data.hasGenerated) {
      // 埋点：生成分享图（传播行为，PRD 第十三节）
      track('share_image_generate', { theme_id: this.data.theme.id });
    }
    this.setData({ sheetOpen: false, hasGenerated: true });
  },

  onOpenSheet() {
    // 重新勾选（界面3）：已勾选项完整保留，预览微缩淡化由 CSS 完成
    this.setData({ sheetOpen: true });
  },

  onCloseSheet() {
    this.setData({ sheetOpen: false });
  },

  // ── Canvas 导出：按预览样式绘制 1080×1440 竖版明信片，返回临时文件 ──
  exportPostcard() {
    if (this._exporting) return Promise.reject(new Error('busy'));
    this._exporting = true;
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
          canvas.width = EXPORT_W;
          canvas.height = EXPORT_H;
          this._canvas = canvas;
          resolve(canvas);
        });
    });
  },

  drawPostcard(canvas) {
    const ctx = canvas.getContext('2d');
    const sel = this.data.sel;
    const letter = this.data.letter;
    ctx.clearRect(0, 0, EXPORT_W, EXPORT_H);

    // 卡片底 + 圆角裁切（内容均落在裁切区内）
    ctx.save();
    roundRectPath(ctx, 0, 0, EXPORT_W, EXPORT_H, 24 * K);
    ctx.clip();
    ctx.fillStyle = C_CARD_BG;
    ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);

    // 信纸主体：与预览同比例（品牌区之下完整展示，不被遮挡）
    const brandH = EXPORT_H * BRAND_RATIO;
    const paperH = EXPORT_H - brandH;
    const paperW = Math.min(EXPORT_W, paperH * PAPER_RATIO);
    const px = (EXPORT_W - paperW) / 2;
    const padTop = paperH * 0.35;
    const padBottom = paperH * 0.17;
    const padSide = paperW * 0.127;
    const contentW = paperW - padSide * 2;
    const textX = px + padSide;

    return this.loadImage(this.data.theme.paper)
      .then((paperImg) => {
        // 信纸素材（圆角裁切内完整缩放，不裁切）
        ctx.save();
        roundRectPath(ctx, px, 0, paperW, paperH, 12 * K);
        ctx.clip();
        ctx.drawImage(paperImg, px, 0, paperW, paperH);
        ctx.restore();

        // ── 勾选内容（BR-15：仅四项可选内容，重读记录与回信永不入图）──
        const handFont = this.data.handwritingOff ? '48px ' + FONT_UI_CANVAS : '48px ' + FONT_HAND;
        let y = 0 + padTop;
        const limitY = paperH - padBottom;

        if (sel.name) {
          ctx.fillStyle = C_TITLE;
          ctx.font = 'bold ' + Math.round(34 * K) + 'px ' + FONT_HEADING;
          ctx.textAlign = 'center';
          ctx.fillText(letter.name, px + paperW / 2, y + 34 * K);
          y += 34 * K * 1.2 + 8 * K;
        }
        ctx.textAlign = 'left';
        if (sel.question) {
          y += 16 * K;
          y = drawWrapped(ctx, letter.question, textX, y, contentW, handFont, C_HAND, limitY);
        }
        if (sel.answer) {
          y += 32 * K;
          y = drawWrapped(ctx, letter.answer, textX, y, contentW, handFont, C_HAND, limitY);
        }
        if (sel.date) {
          // 底部右对齐（对应预览 .pc-date margin-top:auto）
          ctx.fillStyle = C_DATE;
          ctx.font = Math.round(22 * K) + 'px ' + FONT_UI_CANVAS;
          ctx.textAlign = 'right';
          ctx.fillText('—— 写于 ' + this.data.dateText, px + paperW - padSide, paperH - padBottom);
        }

        // ── 品牌区：火漆 Logo 环 + 品牌文案 + 小程序二维码占位 ──
        ctx.fillStyle = C_BRAND_BG;
        ctx.fillRect(0, EXPORT_H - brandH, EXPORT_W, brandH);
        const logoD = 30 * K;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 3 * K;
        ctx.beginPath();
        ctx.arc(32 * K + logoD / 2, EXPORT_H - brandH / 2, logoD / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = Math.round(20 * K) + 'px ' + FONT_UI_CANVAS;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('心灵信箱 · 把答案寄给未来', 32 * K + logoD + 14 * K, EXPORT_H - brandH / 2);
        // 二维码占位：白色圆角块 + 3×3 暗格（接入真实小程序码后替换）
        const qrS = 62 * K;
        const qrX = EXPORT_W - 24 * K - qrS;
        const qrY = EXPORT_H - brandH / 2 - qrS / 2;
        ctx.fillStyle = '#FFFFFF';
        roundRectPath(ctx, qrX, qrY, qrS, qrS, 8 * K);
        ctx.fill();
        ctx.fillStyle = C_QR_DARK;
        const cell = 14 * K;
        const gap = (qrS - 10 * K - cell * 3) / 2;
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            ctx.fillRect(qrX + 5 * K + c * (cell + gap), qrY + 5 * K + r * (cell + gap), cell, cell);
          }
        }
        ctx.restore();
        return canvas;
      });
  },

  loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = this._canvas.createImage();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  },

  canvasToFile(canvas) {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        fileType: 'png',
        destWidth: EXPORT_W,
        destHeight: EXPORT_H,
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

// 逐行换行绘制（超出行数上限时截断加省略号，返回新的 y）
function drawWrapped(ctx, text, x, y, maxWidth, font, color, limitY) {
  const str = String(text || '');
  if (!str) return y;
  ctx.font = font;
  ctx.fillStyle = color;
  const lineHeight = 48 * 1.85; // 48px 手写字号 × 行高 1.8（设计规范）
  const chars = str.split('');
  let line = '';
  let cursor = y;
  while (chars.length) {
    const ch = chars.shift();
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      if (cursor + lineHeight > limitY) {
        // 已到内容区底部：本行放不下即截断
        line = line.slice(0, -1) + '…';
        cursor += lineHeight;
        break;
      }
      ctx.fillText(line, x, cursor + 48);
      cursor += lineHeight;
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) {
    ctx.fillText(line, x, cursor + 48);
    cursor += lineHeight;
  }
  return cursor;
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
