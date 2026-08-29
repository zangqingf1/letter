// 06 · 回形针优先展示列表 —— 「我的」页回形针数量行进入
// 展示所有别着回形针（优先展示）的信件：主题信封 + 金色回形针角标，轻触直达拆信/详情。
// 回形针的点亮/取下在详情页底部操作栏完成（BR-06），返回本页 onShow 自动刷新。

const letterService = require('../../services/letter.js');
const themeService = require('../../services/theme.js');

// 信件日期文案：按创建时间补出「N月N日」（信件数据由 letter 服务提供）
function dateTextOf(letter) {
  if (letter.dateText) return letter.dateText;
  const n = new Date(letter.created_at || Date.now());
  return (n.getMonth() + 1) + '月' + n.getDate() + '日';
}

Page({
  data: {
    statusBarHeight: 20,
    items: [],
    hasItems: false
  },

  onLoad() {
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });
  },

  onShow() {
    this.loadClips();
  },

  // 数据经 letter 服务获取（与首页信匣同源，仅筛回形针点亮信件 —— PRD 第十节、BR-06）
  loadClips() {
    Promise.all([letterService.getAll(), themeService.getThemes()]).then(([box, themes]) => {
      const items = box.list
        .filter((l) => l.pinned)
        .map((l, i) => ({
          id: l.id,
          name: l.name,
          dateText: dateTextOf(l),
          env: themeService.envelopeOf(l.theme_id, themes),
          // 纸条微倾错落（交替 ±0.5°，手作感）
          tilt: i % 2 === 0 ? -0.5 : 0.5
        }));

      this.setData({ items, hasItems: items.length > 0 });
    })
    .catch((err) => {
      console.error('[clips] 回形针列表加载失败', err);
      wx.showToast({ title: '纸条暂时取不出来，稍后再来试试', icon: 'none' });
    });
  },

  onTapRow(e) {
    // 跳转拆信/详情页（拆信会产生今日重读记录 BR-09，在详情页内自动记录）
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  onTapBack() {
    wx.navigateBack();
  }
});
