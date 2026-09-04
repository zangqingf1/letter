// 会员中心·虚拟支付配置（虚拟支付：个人 · 道具直购）
// 开通条件见微信官方文档：/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person.html
//
// 密钥优先级：云函数环境变量 XPAY_OFFER_ID / XPAY_APP_KEY 优先，其次读本文件 FALLBACK_*（随函数部署）。
// AppSecret（XPAY_APP_SECRET）由 index.js 读取（code2Session 需 HTTPS 直调，不支持云调用），不落本文件。
// 若仓库需要公开，请把 FALLBACK_* 的值移除或改为读取环境变量，避免支付密钥泄露。
//
// 道具（goodsPrice 单位「分」，须与 MP 后台「道具管理」已发布道具的单价完全一致）：
//   月卡/季卡/年卡 各一个 productId，在 MP 后台创建并发布后填入下表（productId 须与后台一致）。
// 套餐有效期按天数落地 members.expires_at（30/90/365）。

// 现网道具映射：plan → { productId, priceFen }
// productId 与 MP 后台「虚拟支付 → 道具管理」创建并发布的道具 ID 完全一致；
// 道具价格（元）→ priceFen（分）：1 / 25.9 / 99.9。
const PRODUCTS = {
  month: { productId: 'vip_month', priceFen: 100 },
  quarter: { productId: 'vip_quarter', priceFen: 2590 },
  year: { productId: 'vip_year', priceFen: 9990 }
};

// 各档位会员有效期天数（与前端 member 页 PLANS 对齐）
const PLAN_DAYS = { month: 30, quarter: 90, year: 365 };

// OfferID（2026-09 已开通虚拟支付）；AppKey 不再落仓库，仅走环境变量 XPAY_APP_KEY，
// 未配置时 configured() 为 false，前端回落演示态（不产生扣款）。
const FALLBACK_OFFER_ID = '1450634882';
const FALLBACK_APP_KEY = '';

const OFFER_ID = process.env.XPAY_OFFER_ID || FALLBACK_OFFER_ID;
const APP_KEY = process.env.XPAY_APP_KEY || FALLBACK_APP_KEY;

// 已配置（OfferID + AppKey + 该档位道具）才允许真实支付
function configured() {
  return !!(OFFER_ID && APP_KEY);
}

function planConfigured(plan) {
  const p = PRODUCTS[plan];
  return !!p && !!p.productId;
}

module.exports = { PRODUCTS, PLAN_DAYS, OFFER_ID, APP_KEY, configured, planConfigured };