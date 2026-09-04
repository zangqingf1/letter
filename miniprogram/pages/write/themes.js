// 官方主题配置（PRD 5.7 / Theme 实体：信封、信纸配色、便签、分享图 + 版本号）
// 【方案B 改版】信纸不再使用纸张图片：信纸 = palette 底色 + 纯排版（宋体标题 +
// 手写体正文），主题差异体现为信纸底色；信封素材保留。因此主题不再依赖信纸素材，
// 原 pending 的 6 套主题全部开放：无信封素材的主题由 theme 服务回落默认信封（小王子）。
// palette.text/title/tag 为暖墨色系，各主题底色均为浅色，共用同一套墨色保证可读性。
// 已保存信件锁定创建时 theme_version（BR 主题版本规则）；信纸改为排版后小王子升至 v2。
module.exports = [
  {
    id: 'xiaowangzi',
    name: '小王子',
    desc: '温柔童话',
    version: 2,
    ownEnvelope: true, // 有自有信封素材（theme 服务归一化会重算该标记；默认主题卡片显示信封图）
    envelope: '/assets/theme/xiaowangzi/envelope.jpg', // 信封图：详情拆信 + 写信第二步预览（原图 1230px 高清，真机渲染稳定）
    envelopeThumb: '/assets/theme/xiaowangzi/envelope-thumb.jpg', // 网格/列表小图信封（首页信匣、回形针、废纸篓行，jpg 解码更省）
    palette: { base: '#F9F3E4', title: '#5A4F3E', text: '#4A4438', tag: '#9A9284' }, // 信纸底色 + 墨色
    desk: '#EDE9DC' // 预览区暖桌面底色，随主题更换
  },
  { id: 'chenyu', name: '晨光', desc: '温暖明亮', version: 1, swatch: '#F3EADB', palette: { base: '#F3EADB', title: '#5A4F3E', text: '#4A4438', tag: '#9A9284' }, desk: '#EFE6D3' },
  { id: 'yuye', name: '雨夜', desc: '安静陪伴', version: 1, swatch: '#C4CBD3', palette: { base: '#DDE2E6', title: '#4C5560', text: '#3E4750', tag: '#8A939C' }, desk: '#D4DADF' },
  { id: 'niupizhi', name: '牛皮纸', desc: '朴实有趣', version: 1, swatch: '#D8C4A4', palette: { base: '#E7D9BC', title: '#6B5636', text: '#57462C', tag: '#9C8B6C' }, desk: '#DCD0B2' },
  { id: 'mianma', name: '棉麻', desc: '极简高级', version: 1, swatch: '#E3DECF', palette: { base: '#EBE7DA', title: '#5C594C', text: '#4C4A40', tag: '#98948A' }, desk: '#E0DCCB' },
  { id: 'huajian', name: '花笺', desc: '柔美治愈', version: 1, swatch: '#E7CFCB', palette: { base: '#F1DFDB', title: '#6E514C', text: '#5C443F', tag: '#AB8B85' }, desk: '#E8D3CE' },
  { id: 'kafeizi', name: '咖啡渍', desc: '手账有趣', version: 1, swatch: '#CBB693', palette: { base: '#E4D8BE', title: '#66543A', text: '#52442C', tag: '#9D8F73' }, desk: '#D8CBB0' },

  // ── 会员专属主题（premium:true，后台 member_items kind='theme' 下发，与 admin seed 手工同步）──
  // 无信封素材，选择卡与会员页用 swatch 色样展示，信封回落默认（小王子）。
  { id: 'guiniao', name: '归鸟', desc: '归途晚照 · 专属', version: 1, premium: true, swatch: '#D9C3B2', palette: { base: '#E9DCCF', title: '#5A4634', text: '#4A3B2C', tag: '#9C8B78' }, desk: '#DFD2C4' },
  { id: 'xingxi', name: '星汐', desc: '夜海微光 · 专属', version: 1, premium: true, swatch: '#B8C4CF', palette: { base: '#C8D2DC', title: '#2E3A46', text: '#27323C', tag: '#74808C' }, desk: '#BDC9D4' }
];
