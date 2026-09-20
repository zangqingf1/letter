// 官方主题配置（PRD 5.7 / Theme 实体：信封、桌面底色 + 版本号）
// 【方案B 改版】信纸不再使用纸张图片：信纸 = 固定纸色版式（papers.js colors），主题只绑定
// 信封素材与预览区桌面底色 desk。palette 只剩底色 base 一个键（拆信动画的信纸底色 +
// 无信封款的选择卡色样）；三档墨色 title/text/tag 已随信纸自持改版失去消费方，2026-09 删除。
// 官方主题十五套：小王子 + 印花 + 2026-09 新增六套（倒影里的秋/公路情书/天坛往事/山野来信/
// 璀璨如初/落日归海）+ 2026-09-20 新增七套（牛油果/玫瑰星云/蝶恋花笺/花间信笺/夏日航线/
// 岁月金笺/洇染情书），均有包内信封素材。璀璨如初（id 'cuican'）是默认/回落款：未知
// theme_id、缺失素材、非 VIP 专属款一律回落它（services/theme.js 按 DEFAULT_THEME_ID
// 显式解析，与列表顺序无关，列表顺序只是选择卡的陈列次序）。
// （2026-09-20 前默认款是小王子，本列表第一项；老信件数据不受影响 —— 都按各自 theme_id 渲染。）
// 历史版本里另有 6 套无素材主题（晨光/雨夜/牛皮纸/棉麻/花笺/咖啡渍），信封与配色全靠
// 回落，已随「信纸自持」改版收敛删除。
// 「印花」（theme_id 'yinhua'，2026-09 上线）素材原存云存储（cloud:// fileID），2026-09 起
// 已搬进包内与小王子同构 —— 云端 themes 集合的 assets 同步改存包内路径（后台「主题管理」
// 或 admin themeSave），云存储里的旧图即可删除。本地演示模式也能看到它。
// 新六套自上线起即为包内素材（原图在 picture/新主题/，缩略图 240 宽 q=76，口径同印花）。
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
    palette: { base: '#F9F3E4' }, // 拆信动画信纸底色（墨色由版式 papers.js 自持，不在主题里）
    desk: '#EDE9DC' // 预览区暖桌面底色
  },
  {
    id: 'yinhua',
    name: '印花',
    desc: '纸间花草',
    version: 1,
    ownEnvelope: true,
    envelope: '/assets/theme/yinhua/envelope.jpg', // 890×616
    envelopeThumb: '/assets/theme/yinhua/envelope-thumb.jpg', // 240×166
    palette: { base: '#F0ECE2' }, // 拆信动画信纸底色
    desk: '#E4E6DA' // 偏鼠尾草绿的桌面底色，与小王子的暖桌面区分
  },
  // 2026-09 新增六套（picture/新主题/）：信封照片铺满画面，palette.base/desk 为人工
  // 选定的浅纸色/桌面色（与画面协调即可，不做采样 —— 照片边缘没有纯纸色可采）。
  {
    id: 'daoying', name: '倒影里的秋', desc: '湖畔秋信', version: 1, ownEnvelope: true,
    envelope: '/assets/theme/daoying/envelope.jpg', // 735×522
    envelopeThumb: '/assets/theme/daoying/envelope-thumb.jpg',
    palette: { base: '#F4EFE2' }, desk: '#E8E4D3' // 暖羊皮纸桌面
  },
  {
    id: 'gonglu', name: '公路情书', desc: '麦浪旅人', version: 1, ownEnvelope: true,
    envelope: '/assets/theme/gonglu/envelope.jpg', // 900×581
    envelopeThumb: '/assets/theme/gonglu/envelope-thumb.jpg',
    palette: { base: '#F3EDDA' }, desk: '#EAE4CE' // 麦田暖黄桌面
  },
  {
    id: 'tiantan', name: '天坛往事', desc: '红墙飞鸟', version: 1, ownEnvelope: true,
    envelope: '/assets/theme/tiantan/envelope.jpg', // 987×645
    envelopeThumb: '/assets/theme/tiantan/envelope-thumb.jpg',
    palette: { base: '#F2EFE6' }, desk: '#E6E2D6' // 灰墙纸桌面
  },
  {
    id: 'shanye', name: '山野来信', desc: '山湖秘境', version: 1, ownEnvelope: true,
    envelope: '/assets/theme/shanye/envelope.jpg', // 955×627
    envelopeThumb: '/assets/theme/shanye/envelope-thumb.jpg',
    palette: { base: '#F3EFDC' }, desk: '#E5E6CC' // 草甸绿桌面
  },
  {
    id: 'cuican', name: '璀璨如初', desc: '烟火如诗', version: 1, ownEnvelope: true,
    envelope: '/assets/theme/cuican/envelope.jpg', // 1024×673
    envelopeThumb: '/assets/theme/cuican/envelope-thumb.jpg',
    palette: { base: '#F6F3EA' }, desk: '#ECE8DE' // 象牙白桌面
  },
  {
    id: 'luori', name: '落日归海', desc: '晚霞入海', version: 1, ownEnvelope: true,
    envelope: '/assets/theme/luori/envelope.jpg', // 855×568
    envelopeThumb: '/assets/theme/luori/envelope-thumb.jpg',
    palette: { base: '#F5EBD9' }, desk: '#F0DFC6' // 落日橙桌面
  },
  // 2026-09-20 新增七套（picture/新主题2/）：同上批口径，信封照片居中裁到 890×616
  //（主图 ≤60KB 二分找最高 quality，缩略 240 宽 ≤10KB）。
  {
    id: 'niuyouguo', name: '牛油果', desc: '一颗温柔的绿', version: 1, ownEnvelope: true,
    envelope: '/assets/theme/niuyouguo/envelope.jpg', // 890×616
    envelopeThumb: '/assets/theme/niuyouguo/envelope-thumb.jpg',
    palette: { base: '#F4F4E7' }, desk: '#EAECD6' // 青绿桌面
  },
  {
    id: 'meiguixingyun', name: '玫瑰星云', desc: '星尘与玫瑰', version: 1, ownEnvelope: true,
    envelope: '/assets/theme/meiguixingyun/envelope.jpg', // 890×616
    envelopeThumb: '/assets/theme/meiguixingyun/envelope-thumb.jpg',
    palette: { base: '#F7EFE9' }, desk: '#EEE3DE' // 干枯玫瑰桌面
  },
  {
    id: 'dielianhuajian', name: '蝶恋花笺', desc: '蝶影过花间', version: 1, ownEnvelope: true,
    envelope: '/assets/theme/dielianhuajian/envelope.jpg', // 890×616
    envelopeThumb: '/assets/theme/dielianhuajian/envelope-thumb.jpg',
    palette: { base: '#F6F6EF' }, desk: '#ECEDE0' // 绿条纹纸桌面
  },
  {
    id: 'huajianxinjian', name: '花间信笺', desc: '鎏金花影', version: 1, ownEnvelope: true,
    envelope: '/assets/theme/huajianxinjian/envelope.jpg', // 890×616
    envelopeThumb: '/assets/theme/huajianxinjian/envelope-thumb.jpg',
    palette: { base: '#F7F1E5' }, desk: '#F0E6D8' // 粉花鎏金桌面
  },
  {
    id: 'xiarihangxian', name: '夏日航线', desc: '盛夏航空信', version: 1, ownEnvelope: true,
    envelope: '/assets/theme/xiarihangxian/envelope.jpg', // 890×616
    envelopeThumb: '/assets/theme/xiarihangxian/envelope-thumb.jpg',
    palette: { base: '#F5EADA' }, desk: '#E9DCC8' // 牛皮纸桌面
  },
  {
    id: 'suiyuejinjian', name: '岁月金笺', desc: '鎏金素笺', version: 1, ownEnvelope: true,
    envelope: '/assets/theme/suiyuejinjian/envelope.jpg', // 890×616
    envelopeThumb: '/assets/theme/suiyuejinjian/envelope-thumb.jpg',
    palette: { base: '#F5F1E3' }, desk: '#ECE5D3' // 香槟金桌面
  },
  {
    id: 'yinranqingshu', name: '洇染情书', desc: '水彩洇开的信', version: 1, ownEnvelope: true,
    envelope: '/assets/theme/yinranqingshu/envelope.jpg', // 890×616
    envelopeThumb: '/assets/theme/yinranqingshu/envelope-thumb.jpg',
    palette: { base: '#F0F2F1' }, desk: '#E3E8EA' // 水彩冷调桌面
  }
  // 会员专属主题不再随包内置：后台 member_items（kind='theme'）上架什么就下发什么
  // （theme 云函数并入列表、premium:true 标记），本地回落列表只有官方主题。
];
