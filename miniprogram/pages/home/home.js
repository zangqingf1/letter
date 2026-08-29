const { MOCK_LETTERS, MOCK_DRAFT_COUNT, DEMO_STATE } = require('./mock.js');
const THEMES = require('../write/themes.js');

// 信封图按信件主题取图（theme_id → 主题信封素材）；素材未就绪的主题回落默认主题（当前小王子）
function themeEnvelope(themeId) {
  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
  return theme.envelope || THEMES[0].envelope;
}

// 今日来信：同一天固定同一封（按日期种子确定性随机，次日重摇）
function pickTodayLetter(letters) {
  if (!letters.length) return null;
  const now = new Date();
  const daySeed = now.getFullYear() * 366 + (now.getMonth() + 1) * 31 + now.getDate();
  return letters[daySeed % letters.length];
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

// <7 封时基于信件 ID 生成 ±2° 伪随机倾角；≥7 封收敛为整齐网格（倾角 0）。ID 兼容数字与字符串
function applyTilt(letters, isTidy) {
  if (isTidy) {
    return letters.map((l) => ({ ...l, tilt: 0 }));
  }
  return letters.map((l) => {
    const seed = typeof l.id === 'number' ? l.id : String(l.id).split('').reduce((s, c) => s + c.charCodeAt(0), 0);
    return { ...l, tilt: ((seed * 37) % 5) - 2 };
  });
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
    letters: [],
    todayLetter: null,
    todayStamp: '',
    todayYear: '',
    draftCount: 0,
    hasLetters: false,
    isTidy: false
  },

  onLoad() {
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });
    this.loadMailbox();
  },

  onShow() {
    // 寄出流程回传的"新信落格"标记：消费后对刚寄出的那封信播落定动效
    let arrivingId = '';
    const flag = wx.getStorageSync('letter_just_arrived');
    if (flag) {
      wx.removeStorageSync('letter_just_arrived');
      arrivingId = flag;
    }
    this.loadMailbox(arrivingId);
    if (arrivingId) {
      // 动效播完（约 500ms）移除到达标记，避免后续刷新重播
      setTimeout(() => {
        if (!this.data.letters.some((l) => l.arriving)) return;
        this.setData({
          letters: this.data.letters.map((l) => (l.arriving ? { ...l, arriving: false } : l))
        });
      }, 800);
    }
  },

  // TODO: 接入云端数据后替换 mock（ Letter / Draft 实体见 PRD 第十节）
  loadMailbox(arrivingId) {
    // 已寄出的信（写信流程写入 letters_mock）合并进网格，排最前（新信在上）
    const sent = (wx.getStorageSync('letters_mock') || []).map((l) => ({ ...l, dateText: dateTextOf(l) }));
    let letters = [];
    let draftCount = 0;
    if (DEMO_STATE === 'empty') {
      letters = sent;
    } else if (DEMO_STATE === 'few') {
      letters = [...sent, ...MOCK_LETTERS.slice(0, 4)];
    } else {
      letters = [...sent, ...MOCK_LETTERS];
      draftCount = MOCK_DRAFT_COUNT;
    }

    // 回形针优先展示（BR-06）：只改排序，不改视觉
    letters = [...letters].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    const isTidy = letters.length >= 7;
    const now = new Date();

    letters = applyTilt(letters, isTidy).map((l) => ({
      ...l,
      env: themeEnvelope(l.theme_id),
      // 刚寄出的信：落格动效（淡入 + 10px 落定）
      arriving: arrivingId && l.id === arrivingId
    }));

    this.setData({
      letters,
      draftCount,
      hasLetters: letters.length > 0,
      isTidy,
      todayLetter: pickTodayLetter(letters),
      todayStamp: letters.length ? pad2(now.getMonth() + 1) + '.' + pad2(now.getDate()) : '',
      todayYear: letters.length ? String(now.getFullYear()) : ''
    });
  },

  onTapTodayLetter() {
    if (!this.data.todayLetter) {
      this.onTapWrite();
      return;
    }
    // 今日来信直接进入拆信/详情页
    wx.navigateTo({ url: '/pages/detail/detail?id=' + this.data.todayLetter.id });
  },

  onTapLetter(e) {
    const id = e.currentTarget.dataset.id;
    // 跳转拆信/详情页（每次拆信产生一条重读记录 BR-09，在详情页内自动记录）
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  onTapDrafts() {
    // TODO: 跳转继续写信
    wx.showToast({ title: '继续写信开发中', icon: 'none' });
  },

  onTapWrite() {
    // 跳转写信第一步「写下这封信」
    wx.navigateTo({ url: '/pages/write/write' });
  }
});
