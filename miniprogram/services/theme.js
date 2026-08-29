// 主题服务（技术架构文档.md §4.6 / M4）
// 第一版主题配置仍是本地静态文件（write/themes.js）；云端 themes 集合 +
// 版本号增量更新在 M4 接入。页面统一从这里取主题，不再各自 require themes.js。
const { DATA_SOURCE } = require('../config/env.js');
const cloud = require('./cloud.js');
const LOCAL_THEMES = require('../pages/write/themes.js');

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
          wx.setStorageSync(CACHE_KEY, { at: Date.now(), list });
          return list;
        }
        return LOCAL_THEMES;
      })
      .catch(() => LOCAL_THEMES);
  }
  return Promise.resolve(LOCAL_THEMES);
}

// 信件主题信封图：素材未就绪/未知的 theme_id 回落默认主题（当前小王子，与原页面一致）
function envelopeOf(themeId, themes) {
  const list = themes || LOCAL_THEMES;
  const theme = list.find((t) => t.id === themeId) || list[0];
  return theme.envelope || list[0].envelope;
}

function paperOf(themeId, themes) {
  const list = themes || LOCAL_THEMES;
  const theme = list.find((t) => t.id === themeId) || list[0];
  return theme.paper || list[0].paper;
}

module.exports = { getThemes, envelopeOf, paperOf };
