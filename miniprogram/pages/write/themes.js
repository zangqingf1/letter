// 官方信纸主题配置（PRD 5.7 / Theme 实体：信封、信纸、便签、分享图四件套 + 版本号）
// PRD 规划 6 套官方主题（晨光/雨夜/牛皮纸/棉麻/花笺/咖啡渍，副标题取自 PRD 5.7 主题表）；
// 【小王子】为当前唯一素材就绪的主题并作为默认，其余 pending: true —— 卡片仅展示色样占位、
// 点击提示"还在路上"，待视觉稿产出后按同一结构补充素材（TODO）。
// 已保存信件锁定创建时 theme_version（BR 主题版本规则）。
module.exports = [
  {
    id: 'xiaowangzi',
    name: '小王子',
    desc: '温柔童话',
    version: 1,
    envelope: '/assets/theme/xiaowangzi/envelope.jpg', // 信封图：保存后在首页信匣展示 + 第二步主题缩略图
    paper: '/assets/theme/xiaowangzi/paper.png',        // 信纸图：写信第二步预览与详情正文用
    desk: '#EDE9DC' // 预览区暖桌面底色，随主题更换
  },
  { id: 'chenyu', name: '晨光', desc: '温暖明亮', version: 0, pending: true, swatch: '#F3EADB' },
  { id: 'yuye', name: '雨夜', desc: '安静陪伴', version: 0, pending: true, swatch: '#C4CBD3' },
  { id: 'niupizhi', name: '牛皮纸', desc: '朴实有趣', version: 0, pending: true, swatch: '#D8C4A4' },
  { id: 'mianma', name: '棉麻', desc: '极简高级', version: 0, pending: true, swatch: '#E3DECF' },
  { id: 'huajian', name: '花笺', desc: '柔美治愈', version: 0, pending: true, swatch: '#E7CFCB' },
  { id: 'kafeizi', name: '咖啡渍', desc: '手账有趣', version: 0, pending: true, swatch: '#CBB693' }
];
