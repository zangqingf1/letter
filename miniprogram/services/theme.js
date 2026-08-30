// 主题服务（技术架构文档.md §4.6 / M4）
// 第一版主题配置仍是本地静态文件（write/themes.js）；云端 themes 集合 +
// 版本号增量更新在 M4 接入。页面统一从这里取主题，不再各自 require themes.js。
const { DATA_SOURCE } = require('../config/env.js');
const cloud = require('./cloud.js');
const LOCAL_THEMES = require('../pages/write/themes.js');
const LOCAL_PAPERS = require('../pages/write/papers.js');

const CACHE_KEY = 'theme_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000;

function getThemes() {
  if (DATA_SOURCE === 'cloud') {
    const cached = wx.getStorageSync(CACHE_KEY);
    if (cached && Date.now() - cached.at < CACHE_TTL && cached.list && cached.list.length) {
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
function normalizeThemes(list) {
  const def = LOCAL_THEMES[0];
  return (list || []).map((t) =>
    Object.assign({}, t, {
      ownEnvelope: !!t.envelope,
      envelope: t.envelope || def.envelope,
      envelopeThumb: t.envelopeThumb || t.envelope || def.envelopeThumb,
      palette: t.palette || def.palette,
      desk: t.desk || def.desk
    })
  );
}

// 信件主题信封图：素材未就绪/未知的 theme_id 回落默认主题（当前小王子，与原页面一致）
function envelopeOf(themeId, themes) {
  const list = themes || LOCAL_THEMES;
  const theme = list.find((t) => t.id === themeId) || list[0];
  return theme.envelope || list[0].envelope;
}

// 信纸配色（方案B：信纸 = 底色 + 纯排版，无纸张图片）；未配置时回落默认主题配色
function paletteOf(themeId, themes) {
  const list = themes || LOCAL_THEMES;
  const theme = list.find((t) => t.id === themeId) || list[0];
  return theme.palette || list[0].palette;
}

// 网格/列表用小图信封：首页信匣、回形针列表、废纸篓行的缩略信封（避免解码高清大图）；未配置时回落主信封
function envelopeThumbOf(themeId, themes) {
  const list = themes || LOCAL_THEMES;
  const theme = list.find((t) => t.id === themeId) || list[0];
  return theme.envelopeThumb || theme.envelope || list[0].envelopeThumb || list[0].envelope;
}

// ── 信纸版式（主题只绑信封与配色，版式独立选择）──
// 第一版版式为本地静态配置（write/papers.js）；后续云化与 themes 集合同路（M4）。
// 归一化兜底：字段缺失的项剔除，保证页面拿到的版式都可用于渲染。
function normalizePapers(list) {
  return (list || []).filter((p) => p && p.id && p.name);
}

function getPapers() {
  // 与 getThemes 同返回形态（Promise），云端接入后此处替换为 cloud.call('theme', 'papers')
  return Promise.resolve(normalizePapers(LOCAL_PAPERS));
}

// 信件版式解析：未知/缺失 paper_id 回落第一套素笺（老信件视觉零跳变）
function paperOf(paperId, papers) {
  const list = papers && papers.length ? papers : normalizePapers(LOCAL_PAPERS);
  return list.find((p) => p.id === paperId) || list[0];
}

module.exports = { getThemes, envelopeOf, envelopeThumbOf, paletteOf, getPapers, paperOf };
