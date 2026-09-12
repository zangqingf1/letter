// 会员服务（2026-09 会员中心接入真实虚拟支付：个人 · 道具直购）
// getMembership：云端读 member 云函数（members 集合）为唯一事实来源，读取失败按未开通处理。
// subscribe：云端走 member.subscribe 下单 → wx.requestVirtualPayment 拉起支付；未配置支付时
//   明确报错（不产生扣款、不发本地会员）。演示态仅在本地模式（DATA_SOURCE !== 'cloud'）生效。
// 约定与其它 service 一致：页面不直读 storage 键。
const { DATA_SOURCE } = require('../config/env.js');
const cloud = require('./cloud.js');
const { MOCK_MEMBER } = require('../pages/member/mock.js');

// 仅演示（本地模式）：开通一次后本地保持 vip 态，用于预览；云端模式一律不读取此标记
const STATE_KEY = 'member_demo_state';
// 演示开通时记录到期时间戳，用于计算「会员剩余天数」
const EXPIRE_KEY = 'member_demo_expire_at';

// 各档位演示有效期天数（真实支付到期时间由云端 members.expires_at 驱动）
const PLAN_DAYS = { month: 30, quarter: 90, year: 365 };
const DAY_MS = 86400000;

// 进程内会员态缓存（仅内存，绝不落 storage）：首页/详情/回形针/废纸篓/写信第二步、
// 分享页都在进入时读会员态，每次都打一次 member 云函数（含 users 封禁校验 + members 查询）。
// 会员态变化极少，一次会话内用短 TTL 复用即可。
// 注意：不能像 theme_cache 那样写 storage —— 那等于把「本地可写标记」重新当作会员凭据，
// 会重开「不付款自封会员」的口子。内存变量在小程序 JS 沙箱内，用户无法通过 storage 伪造。
const MEM_TTL = 30 * 1000;
let memCache = null; // { at, value }

function clearCache() {
  memCache = null;
}

// 同步读会员态缓存（不发云调用、不落 storage）：会员中心进入首帧要立刻画对状态卡，
// 而 getMembership 是异步的。返回 null 表示本会话还没有服务端结果（页面停在骨架态）。
// 刻意不管 TTL：这里只当首帧占位值用，页面随后一律 force 回源校正（否则会一直吃旧值）；
// 且缓存只存在于进程内存，用户无法经 storage 伪造会员凭据。
function cachedMembership() {
  return memCache ? memCache.value : null;
}

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

// 未开通会员的干净状态（与 member 云函数 get 的 FREE 同形）
function freeMembership() {
  return { state: 'free', level: '', renew: false, expireDate: '', planName: '', remainingDays: 0 };
}

// force=true 绕过内存缓存强刷（会员中心页与支付后轮询使用）。
function getMembership(force) {
  // 云端：读 member 云函数（members 集合，与后台 memberGrant 同源）—— 服务端结果是唯一事实来源。
  // 安全口径：本地演示标记 member_demo_state 绝不允许覆盖或伪造服务端结果；读取失败也只回落
  // free（旧版会回落本地 vip，等于不付款就自封会员）。演示态只在本地模式下生效。
  if (DATA_SOURCE === 'cloud') {
    if (!force && memCache && Date.now() - memCache.at < MEM_TTL) {
      return Promise.resolve(memCache.value);
    }
    return cloud
      .call('member', 'get', {})
      .then((r) => {
        const m = normalize(r && r.membership);
        let value;
        if (m.state !== 'vip') {
          // 服务端明确 free：顺手清掉历史遗留的演示标记，避免其它入口又把它读回来
          resetDemo();
          value = freeMembership();
        } else {
          value = m;
        }
        memCache = { at: Date.now(), value };
        return value;
      })
      .catch((err) => {
        // 读取失败不写缓存：一次网络抖动不该让页面在 TTL 内一直按未开通处理
        console.error('[member] 会员状态读取失败，按未开通处理', err);
        return freeMembership();
      });
  }
  return Promise.resolve(demoMembership());
}

// 本地演示态（仅 DATA_SOURCE !== 'cloud' 生效）：读 member_demo_state 演示标记
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
// 未配置支付时明确报错（err.unconfigured），不再回落演示开通 —— 旧版会在云端模式下静默
// 写入本地 vip 标记，等于把「支付能力故障」变成「免费会员」。
function subscribe(plan) {
  if (DATA_SOURCE === 'cloud') {
    return wxLogin()
      .then((code) => cloud.call('member', 'subscribe', { plan, code }))
      .then((r) => {
        if (!r || !r.payData) throw new Error('payData missing');
        return requestVirtualPayment(r.payData);
      })
      .then((v) => {
        // 支付已成功：清掉内存里的旧会员态，否则支付后的轮询会被 30s 缓存挡住而翻不亮
        clearCache();
        return v;
      })
      .catch((err) => {
        if (err && err._payment) throw err;
        if (isUnconfiguredError(err)) {
          const e = new Error('虚拟支付未配置');
          e.unconfigured = true;
          throw e;
        }
        throw err;
      });
  }
  return demoSubscribe(plan);
}

// 仅认服务端「明确的未配置」信号（member.subscribe 的 'xpay not configured'、
// code2Session 的 'app secret not configured'）。旧版把 'FunctionName'、'-501000'、
// 'unknown action' 等泛化云调用错误也当作未配置并静默开通，会把一次故障变成免费会员，已收窄。
function isUnconfiguredError(err) {
  const msg = String((err && err.message) || (err && err.errMsg) || '');
  return msg.indexOf('not configured') !== -1;
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

// 纯 UI 演示开通：仅落本地演示标记（不真实扣款）。仅本地模式（DATA_SOURCE !== 'cloud'）使用。
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

// 注销时清除会员演示标记（避免重新注册后仍是 vip 演示态），供 user 服务 URL 清单复用。
// 同时丢弃内存缓存，避免注销后同一会话内仍读到上一个账号的会员态。
function resetDemo() {
  clearCache();
  wx.removeStorageSync(STATE_KEY);
  wx.removeStorageSync(EXPIRE_KEY);
}

module.exports = {
  getMembership,
  cachedMembership,
  subscribe,
  checkIosVersion,
  resetDemo,
  invalidate: clearCache,
  STATE_KEY
};