// 主题服务（技术架构文档.md §4.6）
// 主题与信纸版式统一出口：云端走 theme 云函数（themes / papers 集合，由 Web 后台维护），
// 空或失败一律回落本地静态配置（write/themes.js、write/papers.js），保证离线可用。
// 页面统一从这里取，不再各自 require themes.js。
const { DATA_SOURCE } = require('../config/env.js');
const cloud = require('./cloud.js');
const LOCAL_THEMES = require('../pages/write/themes.js');
const LOCAL_PAPERS = require('../pages/write/papers.js');

const CACHE_KEY = 'theme_cache';
const PAPERS_CACHE_KEY = 'papers_cache';
const CACHE_TTL = 60 * 60 * 1000; // 1h：后台改主题/版式/专属内容后尽快生效

// 默认款 / 回落款（2026-09-20 起显式按 id 解析，不再依赖「列表第一套」）：
//   信纸默认 = 留白志 liubai；主题默认 = 璀璨如初 cuican。
// 云端列表按后台 sort 排序，第一套是谁由数据决定；显式 id 保证云端/本地回落口径一致，
// 后台怎么排序都不影响默认款。列表里找不到默认 id 时才退 list[0]（防御性兜底）。
const DEFAULT_THEME_ID = 'cuican';
const DEFAULT_PAPER_ID = 'liubai';

function pickDefault(list, id) {
  const arr = list || [];
  return arr.find((it) => it.id === id) || arr[0];
}

// 主题统一出口。force=true 时绕过本地缓存强刷（会员页用于即时展示后台新增的专属款）。
function getThemes(force) {
  if (DATA_SOURCE === 'cloud') {
    const cached = wx.getStorageSync(CACHE_KEY);
    if (!force && cached && Date.now() - cached.at < CACHE_TTL && cached.list && cached.list.length) {
      return Promise.resolve(cached.list);
    }
    return cloud
      .call('theme', 'list', {})
      .then((r) => {
        const list = (r && r.themes) || [];
        if (list.length) {
          const normalized = normalizeThemes(list);
          wx.setStorageSync(CACHE_KEY, { at: Date.now(), list: normalized });
          return normalized;
        }
        return normalizeThemes(LOCAL_THEMES);
      })
      .catch(() => normalizeThemes(LOCAL_THEMES));
  }
  return Promise.resolve(normalizeThemes(LOCAL_THEMES));
}

// 同步读主题缓存（不发云调用）：详情页拆信动画要在首帧就画对信封与纸色，而云调用是异步的，
// 进页面时先同步取一份（无缓存返回空数组，调用方回落默认款）。写入仍只发生在 getThemes。
function cachedThemes() {
  if (DATA_SOURCE !== 'cloud') return normalizeThemes(LOCAL_THEMES);
  const cached = wx.getStorageSync(CACHE_KEY);
  if (cached && cached.list && cached.list.length) return cached.list;
  return [];
}

// 主题字段归一化：信纸已是配色排版（无纸张图片），信封素材未就绪的主题
// 回落默认主题信封，palette/desk 缺失时回落默认主题，页面可零判断直接使用。
// palette 只认底色 base（墨色由版式自持）：判空必须判到 base 本身 —— 后台把底色清空后
// 存下来的是 { base: '' }，整体为真值，若写成 t.palette || def.palette 会让拆信动画
// 拿到空 background 画出一张透明纸，而不是回落默认款。
// ownEnvelope 标记是否有自有信封素材（无素材的主题在选择卡片上用色样展示，
// 避免所有卡片都渲染成同一张默认信封图）
function uniqueById(list) {
  const seen = {};
  return (list || []).filter((it) => (seen[it.id] ? false : (seen[it.id] = true)));
}

function normalizeThemes(list) {
  const def = pickDefault(LOCAL_THEMES, DEFAULT_THEME_ID);
  return uniqueById((list || []).map((t) =>
    Object.assign({}, t, {
      ownEnvelope: !!t.envelope,
      envelope: t.envelope || def.envelope,
      envelopeThumb: t.envelopeThumb || t.envelope || def.envelopeThumb,
      palette: (t.palette && t.palette.base) ? t.palette : def.palette,
      desk: t.desk || def.desk,
      swatch: t.swatch || (t.palette && t.palette.base) || (def.palette && def.palette.base) || ''
    })
  ));
}

// 会员专属回退：非 VIP 时专属主题/版式一律按默认款渲染（老信不破坏数据，
// 开通会员后自动恢复，见 AGENTS.md 会员专区）。isVip 由各页面经 member 服务传入。
function isLocked(item, isVip) {
  return !!(item && item.premium) && !isVip;
}

// 主题解析（同步，无云调用）：未知/缺失 theme_id 回落默认款（璀璨如初，按 id 显式解析），
// 非 VIP 的专属款同样回落默认款（会员过期后老信按默认款渲染，开通后自动恢复）。
// themes 传空（冷启动无缓存）回落本地静态配置 —— 与 paperOf 同口径，调用方可以直接拿它画首帧。
//
// 这是「列表卡片」与「详情拆信幕」**唯一的主题解析出口**：入口页在 navigateTo 之前
// 用它解析好这封信的主题、经 services/handoff.js 交给详情页，于是两处首帧画的一定是
// 同一张信封（详情页不再自己猜主题，也不会因为事件通道/云函数晚到而先亮默认款）。
function themeOf(themeId, themes, isVip) {
  const list = themes && themes.length ? themes : normalizeThemes(LOCAL_THEMES);
  const theme = list.find((t) => t.id === themeId) || pickDefault(list, DEFAULT_THEME_ID);
  return isLocked(theme, isVip) ? pickDefault(list, DEFAULT_THEME_ID) : theme;
}

// 网格/列表用小图信封：首页信匣、回形针列表、废纸篓行的缩略信封（避免解码高清大图）；未配置时回落主信封。
// 空数组与 null 同等回落本地静态配置（与 paperOf 同口径）：cachedThemes() 在冷启动无缓存时
// 返回 []，调用方要能直接拿它画首帧，不能在这里炸掉。
function envelopeThumbOf(themeId, themes, isVip) {
  const list = themes && themes.length ? themes : LOCAL_THEMES;
  const theme = themeOf(themeId, themes, isVip);
  const def = pickDefault(list, DEFAULT_THEME_ID);
  return theme.envelopeThumb || theme.envelope || def.envelopeThumb || def.envelope || '';
}

// 信纸版式（主题只绑信封与配色，版式独立选择）
// 云端 papers 集合由 Web 后台维护（admin 云函数），theme 云函数 papers action 下发
// （官方二十一款 + 会员专属版式，专属款带 premium:true）；云端为空/失败/本地模式一律
// 回落本地静态配置，保证离线可用。force=true 绕过缓存强刷（会员页用于即时展示后台新增的专属款）。
// 归一化兜底：字段缺失的项剔除，同一 id 去重，保证页面拿到的版式都可用于渲染。
function normalizePapers(list) {
  return uniqueById((list || []).filter((p) => p && p.id && p.name));
}

function getPapers(force) {
  if (DATA_SOURCE !== 'cloud') return Promise.resolve(normalizePapers(LOCAL_PAPERS));
  // 与 getThemes 同口径的本地缓存：详情/分享/写信第二步每次进入都取版式，
  // 无缓存会每次都打一次 theme/papers 云函数（含 member_items 聚合）。
  const cached = wx.getStorageSync(PAPERS_CACHE_KEY);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL && cached.list && cached.list.length) {
    return Promise.resolve(cached.list);
  }
  return cloud
    .call('theme', 'papers', {})
    .then((r) => {
      const list = (r && r.papers) || [];
      if (!list.length) return normalizePapers(LOCAL_PAPERS);
      const normalized = normalizePapers(list);
      wx.setStorageSync(PAPERS_CACHE_KEY, { at: Date.now(), list: normalized });
      return normalized;
    })
    .catch(() => normalizePapers(LOCAL_PAPERS));
}

// 同步读版式缓存（不发云调用）：会员页首帧要立刻画出后台配置的专属款，
// 而 getPapers 是异步的；无缓存返回空数组，调用方回落本地静态配置。
// 与 cachedThemes 同口径，写入仍只发生在 getPapers。
function cachedPapers() {
  if (DATA_SOURCE !== 'cloud') return normalizePapers(LOCAL_PAPERS);
  const cached = wx.getStorageSync(PAPERS_CACHE_KEY);
  if (cached && cached.list && cached.list.length) return cached.list;
  return [];
}

// 信件版式解析：未知/缺失 paper_id 回落默认款留白志（老信件视觉零跳变）；
// 非 VIP 的专属版式同样回落默认款（会员过期后老信按默认信纸渲染）
function paperOf(paperId, papers, isVip) {
  const list = papers && papers.length ? papers : normalizePapers(LOCAL_PAPERS);
  const paper = list.find((p) => p.id === paperId) || pickDefault(list, DEFAULT_PAPER_ID);
  return isLocked(paper, isVip) ? pickDefault(list, DEFAULT_PAPER_ID) : paper;
}

module.exports = {
  getThemes, cachedThemes, themeOf, envelopeThumbOf, getPapers, cachedPapers, paperOf,
  DEFAULT_THEME_ID, DEFAULT_PAPER_ID
};
