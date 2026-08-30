// 03 · 信件详情 / 拆信阅读 / 回信
// 状态：多次拆开（邮戳墙 + 多条回信 + 回形针点亮）/ 首次拆开（1 枚邮戳 0 回信）/ 回信半屏弹层。
// 进入即播放拆信动画（≤1.2s 可点击跳过），并按 BR-09 自动产生一条重读记录。

const letterService = require('../../services/letter.js');
const themeService = require('../../services/theme.js');
const analytics = require('../../services/analytics.js');
// data 初始默认主题；实际主题在 loadLetter 中按信件 theme_id 经 theme 服务解析
const THEMES = require('../write/themes.js');
// data 初始默认信纸版式；实际版式在 loadLetter 中按信件 paper_id 经 theme 服务解析
const PAPERS = require('../write/papers.js');

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

Page({
  data: {
    statusBarHeight: 20,
    handwritingOff: false, // 无障碍开关：关闭手写体（全局设置）
    letter: { name: '', question: '', answer: '' },
    theme: THEMES[0],
    themeName: THEMES[0].name,
    paper: PAPERS[0],
    dateText: '',
    editedText: '',
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
    replyText: '',
    todayLongText: '',
    keyboardHeight: 0,
    noteToast: false
  },

  onLoad(options) {
    const win = wx.getWindowInfo();
    this.setData({
      statusBarHeight: win.statusBarHeight || 20,
      // TODO: 我的页提供开关入口，统一读写该存储键
      handwritingOff: wx.getStorageSync('handwriting_off') === true
    });

    this.loadLetter(options && options.id);

    // 拆信动画播完自动进入阅读态（点击任意处可跳过）
    this.openTimer = setTimeout(() => {
      this.setData({ opening: false });
    }, 1300);
  },

  onUnload() {
    if (this.openTimer) clearTimeout(this.openTimer);
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
  // isRefresh：从编辑/分享返回后的内容刷新，不重复上报拆信埋点（BR-09 今日记录本就幂等）
  loadLetter(id, isRefresh) {
    Promise.all([letterService.get(id), themeService.getThemes(), themeService.getPapers()]).then(([res, themes, papers]) => {
      const letter = res.letter;
      this.isDemo = res.isDemo;

      const theme = themes.find((t) => t.id === letter.theme_id) || themes[0];
      // 信纸版式解析（未知/缺失 paper_id 回落素笺，老信件视觉零跳变）
      const paper = themeService.paperOf(letter.paper_id, papers);
      const today = new Date();

      // BR-09：拆信一次即产生一条重读记录（仅日期，用户不可编辑/删除；同日不重复，
      // 服务内部去重并落库），返回全量邮戳时间戳供邮戳墙渲染
      letterService.recordOpen(letter).then((opens) => {
        letter.opens = opens || [];
        const created = new Date(letter.created_at);
        const dateText = (created.getMonth() + 1) + '月' + created.getDate() + '日';
        let editedText = '';
        if (letter.updated_at && !sameDay(letter.updated_at, letter.created_at)) {
          const u = new Date(letter.updated_at);
          editedText = (u.getMonth() + 1) + '月' + u.getDate() + '日';
        }

        if (!isRefresh) track('letter_open', { letter_id: letter.id });

        // 一次 setData 带齐主信、邮戳墙与回信流（原生层只通信一次）
        this.setData({
          letter,
          theme,
          themeName: theme.name,
          paper,
          dateText,
          editedText,
          pinned: !!letter.pinned,
          openStampText: pad2(today.getMonth() + 1) + '.' + pad2(today.getDate()),
          todayLongText: today.getFullYear() + '年' + (today.getMonth() + 1) + '月' + today.getDate() + '日',
          ...this.buildRecords(letter.opens),
          ...this.buildReplies(letter.replies || [])
        });
      })
      .catch((err) => console.error('[detail] 重读记录上报失败', err));
    })
    .catch((err) => {
      console.error('[detail] 信件读取失败', err);
      wx.showToast({ title: '这封信暂时取不出来，稍后再来试试', icon: 'none' });
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
        label: isToday ? '今天' : ''
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
      .map((r) => {
        const d = new Date(r.ts);
        return {
          ts: r.ts,
          dateText: d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()),
          text: r.text
        };
      });
    return { replyCount: list.length, replies: list };
  },

  // ── 拆信动画 ──
  onSkipOpen() {
    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
    this.setData({ opening: false });
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
  onOpenReply() {
    this.setData({ replyOpen: true, keyboardHeight: 0 });
  },

  onCloseReply() {
    this.setData({ replyOpen: false, replyText: '', keyboardHeight: 0 });
  },

  onReplyInput(e) {
    this.setData({ replyText: e.detail.value });
  },

  // 软键盘避让：弹层整体向上推升（抽屉 padding-bottom 抬到键盘上方）
  onKeyboard(e) {
    this.setData({ keyboardHeight: (e.detail && e.detail.height) || 0 });
  },

  onKeyboardBlur() {
    this.setData({ keyboardHeight: 0 });
  },

  noop() {},

  onSaveReply() {
    const text = (this.data.replyText || '').trim();
    if (!text) {
      wx.showToast({ title: '写点什么再贴吧', icon: 'none' });
      return;
    }
    const letter = this.data.letter;
    // 回信经 letter 服务落库（BR-10：日期自动生成不可改），返回更新后的回信数组；
    // 失败保留输入内容并提示，不关闭弹层（用户可重试）
    letterService.addReply(letter, text).then((replies) => {
      track('reply_add', { letter_id: letter.id });

      // 一次 setData 带齐信件、回信流与弹层关闭态
      this.setData({
        letter,
        ...this.buildReplies(replies || []),
        replyOpen: false,
        replyText: '',
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
      url: '/pages/write/write?mode=edit&id=' + l.id,
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
    wx.navigateTo({ url: '/pages/share/share?id=' + this.data.letter.id });
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
