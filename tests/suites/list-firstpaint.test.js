'use strict';
/**
 * 回形针 / 废纸篓首屏：信封不再被会员态与主题列表挡在门外（pages/clips、pages/recycle）。
 *
 * 为什么值得离线测：这两页原来把信封（连同整行）挂在
 *   Promise.all([信件, themes, membership])
 * 上一次 setData，于是冷容器时整行要等 member/theme 两个云函数拉起才画得出来（1~3s）。
 * 但 isVip 只影响「专属主题」的信封素材、theme 有 1h storage 缓存，两者都不该进关键路径。
 * 现在改成：首帧 = 信件 + 同步缓存（cachedThemes/cachedMembership）+ 本地默认款兜底，
 * 主题/会员回源后只 patch 真正变化的行。
 *
 * 这里桩掉 wx / Page（不连云、不起真机），断言的是时序契约：
 *   信件一到，信封就已经在 items 里 —— 哪怕 member.get / theme.list 还在路上；
 *   回源结果只校正真正变化的行，普通款不产生第二次渲染。
 *
 * 注意：本文件会设置全局 wx / Page 供 require 期读取；其他 suite 只用 harness 伪造
 * wx-server-sdk，不读这两个全局，因此不会互相影响。
 */
const fs = require('fs');
const path = require('path');
const { suite, test, eq, ok } = require('../runner');

const MINI_ROOT = path.resolve(__dirname, '..', '..', 'miniprogram') + path.sep;
const readWxml = (page) =>
  fs.readFileSync(path.join(MINI_ROOT, 'pages', page, page + '.wxml'), 'utf8');
const CLIPS_WXML = readWxml('clips');
const RECYCLE_WXML = readWxml('recycle');

// 本地默认款信封（services/theme.js DEFAULT_THEME_ID = 'cuican' 璀璨如初）——
// 无主题缓存时 envelopeThumbOf 的回落值
const DEFAULT_ENV = '/assets/theme/cuican/envelope-thumb.jpg';
// 小王子的包内信封（官方款之一，非默认款）
const XW_ENV = '/assets/theme/xiaowangzi/envelope-thumb.jpg';
// 后台给专属主题配的信封素材（member_items.assets）
const PREMIUM_ENV = '/assets/theme/guiniao/envelope.jpg';
const DAY = 24 * 60 * 60 * 1000;

// theme 云函数下发的列表：官方款按 sort 在前，专属款追加在末尾。未知 theme_id / 非 VIP
// 专属款的回落口径是「按 id 找默认款璀璨如初」，列表里没有默认 id 时才退 list[0]。
const DEFAULT_THEME = { id: 'cuican', name: '璀璨如初', version: 1, envelopeThumb: DEFAULT_ENV, palette: { base: '#F6F3EA' } };
const OFFICIAL_THEME = { id: 'xiaowangzi', name: '小王子', version: 2, envelopeThumb: XW_ENV, palette: { base: '#F9F3E4' } };
const PREMIUM_THEME = { id: 'guiniao', name: '归鸟', version: 1, premium: true, envelope: PREMIUM_ENV, palette: { base: '#E9DCCF' } };

const VIP = { ok: true, membership: { state: 'vip', level: '守候', renew: false, remainingDays: 200 } };
const FREE = { ok: true, membership: { state: 'free', level: '', renew: false, remainingDays: 0 } };

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

const CLIP_LETTERS = [
  { id: 'l1', name: '给失眠时的自己', theme_id: 'cuican', pinned: true, created_at: Date.now() },
  { id: 'l2', name: '给三十岁的自己', theme_id: 'cuican', pinned: true, created_at: Date.now() }
];
const RECYCLE_ITEMS = [
  { id: 'r1', name: '没寄出的那封', theme_id: 'cuican', deleted_at: Date.now() - DAY }
];

/**
 * 每个用例一套全新的模块态（services 的缓存是模块级变量，不重建会串味）。
 * 长延迟用来模拟冷容器：只要断言成立，就说明首帧确实没等这两个云函数。
 */
function load(page, opts) {
  const o = Object.assign(
    { letters: CLIP_LETTERS, recycle: RECYCLE_ITEMS, membership: VIP, memberDelay: 200, themeDelay: 200, letterDelay: 5, themes: [], storage: {} },
    opts || {}
  );
  for (const k of Object.keys(require.cache)) {
    if (k.indexOf(MINI_ROOT) === 0) delete require.cache[k];
  }

  const state = { calls: [], done: {}, toast: null, patches: [], storage: Object.assign({}, o.storage) };
  const reply = (value, delay) =>
    new Promise((r) => setTimeout(() => r(value), delay));

  const handlers = {
    'today.mailbox': () => reply({ ok: true, letters: o.letters, draftCount: 0, todayId: '' }, o.letterDelay),
    'letter.listRecycle': () => reply({ ok: true, items: o.recycle }, o.letterDelay),
    'theme.list': () => reply({ ok: true, themes: o.themes }, o.themeDelay),
    'member.get': () => reply(o.membership, o.memberDelay),
    'analytics.batch': () => reply({ ok: true }, 0)
  };

  global.wx = {
    cloud: {
      init() {},
      // 真机 callFunction 回 { result }：桩必须同形状，否则服务里读到的字段全是 undefined
      callFunction({ name, data }) {
        const key = name + '.' + data.action;
        state.calls.push(key);
        const h = handlers[key];
        if (!h) return Promise.reject(new Error('未桩的调用 ' + key));
        return Promise.resolve(h(data)).then((result) => {
          state.done[key] = true;
          return { result };
        });
      }
    },
    getWindowInfo: () => ({ statusBarHeight: 44 }),
    getStorageSync: (k) => (k in state.storage ? state.storage[k] : null),
    setStorageSync(k, v) { state.storage[k] = v; },
    removeStorageSync(k) { delete state.storage[k]; },
    showToast: (t) => { state.toast = t; },
    navigateBack() {},
    navigateTo() {},
    getSystemInfoSync: () => ({ platform: 'devtools', version: '8.0.70' })
  };

  let def = null;
  global.Page = (d) => { def = d; };
  require(path.join(MINI_ROOT, 'pages', page, page + '.js'));

  return {
    state,
    handlers,
    reply,
    calls: () => state.calls,
    done: (key) => !!state.done[key],
    // 完整走一遍生命周期：真机首帧 = onLoad + onShow 两次 setData 一起进渲染层
    page() {
      const p = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) });
      p.setData = function (patch) {
        state.patches.push(patch);
        for (const key of Object.keys(patch)) {
          // 真机 setData 支持 'items[1].env' 这种路径写法，桩必须按同样语义落值，
          // 否则页面里「只 patch 变化行」的写法在测试里读不回来
          const segs = key.replace(/\[(\d+)\]/g, '.$1').split('.');
          let node = this.data;
          for (let i = 0; i < segs.length - 1; i += 1) node = node[segs[i]];
          node[segs[segs.length - 1]] = patch[key];
        }
      };
      p.onLoad();
      p.onShow();
      return p;
    }
  };
}

suite('回形针 / 废纸篓首屏 · 信封不被会员态与主题挡住', () => {
  test('回形针：信件一到信封就落地，此时 member/theme 还在路上', async () => {
    const h = load('clips');
    const p = h.page();
    eq(p.data.loading, true, '数据未到时是骨架，不先渲染空状态');
    eq(p.data.items.length, 0, '骨架期没有行');

    await tick(30); // 信件 5ms 到，member/theme 要 200ms
    eq(p.data.loading, false, '信件到达即撤骨架');
    eq(p.data.items.length, 2, '两封别着回形针的信都已渲染');
    eq(p.data.items[0].env, DEFAULT_ENV, '信封已就位（无主题缓存时回落本地默认款）');
    eq(h.done('member.get'), false, '会员态还没回来 —— 但它不该挡住信封');
    eq(h.done('theme.list'), false, '主题列表也还没回来');
  });

  test('回形针：主题缓存缺失不炸，直接回落默认款（envelopeThumbOf 收空数组）', async () => {
    // cachedThemes() 冷启动无缓存时返回 []；旧实现 `themes || LOCAL_THEMES` 对 [] 不生效，
    // 会 TypeError 整页加载失败。这条用例专门守住这个回落口径。
    const h = load('clips', { storage: {} });
    const p = h.page();
    await tick(30);
    eq(p.data.loading, false, '不能停在骨架/报错');
    eq(p.data.items.map((x) => x.env), [DEFAULT_ENV, DEFAULT_ENV], '空主题列表 → 本地默认款');
    eq(h.state.toast, null, '不该弹「纸条暂时取不出来」');
  });

  test('回形针：会员态回来后只校正专属款那一行，普通行不重渲染', async () => {
    const h = load('clips', {
      letters: [
        { id: 'l1', name: '普通信', theme_id: 'cuican', pinned: true, created_at: Date.now() },
        { id: 'l2', name: '专属信', theme_id: 'guiniao', pinned: true, created_at: Date.now() }
      ],
      membership: VIP,
      // 后台给专属主题配了信封素材；无 theme 缓存时首帧只能先画默认款
      themes: [DEFAULT_THEME, OFFICIAL_THEME, PREMIUM_THEME]
    });
    const p = h.page();
    await tick(30);
    eq(p.data.items.map((x) => x.env), [DEFAULT_ENV, DEFAULT_ENV], '首帧两款都是默认信封');
    eq(h.done('theme.list'), false, '主题还没回来');

    await tick(220);
    eq(p.data.items[0].env, DEFAULT_ENV, '普通行的信封前后一致 → 不该产生渲染');
    eq(p.data.items[1].env, PREMIUM_ENV, 'VIP 回来后专属款校正为后台配的信封素材');

    const patches = h.state.patches;
    const lastPatch = patches[patches.length - 1];
    eq(Object.keys(lastPatch), ['items[1].env'], '只 patch 变化的那一行，整表不重发');
  });

  test('回形针：非会员时专属款保持默认信封（会员过期回退口径不变）', async () => {
    const h = load('clips', {
      letters: [{ id: 'l1', name: '专属信', theme_id: 'guiniao', pinned: true, created_at: Date.now() }],
      membership: FREE,
      themes: [DEFAULT_THEME, OFFICIAL_THEME, PREMIUM_THEME]
    });
    const p = h.page();
    await tick(230);
    eq(p.data.items[0].env, DEFAULT_ENV, '非 VIP 时专属主题按默认款渲染，且不破坏数据');
  });

  test('回形针：读取失败也收掉骨架，不停在加载态', async () => {
    const h = load('clips');
    h.handlers['today.mailbox'] = () => Promise.reject(new Error('boom'));
    const p = h.page();
    await tick(20);
    eq(p.data.loading, false, '失败必须退出骨架，否则看起来像卡死');
    eq(p.data.hasItems, false, '失败落空状态');
    ok(h.state.toast, '给出温和提示');
  });

  test('回形针：模板有骨架分支，loading 不会误落到空状态', async () => {
    // 纯时序用例覆盖不到 WXML：旧模板 `wx:if="{{hasItems}}"` + wx:else 空状态，
    // 加载期会先渲染「还没有别上回形针的信。」—— 有回形针的用户先被告知「你没有」。
    eq(CLIPS_WXML.indexOf('wx:if="{{loading}}"') !== -1, true, '骨架有独立分支');
    eq(CLIPS_WXML.indexOf('wx:elif="{{hasItems}}"') !== -1, true, '有内容态降级为 elif，不再是 wx:else 兜底');
    eq(CLIPS_WXML.indexOf('lazy-load') === -1, true, '短列表去掉 lazy-load，首屏信封不等进入视口');
  });

  test('废纸篓：信件一到信封就落地，此时 member/theme 还在路上', async () => {
    const h = load('recycle');
    const p = h.page();
    eq(p.data.loading, true, '数据未到时是骨架');

    await tick(30);
    eq(p.data.loading, false, '信件到达即撤骨架');
    eq(p.data.items.length, 1, '废纸篓行已渲染');
    eq(p.data.items[0].env, DEFAULT_ENV, '信封已就位');
    eq(h.done('member.get'), false, '会员态还没回来 —— 但不挡信封');
    eq(h.done('theme.list'), false, '主题列表也还没回来');
  });

  test('废纸篓：主题回源后同样只 patch 变化的行', async () => {
    const h = load('recycle', {
      recycle: [
        { id: 'r1', name: '普通信', theme_id: 'cuican', deleted_at: Date.now() - DAY },
        { id: 'r2', name: '专属信', theme_id: 'guiniao', deleted_at: Date.now() - 2 * DAY }
      ],
      membership: VIP,
      themes: [DEFAULT_THEME, OFFICIAL_THEME, PREMIUM_THEME]
    });
    const p = h.page();
    await tick(230);
    eq(p.data.items.map((x) => x.env), [DEFAULT_ENV, PREMIUM_ENV], '按删除时间倒序，专属行校正');
    const patches = h.state.patches;
    eq(Object.keys(patches[patches.length - 1]), ['items[1].env'], '只 patch 变化的那一行');
  });

  test('废纸篓：onShow 重入时丢弃过期响应，不给旧列表覆盖新列表', async () => {
    // 取回/彻底删除后 onShow 会再刷一次；若第一枪慢、第二枪快，旧结果后到会把新列表盖回去
    const h = load('recycle');
    h.handlers['letter.listRecycle'] = () =>
      h.reply({ ok: true, items: RECYCLE_ITEMS.concat([
        { id: 'r2', name: '慢枪的信', theme_id: 'xiaowangzi', deleted_at: Date.now() - 2 * DAY }
      ]) }, 80);
    const p = h.page();

    await tick(10);
    h.handlers['letter.listRecycle'] = () => h.reply({ ok: true, items: [] }, 1);
    p.onShow(); // 第二枪：已取回，废纸篓空了

    await tick(120); // 等慢枪也回来
    eq(p.data.items.length, 0, '过期响应必须被丢弃，否则刚取回的信又冒出来');
    eq(p.data.hasItems, false, '列表为空 → 空状态');
    eq(p.data.loading, false, '骨架已撤');
  });

  test('废纸篓：模板有骨架分支，loading 不会误落到空状态', async () => {
    eq(RECYCLE_WXML.indexOf('wx:if="{{loading}}"') !== -1, true, '骨架有独立分支');
    eq(RECYCLE_WXML.indexOf('wx:elif="{{hasItems}}"') !== -1, true, '有内容态降级为 elif，不再是 wx:else 兜底');
  });
});
