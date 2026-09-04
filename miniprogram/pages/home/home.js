const letterService = require('../../services/letter.js');
const draftService = require('../../services/draft.js');
const themeService = require('../../services/theme.js');
const memberService = require('../../services/member.js');
const { DATA_SOURCE } = require('../../config/env.js');

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

// ≤8 封时基于信件 ID 生成 ±2° 伪随机倾角；超过 8 封收敛为整齐网格（倾角 0）。ID 兼容数字与字符串
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
    // 冷启动骨架：initialRenderingCache static 用初始 data 渲染首帧（骨架态），
    // 首次数据到达后切真实内容；此后 onShow 刷新不再回骨架
    loading: true,
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
    // 首次加载交给 onShow（onLoad 后必然触发 onShow，这里再拉一次会重复请求）
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
    // 云模式下 today 聚合接口已返回 draftCount，无需再单独调 draft 服务
    const tasks = [letterService.getAll(), themeService.getThemes(), memberService.getMembership()];
    if (DATA_SOURCE !== 'cloud') tasks.push(draftService.list());
    Promise.all(tasks).then(
      ([box, themes, m, drafts]) => {
        const isVip = !!(m && m.state === 'vip');
        // 回形针优先展示（BR-06）：只改排序，不改视觉
        const sorted = [...box.list].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
        const isTidy = sorted.length > 8;
        const now = new Date();

        // 只挑 WXML 渲染所需字段进 setData：question/answer 全文（单封可达数百字）
        // 不进渲染层，信匣网格每次 onShow 刷新的序列化体积与信件数量解耦
        const letters = applyTilt(sorted, isTidy).map((l) => ({
          id: l.id,
          name: l.name,
          dateText: dateTextOf(l),
          env: themeService.envelopeThumbOf(l.theme_id, themes, isVip),
          tilt: l.tilt,
          pinned: !!l.pinned,
          // 刚寄出的信：落格动效（淡入 + 10px 落定）
          arriving: !!(arrivingId && l.id === arrivingId)
        }));

        // 云端已确定今日来信（BR-07 同日固定）时直接命中，否则本地按日期种子随机
        const todayLetter = box.todayId
          ? letters.find((l) => l.id === box.todayId) || pickTodayLetter(letters)
          : pickTodayLetter(letters);

        this.setData({
          loading: false,
          letters,
          draftCount: Math.max(box.draftCount || 0, Array.isArray(drafts) ? drafts.length : 0),
          hasLetters: letters.length > 0,
          isTidy,
          todayLetter,
          todayStamp: letters.length ? pad2(now.getMonth() + 1) + '.' + pad2(now.getDate()) : '',
          todayYear: letters.length ? String(now.getFullYear()) : ''
        });
      })
      .catch((err) => {
        // 信匣加载失败不再静默空白：报错留痕 + 温和提示（文案语气见设计规范）；
        // 骨架同时撤下，避免失败后停在占位态
        console.error('[home] 信匣加载失败', err);
        this.setData({ loading: false });
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
    // 草稿横条：回写信第一步（write 页保持空白新信、不自动预填，未写完的草稿
    // 以卡片陈列在书写区下方，点击卡片才载入续写，PRD 5.3）
    wx.navigateTo({ url: '/pages/write/write' });
  },

  onTapWrite() {
    // 跳转写信第一步「写下这封信」
    wx.navigateTo({ url: '/pages/write/write' });
  }
});
