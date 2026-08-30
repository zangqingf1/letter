// 关于心灵信箱：静态品牌介绍页（长卷式图文，插画均为 WXSS 手绘，无数据依赖）
// 邮戳环形文字无法用 SVG（wxml 不支持），改为逐字旋转排布
const RING_TEXT = '心灵信箱 · FUTURE POST';

Page({
  data: {
    statusBarHeight: 20,
    logoOk: true,
    ringChars: []
  },

  onLoad() {
    const win = wx.getWindowInfo();
    // 环形文字沿上半圆 -70° ~ +70° 均匀排布
    const chars = [];
    const n = RING_TEXT.length;
    for (let i = 0; i < n; i++) {
      chars.push({
        c: RING_TEXT[i],
        a: Math.round((-70 + (140 / (n - 1)) * i) * 10) / 10
      });
    }
    this.setData({
      statusBarHeight: win.statusBarHeight || 20,
      ringChars: chars
    });
  },

  onTapBack() {
    wx.navigateBack();
  },

  onLogoError() {
    this.setData({ logoOk: false });
  }
});
