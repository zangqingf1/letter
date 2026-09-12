'use strict';
/**
 * 会员支付 · 发货安全（对应 测试流程.md §7，MP-01~MP-16）
 *
 * 这是整个测试集里最该盯住的一块：发货链路的失败模式不是「报错」，而是
 * 「悄悄多给了一个月会员」或「付了钱没给会员」——两者都不会被人工点测发现。
 */
const { suite, test, ok, eq, has } = require('../runner');
const { createHarness } = require('../harness');

const DAY = 86400000;
const FAKE_KEY = 'test-key-not-a-real-secret';

// 每档道具 productId（与 cloudfunctions/member/config.js 同源）
const PRODUCT = { month: 'vip_month', quarter: 'vip_quarter', year: 'vip_year' };
const PRICE = { month: 100, quarter: 2590, year: 9990 };
const DAYS = { month: 30, quarter: 90, year: 365 };

/** 构造一条「平台发货推送」正文（字段名照抄微信文档） */
function notifyBody({ openid, outTradeNo, productId, actualPrice, mchOrderNo }) {
  const goods = { ProductId: productId };
  if (actualPrice !== undefined) goods.ActualPrice = actualPrice;
  return {
    Event: 'xpay_goods_deliver_notify',
    OpenId: openid,
    OutTradeNo: outTradeNo,
    WeChatPayInfo: { MchOrderNo: mchOrderNo || 'WX' + outTradeNo },
    GoodsInfo: goods
  };
}

/** 造一张已下单（status=created）的订单，绕过 subscribe（subscribe 需要 code2Session） */
function seedOrder(h, { openid, plan }) {
  const outTradeNo = 'T' + Math.random().toString().slice(2, 12);
  h.seed('member_orders', {
    _openid: openid,
    out_trade_no: outTradeNo,
    plan,
    product_id: PRODUCT[plan],
    goods_price: PRICE[plan],
    status: 'created',
    created_at: new Date()
  });
  return outTradeNo;
}

function withXpayEnv(vars) {
  const keys = ['XPAY_OFFER_ID', 'XPAY_APP_KEY', 'XPAY_APP_SECRET', 'XPAY_NOTIFY_SOURCE'];
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, vars);
}

suite('会员支付 · 发货安全', () => {
  // ── 未配置态：绝不能发放会员 ────────────────────────────────────────
  test('MP-01 未配置支付时 subscribe 返回 xpay not configured，且不落会员', async () => {
    withXpayEnv({});
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('member');
    const r = await main({ action: 'subscribe', plan: 'month', code: 'fake-code' });
    eq(r.ok, false, '未配置时不应成功');
    eq(r.error, 'xpay not configured');
    eq(h.count('members'), 0, '未配置时绝不能写下会员记录');
    eq(h.count('member_orders'), 0, '未配置时也不应落订单');
  });

  test('MP-01b 未配置时 get 返回 free（不因缺配置而误判为会员）', async () => {
    withXpayEnv({});
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('member');
    const r = await main({ action: 'get' });
    eq(r.ok, true);
    eq(r.membership.state, 'free');
  });

  test('MP-03 已配密钥但缺 code 时拒绝下单', async () => {
    withXpayEnv({ XPAY_OFFER_ID: 'offer-test', XPAY_APP_KEY: FAKE_KEY });
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('member');
    const r = await main({ action: 'subscribe', plan: 'month' });
    eq(r.ok, false, '缺 code 不应下单');
    eq(h.count('member_orders'), 0, '校验失败前不应落订单');
  });

  test('MP-03b 非法档位被拒（planConfigured 拦截）', async () => {
    withXpayEnv({ XPAY_OFFER_ID: 'offer-test', XPAY_APP_KEY: FAKE_KEY });
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('member');
    const r = await main({ action: 'subscribe', plan: 'lifetime', code: 'fake-code' });
    eq(r.ok, false);
    ok(/plan not configured/.test(r.error), '应提示档位未配置，实际：' + r.error);
    eq(h.count('member_orders'), 0);
  });

  // ── 伪造推送：四道拦截 ─────────────────────────────────────────────
  test('MP-13a 订单不存在的伪造推送被拒，不发放会员', async () => {
    withXpayEnv({}); // 未配来源白名单：仍应被「订单不存在」挡住
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('member');
    const r = await main(notifyBody({ openid: 'openid-A', outTradeNo: 'T-not-exist', productId: PRODUCT.month }));
    eq(r.ErrCode, 1, '订单不存在必须拒绝');
    eq(h.count('members'), 0, '绝不能发放会员');
  });

  test('MP-13b 订单归属人 ≠ 推送 OpenId 时被拒', async () => {
    withXpayEnv({});
    const h = createHarness({ openid: 'openid-B' });
    const outTradeNo = seedOrder(h, { openid: 'openid-A', plan: 'month' });
    const main = h.load('member');
    // B 拿 A 的单号给自己发货
    const r = await main(notifyBody({ openid: 'openid-B', outTradeNo, productId: PRODUCT.month }));
    eq(r.ErrCode, 1, '他人订单不得被认领');
    eq(h.count('members'), 0, 'A 的单不能发给 B');
  });

  test('MP-13c 推送 ProductId 与订单不一致时被拒', async () => {
    withXpayEnv({});
    const h = createHarness({ openid: 'openid-A' });
    const outTradeNo = seedOrder(h, { openid: 'openid-A', plan: 'month' });
    const main = h.load('member');
    // 用年卡的商品 id 去领月卡的订单
    const r = await main(notifyBody({ openid: 'openid-A', outTradeNo, productId: PRODUCT.year }));
    eq(r.ErrCode, 1, '道具不一致必须拒绝');
    eq(h.count('members'), 0);
  });

  test('MP-14 正文实付金额与订单不一致时被拒', async () => {
    withXpayEnv({});
    const h = createHarness({ openid: 'openid-A' });
    const outTradeNo = seedOrder(h, { openid: 'openid-A', plan: 'month' });
    const main = h.load('member');
    const r = await main(
      notifyBody({ openid: 'openid-A', outTradeNo, productId: PRODUCT.month, actualPrice: '1' })
    );
    eq(r.ErrCode, 1, '只付 1 分不应发月卡');
    eq(h.count('members'), 0);
  });

  test('MP-13d 订单状态异常（非 created/delivered）被拒', async () => {
    withXpayEnv({});
    const h = createHarness({ openid: 'openid-A' });
    const outTradeNo = 'T-refunded-1';
    h.seed('member_orders', {
      _openid: 'openid-A',
      out_trade_no: outTradeNo,
      plan: 'month',
      product_id: PRODUCT.month,
      goods_price: PRICE.month,
      status: 'refunded',
      created_at: new Date()
    });
    const main = h.load('member');
    const r = await main(notifyBody({ openid: 'openid-A', outTradeNo, productId: PRODUCT.month }));
    eq(r.ErrCode, 1, '已退款订单不得发货');
    eq(h.count('members'), 0, '不得发放会员');
  });

  test('MP-15 档位与天数一律取订单，不信推送正文', async () => {
    withXpayEnv({});
    const h = createHarness({ openid: 'openid-A' });
    const outTradeNo = seedOrder(h, { openid: 'openid-A', plan: 'month' });
    const main = h.load('member');
    const body = notifyBody({ openid: 'openid-A', outTradeNo, productId: PRODUCT.month });
    // 正文塞一个"年卡"暗示，函数应只认订单里的 month
    body.GoodsInfo.Plan = 'year';
    body.GoodsInfo.Days = 9999;
    const r = await main(body);
    eq(r.ErrCode, 0, '合法推送应成功');
    const m = h.all('members')[0];
    eq(m.total_days, DAYS.month, '天数必须取订单 plan=month（30 天）');
    eq(m.plan_name, '月卡');
  });

  // ── 来源白名单：唯一有效的封堵 ──────────────────────────────────────
  test('MP-12 配置 XPAY_NOTIFY_SOURCE 后，伪造来源的推送被拒（核心安全门）', async () => {
    withXpayEnv({ XPAY_NOTIFY_SOURCE: 'platform-source' });
    const h = createHarness({ openid: 'openid-A', source: '' }); // 客户端调用：SOURCE 为空
    const outTradeNo = seedOrder(h, { openid: 'openid-A', plan: 'month' });
    const main = h.load('member');
    const r = await main(notifyBody({ openid: 'openid-A', outTradeNo, productId: PRODUCT.month }));
    eq(r.ErrCode, 1, '非白名单来源必须拒绝');
    eq(h.count('members'), 0, '绝不能发放会员');
  });

  test('MP-12b 白名单内来源的推送正常发货', async () => {
    withXpayEnv({ XPAY_NOTIFY_SOURCE: 'platform-source' });
    const h = createHarness({ openid: 'openid-A', source: 'platform-source' });
    const outTradeNo = seedOrder(h, { openid: 'openid-A', plan: 'month' });
    const main = h.load('member');
    const r = await main(notifyBody({ openid: 'openid-A', outTradeNo, productId: PRODUCT.month }));
    eq(r.ErrCode, 0, '白名单来源应放行，实际：' + JSON.stringify(r));
    eq(h.count('members'), 1);
  });

  test('MP-11 未配置白名单时伪造推送可自用（记录已知风险，配置后即失效）', async () => {
    withXpayEnv({}); // 未配置 XPAY_NOTIFY_SOURCE
    const h = createHarness({ openid: 'openid-A', source: '' });
    const outTradeNo = seedOrder(h, { openid: 'openid-A', plan: 'month' });
    const main = h.load('member');
    const r = await main(notifyBody({ openid: 'openid-A', outTradeNo, productId: PRODUCT.month }));
    // 这条用例断言的是「当前已知风险存在」——一旦这里变成 ErrCode 1，
    // 说明代码侧新增了更强的封堵，应当把本用例改为正向断言并更新文档。
    eq(r.ErrCode, 0, '已知风险：未配白名单时伪造推送仍可给自己发货');
    eq(h.count('members'), 1, '这正是必须在线上配置 XPAY_NOTIFY_SOURCE 的原因');
  });

  // ── 幂等与续期 ─────────────────────────────────────────────────────
  test('SV-12 同一订单重复推送只发一次货', async () => {
    withXpayEnv({});
    const h = createHarness({ openid: 'openid-A' });
    const outTradeNo = seedOrder(h, { openid: 'openid-A', plan: 'month' });
    const main = h.load('member');
    const body = notifyBody({ openid: 'openid-A', outTradeNo, productId: PRODUCT.month });
    await main(body);
    await main(body);
    await main(body);
    const m = h.all('members')[0];
    eq(m.total_days, DAYS.month, '重复推送不得叠加天数');
    eq(h.count('members'), 1, '不得新建第二条会员记录');
  });

  test('续期：已是 vip 时在原到期日基础上顺延并累计总天数', async () => {
    withXpayEnv({});
    const h = createHarness({ openid: 'openid-A' });
    const future = new Date(Date.now() + 10 * DAY);
    h.seed('members', {
      _openid: 'openid-A',
      state: 'vip',
      plan_name: '月卡',
      expires_at: future,
      total_days: 30
    });
    const outTradeNo = seedOrder(h, { openid: 'openid-A', plan: 'quarter' });
    const main = h.load('member');
    const r = await main(notifyBody({ openid: 'openid-A', outTradeNo, productId: PRODUCT.quarter }));
    eq(r.ErrCode, 0);
    const m = h.all('members')[0];
    eq(m.total_days, 30 + DAYS.quarter, '总天数应累计为 30+90');
    const expected = future.getTime() + DAYS.quarter * DAY;
    ok(
      Math.abs(new Date(m.expires_at).getTime() - expected) < 2000,
      '应在剩余到期日上顺延 90 天，实际到期 ' + new Date(m.expires_at).toISOString()
    );
  });

  test('事务回滚：发货过程出错时会员与订单状态都不落库', async () => {
    withXpayEnv({});
    const h = createHarness({ openid: 'openid-A' });
    const outTradeNo = seedOrder(h, { openid: 'openid-A', plan: 'year' });
    const main = h.load('member');
    // 让会员写入那一步炸掉，验证「不能出现已发会员但订单未标记」的中间态
    h.faults.failNext('members', 'add');
    const r = await main(notifyBody({ openid: 'openid-A', outTradeNo, productId: PRODUCT.year }));
    eq(r.ErrCode, 1, '失败应反馈非 0，平台会重试');
    eq(h.count('members'), 0, '会员不得写入');
    const order = h.all('member_orders')[0];
    eq(order.status, 'created', '订单必须回到 created，否则重试再也发不出去');
  });

  // ── 等级称号 ───────────────────────────────────────────────────────
  test('等级称号按累计天数分档：寄字 <30 / 守候 <180 / 长情 ≥180', async () => {
    withXpayEnv({});
    const cases = [
      [1, '寄字'],
      [29, '寄字'],
      [30, '守候'],
      [179, '守候'],
      [180, '长情'],
      [999, '长情']
    ];
    for (const [days, expect] of cases) {
      const h = createHarness({ openid: 'openid-A' });
      h.seed('members', {
        _openid: 'openid-A',
        state: 'vip',
        expires_at: new Date(Date.now() + 5 * DAY),
        total_days: days
      });
      const main = h.load('member');
      const r = await main({ action: 'get' });
      eq(r.membership.level, expect, `累计 ${days} 天应为「${expect}」`);
    }
  });

  test('MP-10 会员过期后 get 回落 free', async () => {
    withXpayEnv({});
    const h = createHarness({ openid: 'openid-A' });
    h.seed('members', {
      _openid: 'openid-A',
      state: 'vip',
      expires_at: new Date(Date.now() - DAY),
      total_days: 400
    });
    const main = h.load('member');
    const r = await main({ action: 'get' });
    eq(r.membership.state, 'free', '过期即非会员');
    eq(r.membership.level, '', '过期后不应再返回等级称号');
  });

  test('VIP 状态返回剩余天数与到期时间', async () => {
    withXpayEnv({});
    const h = createHarness({ openid: 'openid-A' });
    h.seed('members', {
      _openid: 'openid-A',
      state: 'vip',
      plan_name: '年卡',
      expires_at: new Date(Date.now() + 100 * DAY),
      total_days: 365,
      renew: true
    });
    const main = h.load('member');
    const r = await main({ action: 'get' });
    eq(r.membership.state, 'vip');
    eq(r.membership.planName, '年卡');
    eq(r.membership.renew, true);
    eq(r.membership.remainingDays, 100);
    has(r.membership, 'expireDate');
  });

  // ── 封禁例外 ───────────────────────────────────────────────────────
  test('SV-05 封禁用户 get/subscribe 被拒', async () => {
    withXpayEnv({ XPAY_OFFER_ID: 'o', XPAY_APP_KEY: FAKE_KEY });
    const h = createHarness({ openid: 'openid-A' });
    h.seed('users', { _openid: 'openid-A', status: 'banned' });
    const main = h.load('member');
    eq((await main({ action: 'get' })).error, 'banned');
    eq((await main({ action: 'subscribe', plan: 'month', code: 'c' })).error, 'banned');
  });

  test('SV-08 封禁用户的已付款订单仍发货（唯一例外：已付款须履约）', async () => {
    withXpayEnv({});
    const h = createHarness({ openid: 'openid-A' });
    h.seed('users', { _openid: 'openid-A', status: 'banned' });
    const outTradeNo = seedOrder(h, { openid: 'openid-A', plan: 'month' });
    const main = h.load('member');
    const r = await main(notifyBody({ openid: 'openid-A', outTradeNo, productId: PRODUCT.month }));
    eq(r.ErrCode, 0, '封禁不应阻断已付款订单的发货');
    eq(h.count('members'), 1);
  });

  test('未知 action 被拒', async () => {
    withXpayEnv({});
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('member');
    const r = await main({ action: 'grantMeFreeVip' });
    eq(r.ok, false);
    ok(/unknown action/.test(r.error), '应报未知 action');
    eq(h.count('members'), 0);
  });
});
