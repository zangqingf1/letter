// 会员专属 · 信纸版式与主题展示配置（本地回落数据）
// 专属内容已与后台绑定（member_items 集合）：theme 服务下发专属款（premium 标记）后，
// 会员页与写信页都以后台数据为准，本文件仅在云端列表为空/失败/本地模式时兜底展示。
// 与 admin 云函数 SEED_MEMBER_ITEMS 同源手工同步（改色请两处一起改）。
module.exports = {
  papers: [
    { id: 'gold', name: '鎏金笺', desc: '暖金细线 · 专属', colors: { bg: '#FAF4E6', ink: '#4A4033', gold: '#C6A870' } },
    { id: 'canglan', name: '苍蓝笺', desc: '静谧深青 · 专属', colors: { bg: '#DDEDEA', ink: '#2E4440', gold: '#9FC8C0' } },
    { id: 'yinxiang', name: '银厢笺', desc: '墨银浮雕 · 专属', colors: { bg: '#EDF0EE', ink: '#3A4240', gold: '#B9C4C0' } }
  ],
  // 专属主题不再内置兜底款（归鸟/星汐已删）：云端 member_items 上架了专属主题就由
  // pickPremium 从 theme 列表挑出，没上架时会员页此栏为空。保留空数组键，member.js 首帧绑定不空指针。
  themes: []
};
