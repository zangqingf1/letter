// 草稿服务（技术架构文档.md §5.4 三层防线）
// 本地 storage 为第一道防线；云端模式（DATA_SOURCE='cloud'）由 draft 云函数读写
// drafts 集合备份。保存时机由页面控制（点「存草稿」或退出点「确定」），本服务不自行触发。
//
// 多草稿列表：letter_drafts 为草稿数组，每项 { id, name, question, answer, updatedAt }；
// 旧单草稿键 letter_draft_current 在首次 list() 时迁移进列表后移除。
// letter_edit_current 是编辑已有信件的防丢失草稿，带 letterId，与新信草稿不可混用。
// 删除草稿（remove/clearAll）为彻底删除：草稿尚未寄出，不进废纸篓。

const { DATA_SOURCE } = require('../config/env.js');
const cloud = require('./cloud.js');

const DRAFTS_KEY = 'letter_drafts';
const LEGACY_DRAFT_KEY = 'letter_draft_current';
const EDIT_DRAFT_KEY = 'letter_edit_current';

// 旧键名继续导出，注销清除清单等处仍引用
const DRAFT_KEY = LEGACY_DRAFT_KEY;

function newId() {
  return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function hasContent(d) {
  return !!(d && (d.name || d.question || d.answer));
}

function sortByNew(list) {
  return list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// 本地列表读取 + 旧单草稿键一次性迁移
function listLocal() {
  let drafts = wx.getStorageSync(DRAFTS_KEY);
  if (!Array.isArray(drafts)) drafts = [];
  const legacy = wx.getStorageSync(LEGACY_DRAFT_KEY);
  if (hasContent(legacy)) {
    drafts.push(Object.assign({ id: newId(), updatedAt: Date.now() }, legacy));
  }
  if (legacy) wx.removeStorageSync(LEGACY_DRAFT_KEY);
  drafts = drafts.filter(hasContent).map((d) => Object.assign({ id: d.id || newId() }, d));
  wx.setStorageSync(DRAFTS_KEY, drafts);
  return sortByNew(drafts);
}

// 读取全部草稿（按 updatedAt 倒序）；云端读取失败时静默返回空列表：
// 草稿是辅助数据，不拖垮写信页。
// 云函数版本过旧（未重新部署，收到 unknown action）时在控制台显式告警，
// 避免表现为"无草稿卡片"却查不到原因
function list() {
  if (DATA_SOURCE === 'cloud') {
    return cloud
      .call('draft', 'list', {})
      .then((r) => {
        if (!r || r.ok !== true) {
          console.warn('[draft] 云端草稿列表不可用，请重新部署 cloudfunctions/draft：', r && r.error);
          return [];
        }
        if (r.ver !== 2) {
          console.warn('[draft] 云端 draft 云函数为旧版本（单草稿），请重新部署 cloudfunctions/draft');
        }
        return r.drafts ? r.drafts.filter(hasContent) : [];
      })
      .catch((e) => {
        console.warn('[draft] 云端草稿列表调用失败：', e);
        return [];
      });
  }
  return Promise.resolve(listLocal());
}

// 本地 upsert（local 模式主路径；云端保存失败时也回落此处，尽量不丢内容）
function upsertLocal(item) {
  const drafts = listLocal();
  if (item.id) {
    const i = drafts.findIndex((d) => d.id === item.id);
    if (i > -1) drafts[i] = Object.assign({}, drafts[i], item);
    else drafts.push(item);
  } else {
    item.id = newId();
    drafts.push(item);
  }
  wx.setStorageSync(DRAFTS_KEY, drafts);
  return item;
}

// 保存草稿（upsert：带 id 更新对应项，无 id 追加新项）。
// 调用时机由页面决定（点「存草稿」、退出确认、切草稿/进第二步前静默落草稿），无自动保存；
// 失败静默（草稿最佳努力，不打扰用户）。
// 返回 Promise<含 id 的草稿项>，调用方据此回写 currentDraftId（寄出后精确清除）。
// 云端保存失败时回落本机 letter_drafts 兜底（内容不丢），但返回项带 _cloudFailed 标记，
// 调用方不得视为保存成功（不应提示「已存草稿」并退出）。
function save(draft) {
  const item = {
    id: (draft && draft.id) || '',
    name: (draft && draft.name) || '',
    question: (draft && draft.question) || '',
    answer: (draft && draft.answer) || '',
    updatedAt: Date.now()
  };
  if (DATA_SOURCE === 'cloud') {
    return cloud
      .call('draft', 'save', { draft: item })
      .then((r) => (r && r.ok ? Object.assign({}, item, { id: (r && r.id) || item.id }) : null))
      .catch(() => Object.assign(upsertLocal(item), { _cloudFailed: true }));
  }
  return Promise.resolve(upsertLocal(item));
}

// 删除单条草稿：直接移除，不进废纸篓（草稿未寄出，无重读/回信可恢复）
function remove(id) {
  if (!id) return Promise.resolve(true);
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('draft', 'remove', { id }).catch(() => null);
  }
  const drafts = (wx.getStorageSync(DRAFTS_KEY) || []).filter((d) => d.id !== id);
  wx.setStorageSync(DRAFTS_KEY, drafts);
  return Promise.resolve(true);
}

// 清空全部新信草稿（注销等场景）；编辑草稿见 clearEdit
function clearAll() {
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('draft', 'clearAll', {}).catch(() => null);
  }
  wx.removeStorageSync(DRAFTS_KEY);
  wx.removeStorageSync(LEGACY_DRAFT_KEY);
  return Promise.resolve(true);
}

// ── 编辑态草稿（带 letterId，正式封存或取消编辑时清除）──
function getEdit() {
  return Promise.resolve(wx.getStorageSync(EDIT_DRAFT_KEY) || null);
}

function saveEdit(letterId, content) {
  wx.setStorageSync(
    EDIT_DRAFT_KEY,
    Object.assign({ letterId }, content, { updatedAt: Date.now() })
  );
  return Promise.resolve(true);
}

function clearEdit() {
  wx.removeStorageSync(EDIT_DRAFT_KEY);
  return Promise.resolve(true);
}

module.exports = {
  list,
  save,
  remove,
  clearAll,
  getEdit,
  saveEdit,
  clearEdit,
  DRAFTS_KEY,
  DRAFT_KEY,
  EDIT_DRAFT_KEY
};
