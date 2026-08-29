// 草稿服务（技术架构文档.md §5.4 三层防线）
// 第一版：本地 storage 为第一道防线（行为与原页面完全一致）；云端 drafts 集合
// 同步（失焦/onHide 异步备份、恢复时取较新者）在 M2 接入，接口形状已按云端预留。

const { DATA_SOURCE } = require('../config/env.js');
const cloud = require('./cloud.js');

// letter_draft_current 是"新信"草稿（首页草稿横条读取）；
// letter_edit_current 是编辑已有信件的防丢失草稿，带 letterId，二者不可混用。
const DRAFT_KEY = 'letter_draft_current';
const EDIT_DRAFT_KEY = 'letter_edit_current';

// 读取新信草稿；无内容或属于编辑态（带 letterId）时返回 null
// 云端读取失败时静默返回 null：草稿是辅助数据，不拖垮信匣等主页面
function get() {
  if (DATA_SOURCE === 'cloud') {
    return cloud
      .call('draft', 'get', {})
      .then((r) => {
        const d = r && r.draft;
        return d && !d.letterId && (d.name || d.question || d.answer) ? d : null;
      })
      .catch(() => null);
  }
  const draft = wx.getStorageSync(DRAFT_KEY);
  return Promise.resolve(draft && (draft.name || draft.question || draft.answer) ? draft : null);
}

// 保存新信草稿（每 10 秒 / 失焦 / 切后台时调用）；失败静默（草稿最佳努力，不打扰用户）
function save(draft) {
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('draft', 'save', { draft }).catch(() => null);
  }
  wx.setStorageSync(DRAFT_KEY, Object.assign({}, draft, { updatedAt: Date.now() }));
  return Promise.resolve(true);
}

function clear() {
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('draft', 'clear', {}).catch(() => null);
  }
  wx.removeStorageSync(DRAFT_KEY);
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

module.exports = { get, save, clear, getEdit, saveEdit, clearEdit, DRAFT_KEY, EDIT_DRAFT_KEY };
