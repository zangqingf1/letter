// 云函数 member —— 会员中心真实支付（虚拟支付：个人 · 道具直购）
// 两个入口合一：
//   1) event.Event 存在 → 云开发「消息推送」转发的虚拟支付回调（发货推送 xpay_goods_deliver_notify）
//   2) 否则按 event.action 分发（get 读会员状态 / subscribe 下单返回 payData）
// 签名算法（官方文档 §4.5）：
//   paySig     = HMAC-SHA256(appKey, 'requestVirtualPayment&' + signData)
//   signature  = HMAC-SHA256(sessionKey, signData)
//   其中 signData 为固定字段顺序的 JSON 字符串，须与传给 wx.requestVirtualPayment 的完全一致。
// 发货可靠性：以「发货推送」为主（平台自动重试，最多 15 次），以 wx_order_id 幂等去重。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const crypto = require('crypto');
const https = require('https');
const db = cloud.database({ throwOnNotFound: false });

const { PRODUCTS, PLAN_DAYS, OFFER_ID, APP_KEY, configured, planConfigured } = require('./config.js');

const DAY_MS = 86400000;
// 会员套餐中文名（与 admin 云函数 PLAN_NAMES 同口径，subscribe/发货写入 members.plan_name）
const PLAN_NAMES = { month: '月卡', quarter: '季卡', year: '年卡', custom: '自定义' };

// vip 等级称号：按累计会员天数分档（寄字 <30 / 守候 <180 / 长情 ≥180）；
// 老数据无 total_days 时按剩余天数兜底，与 mock 默认「守候」同口径
function levelOf(totalDays, remainingDays) {
  const days = typeof totalDays === 'number' && totalDays > 0 ? totalDays : remainingDays;
  if (days >= 180) return '长情';
  if (days >= 30) return '守候';
  return '寄字';
}

function hmacSha256(key, msg) {
  return crypto.createHmac('sha256', String(key)).update(String(msg)).digest('hex');
}

// code2Session：官方 auth.code2Session「不支持云调用」，cloud.openapi 会直接失败，
// 只能 HTTPS 直调 sns/jscode2session（需 AppID + AppSecret；AppSecret 走环境变量 XPAY_APP_SECRET）。
// 未配置 AppSecret 时抛 'app secret not configured'，由外层统一回落演示态（与 xpay not configured 同策略）。
function code2Session(jsCode, appid) {
  const secret = process.env.XPAY_APP_SECRET || '';
  if (!secret) return Promise.reject(new Error('app secret not configured'));
  return new Promise((resolve, reject) => {
    const url =
      'https://api.weixin.qq.com/sns/jscode2session?appid=' + encodeURIComponent(appid) +
      '&secret=' + encodeURIComponent(secret) +
      '&js_code=' + encodeURIComponent(jsCode) +
      '&grant_type=authorization_code';
    https
      .get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const r = JSON.parse(body);
            if (r.errcode && r.errcode !== 0) return reject(new Error('code2Session: ' + r.errcode + ' ' + (r.errmsg || '')));
            resolve(r);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

// 道具 productId 反查档位（发货推送按 GoodsInfo.ProductId 定位套餐）
function planByProductId(pid) {
  if (!pid) return '';
  for (const plan of Object.keys(PRODUCTS)) {
    if (PRODUCTS[plan].productId === pid) return plan;
  }
  return '';
}

async function findMembership(openid) {
  const res = await db.collection('members').where({ _openid: openid }).limit(1).get();
  return res.data[0] || null;
}

exports.main = async (event) => {
  // 虚拟支付消息推送回调（云开发「消息推送」→ 云函数模式，事件对象直接透传，无 action 字段）
  if (event && event.Event) {
    try {
      if (event.Event === 'xpay_goods_deliver_notify') {
        await deliverGoods(event);
      } else {
        console.log('[member] 未处理推送事件', event.Event);
      }
      // 统一应答成功（非 0 平台会按通知周期重试，最多 15 次）
      return { ErrCode: 0, ErrMsg: 'success' };
    } catch (e) {
      console.error('[member] 推送处理失败', e);
      return { ErrCode: 1, ErrMsg: e.message || 'internal error' };
    }
  }

  const { OPENID, APPID } = cloud.getWXContext();
  const action = event.action;

  try {
    switch (action) {
      // 读会员状态：members 集合（后台 memberGrant/发货推送共用这张表）
      case 'get': {
        const FREE = { state: 'free', level: '', planName: '', expireDate: '', remainingDays: 0, renew: false };
        const m = await findMembership(OPENID);
        if (!m || m.state !== 'vip') {
          return { ok: true, membership: FREE };
        }
        const exp = m.expires_at ? new Date(m.expires_at).getTime() : 0;
        if (exp <= Date.now()) {
          return { ok: true, membership: FREE };
        }
        const remainingDays = Math.ceil((exp - Date.now()) / DAY_MS);
        return {
          ok: true,
          membership: {
            state: 'vip',
            level: levelOf(m.total_days, remainingDays), // vip 等级称号：按累计会员天数分档（寄字/守候/长情）
            planName: m.plan_name || PLAN_NAMES[m.level] || '',
            expireDate: new Date(exp).toISOString(),
            remainingDays,
            renew: !!m.renew
          }
        };
      }

      // 下单：生成 outTradeNo + signData + paySig + signature，返回前端 wx.requestVirtualPayment 所需的 payData
      case 'subscribe': {
        if (!configured()) return { ok: false, error: 'xpay not configured' };
        const plan = event.plan;
        if (!planConfigured(plan)) return { ok: false, error: 'plan not configured: ' + plan };
        const jsCode = event.code;
        if (!jsCode) return { ok: false, error: 'code required' };
        // signature 需要用户态 sessionKey：前端 wx.login 传 code，此处 code2Session 换取。
        // 注意：auth.code2Session 官方不支持云调用，必须 HTTPS 直调（见 code2Session()）。
        const session = await code2Session(jsCode, APPID);
        if (!session || !session.session_key) return { ok: false, error: 'code2Session failed' };
        if (session.openid && session.openid !== OPENID) {
          return { ok: false, error: 'openid mismatch' };
        }

        const p = PRODUCTS[plan];
        const outTradeNo = 'T' + Date.now() + Math.floor(Math.random() * 100000); // 唯一业务单号，8–32 位
        // 字段顺序固定、直接序列化不格式化（参与签名，须与前端收到的 signData 完全一致）
        const signData = JSON.stringify({
          offerId: OFFER_ID,
          buyQuantity: 1,
          env: 0,
          currencyType: 'CNY',
          productId: p.productId,
          goodsPrice: p.priceFen,
          outTradeNo,
          attach: plan
        });
        const paySig = hmacSha256(APP_KEY, 'requestVirtualPayment&' + signData);
        const signature = hmacSha256(session.session_key, signData);

        // 落订单（待支付），发货推送回按 out_trade_no / wx_order_id 定位并置已发货
        await db.collection('member_orders').add({
          data: {
            _openid: OPENID,
            out_trade_no: outTradeNo,
            plan,
            product_id: p.productId,
            goods_price: p.priceFen,
            status: 'created',
            created_at: new Date()
          }
        });
        return {
          ok: true,
          payData: { signData, paySig, signature, mode: 'short_series_goods' }
        };
      }

      default:
        return { ok: false, error: 'unknown action: ' + action };
    }
  } catch (e) {
    console.error('[member] action 失败', action, e.message);
    return { ok: false, error: e.message };
  }
};

// ── 发货（xpay_goods_deliver_notify）──
// 幂等：同一订单（out_trade_no）重复通知只发一次货；以已置 status='delivered' 为准。
// 发货与订单置为已发货在同一事务内提交：任一步失败整体回滚并抛错（平台按非 0 ErrCode 重试），
// 避免「已发会员但未记订单」导致的重试双倍发放。事务内不支持 where 查询，先按 _id 单文档定位。
async function deliverGoods(ev) {
  const openid = ev.OpenId;
  const outTradeNo = ev.OutTradeNo;
  const wxOrderId = (ev.WeChatPayInfo && ev.WeChatPayInfo.MchOrderNo) || '';
  const productId = (ev.GoodsInfo && ev.GoodsInfo.ProductId) || '';
  const plan = planByProductId(productId);
  if (!plan) {
    throw new Error('[member] 发货：未知道具 productId=' + productId);
  }
  const paidPrice = (ev.GoodsInfo && ev.GoodsInfo.ActualPrice) || 0;
  if (paidPrice && paidPrice !== PRODUCTS[plan].priceFen) {
    throw new Error('[member] 发货：实付金额与道具价格不一致 productId=' + productId + ' paid=' + paidPrice + ' expect=' + PRODUCTS[plan].priceFen);
  }

  const orderRes = await db.collection('member_orders').where({ out_trade_no: outTradeNo }).limit(1).get();
  const orderId = orderRes.data[0] ? orderRes.data[0]._id : null;
  const memberRes = await db.collection('members').where({ _openid: openid }).limit(1).get();
  const memberId = memberRes.data[0] ? memberRes.data[0]._id : null;

  await db.runTransaction(async (transaction) => {
    const now = new Date();
    if (orderId) {
      const orderSnap = await transaction.collection('member_orders').doc(orderId).get();
      const order = orderSnap.data;
      if (order && order.status === 'delivered') return;
    }

    let member = null;
    if (memberId) {
      const memberSnap = await transaction.collection('members').doc(memberId).get();
      member = memberSnap.data;
    }

    const days = PLAN_DAYS[plan] || 30;
    let base = now.getTime();
    if (member && member.state === 'vip' && member.expires_at) {
      const t = new Date(member.expires_at).getTime();
      if (t > base) base = t;
    }
    const expiresAt = new Date(base + days * DAY_MS);

    const doc = {
      state: 'vip',
      level: plan,
      plan_name: PLAN_NAMES[plan] || '自定义',
      expires_at: expiresAt,
      renew: false,
      granted_at: now,
      granted_by: 'xpay',
      updated_at: now
    };
    if (memberId) {
      doc.total_days = ((member && member.total_days) || 0) + days;
      await transaction.collection('members').doc(memberId).update({ data: doc });
    } else {
      doc.total_days = days;
      await transaction.collection('members').add({ data: Object.assign({ _openid: openid }, doc) });
    }

    if (orderId) {
      await transaction.collection('member_orders').doc(orderId).update({
        data: { status: 'delivered', wx_order_id: wxOrderId, paid_at: now, delivered_at: now, updated_at: now }
      });
    } else {
      await transaction.collection('member_orders').add({
        data: {
          _openid: openid,
          out_trade_no: outTradeNo,
          wx_order_id: wxOrderId,
          plan,
          product_id: productId,
          goods_price: paidPrice,
          status: 'delivered',
          created_at: now,
          paid_at: now,
          delivered_at: now
        }
      });
    }
  });
  console.log('[member] 已发货 openid=', openid, 'outTradeNo=', outTradeNo, 'plan=', plan);
}