// 会员中心·虚拟支付配置（虚拟支付：个人 · 道具直购）
// 开通条件见微信官方文档：/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person.html
//
// 密钥一律只读云函数环境变量（XPAY_OFFER_ID / XPAY_APP_KEY），不落仓库、不设代码内兜底值：
// 历史版本曾在此硬编码 AppKey 并被提交进 git，须视为已泄露并在 MP 后台轮换。
// AppSecret（XPAY_APP_SECRET）由 index.js 读取（code2Session 需 HTTPS 直调，不支持云调用），不落本文件。
//
// 道具（goodsPrice 单位「分」，须与 MP 后台「道具管理」已发布道具的单价完全一致）：
//   月卡/季卡/年卡 各一个 productId，在 MP 后台创建并发布后填入下表（productId 须与后台一致）。
// 套餐有效期按天数落地 members.expires_at（31/93/366）。

// 现网道具映射：plan → { productId, priceFen }
// productId 与 MP 后台「虚拟支付 → 道具管理」创建并发布的道具 ID 完全一致；
// 道具价格（元）→ priceFen（分）：9.9 / 25.9 / 89.9。
const PRODUCTS = {
  month: { productId: 'vip_month', priceFen: 990 },
  quarter: { productId: 'vip_quarter', priceFen: 2590 },
  year: { productId: 'vip_year', priceFen: 8990 }
};

// 各档位会员有效期天数（与前端 member 页 PLANS 对齐）
const PLAN_DAYS = { month: 31, quarter: 93, year: 366 };

// 新用户体验会员天数（2026-09-20 起）：从未有过 members 记录的用户首次读会员态时，
// 由 get 惰性发放一份限时体验会员（trial:true 标记），全部专属款在体验期内可用。
// 发放判定只认「members 集合无记录」——曾开通过（哪怕已过期）的用户不补发。
const TRIAL_DAYS = 3;

// OfferID / AppKey 只从云函数环境变量读取：未配置时 configured() 为 false，
// 下单接口直接返回 'xpay not configured'，绝不回落任何仓库内密钥。
const OFFER_ID = process.env.XPAY_OFFER_ID || '';
const APP_KEY = process.env.XPAY_APP_KEY || '';

// 已配置（OfferID + AppKey + 该档位道具）才允许真实支付
function configured() {
  return !!(OFFER_ID && APP_KEY);
}

function planConfigured(plan) {
  const p = PRODUCTS[plan];
  return !!p && !!p.productId;
}

module.exports = { PRODUCTS, PLAN_DAYS, TRIAL_DAYS, OFFER_ID, APP_KEY, configured, planConfigured };