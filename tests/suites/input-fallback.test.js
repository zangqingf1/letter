'use strict';
/**
 * 输入兜底（对应 测试流程.md §6.4 SV-13~SV-18）
 * 覆盖 feedback / analytics / stats 的服务端校验与上限。
 */
const { suite, test, ok, eq, has } = require('../runner');
const { createHarness } = require('../harness');

suite('问题反馈 · feedback', () => {
  function setup() {
    const h = createHarness({ openid: 'openid-A' });
    return { h, main: h.load('feedback') };
  }

  test('内容必填：空 / 纯空白 / 非字符串均被拒', async () => {
    const { h, main } = setup();
    eq((await main({ action: 'add', content: '' })).error, 'content is required');
    eq((await main({ action: 'add', content: '   ' })).error, 'content is required');
    eq((await main({ action: 'add', content: { a: 1 } })).error, 'content is required');
    eq((await main({ action: 'add' })).error, 'content is required');
    eq(h.count('feedback'), 0);
  });

  test('内容上限 1000：边界内通过、超长被拒', async () => {
    const { h, main } = setup();
    eq((await main({ action: 'add', content: 'x'.repeat(1000) })).ok, true);
    eq((await main({ action: 'add', content: 'x'.repeat(1001) })).error, 'content too long');
    eq(h.count('feedback'), 1);
  });

  test('内容入库时去首尾空白', async () => {
    const { h, main } = setup();
    await main({ action: 'add', content: '  有个问题  ' });
    eq(h.all('feedback')[0].content, '有个问题');
  });

  test('联系方式上限 40，与前端 maxlength 逐一对齐', async () => {
    const { h, main } = setup();
    await main({ action: 'add', content: 'c', contact: 'x'.repeat(40) });
    eq(h.all('feedback')[0].contact.length, 40, '40 字应通过');
    const r = await main({ action: 'add', content: 'c', contact: 'x'.repeat(41) });
    eq(r.error, 'contact too long', '41 字应被拒（服务端不得比前端宽松）');
    eq(h.count('feedback'), 1);
  });

  test('截图只接受 cloud:// fileID，混入外链即整单拒绝', async () => {
    const { h, main } = setup();
    const r = await main({
      action: 'add',
      content: 'c',
      images: ['cloud://env.a/1.png', 'https://evil.example/2.png']
    });
    eq(r.error, 'invalid image', '混入非 cloud:// 应整单拒绝，而非静默丢弃');
    eq(h.count('feedback'), 0);
  });

  test('截图恰好 9 张时全部入库', async () => {
    const { h, main } = setup();
    const nine = Array.from({ length: 9 }, (_, i) => 'cloud://env.a/' + i + '.png');
    eq((await main({ action: 'add', content: 'c', images: nine })).ok, true);
    eq(h.all('feedback')[0].images.length, 9);
  });

  test('超过 9 张截图被明确拒绝（不静默截断）', async () => {
    const { h, main } = setup();
    const ten = Array.from({ length: 10 }, (_, i) => 'cloud://env.a/' + i + '.png');
    const r = await main({ action: 'add', content: 'c', images: ten });
    eq(r.ok, false, '超量必须报错，不能静默丢弃');
    eq(r.error, 'too many images');
    eq(h.count('feedback'), 0, '被拒时不得落库（否则多余截图成为无引用残留）');
  });

  test('非法 fileID 与超量是两个不同的错误（便于定位）', async () => {
    const { main } = setup();
    const bad = await main({ action: 'add', content: 'c', images: ['https://evil.example/x.png'] });
    eq(bad.error, 'invalid image');
    const many = await main({
      action: 'add', content: 'c',
      images: Array.from({ length: 10 }, (_, i) => 'cloud://env.a/' + i + '.png')
    });
    eq(many.error, 'too many images');
  });

  test('images 非数组时按空处理（不报错）', async () => {
    const { h, main } = setup();
    eq((await main({ action: 'add', content: 'c', images: 'cloud://a/b.png' })).ok, true);
    eq(h.all('feedback')[0].images.length, 0);
  });

  test('device 超长截断到 120', async () => {
    const { h, main } = setup();
    await main({ action: 'add', content: 'c', device: 'd'.repeat(300) });
    eq(h.all('feedback')[0].device.length, 120);
  });

  test('落库字段齐全：status 初始为 new，带 _openid', async () => {
    const { h, main } = setup();
    await main({ action: 'add', content: 'c', contact: 'a@b.c' });
    const f = h.all('feedback')[0];
    eq(f._openid, 'openid-A');
    eq(f.status, 'new');
    eq(f.contact, 'a@b.c');
    ok(f.created_at, '应写 created_at');
    eq(f.handled_at, undefined, '未处理时不应有 handled_at');
  });

  test('反馈只写不读：无任何读取 action', async () => {
    const { main } = setup();
    for (const a of ['list', 'get', 'all', 'query']) {
      const r = await main({ action: a });
      eq(r.ok, false, '小程序端不应能读回反馈（' + a + '）');
    }
  });
});

suite('埋点 · analytics', () => {
  function setup() {
    const h = createHarness({ openid: 'openid-A' });
    return { h, main: h.load('analytics') };
  }

  test('SV-18 单批最多 50 条，超出部分被截断', async () => {
    const { h, main } = setup();
    const events = Array.from({ length: 60 }, (_, i) => ({ name: 'letter_open', props: { i } }));
    const r = await main({ action: 'batch', events });
    eq(r.ok, true);
    eq(r.saved, 50, 'saved 应报告实际接受条数');
    eq(h.count('events'), 50, '不得写入超过 50 条');
  });

  test('事件名截断到 64 字，空名被跳过', async () => {
    const { h, main } = setup();
    await main({
      action: 'batch',
      events: [{ name: 'x'.repeat(100) }, { name: '' }, { name: 123 }, { name: 'letter_save' }]
    });
    const names = h.all('events').map((e) => e.name);
    eq(names.length, 2, '空名与非字符串名应被跳过');
    eq(names.find((n) => n.length > 1).length, 64);
    ok(names.includes('letter_save'));
  });

  test('SV-17 props 只接受浅层标量，嵌套/数组/对象被丢弃', async () => {
    const { h, main } = setup();
    await main({
      action: 'batch',
      events: [{
        name: 'e',
        props: {
          ok_str: 'a',
          ok_num: 1,
          ok_bool: true,
          bad_obj: { deep: 1 },
          bad_arr: [1, 2],
          bad_null: null
        }
      }]
    });
    const p = h.all('events')[0].props;
    eq(p.ok_str, 'a');
    eq(p.ok_num, 1);
    eq(p.ok_bool, true);
    eq(p.bad_obj, undefined, '嵌套对象必须丢弃（避免撑大存储）');
    eq(p.bad_arr, undefined);
    eq(p.bad_null, undefined);
  });

  test('SV-17b props 键名超 40 字被丢弃', async () => {
    const { h, main } = setup();
    await main({ action: 'batch', events: [{ name: 'e', props: { ['k'.repeat(41)]: 'v', ['k'.repeat(40)]: 'v' } }] });
    const p = h.all('events')[0].props;
    eq(Object.keys(p).length, 1, '只应保留 40 字以内的键');
    eq(Object.keys(p)[0].length, 40);
  });

  test('props 总预算 1KB，超出的键被截停', async () => {
    const { h, main } = setup();
    const props = {};
    for (let i = 0; i < 40; i += 1) props['k' + i] = 'x'.repeat(100); // 约 4KB
    await main({ action: 'batch', events: [{ name: 'e', props }] });
    const p = h.all('events')[0].props;
    const size = Object.keys(p).reduce((s, k) => s + k.length + String(p[k]).length, 0);
    ok(size <= 1024, 'props 序列化体积应受 1KB 预算约束，实际 ' + size);
    ok(Object.keys(p).length > 0, '不应把所有 props 都丢掉');
  });

  test('非法 client_ts 归一为 null，合法值保留', async () => {
    const { h, main } = setup();
    const good = new Date('2026-03-03T10:00:00Z');
    await main({
      action: 'batch',
      events: [{ name: 'a', client_ts: good.toISOString() }, { name: 'b', client_ts: 'not-a-date' }]
    });
    const list = h.all('events');
    const a = list.find((e) => e.name === 'a');
    const b = list.find((e) => e.name === 'b');
    eq(new Date(a.client_ts).getTime(), good.getTime());
    eq(b.client_ts, null, '非法时间应归一为 null 而非写坏数据');
  });

  test('events 非数组时按空处理', async () => {
    const { h, main } = setup();
    const r = await main({ action: 'batch', events: 'not-an-array' });
    eq(r.ok, true);
    eq(h.count('events'), 0);
  });

  test('埋点写入带 _openid（归属清晰，不采正文）', async () => {
    const { h, main } = setup();
    await main({ action: 'batch', events: [{ name: 'letter_open' }] });
    eq(h.all('events')[0]._openid, 'openid-A');
  });

  test('数量与事件名齐备：13 个既定事件名都能落库', async () => {
    const { h, main } = setup();
    const NAMES = [
      'letter_open', 'reply_add', 'letter_delete', 'letter_restore', 'letter_permanent_delete',
      'letter_content_complete', 'draft_save', 'letter_step2_view', 'theme_select', 'paper_select',
      'letter_save', 'share_image_generate', 'share_image_save', 'share_send'
    ];
    const r = await main({ action: 'batch', events: NAMES.map((name) => ({ name })) });
    eq(r.ok, true);
    eq(h.count('events'), NAMES.length);
  });

  test('未知 action 被拒', async () => {
    const { main } = setup();
    eq((await main({ action: 'track' })).ok, false);
  });
});

suite('统计 · stats', () => {
  test('注册天数从建档日计算，当天为 1', async () => {
    const h = createHarness({ openid: 'openid-A' });
    h.seed('users', { _openid: 'openid-A', status: 'active', created_at: new Date() });
    const main = h.load('stats');
    const r = await main({ action: 'get' });
    eq(r.registerDays, 1);
  });

  test('无 users 文档时注册天数兜底为 1，不报错', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('stats');
    const r = await main({ action: 'get' });
    eq(r.ok, true);
    eq(r.registerDays, 1);
    eq(r.letterTotal, 0);
  });

  test('六个口径一次返回', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('stats');
    const r = await main({ action: 'get' });
    for (const k of ['letterTotal', 'rereadTotal', 'replyTotal', 'registerDays', 'pinnedCount', 'recycleCount']) {
      has(r, k, '缺字段 ' + k);
    }
  });

  test('未知 action 被拒', async () => {
    const h = createHarness();
    const main = h.load('stats');
    eq((await main({ action: 'overview' })).ok, false);
  });
});
