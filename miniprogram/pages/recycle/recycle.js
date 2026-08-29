// 05 · 废纸篓
// 状态：有内容态（普通弃置 / 临近 3 天删除强调 / 左滑取回与彻底删除）/ 空状态。
// 数据来源：详情页删除写入的 recycle_mock（信件原样保留，恢复时原样放回 letters_mock）；
// 为空时按 mock.js 的 DEMO_STATE 演示。满 30 天自动清理（BR-11/BR-12）。

const { DEMO_ITEMS, DEMO_STATE } = require('./mock.js');
const THEMES = require('../write/themes.js');

// 信封图按信件主题取图（与首页/详情页同源）；素材未就绪的主题回落默认主题（当前小王子）
function themeEnvelope(themeId) {
  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
  return theme.envelope || THEMES[0].envelope;
}

// TODO: 接入真实埋点（事件名见 PRD 第十三节）
function track(event, data) {
  console.log('[track]', event, data || '');
}

const DAY = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 30; // 废纸篓保留期（BR-11）
const WARN_DAYS = 3;  // 临近删除强调态阈值
const OPEN_WIDTH = 148; // 左滑露出操作区宽度（px，对应 296rpx）

Page({
  data: {
    statusBarHeight: 20,
    items: [],
    hasItems: false,
    openIndex: -1,
    dragging: false
  },

  onLoad() {
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });
  },

  onShow() {
    // 取回 / 彻底删除后需刷新，放 onShow
    this.loadItems();
  },

  // 读取废纸篓：优先 recycle_mock 真实数据，否则用演示数据预览状态
  loadItems() {
    let list = wx.getStorageSync('recycle_mock') || [];
    this.isDemo = false;
    if (!list.length && DEMO_STATE === 'full') {
      list = JSON.parse(JSON.stringify(DEMO_ITEMS));
      this.isDemo = true;
    }

    // 满 30 天自动永久删除（BR-11），不可恢复
    const now = Date.now();
    const alive = list.filter((it) => it.deleted_at && now - it.deleted_at < KEEP_DAYS * DAY);
    if (!this.isDemo && alive.length !== list.length) {
      wx.setStorageSync('recycle_mock', alive);
    }

    const items = alive
      .sort((a, b) => b.deleted_at - a.deleted_at)
      .map((it) => {
        const daysLeft = Math.max(1, Math.ceil((it.deleted_at + KEEP_DAYS * DAY - now) / DAY));
        const warn = daysLeft <= WARN_DAYS;
        return {
          id: it.id,
          name: it.name,
          env: themeEnvelope(it.theme_id),
          warn,
          daysText: warn ? '还有 ' + daysLeft + ' 天。再看看它，或者取回来。' : '还有 ' + daysLeft + ' 天将被处理',
          pill: daysLeft + ' 天',
          offset: 0
        };
      });

    this.setData({ items, hasItems: items.length > 0, openIndex: -1, dragging: false });
  },

  onTapBack() {
    wx.navigateBack();
  },

  // ── 左滑手势：跟手拖动，松手按过半吸附展开/收起，同时只保留一行展开 ──
  onRowTouchStart(e) {
    this.idx = e.currentTarget.dataset.index;
    this.startX = e.touches[0].clientX;
    this.startY = e.touches[0].clientY;
    this.baseOffset = this.data.items[this.idx].offset;
    this.horizontal = null;
    this.setData({ dragging: true });
  },

  onRowTouchMove(e) {
    if (this.horizontal === false) return;
    const dx = e.touches[0].clientX - this.startX;
    const dy = e.touches[0].clientY - this.startY;
    if (this.horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      this.horizontal = Math.abs(dx) > Math.abs(dy);
      if (!this.horizontal) return;
    }
    let offset = this.baseOffset + dx;
    offset = Math.max(-OPEN_WIDTH, Math.min(0, offset));
    this.setData({ ['items[' + this.idx + '].offset']: Math.round(offset) });
  },

  onRowTouchEnd() {
    const item = this.data.items[this.idx];
    if (!item) return;
    const open = item.offset < -OPEN_WIDTH / 2;
    const items = this.data.items.map((it, i) => ({
      ...it,
      offset: i === this.idx && open ? -OPEN_WIDTH : 0
    }));
    this.setData({ items, openIndex: open ? this.idx : -1, dragging: false });
  },

  // 点击行：收起已展开的操作区（BR-11：期间可查看名称与恢复，不进入详情）
  onTapRow() {
    if (this.data.openIndex > -1) this.closeSwipe();
  },

  closeSwipe() {
    this.setData({
      items: this.data.items.map((it) => ({ ...it, offset: 0 })),
      openIndex: -1
    });
  },

  // ── 取回：信件原样恢复（含重读记录与回信），回到信匣 ──
  onRestore(e) {
    const item = this.data.items[e.currentTarget.dataset.index];
    if (!item) return;
    track('letter_restore', { letter_id: item.id });
    if (!this.isDemo) {
      const recycle = wx.getStorageSync('recycle_mock') || [];
      const restored = recycle.find((l) => l.id === item.id);
      wx.setStorageSync('recycle_mock', recycle.filter((l) => l.id !== item.id));
      if (restored) {
        const letters = wx.getStorageSync('letters_mock') || [];
        letters.push(restored);
        wx.setStorageSync('letters_mock', letters);
      }
    }
    wx.showToast({ title: '信已取回信匣', icon: 'none' });
    this.loadItems();
  },

  // ── 彻底删除：二次确认（PRD 固定文案），删除后不可恢复（BR-12） ──
  onPermanent(e) {
    const item = this.data.items[e.currentTarget.dataset.index];
    if (!item) return;
    wx.showModal({
      title: '🗑️ 彻底删除',
      content: '这封信将无法找回，确定吗？',
      confirmText: '彻底删除',
      cancelText: '再想想',
      confirmColor: '#6E7570',
      success: (res) => {
        if (!res.confirm) return;
        track('letter_permanent_delete', { letter_id: item.id });
        if (!this.isDemo) {
          const recycle = wx.getStorageSync('recycle_mock') || [];
          wx.setStorageSync('recycle_mock', recycle.filter((l) => l.id !== item.id));
        }
        this.loadItems();
      }
    });
  }
});
