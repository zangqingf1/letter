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

// 发货推送来源白名单（云函数环境变量 XPAY_NOTIFY_SOURCE，逗号分隔）。
// 微信云开发把「平台消息推送」与「客户端 wx.cloud.callFunction」都送进同一个 main 入口，
// 且两边的 event 正文都能带 Event/OpenId/WeChatPayInfo 字段，仅凭正文无法区分 —— 这是
// 伪造发货的根因。客户端伪造整个正文即可给自己免费发货，因此**唯一有效的代码侧封堵**
// 就是拒绝非平台来源的调用：平台真实推送的 getWXContext().SOURCE 取值以线上实测为准，
// 本函数每次回调都会打印 source，运维确认后把该值配进 XPAY_NOTIFY_SOURCE 即可生效。
// 未配置时只记录不拦截（避免误伤真实推送）—— 此时伪造链条仍可自用，务必尽快配置，
// 或改用「服务端向微信支付查询订单」作为最终事实校验。
const NOTIFY_SOURCES = (process.env.XPAY_NOTIFY_SOURCE || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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

async function findMembership(openid) {
  const res = await db.collection('members').where({ _openid: openid }).limit(1).get();
  return res.data[0] || null;
}

// 封禁拦截：后台把 users.status 置为 'banned' 后，本函数与 user 云函数一致拒绝服务。
// 只作用于 get/subscribe 两个用户态 action；平台发货推送回调不受影响（订单已付款须履约）。
// 查询失败按「未封禁」处理（可用性优先；封禁属运营管控，不作为数据安全边界）。
async function isBanned(openid) {
  if (!openid) return false;
  try {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
    return !!(res.data[0] && res.data[0].status === 'banned');
  } catch (e) {
    console.error('[ban] users 查询失败，按未封禁处理', e);
    return false;
  }
}

exports.main = async (event) => {
  // 虚拟支付消息推送回调（云开发「消息推送」→ 云函数模式，事件对象直接透传，无 action 字段）。
  // 来源校验：客户端 wx.cloud.callFunction 可携带任意 event 字段伪造 Event，故不能只看正文。
  // 两道门：① 环境变量 XPAY_NOTIFY_SOURCE 白名单比对调用来源 SOURCE（推荐配置，彻底封堵伪造）；
  //        ② 正文与「已落库订单」严格绑定（见 deliverGoods），正文不能决定档位与金额。
  if (event && event.Event) {
    try {
      if (event.Event === 'xpay_goods_deliver_notify') {
        const ctx = cloud.getWXContext();
        const ctxOpenid = ctx.OPENID;
        const source = ctx.SOURCE || '';
        // 记录真实来源，供运维确认后配置白名单（不含敏感正文）
        console.log('[member] 发货推送来源 source=', source, 'hasOpenid=', !!ctxOpenid, 'outTradeNo=', event.OutTradeNo || '');
        if (NOTIFY_SOURCES.length && NOTIFY_SOURCES.indexOf(source) === -1) {
          console.warn('[member] 拒绝非白名单来源的发货推送 source=', source);
          return { ErrCode: 1, ErrMsg: 'forbidden' };
        }
        // 付款人自洽：上下文 OPENID（若有）必须与推送 OpenId 一致，防止把他人的单号指向自己
        if (!event.OpenId || !event.WeChatPayInfo || !event.WeChatPayInfo.MchOrderNo) {
          console.warn('[member] 拒绝伪造/缺字段的发货推送', event.Event, 'ctxOpenid=', ctxOpenid);
          return { ErrCode: 1, ErrMsg: 'forbidden' };
        }
        if (ctxOpenid && ctxOpenid !== event.OpenId) {
          console.warn('[member] 拒绝 openid 不一致的发货推送', event.Event, 'ctxOpenid=', ctxOpenid, 'OpenId=', event.OpenId);
          return { ErrCode: 1, ErrMsg: 'forbidden' };
        }
        await deliverGoods(event);
      } else {
        console.log('[member] 未处理推送事件', event.Event);
      }
      // 统一应答成功（非 0 平台会按通知周期重试，最多 15 次）
      return { ErrCode: 0, ErrMsg: 'success' };
    } catch (e) {
      console.error('[member] 推送处理失败', e);
      // 应答文案不回传内部错误细节（下方订单/金额校验抛出的 message 只进日志）
      return { ErrCode: 1, ErrMsg: 'deliver failed' };
    }
  }

  const { OPENID, APPID } = cloud.getWXContext();
  const action = event.action;

  try {
    // subscribe 会写 member_orders 下单，保持「先过封禁门禁」的串行校验；
    // get 只是读取会员态（每个页面进入都读一次），把封禁校验与会员查询并发，省一个往返。
    if (action !== 'get' && (await isBanned(OPENID))) return { ok: false, error: 'banned' };
    switch (action) {
      // 读会员状态：members 集合（后台 memberGrant/发货推送共用这张表）
      case 'get': {
        const FREE = { state: 'free', level: '', planName: '', expireDate: '', remainingDays: 0, renew: false };
        const [banned, m] = await Promise.all([isBanned(OPENID), findMembership(OPENID)]);
        if (banned) return { ok: false, error: 'banned' };
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
    // 错误详情只进日志：不回传原始 message。
    // 例外：'not configured' 是前端契约（services/member.js 据此提示「支付暂未开通」），
    // 统一归一为稳定的 'xpay not configured' 文案，避免前端依赖内部错误细节。
    console.error('[member] action 失败', action, e);
    const msg = String((e && e.message) || '');
    if (msg.indexOf('not configured') !== -1) return { ok: false, error: 'xpay not configured' };
    return { ok: false, error: 'internal error' };
  }
};

// ── 发货（xpay_goods_deliver_notify）──
// 安全口径：订单（member_orders）是唯一事实来源，推送正文只用于「找到订单」，不决定档位与金额。
//   · 订单必须存在，且 _openid 与推送 OpenId 一致（付款人 = 订单归属人）；
//   · 订单必须处于 created（delivered 视为平台重试，幂等返回；其它状态拒绝）；
//   · 推送 ProductId 必须与订单 product_id 一致，有效期天数取订单 plan；
//   · 正文 ActualPrice 存在时必须与订单 goods_price 一致（弱一致性校验）。
// 注意：整个推送正文都可被客户端伪造，上述绑定只能把影响限制在「攻击者给自己」，
// 无法阻止「给自己免费发货」。真正的门是 XPAY_NOTIFY_SOURCE 来源白名单（见文件顶部说明）；
// 未配置时，仍需以服务端订单查询（微信支付侧）作为最终事实校验。
// 幂等：同一订单重复通知只发一次货；发货与订单置已发货在同一事务内提交，任一步失败整体回滚
// 并抛错（平台按非 0 ErrCode 重试），避免「已发会员但未记订单」导致的重试双倍发放。
// 事务内不支持 where 查询，先按 _id 单文档定位。
async function deliverGoods(ev) {
  const openid = ev.OpenId;
  const outTradeNo = ev.OutTradeNo;
  const wxOrderId = (ev.WeChatPayInfo && ev.WeChatPayInfo.MchOrderNo) || '';
  const productId = (ev.GoodsInfo && ev.GoodsInfo.ProductId) || '';

  const orderRes = await db.collection('member_orders').where({ out_trade_no: outTradeNo }).limit(1).get();
  const order = orderRes.data[0] || null;
  if (!order) {
    throw new Error('[member] 发货：订单不存在 out_trade_no=' + outTradeNo);
  }
  if (order._openid !== openid) {
    throw new Error('[member] 发货：订单归属人与推送 OpenId 不一致');
  }
  // 已发货订单的重复推送属平台正常重试，直接返回（金额/道具以订单为准，无需再校验正文）
  if (order.status === 'delivered') return;
  if (order.status !== 'created') {
    throw new Error('[member] 发货：订单状态异常 status=' + order.status);
  }
  if (order.product_id !== productId) {
    throw new Error('[member] 发货：推送道具与订单不一致 productId=' + productId + ' expect=' + order.product_id);
  }
  const plan = order.plan;
  const days = PLAN_DAYS[plan];
  if (!days) {
    throw new Error('[member] 发货：订单档位无效 plan=' + plan);
  }
  // 正文金额一致性：ActualPrice 存在时（字符串，如 "100"）必须与订单金额（分）一致；
  // 字段缺省不阻断 —— 平台推送字段集以线上实测为准，误拦会让已付款用户拿不到会员。
  const rawPrice = ev.GoodsInfo ? ev.GoodsInfo.ActualPrice : undefined;
  if (rawPrice !== undefined && rawPrice !== null && rawPrice !== '') {
    const paidPrice = Number(rawPrice);
    if (!Number.isFinite(paidPrice) || paidPrice !== order.goods_price) {
      throw new Error('[member] 发货：实付金额与订单金额不一致 paid=' + rawPrice + ' expect=' + order.goods_price);
    }
  }

  const orderId = order._id;
  const memberRes = await db.collection('members').where({ _openid: openid }).limit(1).get();
  const memberId = memberRes.data[0] ? memberRes.data[0]._id : null;

  await db.runTransaction(async (transaction) => {
    const now = new Date();
    const orderSnap = await transaction.collection('member_orders').doc(orderId).get();
    const cur = orderSnap.data;
    if (cur && cur.status === 'delivered') return;

    let member = null;
    if (memberId) {
      const memberSnap = await transaction.collection('members').doc(memberId).get();
      member = memberSnap.data;
    }

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

    await transaction.collection('member_orders').doc(orderId).update({
      data: { status: 'delivered', wx_order_id: wxOrderId, paid_at: now, delivered_at: now, updated_at: now }
    });
  });
  console.log('[member] 已发货 openid=', openid, 'outTradeNo=', outTradeNo, 'plan=', plan);
}