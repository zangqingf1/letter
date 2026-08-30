// 信纸版式配置（方案B：信纸 = 配色 + 排版；主题只绑定信封与配色，版式独立选择）
// 与主题同样的版本规则：信件锁定创建时的 paper_version，版式更新不破坏历史信件视觉。
// 老信件无 paper_id 时由 paperOf 回落第一套素笺（即改版前的渲染，视觉零跳变）。
// 装饰色一律由主题 palette 四色派生 + 固定陶土锚点 #C58A6A，不依赖任何位图素材。
module.exports = [
  { id: 'su', name: '素笺', desc: '经典陶土头线', version: 1 },
  { id: 'airmail', name: '航空笺', desc: '斜纹边框邮票', version: 1 },
  { id: 'notebook', name: '笔记本', desc: '横格踩线', version: 1 },
  { id: 'weave', name: '织纹笺', desc: '布纹双框', version: 1 }
];
