// 06 · 回形针优先展示列表 —— 「我的」页回形针数量行进入
// 展示所有别着回形针（优先展示）的信件：主题信封 + 金色回形针角标，轻触直达拆信/详情。
// 回形针的点亮/取下在详情页底部操作栏完成（BR-06），返回本页 onShow 自动刷新。

const THEMES = require('../write/themes.js');
const { MOCK_LETTERS, DEMO_STATE } = require('../home/mock.js');

// 信封图按信件主题取图（与首页同源）；素材未就绪的主题回落默认主题
function themeEnvelope(themeId) {
  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
  return theme.envelope || THEMES[0].envelope;
}

// 信件日期文案：写回的 letters_mock 只有 created_at，按创建时间补出「N月N日」
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

  // TODO: 接入云端数据后替换 mock（Letter.优先展示状态见 PRD 第十节、BR-06）
  loadClips() {
    // 与首页信匣同源合并：已寄出的信（letters_mock）在前，演示数据按 DEMO_STATE 接入
    const sent = wx.getStorageSync('letters_mock') || [];
    let letters = [];
    if (DEMO_STATE === 'empty') {
      letters = sent;
    } else if (DEMO_STATE === 'few') {
      letters = [...sent, ...MOCK_LETTERS.slice(0, 4)];
    } else {
      letters = [...sent, ...MOCK_LETTERS];
    }

    const items = letters
      .filter((l) => l.pinned)
      .map((l, i) => ({
        id: l.id,
        name: l.name,
        dateText: dateTextOf(l),
        env: themeEnvelope(l.theme_id),
        // 纸条微倾错落（交替 ±0.5°，手作感）
        tilt: i % 2 === 0 ? -0.5 : 0.5
      }));

    this.setData({ items, hasItems: items.length > 0 });
  },

  onTapRow(e) {
    // 跳转拆信/详情页（拆信会产生今日重读记录 BR-09，在详情页内自动记录）
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  onTapBack() {
    wx.navigateBack();
  }
});
