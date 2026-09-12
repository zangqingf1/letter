'use strict';
/**
 * 「我的」页首屏：缓存优先渲染 + 资料/统计解耦 + 启动预热 + 会员中心入口预热
 * （miniprogram/services/user.js、services/member.js、pages/mine）。
 *
 * 为什么值得离线测：这一页的慢不来自某一条查询，而来自三个只体现在时序上的结构问题 ——
 * stats 云函数只被本页调用、常年冷启动；两个请求被 Promise.all 绑在一起，资料再快也
 * 要等统计；完全没有缓存，每次切 Tab 都从零等网络。真机上的表现就是「切到我的要空等一屏」。
 *
 * 这里桩掉 wx / Page（不连云、不起真机），断言的是时序契约：
 *   有缓存 → onShow 返回时首屏数据已就位（一个云函数都还没回来）；
 *   无缓存 → 名片先于统计渲染，统计未到位时便签显示占位横杠而不是 0（0 会被误读成真实值）。
 *
 * 注意：本文件会设置全局 wx / Page 供 require 期读取；其他 suite 只用 harness 伪造
 * wx-server-sdk，不读这两个全局，因此不会互相影响。
 */
const path = require('path');
const { suite, test, eq } = require('../runner');

const MINI_ROOT = path.resolve(__dirname, '..', '..', 'miniprogram') + path.sep;
const PROFILE = { ok: true, profile: { nickname: '林深', avatar: '' }, registerDays: 7 };
const STATS = { ok: true, letterTotal: 3, rereadTotal: 9, replyTotal: 2, registerDays: 7, pinnedCount: 1, recycleCount: 0 };
const PENDING = ['—', '—', '—', '—'];

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

/**
 * 每个用例一套全新的模块态：services 里的缓存是模块级变量，不重建就会串味。
 * 返回 { user, handlers, calls, resolved, modal, page() }。
 */
function load(opts) {
  const o = Object.assign({ profile: PROFILE, stats: STATS, profileDelay: 0, statsDelay: 0 }, opts || {});
  for (const k of Object.keys(require.cache)) {
    if (k.indexOf(MINI_ROOT) === 0) delete require.cache[k];
  }

  const state = { calls: [], resolved: 0, modal: null };
  const reply = (value, delay) => new Promise((r) => setTimeout(() => {
    state.resolved += 1;
    r(value);
  }, delay));

  const handlers = {
    'user.getProfile': () => reply(o.profile, o.profileDelay),
    'stats.get': () => reply(o.stats, o.statsDelay),
    'user.saveProfile': () => Promise.resolve({ ok: true }),
    'user.deactivate': () => Promise.resolve({ ok: true }),
    // 会员中心入口预热（page.onShow 顺手补的一枪）；立即 resolve，不计入 resolved
    'member.get': () => Promise.resolve({ ok: true, membership: { state: 'free' } })
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
      },
      uploadFile: () => Promise.resolve({ fileID: 'cloud://avatar.png' })
    },
    getWindowInfo: () => ({ statusBarHeight: 44 }),
    getStorageSync: () => null,
    setStorageSync() {},
    removeStorageSync() {},
    showModal: (m) => { state.modal = m; }
  };

  let def = null;
  global.Page = (d) => { def = d; };
  const user = require(path.join(MINI_ROOT, 'services', 'user.js'));
  const member = require(path.join(MINI_ROOT, 'services', 'member.js'));
  require(path.join(MINI_ROOT, 'pages', 'mine', 'mine.js'));

  return {
    user,
    member,
    handlers,
    state,
    calls: () => state.calls, // 取当前数组（reset 会原地清空，不留旧引用）
    reset() { state.calls.length = 0; state.resolved = 0; },
    page() {
      const p = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) });
      p.setData = function (patch) { Object.assign(this.data, patch); };
      p.onLoad();
      return p;
    }
  };
}

suite('「我的」页首屏 · 缓存与预热', () => {
  test('预热一次备好两个云函数与缓存，之后切 Tab 不再等网络', async () => {
    const h = load();
    eq(h.user.cachedProfile(), null, '预热前无缓存（页面先显示骨架）');
    h.user.prefetch();
    await tick();
    eq(h.user.cachedProfile().nickname, '林深', '预热后资料缓存就绪');
    eq(h.user.cachedStats().letterTotal, 3, '预热后统计缓存就绪');
    eq(h.calls().slice().sort(), ['stats.get', 'user.getProfile'], '预热只发这两个调用');

    h.reset();
    eq((await h.user.getProfile()).nickname, '林深', 'TTL 内读资料命中缓存');
    eq((await h.user.getStats()).pinnedCount, 1, 'TTL 内读统计命中缓存');
    eq(h.calls(), [], '命中缓存不发云调用');

    await h.user.getProfile({ force: true });
    await h.user.getStats({ force: true });
    eq(h.calls().slice().sort(), ['stats.get', 'user.getProfile'], 'onShow 的 force 刷新仍会回源');
  });

  test('保存资料后缓存失效：首帧拿旧值占位，下次读取回源取新值', async () => {
    const h = load();
    h.user.prefetch();
    await tick();

    h.reset();
    await h.user.saveProfile({ nickname: '新名字', avatar: 'cloud://a.png' });
    eq(h.calls(), ['user.saveProfile'], '只发一次写请求（avatar 已是 fileID 不再重复上传）');
    eq(h.user.cachedProfile().nickname, '林深', '旧值仍可做首帧占位，不闪骨架');

    h.handlers['user.getProfile'] = () => Promise.resolve({ ok: true, profile: { nickname: '新名字' }, registerDays: 7 });
    h.reset();
    eq((await h.user.getProfile()).nickname, '新名字', '缓存已失效，读取回源拿到新值');
    eq(h.calls(), ['user.getProfile'], '保存确实让资料缓存过期');
  });

  test('注销清空资料/统计缓存，且在途请求不得把上一账号数据写回', async () => {
    const h = load({ profileDelay: 30, statsDelay: 30 });
    h.user.prefetch();
    const inflight = h.user.getProfile({ force: true }).catch(() => {});
    await tick();

    h.user.deactivate();
    eq(h.user.cachedProfile(), null, '注销即清空资料缓存');
    eq(h.user.cachedStats(), null, '注销即清空统计缓存');
    eq(h.calls().indexOf('user.deactivate') !== -1, true, '注销要真的通知服务端物理删除');

    await inflight;
    await tick(50);
    eq(h.user.cachedProfile(), null, '在途请求回来后不写回上一账号的资料');
  });

  test('无缓存首帧：名片先于统计渲染，统计未到便签是占位横杠', async () => {
    const h = load({ profileDelay: 5, statsDelay: 40 });
    const p = h.page();
    p.onShow();

    eq(p.data.notes.map((n) => n.value), PENDING, '首帧便签是占位而非 0（0 会被误读成真实值）');
    eq([p.data.profileReady, p.data.statsReady], [false, false], '首帧两个区块都在待就位态');
    eq(p.data.notes.map((n) => n.name), ['信件总数', '被重读总次数', '回信条数', '注册天数'], '便签名称首帧立住版面，数值原位替换');

    await tick(20);
    eq(p.data.user.nickname, '林深', '资料先到先渲染，不再被统计聚合拖住');
    eq(p.data.profileReady, true, '资料就位');
    eq(p.data.statsReady, false, '此时统计仍在途（两请求确实解耦）');

    await tick(60);
    eq(p.data.notes.map((n) => n.value), [3, 9, 2, 7], '统计到达后原地填数');
    eq([p.data.pinnedCount, p.data.recycleCount], [1, 0], '回形针/废纸篓数取自同一次聚合');
    eq(p.data.statsReady, true, '统计就位');
  });

  test('有缓存首帧：onShow 返回即数据就位，随后后台刷新', async () => {
    const h = load({ profileDelay: 5, statsDelay: 40 });
    h.user.prefetch();
    await tick(60);
    h.reset();

    const p = h.page();
    p.onShow();
    eq(p.data.user.nickname, '林深', '首帧直接是真实昵称');
    eq(p.data.notes.map((n) => n.value), [3, 9, 2, 7], '首帧直接是真实统计');
    eq([p.data.profileReady, p.data.statsReady], [true, true], '首帧即就位');
    eq(h.state.resolved, 0, 'onShow 返回时一个云函数都还没回来（首屏没等网络）');

    await tick(60);
    eq(h.state.resolved, 2, '首帧之后仍在后台强制刷新，保证数字是新的');
  });

  test('封禁提示只由页面调用触发，启动预热不弹阻断弹窗', async () => {
    const h = load({ profile: { ok: false, error: 'banned' } });
    h.user.prefetch();
    await tick();
    eq(h.state.modal, null, '后台预热不得在用户没进「我的」时弹窗');

    await h.user.getProfile({ force: true }).catch(() => {});
    eq(h.state.modal && h.state.modal.title, '无法使用', '页面正常调用遇到封禁仍要提示并阻断');
  });

  test('会员中心入口预热：本会话没有会员态时才补一枪', async () => {
    const h = load();
    const p = h.page();
    p.onShow();
    eq(h.calls().indexOf('member.get') !== -1, true, '进「我的」顺手备好会员态，点进会员中心首帧就能画对');
    await tick();
    eq(h.member.cachedMembership().state, 'free', '预热结果落在会员态内存缓存里');

    h.reset();
    p.onShow();
    eq(h.calls().indexOf('member.get'), -1, '缓存已有值就不再重复请求（会员页自己会 force 回源校正）');
  });
});
