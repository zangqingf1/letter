'use strict';
/**
 * 数据规则（对应 测试流程.md §5.2 / §5.4 / §5.6、§6.3、§6.4）
 * 覆盖 letter / open / reply / cleaner / draft 的业务不变量与输入兜底。
 */
const { suite, test, ok, eq, missing } = require('../runner');
const { createHarness } = require('../harness');

const DAY = 86400000;
const LETTER = { name: '给三年后的我', question: '当时为什么离开？', answer: '因为想看看别处的天。' };

// 与云函数 dateKeyOf 同口径的本地日期键（toISOString 是 UTC，北京时间过了零点就差一天）
function localDateKey() {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}

async function makeLetter(main, over) {
  const r = await main(Object.assign({ action: 'create' }, LETTER, over || {}));
  return r.id;
}

suite('信件规则 · letter', () => {
  test('create 三项必填，缺一即拒', async () => {
    const h = createHarness();
    const main = h.load('letter');
    eq((await main({ action: 'create', name: 'a', question: 'b' })).ok, false);
    eq((await main({ action: 'create', name: '', question: 'b', answer: 'c' })).ok, false);
    eq((await main({ action: 'create', name: '   ', question: 'b', answer: 'c' })).ok, false, '纯空白不算填写');
    eq(h.count('letters'), 0, '被拒的请求不得落库');
  });

  test('create 非字符串类型被拒（挡住对象/数组注入）', async () => {
    const h = createHarness();
    const main = h.load('letter');
    const r = await main({ action: 'create', name: { $ne: null }, question: 'b', answer: 'c' });
    eq(r.ok, false);
    eq(h.count('letters'), 0);
  });

  test('字数上限：名称 20 / 问题 500 / 答案 2000，边界内通过', async () => {
    const h = createHarness();
    const main = h.load('letter');

    const okName = await main({ action: 'create', name: 'x'.repeat(20), question: 'q', answer: 'a' });
    eq(okName.ok, true, '名称 20 字应通过');
    const badName = await main({ action: 'create', name: 'x'.repeat(21), question: 'q', answer: 'a' });
    eq(badName.ok, false, '名称 21 字应被拒');

    eq((await main({ action: 'create', name: 'n', question: 'q'.repeat(500), answer: 'a' })).ok, true);
    eq((await main({ action: 'create', name: 'n', question: 'q'.repeat(501), answer: 'a' })).ok, false);

    eq((await main({ action: 'create', name: 'n', question: 'q', answer: 'a'.repeat(2000) })).ok, true);
    eq((await main({ action: 'create', name: 'n', question: 'q', answer: 'a'.repeat(2001) })).ok, false);
  });

  test('原文存储零加工：首尾空白不被 trim', async () => {
    const h = createHarness();
    const main = h.load('letter');
    await main({ action: 'create', name: '  有空格  ', question: ' q ', answer: ' a ' });
    const doc = h.all('letters')[0];
    eq(doc.name, '  有空格  ', '产品原则：用户内容保持原文');
  });

  test('create 显式落 _openid，并写入默认 status/pinned', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    await makeLetter(main);
    const doc = h.all('letters')[0];
    eq(doc._openid, 'openid-A', '云函数不自动补 _openid，必须显式写');
    eq(doc.status, 'active');
    eq(doc.pinned, false);
    eq(doc.purge_at, null);
  });

  test('create 未传版式时回落默认款 liubai', async () => {
    const h = createHarness();
    const main = h.load('letter');
    await makeLetter(main);
    eq(h.all('letters')[0].paper_id, 'liubai');
  });

  test('get 拼装信件 + 邮戳 + 回信，且不下发 _openid', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    const id = await makeLetter(main, { paper_id: 'vinyl', paper_version: 3, theme_id: 'moye' });
    h.seed('open_records', { _openid: 'openid-A', letter_id: id, created_at: new Date('2026-01-01') });
    h.seed('reply_records', { _openid: 'openid-A', letter_id: id, content: '回头看，值得。', created_at: new Date('2026-02-02') });

    const r = await main({ action: 'get', id });
    eq(r.ok, true);
    eq(r.letter.name, LETTER.name);
    eq(r.letter.paper_id, 'vinyl');
    eq(r.letter.theme_id, 'moye');
    eq(r.letter.opens.length, 1);
    eq(r.letter.replies.length, 1);
    eq(r.letter.replies[0].text, '回头看，值得。');
    missing(r.letter, '_openid', '信件详情不得下发 _openid');
    missing(r.letter, 'status');
    missing(r.letter, 'purge_at');
  });

  test('get 不存在的信件返回 letter:null（不报错）', async () => {
    const h = createHarness();
    const main = h.load('letter');
    const r = await main({ action: 'get', id: 'no-such-id' });
    eq(r.ok, true);
    eq(r.letter, null);
  });

  test('get 废纸篓内的信件不可读（只保留恢复能力）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    const id = await makeLetter(main);
    await main({ action: 'moveToRecycle', id });
    const r = await main({ action: 'get', id });
    eq(r.letter, null, 'recycled 信件不得有阅读入口');
  });

  test('update 只改内容与版式，并记 updated_at', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    const id = await makeLetter(main, { theme_id: 'xiaowangzi', paper_id: 'suwen' });
    const r = await main({ action: 'update', id, name: '改名', question: '改问', answer: '改答' });
    eq(r.ok, true);
    const doc = h.all('letters').find((d) => d._id === id);
    eq(doc.name, '改名');
    eq(doc.theme_id, 'xiaowangzi', '未传主题时应保留原值');
    eq(doc.paper_id, 'suwen', '未传版式时应保留原值');
    ok(doc.updated_at, 'update 应写 updated_at');
    eq(doc.created_at.getTime(), doc.created_at.getTime(), 'created_at 不应被改写');
  });

  test('update 也做必填与长度兜底', async () => {
    const h = createHarness();
    const main = h.load('letter');
    const id = await makeLetter(main);
    eq((await main({ action: 'update', id, name: '', question: 'q', answer: 'a' })).ok, false);
    eq((await main({ action: 'update', id, name: 'n', question: 'q', answer: 'a'.repeat(2001) })).ok, false);
  });

  test('pin 只改排序语义，不动数据归属', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    const id = await makeLetter(main);
    eq((await main({ action: 'pin', id, pinned: true })).pinned, true);
    let doc = h.all('letters')[0];
    eq(doc.pinned, true);
    eq(doc._openid, 'openid-A', 'pin 不得改归属');
    await main({ action: 'pin', id, pinned: false });
    doc = h.all('letters')[0];
    eq(doc.pinned, false);
  });

  test('moveToRecycle 置 purge_at = 删除时间 + 30 天，并清今日来信标记', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    const id = await makeLetter(main);
    h.seed('letters', []); // no-op，保持调用形态清晰
    const before = Date.now();
    await main({ action: 'moveToRecycle', id });
    const doc = h.all('letters').find((d) => d._id === id);
    eq(doc.status, 'recycled');
    eq(doc.today_letter_of, '', '进废纸篓后不应再被今日来信选中');
    const purge = new Date(doc.purge_at).getTime();
    ok(Math.abs(purge - (before + 30 * DAY)) < 5000, '保留期应为 30 天，实际 ' + doc.purge_at);
  });

  test('restore 原样恢复为 active 并清空保留期', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    const id = await makeLetter(main);
    await main({ action: 'moveToRecycle', id });
    await main({ action: 'restore', id });
    const doc = h.all('letters').find((d) => d._id === id);
    eq(doc.status, 'active');
    eq(doc.recycled_at, null);
    eq(doc.purge_at, null);
  });

  test('restore 后重读记录与回信原样保留（独立集合未动）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    const id = await makeLetter(main);
    h.seed('open_records', { _openid: 'openid-A', letter_id: id, created_at: new Date() });
    h.seed('reply_records', { _openid: 'openid-A', letter_id: id, content: '回信', created_at: new Date() });
    await main({ action: 'moveToRecycle', id });
    await main({ action: 'restore', id });
    const r = await main({ action: 'get', id });
    eq(r.letter.opens.length, 1, '取回后邮戳应还在');
    eq(r.letter.replies.length, 1, '取回后回信应还在');
  });

  test('listRecycle 只返回本人的废纸篓信件，且带 deleted_at', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    const mine = await makeLetter(main);
    await main({ action: 'moveToRecycle', id: mine });
    h.seed('letters', {
      _openid: 'openid-B',
      name: '别人的信',
      status: 'recycled',
      recycled_at: new Date(),
      purge_at: new Date(Date.now() + 10 * DAY)
    });
    const r = await main({ action: 'listRecycle' });
    eq(r.items.length, 1, '不得看到他人废纸篓');
    eq(r.items[0].id, mine);
    ok(typeof r.items[0].deleted_at === 'number');
  });

  test('listRecycle 兜底清理已到期信件（cleaner 之外的第二条通道）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    const expired = h.seed('letters', {
      _openid: 'openid-A',
      name: '过期信',
      status: 'recycled',
      recycled_at: new Date(Date.now() - 31 * DAY),
      purge_at: new Date(Date.now() - DAY)
    })[0];
    const fresh = h.seed('letters', {
      _openid: 'openid-A',
      name: '还在期',
      status: 'recycled',
      recycled_at: new Date(),
      purge_at: new Date(Date.now() + 29 * DAY)
    })[0];
    h.seed('open_records', { _openid: 'openid-A', letter_id: expired, created_at: new Date() });

    const r = await main({ action: 'listRecycle' });
    eq(r.items.length, 1, '到期信件应被兜底清掉');
    eq(r.items[0].id, fresh);
    eq(h.find('letters', (d) => d._id === expired).length, 0);
    eq(h.find('open_records', (o) => o.letter_id === expired).length, 0, '邮戳应一并清理');
  });

  test('listRecycle 不被默认 20 条截断', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    for (let i = 0; i < 25; i += 1) {
      h.seed('letters', {
        _openid: 'openid-A',
        name: '信' + i,
        status: 'recycled',
        recycled_at: new Date(Date.now() - i * 1000),
        purge_at: new Date(Date.now() + 20 * DAY)
      });
    }
    const r = await main({ action: 'listRecycle' });
    eq(r.items.length, 25, '显式 limit(1000) 应返回全部，不能被 20 条静默截断');
  });

  test('purge 物理删除信件及其邮戳与回信，不可恢复', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    const id = await makeLetter(main);
    h.seed('open_records', { _openid: 'openid-A', letter_id: id, created_at: new Date() });
    h.seed('reply_records', { _openid: 'openid-A', letter_id: id, content: 'x', created_at: new Date() });
    await main({ action: 'moveToRecycle', id });
    const r = await main({ action: 'purge', id });
    eq(r.ok, true);
    eq(h.find('letters', (d) => d._id === id).length, 0);
    eq(h.find('open_records', (o) => o.letter_id === id).length, 0);
    eq(h.find('reply_records', (o) => o.letter_id === id).length, 0);
  });

  test('未经手 moveToRecycle 也可 purge（彻底删除不依赖状态）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    const id = await makeLetter(main);
    eq((await main({ action: 'purge', id })).ok, true);
    eq(h.count('letters'), 0);
  });

  test('未知 action 被拒', async () => {
    const h = createHarness();
    const main = h.load('letter');
    const r = await main({ action: 'purgeAll' });
    eq(r.ok, false);
    ok(/unknown action/.test(r.error));
  });
});

suite('重读记录 · open', () => {
  test('SV-09 同日重复拆信只产生一条邮戳（幂等）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const letterMain = h.load('letter');
    const id = await makeLetter(letterMain);
    const main = h.load('open');

    const first = await main({ action: 'add', letter_id: id });
    eq(first.ok, true);
    eq(first.opens.length, 1);
    const second = await main({ action: 'add', letter_id: id });
    eq(second.opens.length, 1, '同日第二次拆信不得新增邮戳');
    const third = await main({ action: 'add', letter_id: id });
    eq(third.opens.length, 1);
    eq(h.count('open_records'), 1, '库里只应有一条记录');
  });

  test('open 记录使用确定性 _id（并发同投时靠主键冲突兜底）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const letterMain = h.load('letter');
    const id = await makeLetter(letterMain);
    const main = h.load('open');
    await main({ action: 'add', letter_id: id });
    const rec = h.all('open_records')[0];
    const expect = require('crypto').createHash('md5').update('openid-A|' + id + '|' + rec.open_date).digest('hex');
    eq(rec._id, expect, '邮件戳 _id 应为 md5(openid|letterId|date)');
  });

  test('open 记录不能挂到别人的信件上', async () => {
    const h = createHarness({ openid: 'openid-B' });
    h.seed('letters', { _openid: 'openid-A', name: 'A 的信', status: 'active', created_at: new Date() });
    const id = h.all('letters')[0]._id;
    const main = h.load('open');
    const r = await main({ action: 'add', letter_id: id });
    eq(r.ok, false);
    eq(r.error, 'not found', '不得泄露他人信件是否存在');
    eq(h.count('open_records'), 0);
  });

  test('open 对不存在的信件返回 not found', async () => {
    const h = createHarness();
    const main = h.load('open');
    eq((await main({ action: 'add', letter_id: 'nope' })).error, 'not found');
  });

  test('旧数据自愈：无 _openid 的遗留信件被当前用户认领', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const id = h.seed('letters', { name: '无主信', status: 'active', created_at: new Date() })[0];
    const main = h.load('open');
    const r = await main({ action: 'add', letter_id: id });
    eq(r.ok, true, '遗留信件应被认领');
    eq(h.all('letters')[0]._openid, 'openid-A');
  });

  test('open 未认证 action 被拒', async () => {
    const h = createHarness();
    const main = h.load('open');
    eq((await main({ action: 'list' })).ok, false);
  });
});

// 详情页拆信改走 letter.get 的 record 参数（同一次调用里记录 + 返回邮戳，渲染不再等第二轮
// 云函数往返）。这里守两条：① 记的邮戳与 open.add 完全同口径；② 预览/分享不带 record 时
// 一枚邮戳都不许产生 —— 预览不是拆信，埋错等于污染用户的邮戳墙。
suite('重读记录 · letter.get 合并记录', () => {
  test('record=true 时同一次调用内落今日邮戳并随信返回', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    const id = await makeLetter(main);

    const r = await main({ action: 'get', id, record: true });
    eq(r.ok, true);
    eq(r.letter.opens.length, 1, '拆信应带回今天这枚邮戳');
    eq(h.count('open_records'), 1);

    const rec = h.all('open_records')[0];
    const expect = require('crypto').createHash('md5').update('openid-A|' + id + '|' + rec.open_date).digest('hex');
    eq(rec._id, expect, '与 open.add 同一套确定性 _id（并发同投靠主键冲突兜底）');
    eq(rec._openid, 'openid-A');
  });

  test('同一天重复拆信仍只有一枚邮戳（幂等）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    const id = await makeLetter(main);

    await main({ action: 'get', id, record: true });
    const again = await main({ action: 'get', id, record: true });
    eq(again.letter.opens.length, 1);
    eq(h.count('open_records'), 1);
  });

  test('不带 record 不产生邮戳（分享/预览不是拆信）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    const id = await makeLetter(main);

    const r = await main({ action: 'get', id });
    eq(r.ok, true);
    eq(r.letter.opens.length, 0);
    eq(h.count('open_records'), 0, '预览不得记重读');

    // 只认严格 true：'true' / 1 这类真值不算拆信（防调用方想当然传参）
    await main({ action: 'get', id, record: 'true' });
    await main({ action: 'get', id, record: 1 });
    eq(h.count('open_records'), 0);
  });

  test('今天已有一条旧记录（随机 _id、无 open_date）时不重复写', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    const id = await makeLetter(main);
    h.seed('open_records', { _openid: 'openid-A', letter_id: id, created_at: new Date() });

    const r = await main({ action: 'get', id, record: true });
    eq(r.letter.opens.length, 1, '今天已有邮戳，直接返回现有列表');
    eq(h.count('open_records'), 1, '不得因 _id 形态不同而写出第二条');
  });

  test('邮戳写失败不影响读信（只少一枚戳，信件照常返回）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('letter');
    const id = await makeLetter(main);
    h.faults.failNext('open_records', 'add');

    const r = await main({ action: 'get', id, record: true });
    eq(r.ok, true, '记录邮戳失败不该让整封信读不出来');
    eq(r.letter.name, LETTER.name);
    eq(r.letter.opens.length, 0);
    eq(h.count('open_records'), 0);
  });

  test('别人的信：record=true 也拿不到信，更不会落邮戳', async () => {
    const h = createHarness({ openid: 'openid-B' });
    const main = h.load('letter');
    h.seed('letters', { _openid: 'openid-A', name: 'A 的信', status: 'active', created_at: new Date() });
    const id = h.all('letters')[0]._id;

    const r = await main({ action: 'get', id, record: true });
    eq(r.ok, true);
    eq(r.letter, null, '不得泄露他人信件');
    eq(h.count('open_records'), 0);
  });
});

suite('回信 · reply', () => {
  async function setup(openid = 'openid-A') {
    const h = createHarness({ openid });
    const letterMain = h.load('letter');
    const id = await makeLetter(letterMain);
    const main = h.load('reply');
    return { h, id, main };
  }

  test('add 服务端生成 reply_date，接口不接受自定义日期', async () => {
    const { h, id, main } = await setup();
    const r = await main({ action: 'add', letter_id: id, content: '三年后我懂了。', reply_date: '1999-01-01' });
    eq(r.ok, true);
    eq(r.replies.length, 1);
    const rec = h.all('reply_records')[0];
    eq(rec.reply_date, localDateKey(), '日期必须服务端生成，忽略入参');
  });

  test('add 空内容与纯空白被拒', async () => {
    const { id, main } = await setup();
    eq((await main({ action: 'add', letter_id: id, content: '' })).error, 'content required');
    eq((await main({ action: 'add', letter_id: id, content: '    ' })).error, 'content required');
    eq((await main({ action: 'add', letter_id: id, content: { a: 1 } })).error, 'content required');
  });

  test('add 300 字上限，边界内通过且原文保留', async () => {
    const { h, id, main } = await setup();
    eq((await main({ action: 'add', letter_id: id, content: 'x'.repeat(300) })).ok, true);
    eq((await main({ action: 'add', letter_id: id, content: 'x'.repeat(301) })).error, 'content too long');
    eq(h.all('reply_records')[0].content.length, 300);
  });

  test('add 首尾空白保留原文（仅用于空值判断）', async () => {
    const { h, id, main } = await setup();
    await main({ action: 'add', letter_id: id, content: '  有空白  ' });
    eq(h.all('reply_records')[0].content, '  有空白  ');
  });

  test('废纸篓内的信件不可新增回信', async () => {
    const { h, id, main } = await setup();
    const letterMain = h.load('letter');
    await letterMain({ action: 'moveToRecycle', id });
    const r = await main({ action: 'add', letter_id: id, content: '还能写吗' });
    eq(r.ok, false);
    eq(r.error, 'letter not active');
    eq(h.count('reply_records'), 0);
  });

  test('remove 按时间戳撕掉单条，其余保留', async () => {
    const { h, id, main } = await setup();
    h.seed('reply_records', { _openid: 'openid-A', letter_id: id, content: '第一条', created_at: new Date('2026-01-01T00:00:00Z') });
    h.seed('reply_records', { _openid: 'openid-A', letter_id: id, content: '第二条', created_at: new Date('2026-02-02T00:00:00Z') });
    const target = new Date('2026-01-01T00:00:00Z').getTime();
    const r = await main({ action: 'remove', letter_id: id, ts: target });
    eq(r.ok, true);
    eq(r.replies.length, 1);
    eq(r.replies[0].text, '第二条');
    eq(h.all('reply_records')[0].content, '第二条');
  });

  test('remove 找不到目标时明确报错（不静默成功）', async () => {
    const { id, main } = await setup();
    const r = await main({ action: 'remove', letter_id: id, ts: 1234567890 });
    eq(r.ok, false);
    eq(r.error, 'reply not found');
  });

  test('不得撕掉他人信件下的回信', async () => {
    const h = createHarness({ openid: 'openid-B' });
    const aId = h.seed('letters', { _openid: 'openid-A', name: 'A 信', status: 'active', created_at: new Date() })[0];
    h.seed('reply_records', { _openid: 'openid-A', letter_id: aId, content: 'A 的回信', created_at: new Date('2026-01-01') });
    const main = h.load('reply');
    const r = await main({ action: 'remove', letter_id: aId, ts: new Date('2026-01-01').getTime() });
    eq(r.ok, false);
    eq(h.count('reply_records'), 1, 'A 的回信必须还在');
  });

  test('回信流不被默认 20 条截断', async () => {
    const { h, id, main } = await setup();
    for (let i = 0; i < 25; i += 1) {
      h.seed('reply_records', {
        _openid: 'openid-A',
        letter_id: id,
        content: '回信' + i,
        created_at: new Date(Date.now() - (25 - i) * 1000)
      });
    }
    const r = await main({ action: 'add', letter_id: id, content: '第 26 条' });
    eq(r.replies.length, 26, '回信流应完整返回');
  });
});

// 详情页写回信改走 letter 云函数的 addReply/removeReply（拆信时该函数已是热实例，
// 省掉独立 reply 函数每次会话首次写回信的冷启动）。两个入口必须完全可互换：同一条回信
// 谁写的都要能被另一边读到、按同一个 ts 撕掉 —— 这条是本次合并最容易出错的地方。
suite('回信 · 两个写入入口（letter 与 reply 口径一致）', () => {
  async function setup() {
    const h = createHarness({ openid: 'openid-A' });
    const letterMain = h.load('letter');
    const id = await makeLetter(letterMain);
    return { h, id, letterMain, replyMain: h.load('reply') };
  }

  test('letter.addReply 落库并返回回信流，归属与日期都由服务端写', async () => {
    const { h, id, letterMain } = await setup();
    const r = await letterMain({ action: 'addReply', id, content: '三年后我懂了。', reply_date: '1999-01-01' });
    eq(r.ok, true);
    eq(r.replies.length, 1);
    eq(r.replies[0].text, '三年后我懂了。');
    const rec = h.all('reply_records')[0];
    eq(rec._openid, 'openid-A');
    eq(rec.letter_id, id);
    eq(rec.reply_date, localDateKey(), '日期服务端生成，忽略入参');
  });

  test('letter 写入的回信能被 reply 撕掉，reply 写入的也能被 letter 撕掉', async () => {
    const { h, id, letterMain, replyMain } = await setup();

    const added = await letterMain({ action: 'addReply', id, content: '第一条' });
    const ts1 = added.replies[0].ts;
    eq((await replyMain({ action: 'remove', letter_id: id, ts: ts1 })).ok, true, 'reply 应能按 letter 给的 ts 撕掉');
    eq(h.count('reply_records'), 0);

    const viaReply = await replyMain({ action: 'add', letter_id: id, content: '第二条' });
    const ts2 = viaReply.replies[0].ts;
    const back = await letterMain({ action: 'removeReply', id, ts: ts2 });
    eq(back.ok, true, 'letter 应能按 reply 给的 ts 撕掉');
    eq(back.replies.length, 0);
    eq(h.count('reply_records'), 0);
  });

  test('addReply 内容必填、300 字封顶、原文保留', async () => {
    const { h, id, letterMain } = await setup();
    eq((await letterMain({ action: 'addReply', id, content: '' })).ok, false);
    eq((await letterMain({ action: 'addReply', id, content: '   ' })).ok, false);
    eq((await letterMain({ action: 'addReply', id, content: { a: 1 } })).ok, false);
    eq(h.count('reply_records'), 0, '被拒的请求不得落库');

    eq((await letterMain({ action: 'addReply', id, content: 'x'.repeat(301) })).ok, false);
    const ok = await letterMain({ action: 'addReply', id, content: 'x'.repeat(300) });
    eq(ok.ok, true, '300 字应通过');
    eq((await letterMain({ action: 'addReply', id, content: '  有空白  ' })).ok, true);
    eq(h.all('reply_records')[1].content, '  有空白  ', '原文存储零加工');
  });

  test('废纸篓内的信件不可新增回信（BR-11）', async () => {
    const { h, id, letterMain } = await setup();
    await letterMain({ action: 'moveToRecycle', id });
    const r = await letterMain({ action: 'addReply', id, content: '还能写吗' });
    eq(r.ok, false);
    eq(r.error, 'letter not active');
    eq(h.count('reply_records'), 0);
  });

  test('撕掉不存在的 ts 明确报错（不静默成功）', async () => {
    const { id, letterMain } = await setup();
    const r = await letterMain({ action: 'removeReply', id, ts: 1234567890 });
    eq(r.ok, false);
    eq(r.error, 'reply not found');
    // ts 非数值形态（对象注入）同样走「找不到」，不得变成删全表
    const bad = await letterMain({ action: 'removeReply', id, ts: { $ne: null } });
    eq(bad.ok, false);
  });

  test('别人的信：addReply / removeReply 一律拒绝，不回显是否存在', async () => {
    const h = createHarness({ openid: 'openid-B' });
    const aId = h.seed('letters', { _openid: 'openid-A', name: 'A 信', status: 'active', created_at: new Date() })[0];
    h.seed('reply_records', { _openid: 'openid-A', letter_id: aId, content: 'A 的回信', created_at: new Date('2026-01-01') });
    const letterMain = h.load('letter');

    const add = await letterMain({ action: 'addReply', id: aId, content: '插一句' });
    eq(add.error, 'not found');
    const del = await letterMain({ action: 'removeReply', id: aId, ts: new Date('2026-01-01').getTime() });
    eq(del.error, 'not found');
    eq(h.count('reply_records'), 1, 'A 的回信必须还在');
  });
});

suite('定时清理 · cleaner', () => {
  test('SV-20 客户端调用被拒（定时触发器不带 OPENID）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('cleaner');
    const r = await main({});
    eq(r.ok, false);
    eq(r.error, 'forbidden');
  });

  test('清理到期的废纸篓信件，保留未到期与在匣信件', async () => {
    const h = createHarness({ openid: null }); // 触发器调用：无用户上下文
    const expired = h.seed('letters', {
      _openid: 'openid-A', status: 'recycled', name: '过期', purge_at: new Date(Date.now() - 1000)
    })[0];
    const notYet = h.seed('letters', {
      _openid: 'openid-A', status: 'recycled', name: '未到期', purge_at: new Date(Date.now() + DAY)
    })[0];
    const active = h.seed('letters', {
      _openid: 'openid-A', status: 'active', name: '在匣', purge_at: null
    })[0];
    h.seed('open_records', { _openid: 'openid-A', letter_id: expired, created_at: new Date() });
    h.seed('reply_records', { _openid: 'openid-A', letter_id: expired, content: 'x', created_at: new Date() });

    const main = h.load('cleaner');
    const r = await main({});
    eq(r.ok, true);
    eq(r.purged, 1, '只应清理 1 封到期信');
    eq(h.find('letters', (l) => l._id === expired).length, 0);
    eq(h.find('letters', (l) => l._id === notYet).length, 1, '未到期不得清');
    eq(h.find('letters', (l) => l._id === active).length, 1, '在匣信件不得清');
    eq(h.find('open_records', (o) => o.letter_id === expired).length, 0);
    eq(h.find('reply_records', (o) => o.letter_id === expired).length, 0);
  });

  test('清理不被默认 20 条截断（积压场景）', async () => {
    const h = createHarness({ openid: null });
    for (let i = 0; i < 30; i += 1) {
      h.seed('letters', {
        _openid: 'openid-A', status: 'recycled', name: '信' + i, purge_at: new Date(Date.now() - 1000)
      });
    }
    const main = h.load('cleaner');
    const r = await main({});
    eq(r.purged, 30, '单次应清理全部到期信件，不能被 20 条截断');
    eq(h.count('letters'), 0);
  });
});

suite('草稿 · draft', () => {
  test('list 返回 ver=2（前端据此确认云端部署版本）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('draft');
    const r = await main({ action: 'list' });
    eq(r.ok, true);
    eq(r.ver, 2, 'ver 不等于 2 时 services 会静默回落本地逻辑');
  });

  test('save 新增并返回 id，list 能读回', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('draft');
    const saved = await main({ action: 'save', draft: { name: '草稿名', question: '问题', answer: '' } });
    eq(saved.ok, true);
    ok(saved.id, 'save 应返回 id');
    const list = await main({ action: 'list' });
    eq(list.drafts.length, 1);
    eq(list.drafts[0].name, '草稿名');
    eq(list.drafts[0].answer, '', '允许部分为空（未写完）');
  });

  test('save 带 id 时更新同一条而非新建', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('draft');
    const a = await main({ action: 'save', draft: { name: 'v1', question: 'q', answer: 'a' } });
    const b = await main({ action: 'save', draft: { id: a.id, name: 'v2', question: 'q', answer: 'a' } });
    eq(b.id, a.id);
    eq(h.count('drafts'), 1, '更新不应新建文档');
    eq(h.all('drafts')[0].name, 'v2');
  });

  test('save 目标草稿已不存在时降级为新增（不静默丢稿）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('draft');
    const r = await main({ action: 'save', draft: { id: 'gone-id', name: '续写', question: 'q', answer: 'a' } });
    eq(r.ok, true);
    eq(h.count('drafts'), 1, '应补建一条，而不是报成功却什么都没存');
  });

  test('save 不得改到他人草稿（_openid 一并约束）', async () => {
    const h = createHarness({ openid: 'openid-B' });
    const aDraft = h.seed('drafts', { _openid: 'openid-A', name: 'A 的草稿', question: 'q', answer: 'a' })[0];
    const main = h.load('draft');
    await main({ action: 'save', draft: { id: aDraft, name: '被 B 改了', question: 'q', answer: 'a' } });
    const doc = h.all('drafts').find((d) => d._id === aDraft);
    eq(doc.name, 'A 的草稿', 'A 的草稿不得被 B 修改');
  });

  test('save 类型兜底：非字符串字段归一为空串', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('draft');
    await main({ action: 'save', draft: { name: { evil: 1 }, question: ['a'], answer: 42 } });
    const d = h.all('drafts')[0];
    eq(d.name, '');
    eq(d.question, '');
    eq(d.answer, '');
  });

  test('save 超长被拒（20/500/2000）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('draft');
    eq((await main({ action: 'save', draft: { name: 'x'.repeat(21) } })).error, 'draft too long');
    eq((await main({ action: 'save', draft: { question: 'x'.repeat(501) } })).error, 'draft too long');
    eq((await main({ action: 'save', draft: { answer: 'x'.repeat(2001) } })).error, 'draft too long');
    eq(h.count('drafts'), 0);
  });

  test('list 过滤三项全空的草稿', async () => {
    const h = createHarness({ openid: 'openid-A' });
    h.seed('drafts', { _openid: 'openid-A', name: '', question: '', answer: '', updated_at: new Date() });
    const main = h.load('draft');
    const r = await main({ action: 'list' });
    eq(r.drafts.length, 0, '空草稿不应出现在列表');
  });

  test('remove 只删本人草稿', async () => {
    const h = createHarness({ openid: 'openid-B' });
    const aDraft = h.seed('drafts', { _openid: 'openid-A', name: 'A', question: '', answer: '' })[0];
    const bDraft = h.seed('drafts', { _openid: 'openid-B', name: 'B', question: '', answer: '' })[0];
    const main = h.load('draft');
    await main({ action: 'remove', id: aDraft });
    eq(h.count('drafts'), 2, 'B 不得删除 A 的草稿');
    await main({ action: 'remove', id: bDraft });
    eq(h.count('drafts'), 1);
    eq(h.all('drafts')[0]._openid, 'openid-A');
  });

  test('clearAll 只清本人草稿', async () => {
    const h = createHarness({ openid: 'openid-B' });
    h.seed('drafts', { _openid: 'openid-A', name: 'A', question: '', answer: '' });
    h.seed('drafts', { _openid: 'openid-B', name: 'B', question: '', answer: '' });
    const main = h.load('draft');
    const r = await main({ action: 'clearAll' });
    eq(r.ok, true);
    eq(h.count('drafts'), 1);
    eq(h.all('drafts')[0]._openid, 'openid-A', '不得清掉他人草稿');
  });

  test('list 最多返回 50 条（MAX_LIST）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    for (let i = 0; i < 60; i += 1) {
      h.seed('drafts', { _openid: 'openid-A', name: 'd' + i, question: '', answer: '', updated_at: new Date(Date.now() - i) });
    }
    const main = h.load('draft');
    const r = await main({ action: 'list' });
    eq(r.drafts.length, 50, 'MAX_LIST=50');
  });
});
