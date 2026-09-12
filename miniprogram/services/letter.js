// 信件数据访问层（技术架构文档.md §3 / §4 / §5）
// 页面禁止直接读写 letters_mock / recycle_mock —— 一律经由本模块。
// local 适配器完整复刻原页面的 storage 行为（字段结构不变，页面无感）；
// cloud 适配器对接 cloudfunctions/letter、open、reply、today（部署后把 config/env.js
// 的 USE_CLOUD 置 true 即切换，集合设计见架构文档 §4）。

const { DATA_SOURCE } = require('../config/env.js');
const cloud = require('./cloud.js');
const { MOCK_LETTERS, MOCK_DRAFT_COUNT, DEMO_STATE } = require('../pages/home/mock.js');
const { DEMO_LETTERS } = require('../pages/detail/mock.js');
const {
  DEMO_ITEMS: DEMO_RECYCLE_ITEMS,
  DEMO_STATE: RECYCLE_DEMO_STATE
} = require('../pages/recycle/mock.js');

const LETTERS_KEY = 'letters_mock';
const RECYCLE_KEY = 'recycle_mock';
// 演示信交互落成记录：被用户操作过（删除/回形针/回信）的演示信 id，从演示池中剔除，
// 避免删除后又从演示数据里"复活"
const DEMO_REMOVED_KEY = 'demo_removed_ids';
const RECYCLE_SEEDED_KEY = 'recycle_demo_seeded';
const DAY = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 30; // 废纸篓保留期（BR-11）

// ── 本地存储基础 ──
function readLetters() {
  return wx.getStorageSync(LETTERS_KEY) || [];
}
function writeLetters(list) {
  wx.setStorageSync(LETTERS_KEY, list);
}

function readDemoRemoved() {
  return wx.getStorageSync(DEMO_REMOVED_KEY) || [];
}
function addDemoRemoved(id) {
  const arr = readDemoRemoved();
  if (!arr.some((x) => String(x) === String(id))) {
    arr.push(id);
    wx.setStorageSync(DEMO_REMOVED_KEY, arr);
  }
}
function removeDemoRemoved(id) {
  wx.setStorageSync(
    DEMO_REMOVED_KEY,
    readDemoRemoved().filter((x) => String(x) !== String(id))
  );
}

// ── 演示信落成真实信 ──
// 演示信只读会阻塞功能验收：首次对演示信做写操作（回形针/回信/删除/恢复）时，
// 把它补全为完整信件写入 letters_mock，此后该信所有操作走真实存储。
// 正文按名称匹配详情演示数据补全（如「给失眠时的自己」→ demo-multi 全文），
// 匹配不上的回落小王子主题空正文占位。
function ensureReal(letter) {
  const letters = readLetters();
  if (letters.some((l) => String(l.id) === String(letter.id))) return letter;
  const joined = Object.values(DEMO_LETTERS).find((d) => d.name === letter.name) || {};
  const full = Object.assign({}, joined, letter, { id: letter.id });
  full.theme_id = full.theme_id || 'xiaowangzi';
  full.theme_version = full.theme_version || 1;
  full.paper_id = full.paper_id || 'liubai';
  full.paper_version = full.paper_version || 1;
  full.pinned = !!full.pinned;
  if (!full.created_at) full.created_at = Date.now();
  full.opens = full.opens || [];
  full.replies = full.replies || [];
  letters.push(full);
  writeLetters(letters);
  return full;
}

// ── 列表（首页信匣 / 回形针 / 我的 同源口径）──
// 合并真实寄出的信（letters_mock，排最前）与演示数据（按 DEMO_STATE）；
// 已被操作落成真实信的演示信、被删除的演示信不再从演示池重复出现。
// 返回 { list, draftCount }；draftCount 为演示草稿数（云端草稿接入后由 draft 服务提供）。
function getAll() {
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('today', 'mailbox', {}).then((r) => ({
      list: r.letters || [],
      draftCount: r.draftCount || 0,
      todayId: r.todayId || ''
    }));
  }
  const sent = readLetters();
  const sentIds = new Set(sent.map((l) => String(l.id)));
  const removed = new Set(readDemoRemoved().map(String));
  const demoPool = MOCK_LETTERS.filter(
    (l) => !sentIds.has(String(l.id)) && !removed.has(String(l.id))
  );
  let list = [];
  let draftCount = 0;
  if (DEMO_STATE === 'empty') {
    list = sent;
  } else if (DEMO_STATE === 'few') {
    list = [...sent, ...demoPool.slice(0, 4)];
  } else {
    list = [...sent, ...demoPool];
    draftCount = MOCK_DRAFT_COUNT;
  }
  return Promise.resolve({ list, draftCount, todayId: '' });
}

// ── 单封信（详情 / 分享页同源）──
// 返回 { letter, isDemo }；local 下按 id 找不到或未传 id 时回落演示数据预览状态。
// 演示回落时保留请求 id：后续对该信的写操作可落成真实信（ensureReal）。
// cloud 下取不到（不存在/不属于当前用户/已进废纸篓）时显式失败，
// 由页面提示「取不出来」，不再回落演示数据（云端模式没有演示语义）。
// opts.record=true：拆信同时落一条重读记录（BR-09）。云端由 letter.get 的 record 参数在
// 同一次调用内完成（省掉详情页第二轮云函数往返，见 技术架构文档 §4.3），local 复刻原行为。
// 分享页预览不传该参数 —— 预览不是拆信，不得产生邮戳。
function get(id, opts) {
  const record = !!(opts && opts.record);
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('letter', 'get', { id, record }).then((r) => {
      if (r && r.letter) return { letter: r.letter, isDemo: false };
      return Promise.reject(new Error('letter not found or recycled'));
    });
  }
  let letter = null;
  if (id) {
    letter = readLetters().find((l) => String(l.id) === String(id)) || null;
  }
  if (letter) {
    const copy = JSON.parse(JSON.stringify(letter));
    if (record) recordLocally(copy);
    return Promise.resolve({ letter: copy, isDemo: false });
  }
  const demo = demoLetter();
  if (id) demo.id = id;
  if (record) recordLocally(demo);
  return Promise.resolve({ letter: demo, isDemo: true });
}

function demoLetter() {
  return JSON.parse(JSON.stringify(DEMO_LETTERS[DEMO_STATE] || DEMO_LETTERS.multi));
}

// ── 寄出（写信第二步，BR-01/13；theme_id + theme_version 绑定创建时版本，
// paper_id + paper_version 绑定创建时信纸版式）──
// 返回新信 id。
function create(data) {
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('letter', 'create', data).then((r) => r.id);
  }
  const newLetterId = 'l' + Date.now();
  const letters = readLetters();
  letters.push({
    id: newLetterId,
    name: data.name,
    question: data.question,
    answer: data.answer,
    theme_id: data.theme_id,
    theme_version: data.theme_version,
    paper_id: data.paper_id || 'liubai',
    paper_version: data.paper_version || 1,
    pinned: false,
    created_at: Date.now()
  });
  writeLetters(letters);
  return Promise.resolve(newLetterId);
}

// ── 编辑保存（PRD 5.6：只更新内容/主题/theme_version/信纸版式并记 updated_at，
// 重读记录与回信静默原样保留）。返回是否真正落库（演示数据不持久化）。
function update(id, data) {
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('letter', 'update', Object.assign({ id }, data)).then(() => true);
  }
  const letters = readLetters();
  const index = letters.findIndex((l) => String(l.id) === String(id));
  if (index === -1) return Promise.resolve(false);
  letters[index] = Object.assign({}, letters[index], {
    name: data.name,
    question: data.question,
    answer: data.answer,
    theme_id: data.theme_id,
    theme_version: data.theme_version,
    paper_id: data.paper_id || letters[index].paper_id || 'liubai',
    paper_version: data.paper_version || letters[index].paper_version || 1,
    updated_at: Date.now()
  });
  writeLetters(letters);
  return Promise.resolve(true);
}

// ── 回形针（BR-06：只改排序与角标）。传入信件对象（演示信落成真实信）。返回点亮结果。
function setPinned(letter, pinned) {
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('letter', 'pin', { id: letter.id, pinned }).then(() => pinned);
  }
  ensureReal(letter);
  const letters = readLetters();
  const index = letters.findIndex((l) => String(l.id) === String(letter.id));
  if (index === -1) return Promise.resolve(pinned);
  letters[index].pinned = pinned;
  writeLetters(letters);
  return Promise.resolve(pinned);
}

// ── 拆信重读（BR-09：拆一次记一条，同日不重复，用户不可编辑/删除）──
// 云端独立入口走 open.add（旧客户端仍在用）；详情页已改走 get(id, { record: true })，
// 在同一次 letter.get 内完成记录，不再单独往返一次云函数。
// local：直接在 letter.opens 上做当日去重并落库；cloud：返回服务端全量邮戳（时间戳数组）。
function recordOpen(letter) {
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('open', 'add', { letter_id: letter.id }).then((r) => {
      letter.opens = (r && r.opens) || letter.opens || [];
      letter.opens.sort((a, b) => a - b);
      return letter.opens;
    });
  }
  return Promise.resolve(recordLocally(letter));
}

// local 版当日去重（真实信落库；演示信不在 letters_mock 中，persist 静默失败 —— 与原行为一致）
function recordLocally(letter) {
  const now = Date.now();
  letter.opens = (letter.opens || []).slice();
  if (!letter.opens.some((ts) => sameDay(ts, now))) {
    letter.opens.push(now);
  }
  letter.opens.sort((a, b) => a - b);
  persist(letter);
  return letter.opens;
}

// ── 回信（BR-10：用户主动新增，日期自动生成不可改）──
// 返回更新后的回信数组（元素 {ts, text}，页面直接渲染便签流）；演示信先落成真实信。
// 云端走 letter 云函数的 addReply/removeReply —— 详情页拆信时 letter 已被调用（实例是热的），
// 比单独叫一个只在此处出现的 reply 云函数少一次冷启动（首贴可能省 1~2 秒）。
// reply 云函数的 add/remove 保留为旧客户端入口，两边幂等口径一致（见 tests 回归用例）。
function addReply(letter, text) {
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('letter', 'addReply', { id: letter.id, content: text }).then((r) => {
      letter.replies = (r && r.replies) || letter.replies || [];
      return letter.replies;
    });
  }
  ensureReal(letter);
  letter.replies = (letter.replies || []).concat([{ ts: Date.now(), text }]);
  persist(letter);
  return Promise.resolve(letter.replies);
}

// ── 撕掉回信（用户删除单条回信；物理删除，不进废纸篓）──
// 按 ts（创建时间戳）精确匹配；返回更新后的回信数组（元素 {ts, text}）；演示信先落成真实信
function removeReply(letter, ts) {
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('letter', 'removeReply', { id: letter.id, ts }).then((r) => {
      letter.replies = (r && r.replies) || [];
      return letter.replies;
    });
  }
  ensureReal(letter);
  letter.replies = (letter.replies || []).filter((r) => Number(r.ts) !== Number(ts));
  persist(letter);
  return Promise.resolve(letter.replies);
}

// ── 整信回写（local 编辑态兜底；云端各变更走独立 action，不需要整体覆盖）──
function persist(letter) {
  if (DATA_SOURCE === 'cloud') return Promise.resolve(false);
  const letters = readLetters();
  const index = letters.findIndex((l) => String(l.id) === String(letter.id));
  if (index === -1) return Promise.resolve(false);
  letters[index] = letter;
  writeLetters(letters);
  return Promise.resolve(true);
}

// ── 删除 → 废纸篓（BR-11：信件连重读记录与回信原样进入 30 天保留期）──
// 演示信先落成真实信再删除，并从演示池剔除（防止"删了又复活"）；
// 入废纸篓的是 ensureReal 补全后的完整信件（含 created_at 等字段兜底）
function moveToRecycle(letter) {
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('letter', 'moveToRecycle', { id: letter.id });
  }
  const wasReal = readLetters().some((l) => String(l.id) === String(letter.id));
  const real = ensureReal(letter);
  writeLetters(readLetters().filter((l) => String(l.id) !== String(real.id)));
  if (!wasReal) addDemoRemoved(real.id);
  const recycle = wx.getStorageSync(RECYCLE_KEY) || [];
  recycle.push(Object.assign({}, real, { deleted_at: Date.now() }));
  wx.setStorageSync(RECYCLE_KEY, recycle);
  return Promise.resolve(true);
}

// ── 废纸篓列表：满 30 天自动清理（BR-11），返回 { items } ──
// local 演示：首次查看时把演示数据落成真实废纸篓数据（recycle_demo_seeded 一次性标记），
// 此后取回/彻底删除全部真实生效，不再回落演示
function listRecycle() {
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('letter', 'listRecycle', {}).then((r) => ({
      items: r.items || [],
      isDemo: false
    }));
  }
  let list = wx.getStorageSync(RECYCLE_KEY) || [];
  if (!list.length && RECYCLE_DEMO_STATE === 'full' && !wx.getStorageSync(RECYCLE_SEEDED_KEY)) {
    list = JSON.parse(JSON.stringify(DEMO_RECYCLE_ITEMS));
    wx.setStorageSync(RECYCLE_KEY, list);
    wx.setStorageSync(RECYCLE_SEEDED_KEY, true);
  }
  const now = Date.now();
  const alive = list.filter((it) => it.deleted_at && now - it.deleted_at < KEEP_DAYS * DAY);
  if (alive.length !== list.length) {
    wx.setStorageSync(RECYCLE_KEY, alive);
  }
  return Promise.resolve({ items: alive, isDemo: false });
}

// ── 取回：原样恢复回信匣（含重读记录与回信）；演示来源的记录按名称补全正文 ──
function restoreFromRecycle(id) {
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('letter', 'restore', { id });
  }
  const recycle = wx.getStorageSync(RECYCLE_KEY) || [];
  const restored = recycle.find((l) => String(l.id) === String(id));
  wx.setStorageSync(
    RECYCLE_KEY,
    recycle.filter((l) => String(l.id) !== String(id))
  );
  if (restored) {
    removeDemoRemoved(id);
    ensureReal(restored);
  }
  return Promise.resolve(!!restored);
}

// ── 彻底删除（BR-12：物理删除不可恢复）──
function purgeFromRecycle(id) {
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('letter', 'purge', { id });
  }
  const recycle = wx.getStorageSync(RECYCLE_KEY) || [];
  wx.setStorageSync(
    RECYCLE_KEY,
    recycle.filter((l) => String(l.id) !== String(id))
  );
  // 若为演示来源的记录，同步从演示池剔除，避免网格"复活"
  addDemoRemoved(id);
  return Promise.resolve(true);
}

function sameDay(a, b) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

module.exports = {
  getAll,
  get,
  create,
  update,
  setPinned,
  recordOpen,
  addReply,
  removeReply,
  persist,
  moveToRecycle,
  listRecycle,
  restoreFromRecycle,
  purgeFromRecycle
};
