'use strict';
/**
 * 会员中心首屏：缓存优先渲染 + 骨架第三态 + 后台强刷（miniprogram/services/member.js、
 * services/theme.js、pages/member）。
 *
 * 为什么值得离线测：这一页的问题不是「慢」，而是「先画错、再改正」——
 *   会员态初始值是 free，专属款初始值是本地兜底配置，而 onLoad 里的两个读取都带 force
 *   （刻意绕过所有缓存）。真机表现就是 VIP 用户进来先闪一屏「还未开通会员」，
 *   专属信纸栏先闪一版本地占位款，等三个云函数回来才换成对的。
 *
 * 这里桩掉 wx / Page（不连云、不起真机），断言的是时序契约：
 *   有缓存 → onLoad/onShow 返回时状态卡已是真值，一个云函数都还没回来；
 *   无缓存 → 停在骨架态（loading），绝不出现 free 首帧；回源结果无论如何都覆盖缓存值。
 *
 * 注意：本文件会设置全局 wx / Page 供 require 期读取；其他 suite 只用 harness 伪造
 * wx-server-sdk，不读这两个全局，因此不会互相影响。
 */
const fs = require('fs');
const path = require('path');
const { suite, test, eq } = require('../runner');

const MINI_ROOT = path.resolve(__dirname, '..', '..', 'miniprogram') + path.sep;
const WXML = fs.readFileSync(path.join(MINI_ROOT, 'pages', 'member', 'member.wxml'), 'utf8');

const VIP = { ok: true, membership: { state: 'vip', level: '守候', renew: true, expireDate: '2027-01-01', planName: '年卡', remainingDays: 200 } };
const FREE = { ok: true, membership: { state: 'free', level: '', renew: false, remainingDays: 0 } };
// 本地兜底款（pages/member/premium.js）——首帧不该再出现它，除非连 theme 缓存都没有
const LOCAL_PAPERS = ['鎏金笺', '苍蓝笺', '银厢笺'];

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

/**
 * 每个用例一套全新的模块态（services 的缓存是模块级变量，不重建会串味）。
 * storage 用于伪造 theme 的 1h 版式/主题缓存。
 */
function load(opts) {
  const o = Object.assign({ membership: VIP, memberDelay: 0, themeDelay: 0, themes: [], papers: [], storage: {} }, opts || {});
  for (const k of Object.keys(require.cache)) {
    if (k.indexOf(MINI_ROOT) === 0) delete require.cache[k];
  }

  const state = { calls: [], resolved: 0, toast: null, storage: Object.assign({}, o.storage) };
  const reply = (value, delay) => new Promise((r) => setTimeout(() => {
    state.resolved += 1;
    r(value);
  }, delay));

  const handlers = {
    'member.get': () => reply(o.membership, o.memberDelay),
    'theme.list': () => reply({ ok: true, themes: o.themes }, o.themeDelay),
    'theme.papers': () => reply({ ok: true, papers: o.papers }, o.themeDelay),
    'user.getProfile': () => Promise.resolve({ ok: true, profile: { nickname: '林深', avatar: '' }, registerDays: 7 })
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
        return Promise.resolve(h(data)).then((result) => ({ result }));
      }
    },
    getWindowInfo: () => ({ statusBarHeight: 44 }),
    getStorageSync: (k) => (k in state.storage ? state.storage[k] : null),
    setStorageSync(k, v) { state.storage[k] = v; },
    removeStorageSync(k) { delete state.storage[k]; },
    showToast: (t) => { state.toast = t; },
    showModal: (m) => { state.modal = m; },
    getSystemInfoSync: () => ({ platform: 'devtools', version: '8.0.70' })
  };

  let def = null;
  global.Page = (d) => { def = d; };
  const service = require(path.join(MINI_ROOT, 'services', 'member.js'));
  const theme = require(path.join(MINI_ROOT, 'services', 'theme.js'));
  require(path.join(MINI_ROOT, 'pages', 'member', 'member.js'));

  return {
    service,
    theme,
    handlers,
    state,
    reply,
    calls: () => state.calls, // 取当前数组（reset 原地清空，不留旧引用）
    reset() { state.calls.length = 0; state.resolved = 0; },
    // 完整走一遍生命周期：真机首帧 = onLoad + onShow 两次 setData 一起进渲染层
    page() {
      const p = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) });
      p.setData = function (patch) { Object.assign(this.data, patch); };
      p.onLoad();
      p.onShow();
      return p;
    }
  };
}

suite('会员中心首屏 · 缓存与骨架', () => {
  test('无缓存首帧停在骨架态：不预告「还未开通会员」', async () => {
    const h = load({ memberDelay: 30, themeDelay: 30 });
    const p = h.page();

    eq(p.data.state, 'loading', '会员态未定时是骨架，而不是 free（free 会让 VIP 先看到开通引导）');
    eq(p.data.premiumPapers.map((x) => x.name), LOCAL_PAPERS, '版式缓存也没有，才回落本地兜底款');
    eq(h.state.resolved, 0, '首帧没有等任何云函数');

    await tick(60);
    eq(p.data.state, 'vip', '回源后原地换成真值');
    eq(p.data.benefits.filter((b) => b.unlocked).length, 3, '权益徽章随会员态一起落地');
  });

  test('有缓存首帧：VIP 直接画对，随后仍 force 回源', async () => {
    const h = load({ memberDelay: 40, themeDelay: 40 });
    await h.service.getMembership(); // 模拟信匣/写信等页面提前备好的本会话缓存
    h.reset();

    const p = h.page();
    eq(p.data.state, 'vip', '首帧直接是会员态，不闪「还未开通会员」');
    eq(p.data.remainingDays, 200, '剩余天数一并就位');
    eq(h.state.resolved, 0, 'onLoad/onShow 返回时一个云函数都还没回来');
    eq(p.data.benefits.filter((b) => b.unlocked).length, 3, '首帧权益即已解锁');

    await tick(60);
    eq(h.calls().indexOf('member.get') !== -1, true, '首帧之后仍 force 回源，保证状态是新的');
  });

  test('缓存只是首帧占位，不是事实来源：缓存 free、服务端 vip 时仍要翻亮', async () => {
    const h = load({ membership: FREE, memberDelay: 20 });
    await h.service.getMembership(); // 缓存里是 free（例如支付发货推送还没到账）
    h.reset();
    // 结算完成：服务端已翻成 vip
    h.handlers['member.get'] = () => h.reply(VIP, 20);

    const p = h.page();
    eq(p.data.state, 'free', '首帧按缓存画 free');

    await tick(40);
    eq(p.data.state, 'vip', '回源结果一定覆盖缓存值（刚支付完回到本页要能翻亮）');
  });

  test('专属款首帧取 theme 缓存：不再先闪本地占位款', async () => {
    const cachedPaper = { id: 'gold', name: '云端鎏金', desc: '', premium: true, colors: { bg: '#FAF4E6', ink: '#4A4033', gold: '#C6A870' } };
    const cachedTheme = { id: 'guiniao', name: '云端归鸟', premium: true, swatch: '#D9C3B2', palette: { base: '#E9DCCF' } };
    const freshPaper = { id: 'gold', name: '最新鎏金', desc: '', premium: true, colors: { bg: '#FAF4E6', ink: '#4A4033', gold: '#C6A870' } };
    const h = load({
      memberDelay: 30,
      themeDelay: 30,
      papers: [freshPaper],
      themes: [{ id: 'guiniao', name: '最新归鸟', premium: true, swatch: '#D9C3B2' }],
      storage: {
        papers_cache: { at: Date.now(), list: [cachedPaper] },
        theme_cache: { at: Date.now(), list: [cachedTheme] }
      }
    });
    // 预热会员态，确保这一条只考察专属款的时序（不掺会员状态卡的骨架）
    await h.service.getMembership();
    h.reset();

    const p = h.page();
    eq(p.data.premiumPapers.map((x) => x.name), ['云端鎏金'], '首帧就是后台配置过的专属款，不是本地兜底款');
    eq(p.data.premiumThemes.map((x) => x.name), ['云端归鸟'], '专属主题同理');
    eq(h.state.resolved, 0, '首帧同样没等云函数');

    await tick(60);
    eq(p.data.premiumPapers.map((x) => x.name), ['最新鎏金'], '后台改动仍在后台刷新生效');
    eq(p.data.premiumThemes.map((x) => x.name), ['最新归鸟'], '专属主题同步刷新');
  });

  test('回源失败也要收掉骨架：不停在「正在读取」', async () => {
    const h = load({ memberDelay: 5 });
    h.handlers['member.get'] = () => Promise.reject(new Error('boom'));
    const p = h.page();
    eq(p.data.state, 'loading', '首帧仍是骨架');

    await tick(20);
    eq(p.data.state, 'free', '读取失败按未开通处理，但必须退出骨架态（否则看起来像卡死）');
    eq(p.data.benefits.filter((b) => b.unlocked).length, 0, '未开通态权益全部未解锁');
  });

  test('骨架态在模板里有对应分支：state=loading 不会误落到会员卡', async () => {
    // 纯时序用例覆盖不到 WXML。若 loading 分支被删掉，`wx:if="{{state === 'free'}}"` 的
    // wx:else 会把骨架态渲染成「已开通」金卡（空昵称 + 0 天），这是比闪 free 更糟的回归。
    eq(WXML.indexOf('wx:if="{{state === \'loading\'}}"') !== -1, true, '状态卡有 loading 分支');
    eq(WXML.indexOf('wx:elif="{{state === \'free\'}}"') !== -1, true, 'free 分支降级为 elif，不再兜底 wx:else');
    eq(WXML.indexOf('wx:elif="{{state !== \'loading\'}}"') !== -1, true, '骨架期不预告「未解锁」徽章');
  });
});
