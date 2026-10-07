'use strict';
/**
 * 首页 · onShow 时间闸（30s 短路 + 脏标记绕过）。
 *
 * 为什么值得离线测：信匣数据经 today.mailbox 聚合下发，onShow 每次无条件重拉意味着
 * 每次回首页都打一遍云函数（冷启动场景白等 1~2s）。时间闸的契约是：
 *   30s 内已成功加载且无数据变化 → 短路（不发任何云调用）；
 *   寄出回传（letter_just_arrived）/ 信匣脏标记（mailbox_dirty）→ 绕过闸门强制重拉；
 *   脏标记由 letter/draft/member 服务的写操作置位，成功加载后消费清除；
 *   加载失败不落账（_lastLoadAt 不写入），下次 onShow 必然重试。
 *
 * 桩法与 home-expired-banner.test.js 同构：伪造 wx / Page，不连云、不起真机。
 */
const { suite, test, eq, ok } = require('../runner');
const path = require('path');

const MINI_ROOT = path.resolve(__dirname, '..', '..', 'miniprogram') + path.sep;
const GATE_MS = 30 * 1000;

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

const LETTERS = [
  { id: 'l1', name: '第一封信', theme_id: 'cuican', pinned: false, created_at: Date.now() }
];

function load(opts) {
  const o = Object.assign({ storage: {} }, opts || {});
  for (const k of Object.keys(require.cache)) {
    if (k.indexOf(MINI_ROOT) === 0) delete require.cache[k];
  }

  const state = { calls: [], storage: Object.assign({}, o.storage) };
  const reply = (value, delay) => new Promise((r) => setTimeout(() => r(value), delay || 5));

  const handlers = {
    'today.mailbox': () => reply({ ok: true, letters: LETTERS, draftCount: 0, todayId: '' }),
    'theme.all': () => reply({ ok: true, themes: [] }),
    'member.get': () => reply({ ok: true, membership: { state: 'free', remainingDays: 0 } })
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
    navigateTo() {}
  };

  let def = null;
  global.Page = (d) => { def = d; };
  require(path.join(MINI_ROOT, 'pages', 'home', 'home.js'));
  const letterService = require(path.join(MINI_ROOT, 'services', 'letter.js'));

  const p = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) });
  p.setData = function (patch) {
    for (const key of Object.keys(patch)) this.data[key] = patch[key];
  };
  p.onLoad();

  return {
    state,
    handlers,
    page: p,
    letterService,
    mailboxCalls: () => state.calls.filter((c) => c === 'today.mailbox').length
  };
}

suite('首页 · onShow 时间闸', () => {
  test('g-01 30s 内 onShow 重入短路：不再打 today.mailbox', async () => {
    const h = load();
    h.page.onShow();
    await tick(40); // 等 Promise.all 落定
    eq(h.mailboxCalls(), 1, '首次加载发一次信匣请求');

    h.page.onShow(); // 立刻重入（远小于 30s）
    h.page.onShow();
    eq(h.mailboxCalls(), 1, '30s 内无数据变化，重入不再发请求');
  });

  test('g-02 超过时间闸后 onShow 正常重拉', async () => {
    const h = load();
    h.page.onShow();
    await tick(40);
    // 手工把记账时刻拨回 31s 前（测试不等真实 30s）
    h.page._lastLoadAt = Date.now() - GATE_MS - 1000;
    h.page.onShow();
    await tick(40);
    eq(h.mailboxCalls(), 2, '闸门过期后重入会重新拉取');
  });

  test('g-03 信匣脏标记绕过时间闸，成功加载后消费清除', async () => {
    const h = load();
    h.page.onShow();
    await tick(40);

    // 模拟详情页点亮回形针：letter 服务写操作置脏
    h.letterService.markMailboxDirty();
    h.page.onShow();
    await tick(40);
    eq(h.mailboxCalls(), 2, '脏标记放行，强制重拉');

    // 重拉成功后标记被消费：紧接的 onShow 恢复短路
    h.page.onShow();
    eq(h.mailboxCalls(), 2, '脏标记已消费，不再重复拉取');
    eq(h.state.storage[h.letterService.MAILBOX_DIRTY_KEY], undefined, '标记落库已清除');
  });

  test('g-04 寄出回传绕过时间闸并消费 letter_just_arrived', async () => {
    const h = load();
    h.page.onShow();
    await tick(40);

    h.state.storage['letter_just_arrived'] = 'l1';
    h.page.onShow();
    await tick(40);
    eq(h.mailboxCalls(), 2, '寄出回传放行，重拉信匣');
    eq(h.state.storage['letter_just_arrived'], undefined, '回传标记消费即清除');
  });

  test('g-05 加载失败不落账：下次 onShow 必然重试', async () => {
    const h = load();
    h.handlers['today.mailbox'] = () => Promise.reject(new Error('boom'));
    h.page.onShow();
    await tick(30);
    eq(h.page.data.loading, false, '失败撤下骨架');
    eq(h.page._lastLoadAt, undefined, '失败不写时间闸记账');

    h.handlers['today.mailbox'] = () => Promise.resolve({ ok: true, letters: LETTERS, draftCount: 0, todayId: '' });
    h.page.onShow();
    await tick(40);
    eq(h.mailboxCalls(), 2, '失败后的重入不受闸门拦截，重新拉取');
  });
});
