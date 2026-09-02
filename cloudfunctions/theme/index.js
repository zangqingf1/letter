// 云函数 theme —— 主题列表 / 信纸版式列表（技术架构文档.md §4.6 / M4）
// themes 与 papers 集合由 Web 后台维护（admin 云函数）；写操作一律走后台，本函数只读。
// 历史信件锁定创建时 theme_version / paper_version（版本号在 letters 上，渲染素材按版本取）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  if (event.action !== 'list' && event.action !== 'papers') {
    return { ok: false, error: 'unknown action' };
  }
  try {
    // papers：十款信纸版式的配色配置（colors 与小程序 papers.js 同形状），只下发上架的
    if (event.action === 'papers') {
      const res = await db
        .collection('papers')
        .where({ status: 'online' })
        .orderBy('sort', 'asc')
        .limit(50)
        .get();
      return {
        ok: true,
        papers: res.data.map((p) => ({
          id: p.paper_id,
          name: p.name,
          desc: p.desc || '',
          version: p.version || 1,
          colors: p.colors || {}
        }))
      };
    }
    const res = await db
      .collection('themes')
      .where({ status: 'online' })
      .orderBy('sort', 'asc')
      .limit(50)
      .get();
    return {
      ok: true,
      themes: res.data.map((t) => ({
        id: t.theme_id,
        name: t.name,
        desc: t.desc || '',
        version: t.version || 1,
        pending: !!t.pending,
        envelope: t.assets && t.assets.envelope,
        // 方案B：信纸 = 配色排版（无纸张图片），下发 palette（base/title/text/tag）
        palette: t.palette || '',
        desk: t.desk || '',
        swatch: t.swatch || ''
      }))
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
