'use strict';
/**
 * 测试入口：node tests/run.js [过滤关键字]
 *
 * 只做三件事：加载用例、隔离进程态、报告结果。
 * 每个用例前后恢复 process.env —— member 云函数在模块加载期读环境变量
 * （OFFER_ID / APP_KEY / XPAY_NOTIFY_SOURCE），用例之间不隔离会互相污染，
 * 表现为「单跑通过、全跑失败」这类最难查的假象。
 */
const fs = require('fs');
const path = require('path');
const { registry } = require('./runner');

const SUITE_DIR = path.join(__dirname, 'suites');
for (const f of fs.readdirSync(SUITE_DIR).filter((n) => n.endsWith('.test.js')).sort()) {
  require(path.join(SUITE_DIR, f));
}

const filter = process.argv[2] || '';
const picked = filter
  ? registry.filter((t) => (t.suite + ' ' + t.name).includes(filter))
  : registry.slice();

(async () => {
  const envSnapshot = { ...process.env };
  const restoreEnv = () => {
    for (const k of Object.keys(process.env)) {
      if (!(k in envSnapshot)) delete process.env[k];
    }
    Object.assign(process.env, envSnapshot);
  };

  const results = [];
  for (const t of picked) {
    restoreEnv();
    // 云函数内部会大量 console.log（发货来源、拒绝原因）；成功用例里这些是噪音，
    // 失败用例里它们恰恰是最有用的线索 —— 捕获后只在失败时回放。
    const captured = [];
    const realLog = console.log;
    const realErr = console.error;
    const realWarn = console.warn;
    const grab = (orig) => (...args) => {
      captured.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
      if (process.env.TEST_VERBOSE) orig.apply(console, args);
    };
    console.log = grab(realLog);
    console.error = grab(realErr);
    console.warn = grab(realWarn);

    const started = Date.now();
    try {
      await t.fn();
      results.push({ ...t, ok: true, ms: Date.now() - started });
    } catch (e) {
      results.push({ ...t, ok: false, ms: Date.now() - started, err: e, logs: captured });
    } finally {
      console.log = realLog;
      console.error = realErr;
      console.warn = realWarn;
    }
    restoreEnv();
  }

  const bySuite = new Map();
  for (const r of results) {
    if (!bySuite.has(r.suite)) bySuite.set(r.suite, []);
    bySuite.get(r.suite).push(r);
  }

  console.log('\n心灵信箱 · 云函数离线测试\n' + '='.repeat(64));
  let pass = 0;
  let fail = 0;
  for (const [s, list] of bySuite) {
    const bad = list.filter((r) => !r.ok).length;
    console.log(`\n${bad ? '✗' : '✓'} ${s}  (${list.length - bad}/${list.length})`);
    for (const r of list) {
      if (r.ok) {
        pass += 1;
        console.log(`    ✓ ${r.name}`);
      } else {
        fail += 1;
        console.log(`    ✗ ${r.name}`);
        for (const line of String((r.err && r.err.message) || r.err).split('\n')) {
          console.log(`        ${line}`);
        }
        if (r.logs && r.logs.length) {
          console.log('        ── 云函数日志 ──');
          for (const line of r.logs.slice(-12)) console.log(`        | ${line}`);
        }
        if (process.env.TEST_TRACE) console.log(r.err.stack);
      }
    }
  }
  console.log('\n' + '='.repeat(64));
  console.log(`合计 ${results.length} 条：${pass} 通过 / ${fail} 失败`);
  console.log('');
  process.exitCode = fail ? 1 : 0;
})();
