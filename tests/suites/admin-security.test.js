'use strict';
/**
 * Web 后台 admin 云函数安全（对应 测试流程.md §8 AD-01~AD-14）
 *
 * 后台是唯一的运营写入口，也是唯一的「可能批量误删/误封」的地方：
 * 选择器字段一旦接受对象，where() 会被当成查询操作符，一个 {"$ne":null}
 * 就能清空整个集合。这里把它钉死。
 */
const { suite, test, ok, eq, missing, has } = require('../runner');
const { createHarness } = require('../harness');

const KEY = 'a-strong-random-admin-key-for-tests-only';

/** 带 ADMIN_KEY 的 admin 调用器 */
function admin(over) {
  process.env.ADMIN_KEY = KEY;
  const h = createHarness(over);
  const main = h.load('admin');
  return {
    h,
    call: (payload) => main(Object.assign({ key: KEY }, payload)),
    raw: main
  };
}

/** 把 where 条件对象化：真实攻击载荷 */
const INJECTION = { $ne: null };

suite('admin · 鉴权', () => {
  test('AD-01 未配置 ADMIN_KEY 时一律拒绝（绝不默认放行）', async () => {
    delete process.env.ADMIN_KEY;
    const h = createHarness();
    const main = h.load('admin');
    const r = await main({ action: 'auth', key: 'anything' });
    eq(r.ok, false);
    eq(r.error, 'unauthorized');
  });

  test('AD-02 密钥错误被拒', async () => {
    const { call } = admin();
    const r = await call({ action: 'auth', key: 'wrong-key' });
    eq(r.ok, false);
    eq(r.error, 'unauthorized');
  });

  test('AD-02b 密钥非字符串（对象注入）被拒而不抛错', async () => {
    const { raw } = admin();
    const r = await raw({ action: 'auth', key: INJECTION });
    eq(r.ok, false);
    eq(r.error, 'unauthorized');
  });

  test('AD-03 正确密钥通过，非 auth 业务 action 也要带密钥', async () => {
    const { call } = admin();
    eq((await call({ action: 'auth' })).ok, true);
    const h2 = admin();
    const r = await h2.raw({ action: 'userList' }); // 没带 key
    eq(r.error, 'unauthorized', '业务 action 未带密钥应被拒');
  });

  test('所有 action 都在鉴权之后（含读接口）', async () => {
    const h = createHarness();
    process.env.ADMIN_KEY = KEY;
    const main = h.load('admin');
    const ACTIONS = [
      'themeList', 'paperList', 'statsOverview', 'userList', 'memberList',
      'memberItemList', 'feedbackList', 'eventsSummary'
    ];
    for (const action of ACTIONS) {
      const r = await main({ action });
      eq(r.error, 'unauthorized', action + ' 未鉴权即可访问');
    }
  });
});

suite('admin · 选择器注入（可清空集合 / 批量误封）', () => {
  test('themeDelete 传对象不能清空 themes 集合', async () => {
    const { h, call } = admin();
    h.seed('themes', [
      { theme_id: 'a', name: 'A', status: 'online' },
      { theme_id: 'b', name: 'B', status: 'online' }
    ]);
    const r = await call({ action: 'themeDelete', theme_id: INJECTION });
    eq(r.ok, false, '对象选择器必须被拒');
    eq(r.error, 'theme_id 非法');
    eq(h.count('themes'), 2, '集合绝不能被清空');
  });

  test('paperDelete 传对象不能清空 papers 集合', async () => {
    const { h, call } = admin();
    h.seed('papers', [
      { paper_id: 'liubai', name: '留白志', status: 'online' },
      { paper_id: 'vinyl', name: '黑胶', status: 'online' }
    ]);
    const r = await call({ action: 'paperDelete', paper_id: { $exists: true } });
    eq(r.ok, false);
    eq(h.count('papers'), 2);
  });

  test('memberItemDelete 传对象不能清空 member_items', async () => {
    const { h, call } = admin();
    h.seed('member_items', [
      { kind: 'theme', item_id: 'vip1', name: 'V1' },
      { kind: 'paper', item_id: 'vip2', name: 'V2' }
    ]);
    const r = await call({ action: 'memberItemDelete', kind: 'theme', item_id: INJECTION });
    eq(r.ok, false);
    eq(h.count('member_items'), 2);
  });

  test('userBan 传对象不能批量封禁全部用户', async () => {
    const { h, call } = admin();
    h.seed('users', [
      { _openid: 'openid-A', nickname: 'A', status: 'active' },
      { _openid: 'openid-B', nickname: 'B', status: 'active' },
      { _openid: 'openid-C', nickname: 'C', status: 'active' }
    ]);
    const r = await call({ action: 'userBan', openid: INJECTION });
    eq(r.ok, false);
    eq(r.error, 'openid 非法');
    eq(h.find('users', (u) => u.status === 'banned').length, 0, '不得批量封禁');
  });

  test('memberRevoke 传对象不能批量降级会员', async () => {
    const { h, call } = admin();
    h.seed('members', [
      { _openid: 'openid-A', state: 'vip' },
      { _openid: 'openid-B', state: 'vip' }
    ]);
    const r = await call({ action: 'memberRevoke', openid: { $ne: null } });
    eq(r.ok, false);
    eq(h.find('members', (m) => m.state === 'vip').length, 2, '不得批量降级');
  });

  test('feedbackDelete 传对象不能清空 feedback', async () => {
    const { h, call } = admin();
    h.seed('feedback', [{ content: 'f1', status: 'new' }, { content: 'f2', status: 'new' }]);
    const r = await call({ action: 'feedbackDelete', id: INJECTION });
    eq(r.ok, false);
    eq(h.count('feedback'), 2);
  });

  test('openid 含非法字符（空格/斜杠/引号）被拒', async () => {
    const { call } = admin();
    for (const bad of ['openid A', "openid'A", 'openid/A', 'openid\\A', '']) {
      const r = await call({ action: 'userBan', openid: bad });
      eq(r.ok, false, `"${bad}" 应被拒`);
    }
  });

  test('超长选择器（>64 字）被拒', async () => {
    const { call } = admin();
    const r = await call({ action: 'themeDelete', theme_id: 'x'.repeat(65) });
    eq(r.ok, false);
  });

  test('合法 openid 正常执行（校验不能误伤正常操作）', async () => {
    const { h, call } = admin();
    h.seed('users', [
      { _openid: 'openid-A', nickname: 'A', status: 'active' },
      { _openid: 'openid-B', nickname: 'B', status: 'active' }
    ]);
    const r = await call({ action: 'userBan', openid: 'openid-A' });
    eq(r.ok, true);
    eq(h.find('users', (u) => u._openid === 'openid-A')[0].status, 'banned');
    eq(h.find('users', (u) => u._openid === 'openid-B')[0].status, 'active', '不得误伤他人');
  });

  test('昵称模糊搜索对正则元字符做转义（不能全表命中）', async () => {
    const { h, call } = admin();
    h.seed('users', [
      { _openid: 'openid-A', nickname: '阿远', status: 'active', created_at: new Date() },
      { _openid: 'openid-B', nickname: '其他人', status: 'active', created_at: new Date() }
    ]);
    const r = await call({ action: 'userList', keyword: '.*' });
    eq(r.ok, true);
    eq(r.total, 0, '.* 应被当作字面量，不得匹配所有用户');
  });
});

suite('admin · 隐私红线（永不读取信件正文）', () => {
  test('AD-12 userList 返回字段受投影约束，不含正文', async () => {
    const { h, call } = admin();
    h.seed('users', { _openid: 'openid-A', nickname: '阿远', status: 'active', created_at: new Date() });
    h.seed('letters', {
      _openid: 'openid-A', status: 'active',
      name: '绝密名称', question: '绝密问题', answer: '绝密答案'
    });
    const r = await call({ action: 'userList' });
    eq(r.ok, true);
    const u = r.users[0];
    eq(u.letterTotal, 1, '只做计数');
    for (const leaked of ['name', 'question', 'answer', 'letters']) {
      missing(u, leaked, '用户列表不得包含信件字段 ' + leaked);
    }
    ok(!JSON.stringify(r).includes('绝密'), '整个响应体不得出现信件正文');
  });

  test('AD-12b userDetail 只有计数与会员状态，无正文', async () => {
    const { h, call } = admin();
    h.seed('users', { _openid: 'openid-A', nickname: '阿远', status: 'active', created_at: new Date() });
    h.seed('letters', {
      _openid: 'openid-A', status: 'active',
      name: '绝密名称', question: '绝密问题', answer: '绝密答案'
    });
    h.seed('reply_records', { _openid: 'openid-A', letter_id: 'x', content: '绝密回信', created_at: new Date() });
    const r = await call({ action: 'userDetail', openid: 'openid-A' });
    eq(r.ok, true);
    eq(r.letterTotal, 1);
    eq(r.replyTotal, 1, '回信只计数');
    ok(!JSON.stringify(r).includes('绝密'), '用户详情不得出现任何正文内容');
  });

  test('AD-12c 数据看板只做聚合，响应体不含正文', async () => {
    const { h, call } = admin();
    h.seed('users', { _openid: 'openid-A', nickname: '阿远', status: 'active', created_at: new Date() });
    h.seed('letters', { _openid: 'openid-A', status: 'active', name: '绝密', question: 'q', answer: 'a', created_at: new Date() });
    const r = await call({ action: 'statsOverview' });
    eq(r.ok, true);
    ok(!JSON.stringify(r).includes('绝密'), '看板不得出现信件正文');
  });

  test('feedback 是唯一的正文例外（用户主动提交给开发者）', async () => {
    const { h, call } = admin();
    h.seed('feedback', {
      _openid: 'openid-A', content: '提交的反馈正文', contact: 'a@b.c',
      images: [], device: 'ios', status: 'new', created_at: new Date()
    });
    const r = await call({ action: 'feedbackList' });
    eq(r.ok, true);
    eq(r.items.length, 1);
    eq(r.items[0].content, '提交的反馈正文', '反馈正文是允许读取的唯一例外');
  });

  test('admin 云函数源码层面不整读 letters / reply_records', async () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'cloudfunctions', 'admin', 'index.js'), 'utf8'
    );
    for (const coll of ['letters', 'reply_records']) {
      const re = new RegExp(`collection\\('${coll}'\\)`, 'g');
      let m;
      while ((m = re.exec(src)) !== null) {
        const win = src.slice(m.index, m.index + 400);
        ok(
          /\.count\(\)|\.aggregate\(\)|\.field\(/.test(win),
          `admin 对 ${coll} 的访问缺少 count()/aggregate()/field() 投影`
        );
      }
    }
  });
});

suite('admin · 会员与反馈运营动作', () => {
  test('memberGrant 写 vip 并按 plan 记档位名', async () => {
    const { h, call } = admin();
    h.seed('users', { _openid: 'openid-A', nickname: 'A', status: 'active', created_at: new Date() });
    const r = await call({ action: 'memberGrant', openid: 'openid-A', plan: 'year', days: 366 });
    eq(r.ok, true);
    const m = h.all('members')[0];
    eq(m.state, 'vip');
    eq(m.plan_name, '年卡');
    eq(m.total_days, 366);
    eq(m.granted_by, 'admin');
  });

  test('memberGrant 拒绝非法天数与未知档位', async () => {
    const { h, call } = admin();
    h.seed('users', { _openid: 'openid-A', status: 'active', created_at: new Date() });
    eq((await call({ action: 'memberGrant', openid: 'openid-A', plan: 'month', days: 0 })).ok, false);
    eq((await call({ action: 'memberGrant', openid: 'openid-A', plan: 'month', days: 9999 })).ok, false);
    // 未知 plan 回落到 month，而不是写入任意字符串
    const r = await call({ action: 'memberGrant', openid: 'openid-A', plan: 'evil', days: 30 });
    eq(r.ok, true);
    eq(h.all('members')[0].level, 'month', '未知档位应回落 month，不得写入任意 level');
  });

  test('memberGrant 对未建档 openid 明确报错', async () => {
    const { call } = admin();
    const r = await call({ action: 'memberGrant', openid: 'openid-nobody', plan: 'month', days: 30 });
    eq(r.ok, false);
    ok(/未建档/.test(r.error), '应提示该 openid 未建档');
  });

  test('会员续期：再次发放累加 total_days 并从原到期日顺延', async () => {
    const { h, call } = admin();
    h.seed('users', { _openid: 'openid-A', status: 'active', created_at: new Date() });
    await call({ action: 'memberGrant', openid: 'openid-A', plan: 'month', days: 30 });
    await call({ action: 'memberGrant', openid: 'openid-A', plan: 'month', days: 30 });
    const m = h.all('members')[0];
    eq(m.total_days, 60, '总天数应累计');
    ok(new Date(m.expires_at).getTime() > Date.now() + 59 * 86400000, '应从原到期日顺延');
  });

  test('memberRevoke 只降级指定用户', async () => {
    const { h, call } = admin();
    h.seed('members', [
      { _openid: 'openid-A', state: 'vip' },
      { _openid: 'openid-B', state: 'vip' }
    ]);
    const r = await call({ action: 'memberRevoke', openid: 'openid-A' });
    eq(r.ok, true);
    eq(r.updated, 1);
    eq(h.find('members', (m) => m._openid === 'openid-A')[0].state, 'free');
    eq(h.find('members', (m) => m._openid === 'openid-B')[0].state, 'vip');
  });

  test('feedbackUpdate 标记 done 时写 handled_at / handled_by', async () => {
    const { h, call } = admin();
    const id = h.seed('feedback', { _openid: 'openid-A', content: 'c', status: 'new' })[0];
    const r = await call({ action: 'feedbackUpdate', id, status: 'done' });
    eq(r.ok, true);
    const f = h.all('feedback')[0];
    eq(f.status, 'done');
    eq(f.handled_by, 'admin');
    ok(f.handled_at, '应记录处理时间');
  });

  test('feedbackUpdate 回退为 new 时清空处理信息', async () => {
    const { h, call } = admin();
    const id = h.seed('feedback', { _openid: 'openid-A', content: 'c', status: 'done', handled_by: 'admin', handled_at: new Date() })[0];
    await call({ action: 'feedbackUpdate', id, status: 'new' });
    const f = h.all('feedback')[0];
    eq(f.handled_at, null);
    eq(f.handled_by, '');
  });

  test('feedbackUpdate 只接受 new / done', async () => {
    const { h, call } = admin();
    const id = h.seed('feedback', { content: 'c', status: 'new' })[0];
    const r = await call({ action: 'feedbackUpdate', id, status: 'archived' });
    eq(r.ok, false);
    eq(h.all('feedback')[0].status, 'new', '状态不得被改成任意值');
  });

  test('feedbackDelete 删除单条（连同截图）', async () => {
    const { h, call } = admin();
    const id = h.seed('feedback', {
      _openid: 'openid-A', content: 'c', status: 'new',
      images: ['cloud://env.a/1.png']
    })[0];
    h.seed('feedback', { _openid: 'openid-B', content: 'other', status: 'new' });
    const r = await call({ action: 'feedbackDelete', id });
    eq(r.ok, true);
    eq(r.removed, 1);
    eq(h.count('feedback'), 1, '只应删这一条');
    eq(h.all('feedback')[0]._openid, 'openid-B');
  });

  test('用户封禁后小程序侧立刻被拒（后台与小程序端联动）', async () => {
    const { h, call } = admin();
    h.seed('users', { _openid: 'openid-A', nickname: 'A', status: 'active', created_at: new Date() });
    await call({ action: 'userBan', openid: 'openid-A' });
    const main = h.load('today');
    const r = await main({ action: 'mailbox' });
    eq(r.error, 'banned', '后台封禁应立刻在小程序端生效');
  });
});

suite('admin · HTTP 网关适配', () => {
  test('OPTIONS 预检直接返回 204', async () => {
    delete process.env.ADMIN_ORIGIN;
    const h = createHarness();
    process.env.ADMIN_KEY = KEY;
    const main = h.load('admin');
    const r = await main({ httpMethod: 'OPTIONS' });
    eq(r.statusCode, 204);
    eq(r.body, '');
  });

  test('HTTP 形式的 body 为 JSON 串时可正常鉴权', async () => {
    delete process.env.ADMIN_ORIGIN;
    const h = createHarness();
    process.env.ADMIN_KEY = KEY;
    const main = h.load('admin');
    const r = await main({ httpMethod: 'POST', body: JSON.stringify({ action: 'auth', key: KEY }) });
    eq(r.statusCode, 200);
    eq(JSON.parse(r.body).ok, true);
  });

  test('未配 ADMIN_ORIGIN 时回落 *，配置后只回显白名单来源', async () => {
    delete process.env.ADMIN_ORIGIN;
    const h1 = createHarness();
    process.env.ADMIN_KEY = KEY;
    const main1 = h1.load('admin');
    const r1 = await main1({ httpMethod: 'POST', body: '{}', headers: { origin: 'https://any.example' } });
    eq(r1.headers['Access-Control-Allow-Origin'], '*', '未配置时兼容既有部署');

    process.env.ADMIN_ORIGIN = 'https://admin.example';
    const h2 = createHarness();
    const main2 = h2.load('admin');
    const r2 = await main2({ httpMethod: 'POST', body: '{}', headers: { origin: 'https://admin.example' } });
    eq(r2.headers['Access-Control-Allow-Origin'], 'https://admin.example');

    const r3 = await main2({ httpMethod: 'POST', body: '{}', headers: { origin: 'https://evil.example' } });
    eq(r3.headers['Access-Control-Allow-Origin'], undefined, '非白名单来源不得回显 ACAO');
    delete process.env.ADMIN_ORIGIN;
  });
});
