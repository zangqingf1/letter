// 官方主题配置（PRD 5.7 / Theme 实体：信封、桌面底色 + 版本号）
// 【方案B 改版】信纸不再使用纸张图片：信纸 = 固定纸色版式（papers.js colors），主题只绑定
// 信封素材与预览区桌面底色 desk。palette 保留给拆信动画的信纸底色与无信封款的色样展示。
// 官方主题仅「小王子」一套：它是唯一有自有信封素材的主题，也是未知 theme_id 的回落款
// （services/theme.js 的 normalizeThemes 以 LOCAL_THEMES[0] 为默认）。历史版本里另有 6 套
// 无素材主题（晨光/雨夜/牛皮纸/棉麻/花笺/咖啡渍），信封与配色全靠回落，已随本次收敛删除。
// 已保存信件锁定创建时 theme_version（BR 主题版本规则）；其 theme_id 失效后按默认款渲染。
module.exports = [
  {
    id: 'xiaowangzi',
    name: '小王子',
    desc: '温柔童话',
    version: 2,
    ownEnvelope: true, // 有自有信封素材（theme 服务归一化会重算该标记；默认主题卡片显示信封图）
    envelope: '/assets/theme/xiaowangzi/envelope.jpg', // 信封图：详情拆信 + 写信第二步预览（原图 1230px 高清，真机渲染稳定）
    envelopeThumb: '/assets/theme/xiaowangzi/envelope-thumb.jpg', // 网格/列表小图信封（首页信匣、回形针、废纸篓行，jpg 解码更省）
    palette: { base: '#F9F3E4', title: '#5A4F3E', text: '#4A4438', tag: '#9A9284' }, // 拆信动画信纸底色 + 墨色
    desk: '#EDE9DC' // 预览区暖桌面底色
  },

  // ── 会员专属主题（premium:true，后台 member_items kind='theme' 下发，与 admin seed 手工同步）──
  // 无信封素材，选择卡与会员页用 swatch 色样展示，信封回落默认（小王子）。
  { id: 'guiniao', name: '归鸟', desc: '归途晚照 · 专属', version: 1, premium: true, swatch: '#D9C3B2', palette: { base: '#E9DCCF', title: '#5A4634', text: '#4A3B2C', tag: '#9C8B78' }, desk: '#DFD2C4' },
  { id: 'xingxi', name: '星汐', desc: '夜海微光 · 专属', version: 1, premium: true, swatch: '#B8C4CF', palette: { base: '#C8D2DC', title: '#2E3A46', text: '#27323C', tag: '#74808C' }, desk: '#BDC9D4' }
];
