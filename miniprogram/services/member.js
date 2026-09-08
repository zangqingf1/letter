// 会员服务（2026-09 会员中心接入真实虚拟支付：个人 · 道具直购）
// getMembership：云端读 member 云函数（members 集合）；云函数未部署或未配置（OfferID/AppKey
//   缺失返回 ok:false）时回落本地演示态。subscribe：云端走 member.subscribe 下单 →
//   wx.requestVirtualPayment 拉起支付；未配置 xpay 或本地模式回落演示开通（不产生扣款）。
// 约定与其它 service 一致：页面不直读 storage 键。
const { DATA_SOURCE } = require('../config/env.js');
const cloud = require('./cloud.js');
const { MOCK_MEMBER } = require('../pages/member/mock.js');

// 仅演示：开通一次后本地保持 vip 态，用于预览（真实支付落地后仅作为未配置/本地模式兜底）
const STATE_KEY = 'member_demo_state';
// 演示开通时记录到期时间戳，用于计算「会员剩余天数」
const EXPIRE_KEY = 'member_demo_expire_at';

// 各档位演示有效期天数（真实支付到期时间由云端 members.expires_at 驱动）
const PLAN_DAYS = { month: 30, quarter: 90, year: 365 };
const DAY_MS = 86400000;

// iOS 需微信客户端 ≥ 8.0.68（虚拟支付官方要求）；非 iOS 直接放行
function checkIosVersion() {
  const sys = wx.getSystemInfoSync();
  if (sys.platform !== 'ios') return true;
  const cur = String(sys.version || '').split('.').map(Number);
  const base = [8, 0, 68];
  for (let i = 0; i < 3; i++) {
    if ((cur[i] || 0) > base[i]) return true;
    if ((cur[i] || 0) < base[i]) {
      wx.showModal({ title: '提示', content: '请将微信更新至最新版后再进行支付', showCancel: false });
      return false;
    }
  }
  return true;
}

function getMembership() {
  // 云端：读 member 云函数（members 集合，与后台 memberGrant 同源）。
  // 回落优先级：member 函数未部署/未配置（get 失败），或本机留有演示开通标记
  // （subscribe 曾回落演示态）→ 读本地 member_demo_state，保证演示预览与页面不因配置缺失打挂。
  if (DATA_SOURCE === 'cloud') {
    return cloud
      .call('member', 'get', {})
      .then((r) => {
        const m = normalize(r && r.membership);
        if (m.state === 'vip') return m;
        // 云端未开通，但本机有演示开通标记（未配置期 subscribe 回落）→ 沿用演示 vip
        if (wx.getStorageSync(STATE_KEY) === 'vip') return demoMembership();
        return m;
      })
      .catch(() => demoMembership());
  }
  return Promise.resolve(demoMembership());
}

// 本地/回落演示态：读 member_demo_state 演示标记（仅未配置或本地模式生效）
function demoMembership() {
  const saved = wx.getStorageSync(STATE_KEY);
  const expiresAt = wx.getStorageSync(EXPIRE_KEY);
  const expired = !!(expiresAt && expiresAt <= Date.now());
  const state = saved === 'vip' && !expired ? 'vip' : MOCK_MEMBER.state;
  // vip 且有到期时间 → 计算剩余天数；vip 但无到期时间（早期演示数据）给年内兜底
  let remainingDays = 0;
  if (state === 'vip') {
    remainingDays = expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / DAY_MS)) : 365;
  }
  return normalize({ state, level: MOCK_MEMBER.level, renew: MOCK_MEMBER.renew, remainingDays });
}

function normalize(r) {
  return {
    state: (r && r.state) === 'vip' ? 'vip' : 'free',
    level: (r && r.level) || MOCK_MEMBER.level,
    renew: !!(r && r.renew) || MOCK_MEMBER.renew,
    expireDate: (r && r.expireDate) || '',
    planName: (r && r.planName) || '',
    remainingDays: typeof r.remainingDays === 'number' ? Math.max(0, r.remainingDays) : 0
  };
}

// 订阅（真实支付）：返回 Promise。
// 云端：member.subscribe 下单得 payData → wx.requestVirtualPayment 拉起支付。
// 仅「未配置/未部署」场景回落演示开通（不产生扣款）：member 函数未部署、或返回
// xpay/plan not configured、或旧版本无 subscribe action。其余错误（网络/签名等）原样抛出，
// 由页面提示，避免支付流程中静默翻成演示 vip。
function subscribe(plan) {
  if (DATA_SOURCE === 'cloud') {
    return wxLogin()
      .then((code) => cloud.call('member', 'subscribe', { plan, code }))
      .then((r) => {
        if (!r || !r.payData) throw new Error('payData missing');
        return requestVirtualPayment(r.payData);
      })
      .catch((err) => {
        if (err && err._payment) throw err;
        if (isUnconfiguredError(err)) return demoSubscribe(plan);
        throw err;
      });
  }
  return demoSubscribe(plan);
}

// 仅当错误表明「支付能力未就绪」（未部署/未配置/旧版本）时才回落演示开通
function isUnconfiguredError(err) {
  const msg = String((err && err.message) || (err && err.errMsg) || '');
  return (
    msg.indexOf('not configured') !== -1 ||
    msg.indexOf('unknown action') !== -1 ||
    msg.indexOf('FunctionName') !== -1 ||
    msg.indexOf('function not found') !== -1 ||
    msg.indexOf('-501000') !== -1
  );
}

// wx.login 取 code（云端下单时换取 sessionKey 计算 signature）
function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => (res && res.code ? resolve(res.code) : reject(new Error('wx.login failed'))),
      fail: () => reject(new Error('wx.login failed'))
    });
  });
}

// 拉起微信虚拟支付（道具直购 short_series_goods）
function requestVirtualPayment(payData) {
  if (!wx.requestVirtualPayment) {
    const e = new Error('当前微信版本不支持虚拟支付');
    e._payment = true;
    return Promise.reject(e);
  }
  return new Promise((resolve, reject) => {
    wx.requestVirtualPayment({
      ...payData,
      success: () => resolve(),
      fail: (err) => {
        const msg = String((err && err.errMsg) || (err && err.message) || '');
        const e = new Error(msg);
        // 透传错误码，便于页面/日志定位（-2 用户取消、-15005 signature 错误、-15006 paySig 错误、
        // -15010 道具未发布、-15013 道具价格与后台不一致、-15014 发布未生效等）
        e.errCode = (err && (err.errCode || err.errno)) || '';
        if (msg.indexOf('cancel') !== -1 || e.errCode === -2) e.cancel = true;
        e._payment = true; // 标记为「支付阶段」错误：subscribe 不做演示兜底，抛给页面提示
        reject(e);
      }
    });
  });
}

// 纯 UI 演示开通：仅落本地演示标记（不真实扣款）。仅未配置/本地模式兜底用。
// 叠加语义与云端 deliverGoods 对齐：base = max(现在, 当前到期时间)，再往后加天数，
// 避免 VIP 期内再次开通时把剩余时长清零。
function demoSubscribe(plan) {
  const days = PLAN_DAYS[plan] || 30;
  const now = Date.now();
  const saved = wx.getStorageSync(EXPIRE_KEY);
  const base = saved && saved > now ? saved : now;
  wx.setStorageSync(STATE_KEY, 'vip');
  wx.setStorageSync(EXPIRE_KEY, base + days * DAY_MS);
  return Promise.resolve({ ok: true, plan: plan || '', demo: true });
}

// 注销时清除会员演示标记（避免重新注册后仍是 vip 演示态），供 user 服务 URL 清单复用
function resetDemo() {
  wx.removeStorageSync(STATE_KEY);
  wx.removeStorageSync(EXPIRE_KEY);
}

module.exports = { getMembership, subscribe, checkIosVersion, resetDemo, STATE_KEY };