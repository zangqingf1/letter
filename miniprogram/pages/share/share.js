// 04 · 分享图 · 明信片预览页
// 勾选弹层暂未实现，四项内容（名称/问题/答案/创建时间）默认全选；
// 重读记录与回信永不进入分享图（BR-15），本页不渲染任何重读/回信数据。

const THEMES = require('../write/themes.js');
const { DEMO_LETTERS, DEMO_STATE } = require('../detail/mock.js');

// TODO: 接入真实埋点（事件名见 PRD 第十三节）
function track(event, data) {
  console.log('[track]', event, data || '');
}

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
    padSide: 0
  },

  onLoad(options) {
    const win = wx.getWindowInfo();
    this.setData({
      statusBarHeight: win.statusBarHeight || 20,
      handwritingOff: wx.getStorageSync('handwriting_off') === true
    });

    // 与详情页同源：优先 letters_mock 中真实寄出的信，否则用演示数据预览
    let letter = null;
    if (options && options.id) {
      const letters = wx.getStorageSync('letters_mock') || [];
      const found = letters.find((l) => l.id === options.id);
      if (found) letter = found;
    }
    if (!letter) letter = DEMO_LETTERS[DEMO_STATE] || DEMO_LETTERS.multi;

    const theme = THEMES.find((t) => t.id === letter.theme_id) || THEMES[0];
    const created = new Date(letter.created_at);
    this.setData({
      letter,
      theme,
      themeName: theme.name,
      dateText: created.getFullYear() + '年' + (created.getMonth() + 1) + '月' + created.getDate() + '日'
    });
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
      const brandH = Math.round(h * (88 / 840));
      const paperH = h - brandH;
      const paperW = Math.min(w, Math.round(paperH * (896 / 1200)));
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

  // TODO: 勾选弹层（状态一）待接入：四选勾选 + 🔒 重读记录与回信不会出现在分享图中 + 生成分享图
  // 接入后在此页底部唤起勾选抽屉，生成前允许重新勾选内容

  // TODO: 用 Canvas 按预览样式绘制 1080×1440 竖版明信片，导出临时文件后保存相册
  onSave() {
    track('share_image_save');
    wx.showToast({ title: '保存到相册开发中', icon: 'none' });
  },

  // TODO: 导出明信片图片后调用 wx.showShareImageMenu 发送给微信好友
  onSend() {
    track('share_send');
    wx.showToast({ title: '发送好友开发中', icon: 'none' });
  }
});
