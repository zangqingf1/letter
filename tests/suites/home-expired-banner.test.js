'use strict';
/**
 * 首页 · 会员过期横幅（pages/home）。
 *
 * 为什么值得离线测：会员过期后云函数 member.get 回落 free 态，若不带 expired 标记，
 * 首页无法区分「从未开通」与「曾开通但已过期」，过期告知横幅就无从谈起。这里的契约是：
 *   服务端 expired 标记驱动横幅；点一次落「已读」标记永久消失；
 *   重新开通（回 VIP）时「已读」标记被清除，下次再过期仍会提示；
 *   从未开通 / 非 vip 记录不带 expired —— 不显示横幅（那是新用户福利横幅的领域）。
 *
 * 桩法与 list-firstpaint.test.js 同构：伪造 wx / Page，不连云、不起真机。
 */
const { suite, test, eq, ok } = require('../runner');
const path = require('path');

const MINI_ROOT = path.resolve(__dirname, '..', '..', 'miniprogram') + path.sep;
const EXPIRED_BANNER_KEY = 'member_expired_banner_dismissed';

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

const LETTERS = [
  { id: 'l1', name: '第一封信', theme_id: 'cuican', pinned: false, created_at: Date.now() }
];

const EXPIRED_MEMBER = { ok: true, membership: { state: 'free', level: '', renew: false, remainingDays: 0, trial: false, trialAvailable: false, expired: true } };
const FREE_MEMBER = { ok: true, membership: { state: 'free', level: '', renew: false, remainingDays: 0, trial: false, trialAvailable: true, expired: false } };
const VIP_MEMBER = { ok: true, membership: { state: 'vip', level: '守候', renew: false, remainingDays: 200, trial: false, trialAvailable: false } };

function load(opts) {
  const o = Object.assign({ member: EXPIRED_MEMBER, storage: {} }, opts || {});
  for (const k of Object.keys(require.cache)) {
    if (k.indexOf(MINI_ROOT) === 0) delete require.cache[k];
  }

  const state = { calls: [], navigates: [], storage: Object.assign({}, o.storage) };
  const reply = (value, delay) => new Promise((r) => setTimeout(() => r(value), delay || 5));

  const handlers = {
    'today.mailbox': () => reply({ ok: true, letters: LETTERS, draftCount: 0, todayId: '' }),
    'theme.list': () => reply({ ok: true, themes: [] }),
    'member.get': () => reply(o.member, 40)
  };

  global.wx = {
    cloud: {
      init() {},
      callFunction({ name, data }) {
        const key = name + '.' + data.action;
        state.calls.push(key);
        const h = handlers[key];
        if (!h) return Promise.reject(new Error('未桩的调用 ' + key));
        return Promise.resolve(h(data)).then((result) => ({ result }));
      }
    },
    getWindowInfo: () => ({ statusBarHeight: 44 }),
    getStorageSync: (k) => (k in state.storage ? state.storage[k] : null),
    setStorageSync(k, v) { state.storage[k] = v; },
    removeStorageSync(k) { delete state.storage[k]; },
    showToast() {},
    navigateTo(u) { state.navigates.push((u && u.url) || String(u)); },
    getSystemInfoSync: () => ({ platform: 'devtools', version: '8.0.70' })
  };

  let def = null;
  global.Page = (d) => { def = d; };
  require(path.join(MINI_ROOT, 'pages', 'home', 'home.js'));

  const p = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) });
  p.setData = function (patch) {
    for (const key of Object.keys(patch)) this.data[key] = patch[key];
  };
  p.onLoad();
  p.onShow();

  return {
    state,
    handlers,
    reply,
    page: p,
    navigates: () => state.navigates,
    storage: () => state.storage
  };
}

suite('首页 · 会员过期横幅', () => {
  test('服务端 expired 标记驱动横幅显示（点前进会员中心）', async () => {
    const h = load();
    await tick(60); // member.get 40ms 到，Promise.all 落定
    eq(h.page.data.memberExpiredBanner, true, '过期用户应显示过期横幅');
    eq(h.page.data.trialAvailable, false, '过期用户不是新用户，不显示福利横幅');

    h.page.onTapExpiredBanner();
    eq(h.page.data.memberExpiredBanner, false, '点击一次横幅即消失');
    ok(h.storage()[EXPIRED_BANNER_KEY], '已读标记落 storage');
    eq(h.navigates().length, 1, '点击跳转一次');
    ok(String(h.navigates()[0]).indexOf('pages/member/member') !== -1, '跳转目标是会员中心');
  });

  test('点过一次后横幅永久消失：onShow 重入不再显示（会员仍过期）', async () => {
    const h = load();
    await tick(60);
    h.page.onTapExpiredBanner();

    h.page.onShow(); // 离开会员中心（未续费）再回首页
    await tick(60);
    eq(h.page.data.memberExpiredBanner, false, '已读标记生效，过期横幅不再打扰');
  });

  test('重新开通会员（回 VIP）时清除已读标记，下次再过期仍会提示', async () => {
    const h = load({ storage: { [EXPIRED_BANNER_KEY]: 1727000000000 } });
    // 第一枪：已过期的会员（带着旧已读标记进首页，横幅被压住）
    await tick(60);
    eq(h.page.data.memberExpiredBanner, false, '点过就不再显示');

    // 用户在会员中心续费成功 → 支付成功会清 member 服务的内存缓存（subscribe 同款链路），
    // 下次回首页时会员态已是 vip
    const memberService = require(path.join(MINI_ROOT, 'services', 'member.js'));
    memberService.invalidate();
    h.handlers['member.get'] = () => h.reply(VIP_MEMBER, 40);
    h.page.onShow();
    await tick(60);
    eq(h.storage()[EXPIRED_BANNER_KEY], undefined, 'VIP 态清除已读标记');
    eq(h.page.data.memberExpiredBanner, false, 'VIP 不显示过期横幅');

    // 之后再次过期（真实世界里会员态 30s 内存缓存过期后自然读到新状态）：
    // 横幅要能重新出现
    memberService.invalidate();
    h.handlers['member.get'] = () => h.reply(EXPIRED_MEMBER, 40);
    h.page.onShow();
    await tick(60);
    eq(h.page.data.memberExpiredBanner, true, '再次过期重新提示');
  });

  test('从未开通的用户不显示过期横幅（expired 标记与 trialAvailable 互斥分工）', async () => {
    const h = load({ member: FREE_MEMBER });
    await tick(60);
    eq(h.page.data.memberExpiredBanner, false, '新用户走福利横幅，不见过期横幅');
    eq(h.page.data.trialAvailable, true, '福利横幅照常');
  });

  test('wxml 有过期横幅分支：文案含回落提示与会员中心引导，绑定点按处理器', () => {
    const fs = require('fs');
    const wxml = fs.readFileSync(path.join(MINI_ROOT, 'pages', 'home', 'home.wxml'), 'utf8');
    ok(wxml.indexOf('memberExpiredBanner') !== -1, '横幅由 memberExpiredBanner 驱动');
    ok(wxml.indexOf('onTapExpiredBanner') !== -1, '点按绑定过期横幅处理器');
    ok(wxml.indexOf('会员已过期') !== -1, '标题明确告知过期');
    ok(wxml.indexOf('回落为默认款') !== -1, '文案说明专属样式已回落');
    ok(wxml.indexOf('会员中心') !== -1, '文案引导去会员中心');
  });
});
