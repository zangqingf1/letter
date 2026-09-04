// 主题服务（技术架构文档.md §4.6 / M4）
// 第一版主题配置仍是本地静态文件（write/themes.js）；云端 themes 集合 +
// 版本号增量更新在 M4 接入。页面统一从这里取主题，不再各自 require themes.js。
const { DATA_SOURCE } = require('../config/env.js');
const cloud = require('./cloud.js');
const LOCAL_THEMES = require('../pages/write/themes.js');
const LOCAL_PAPERS = require('../pages/write/papers.js');

const CACHE_KEY = 'theme_cache';
const CACHE_TTL = 60 * 60 * 1000; // 1h：后台改主题/版式/专属内容后尽快生效

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

// 主题字段归一化：信纸已是配色排版（无纸张图片），信封素材未就绪的主题
// 回落默认主题信封，palette/desk 缺失时回落默认主题，页面可零判断直接使用。
// ownEnvelope 标记是否有自有信封素材（无素材的主题在选择卡片上用色样展示，
// 避免所有卡片都渲染成同一张默认信封图）
function uniqueById(list) {
  const seen = {};
  return (list || []).filter((it) => (seen[it.id] ? false : (seen[it.id] = true)));
}

function normalizeThemes(list) {
  const def = LOCAL_THEMES[0];
  return uniqueById((list || []).map((t) =>
    Object.assign({}, t, {
      ownEnvelope: !!t.envelope,
      envelope: t.envelope || def.envelope,
      envelopeThumb: t.envelopeThumb || t.envelope || def.envelopeThumb,
      palette: t.palette || def.palette,
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

// 信件主题信封图：素材未就绪/未知的 theme_id 回落默认主题（当前小王子，与原页面一致）；
// 非 VIP 的专属主题同样回落默认信封
function envelopeOf(themeId, themes, isVip) {
  const list = themes || LOCAL_THEMES;
  const theme = list.find((t) => t.id === themeId) || list[0];
  if (isLocked(theme, isVip)) return list[0].envelope || '';
  return theme.envelope || list[0].envelope;
}

// 信纸配色（方案B：信纸 = 底色 + 纯排版，无纸张图片）；未配置时回落默认主题配色
function paletteOf(themeId, themes, isVip) {
  const list = themes || LOCAL_THEMES;
  const theme = list.find((t) => t.id === themeId) || list[0];
  if (isLocked(theme, isVip)) return list[0].palette || '';
  return theme.palette || list[0].palette;
}

// 网格/列表用小图信封：首页信匣、回形针列表、废纸篓行的缩略信封（避免解码高清大图）；未配置时回落主信封
function envelopeThumbOf(themeId, themes, isVip) {
  const list = themes || LOCAL_THEMES;
  const theme = list.find((t) => t.id === themeId) || list[0];
  if (isLocked(theme, isVip)) return list[0].envelopeThumb || list[0].envelope || '';
  return theme.envelopeThumb || theme.envelope || list[0].envelopeThumb || list[0].envelope;
}

// 信纸版式（主题只绑信封与配色，版式独立选择）
// 云端 papers 集合由 Web 后台维护（admin 云函数），theme 云函数 papers action 下发
// （官方十款 + 会员专属版式，专属款带 premium:true）；云端为空/失败/本地模式一律
// 回落本地静态配置，保证离线可用。force=true 绕过缓存强刷。
// 归一化兜底：字段缺失的项剔除，同一 id 去重，保证页面拿到的版式都可用于渲染。
function normalizePapers(list) {
  return uniqueById((list || []).filter((p) => p && p.id && p.name));
}

function getPapers() {
  if (DATA_SOURCE !== 'cloud') return Promise.resolve(normalizePapers(LOCAL_PAPERS));
  return cloud
    .call('theme', 'papers', {})
    .then((r) => {
      const list = (r && r.papers) || [];
      return list.length ? normalizePapers(list) : normalizePapers(LOCAL_PAPERS);
    })
    .catch(() => normalizePapers(LOCAL_PAPERS));
}

// 信件版式解析：未知/缺失 paper_id 回落第一套素笺（老信件视觉零跳变）；
// 非 VIP 的专属版式同样回落第一套（会员过期后老信按默认信纸渲染）
function paperOf(paperId, papers, isVip) {
  const list = papers && papers.length ? papers : normalizePapers(LOCAL_PAPERS);
  const paper = list.find((p) => p.id === paperId) || list[0];
  return isLocked(paper, isVip) ? list[0] : paper;
}

module.exports = { getThemes, envelopeOf, envelopeThumbOf, paletteOf, getPapers, paperOf };
