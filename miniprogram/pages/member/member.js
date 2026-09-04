// 11 · 会员中心：会员状态卡 + 权益清单 + 专属主题/版式锁定 + 订阅方案半屏拉手。
// 接入真实虚拟支付（个人·道具直购）：subscribe 云端下单 → wx.requestVirtualPayment 拉起支付 →
// 支付成功后轮询会员状态翻成 vip（发货由 member 云函数收发货推送完成）。页面一切数据经 member 服务读取。
const memberService = require('../../services/member.js');
const themeService = require('../../services/theme.js');
const userService = require('../../services/user.js');
const { buildView } = require('../write/paper-view.js');
const PREMIUM = require('./premium.js');

// 权益清单（type: 'papers'|'themes'|'cap' 用于按会员态标注已解锁/未解锁）
const BENEFITS = [
  { icon: '📜', title: '专属信纸版式', desc: '解锁会员专享信纸款', type: 'papers' },
  { icon: '📮', title: '专属主题信封', desc: '解锁会员专享主题信封', type: 'themes' },
  { icon: '📦', title: '专属内容全解锁', desc: '会员专属版式与主题全部可用', type: 'cap' }
];

// 支付失败错误码 → 用户可读提示（错误码见 wx.requestVirtualPayment 官方文档）
const PAY_ERROR_HINTS = {
  '-15002': '订单号已使用，请重试',
  '-15005': '签名校验失败，请检查 OfferID/AppKey',
  '-15006': '签名校验失败，请检查 OfferID/AppKey',
  '-15007': '登录态已过期，请重新登录后再试',
  '-15008': '商户进件未完成，暂不可支付',
  '-15010': '道具未发布，请检查后台道具管理',
  '-15013': '道具价格与后台不一致，请检查道具管理',
  '-15014': '道具刚调整，约 10 分钟后生效',
  '-15016': '支付参数错误，请联系开发者',
  '-15017': '收款功能受限，暂不可支付'
};

// 订阅档位（一次性月卡/季卡/年卡；价格须与 MP 后台「道具管理」发布道具一致）
const PLANS = [
  { id: 'month', name: '月卡', price: 1, unit: '¥', period: '/30 天', tag: '30 天有效期' },
  { id: 'quarter', name: '季卡', price: 25.9, unit: '¥', period: '/90 天', tag: '90 天有效期' },
  { id: 'year', name: '年卡', price: 99.9, unit: '¥', period: '/365 天', tag: '最划算 · 约合 8.3 元/月' }
];

Page({
  data: {
    statusBarHeight: 20,
    user: { nickname: '', avatar: '' },
    avatarChar: '',
    state: 'free',            // free / vip
    level: '守候',
    renew: false,
    remainingDays: 0,         // 会员剩余天数（云端按 members.expires_at 计算）
    benefits: BENEFITS,
    plans: PLANS,
    selectedPlan: 'year',
    payText: '',
    agreed: false,
    premiumPapers: PREMIUM.papers,
    premiumThemes: PREMIUM.themes,
    handwritingOff: false,       // 示例信纸无障碍字体（与写信/详情同口径）
    showPaperPreview: false,     // 专属信纸真实样式示例预览
    previewPaper: null,
    previewView: null,
    previewDesk: '#EDE9DC',      // 示例预览区桌面底色
    showSheet: false,          // 订阅半屏拉手
    showSuccess: false,        // 开通成功完成幕
    paying: false              // 支付请求在途（防重复拉起）
  },

  onLoad() {
    const win = wx.getWindowInfo();
    this.setData({
      statusBarHeight: win.statusBarHeight || 20,
      handwritingOff: wx.getStorageSync('handwriting_off') === true
    });
    this.loadMembership();
    this.loadPremiumItems();
  },

  // 每次显示同步用户资料（初次进入与从账号管理页返回改名/换头像后即时刷新）
  onShow() {
    this.loadProfile();
  },

  // 顶部用户资料（与「我的」页名片同源：user 服务 getProfile）
  loadProfile() {
    return userService
      .getProfile()
      .then((user) => {
        this.setData({
          user,
          avatarChar: (user.nickname || '友')[0]
        });
      })
      .catch((err) => console.error('[member] 用户资料读取失败', err));
  },

  // 专属版式/主题：与写信页同源（theme 服务下发，含 member_items 专属款 premium 标记），
  // 后台增删改的专属款在此即时展示（force 强刷，绕过 1h 缓存）；空则回落本地 premium.js。
  loadPremiumItems() {
    Promise.all([themeService.getThemes(true), themeService.getPapers(true)])
      .then(([themes, papers]) => {
        const update = {};
        const premiumPapers = (papers || []).filter((p) => p.premium);
        const premiumThemes = (themes || []).filter((t) => t.premium);
        if (premiumPapers.length) update.premiumPapers = premiumPapers;
        if (premiumThemes.length) update.premiumThemes = premiumThemes;
        if (Object.keys(update).length) this.setData(update);
      })
      .catch((err) => console.error('[member] 专属内容读取失败', err));
  },

  onUnload() {
    clearTimeout(this._pollTimer);
  },

  loadMembership(silent) {
    return memberService
      .getMembership()
      .then((m) => {
        this.setData({
          state: m.state,
          level: m.level,
          renew: m.renew,
          remainingDays: m.remainingDays,
          benefits: this.decorateBenefits(m.state)
        });
      })
      .catch((err) => {
        if (!silent) console.error('[member] 会员状态读取失败', err);
      });
  },

  // 按会员态给权益标注「已解锁 / 未解锁」，信封上限文案随态切换
  decorateBenefits(state) {
    const isVip = state === 'vip';
    return BENEFITS.map((b) => {
      const unlocked = isVip;
      let desc = b.desc;
      if (b.type === 'cap') desc = isVip ? '已解锁全部专属版式与主题' : '开通后解锁全部专属版式与主题';
      return Object.assign({}, b, { unlocked, desc });
    });
  },

  // 打开订阅拉手（未开通态任意「开通/专属卡片」触发；iOS 需微信 ≥ 8.0.68）
  openSheet() {
    if (!memberService.checkIosVersion()) return;
    const plan = this.data.plans.find((p) => p.id === this.data.selectedPlan) || this.data.plans[0];
    this.setData({ showSheet: true, payText: '确认支付 ' + plan.unit + plan.price });
  },

  closeSheet() {
    this.setData({ showSheet: false });
  },

  noop() {
    // 点击拉手背景/内容时阻止冒泡到关闭层
  },

  onSelectPlan(e) {
    const id = e.currentTarget.dataset.id;
    const plan = this.data.plans.find((p) => p.id === id) || this.data.plans[0];
    this.setData({ selectedPlan: id, payText: '确认支付 ' + plan.unit + plan.price });
  },

  // 专属信纸卡片点按：弹出真实版式模板渲染的示例信纸（VIP/非 VIP 都可预览样式）
  onTapPaper(e) {
    const index = Number(e.currentTarget.dataset.index);
    const paper = this.data.premiumPapers[index];
    if (!paper) return;
    const previewView = buildView({
      name: '写给未来的我',
      question: '那时的我，还会记得今天的心愿吗？',
      answer: '会的。答案就安静地躺在信里，等未来的你拆开重读。'
    });
    this.setData({ previewPaper: paper, previewView, previewDesk: '#EDE9DC', showPaperPreview: true });
  },
  onClosePaperPreview() {
    this.setData({ showPaperPreview: false });
  },
  // 示例预览底部按钮：vip 提示可在写信页使用；free 引导开通
  onUnlockFromPreview() {
    if (this.data.state === 'vip') {
      wx.showToast({ title: '写信第二步可选这款版式', icon: 'none' });
      return;
    }
    this.closeSheet();
    this.openSheet();
  },

  // 专属主题卡片点按：vip 态已解锁给反馈；free 态弹订阅拉手
  onTapTheme() {
    if (this.data.state === 'vip') {
      wx.showToast({ title: '已解锁，写信时可在主题里用', icon: 'none' });
      return;
    }
    this.openSheet();
  },

  onToggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  // 当前所选方案（普通方法，避免 Page 对象上 getter 不可靠）
  currentPlan() {
    return this.data.plans.find((p) => p.id === this.data.selectedPlan) || this.data.plans[0];
  },

  // 确认支付：云端真实下单 → wx.requestVirtualPayment 拉起支付 → 成功后轮询会员状态翻成 vip。
  // 未配置 xpay 或本地演示态时，member 服务自动回落演示开通（不产生扣款）。
  onConfirmPay() {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先勾选《会员服务协议》', icon: 'none' });
      return;
    }
    if (this.data.paying) return;
    this.setData({ paying: true });
    const plan = this.currentPlan();
    memberService
      .subscribe(plan.id)
      .then(() => {
        // 支付成功：发货由 member 云函数收发货推送完成（异步），此处轮询会员状态确认翻亮
        this.closeSheet();
        this.pollMembership();
      })
      .catch((err) => {
        const errCode = err && (err.errCode || err.errno);
        const hint = PAY_ERROR_HINTS[String(errCode)];
        console.error('[member] 支付失败', err && (err.message || err.errMsg), 'errCode=', errCode);
        wx.showToast({
          title: err && err.cancel ? '已取消支付' : hint || '支付未完成，请重试',
          icon: 'none',
          duration: hint ? 2500 : 1500
        });
        this.setData({ paying: false });
      });
  },

  // 支付成功后轮询会员状态（发货推送异步，最多约 15 秒）；翻成 vip 弹完成幕，超时提示稍后生效
  pollMembership() {
    let tries = 0;
    const step = () => {
      this._pollTimer = setTimeout(() => {
        tries += 1;
        const done = () => {
          if (this.data.state === 'vip') {
            this.setData({ showSuccess: true, paying: false });
            return;
          }
          if (tries < 10) step();
          else {
            this.setData({ paying: false });
            wx.showToast({ title: '已支付成功，权益稍后生效', icon: 'none' });
          }
        };
        this.loadMembership(true).then(done, done);
      }, 1500);
    };
    step();
  },

  // 点击任意处跳过完成幕（与寄出完成幕一致交互）
  onSkipSuccess() {
    this.setData({ showSuccess: false });
  },

  onTapBack() {
    wx.navigateBack();
  },

  onTapAccount() {
    wx.navigateTo({ url: '/pages/account/account' });
  }
});
