// 03 · 信件详情 / 拆信阅读 / 回信
// 状态：多次拆开（邮戳墙 + 多条回信 + 回形针点亮）/ 首次拆开（1 枚邮戳 0 回信）/ 回信半屏弹层。
// 进入即播放拆信动画（≤1.2s 可点击跳过），并按 BR-09 自动产生一条重读记录。

const THEMES = require('../write/themes.js');
const { DEMO_LETTERS, DEMO_STATE } = require('./mock.js');

// TODO: 接入真实埋点（事件名见 PRD 第十三节）
function track(event, data) {
  console.log('[track]', event, data || '');
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

  // 读取信件：优先 letters_mock 中真实寄出的信（按首页传入 id），否则用演示数据预览状态
  // isRefresh：从编辑/分享返回后的内容刷新，不重复上报拆信埋点（BR-09 今日记录本就幂等）
  loadLetter(id, isRefresh) {
    let letter = null;
    this.isDemo = true;
    if (id) {
      const letters = wx.getStorageSync('letters_mock') || [];
      const found = letters.find((l) => l.id === id);
      if (found) {
        letter = JSON.parse(JSON.stringify(found));
        this.isDemo = false;
      }
    }
    if (!letter) {
      letter = JSON.parse(JSON.stringify(DEMO_LETTERS[DEMO_STATE] || DEMO_LETTERS.multi));
    }

    const theme = THEMES.find((t) => t.id === letter.theme_id) || THEMES[0];
    const now = Date.now();

    // BR-09：拆信一次即产生一条重读记录（仅日期，用户不可编辑/删除；同日不重复）
    letter.opens = (letter.opens || []).slice();
    if (!letter.opens.some((ts) => sameDay(ts, now))) {
      letter.opens.push(now);
    }
    letter.opens.sort((a, b) => a - b);
    if (!this.isDemo) this.persistLetter(letter);

    const created = new Date(letter.created_at);
    const dateText = (created.getMonth() + 1) + '月' + created.getDate() + '日';
    let editedText = '';
    if (letter.updated_at && !sameDay(letter.updated_at, letter.created_at)) {
      const u = new Date(letter.updated_at);
      editedText = (u.getMonth() + 1) + '月' + u.getDate() + '日';
    }
    const today = new Date();

    if (!isRefresh) track('letter_open', { letter_id: letter.id });

    this.setData({
      letter,
      theme,
      themeName: theme.name,
      dateText,
      editedText,
      pinned: !!letter.pinned,
      openStampText: pad2(today.getMonth() + 1) + '.' + pad2(today.getDate()),
      todayLongText: today.getFullYear() + '年' + (today.getMonth() + 1) + '月' + today.getDate() + '日'
    });
    this.setData(this.buildRecords(letter.opens));
    this.setData(this.buildReplies(letter.replies || []));
  },

  // 邮戳列表：收起时展示最早 5 枚 + 今天一枚，其余收进「+N 展开」
  buildRecords(opens) {
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
    if (!this.data.stampsExpanded && all.length > SHOW_STAMPS) {
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
    this.setData({ stampsExpanded: !this.data.stampsExpanded });
    this.setData(this.buildRecords(this.data.letter.opens));
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
    letter.replies = (letter.replies || []).concat([{ ts: Date.now(), text }]);
    if (!this.isDemo) this.persistLetter(letter);
    track('reply_add', { letter_id: letter.id });

    this.setData({ letter });
    this.setData(this.buildReplies(letter.replies));
    this.setData({ replyOpen: false, replyText: '', keyboardHeight: 0, noteToast: true });
    // 便签样式轻反馈（PRD 固定文案），2 秒后淡出
    setTimeout(() => this.setData({ noteToast: false }), 2000);
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
          createdAt: l.created_at
        });
      }
    });
  },

  onTogglePin() {
    const letter = this.data.letter;
    letter.pinned = !this.data.pinned;
    if (!this.isDemo) this.persistLetter(letter);
    this.setData({ letter, pinned: letter.pinned });
  },

  onTapShare() {
    // 进入分享明信片预览页（重读记录与回信永不入图 BR-15，在分享页内保证）
    wx.navigateTo({ url: '/pages/share/share?id=' + this.data.letter.id });
  },

  onTapDelete() {
    wx.showModal({
      title: '把这封信放进废纸篓？',
      content: '30 天后它会离开，这期间随时可以取回来。',
      confirmText: '放进废纸篓',
      cancelText: '再想想',
      confirmColor: '#6B8E85',
      success: (res) => {
        if (!res.confirm) return;
        track('letter_delete', { letter_id: this.data.letter.id });
        if (!this.isDemo) {
          const letters = wx.getStorageSync('letters_mock') || [];
          wx.setStorageSync('letters_mock', letters.filter((l) => l.id !== this.data.letter.id));
          // 废纸篓 30 天保留：重读记录与回信随信件原样保留（BR-11）
          const recycle = wx.getStorageSync('recycle_mock') || [];
          recycle.push(Object.assign({}, this.data.letter, { deleted_at: Date.now() }));
          wx.setStorageSync('recycle_mock', recycle);
        }
        wx.navigateBack();
      }
    });
  },

  // 把演示页的修改同步回本地演示存储（重读记录 / 回信 / 回形针）
  persistLetter(letter) {
    const letters = wx.getStorageSync('letters_mock') || [];
    const index = letters.findIndex((l) => l.id === letter.id);
    if (index > -1) {
      letters[index] = letter;
      wx.setStorageSync('letters_mock', letters);
    }
  }
});
