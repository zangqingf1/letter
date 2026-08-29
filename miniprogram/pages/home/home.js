const letterService = require('../../services/letter.js');
const draftService = require('../../services/draft.js');
const themeService = require('../../services/theme.js');

// 今日来信（local 态）：同一天固定同一封（按日期种子确定性随机，次日重摇）；
// 云端态由 today 云函数按「用户+日期」确定并返回 todayId（BR-07，见架构文档 §5.2）
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

// 信件日期文案：按创建时间补出「N月N日」（信件数据由 letter 服务提供）
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

  // 信匣数据经 letter 服务获取（真实寄出的信排最前，演示数据按 DEMO_STATE 接入）；
  // 草稿横条按真实草稿显示（云端 today 聚合返回 draftCount，本地读 draft 服务）
  loadMailbox(arrivingId) {
    Promise.all([letterService.getAll(), themeService.getThemes(), draftService.get()]).then(
      ([box, themes, draft]) => {
        // 回形针优先展示（BR-06）：只改排序，不改视觉
        const sorted = [...box.list].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
        const isTidy = sorted.length >= 7;
        const now = new Date();

        const letters = applyTilt(sorted, isTidy).map((l) => ({
          ...l,
          dateText: dateTextOf(l),
          env: themeService.envelopeOf(l.theme_id, themes),
          // 刚寄出的信：落格动效（淡入 + 10px 落定）
          arriving: arrivingId && l.id === arrivingId
        }));

        // 云端已确定今日来信（BR-07 同日固定）时直接命中，否则本地按日期种子随机
        const todayLetter = box.todayId
          ? letters.find((l) => l.id === box.todayId) || pickTodayLetter(letters)
          : pickTodayLetter(letters);

        this.setData({
          letters,
          draftCount: Math.max(box.draftCount || 0, draft ? 1 : 0),
          hasLetters: letters.length > 0,
          isTidy,
          todayLetter,
          todayStamp: letters.length ? pad2(now.getMonth() + 1) + '.' + pad2(now.getDate()) : '',
          todayYear: letters.length ? String(now.getFullYear()) : ''
        });
      })
      .catch((err) => {
        // 信匣加载失败不再静默空白：报错留痕 + 温和提示（文案语气见设计规范）
        console.error('[home] 信匣加载失败', err);
        wx.showToast({ title: '信匣暂时没有打开，稍后再来试试', icon: 'none' });
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
    // 草稿横条：回写信第一步继续写（write 页自动恢复草稿内容，PRD 5.3）
    wx.navigateTo({ url: '/pages/write/write' });
  },

  onTapWrite() {
    // 跳转写信第一步「写下这封信」
    wx.navigateTo({ url: '/pages/write/write' });
  }
});
