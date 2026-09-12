// 03 · 信件详情 / 拆信阅读 / 回信
// 状态：多次拆开（邮戳墙 + 多条回信 + 回形针点亮）/ 首次拆开（1 枚邮戳 0 回信）/ 回信半屏弹层。
// 进入即播放拆信动画（≤1.2s 可点击跳过），并按 BR-09 自动产生一条重读记录。

const letterService = require('../../services/letter.js');
const themeService = require('../../services/theme.js');
const memberService = require('../../services/member.js');
const analytics = require('../../services/analytics.js');
// data 初始默认主题；实际主题在 loadLetter 中按信件 theme_id 经 theme 服务解析
const THEMES = require('../write/themes.js');
// data 初始默认信纸版式；实际版式在 loadLetter 中按信件 paper_id 经 theme 服务解析
const PAPERS = require('../write/papers.js');
// 信纸渲染数据（共享模板 paper.wxml 只认 view 字段，与写信预览/分享图同构）
const { buildView, longDate } = require('../write/paper-view.js');

// 埋点统一走 analytics 服务（事件名见 PRD 第十三节）
function track(event, data) {
  analytics.track(event, data);
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function sameDay(a, b) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

// 收起态邮戳展示上限（最早 5 枚 + 今天，其余收进「+N 展开」，对应低保真状态 2）
const SHOW_STAMPS = 6;
// 拆信动画时长；REVEAL_CAP_MS 是揭幕兜底 —— 数据迟迟不到也不让页面停在动画上
const OPEN_ANIM_MS = 1300;
const REVEAL_CAP_MS = 4000;

Page({
  data: {
    statusBarHeight: 20,
    letter: { name: '', question: '', answer: '' },
    theme: THEMES[0],
    paper: PAPERS[0],
    view: buildView({ name: '', question: '', answer: '' }, { created: new Date() }),
    openCount: 0,
    stamps: [],
    moreChip: null,
    stampsExpanded: false,
    replyCount: 0,
    replies: [],
    pinned: false,
    opening: true, // 拆信动画播放中
    openStampText: '',
    replyOpen: false,
    todayLongText: '',
    keyboardHeight: 0,
    noteToast: false
  },

  onLoad(options) {
    const win = wx.getWindowInfo();
    this.setData({
      statusBarHeight: win.statusBarHeight || 20
    });

    // 入口页带过来的主题/名称：让拆信动画首帧就画对这封信的信封与名字
    this.listenUnsealHint();

    this.loadLetter(options && options.id);

    // 揭幕 = 动画播完 且 数据就绪（见 revealIfReady）：数据晚于动画时停在拆信幕上，
    // 避免先露一张空白信纸；revealCap 兜住加载异常，不让页面永久停在动画
    this.openTimer = setTimeout(() => this.onAnimDone(), OPEN_ANIM_MS);
    this.revealCap = setTimeout(() => this.onDataReady(), REVEAL_CAP_MS);
  },

  onUnload() {
    if (this.openTimer) clearTimeout(this.openTimer);
    if (this.revealCap) clearTimeout(this.revealCap);
  },

  onShow() {
    // 首次显示由 onLoad 负责；此后（从编辑/分享返回）重读信件刷新内容
    if (!this._shownOnce) {
      this._shownOnce = true;
      return;
    }
    if (!this.isDemo && this.data.letter && this.data.letter.id) {
      this.loadLetter(this.data.letter.id, true);
    }
  },

  // 读取信件（经 letter 服务：真实寄出的信优先，否则演示数据预览态）并记录重读。
  // record: true → 云端在 letter.get 同一次调用内落重读记录并返回邮戳墙（BR-09，同日幂等），
  // 页面不再单独打一次 open 云函数：渲染路径上只有一轮云函数往返。
  // isRefresh：从编辑/分享返回后的内容刷新，不重复上报拆信埋点（BR-09 今日记录本就幂等）
  loadLetter(id, isRefresh) {
    Promise.all([
      letterService.get(id, { record: true }),
      themeService.getThemes(),
      themeService.getPapers(),
      memberService.getMembership()
    ]).then(([res, themes, papers, m]) => {
      const letter = res.letter;
      const isVip = !!(m && m.state === 'vip');
      this.isDemo = res.isDemo;

      // 非 VIP 时专属主题按默认主题渲染（会员过期后老信回退，开通后自动恢复）
      let theme = themes.find((t) => t.id === letter.theme_id) || themes[0];
      if (theme.premium && !isVip) theme = themes[0] || theme;
      // 信纸版式解析（未知/缺失 paper_id 回落列表第一套；非 VIP 专属版式同样回落默认）
      const paper = themeService.paperOf(letter.paper_id, papers, isVip);
      const today = new Date();
      const created = new Date(letter.created_at);
      // 落款长日期（三端同口径）：写于
      const dateText = longDate(created);
      // 信纸渲染数据（票面日期/编号/首字下沉等由此派生，与预览/分享一致）
      const view = buildView(letter, { created: created, dateText: dateText });

      if (!isRefresh) track('letter_open', { letter_id: letter.id });

      // 一次 setData 带齐主信、邮戳墙与回信流（原生层只通信一次）
      this.setData({
        letter,
        theme,
        paper,
        view,
        pinned: !!letter.pinned,
        openStampText: pad2(today.getMonth() + 1) + '.' + pad2(today.getDate()),
        todayLongText: today.getFullYear() + '年' + (today.getMonth() + 1) + '月' + today.getDate() + '日',
        ...this.buildRecords(letter.opens || []),
        ...this.buildReplies(letter.replies || [])
      });
      this.onDataReady();
    })
    .catch((err) => {
      console.error('[detail] 信件读取失败', err);
      wx.showToast({ title: '这封信暂时取不出来，稍后再来试试', icon: 'none' });
      // 失败也要揭幕：停在拆信幕上更像卡死（原因已由 Toast 说明）
      this.onDataReady();
    });
  },

  // 邮戳列表：收起时展示最早 5 枚 + 今天一枚，其余收进「+N 展开」
  // expanded：显式传入展开态（onToggleStamps 合并 setData 时 data 尚未更新，须传切换后的值）
  buildRecords(opens, expanded) {
    const stampsExpanded = expanded !== undefined ? expanded : this.data.stampsExpanded;
    const now = Date.now();
    const all = opens.map((ts) => {
      const d = new Date(ts);
      const isToday = sameDay(ts, now);
      return {
        ts,
        date: pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()),
        today: isToday,
        // 戳痕成行版式：每枚邮戳都带印文（旧戳「重读」、今日戳「今天」）
        label: isToday ? '今天' : '重读'
      };
    });
    let stamps = all;
    let moreChip = null;
    if (!stampsExpanded && all.length > SHOW_STAMPS) {
      const head = all.slice(0, SHOW_STAMPS - 1);
      const todayStamp = all[all.length - 1];
      stamps = todayStamp.today ? head.concat([todayStamp]) : all.slice(0, SHOW_STAMPS);
      moreChip = { count: all.length - stamps.length };
    }
    return { openCount: all.length, stamps, moreChip };
  },

  buildReplies(replies) {
    const list = replies
      .slice()
      .sort((a, b) => a.ts - b.ts)
      .map((r, i) => {
        const d = new Date(r.ts);
        return {
          ts: r.ts,
          dateText: d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()),
          // 戳痕成行版式：便签头部 mono 编目「R-01 · 06.18」
          no: 'R-' + pad2(i + 1),
          dateShort: pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()),
          text: r.text
        };
      });
    return { replyCount: list.length, replies: list };
  },

  // ── 拆信动画 / 揭幕 ──
  // 入口页（信匣 / 回形针列表）手里已有这封信的名称与主题，经事件通道带过来：
  // 拆信动画首帧就画对信封与名字，不必等云调用回来（emit 早于监听时由通道缓冲）
  listenUnsealHint() {
    const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (!ch || !ch.on) return;
    ch.on('letterHint', (d) => {
      // 真实数据已落地就不再覆盖：主题提示可能是会员专属款，会盖掉 loadLetter 里的非 VIP 回落
      if (!d || this._dataReady) return;
      const patch = {};
      const theme = themeService.cachedThemes().find((t) => t.id === d.theme_id);
      if (theme) patch.theme = theme;
      if (d.name) patch.letter = Object.assign({}, this.data.letter, { name: d.name });
      if (Object.keys(patch).length) this.setData(patch);
    });
  },

  // 动画播完 / 点击跳过：跳过只跳过动画，不跳过数据 —— 数据没到就揭幕等于先露一张白纸
  onAnimDone() {
    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
    this._animDone = true;
    this.revealIfReady();
  },

  // 数据就绪（拿到信件 / 读取失败 / 兜底超时）
  onDataReady() {
    if (this.revealCap) {
      clearTimeout(this.revealCap);
      this.revealCap = null;
    }
    this._dataReady = true;
    this.revealIfReady();
  },

  // 揭幕：动画与数据都就绪才撤下拆信幕
  revealIfReady() {
    if (this._revealed || !this._animDone || !this._dataReady) return;
    this._revealed = true;
    this.setData({ opening: false });
  },

  onSkipOpen() {
    this.onAnimDone();
  },

  onTapBack() {
    wx.navigateBack();
  },

  // ── 重读记录展开/收起 ──
  onToggleStamps() {
    const stampsExpanded = !this.data.stampsExpanded;
    // buildRecords 须按"切换后"的展开态计算，显式传入避免读到旧 data
    this.setData({
      stampsExpanded,
      ...this.buildRecords(this.data.letter.opens, stampsExpanded)
    });
  },

  // ── 回信弹层 ──
  // 输入内容不放 data：文本域自己持有，逐键 setData 会让每次按键都过一次渲染层
  // （本页很重：信纸模板 + 邮戳墙 + 便签流，低端机上表现为输入卡顿/丢字）。
  // 草稿存实例字段 _replyDraft，提交时读；弹层是 wx:if 挂载的，重开即空白文本域。
  onOpenReply() {
    this._replyDraft = '';
    this.setData({ replyOpen: true, keyboardHeight: 0 });
  },

  onCloseReply() {
    this._replyDraft = '';
    this.setData({ replyOpen: false, keyboardHeight: 0 });
  },

  onReplyInput(e) {
    this._replyDraft = e.detail.value;
  },

  // 软键盘避让：弹层整体向上推升（抽屉 padding-bottom 抬到键盘上方）。
  // keyboardheightchange 在键盘动画期间会连发多次，高度没变就不重复 setData
  onKeyboard(e) {
    const height = (e.detail && e.detail.height) || 0;
    if (height === this.data.keyboardHeight) return;
    this.setData({ keyboardHeight: height });
  },

  onKeyboardBlur() {
    this.setData({ keyboardHeight: 0 });
  },

  noop() {},

  onSaveReply() {
    const text = (this._replyDraft || '').trim();
    if (!text) {
      wx.showToast({ title: '写点什么再贴吧', icon: 'none' });
      return;
    }
    const letter = this.data.letter;
    // 先收键盘再发起写请求：贴上是网络操作（云函数首次调用含冷启动，可能到秒级），
    // 不让用户对着弹出的键盘干等；失败时弹层与文本域内容都原样留着，可直接重试
    if (wx.hideKeyboard) wx.hideKeyboard();
    // 回信经 letter 服务落库（BR-10：日期自动生成不可改），返回更新后的回信数组；
    // 失败保留输入内容并提示，不关闭弹层（用户可重试）
    letterService.addReply(letter, text).then((replies) => {
      track('reply_add', { letter_id: letter.id });
      this._replyDraft = '';

      // 一次 setData 带齐信件、回信流与弹层关闭态
      this.setData({
        letter,
        ...this.buildReplies(replies || []),
        replyOpen: false,
        keyboardHeight: 0,
        noteToast: true
      });
      // 便签样式轻反馈（PRD 固定文案），2 秒后淡出
      setTimeout(() => this.setData({ noteToast: false }), 2000);
    }).catch((err) => {
      console.error('[detail] 回信保存失败', err);
      wx.showToast({ title: '回信没有贴上，再试一次吧', icon: 'none' });
    });
  },

  // ── 撕掉回信（便签右上角入口：物理删除不进废纸篓，二次确认）──
  onTapReplyDelete(e) {
    const ts = Number(e.currentTarget.dataset.ts);
    wx.showModal({
      title: '撕掉这封回信？',
      content: '撕掉后这段回信就找不回来了。',
      confirmText: '撕掉',
      cancelText: '留下',
      confirmColor: '#6E7570',
      success: (res) => {
        if (!res.confirm) return;
        const letter = this.data.letter;
        // 按 ts 精确删除单条回信，经 letter 服务落库（演示信会先落成真实信）
        letterService.removeReply(letter, ts).then((replies) => {
          this.setData({
            letter,
            ...this.buildReplies(replies || [])
          });
          wx.showToast({ title: '回信已撕掉', icon: 'none' });
        }).catch((err) => {
          console.error('[detail] 回信删除失败', err);
          wx.showToast({ title: '回信没撕掉，再试一次吧', icon: 'none' });
        });
      }
    });
  },

  // ── 底部操作栏 ──
  onTapEdit() {
    // 编辑复用写信两步流程（预填内容，主按钮「保存修改并封存」，静默保留重读记录与回信 PRD 5.6）；
    // 经事件通道传入完整信件（演示数据不在 letters_mock 中也能预填）
    const l = this.data.letter;
    wx.navigateTo({
      url: '/pages/write/write?mode=edit&id=' + encodeURIComponent(l.id),
      success: (res) => {
        res.eventChannel.emit('letterData', {
          editMode: true,
          editId: l.id,
          name: l.name,
          question: l.question,
          answer: l.answer,
          themeId: l.theme_id,
          paperId: l.paper_id,
          createdAt: l.created_at
        });
      }
    });
  },

  onTogglePin() {
    const letter = this.data.letter;
    const next = !this.data.pinned;
    // 回形针只在详情页操作（BR-06），经 letter 服务落库（演示信会先落成真实信）
    letterService.setPinned(letter, next).then(() => {
      letter.pinned = next;
      this.setData({ letter, pinned: next });
    }).catch((err) => {
      console.error('[detail] 回形针操作失败', err);
      wx.showToast({ title: '回形针没别上，再试一次吧', icon: 'none' });
    });
  },

  onTapShare() {
    // 进入分享明信片预览页（重读记录与回信永不入图 BR-15，在分享页内保证）
    wx.navigateTo({ url: '/pages/share/share?id=' + encodeURIComponent(this.data.letter.id) });
  },

  onTapDelete() {
    wx.showModal({
      title: '把这封信放进废纸篓？',
      content: '30 天后它会离开，这期间随时可以取回来。',
      confirmText: '放纸篓',
      cancelText: '再想想',
      confirmColor: '#6B8E85',
      success: (res) => {
        if (!res.confirm) return;
        track('letter_delete', { letter_id: this.data.letter.id });
        // 废纸篓 30 天保留：重读记录与回信随信件原样保留（BR-11），经 letter 服务落库
        // 等云端确认后再返回，失败留在本页提示（旧数据无归属人时服务端会拒绝）
        letterService
          .moveToRecycle(this.data.letter)
          .then(() => wx.navigateBack())
          .catch((err) => {
            console.error('[detail] 删除失败', err);
            wx.showToast({ title: '这封信暂时删不掉，稍后再来试试', icon: 'none' });
          });
      }
    });
  }
});
