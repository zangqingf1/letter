// 信纸版式配置（信纸自持改版：版式 = 固定纸色 + 固定排版，不再取主题 palette；
// 主题只绑定信封与桌面底色，切主题不影响信纸画面）。
// colors 是每套版式配色的唯一事实来源：详情/写信预览的 WXSS 与分享页 Canvas
// （share.js 按 paper-specs.js 取色）都必须与本表数值一致，改色请只改这里并同步两处。
// 版本规则与主题相同：信件锁定创建时的 paper_version。旧四款（su/airmail/notebook/weave）
// 已移除，老信件未知 paper_id 由 paperOf 按 DEFAULT_PAPER_ID='liubai' 显式回落（留白志）。
// 航空笺为新 id airmail2（旧 airmail 老信件不自动迁移，维持回落留白志）。
module.exports = [
  {
    id: 'liubai', name: '留白志', desc: '编辑部极简 · 短线页脚', version: 1,
    colors: { bg: '#FEFEFC', ink: '#33302A', deep: '#1D1B17', gray: '#8A8478', faint: '#B3AC9C', fainter: '#A29B8A', line: '#ECE8DE', date: '#6E695E' }
  },
  {
    id: 'extra', name: '号外头版', desc: '报纸头版 · 首字下沉', version: 1,
    colors: { bg: '#F5EFDE', ink: '#262219', deep: '#1E1B14', sub: '#5A5240', accent: '#A33B24', faint: '#B9AE93' }
  },
  {
    id: 'blueprint', name: '工程蓝图', desc: '白线网格 · 标题栏落日期', version: 1,
    colors: { bg: '#16324F', line: '#EAF2F8', title: '#FFFFFF', body: '#EAF2F8', q: '#C9DCEA', accent: '#9CC4E4', grid: 'rgba(234,242,248,0.10)' }
  },
  {
    id: 'ticket', name: '存根票根', desc: '凭证票面 · 条码编号', version: 1,
    colors: { bg: '#F6EDDC', ink: '#2E2A26', deep: '#26221D', accent: '#C2452D', sub: '#8A6A5A', gray: '#6E675C', divider: '#C9BBA0' }
  },
  {
    id: 'poster', name: '大字标语', desc: '海报直给 · 描边水印方章', version: 1,
    colors: { bg: '#F0E9DA', ink: '#221E18', deep: '#17140F', red: '#B5342A', cream: '#F5EFE0', gray: '#6E6552', wm: 'rgba(150,132,96,0.30)' }
  },
  {
    id: 'bauhaus', name: '包豪斯几何', desc: '红圆蓝角黄块', version: 1,
    colors: { bg: '#FAF7EF', ink: '#17150F', red: '#D9402A', blue: '#1F4FA0', yellow: '#E8B33C', gray: '#5C584C' }
  },
  {
    id: 'vinyl', name: '黑胶唱片', desc: '暗纸盘芯 · 深夜重读', version: 1,
    colors: { bg: '#1B1A1C', text: '#D9D2C4', bright: '#F0E9D8', accent: '#C24A2E', gray: '#9C9484', dim: '#6E685C' }
  },
  {
    id: 'suwen', name: '素问笺', desc: '问答朱印对帖 · 斜盖邮戳', version: 1,
    colors: { bg: '#FAF7F0', ink: '#3B372F', deep: '#2E2B25', accent: '#A63B2A', line: '#D8D2C2', gray: '#6B6557' }
  },
  {
    id: 'moye', name: '墨夜笺', desc: '暗夜纸面 · 暖金细线', version: 1,
    colors: { bg: '#1D2027', bg1: '#2A2F3A', bg2: '#22262E', bg3: '#1D2027', text: '#DDD6C6', bright: '#F0E9D8', gold: '#C6A870', goldDim: 'rgba(198,168,112,0.45)', goldFaint: 'rgba(198,168,112,0.28)', gray: '#B4AD9D' }
  },
  {
    id: 'airmail2', name: '航空笺', desc: '全幅斜纹画框 · 邮票邮戳', version: 1,
    colors: { bg: '#FCFBF4', stripe1: '#C2452D', stripe2: '#F3EFE2', stripe3: '#33557E', ink: '#22303E', red: '#C2452D', blue: '#33557E', qGray: '#6B7B8A', aBlue: '#29405A', tan: '#A8A18C', dash: '#C9C2AC', stampPaper: '#F4F0E1', stampLine: '#CFC8B2' }
  },
  // ── 第五轮简约五款（提案五 NO.27–31，2026-09 落码）──
  {
    id: 'shupai', name: '竖排笺', desc: '从右往左 · 竖着写的信', version: 1,
    colors: { bg: '#FAF7F0', ink: '#3A362C', deep: '#2C2921', gray: '#847E6C', tan: '#8B8264', tanLine: '#C9C2AC', fill: '#6E6752', date: '#A29B85' }
  },
  {
    id: 'yixian', name: '一线笺', desc: '整张纸只有一根线', version: 1,
    colors: { bg: '#FFFFFF', ink: '#33312B', deep: '#26241E', gray: '#8A8471', faint: '#A9A28C', line: '#DCD8CB', ring: '#C4BEA9', sub: '#6E695C' }
  },
  {
    id: 'banxin', name: '版心笺', desc: '信是一页书 · 题记与页码', version: 1,
    colors: { bg: '#F9F5EA', ink: '#33302A', deep: '#26231D', gray: '#8A8471', faint: '#A39B85', line: '#C9C2AC', orn: '#B9AE8F', rhLine: 'rgba(163,155,133,0.5)' }
  },
  {
    id: 'juzhong', name: '居中笺', desc: '压在桌面正中的诗笺', version: 1,
    colors: { bg: '#F2EEE3', ink: '#35322A', deep: '#2B2822', gray: '#8A8471', faint: '#A29B85', gold: '#B9A36A', line: 'rgba(163,155,133,0.55)', brand: '#B3AB94' }
  },
  {
    id: 'caiqie', name: '裁切笺', desc: '一张还没裁开的印刷品', version: 1,
    colors: { bg: '#FCFCFA', ink: '#2F2F2B', deep: '#23231F', gray: '#7E7E72', faint: '#A9A99E', line: '#E3E3D9', mark: '#C6C6BC', sub: '#55554C' }
  },
  // ── 第六轮收藏世界六款（提案三 NO.16 + 提案四 NO.18/20/21/25/26，2026-09 落码）──
  {
    id: 'xingtu', name: '星图观测笺', desc: '深蓝夜空 · 观测记录', version: 1,
    colors: { bg: '#101A30', ink: '#E4E8F7', bright: '#F2F4FF', gray: '#9AA5C6', blue: '#8E9AC2', gold: '#D8B26A', goldSoft: 'rgba(216,178,106,0.75)', coord: 'rgba(148,165,220,0.55)', grid: 'rgba(148,165,220,0.07)', star: '#E8C98A', starLine: 'rgba(216,178,106,0.35)' }
  },
  {
    id: 'jiaopian', name: '胶片底片', desc: '35mm 胶片 · 一格画面', version: 1,
    colors: { bg: '#211E1A', ink: '#E9E4D8', bright: '#F4F0E4', gray: '#A89F8C', accent: '#D98C4A', footDim: 'rgba(233,228,216,0.45)', footLine: 'rgba(233,228,216,0.3)', frame: 'rgba(233,228,216,0.55)', perf: 'rgba(238,233,220,0.9)', mark: 'rgba(233,228,216,0.4)' }
  },
  {
    id: 'rili', name: '日历撕页', desc: '那一页永远不撕的日历', version: 1,
    colors: { bg: '#FBFAF4', ink: '#2E2C26', deep: '#23211C', red: '#B23B2E', cream: '#F7F1E2', creamDim: 'rgba(247,241,226,0.85)', gray: '#6E6A5C', faint: '#A29B86', tear: 'rgba(150,140,110,0.55)', line: 'rgba(150,140,110,0.45)' }
  },
  {
    id: 'chufang', name: '深夜处方笺', desc: '医师：三个月后的我', version: 1,
    colors: { bg: '#F4F7F0', ink: '#2F352E', deep: '#24352A', red: '#B23B2E', gray: '#8A9284', sub: '#565C52', fieldLine: 'rgba(47,53,46,0.45)', deepLine: 'rgba(36,53,42,0.5)', sealLine: 'rgba(178,59,46,0.75)', sealIn: 'rgba(178,59,46,0.85)', sealInner: 'rgba(178,59,46,0.5)' }
  },
  {
    id: 'zhongduan', name: '终端笺', desc: '琥珀磷屏 · 深夜运行', version: 1,
    colors: { bg: '#16110A', amber: '#E8A33D', bright: '#F5C169', aAmber: '#F0BE71', qDim: 'rgba(245,193,105,0.62)', barDim: 'rgba(232,163,61,0.65)', fileDim: 'rgba(232,163,61,0.7)', promptDim: 'rgba(232,163,61,0.6)', statusDim: 'rgba(232,163,61,0.75)', footDim: 'rgba(232,163,61,0.55)', line: 'rgba(232,163,61,0.3)', frame: 'rgba(232,163,61,0.4)' }
  },
  {
    id: 'zhengshu', name: '结业证书', desc: '兹证明这一课已修完', version: 1,
    colors: { bg: '#F8F3E4', ink: '#3A3428', ink2: '#4A4335', title: '#7A5F28', orn: '#9C7C3C', orgK: '#A2916A', capLine: 'rgba(156,124,60,0.45)', courseTxt: '#6E6552', red: '#B23B2E', redSeal: 'rgba(178,59,46,0.92)', redRing: 'rgba(178,59,46,0.8)', cream: '#F8F3E4', frame: '#9C7C3C', innerFrame: 'rgba(156,124,60,0.55)' }
  },

  // ── 会员专属版式（premium:true，后台 member_items kind='paper' 下发，与 admin seed 手工同步）──
  // 通用专属模板渲染（styles/paper.wxml pl-premium 分支 + paper-specs.js 的 premium 规格），
  // 只取 colors.bg/ink/gold 三色；后台改配色即生效，无需改代码。
  {
    id: 'gold', name: '鎏金笺', desc: '暖金细线 · 专属', version: 1, premium: true,
    colors: { bg: '#FAF4E6', ink: '#4A4033', gold: '#C6A870' }
  },
  {
    id: 'canglan', name: '苍蓝笺', desc: '静谧深青 · 专属', version: 1, premium: true,
    colors: { bg: '#DDEDEA', ink: '#2E4440', gold: '#9FC8C0' }
  },
  {
    id: 'yinxiang', name: '银厢笺', desc: '墨银浮雕 · 专属', version: 1, premium: true,
    colors: { bg: '#EDF0EE', ink: '#3A4240', gold: '#B9C4C0' }
  }
];
