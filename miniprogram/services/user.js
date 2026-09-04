// 用户服务：资料、统计、注销（技术架构文档.md §4.1 / §5.1 user·stats）
const { DATA_SOURCE } = require('../config/env.js');
const cloud = require('./cloud.js');
const { MOCK_USER, MOCK_STATS, MOCK_RECYCLE_COUNT } = require('../pages/mine/mock.js');

const PROFILE_KEY = 'account_profile';

// 注销时清除的用户数据键：信件、废纸篓、草稿列表与旧单草稿键、编辑草稿、
// 落格动效标记、本地资料、首次寄出提示标记（注销后下次寄出重新提示）。
// handwriting_off（手写体无障碍开关）属于设备偏好，不随注销清除。
const USER_DATA_KEYS = [
  'letters_mock',
  'recycle_mock',
  'letter_drafts',
  'letter_draft_current',
  'letter_edit_current',
  'letter_just_arrived',
  'user_sealed_once',
  'demo_removed_ids',
  'recycle_demo_seeded',
  'member_demo_state',
  'member_demo_expire_at',
  PROFILE_KEY
];

// 本地资料优先（account_profile），未设置过回落演示数据（我的页名片与账号管理页同口径）
function getProfile() {
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('user', 'getProfile', {}).then((r) => {
      const p = (r && r.profile) || {};
      return {
        nickname: p.nickname || MOCK_USER.nickname,
        avatar: p.avatar || '',
        wroteDays: (r && r.registerDays) || MOCK_USER.wroteDays
      };
    }).catch((err) => {
      // 后台封禁：user 云函数对 status='banned' 返回 { ok:false, error:'banned' }，
      // 此处提示并阻断继续使用（封禁由 admin 后台 userBan 操作写入）
      if (String(err && err.message).indexOf('banned') !== -1) {
        wx.showModal({
          title: '无法使用',
          content: '该账号已被暂停使用。如有疑问请联系运营。',
          showCancel: false,
          confirmText: '知道了'
        });
      }
      throw err;
    });
  }
  const saved = wx.getStorageSync(PROFILE_KEY);
  return Promise.resolve({
    nickname: (saved && saved.nickname) || MOCK_USER.nickname,
    avatar: (saved && saved.avatar) || '',
    wroteDays: MOCK_USER.wroteDays
  });
}

// 保存头像/昵称（官方头像昵称填写能力回传后调用）。
// 云端只收 cloud:// fileID：头像还是本地临时/存留文件时，先上传云存储换 fileID 再落库，
// 否则「我的」页名片从云端拉资料时头像会丢
function saveProfile(profile) {
  if (DATA_SOURCE === 'cloud') {
    const avatar = (profile && profile.avatar) || '';
    if (avatar && avatar.indexOf('cloud://') !== 0) {
      return cloud.uploadFile(avatar).then((fileID) =>
        cloud.call('user', 'saveProfile', {
          profile: Object.assign({}, profile, { avatar: fileID })
        })
      );
    }
    return cloud.call('user', 'saveProfile', { profile });
  }
  wx.setStorageSync(PROFILE_KEY, profile);
  return Promise.resolve(true);
}

// 「我的」页统计：四项便签 + 回形针数 + 废纸篓数（PRD 第八节，一次聚合返回）
// local：四项与废纸篓数用演示数据，回形针/废纸篓行由页面经 letter 服务实时计算后展示
function getStats() {
  if (DATA_SOURCE === 'cloud') {
    return cloud.call('stats', 'get', {}).then((r) => ({
      letterTotal: r.letterTotal || 0,
      rereadTotal: r.rereadTotal || 0,
      replyTotal: r.replyTotal || 0,
      registerDays: r.registerDays || 1,
      pinnedCount: r.pinnedCount || 0,
      recycleCount: r.recycleCount || 0
    }));
  }
  return Promise.resolve({
    letterTotal: MOCK_STATS.letterTotal,
    rereadTotal: MOCK_STATS.rereadTotal,
    replyTotal: MOCK_STATS.replyTotal,
    registerDays: MOCK_STATS.registerDays,
    pinnedCount: 0,
    recycleCount: MOCK_RECYCLE_COUNT
  });
}

// 账号注销（PRD 第六节固定文案在前端弹窗，此处负责清数据）
function deactivate() {
  if (DATA_SOURCE === 'cloud') {
    // 云端物理删除该 openid 全部数据（users/letters/open_records/reply_records/drafts），
    // 本地键同步清除；注销结果不再依赖网络成功与否，避免「点了注销却退不出去」
    cloud.call('user', 'deactivate', {}).catch(() => {});
  }
  USER_DATA_KEYS.forEach((k) => wx.removeStorageSync(k));
  return Promise.resolve(true);
}

module.exports = { getProfile, saveProfile, getStats, deactivate, USER_DATA_KEYS, PROFILE_KEY };
