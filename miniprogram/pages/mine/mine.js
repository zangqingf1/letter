const letterService = require('../../services/letter.js');
const userService = require('../../services/user.js');
const memberService = require('../../services/member.js');
const { DATA_SOURCE } = require('../../config/env.js');

// 2×2 便签固定微倾角（-1.5° ~ +1.5°，手作错落感，对应线框图四张便签）
const NOTE_TILTS = [-1.2, 1.5, 0.8, -1.0];

// 四张便签的名称/单位/取值口径。名称与倾角在首帧就立住版面，数值到位后原地替换，
// 避免「先空一屏 → 四个数字冒出来」的二次位移。
const NOTE_META = [
  { key: 'letterTotal', name: '信件总数', unit: '封' },
  { key: 'rereadTotal', name: '被重读总次数', unit: '次' },
  { key: 'replyTotal', name: '回信条数', unit: '条' },
  { key: 'registerDays', name: '注册天数', unit: '天' }
];

// stats 为 null 时渲染占位横杠（骨架态）
function notesOf(stats) {
  return NOTE_META.map((m, i) => ({
    name: m.name,
    unit: m.unit,
    value: stats ? stats[m.key] : '—',
    tilt: NOTE_TILTS[i]
  }));
}

Page({
  data: {
    statusBarHeight: 20,
    profileReady: false,
    statsReady: false,
    user: { nickname: '', avatar: '', wroteDays: '' },
    avatarChar: '',
    notes: notesOf(null),
    pinnedCount: 0,
    recycleCount: 0
  },

  onLoad() {
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });
    // 首次加载交给 onShow（onLoad 后必然触发 onShow，这里再拉一次会重复请求）
  },

  onShow() {
    // 首帧先渲染本会话已备好的缓存（app 启动预热或上次进入时写入），再在后台强制刷新：
    // 进入「我的」不再等云函数往返；只有冷启动且预热尚未完成时才短暂显示骨架。
    const cachedProfile = userService.cachedProfile();
    const cachedStats = userService.cachedStats();
    if (cachedProfile) this.applyProfile(cachedProfile);
    if (cachedStats) this.applyStats(cachedStats);
    this.refresh();

    // 会员中心入口就在本页：本会话还没有服务端会员态时顺手预热一次（非 force，命中 TTL 即复用），
    // 这样点进会员中心首帧就能直接画对状态卡，而不是停在骨架等一次云函数往返。
    // 缓存里已有值（含过期的旧值）就不打这一枪 —— 会员页自己会 force 回源校正。
    if (DATA_SOURCE === 'cloud' && !memberService.cachedMembership()) {
      memberService.getMembership().catch(() => {});
    }

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

  // 名片与四项统计经 user 服务获取（PRD 第八节、第十节）。
  // 两个请求各自独立回填：名片（头像/昵称）先到先显示，不被统计聚合拖住整屏
  refresh() {
    userService
      .getProfile({ force: true })
      .then((user) => this.applyProfile(user))
      .catch((err) => {
        console.error('[mine] 资料读取失败', err);
        // 失败也要收掉骨架：否则一直停在占位态，看起来像卡死
        this.setData({ profileReady: true });
      });
    userService
      .getStats({ force: true })
      .then((stats) => this.applyStats(stats))
      .catch((err) => {
        console.error('[mine] 统计读取失败', err);
        this.setData({ statsReady: true });
      });
  },

  applyProfile(user) {
    this.setData({
      user,
      avatarChar: (user.nickname || '友')[0],
      profileReady: true
    });
  },

  // local 态四项仍是演示值，回形针/废纸篓数保留页面上实时计算的值
  applyStats(stats) {
    this.setData({
      notes: notesOf(stats),
      // 云模式：直接采用 stats 聚合返回的实时数量（本地为演示值 0，由 onShow 实时计算覆盖）
      pinnedCount: DATA_SOURCE === 'cloud' ? stats.pinnedCount || 0 : this.data.pinnedCount,
      recycleCount: DATA_SOURCE === 'cloud' ? stats.recycleCount || 0 : this.data.recycleCount,
      statsReady: true
    });
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

  onTapFeedback() {
    // 问题反馈：自建反馈页（文字 + 多图截图），云端落 feedback 集合
    wx.navigateTo({ url: '/pages/feedback/feedback' });
  },

  onTapMember() {
    // 会员中心（真实虚拟支付 · 个人道具直购）
    wx.navigateTo({ url: '/pages/member/member' });
  }
});
