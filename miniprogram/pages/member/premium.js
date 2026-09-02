// 会员专属 · 信纸版式与主题展示配置（2026-09 会员中心 UI 演示用）
// 仅用于会员中心「专属」锁定卡片的视觉展示（色样 + 名称 + 描述）。
// 本期为纯 UI：这些专属款不接入写信第二步/详情/分享三端同构渲染（真实解锁联动留到付费落地期）。
// 卡片只取 colors.bg / swatch 做色样，不触发 styles/paper 相关改动。
module.exports = {
  papers: [
    { id: 'gold', name: '鎏金笺', desc: '暖金细线 · 专属', colors: { bg: '#FAF4E6', ink: '#4A4033', gold: '#C6A870' } },
    { id: 'canglan', name: '苍蓝笺', desc: '静谧深青 · 专属', colors: { bg: '#DDEDEA', ink: '#2E4440', gold: '#9FC8C0' } },
    { id: 'yinxiang', name: '银厢笺', desc: '墨银浮雕 · 专属', colors: { bg: '#EDF0EE', ink: '#3A4240', gold: '#B9C4C0' } }
  ],
  themes: [
    { id: 'guiniao', name: '归鸟', desc: '归途晚照 · 专属', swatch: '#D9C3B2' },
    { id: 'xingxi', name: '星汐', desc: '夜海微光 · 专属', swatch: '#B8C4CF' }
  ]
};
