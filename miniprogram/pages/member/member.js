// 11 · 会员中心 —— 纯 UI 展示：会员状态卡 + 权益清单 + 专属主题/版式锁定 + 订阅方案半屏拉手。
// 本期不接真实微信支付（subscribe 仅演示开通并落本地标记），页面一切数据经 member 服务读取。
const memberService = require('../../services/member.js');
const PREMIUM = require('./premium.js');

// 权益清单（type: 'papers'|'themes'|'cap' 用于按会员态标注已解锁/未解锁）
const BENEFITS = [
  { icon: '📜', title: '专属信纸版式', desc: '解锁会员专享信纸款', type: 'papers' },
  { icon: '📮', title: '专属主题信封', desc: '解锁会员专享主题信封', type: 'themes' },
  { icon: '📦', title: '信封添加上限', desc: '非会员最多 5 个，开通后不限', type: 'cap' }
];

// 订阅档位（本期为演示价，真实支付以微信支付为准）
const PLANS = [
  { id: 'month', name: '连续包月', price: 5, unit: '¥', period: '/月', tag: '随时可退' },
  { id: 'quarter', name: '连续包季', price: 12, unit: '¥', period: '/季', tag: '省 3 元' },
  { id: 'year', name: '连续包年', price: 50, unit: '¥', period: '/年', tag: '最划算 · 省 10 元' }
];

Page({
  data: {
    statusBarHeight: 20,
    state: 'free',            // free / vip
    level: '守候',
    renew: true,
    benefits: BENEFITS,
    plans: PLANS,
    selectedPlan: 'year',
    payText: '',
    agreed: false,
    premiumPapers: PREMIUM.papers,
    premiumThemes: PREMIUM.themes,
    showSheet: false,          // 订阅半屏拉手
    showSuccess: false         // 开通成功完成幕
  },

  onLoad() {
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });
    this.loadMembership();
  },

  loadMembership(silent) {
    return memberService
      .getMembership()
      .then((m) => {
        this.setData({
          state: m.state,
          level: m.level,
          renew: m.renew,
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
      if (b.type === 'cap') desc = isVip ? '信封数量不限' : '非会员最多 5 个，开通后不限';
      return Object.assign({}, b, { unlocked, desc });
    });
  },

  // 打开订阅拉手（未开通态任意「开通/专属卡片」触发）
  openSheet() {
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

  // 专属主题/版式卡片点按：vip 态已解锁给反馈；free 态弹订阅拉手
  onTapPremium() {
    if (this.data.state === 'vip') {
      wx.showToast({ title: '已解锁，写信时可在版式里用', icon: 'none' });
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

  // 确认支付：本期仅演示开通（不真实扣款），完成后翻成 vip 态并弹完成幕
  onConfirmPay() {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先勾选《会员服务协议》', icon: 'none' });
      return;
    }
    const plan = this.currentPlan();
    memberService
      .subscribe(plan.id)
      .then(() => {
        this.setData({ showSheet: false, showSuccess: true });
        this.loadMembership(true);
      })
      .catch((err) => {
        console.error('[member] 订阅失败', err);
        wx.showToast({ title: '开通没成功，再试一次', icon: 'none' });
      });
  },

  // 点击任意处跳过完成幕（与寄出完成幕一致交互）
  onSkipSuccess() {
    this.setData({ showSuccess: false });
  },

  onTapBack() {
    wx.navigateBack();
  }
});
