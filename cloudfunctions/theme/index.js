// 云函数 theme —— 主题列表（技术架构文档.md §4.6 / M4）
// themes 集合由管理后台维护（M 第二阶段）；上线前先手工 seed 6 套官方主题。
// 历史信件锁定创建时 theme_version（版本号在 letters.theme_version，渲染素材按版本取）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  if (event.action !== 'list') return { ok: false, error: 'unknown action' };
  try {
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
        paper: t.assets && t.assets.paper,
        desk: t.desk || '',
        swatch: t.swatch || ''
      }))
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
