'use strict';
/**
 * 离线测试脚手架 —— 伪造 wx-server-sdk，让云函数能在纯 Node 里跑 main()。
 *
 * 为什么需要它：本仓库没有测试框架，而云函数里最要紧的逻辑（发货安全校验、幂等、
 * 保留期、输入兜底、越权拦截）都不依赖真实云环境。「云函数 + 真实数据库」不是这些
 * 逻辑的组成部分，只是它的宿主。把宿主换掉，逻辑就能被断言。
 *
 * 刻意保留的两条云数据库真实行为（否则测试会漏掉线上才炸的 bug）：
 *   1) get() 默认只返回 20 条 —— 漏写 limit() 必须在这里就失败，而不是等线上被截断；
 *   2) doc().get() 找不到文档时抛错（throwOnNotFound:false 才返回 {data:null}）。
 *
 * 用法：
 *   const h = createHarness({ openid: 'openid-A' });
 *   const main = h.load('letter');
 *   await main({ action: 'create', name: 'x', question: 'y', answer: 'z' });
 *   h.all('letters');            // 查看集合内容
 */
const Module = require('module');
const path = require('path');
const crypto = require('crypto');

const CF_ROOT = path.resolve(__dirname, '..', 'cloudfunctions');
const DEFAULT_GET_LIMIT = 20; // 云数据库 get() 默认条数上限

// ── db.command 操作符 ──────────────────────────────────────────────────
class Cmd {
  constructor(op, value) {
    this.op = op;
    this.value = value;
  }
}
const command = {
  eq: (v) => new Cmd('eq', v),
  neq: (v) => new Cmd('neq', v),
  gt: (v) => new Cmd('gt', v),
  gte: (v) => new Cmd('gte', v),
  lt: (v) => new Cmd('lt', v),
  lte: (v) => new Cmd('lte', v),
  in: (v) => new Cmd('in', v),
  nin: (v) => new Cmd('nin', v),
  exists: (v) => new Cmd('exists', v),
  or: (...args) => new Cmd('or', args),
  and: (...args) => new Cmd('and', args)
};

// ── db.command.aggregate 算子 ─────────────────────────────────────────
class Agg {
  constructor(op, arg) {
    this.op = op;
    this.arg = arg;
  }
}
const aggregate = {
  sum: (v) => new Agg('sum', v),
  dateToString: (o) => new Agg('dateToString', o)
};
command.aggregate = aggregate;

// ── 匹配语义 ───────────────────────────────────────────────────────────
const isDate = (v) => v instanceof Date;
const num = (v) => (isDate(v) ? v.getTime() : v);

function looseEq(a, b) {
  if (isDate(a) || isDate(b)) return num(a) === num(b);
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

function matchValue(docVal, cond) {
  if (cond instanceof Cmd) {
    switch (cond.op) {
      case 'eq': return looseEq(docVal, cond.value);
      case 'neq': return !looseEq(docVal, cond.value);
      case 'gt': return num(docVal) > num(cond.value);
      case 'gte': return num(docVal) >= num(cond.value);
      case 'lt': return num(docVal) < num(cond.value);
      case 'lte': return num(docVal) <= num(cond.value);
      case 'in': return (cond.value || []).some((v) => looseEq(docVal, v));
      case 'nin': return !(cond.value || []).some((v) => looseEq(docVal, v));
      case 'exists': return cond.value ? docVal !== undefined : docVal === undefined;
      case 'or': return cond.value.some((c) => matchValue(docVal, c));
      case 'and': return cond.value.every((c) => matchValue(docVal, c));
      default: throw new Error('[fake-sdk] 未实现的查询操作符 ' + cond.op);
    }
  }
  if (cond && cond.__regexp) return cond.re.test(String(docVal == null ? '' : docVal));
  if (cond instanceof RegExp) return cond.test(String(docVal == null ? '' : docVal));
  if (cond && typeof cond === 'object' && !Array.isArray(cond) && !isDate(cond)) {
    if (docVal == null || typeof docVal !== 'object') return false;
    return Object.keys(cond).every((k) => matchValue(docVal[k], cond[k]));
  }
  return looseEq(docVal, cond);
}

function matchDoc(doc, where) {
  if (!where) return true;
  // 顶层 _.or([{...},{...}]) 形态
  if (where instanceof Cmd && where.op === 'or') {
    return where.value.some((w) => matchDoc(doc, w));
  }
  return Object.keys(where).every((k) => matchValue(doc[k], where[k]));
}

// ── 聚合表达式求值 ─────────────────────────────────────────────────────
function resolveExpr(expr, doc) {
  if (typeof expr === 'string' && expr.charAt(0) === '$') return doc[expr.slice(1)];
  if (expr instanceof Agg) {
    if (expr.op === 'dateToString') {
      const a = expr.arg || {};
      const d = new Date(resolveExpr(a.date, doc));
      if (isNaN(d.getTime())) return null;
      // 时区：字符串按 Asia/Shanghai 视为 +08:00，数字视为分钟偏移
      let offsetMin = 480;
      if (typeof a.timezone === 'number') offsetMin = a.timezone;
      else if (typeof a.timezone === 'string' && a.timezone !== 'Asia/Shanghai') offsetMin = 0;
      const shifted = new Date(d.getTime() + offsetMin * 60000);
      const fmt = a.format || '%Y-%m-%d';
      return fmt
        .replace('%Y', String(shifted.getUTCFullYear()).padStart(4, '0'))
        .replace('%m', String(shifted.getUTCMonth() + 1).padStart(2, '0'))
        .replace('%d', String(shifted.getUTCDate()).padStart(2, '0'));
    }
    throw new Error('[fake-sdk] 未实现的聚合算子 ' + expr.op);
  }
  return expr;
}

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

// ── 内存数据库 ─────────────────────────────────────────────────────────
function createStore() {
  return new Map(); // collectionName -> Map(_id -> doc)
}

function makeQuery(store, faults, collName, state) {
  // 查询状态不可变：真实 SDK 的 .where()/.limit() 返回**新查询对象**。
  // 这一条必须忠实模拟 —— letter 云函数把 `db.collection('letters')` 存在模块作用域反复复用，
  // 若链式调用改写同一份状态，前一次查询的 where 条件就会泄漏到后一次（曾导致线上风格的假失败）。
  const q = state || { where: null, order: [], limit: null, skip: 0, field: null };
  const next = (patch) => makeQuery(store, faults, collName, Object.assign({}, q, patch));

  const rows = () => {
    const m = store.get(collName) || new Map();
    return Array.from(m.values());
  };

  const filtered = () => rows().filter((d) => matchDoc(d, q.where));

  const sorted = (list) => {
    if (!q.order.length) return list;
    return list.slice().sort((a, b) => {
      for (const [f, dir] of q.order) {
        const av = num(a[f]);
        const bv = num(b[f]);
        if (av === bv) continue;
        const cmp = av > bv ? 1 : -1;
        return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  };

  const projected = (list) => {
    if (!q.field) return list;
    return list.map((d) => {
      const out = {};
      for (const k of Object.keys(q.field)) {
        if (q.field[k] && d[k] !== undefined) out[k] = d[k];
      }
      return out;
    });
  };

  return {
    where(cond) {
      return next({ where: cond });
    },
    orderBy(field, dir) {
      return next({ order: q.order.concat([[field, dir || 'asc']]) });
    },
    limit(n) {
      return next({ limit: n });
    },
    skip(n) {
      return next({ skip: n });
    },
    field(proj) {
      return next({ field: proj });
    },
    async get() {
      faults.check(collName, 'get');
      // 真实云数据库的行为：不写 limit 就只有 20 条
      const cap = q.limit === null ? DEFAULT_GET_LIMIT : q.limit;
      const list = sorted(filtered()).slice(q.skip, q.skip + cap);
      return { data: projected(list).map(clone) };
    },
    async count() {
      faults.check(collName, 'count');
      return { total: filtered().length };
    },
    async add({ data }) {
      faults.check(collName, 'add');
      const coll = store.get(collName) || new Map();
      store.set(collName, coll);
      const _id = data._id || crypto.randomBytes(12).toString('hex');
      if (coll.has(_id)) {
        const err = new Error('document already exists: ' + _id);
        err.errCode = -502001;
        throw err;
      }
      coll.set(_id, Object.assign({}, clone(data), { _id }));
      return { _id };
    },
    async update({ data }) {
      faults.check(collName, 'update');
      const list = filtered();
      const coll = store.get(collName);
      for (const d of list) {
        Object.assign(coll.get(d._id), clone(data));
      }
      return { stats: { updated: list.length } };
    },
    async remove() {
      faults.check(collName, 'remove');
      const list = filtered();
      const coll = store.get(collName);
      for (const d of list) coll.delete(d._id);
      return { stats: { removed: list.length } };
    },
    doc(id) {
      return makeDoc(store, faults, collName, id);
    },
    aggregate() {
      return makeAggregate(filtered);
    }
  };
}

function makeAggregate(filtered) {
  const stages = { match: null, addFields: null, group: null, sort: null };
  return {
    match(cond) { stages.match = cond; return this; },
    addFields(fields) { stages.addFields = fields; return this; },
    group(spec) { stages.group = spec; return this; },
    sort(spec) { stages.sort = spec; return this; },
    async end() {
      let list = filtered();
      if (stages.match) list = list.filter((d) => matchDoc(d, stages.match));
      if (stages.addFields) {
        list = list.map((d) => {
          const out = Object.assign({}, d);
          for (const k of Object.keys(stages.addFields)) {
            out[k] = resolveExpr(stages.addFields[k], d);
          }
          return out;
        });
      }
      if (stages.group) {
        const groups = new Map();
        for (const d of list) {
          const key = resolveExpr(stages.group._id, d);
          if (!groups.has(key)) groups.set(key, { _id: key });
          const g = groups.get(key);
          g.count = (g.count || 0) + 1;
        }
        list = Array.from(groups.values());
      }
      return { list: list.map(clone) };
    }
  };
}

function makeDoc(store, faults, collName, id) {
  const get = () => (store.get(collName) || new Map()).get(id);
  return {
    async get() {
      faults.check(collName, 'get');
      const d = get();
      if (d === undefined) {
        if (faults.throwOnNotFound === false) return { data: null };
        const err = new Error('document.get:fail document not exists');
        err.errCode = -502002;
        throw err;
      }
      return { data: clone(d) };
    },
    async update({ data }) {
      faults.check(collName, 'update');
      const d = get();
      if (d === undefined) return { stats: { updated: 0 } };
      Object.assign(d, clone(data));
      return { stats: { updated: 1 } };
    },
    async set({ data }) {
      faults.check(collName, 'set');
      const coll = store.get(collName) || new Map();
      store.set(collName, coll);
      coll.set(id, Object.assign({}, clone(data), { _id: id }));
      return { stats: { updated: 1, created: 1 } };
    },
    async remove() {
      faults.check(collName, 'remove');
      const coll = store.get(collName) || new Map();
      const had = coll.delete(id);
      return { stats: { removed: had ? 1 : 0 } };
    }
  };
}

// ── 故障注入 ───────────────────────────────────────────────────────────
function makeFaults() {
  const rules = [];
  return {
    throwOnNotFound: undefined,
    failNext(collName, op) {
      rules.push({ collName, op });
    },
    check(collName, op) {
      for (let i = 0; i < rules.length; i += 1) {
        const r = rules[i];
        if (r.collName === collName && (!r.op || r.op === op)) {
          rules.splice(i, 1);
          throw new Error('[fake-sdk] 注入故障 ' + collName + '.' + op);
        }
      }
    }
  };
}

// ── 脚手架 ─────────────────────────────────────────────────────────────
function createHarness(opts = {}) {
  const store = createStore();
  const faults = makeFaults();
  const ctx = {
    openid: opts.openid === undefined ? 'openid-A' : opts.openid,
    appid: opts.appid || 'wxappid',
    source: opts.source || ''
  };

  const sdk = {
    DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
    init() {},
    database(o) {
      if (o && o.throwOnNotFound === false) faults.throwOnNotFound = false;
      return db;
    },
    getWXContext() {
      return { OPENID: ctx.openid, APPID: ctx.appid, SOURCE: ctx.source };
    },
    async callFunction() { throw new Error('[fake-sdk] callFunction 未实现'); },
    async uploadFile() { throw new Error('[fake-sdk] uploadFile 未实现'); },
    async deleteFile() { return { fileList: [] }; },
    async getTempFileURL() { return { fileList: [] }; }
  };

  const db = {
    command,
    serverDate: () => new Date(),
    RegExp: (o) => ({ __regexp: true, re: new RegExp(o.regexp, o.options || '') }),
    collection(name) {
      const m = store.get(name) || new Map();
      store.set(name, m);
      return makeQuery(store, faults, name);
    },
    async runTransaction(fn) {
      const snapshot = new Map();
      for (const [k, v] of store) snapshot.set(k, new Map(Array.from(v, ([id, d]) => [id, clone(d)])));
      const restore = () => {
        store.clear();
        for (const [k, v] of snapshot) store.set(k, new Map(v));
      };
      const t = {
        collection: (name) => {
          const m = store.get(name) || new Map();
          store.set(name, m);
          return makeQuery(store, faults, name);
        }
      };
      try {
        return await fn(t);
      } catch (e) {
        restore();
        throw e;
      }
    }
  };

  const harness = {
    ctx,
    sdk,
    faults,
    /** 当前 openid */
    as(openid) { ctx.openid = openid; return harness; },
    source(s) { ctx.source = s; return harness; },
    /** 直接往集合里塞数据（绕过云函数），返回 _id 数组 */
    seed(name, docs) {
      const coll = store.get(name) || new Map();
      store.set(name, coll);
      return (Array.isArray(docs) ? docs : [docs]).map((d) => {
        const _id = d._id || crypto.randomBytes(12).toString('hex');
        coll.set(_id, Object.assign({}, clone(d), { _id }));
        return _id;
      });
    },
    all(name) {
      const coll = store.get(name) || new Map();
      return Array.from(coll.values()).map(clone);
    },
    find(name, pred) {
      return harness.all(name).filter(pred);
    },
    count(name) {
      return (store.get(name) || new Map()).size;
    },
    collections() {
      return Array.from(store.keys());
    },
    /** 加载云函数，返回它的 main()。每次调用都拿到干净的模块实例。 */
    load(fnName) {
      const dir = path.join(CF_ROOT, fnName) + path.sep;
      for (const k of Object.keys(require.cache)) {
        if (k.startsWith(dir)) delete require.cache[k];
      }
      const orig = Module._load;
      Module._load = function (request) {
        if (request === 'wx-server-sdk') return sdk;
        return orig.apply(this, arguments);
      };
      try {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const mod = require(path.join(CF_ROOT, fnName, 'index.js'));
        return mod.main;
      } finally {
        Module._load = orig;
      }
    }
  };
  return harness;
}

module.exports = { createHarness, command, aggregate, Cmd, Agg };
