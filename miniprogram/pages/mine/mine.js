const { MOCK_USER, MOCK_STATS, MOCK_RECYCLE_COUNT } = require('./mock.js');
const { MOCK_LETTERS, DEMO_STATE } = require('../home/mock.js');

// 2×2 便签固定微倾角（-1.5° ~ +1.5°，手作错落感，对应线框图四张便签）
const NOTE_TILTS = [-1.2, 1.5, 0.8, -1.0];

Page({
  data: {
    statusBarHeight: 20,
    user: MOCK_USER,
    avatarChar: '',
    notes: [],
    pinnedCount: 0,
    recycleCount: MOCK_RECYCLE_COUNT
  },

  onLoad() {
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });
    this.loadProfile();
  },

  onShow() {
    // 从账号管理页返回时刷新名片（头像/昵称可能已在 account_profile 更新）
    this.loadProfile();
    // 回形针数量随详情页点亮/取下实时刷新（与回形针优先展示页同源统计）
    this.setData({ pinnedCount: this.countPinned() });
    // 废纸篓数量随删除/取回实时刷新（优先读 recycle_mock，无数据时用演示值）
    const recycle = wx.getStorageSync('recycle_mock') || [];
    this.setData({ recycleCount: recycle.length || MOCK_RECYCLE_COUNT });
  },

  // 回形针优先展示数量：与 pages/clips 同口径（letters_mock + 演示数据中的 pinned 信）
  countPinned() {
    const sent = wx.getStorageSync('letters_mock') || [];
    let demo = [];
    if (DEMO_STATE === 'few') {
      demo = MOCK_LETTERS.slice(0, 4);
    } else if (DEMO_STATE !== 'empty') {
      demo = MOCK_LETTERS;
    }
    return sent.concat(demo).filter((l) => l.pinned).length;
  },

  // TODO: 接入云端数据后替换 mock（User / 统计口径见 PRD 第八节、第十节）
  loadProfile() {
    const notes = [
      { name: '信件总数', value: MOCK_STATS.letterTotal, unit: '封' },
      { name: '被重读总次数', value: MOCK_STATS.rereadTotal, unit: '次' },
      { name: '回信条数', value: MOCK_STATS.replyTotal, unit: '条' },
      { name: '注册天数', value: MOCK_STATS.registerDays, unit: '天' }
    ].map((n, i) => ({ ...n, tilt: NOTE_TILTS[i] }));

    // 账号管理页保存的头像/昵称优先（account_profile），未设置过回落演示数据
    const saved = wx.getStorageSync('account_profile');
    const user = {
      ...MOCK_USER,
      nickname: (saved && saved.nickname) || MOCK_USER.nickname,
      avatar: (saved && saved.avatar) || ''
    };

    this.setData({
      user,
      avatarChar: (user.nickname || '友')[0],
      notes
    });
  },

  onTapPaperclip() {
    // 跳转回形针优先展示列表（BR-06：点亮回形针的信前置排列）
    wx.navigateTo({ url: '/pages/clips/clips' });
  },

  onTapRecycle() {
    // 跳转废纸篓（30 天保留，左滑取回 / 彻底删除需二次确认）
    wx.navigateTo({ url: '/pages/recycle/recycle' });
  },

  onTapAccount() {
    wx.navigateTo({ url: '/pages/account/account' });
  },

  onTapAgreement() {
    // TODO: 用户协议页
    wx.showToast({ title: '用户协议开发中', icon: 'none' });
  },

  onTapPrivacy() {
    // TODO: 隐私政策页
    wx.showToast({ title: '隐私政策开发中', icon: 'none' });
  },

  onTapAbout() {
    // TODO: 关于心灵信箱（品牌文案：心灵信箱 · 把答案寄给未来）
    wx.showToast({ title: '关于页开发中', icon: 'none' });
  }
});
