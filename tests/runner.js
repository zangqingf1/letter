'use strict';
/**
 * 零依赖测试运行器（node tests/run.js）。
 * 不引入 jest/mocha：本仓库刻意不装任何依赖，测试基础设施也应保持同一口径。
 *
 *   const { test, eq, ok, has } = require('../runner');
 *   test('用例名', async () => { ... });
 *
 * 断言失败即抛错，其余用例继续跑（fail-fast 会掩盖后面的问题）。
 * 但每个用例改动的进程态（process.env）由 run.js 负责清理。
 */
const assert = require('assert');

const registry = [];
let currentSuite = '(未分组)';

function suite(name, fn) {
  const prev = currentSuite;
  currentSuite = name;
  fn();
  currentSuite = prev;
}

function test(name, fn) {
  registry.push({ suite: currentSuite, name, fn });
}

// ── 断言糖（出错信息用中文，失败时能直接看懂）──
function ok(value, msg) {
  assert.ok(value, msg || `期望为真，实际是 ${JSON.stringify(value)}`);
}

function eq(actual, expected, msg) {
  assert.deepStrictEqual(
    actual,
    expected,
    msg || `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`
  );
}

function has(obj, key, msg) {
  assert.ok(
    obj && Object.prototype.hasOwnProperty.call(obj, key),
    msg || `期望包含字段 ${key}，实际字段为 ${obj ? Object.keys(obj).join(',') : obj}`
  );
}

function missing(obj, key, msg) {
  assert.ok(
    !obj || !Object.prototype.hasOwnProperty.call(obj, key),
    msg || `不应包含字段 ${key}（信息泄露）`
  );
}

async function rejects(fn, msg) {
  let threw = false;
  try {
    await fn();
  } catch (e) {
    threw = true;
  }
  ok(threw, msg || '期望抛出异常，但没有');
}

async function run() {
  const results = [];
  for (const t of registry) {
    const started = Date.now();
    try {
      await t.fn();
      results.push({ ...t, ok: true, ms: Date.now() - started });
    } catch (e) {
      results.push({ ...t, ok: false, ms: Date.now() - started, err: e });
    }
  }
  return results;
}

module.exports = { suite, test, ok, eq, has, missing, rejects, run, registry };
