const letterService = require('../../services/letter.js');
const userService = require('../../services/user.js');
const { DATA_SOURCE } = require('../../config/env.js');

// 2×2 便签固定微倾角（-1.5° ~ +1.5°，手作错落感，对应线框图四张便签）
const NOTE_TILTS = [-1.2, 1.5, 0.8, -1.0];

Page({
  data: {
    statusBarHeight: 20,
    user: { nickname: '', avatar: '', wroteDays: '' },
    avatarChar: '',
    notes: [],
    pinnedCount: 0,
    recycleCount: 0
  },

  onLoad() {
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });
    this.loadProfile();
  },

  onShow() {
    // 从账号管理页返回时刷新名片（头像/昵称可能已更新）
    this.loadProfile();
    // 云模式：stats 聚合已返回 pinnedCount / recycleCount，不再重复拉全量信匣与废纸篓；
    // 本地模式：统计仍是演示值，回形针/废纸篓数量经 letter 服务实时计算
    if (DATA_SOURCE !== 'cloud') {
      // 回形针数量随详情页点亮/取下实时刷新（与回形针优先展示页同源统计）
      this.countPinned();
      // 废纸篓数量随删除/取回实时刷新（经 letter 服务读取）
      letterService
        .listRecycle()
        .then((res) => {
          this.setData({ recycleCount: res.items.length });
        })
        .catch((err) => console.error('[mine] 废纸篓数量读取失败', err));
    }
  },

  // 回形针优先展示数量：与 pages/clips 同口径（letter 服务同源合并后筛 pinned）
  countPinned() {
    return letterService
      .getAll()
      .then((box) => {
        this.setData({ pinnedCount: box.list.filter((l) => l.pinned).length });
      })
      .catch((err) => console.error('[mine] 回形针数量读取失败', err));
  },

  // 名片与四项统计经 user 服务获取（PRD 第八节、第十节）；local 态四项为演示值，
  // 回形针/废纸篓数用实时统计覆盖
  loadProfile() {
    Promise.all([
      userService.getStats(),
      userService.getProfile()
    ]).then(([stats, user]) => {
      const notes = [
        { name: '信件总数', value: stats.letterTotal, unit: '封' },
        { name: '被重读总次数', value: stats.rereadTotal, unit: '次' },
        { name: '回信条数', value: stats.replyTotal, unit: '条' },
        { name: '注册天数', value: stats.registerDays, unit: '天' }
      ].map((n, i) => ({ ...n, tilt: NOTE_TILTS[i] }));

      this.setData({
        user,
        avatarChar: (user.nickname || '友')[0],
        notes,
        // 云模式：直接采用 stats 聚合返回的实时数量（本地为演示值 0，由 onShow 实时计算覆盖）
        pinnedCount: DATA_SOURCE === 'cloud' ? stats.pinnedCount || 0 : this.data.pinnedCount,
        recycleCount: DATA_SOURCE === 'cloud' ? stats.recycleCount || 0 : this.data.recycleCount
      });
    })
    .catch((err) => console.error('[mine] 统计读取失败', err));
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

  onTapAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  },

  onTapMember() {
    // 会员中心（真实虚拟支付 · 个人道具直购）
    wx.navigateTo({ url: '/pages/member/member' });
  }
});
