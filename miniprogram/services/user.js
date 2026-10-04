// 用户服务：资料、统计、注销（技术架构文档.md §4.1 / §5.1 user·stats）
const { DATA_SOURCE } = require('../config/env.js');
const cloud = require('./cloud.js');
const memberService = require('./member.js');
const { MOCK_USER, MOCK_STATS, MOCK_RECYCLE_COUNT } = require('../pages/mine/mock.js');

const PROFILE_KEY = 'account_profile';

// 注销时清除的用户数据键：信件、废纸篓、草稿列表与旧单草稿键、编辑草稿、
// 落格动效标记、本地资料、首次寄出提示标记（注销后下次寄出重新提示）、主题/版式缓存
//（theme_cache / papers_cache 无用户内容，但属上一账号会话数据，一并清除避免跨账号残留）。
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
  'feedback_local',
  'theme_cache',
  'papers_cache',
  PROFILE_KEY
];

// ── 「我的」页数据的进程内缓存 ────────────────────────────────────────────
// 为什么是内存而不是 storage：资料与统计是「服务端事实」的副本，落盘等于把它变成
// 客户端可写凭据（会员态已按同一口径刻意不落 storage）。内存缓存随进程销毁，
// 既拿到「切 Tab 首屏零等待」，又不引入跨会话的脏数据。
// 为什么需要它：stats 云函数只有「我的」页调用，容器常年不复用 —— 不预热时，每次冷启动后
// 首次切到「我的」都要先等一次容器拉起的秒级冷启动。配合 app.js 的 prefetch
//（启动即预热容器 + 填缓存），进入页面时同步命中缓存先渲染，再在后台强制刷新替换。
const PROFILE_TTL = 60 * 1000;
const STATS_TTL = 30 * 1000;

let profileCache = null; // { at, data }
let statsCache = null;   // { at, data }

// 注销会让上面两个缓存与「当前账号」脱钩：注销时自增 epoch，在途请求回来后发现 epoch 变了
// 就不再写缓存，避免注销瞬间的旧请求把上一账号的资料重新写回，被 reLaunch 后的页面读到
let epoch = 0;

function fresh(cache, ttl) {
  return cache && Date.now() - cache.at < ttl ? cache.data : null;
}

// 本地资料优先（account_profile），未设置过回落演示数据（我的页名片与账号管理页同口径）
function getProfile(opts) {
  if (DATA_SOURCE === 'cloud') {
    const cached = !(opts && opts.force) && fresh(profileCache, PROFILE_TTL);
    return cached ? Promise.resolve(cached) : fetchProfile(false);
  }
  const saved = wx.getStorageSync(PROFILE_KEY);
  return Promise.resolve({
    nickname: (saved && saved.nickname) || MOCK_USER.nickname,
    avatar: (saved && saved.avatar) || '',
    birthday: (saved && saved.birthday) || '',
    wroteDays: MOCK_USER.wroteDays
  });
}

// silent=true 时不弹封禁提示：预热（prefetch）可能在用户根本还没进「我的」时触发，
// 不该由一次后台预热弹出阻断性弹窗；封禁仍由页面正常调用（silent=false）时提示。
function fetchProfile(silent) {
  const myEpoch = epoch;
  return cloud.call('user', 'getProfile', {}).then((r) => {
    const p = (r && r.profile) || {};
    const data = {
      nickname: p.nickname || MOCK_USER.nickname,
      avatar: p.avatar || '',
      birthday: p.birthday || '',
      wroteDays: (r && r.registerDays) || MOCK_USER.wroteDays
    };
    if (myEpoch === epoch) profileCache = { at: Date.now(), data };
    return data;
  }).catch((err) => {
    // 后台封禁：user 云函数对 status='banned' 返回 { ok:false, error:'banned' }，
    // 此处提示并阻断继续使用（封禁由 admin 后台 userBan 操作写入）
    if (!silent && String(err && err.message).indexOf('banned') !== -1) {
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

// 同步读缓存（不管是否过期）：页面首帧用，没有则返回 null 由页面显示骨架
function cachedProfile() {
  return profileCache ? profileCache.data : null;
}

// 保存头像/昵称/生日（官方头像昵称填写能力回传后调用）。
// 云端只收 cloud:// fileID：头像还是本地临时/存留文件时，先上传云存储换 fileID 再落库，
// 否则「我的」页名片从云端拉资料时头像会丢。
// 生日（MM-DD，月日）随整份 profile 直传，合法性由 user 云函数兜底校验。
function saveProfile(profile) {
  if (DATA_SOURCE === 'cloud') {
    const avatar = (profile && profile.avatar) || '';
    const task = avatar && avatar.indexOf('cloud://') !== 0
      ? cloud.uploadFile(avatar).then((fileID) =>
        cloud.call('user', 'saveProfile', {
          profile: Object.assign({}, profile, { avatar: fileID })
        })
      )
      : cloud.call('user', 'saveProfile', { profile });
    return task.then((r) => {
      // 缓存里是刚被改掉的旧资料：标记过期而非清空 —— 下次读取必然回源取新值，
      // 但在回源结果到达前，页面首帧仍能拿旧值占位，不会闪一屏骨架
      if (profileCache) profileCache.at = 0;
      return r;
    });
  }
  wx.setStorageSync(PROFILE_KEY, profile);
  return Promise.resolve(true);
}

// 「我的」页统计：四项便签 + 回形针数 + 废纸篓数（PRD 第八节，一次聚合返回）
// local：四项与废纸篓数用演示数据，回形针/废纸篓行由页面经 letter 服务实时计算后展示
function getStats(opts) {
  if (DATA_SOURCE === 'cloud') {
    const cached = !(opts && opts.force) && fresh(statsCache, STATS_TTL);
    return cached ? Promise.resolve(cached) : fetchStats();
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

function fetchStats() {
  const myEpoch = epoch;
  return cloud.call('stats', 'get', {}).then((r) => {
    const data = {
      letterTotal: r.letterTotal || 0,
      rereadTotal: r.rereadTotal || 0,
      replyTotal: r.replyTotal || 0,
      registerDays: r.registerDays || 1,
      pinnedCount: r.pinnedCount || 0,
      recycleCount: r.recycleCount || 0
    };
    if (myEpoch === epoch) statsCache = { at: Date.now(), data };
    return data;
  });
}

// 同步读缓存（不管是否过期）：页面首帧用，没有则返回 null 由页面显示骨架
function cachedStats() {
  return statsCache ? statsCache.data : null;
}

// 「我的」页数据预热：由 app.js 在静默建档完成后调用。
// stats 云函数只被「我的」页调用，常年冷启动；这里提前把两个云函数容器和内存缓存一起备好，
// 用户切到「我的」时首屏直接命中缓存。静默执行：失败不抛、不弹窗、不阻塞启动。
function prefetch() {
  if (DATA_SOURCE !== 'cloud') return;
  fetchProfile(true).catch(() => {});
  fetchStats().catch(() => {});
}

// 账号注销（PRD 第六节固定文案在前端弹窗，此处负责清数据）
function deactivate() {
  if (DATA_SOURCE === 'cloud') {
    // 云端物理删除该 openid 全部数据（users/letters/open_records/reply_records/drafts），
    // 本地键同步清除；注销结果不再依赖网络成功与否，避免「点了注销却退不出去」
    cloud.call('user', 'deactivate', {}).catch(() => {});
  }
  USER_DATA_KEYS.forEach((k) => wx.removeStorageSync(k));
  // 资料/统计缓存必须显式清空（不是标记过期）：注销后同一会话内绝不能再用上一账号的
  // 昵称、头像与统计数字渲染（reLaunch 不重置 services 模块状态）
  epoch += 1;
  profileCache = null;
  statsCache = null;
  // 会员态是进程内缓存（不落 storage），须显式丢弃，否则注销后同一会话内仍会按上一账号的
  // 会员态渲染专属信纸/信封（reLaunch 不重置 services 模块状态）
  memberService.resetDemo();
  return Promise.resolve(true);
}

module.exports = {
  getProfile,
  saveProfile,
  getStats,
  prefetch,
  cachedProfile,
  cachedStats,
  deactivate,
  USER_DATA_KEYS,
  PROFILE_KEY
};
