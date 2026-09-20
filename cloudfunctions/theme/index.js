// 云函数 theme —— 主题列表 / 信纸版式列表（技术架构文档.md §4.6 / M4）
// themes 与 papers 集合由 Web 后台维护（admin 云函数）；写操作一律走后台，本函数只读。
// 历史信件锁定创建时 theme_version / paper_version（版本号在 letters 上，渲染素材按版本取）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 合并官方款 + 会员专属款：同一 id 只保留一份，且专属款优先于官方款。
// 后台「从已有款挑选新建专属」会复用原款 id（member_items.item_id = 官方 id），
// 若先到先得丢弃专属款，后台增改的专属内容将不可见（只显示官方原样）；
// 专属款覆盖同 id 官方款后，后台改的配色/素材才能在下发列表里生效。
// 顺序：官方款按其 sort 排在前（位置不变），同 id 专属款原位覆盖，新增专属款追加在末尾。
function mergeLists(base, premium) {
  const byId = {};
  for (const it of (base || [])) byId[it.id] = it;
  for (const it of (premium || [])) byId[it.id] = it;
  return Object.keys(byId).map((id) => byId[id]);
}

exports.main = async (event) => {
  if (event.action !== 'list' && event.action !== 'papers') {
    return { ok: false, error: 'unknown action' };
  }
  try {
    // papers：二十一款信纸版式的配色配置（colors 与小程序 papers.js 同形状），只下发上架的。
    // 末尾追加上架的会员专属版式（member_items kind='paper'，premium:true），由前端按会员态解锁。
    if (event.action === 'papers') {
      const [paperRes, premiumRes] = await Promise.all([
        db.collection('papers').where({ status: 'online' }).orderBy('sort', 'asc').limit(50).get(),
        db.collection('member_items').where({ kind: 'paper', status: 'online' }).orderBy('sort', 'asc').limit(50).get()
      ]);
      const papers = paperRes.data.map((p) => ({
        id: p.paper_id,
        name: p.name,
        desc: p.desc || '',
        version: p.version || 1,
        colors: p.colors || {}
      }));
      const premium = premiumRes.data.map((p) => ({
        id: p.item_id,
        name: p.name,
        desc: p.desc || '',
        version: p.version || 1,
        colors: p.colors || {},
        premium: true
      }));
      return { ok: true, papers: mergeLists(papers, premium) };
    }
    // themes：官方主题 + 上架的会员专属主题（member_items kind='theme'，premium:true）
    const [themeRes, premiumRes] = await Promise.all([
      db.collection('themes').where({ status: 'online' }).orderBy('sort', 'asc').limit(50).get(),
      db.collection('member_items').where({ kind: 'theme', status: 'online' }).orderBy('sort', 'asc').limit(50).get()
    ]);
    const themes = themeRes.data.map((t) => ({
      id: t.theme_id,
      name: t.name,
      desc: t.desc || '',
      version: t.version || 1,
      envelope: t.assets && t.assets.envelope,
      // 缩略信封必须原样下发：首页信匣/回形针/废纸篓行用小图（避免解码高清大图）。
      // 早期漏了这个字段，云端主题的 envelopeThumb 恒为空，normalizeThemes 的下标
      // `t.envelopeThumb || t.envelope` 就把大图当缩略图用 —— 小图白白配了没人读。
      // 空串仍回落大图（normalizeThemes 判的是真值），故这条不会改变既有款的渲染结果。
      envelopeThumb: (t.assets && t.assets.envelopeThumb) || '',
      // 方案B：信纸 = 配色排版（无纸张图片），主题 palette 只剩底色 base
      // （拆信动画的信纸底色 + 无信封款的选择卡色样）；墨色由版式自持，不在主题里。
      // 老文档里残留的 title/text/tag 已无消费方：渲染侧只读 base，不会有人取它们。
      palette: t.palette || '',
      desk: t.desk || '',
      swatch: t.swatch || ''
    }));
    const premium = premiumRes.data.map((t) => ({
      id: t.item_id,
      name: t.name,
      desc: t.desc || '',
      version: t.version || 1,
      envelope: (t.assets && t.assets.envelope) || '',
      envelopeThumb: (t.assets && t.assets.envelopeThumb) || '',
      palette: t.palette || '',
      desk: t.desk || '',
      swatch: t.swatch || '',
      premium: true
    }));
    return { ok: true, themes: mergeLists(themes, premium) };
  } catch (e) {
    // 错误详情只进日志：不回传 DB/SDK 原始 message
    console.error('[theme] 读取失败', event.action, e);
    return { ok: false, error: 'internal error' };
  }
};
