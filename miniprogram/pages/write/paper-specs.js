// 分享图版面规格 —— styles/paper.wxss 的机器可读镜像（导出侧唯一数值来源）
//
// 为什么单独一个文件：分享图的 Canvas 绘制原本在 share.js 里自带一套版面常量，
// 与 paper.wxss 长期漂移 —— 会员专属版式（gold/canglan/yinxiang）甚至因为
// PAPER_SPECS 里只写了字面量键 'premium' 而整篇按「号外头版」的参数排版。
// 现在把 paper.wxss 的数值原样抄到本表，share.js 只消费它；
// scripts/preflight.js 的第 12 项静态检查会解析 paper.wxss 与本表逐项比对，
// 任何一侧改了数值而另一侧没跟上都会 FAIL。
//
// 约定：
//   1. 数值单位一律 rpx（与 WXSS 同口径），导出时由 share.js 按 K = 1080/630 换算；
//   2. pad/border 直接抄 .pl-xxx 的 padding 与 border（.pl-paper 是 border-box，
//      内容宽 = 630 − border×2 − padding×2）；border 只有蓝图有（2rpx）；
//   3. lh 缺省时取 LH_NORMAL[face] —— WXSS 没写 line-height 的都是单行装饰块，
//      用各字体族的上升部+下降部近似 CSS 的 normal（误差 ≤ 3rpx）；
//   4. flow 是 CSS 文档流的镜像：顺序、margin、padding 与 paper.wxml 的
//      子元素一一对应；position:absolute 的出血装饰不在此列（见各款 abs）。

// 字体度量（em 为单位）。WXSS 用的是系统字体栈，Canvas 侧要有同一套数字才能把
// 文字落在与预览相同的位置：CSS 的行盒 = 半行距 + 字体上升部 + 下降部，
// 其中半行距 = (行盒高 − (上升部+下降部) × 字号) / 2，基线 = 行盒顶 + 半行距 + 上升部×字号。
// asc + desc 即 CSS line-height: normal 的高度（WXSS 未写 line-height 时用它兜底）。
const METRICS = {
  song: { asc: 1.16, desc: 0.32 }, // 思源宋 / 宋体
  hei: { asc: 1.06, desc: 0.34 }, // 苹方 / 系统黑体
  kai: { asc: 0.88, desc: 0.42 }, // 楷体
  mono: { asc: 0.83, desc: 0.33 } // Courier New / Consolas
};

// 字体族别名（share.js 映射成 Canvas 的 font-family 串，与 paper.wxss --plf-* 对应）
const SONG = 'song';
const KAI = 'kai';
const HEI = 'hei';
const MONO = 'mono';

// 配色取值走 papers.js 的 colors（键名）或 WXSS 里的字面色（'#xxx' / 'rgba(...)'）。
// 字面色只在这些色没进 papers.js 时使用：册根序列号、海报 kicker、蓝图半透明线、
// 黑胶盘面、素问邮戳等。resolveColor 是纯函数，便于离线测试。

// ── 会员专属通用金线笺（.pl-premium）──
// 后台加的专属版式（member_items kind='paper'）全部走这一套：gold/canglan/yinxiang
// 以及将来新增的任意 id，只靠 paper.premium 标记命中，不再依赖具体 id。
const PREMIUM = {
  css: '.pl-premium',
  pad: [60, 56, 48, 56],
  flow: [
    { k: 'line', h: 4, color: 'gold', mb: 34 }, // .plpm-rule
    { k: 'text', f: 'name', size: 44, face: SONG, weight: '900 ', lh: 1.5, ls: 4, align: 'center', color: 'ink' },
    { k: 'line', h: 2, w: 96, align: 'center', color: 'gold', mt: 26, mb: 40 }, // .plpm-rule2
    { k: 'text', text: '问', size: 22, face: HEI, weight: '700 ', ls: 4, color: 'gold', mb: 14 }, // .plpm-cap
    { k: 'text', f: 'question', size: 28, face: KAI, lh: 2.0, color: 'ink', mb: 40 }, // .plpm-q
    { k: 'text', text: '答', size: 22, face: HEI, weight: '700 ', ls: 4, color: 'gold', mb: 14 },
    { k: 'text', f: 'answer', size: 28, face: KAI, lh: 2.0, color: 'ink', mb: 16 }, // .plpm-a
    {
      k: 'lr',
      pt: 28,
      border: { h: 2, color: 'gold' }, // .plpm-foot
      left: { text: '心灵信箱 · 会员专属', size: 20, face: HEI, ls: 3, color: 'gold' },
      right: { text: '写于 {{dateLong}}', size: 20, face: HEI, ls: 2, color: 'ink' }
    }
  ]
};

const SPECS = {
  // ── 留白志 liubai（.pl-liubai；列表首项，未知 id 的回落款）──
  liubai: {
    css: '.pl-liubai',
    pad: [52, 48, 44, 48],
    flow: [
      { k: 'text', f: 'name', size: 36, face: SONG, weight: '600 ', lh: 1.5, ls: 4, color: 'deep' },
      { k: 'line', h: 4, w: 40, color: 'deep', mt: 24, mb: 40 }, // .pll-name-rule
      // .pll-cap：16rpx + gap 12 + 延伸细线（::after）
      { k: 'text', text: '问', size: 16, face: HEI, ls: 8, color: 'faint', mb: 14, rule: { h: 2, color: 'line', gap: 12 } },
      { k: 'text', f: 'question', size: 28, face: HEI, lh: 2.1, color: 'gray', mb: 36 }, // .pll-qt
      { k: 'text', text: '答', size: 16, face: HEI, ls: 8, color: 'faint', mb: 14, rule: { h: 2, color: 'line', gap: 12 } },
      { k: 'text', f: 'answer', size: 28, face: HEI, lh: 2.1, color: 'ink' },
      {
        k: 'lr',
        mt: 48,
        pt: 16,
        border: { h: 2, color: 'line' }, // .pll-footer
        left: { text: '心灵信箱', size: 18, face: HEI, ls: 2, color: 'fainter' },
        right: { text: '写于 {{dateLong}}', size: 18, face: HEI, ls: 2, color: 'date' }
      }
    ]
  },

  // ── 号外头版 extra（.pl-extra；报纸头版 + 首字下沉）──
  extra: {
    css: '.pl-extra',
    pad: [50, 44, 36, 44],
    flow: [
      { k: 'line', h: 6, color: 'ink' }, // .plx-rule-h
      { k: 'line', h: 2, color: 'ink', mt: 4 }, // .plx-rule-t
      {
        // .plx-mast：padding 14 0 10，居中，号外为 vertical-align: 18rpx 的上标
        k: 'text',
        text: '心灵信箱',
        size: 46,
        face: SONG,
        weight: '900 ',
        ls: 14,
        indent: 14, // text-indent: 14rpx（补偿字距末位留白）
        align: 'center',
        color: 'deep',
        pt: 14,
        pb: 10,
        sup: { text: '号外', size: 22, face: HEI, weight: '700 ', ls: 6, color: 'accent', va: 18, gap: 10 }
      },
      {
        // .plx-dateline：padding 10 2 12，两端对齐
        k: 'lr',
        px: 2,
        pt: 10,
        pb: 12,
        left: { text: '私人信件 · 仅供本人重读', size: 19, face: HEI, ls: 2, color: 'sub' },
        right: { text: '写于 {{dateLong}}', size: 19, face: HEI, ls: 2, color: 'sub' }
      },
      { k: 'line', h: 6, color: 'ink' },
      { k: 'line', h: 2, color: 'ink', mt: 4 },
      { k: 'text', f: 'name', size: 40, face: SONG, weight: '900 ', lh: 1.5, ls: 2, color: 'deep', mt: 34 },
      {
        // .plx-q::before content:"■ "（20rpx 红方）
        k: 'text',
        f: 'question',
        size: 26,
        face: HEI,
        weight: '700 ',
        lh: 1.9,
        color: 'sub',
        mt: 22,
        prefix: { text: '■ ', size: 20, color: 'accent' }
      },
      {
        // .plx-answer：margin-top 26 + border-top 2 + padding-top 26，两端对齐 + 首字下沉
        k: 'text',
        f: 'answer',
        size: 28,
        face: SONG,
        lh: 2.0,
        color: 'ink',
        mt: 26,
        pt: 26,
        border: { h: 2, color: 'faint' },
        justify: true,
        drop: { size: 72, face: SONG, weight: '900 ', lh: 1, pt: 6, pr: 12, color: 'accent' }
      },
      {
        // .plx-end：margin 28 0 24，居中，两侧「—」（margin 0 12rpx）
        k: 'text',
        text: '答 毕',
        size: 20,
        face: SONG,
        ls: 10,
        align: 'center',
        color: 'accent',
        mt: 28,
        mb: 24,
        dash: { text: '—', size: 20, face: SONG, color: 'faint', gap: 12 }
      },
      { k: 'line', h: 6, color: 'ink' }
    ]
  },

  // ── 工程蓝图 blueprint（.pl-bp；网格 + 裁切角标 + 线框问答 + 标题栏）──
  blueprint: {
    css: '.pl-bp',
    pad: [36, 44, 44, 44],
    border: [2, 2, 2, 2], // border: 2rpx solid rgba(234,242,248,0.75)
    flow: [
      {
        k: 'lr',
        mb: 30, // .plb-eyebrow
        left: { text: 'MENTAL MAILBOX', size: 18, face: MONO, ls: 4, color: '#EAF2F8A6' },
        right: { text: 'DWG. {{dwgNo}}', size: 18, face: MONO, ls: 4, color: '#EAF2F8A6' }
      },
      { k: 'text', f: 'name', size: 40, face: HEI, weight: '700 ', lh: 1.4, ls: 4, color: 'title' },
      { k: 'line', h: 3, w: 88, color: 'line', mt: 22, mb: 36 }, // .plb-underline
      {
        // .plb-box（padding 26 26 24 + border 2 + 悬浮标签 .plb-lbl）
        k: 'text',
        f: 'question',
        size: 26,
        face: HEI,
        lh: 1.9,
        color: 'q',
        box: { pt: 26, pb: 24, px: 26, border: { h: 2, color: '#EAF2F8CC' } },
        label: { text: '问 / Q', size: 18, face: HEI, ls: 4, color: 'accent', px: 10, top: -14, left: 18 }
      },
      {
        k: 'text',
        f: 'answer',
        size: 28,
        face: HEI,
        lh: 2.0,
        color: 'body',
        mt: 42, // .plb-a
        box: { pt: 26, pb: 24, px: 26, border: { h: 2, color: '#EAF2F8CC' } },
        label: { text: '答 / A', size: 18, face: HEI, ls: 4, color: 'accent', px: 10, top: -14, left: 18 }
      },
      {
        // .plb-tblock：margin-top 48、margin-left auto、width 360、border 2
        k: 'tblock',
        mt: 48,
        w: 360,
        border: 2,
        rowBorder: 1,
        keyW: 160, // .plb-tk width（content-box，加 padding 16×2 与 border-right 1）
        padX: 16,
        padY: 12,
        key: { size: 18, face: HEI, ls: 4, color: 'accent' },
        val: { size: 18, face: MONO, ls: 2, color: 'line' },
        rows: [
          ['封存日期', '{{dotDate}}'],
          ['比例', '1 : 1 原文'],
          ['状态', '已封存']
        ]
      }
    ],
    abs: 'blueprint'
  },

  // ── 存根票根 ticket（.pl-tk；右侧存根 + 条码编号）──
  ticket: {
    css: '.pl-tk',
    pad: [44, 160, 44, 48],
    flow: [
      { k: 'text', text: '心灵信箱 · 重读券', size: 18, face: HEI, ls: 6, color: 'accent' },
      { k: 'text', text: '{{serial}}', size: 20, face: MONO, ls: 2, color: '#8A8070', mt: 14 }, // .plt-serial
      { k: 'text', f: 'name', size: 36, face: HEI, weight: '700 ', lh: 1.55, ls: 2, color: 'deep', mt: 18 },
      { k: 'text', text: '问', size: 18, face: HEI, weight: '700 ', ls: 6, color: 'accent', mt: 30 }, // .plt-cap
      { k: 'text', f: 'question', size: 26, face: HEI, lh: 1.95, color: 'gray', mt: 10 },
      { k: 'line', h: 2, color: 'divider', mt: 30, dash: [8, 6] }, // .plt-hr
      { k: 'text', text: '答', size: 18, face: HEI, weight: '700 ', ls: 6, color: 'accent', mt: 30 },
      { k: 'text', f: 'answer', size: 27, face: HEI, lh: 2.0, color: 'ink', mt: 26 },
      {
        // .plt-barcode：repeating-linear-gradient 条宽 3/6/5/3/2/7/3/4（周期 33rpx）
        k: 'barcode',
        mt: 44,
        h: 48,
        maxW: 320,
        color: 'ink',
        segs: [3, 6, 5, 3, 2, 7, 3, 4]
      },
      // 编号行的年份取信件的「写于」年份（paper.wxml 用 {{v.yearText}}）；
      // 曾经两边都写死 2026，跨年就会显旧 —— preflight 第 11 项已静态守住这条
      { k: 'text', text: '{{yearText}} MENTAL MAILBOX', size: 18, face: MONO, ls: 4, color: 'ink', mt: 10 },
      { k: 'text', text: '写于 {{dateLong}} · 已封存', size: 19, face: HEI, ls: 2, color: 'sub', mt: 14 }
    ],
    abs: 'ticket'
  },

  // ── 大字标语 poster（.pl-po；描边水印 + 斜贴标语条 + 方章）──
  poster: {
    css: '.pl-po',
    pad: [48, 48, 44, 48],
    flow: [
      { k: 'text', text: '写给未来的一封信', size: 19, face: HEI, ls: 8, color: '#96784D' }, // .plp-kicker
      { k: 'text', f: 'name', size: 44, face: HEI, weight: '900 ', lh: 1.45, ls: 2, color: 'deep', mt: 20, frac: 0.88 },
      {
        // .plp-banner：inline-block，padding 12 20，rotate(-1.5deg)
        k: 'banner',
        text: '答案已封存 · {{dotDate}}',
        size: 20,
        face: HEI,
        ls: 4,
        color: 'cream',
        bg: 'red',
        padX: 20,
        padY: 12,
        rotate: -1.5,
        mt: 28
      },
      { k: 'text', text: '问', size: 19, face: HEI, weight: '700 ', ls: 6, color: 'red', mt: 38 }, // .plp-cap
      { k: 'text', f: 'question', size: 26, face: HEI, lh: 2.0, color: 'gray', mt: 12 },
      { k: 'text', text: '答', size: 19, face: HEI, weight: '700 ', ls: 6, color: 'red', mt: 38 },
      { k: 'text', f: 'answer', size: 27, face: HEI, weight: '500 ', lh: 2.0, color: 'ink', mt: 12 },
      {
        // .plp-sealzone：margin-top 46，右对齐；日期 + 旋转 4° 红方章
        k: 'sealzone',
        mt: 46,
        date: { text: '写于 {{dotDate}}', size: 19, face: HEI, ls: 3, color: 'gray', gap: 20 },
        seal: { box: 92, bg: 'red', text: '心灵信箱', fontSize: 28, face: KAI, color: 'cream', rotate: 4, ring: [4, 6] }
      }
    ],
    abs: 'poster'
  },

  // ── 包豪斯几何 bauhaus（.pl-bh；出血几何群 + 色块标注）──
  bauhaus: {
    css: '.pl-bh',
    pad: [44, 48, 44, 48],
    flow: [
      { k: 'text', f: 'name', size: 40, face: HEI, weight: '900 ', lh: 1.5, ls: 2, color: 'ink', pt: 10, frac: 0.7 },
      { k: 'line', h: 5, color: 'ink', mt: 34 }, // .plh-hr
      {
        // .plh-row：chip 36×36（margin-right 18 / margin-top 4）+ 正文
        k: 'row',
        mt: 34,
        lead: { w: 36, h: 36, mt: 4, gap: 18, color: 'red', text: '问', size: 19, face: HEI, weight: '700 ', textColor: '#FAF7EF' },
        body: { f: 'question', size: 26, face: HEI, lh: 1.95, color: 'gray' }
      },
      {
        k: 'row',
        mt: 34,
        lead: { w: 36, h: 36, mt: 4, gap: 18, color: 'blue', text: '答', size: 19, face: HEI, weight: '700 ', textColor: '#FAF7EF' },
        body: { f: 'answer', size: 27, face: HEI, lh: 2.0, color: 'ink' }
      },
      {
        // .plh-dateblock：margin-top 48，padding 12 22，border 3，box-shadow 7rpx 7rpx 0
        k: 'dateblock',
        text: '写于 {{dateLong}}',
        size: 20,
        face: HEI,
        weight: '700 ',
        ls: 3,
        color: 'ink',
        bg: 'yellow',
        padX: 22,
        padY: 12,
        border: 3,
        shadow: 7,
        mt: 48
      }
    ],
    // 右上出血几何群（position:absolute，按 CSS 的 top/right 换算）
    abs: 'bauhaus'
  },

  // ── 黑胶唱片 vinyl（.pl-vinyl；暗纸 + 同心圆盘芯）──
  vinyl: {
    css: '.pl-vinyl',
    pad: [48, 48, 44, 48],
    flow: [
      { k: 'text', text: 'A1 · {{serialNo}}', size: 18, face: MONO, ls: 5, color: 'accent' }, // .plv-track
      { k: 'text', f: 'name', size: 38, face: KAI, lh: 1.6, ls: 2, color: 'bright', mt: 18, frac: 0.62 },
      // .plv-cap：18rpx + gap 12 + 延伸细线（::after，1rpx）
      { k: 'text', text: '问', size: 18, face: HEI, ls: 6, color: 'accent', mt: 40, rule: { h: 1, color: 'rgba(194,74,46,0.35)', gap: 12 } },
      { k: 'text', f: 'question', size: 26, face: HEI, lh: 2.0, color: 'gray', mt: 12 },
      { k: 'text', text: '答', size: 18, face: HEI, ls: 6, color: 'accent', mt: 40, rule: { h: 1, color: 'rgba(194,74,46,0.35)', gap: 12 } },
      { k: 'text', f: 'answer', size: 27, face: HEI, lh: 2.0, color: 'text', mt: 12 },
      {
        k: 'lr',
        mt: 48, // .plv-foot
        left: { text: 'SIDE A · MENTAL MAILBOX', size: 16, face: MONO, ls: 4, color: 'dim' },
        right: { text: '录于 {{dateLong}}', size: 19, face: HEI, ls: 2, color: 'accent' }
      }
    ],
    abs: 'vinyl'
  },

  // ── 素问笺 suwen（.pl-suwen；问/答朱印对帖 + 右上斜盖邮戳）──
  suwen: {
    css: '.pl-suwen',
    pad: [52, 48, 44, 48],
    flow: [
      { k: 'text', f: 'name', size: 32, face: KAI, lh: 1.6, ls: 4, color: 'deep', insetR: 84 }, // .pls-name 避让邮戳
      { k: 'line', h: 2, color: 'line', mt: 20, mb: 28 }, // .pls-rule
      {
        // .pls-row：方章 24×24（gap 16 / margin-top 4）+ 楷体正文；margin-bottom 28
        k: 'row',
        mb: 28,
        lead: { w: 24, h: 24, mt: 4, gap: 16, border: 2, radius: 4, style: 'outline', color: 'accent', text: '问', size: 16, face: SONG, textColor: 'accent' },
        body: { f: 'question', size: 28, face: KAI, lh: 2.0, color: 'gray' }
      },
      {
        k: 'row',
        mb: 28,
        lead: { w: 24, h: 24, mt: 4, gap: 16, radius: 4, style: 'fill', color: 'accent', text: '答', size: 16, face: SONG, textColor: 'bg' },
        body: { f: 'answer', size: 28, face: KAI, lh: 2.0, color: 'ink' }
      }
    ],
    abs: 'suwen'
  },

  // ── 墨夜笺 moye（.pl-moye；径向渐变暗夜底 + 金线报头 + 居中落款）──
  moye: {
    css: '.pl-moye',
    pad: [52, 48, 44, 48],
    flow: [
      {
        // .plm-toprule：双金线夹「心灵信箱」（gap 12，margin-bottom 28）
        k: 'text',
        text: '心灵信箱',
        size: 14,
        face: HEI,
        ls: 6,
        indent: 6,
        align: 'center',
        color: 'gold',
        mb: 28,
        rule: { h: 2, color: 'goldDim', gap: 12, both: true }
      },
      { k: 'text', f: 'name', size: 34, face: KAI, lh: 1.6, ls: 4, align: 'center', color: 'bright' },
      // .plm-cap：16rpx + gap 12 + 金延伸线（::after，2rpx）
      { k: 'text', text: '问', size: 16, face: HEI, ls: 6, color: 'gold', mt: 36, mb: 12, rule: { h: 2, color: 'goldFaint', gap: 12 } },
      { k: 'text', f: 'question', size: 28, face: KAI, lh: 2.1, color: 'gray' },
      { k: 'text', text: '答', size: 16, face: HEI, ls: 6, color: 'gold', mt: 34, mb: 12, rule: { h: 2, color: 'goldFaint', gap: 12 } },
      { k: 'text', f: 'answer', size: 28, face: KAI, lh: 2.1, color: 'text' },
      { k: 'text', text: '— 写于 {{dateLong}} —', size: 18, face: HEI, ls: 4, align: 'center', color: 'gold', mt: 44 }
    ]
  },

  // ── 航空笺 airmail2（.pl-airmail；全幅斜纹画框 + 签条 + 邮票）──
  airmail2: {
    css: '.pl-airmail',
    pad: [12, 12, 12, 12], // .pl-airmail 外框
    sheet: [36, 36, 34, 36], // .pla-sheet 内纸面
    sheetCss: '.pla-sheet',
    flow: [
      {
        // .pla-head：PAR AVION 签条（左）+ 邮票 70×82（右，右对齐）；行高取邮票 82
        k: 'head',
        h: 82,
        avion: {
          label: 'PAR AVION',
          labelSize: 16,
          labelFace: SONG,
          labelLs: 4,
          cn: '航空邮件',
          cnSize: 14,
          cnLs: 6,
          cnIndent: 6,
          lh: 1.5,
          border: 2,
          padX: 14,
          padY: 8,
          color: 'blue'
        },
        stamp: {
          w: 70,
          h: 82,
          pad: 8,
          border: 2,
          borderColor: 'stampLine',
          paper: 'stampPaper',
          frame: 3,
          hatch: 'rgba(51,85,126,0.10)',
          date: '{{stampText}}',
          dateSize: 24,
          dateFace: SONG,
          year: '{{yearText}}',
          yearSize: 12,
          yearLs: 4,
          color: 'blue'
        }
      },
      { k: 'text', text: 'BY MENTAL MAILBOX · 寄给未来', size: 14, face: HEI, ls: 4, align: 'right', color: 'tan', mt: 12 }, // .pla-route
      { k: 'text', f: 'name', size: 34, face: SONG, weight: '700 ', lh: 1.5, ls: 4, color: 'ink', mt: 28 },
      { k: 'text', text: '问', size: 16, face: HEI, weight: '700 ', ls: 6, color: 'red', mt: 28, mb: 8 }, // .pla-cap
      { k: 'text', f: 'question', size: 28, face: HEI, lh: 2.0, color: 'qGray' },
      { k: 'line', h: 2, color: 'dash', mt: 22, mb: 22, dash: [6, 5] }, // .pla-hr-dash
      { k: 'text', text: '答', size: 16, face: HEI, weight: '700 ', ls: 6, color: 'red', mt: 28, mb: 8 },
      { k: 'text', f: 'answer', size: 28, face: HEI, lh: 2.0, color: 'aBlue' },
      {
        k: 'lr',
        mt: 32, // .pla-foot
        left: { text: 'VIA AIR MAIL', size: 14, face: SONG, ls: 4, color: 'tan' },
        right: { text: '写于 {{dateLong}}', size: 18, face: HEI, ls: 4, color: 'blue' }
      }
    ],
    abs: 'airmail2'
  },

  // ── 会员专属：鎏金笺 / 苍蓝笺 / 银厢笺（后台 member_items 下发）──
  // premium 这个键是「任意专属版式」的通用入口：后台新增的专属款 id 不在本表里，
  // 但只要带 premium 标记就命中它 —— 旧版正是缺了这一步，三款专属笺整篇按号外头版排版。
  premium: PREMIUM,
  gold: PREMIUM,
  canglan: PREMIUM,
  yinxiang: PREMIUM
};

// paper.wxml 的 wx:else 兜底是 vinyl（黑胶唱片）；Canvas 侧必须同口径，
// 否则未知 paper_id 会出现「预览黑胶、导出号外」的整款错位。
const FALLBACK = SPECS.vinyl;

// 取某款版式的规格：先按 id，再按 premium 标记（后台新增的专属款无需改代码），
// 最后回落 vinyl —— 与 paper.wxml 的分支顺序完全一致。
function specOf(paper) {
  if (!paper) return FALLBACK;
  return SPECS[paper.id] || (paper.premium ? SPECS.premium : FALLBACK);
}

// 配色：先在 papers.js 的 colors 里按键名找，找不到再当字面色用。
// 另外支持 '#RRGGBBAA' 八位写法（蓝图半透明线在 WXSS 里是 rgba）。
function resolveColor(key, colors) {
  if (key == null) return '#000000';
  const c = colors || {};
  if (Object.prototype.hasOwnProperty.call(c, key)) return c[key];
  const m = /^#([0-9a-fA-F]{8})$/.exec(String(key));
  if (m) {
    const h = m[1];
    const a = parseInt(h.slice(6, 8), 16) / 255;
    return (
      'rgba(' +
      parseInt(h.slice(0, 2), 16) + ',' +
      parseInt(h.slice(2, 4), 16) + ',' +
      parseInt(h.slice(4, 6), 16) + ',' +
      Math.round(a * 100) / 100 +
      ')'
    );
  }
  return key;
}

// '写于 {{dateLong}}' → '写于 2026年9月12日'
function fmt(text, view) {
  return String(text == null ? '' : text).replace(/\{\{(\w+)\}\}/g, (_, k) =>
    view && view[k] != null ? String(view[k]) : ''
  );
}

// 行盒高（px）：显式 lh 优先，否则按字体族的 normal 近似
function lineBox(size, face, lh) {
  if (lh) return size * lh;
  const m = METRICS[face] || METRICS.hei;
  return size * (m.asc + m.desc);
}

module.exports = {
  METRICS,
  SPECS,
  specOf,
  resolveColor,
  fmt,
  lineBox
};
