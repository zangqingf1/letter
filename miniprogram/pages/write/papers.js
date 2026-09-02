// 信纸版式配置（信纸自持改版：版式 = 固定纸色 + 固定排版，不再取主题 palette；
// 主题只绑定信封与桌面底色，切主题不影响信纸画面）。
// colors 是每套版式配色的唯一事实来源：详情/写信预览的 WXSS 与分享页 Canvas
// （share.js drawXxxStyle）都必须与本表数值一致，改色请只改这里并同步两处。
// 版本规则与主题相同：信件锁定创建时的 paper_version。旧四款（su/airmail/notebook/weave）
// 已移除，老信件未知 paper_id 由 paperOf 回落本列表第一套（留白志）。
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
  }
];
