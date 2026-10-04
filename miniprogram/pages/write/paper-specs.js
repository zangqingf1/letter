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
        // gap 必须为 0：adv() 已含「箱」的尾随字距 14rpx，CSS 里号外就紧随其后
        sup: { text: '号外', size: 22, face: HEI, weight: '700 ', ls: 6, color: 'accent', va: 18, gap: 0 }
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
    ],
    // 暗夜径向渐变底（WXSS radial-gradient(ellipse at 50% 20%, #2A2F3A 0%, #22262E 60%, #1D2027 100%)）；
    // 色标取 papers.js moye 预置的 bg1/bg2/bg3，导出侧 share.js drawAbsMoye 绘制
    abs: 'moye'
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

  // ── 竖排笺 shupai（.pl-sp；writing-mode 竖排右起，Canvas 逐字竖排定位）──
  // cols 顺序 = 右→左：名称 / 问签+问题 / 答签+答案 / 落款；
  // gap = 该元素换列后的 margin-left（与 WXSS 一致）。导出放不下内容宽时整体缩小字号重排。
  shupai: {
    css: '.pl-sp',
    pad: [50, 50, 44, 50],
    flow: [
      {
        k: 'vbody',
        h: 1600, // .vsp-body 固定高（预览与导出同值）
        cols: [
          { f: 'name', size: 34, face: SONG, lh: 1.9, ls: 10, color: 'deep', gap: 40 }, // .vsp-name
          { tag: '问', size: 18, face: HEI, padX: 6, pt: 18, pb: 22, border: 2, color: 'tan', line: 'tanLine', gap: 34 }, // .vsp-tag
          { f: 'question', size: 26, face: KAI, lh: 2.3, color: 'gray', gap: 34 }, // .vsp-q .vsp-txt
          { tag: '答', size: 18, face: HEI, padX: 6, pt: 18, pb: 22, border: 2, fill: true, color: 'bg', chipBg: 'fill', line: 'fill', gap: 34 }, // .vsp-tag-fill
          { f: 'answer', size: 26, face: KAI, lh: 2.3, color: 'ink', gap: 34 }, // .vsp-a .vsp-txt
          { text: '写于 {{dateLong}}', size: 20, face: HEI, ls: 7, color: 'date', pt: 460, gap: 30 } // .vsp-date
        ]
      }
    ]
  },

  // ── 一线笺 yixian（.pl-yx；左侧一根贯纸细线，正文挂线右置）──
  yixian: {
    css: '.pl-yx',
    pad: [62, 60, 52, 120],
    flow: [
      { k: 'text', text: '心灵信箱 · LETTER {{serial}}', size: 18, face: HEI, ls: 7, color: 'faint' }, // .ply-eyebrow
      { k: 'text', f: 'name', size: 36, face: HEI, weight: '600 ', lh: 1.5, ls: 4, color: 'deep', mt: 18 }, // .ply-name
      { k: 'text', text: '问', size: 18, face: HEI, ls: 10, color: 'faint', mt: 48, mb: 14 }, // .ply-cap
      { k: 'text', f: 'question', size: 28, face: HEI, lh: 2.1, color: 'gray' }, // .ply-qt
      { k: 'text', text: '答', size: 18, face: HEI, ls: 10, color: 'faint', mt: 48, mb: 14 },
      { k: 'text', f: 'answer', size: 28, face: HEI, lh: 2.1, color: 'ink' },
      {
        k: 'lr',
        mt: 60, // .ply-foot
        left: { text: 'MENTAL MAILBOX · 私人信件', size: 18, face: HEI, ls: 5, color: 'faint' },
        right: { text: '写于 {{dotDate}}', size: 20, face: HEI, ls: 4, color: 'sub' }
      }
    ],
    abs: 'yixian'
  },

  // ── 版心笺 banxin（.pl-bx；书页版心：天头 Running head + 题记 + 两端对齐正文 + 页码）──
  banxin: {
    css: '.pl-bx',
    pad: [42, 60, 34, 60],
    flow: [
      {
        // .plbx-rh：两端细线拉通（flex ::before/::after）
        k: 'text',
        text: '心灵信箱 · 卷八 · 第 {{stampText}} 页',
        size: 18,
        face: HEI,
        ls: 7,
        color: 'faint',
        rule: { h: 2, color: 'rhLine', gap: 28, both: true }
      },
      { k: 'text', text: '其一', size: 18, face: HEI, ls: 10, indent: 10, align: 'center', color: 'faint', mt: 44 }, // .plbx-no
      { k: 'text', f: 'name', size: 38, face: SONG, weight: '700 ', lh: 1.5, ls: 5, align: 'center', color: 'deep', mt: 16 }, // .plbx-name
      { k: 'text', text: '◆', size: 16, face: SONG, ls: 20, indent: 20, align: 'center', color: 'orn', mt: 18 }, // .plbx-orn
      { k: 'line', h: 40, w: 2, align: 'center', color: 'line', mt: 60, mb: 28 }, // .plbx-epiline（上垂短线）
      { k: 'text', f: 'question', size: 27, face: KAI, lh: 2.1, align: 'center', color: 'gray', frac: 0.863 }, // .plbx-epi（max-width 440 / 内容宽 510rpx）
      { k: 'text', f: 'answer', size: 28, face: SONG, lh: 2.15, color: 'ink', mt: 60, justify: true, indent: 56 }, // .plbx-body（首行缩进 2em）
      { k: 'text', text: '· {{stampText}} · 写于 {{dateLong}}', size: 20, face: SONG, ls: 7, align: 'center', color: 'faint', mt: 72 } // .plbx-folio
    ]
  },

  // ── 居中笺 juzhong（.pl-jz；全部居中，双菱形分隔）──
  juzhong: {
    css: '.pl-jz',
    pad: [56, 54, 46, 54],
    flow: [
      { k: 'text', text: '把答案寄给未来', size: 18, face: HEI, ls: 14, indent: 14, align: 'center', color: 'faint' }, // .pljz-eyebrow
      { k: 'text', f: 'name', size: 38, face: KAI, lh: 1.7, ls: 7, align: 'center', color: 'deep', mt: 40 }, // .pljz-name
      { k: 'sep', w: 300, d: 12, gap: 20, color: 'line', dColor: 'gold', mt: 46, mb: 46 }, // .pljz-sep
      { k: 'text', f: 'question', size: 28, face: KAI, lh: 2.15, align: 'center', color: 'gray', frac: 0.757 }, // .pljz-q（max-width 395 / 内容宽 522rpx）
      { k: 'text', f: 'answer', size: 28, face: SONG, lh: 2.25, align: 'center', color: 'ink', mt: 46, frac: 0.815 }, // .pljz-a（max-width 425 / 内容宽 522rpx）
      { k: 'text', text: '写于 {{dateLong}}', size: 20, face: HEI, ls: 5, align: 'center', color: 'gray', mt: 68 }, // .pljz-date
      { k: 'text', text: '心 灵 信 箱', size: 16, face: HEI, ls: 10, indent: 10, align: 'center', color: 'brand', mt: 46 } // .pljz-brand
    ],
    abs: 'juzhong'
  },

  // ── 裁切笺 caiqie（.pl-cq；四角出血裁切线 + 等宽索引行 + Q/A 发排式小标）──
  caiqie: {
    css: '.pl-cq',
    pad: [54, 56, 46, 56],
    flow: [
      {
        // .plcq-index：等宽索引行（border-bottom 在下一条 line op 落位）
        k: 'lr',
        pb: 24,
        left: { text: 'NO. {{dwgNo}} · PRIVATE', size: 19, face: MONO, ls: 4, color: 'faint' },
        right: { text: '{{dotDate}}', size: 19, face: MONO, ls: 4, color: 'faint' }
      },
      { k: 'line', h: 2, color: 'line' }, // .plcq-index 的 border-bottom
      { k: 'text', f: 'name', size: 36, face: HEI, weight: '700 ', lh: 1.5, ls: 4, color: 'deep', mt: 68 }, // .plcq-name
      {
        // .plcq-cap：Q/A 加粗深色（prefix），破折号退灰
        k: 'text',
        text: ' ──────────',
        size: 19,
        face: MONO,
        ls: 5,
        color: 'faint',
        mb: 18,
        prefix: { text: 'Q', size: 19, weight: '700 ', color: 'deep' }
      },
      { k: 'text', f: 'question', size: 28, face: HEI, lh: 2.1, color: 'gray', frac: 0.85 }, // .plcq-q .plcq-txt
      {
        k: 'text',
        text: ' ──────────',
        size: 19,
        face: MONO,
        ls: 5,
        color: 'faint',
        mt: 68,
        mb: 18,
        prefix: { text: 'A', size: 19, weight: '700 ', color: 'deep' }
      },
      { k: 'text', f: 'answer', size: 28, face: HEI, lh: 2.1, color: 'ink', frac: 0.85 },
      {
        k: 'lr',
        mt: 94,
        pt: 26,
        border: { h: 2, color: 'line' }, // .plcq-foot
        left: { text: 'MENTAL MAILBOX', size: 18, face: MONO, ls: 7, color: 'faint' },
        right: { text: '写于 {{dotDate}}', size: 20, face: HEI, ls: 4, color: 'sub' }
      }
    ],
    abs: 'caiqie'
  },

  // ── 星图观测笺 xingtu（.pl-xt；深蓝夜空网格 + 金色刻度尺 + 右上星座连线群）──
  xingtu: {
    css: '.pl-xt',
    pad: [52, 50, 46, 50],
    flow: [
      { k: 'text', text: 'MENTAL MAILBOX OBSERVATORY · OBS. {{mon2}}{{day2}}', size: 18, face: MONO, ls: 7, color: 'goldSoft' }, // .plxt-eyebrow
      { k: 'text', text: '今夜观测记录', size: 20, face: HEI, ls: 14, indent: 14, color: 'blue', mt: 11 }, // .plxt-eyebrow-cn
      { k: 'text', f: 'name', size: 40, face: SONG, lh: 1.6, ls: 5, color: 'bright', mt: 40, frac: 0.72 }, // .plxt-name
      { k: 'line', h: 3, w: 115, color: 'gold', mt: 32 }, // .plxt-name-rule
      { k: 'text', text: '✦ 问', size: 20, face: HEI, ls: 8, color: 'gold', mt: 58, mb: 18 }, // .plxt-cap
      { k: 'text', f: 'question', size: 28, face: HEI, lh: 2.0, color: 'gray' }, // .plxt-txt
      { k: 'text', text: '✦ 答', size: 20, face: HEI, ls: 8, color: 'gold', mt: 58, mb: 18 },
      { k: 'text', f: 'answer', size: 28, face: HEI, lh: 2.0, color: 'ink' },
      {
        k: 'lr',
        mt: 79, // .plxt-foot
        left: { text: 'RA 03h 47m · DEC +24° 07′', size: 18, face: MONO, ls: 4, color: 'coord' },
        right: { text: '{{dotDate}}', size: 20, face: HEI, ls: 4, color: 'gold' }
      }
    ],
    abs: 'xingtu'
  },

  // ── 胶片底片 jiaopian（.pl-fm；齿孔条 + 片边印字 + 画幅框，框由 sheet 机制参与排版）──
  jiaopian: {
    css: '.pl-fm',
    pad: [106, 42, 104, 42], // 上下容下齿孔条 + 片边印字两层，再接画幅框
    sheet: [34, 34, 30, 34], // .plfm-frame 内衬（border 用 box-shadow 0 0 0 3rpx 模拟，不占布局）
    sheetCss: '.plfm-frame',
    flow: [
      { k: 'text', f: 'name', size: 45, face: SONG, lh: 1.6, ls: 4, color: 'bright' }, // .plfm-name
      { k: 'text', text: 'SCENE 01 · 问', size: 20, face: MONO, ls: 7, color: 'accent', mt: 47 }, // .plfm-cap
      { k: 'text', f: 'question', size: 26, face: HEI, lh: 2.0, color: 'gray' }, // .plfm-txt
      { k: 'text', text: 'SCENE 02 · 答', size: 20, face: MONO, ls: 7, color: 'accent', mt: 47 },
      { k: 'text', f: 'answer', size: 26, face: HEI, lh: 2.0, color: 'ink' },
      {
        k: 'lr',
        mt: 61,
        pt: 25,
        border: { h: 2, color: 'footLine' }, // .plfm-foot
        left: { text: 'EXPOSURE', size: 19, face: MONO, ls: 5, color: 'footDim' },
        right: { text: '摄于 {{dotDate}}', size: 22, face: HEI, ls: 4, color: 'accent' }
      }
    ],
    abs: 'jiaopian'
  },

  // ── 日历撕页 rili（.pl-rl；撕线与月份带整幅出血（lr full），特大日期 + 黄历角签）──
  rili: {
    css: '.pl-rl',
    pad: [0, 44, 40, 44],
    flow: [
      {
        // .plrl-tearline：全幅出血，dashed 撕线在文字下方（border.bottom）
        k: 'lr',
        full: true,
        px: 36,
        pt: 22,
        border: { h: 3, color: 'tear', dash: [10, 7], bottom: true },
        left: { text: '✂ 沿此线撕取', size: 19, face: HEI, ls: 5, color: 'faint' },
        // 文案与 paper.wxml 逐字一致（曾多写 CALENDAR，阅读页没有）
        right: { text: 'MENTAL MAILBOX · {{yearText}}', size: 19, face: HEI, ls: 5, color: 'faint' }
      },
      {
        // .plrl-band：全幅出血的红色月份带（bg 整块铺色）
        k: 'lr',
        full: true,
        bg: 'red',
        px: 44,
        pt: 18,
        pb: 18,
        mt: 40,
        left: { text: '{{cnMonth}}', size: 30, face: SONG, weight: '800 ', ls: 9, color: 'cream' },
        right: { text: '{{enMonth}}', size: 19, face: MONO, ls: 5, color: 'creamDim' }
      },
      {
        // .plrl-datehead：特大日期 + 右侧星期/黄历角签（底对齐）
        k: 'datehead',
        mt: 36,
        gap: 32,
        asidePb: 18,
        almMt: 18,
        big: { f: 'dayNum', size: 166, face: SONG, weight: '900 ', ls: 4, lh: 0.95, color: 'deep' },
        wk: { text: '{{weekdayCn}} · 写下这封信的一天', size: 23, face: HEI, weight: '700 ', ls: 5, color: 'red' },
        alm: { text: '宜：想明白 忌：熬夜', size: 20, face: HEI, ls: 4, lh: 1.9, color: 'red', border: 3, padX: 18, padY: 11 }
      },
      { k: 'text', f: 'name', size: 38, face: HEI, weight: '700 ', ls: 4, color: 'deep', mt: 47 }, // .plrl-name
      // .plrl-cap 无 margin-top（WXSS 只有 margin-bottom 11）——曾错写 mt 43，比阅读页多沉一段
      { k: 'text', text: '问', size: 20, face: HEI, weight: '700 ', ls: 9, color: 'red', mb: 11 }, // .plrl-cap
      { k: 'text', f: 'question', size: 26, face: HEI, lh: 2.0, color: 'gray' }, // .plrl-txt
      { k: 'text', text: '答', size: 20, face: HEI, weight: '700 ', ls: 9, color: 'red', mt: 40, mb: 11 },
      { k: 'text', f: 'answer', size: 26, face: HEI, lh: 2.0, color: 'ink' },
      {
        k: 'lr',
        mt: 61,
        pt: 22,
        border: { h: 2, color: 'line' }, // .plrl-foot
        left: { text: '心灵信箱 · 每天一页', size: 20, face: HEI, ls: 5, color: 'faint' },
        // 文案与 paper.wxml 逐字一致（曾多写「· 本页永不撕去」，阅读页没有）
        right: { text: '写于 {{dateLong}}', size: 22, face: HEI, ls: 4, color: 'deep' }
      }
    ]
  },

  // ── 深夜处方笺 chufang（.pl-cf；诊所抬头 + 诊断/处方两段，与 paper.wxml 阅读页同构）──
  // 阅读页没有表单栏、DIAGNOSIS 英文角标、Rp 斜体落款与红圈章签名区（WXSS 样式保留但
  // 模板未使用），导出侧曾多画这些内容导致「分享图比阅读页多一截」，2026-09-20 对齐裁掉。
  // 本款阅读页不渲染信件名称（无姓名栏），是「名称必入图」口径的例外之一（同 zhengshu）。
  chufang: {
    css: '.pl-cf',
    pad: [42, 44, 38, 44],
    flow: [
      {
        // .plcf-head：左侧诊所抬头两行 + 右上 Rx 编号框
        k: 'rxhead',
        cn: { text: '心灵信箱 · 深夜诊所', size: 34, face: HEI, weight: '800 ', ls: 5, color: 'deep' },
        en: { text: 'MENTAL MAILBOX NIGHT CLINIC', size: 18, face: MONO, ls: 5, color: 'gray', mt: 7 },
        chip: { text: 'Rx No. {{mon2}}{{day2}}', size: 22, face: MONO, ls: 2, color: 'red', border: 3, padX: 16, padY: 9 }
      },
      { k: 'line', h: 5, color: 'deep', mt: 29 }, // .plcf-rule2 的粗线
      { k: 'line', h: 2, color: 'deep', mt: 9 }, // .plcf-rule2 的细线
      { k: 'text', text: '诊断', size: 22, face: HEI, weight: '800 ', ls: 7, color: 'red', mt: 50, mb: 14 }, // .plcf-cap
      { k: 'text', f: 'question', size: 26, face: HEI, lh: 2.0, color: 'sub' }, // .plcf-dxtxt
      { k: 'text', text: '处方', size: 22, face: HEI, weight: '800 ', ls: 7, color: 'red', mt: 47, mb: 14 }, // .plcf-rpbody .plcf-cap
      { k: 'text', f: 'answer', size: 26, face: HEI, lh: 2.05, color: 'ink' } // .plcf-rptxt
    ]
  },

  // ── 终端笺 zhongduan（.pl-tm；琥珀磷屏日志体，sup.block 画实心块光标）──
  zhongduan: {
    css: '.pl-tm',
    pad: [42, 44, 38, 44],
    flow: [
      {
        k: 'lr',
        pt: 18,
        border: { h: 2, color: 'line' }, // .pltm-bar
        left: { text: 'MENTAL-MAILBOX v{{yearText}}.{{mon2}}', size: 20, face: MONO, ls: 4, color: 'barDim' },
        right: { text: 'TTY1 · 深夜', size: 20, face: MONO, ls: 4, color: 'barDim' }
      },
      { k: 'text', text: 'FILE: ~/mailbox/{{yearText}}/{{mon2}}/{{day2}}.txt', size: 22, face: MONO, ls: 2, color: 'fileDim', mt: 43 }, // .pltm-file
      { k: 'text', f: 'name', size: 42, face: HEI, weight: '700 ', lh: 1.6, ls: 4, color: 'bright', mt: 14 }, // .pltm-name
      {
        // .pltm-prompt：> INPUT 亮色加粗（prefix），其余退灰
        k: 'text',
        text: ' / 来信问题 _',
        size: 21,
        face: MONO,
        ls: 2,
        color: 'promptDim',
        mt: 50,
        mb: 14,
        prefix: { text: '> INPUT', size: 21, weight: '700 ', color: 'bright' }
      },
      { k: 'text', f: 'question', size: 26, face: HEI, lh: 2.0, color: 'qDim' }, // .pltm-txt
      {
        k: 'text',
        text: ' / 处理结果 _',
        size: 21,
        face: MONO,
        ls: 2,
        color: 'promptDim',
        mt: 50,
        mb: 14,
        prefix: { text: '> OUTPUT', size: 21, weight: '700 ', color: 'bright' }
      },
      { k: 'text', f: 'answer', size: 26, face: HEI, lh: 2.0, color: 'aAmber' },
      {
        // .pltm-status 单行：行尾实心块光标（sup.block）；
        // 导出侧曾有「> PROCESS: 反刍中…… [DONE]」一行，阅读页没有，已对齐裁掉
        k: 'text',
        text: '> EXIT 0 · 已封存至 ~/mailbox/{{yearText}}/{{mon2}}/{{day2}}',
        size: 21,
        face: MONO,
        ls: 2,
        lh: 2.1,
        color: 'statusDim',
        mt: 54,
        sup: { block: true, w: 16, h: 27, gap: 11, color: 'bright' }
      },
      {
        k: 'lr',
        mt: 47,
        pt: 22,
        border: { h: 2, color: 'line' }, // .pltm-foot
        left: { text: 'MENTAL MAILBOX TERMINAL', size: 19, face: MONO, ls: 4, color: 'footDim' },
        right: { text: '写于 {{dotDate}}', size: 19, face: MONO, ls: 4, color: 'amber' }
      }
    ],
    abs: 'zhongduan'
  },

  // ── 结业证书 zhengshu（.pl-zs；四角角花 + 课题/答卷/落款，与 paper.wxml 阅读页同构）──
  // 注意：阅读页（paper.wxml）不渲染信件名称、结业词、颁发栏与红印缎带（WXSS 样式保留但
  // 模板未使用），导出侧曾多画这些内容，2026-09-20 对齐裁掉 —— 本款是「名称必入图」口径
  // 的唯一例外（阅读页没有的，分享图也不画）。
  zhengshu: {
    css: '.pl-zs',
    pad: [47, 50, 41, 50],
    flow: [
      { k: 'text', text: 'CERTIFICATE OF COMPLETION', size: 18, face: MONO, ls: 7, color: 'orgK' }, // .plzs-en
      { k: 'text', text: '结业证书', size: 58, face: SONG, weight: '900 ', ls: 25, indent: 25, align: 'center', color: 'title', mt: 18 }, // .plzs-cn
      { k: 'text', text: '❖ ❖ ❖', size: 22, face: SONG, ls: 18, indent: 18, align: 'center', color: 'orn', mt: 22 }, // .plzs-orn
      {
        // .plzs-cap：◆ 前缀 + 标题 + 延伸细线（rule 按前缀+文字总宽落位）
        k: 'text',
        text: '修习课题',
        size: 22,
        face: HEI,
        weight: '700 ',
        ls: 9,
        color: 'title',
        mt: 50,
        mb: 14,
        prefix: { text: '◆ ', size: 16, color: 'orn' },
        rule: { h: 2, color: 'capLine', gap: 22 }
      },
      { k: 'text', f: 'question', size: 26, face: KAI, lh: 2.0, color: 'courseTxt' }, // .plzs-txt
      {
        k: 'text',
        text: '结业答卷',
        size: 22,
        face: HEI,
        weight: '700 ',
        ls: 9,
        color: 'title',
        mt: 43,
        mb: 14,
        prefix: { text: '◆ ', size: 16, color: 'orn' },
        rule: { h: 2, color: 'capLine', gap: 22 }
      },
      { k: 'text', f: 'answer', size: 26, face: KAI, lh: 2.0, color: 'ink' },
      { k: 'text', text: '写于 {{dateLong}}', size: 22, face: HEI, ls: 5, align: 'center', color: 'courseTxt', mt: 25 } // .plzs-date
    ],
    abs: 'zhengshu'
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
