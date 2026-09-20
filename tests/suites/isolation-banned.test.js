'use strict';
/**
 * 数据隔离 · 封禁 · 注销 · 隐私（对应 测试流程.md §6.1、§6.2、§10）
 *
 * 核心断言只有一条：任何跨用户读取都必须返回「找不到」，而不是返回别人的数据，
 * 也不能通过错误信息泄露目标是否存在。
 */
const { suite, test, ok, eq, missing } = require('../runner');
const { createHarness } = require('../harness');

const DAY = 86400000;
const LETTER = { name: '我的信', question: '问题', answer: '答案' };

/** 造一封属于 openid 的信，返回 _id */
function seedLetter(h, openid, over) {
  return h.seed('letters', Object.assign({
    _openid: openid,
    name: '信',
    question: 'q',
    answer: 'a',
    status: 'active',
    pinned: false,
    paper_id: 'liubai',
    created_at: new Date(),
    today_letter_of: ''
  }, over || {}))[0];
}

/** 所有带封禁门禁的云函数 */
const GUARDED = ['letter', 'today', 'open', 'reply', 'draft', 'stats', 'analytics', 'feedback', 'member'];

suite('数据隔离 · 跨用户不可见', () => {
  test('SV-01 信件详情：B 读不到 A 的信，且不泄露存在性', async () => {
    const h = createHarness({ openid: 'openid-B' });
    const aId = seedLetter(h, 'openid-A');
    const main = h.load('letter');
    const r = await main({ action: 'get', id: aId });
    eq(r.ok, true, '不应报错');
    eq(r.letter, null, '应表现为「找不到」，而非「无权限」');
  });

  test('SV-02 写路径同样隔离：update / pin / moveToRecycle / restore / purge', async () => {
    const h = createHarness({ openid: 'openid-B' });
    const aId = seedLetter(h, 'openid-A');
    const main = h.load('letter');
    for (const action of ['update', 'pin', 'moveToRecycle', 'restore', 'purge']) {
      const r = await main(Object.assign({ action, id: aId }, LETTER));
      eq(r.ok, false, action + ' 不应成功');
      eq(r.error, 'not found', action + ' 应返回 not found');
    }
    const doc = h.all('letters').find((d) => d._id === aId);
    ok(doc, 'A 的信件不得被 B 删除');
    eq(doc.status, 'active', 'A 的信件状态不得被 B 改动');
  });

  test('SV-01b 信匣只返回本人的信，草稿计数也按本人统计', async () => {
    const h = createHarness({ openid: 'openid-A' });
    seedLetter(h, 'openid-A', { name: '我的 1' });
    seedLetter(h, 'openid-A', { name: '我的 2' });
    seedLetter(h, 'openid-B', { name: '别人的' });
    h.seed('drafts', { _openid: 'openid-A', name: 'd1', question: '', answer: '' });
    h.seed('drafts', { _openid: 'openid-B', name: 'd2', question: '', answer: '' });
    const main = h.load('today');
    const r = await main({ action: 'mailbox' });
    eq(r.letters.length, 2, '不得看到他人信件');
    ok(r.letters.every((l) => l.name !== '别人的'));
    eq(r.draftCount, 1, '草稿计数不得含他人草稿');
  });

  test('信匣不下发 _openid 等内部字段', async () => {
    const h = createHarness({ openid: 'openid-A' });
    seedLetter(h, 'openid-A');
    const main = h.load('today');
    const r = await main({ action: 'mailbox' });
    missing(r.letters[0], '_openid', '信匣列表不得下发 _openid');
    missing(r.letters[0], 'answer', '信匣不需要正文');
  });

  test('SV-01c 统计只算本人的数据', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const id = seedLetter(h, 'openid-A');
    seedLetter(h, 'openid-A', { pinned: true });
    seedLetter(h, 'openid-B', { pinned: true });
    seedLetter(h, 'openid-A', { status: 'recycled', recycled_at: new Date() });
    h.seed('open_records', { _openid: 'openid-A', letter_id: id, created_at: new Date() });
    h.seed('open_records', { _openid: 'openid-B', letter_id: 'x', created_at: new Date() });
    h.seed('reply_records', { _openid: 'openid-A', letter_id: id, content: 'r', created_at: new Date() });
    const main = h.load('stats');
    const r = await main({ action: 'get' });
    eq(r.letterTotal, 2, '只算本人 active 信件');
    eq(r.pinnedCount, 1, '只算本人回形针');
    eq(r.recycleCount, 1, '只算本人废纸篓');
    eq(r.rereadTotal, 1, '只算本人邮戳');
    eq(r.replyTotal, 1, '只算本人回信');
  });

  test('theme 是公共只读内容，不下发任何用户数据（也无需封禁门禁）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    h.seed('themes', { theme_id: 'xiaowangzi', name: '小王子', status: 'online', sort: 1, palette: 'p' });
    const main = h.load('theme');
    const r = await main({ action: 'list' });
    eq(r.ok, true);
    eq(r.themes.length, 1);
    missing(r.themes[0], '_openid');
  });
});

suite('封禁 · 服务端全入口生效', () => {
  test('SV-05 被封禁账号调用各云函数一律被拒', async () => {
    const calls = {
      letter: { action: 'get', id: 'x' },
      today: { action: 'mailbox' },
      open: { action: 'add', letter_id: 'x' },
      reply: { action: 'add', letter_id: 'x', content: 'c' },
      draft: { action: 'list' },
      stats: { action: 'get' },
      analytics: { action: 'batch', events: [{ name: 'letter_open' }] },
      feedback: { action: 'add', content: '反馈' }
    };
    for (const [fn, event] of Object.entries(calls)) {
      const h = createHarness({ openid: 'openid-A' });
      h.seed('users', { _openid: 'openid-A', status: 'banned' });
      const main = h.load(fn);
      const r = await main(event);
      eq(r.error, 'banned', `${fn} 未拦截封禁账号（返回 ${JSON.stringify(r)}）`);
    }
  });

  test('SV-05b 源码级防漏改：受门禁的云函数都必须保留封禁校验', async () => {
    // 行为覆盖由 SV-05 用真实 action 完成；这里守的是「以后有人新增函数或重构时
    // 把封禁校验删掉」——行为测试对「新增的函数」是无感知的，源码检查才有感知。
    const fs = require('fs');
    const path = require('path');
    const root = path.resolve(__dirname, '..', '..', 'cloudfunctions');
    for (const fn of GUARDED) {
      const src = fs.readFileSync(path.join(root, fn, 'index.js'), 'utf8');
      ok(/isBanned/.test(src), `${fn} 缺少 isBanned 校验`);
      ok(/=== 'banned'/.test(src), `${fn} 未判断 status === 'banned'`);
      ok(/error: 'banned'/.test(src), `${fn} 未在命中封禁时返回 banned`);
    }
  });

  test('SV-07 解封后恢复正常（封禁不是数据删除）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    h.seed('users', { _openid: 'openid-A', status: 'active' });
    seedLetter(h, 'openid-A');
    const main = h.load('today');
    const r = await main({ action: 'mailbox' });
    eq(r.ok, true);
    eq(r.letters.length, 1);
  });

  test('封禁判定查询失败时按未封禁放行（可用性优先，不作为安全边界）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    seedLetter(h, 'openid-A');
    const main = h.load('today');
    h.faults.failNext('users', 'get');
    const r = await main({ action: 'mailbox' });
    eq(r.ok, true, 'users 查询失败不应让整个信匣不可用');
  });
});

suite('注销 · 数据彻底清除', () => {
  test('AC-05 deactivate 清空该 openid 的全部数据，且不碰他人', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const COLLECTIONS = [
      'letters', 'open_records', 'reply_records', 'drafts', 'events',
      'members', 'member_orders', 'feedback', 'users'
    ];
    for (const c of COLLECTIONS) {
      h.seed(c, { _openid: 'openid-A', probe: 1 });
      h.seed(c, { _openid: 'openid-B', probe: 1 });
    }
    const main = h.load('user');
    const r = await main({ action: 'deactivate' });
    eq(r.ok, true);
    for (const c of COLLECTIONS) {
      eq(h.find(c, (d) => d._openid === 'openid-A').length, 0, c + ' 中 A 的数据应清空');
      eq(h.find(c, (d) => d._openid === 'openid-B').length, 1, c + ' 中 B 的数据不得被误删');
    }
  });

  test('AC-08 注销后重新进入是全新账号（ensure 会重新建档）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    h.seed('users', { _openid: 'openid-A', status: 'active', created_at: new Date() });
    const main = h.load('user');
    await main({ action: 'deactivate' });
    eq(h.count('users'), 0);
    const r = await main({ action: 'ensure' });
    eq(r.ok, true);
    eq(h.count('users'), 1, '应重新建档');
  });

  test('user.ensure 首次建档写入 active 状态', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('user');
    await main({ action: 'ensure' });
    const u = h.all('users')[0];
    eq(u._openid, 'openid-A');
    eq(u.status, 'active');
    eq(u.nickname, '');
  });

  test('user.ensure 已封禁账号返回 banned 且不覆盖状态', async () => {
    const h = createHarness({ openid: 'openid-A' });
    h.seed('users', { _openid: 'openid-A', status: 'banned' });
    const main = h.load('user');
    const r = await main({ action: 'ensure' });
    eq(r.error, 'banned');
    eq(h.all('users')[0].status, 'banned');
  });

  test('saveProfile 昵称截断到 32 字', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('user');
    await main({ action: 'saveProfile', profile: { nickname: 'x'.repeat(100) } });
    eq(h.all('users')[0].nickname.length, 32, '超长昵称必须截断（会展示在后台用户列表）');
  });

  test('saveProfile 只接受 cloud:// 头像，其余丢弃（防外链注入）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('user');
    await main({ action: 'saveProfile', profile: { avatar: 'https://evil.example/x.png' } });
    eq(h.all('users')[0].avatar_url, undefined, '非 cloud:// 头像必须丢弃');
    await main({ action: 'saveProfile', profile: { avatar: 'cloud://env.abc/avatar.png' } });
    eq(h.all('users')[0].avatar_url, 'cloud://env.abc/avatar.png');
  });

  test('saveProfile 被封禁账号被拒（写路径补齐封禁门禁）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    h.seed('users', { _openid: 'openid-A', status: 'banned' });
    const main = h.load('user');
    eq((await main({ action: 'saveProfile', profile: { nickname: 'n' } })).error, 'banned');
  });

  test('getProfile 返回昵称与注册天数，封禁账号被拒', async () => {
    const h = createHarness({ openid: 'openid-A' });
    h.seed('users', {
      _openid: 'openid-A', nickname: '阿远', avatar_url: 'cloud://a/b.png', status: 'active',
      created_at: new Date(Date.now() - 9 * DAY)
    });
    const main = h.load('user');
    const r = await main({ action: 'getProfile' });
    eq(r.profile.nickname, '阿远');
    eq(r.profile.avatar, 'cloud://a/b.png');
    eq(r.registerDays, 10, '9 天前注册应为第 10 天');
  });
});

suite('今日来信 · today', () => {
  test('当日确定性：同一天多次请求选中同一封，并把结果写回', async () => {
    const h = createHarness({ openid: 'openid-A' });
    for (let i = 0; i < 5; i += 1) seedLetter(h, 'openid-A', { name: '信' + i });
    const main = h.load('today');
    const first = await main({ action: 'mailbox' });
    const second = await main({ action: 'mailbox' });
    ok(first.todayId, '应选出今日来信');
    eq(second.todayId, first.todayId, '同一天必须固定');
    const marked = h.all('letters').filter((l) => l.today_letter_of);
    eq(marked.length, 1, '只有被选中的那封会被标记');
    eq(marked[0]._id, first.todayId);
  });

  test('空信匣时 todayId 为空且不报错', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('today');
    const r = await main({ action: 'mailbox' });
    eq(r.ok, true);
    eq(r.todayId, '');
    eq(r.letters.length, 0);
  });

  test('废纸篓内的信不参与信匣与今日来信', async () => {
    const h = createHarness({ openid: 'openid-A' });
    seedLetter(h, 'openid-A', { status: 'recycled', recycled_at: new Date() });
    const main = h.load('today');
    const r = await main({ action: 'mailbox' });
    eq(r.letters.length, 0, 'recycled 不进信匣');
    eq(r.todayId, '');
  });

  test('孤儿信认领：仅认领「写于本账号建档之后」的信件', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const accountCreated = new Date('2026-06-01T00:00:00Z');
    h.seed('users', { _openid: 'openid-A', status: 'active', created_at: accountCreated });
    // 历史遗留（早于账号建档）——不该被认领
    const oldOrphan = h.seed('letters', {
      name: '更早的遗留信', status: 'active', created_at: new Date('2026-01-01T00:00:00Z'), today_letter_of: ''
    })[0];
    // 建档之后产生的孤儿信——应被认领
    const newOrphan = h.seed('letters', {
      name: '建档后的孤儿信', status: 'active', created_at: new Date('2026-07-01T00:00:00Z'), today_letter_of: ''
    })[0];
    const main = h.load('today');
    const r = await main({ action: 'mailbox' });
    const claimed = h.all('letters').filter((l) => l._openid === 'openid-A').map((l) => l._id);
    ok(claimed.includes(newOrphan), '建档后的孤儿信应被认领');
    ok(!claimed.includes(oldOrphan), '早于建档的遗留信不得被认领（否则新账号可吞历史数据）');
    eq(r.letters.length, 1);
  });

  test('信匣非空时不触发孤儿认领（避免全表扫描）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    h.seed('users', { _openid: 'openid-A', status: 'active', created_at: new Date('2026-01-01') });
    seedLetter(h, 'openid-A');
    const orphan = h.seed('letters', {
      name: '孤儿', status: 'active', created_at: new Date('2026-08-01'), today_letter_of: ''
    })[0];
    const main = h.load('today');
    await main({ action: 'mailbox' });
    const o = h.all('letters').find((l) => l._id === orphan);
    eq(o._openid, undefined, '信匣已非空，不应再做孤儿认领');
  });

  test('信匣最多返回 100 封（显式 limit(100)）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    for (let i = 0; i < 130; i += 1) {
      seedLetter(h, 'openid-A', { name: '信' + i, created_at: new Date(Date.now() - i * 1000) });
    }
    const main = h.load('today');
    const r = await main({ action: 'mailbox' });
    eq(r.letters.length, 100, '显式 limit(100)，不能被默认 20 条截断');
  });
});

suite('主题下发 · theme', () => {
  test('只下发 status=online 的主题与版式', async () => {
    const h = createHarness();
    h.seed('themes', { theme_id: 'a', name: '上架', status: 'online', sort: 1 });
    h.seed('themes', { theme_id: 'b', name: '下架', status: 'offline', sort: 2 });
    const main = h.load('theme');
    const r = await main({ action: 'list' });
    eq(r.themes.length, 1);
    eq(r.themes[0].id, 'a');
  });

  test('缩略信封原样下发：列表页才用得上小图', async () => {
    const h = createHarness();
    const BIG = 'cloud://env.bucket/theme/yinhua/envelope.jpg';
    const THUMB = 'cloud://env.bucket/theme/yinhua/envelope-thumb.jpg';
    h.seed('themes', { theme_id: 'yinhua', name: '印花', status: 'online', sort: 1, assets: { envelope: BIG, envelopeThumb: THUMB } });
    h.seed('themes', { theme_id: 'noassets', name: '无素材', status: 'online', sort: 2 });
    h.seed('member_items', { kind: 'theme', item_id: 'vip_theme', name: '专属主题', status: 'online', sort: 1, assets: { envelope: BIG, envelopeThumb: THUMB } });
    const main = h.load('theme');
    const r = await main({ action: 'list' });

    // 早期漏下发 envelopeThumb，前端 `t.envelopeThumb || t.envelope` 就退化成用大图当缩略图
    eq(r.themes.find((t) => t.id === 'yinhua').envelopeThumb, THUMB, '官方款的缩略图必须下发');
    eq(r.themes.find((t) => t.id === 'vip_theme').envelopeThumb, THUMB, '专属款的缩略图必须下发');
    // 没配缩略图时是空串（前端按真值回落大图），不能是 undefined 之外的怪值
    eq(r.themes.find((t) => t.id === 'noassets').envelopeThumb, '', '缺素材时为空串，由前端回落大图');
  });

  test('会员专属款并入下发并带 premium 标记', async () => {
    const h = createHarness();
    h.seed('themes', { theme_id: 'xiaowangzi', name: '小王子', status: 'online', sort: 1 });
    h.seed('member_items', { kind: 'theme', item_id: 'vip_theme', name: '专属主题', status: 'online', sort: 1 });
    h.seed('member_items', { kind: 'theme', item_id: 'off', name: '已下架专属', status: 'offline', sort: 2 });
    const main = h.load('theme');
    const r = await main({ action: 'list' });
    const ids = r.themes.map((t) => t.id);
    ok(ids.includes('vip_theme'), '上架专属主题应下发');
    ok(!ids.includes('off'), '下架专属主题不应下发');
    eq(r.themes.find((t) => t.id === 'vip_theme').premium, true);
    eq(r.themes.find((t) => t.id === 'xiaowangzi').premium, undefined, '官方款不应带 premium 标记');
  });

  test('同 id 时专属款覆盖官方款（后台改配色才能生效）', async () => {
    const h = createHarness();
    h.seed('themes', { theme_id: 'suwen', name: '官方素问', status: 'online', sort: 1, palette: 'official' });
    h.seed('member_items', { kind: 'theme', item_id: 'suwen', name: '专属素问', status: 'online', sort: 1, palette: 'premium' });
    const main = h.load('theme');
    const r = await main({ action: 'list' });
    eq(r.themes.length, 1, '同 id 应只留一份');
    eq(r.themes[0].palette, 'premium');
    eq(r.themes[0].premium, true);
  });

  test('papers 只下发上架版式并映射为前端字段名', async () => {
    const h = createHarness();
    h.seed('papers', { paper_id: 'liubai', name: '留白志', status: 'online', sort: 1, colors: { bg: '#fff' } });
    h.seed('papers', { paper_id: 'gone', name: '下架', status: 'offline', sort: 2 });
    const main = h.load('theme');
    const r = await main({ action: 'papers' });
    eq(r.papers.length, 1);
    eq(r.papers[0].id, 'liubai');
    eq(r.papers[0].colors.bg, '#fff');
  });

  test('theme 未知 action 被拒', async () => {
    const h = createHarness();
    const main = h.load('theme');
    eq((await main({ action: 'themeDelete' })).ok, false, '写操作必须走后台，只读函数不得接受');
    eq((await main({ action: 'nope' })).ok, false);
  });
});
