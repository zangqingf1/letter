// 05 · 废纸篓
// 状态：有内容态（普通弃置 / 临近 3 天删除强调 / 左滑取回与彻底删除）/ 空状态。
// 数据经 letter 服务读取（演示数据由服务在首次查看时落成真实数据，操作真实生效）；
// 满 30 天自动清理（BR-11/BR-12）。

const letterService = require('../../services/letter.js');
const themeService = require('../../services/theme.js');
const memberService = require('../../services/member.js');
const analytics = require('../../services/analytics.js');

// 埋点统一走 analytics 服务（事件名见 PRD 第十三节）
function track(event, data) {
  analytics.track(event, data);
}

const DAY = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 30; // 废纸篓保留期（BR-11）
const WARN_DAYS = 3;  // 临近删除强调态阈值
const OPEN_WIDTH = 148; // 左滑露出操作区宽度（px，对应 296rpx）

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    items: [],
    hasItems: false,
    openIndex: -1,
    dragging: false
  },

  onLoad() {
    this._seq = 0; // onShow 会重入（取回/彻底删除后刷新），用它丢弃过期响应
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });
  },

  onShow() {
    // 取回 / 彻底删除后需刷新，放 onShow
    this.loadItems();
  },

  // 读取废纸篓（经 letter 服务，满 30 天自动清理 BR-11）
  // 信封刻意不依赖任何云调用：主题取同步缓存（无缓存时 envelopeThumbOf 回落本地默认款），
  // 会员态取进程内缓存（无值先按非 VIP —— isVip 只影响专属主题的信封素材，等会员态回来再校正）。
  // 旧版把主题与会员态 Promise.all 进关键路径，冷容器时整行信封要等两个云函数拉起，慢 1~3s。
  loadItems() {
    const seq = ++this._seq;
    const themes = themeService.cachedThemes();
    const cachedMember = memberService.cachedMembership();
    const isVip = !!(cachedMember && cachedMember.state === 'vip');

    letterService
      .listRecycle()
      .then((res) => {
        if (seq !== this._seq) return; // 期间又刷新过，丢弃这次结果
        const list = res.items || [];
        const now = Date.now();
        const items = list
          .slice()
          .sort((a, b) => b.deleted_at - a.deleted_at)
          .map((it) => {
            const daysLeft = Math.max(1, Math.ceil((it.deleted_at + KEEP_DAYS * DAY - now) / DAY));
            const warn = daysLeft <= WARN_DAYS;
            return {
              id: it.id,
              name: it.name,
              theme_id: it.theme_id, // 仅用于信封后台校正时重算，不进模板
              env: themeService.envelopeThumbOf(it.theme_id, themes, isVip),
              warn,
              daysText: warn ? '还有 ' + daysLeft + ' 天。再看看它，或者取回来。' : '还有 ' + daysLeft + ' 天将被处理',
              pill: daysLeft + ' 天',
              offset: 0
            };
          });

        this.setData({ loading: false, items, hasItems: items.length > 0, openIndex: -1, dragging: false });
        this.refreshEnvelopes(seq);
      })
      .catch((err) => {
        if (seq !== this._seq) return;
        console.error('[recycle] 废纸篓加载失败', err);
        this.setData({ loading: false });
        wx.showToast({ title: '废纸篓暂时打不开，稍后再来试试', icon: 'none' });
      });
  },

  // 后台校正信封：主题列表与会员态回源后重算，只对真正变化的行 setData
  // （后台改了信封素材、或 VIP 开通/过期导致专属款切换）；普通款前后一致，不产生第二次渲染
  refreshEnvelopes(seq) {
    Promise.all([themeService.getThemes(), memberService.getMembership()])
      .then(([themes, m]) => {
        if (seq !== this._seq) return;
        const isVip = !!(m && m.state === 'vip');
        const patch = {};
        this.data.items.forEach((it, i) => {
          const env = themeService.envelopeThumbOf(it.theme_id, themes, isVip);
          if (env && env !== it.env) patch['items[' + i + '].env'] = env;
        });
        if (Object.keys(patch).length) this.setData(patch);
      })
      .catch((err) => console.error('[recycle] 信封素材刷新失败', err));
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
    letterService
      .restoreFromRecycle(item.id)
      .then(() => {
        wx.showToast({ title: '信已取回信匣', icon: 'none' });
        // 等云端确认取回成功再刷新列表，否则读到旧数据、已取回的信仍显示在页面上
        this.loadItems();
      })
      .catch((err) => {
        console.error('[recycle] 取回失败', err);
        wx.showToast({ title: '信暂时取不回来，稍后再试试', icon: 'none' });
      });
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
        letterService
          .purgeFromRecycle(item.id)
          .then(() => this.loadItems())
          .catch((err) => {
            console.error('[recycle] 彻底删除失败', err);
            wx.showToast({ title: '暂时删不掉，稍后再试试', icon: 'none' });
          });
      }
    });
  }
});
