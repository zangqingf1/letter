'use strict';
/**
 * 详情页拆信幕：信封与名字在**首帧**就必须是这封信自己的，且首帧就有信封可看。
 *
 * 为什么值得离线测：
 *   `detail.js` 的 `data.theme` 曾经直接是本地默认款（`write/themes.js[0]` = 小王子，
 *   `envelope` 指向包内图 `/assets/theme/xiaowangzi/envelope.jpg`）。真主题原来有两条
 *   **异步**来源 —— 入口页事件通道的 `letterHint`（home/clips 在 navigateTo 的 success 里
 *   emit）与 `loadLetter` 的云函数 —— 而 navigateTo 的时序是
 *   「目标页 onLoad/onShow → **首帧渲染** → 源页 success 回调」⇒ emit 比首帧还晚。
 *   于是任意一封信的拆信动画开场都先画小王子的信封。对纯云端主题（如「印花」，
 *   信封素材在云存储）最刺眼：`<image>` 换 src 期间旧图还挂在屏幕上，云图加载失败时
 *   整段 1.3s 动画就停在默认款上（用户报的正是这个）。
 *
 * 现在的口径（本文件守的就是它）：
 *   ① 入口页在 wx.navigateTo **之前**解析主题并写进同步交接槽（services/handoff.js），
 *      详情页 onLoad 同步取出、与 statusBarHeight 同批 setData ⇒ 首帧即正确；
 *   ② 信封两级 src：首帧用列表页刚渲染过的小图（envelopeThumb，图片缓存命中 → 第一帧
 *      就有信封），大图由屏幕外的预取节点加载完顶上，且回源后不回退成小图；
 *   ③ 没有交接时（外部直接打开本页）留空等云函数，绝不凭空亮出默认款。
 *
 * 断言三层：行为（首帧 / 升级 / 交接语义）+ 结构（WXML 与两个入口页）。
 * 桩 wx / Page / getApp 与四个云函数，不起真机。三点坑：
 *   ① 埋点必须桩掉 —— `services/analytics.js` 在云端模式下 `track()` 会挂 15s 攒批定时器，
 *      不桩住测试进程会被吊着不退出；
 *   ② `onLoad` 的 1.3s / 4s 揭幕定时器要在用例末尾用 `onUnload()` 清掉；
 *   ③ 交接槽的读写要落在**同一份** App.globalData 上，故 getApp 返回每个用例自己的对象。
 * 本文件会设置全局 wx / Page / getApp 供 require 期读取（与 list-firstpaint 同做法）。
 */
const fs = require('fs');
const path = require('path');
const { suite, test, eq, ok } = require('../runner');

const ROOT = path.resolve(__dirname, '..', '..');
const MINI_ROOT = path.join(ROOT, 'miniprogram') + path.sep;
const read = (p) => fs.readFileSync(path.join(MINI_ROOT, p), 'utf8');
const DETAIL_JS = read(path.join('pages', 'detail', 'detail.js'));
const DETAIL_WXML = read(path.join('pages', 'detail', 'detail.wxml'));
const DETAIL_WXSS = read(path.join('pages', 'detail', 'detail.wxss'));
const HOME_JS = read(path.join('pages', 'home', 'home.js'));
const CLIPS_JS = read(path.join('pages', 'clips', 'clips.js'));
const APP_JS = read('app.js');
const ANALYTICS = path.join(MINI_ROOT, 'services', 'analytics.js');

// 本地默认款（services/theme.js DEFAULT_THEME_ID = 'cuican' 璀璨如初）的包内信封图：
// 拆信幕里**任何时刻**都不该出现默认款的信封图
const DEFAULT_ENV = '/assets/theme/cuican/envelope.jpg';
// 纯云端主题「印花」：小图与大图是两个不同的云存储 fileID（列表渲染小图、详情幕用大图）
const YINHUA_ENV = 'cloud://env.bucket/theme/yinhua/envelope.jpg';
const YINHUA_THUMB = 'cloud://env.bucket/theme/yinhua/envelope-thumb.jpg';

const XIAOWANGZI = { id: 'xiaowangzi', name: '小王子', version: 2, envelope: DEFAULT_ENV, envelopeThumb: DEFAULT_ENV, palette: { base: '#F9F3E4' } };
const YINHUA = { id: 'yinhua', name: '印花', version: 1, envelope: YINHUA_ENV, envelopeThumb: YINHUA_THUMB, palette: { base: '#F0ECE2' } };

const FREE = { ok: true, membership: { state: 'free', level: '', renew: false, remainingDays: 0 } };
const LETTER = {
  id: 'l1',
  name: '给失眠时的自己',
  question: '为什么睡不着？',
  answer: '因为白天没说完的话都堆到了夜里。',
  theme_id: 'yinhua',
  paper_id: 'liubai',
  pinned: false,
  created_at: Date.now() - 86400000,
  opens: [],
  replies: []
};

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

// 每个用例一套全新的模块态（services 的缓存是模块级变量，不重建会串味）
function load(opts) {
  const o = Object.assign({ letter: LETTER, themes: [XIAOWANGZI, YINHUA], papers: [], storage: {} }, opts || {});
  for (const k of Object.keys(require.cache)) {
    if (k.indexOf(MINI_ROOT) === 0) delete require.cache[k];
  }
  // 埋点桩（必须在清缓存之后、require 页面之前塞进 require.cache）
  require.cache[ANALYTICS] = { id: ANALYTICS, filename: ANALYTICS, loaded: true, exports: { track() {} } };

  const state = { calls: [], patches: [], toast: null, storage: Object.assign({}, o.storage), app: { globalData: {} } };
  const reply = (v, d) => new Promise((r) => setTimeout(() => r(v), d));
  const themesOf = () => (typeof o.themes === 'function' ? o.themes() : o.themes);

  const handlers = {
    'letter.get': () => reply({ ok: true, letter: o.letter }, 5),
    'theme.all': () => reply({ ok: true, themes: themesOf(), papers: o.papers }, 10),
    'member.get': () => reply(FREE, 10)
  };

  global.wx = {
    cloud: {
      init() {},
      callFunction({ name, data }) {
        const key = name + '.' + data.action;
        state.calls.push(key);
        const h = handlers[key];
        if (!h) return Promise.reject(new Error('未桩的调用 ' + key));
        return Promise.resolve(h(data)).then((result) => ({ result }));
      }
    },
    getWindowInfo: () => ({ statusBarHeight: 44 }),
    getStorageSync: (k) => (k in state.storage ? state.storage[k] : null),
    setStorageSync(k, v) { state.storage[k] = v; },
    removeStorageSync(k) { delete state.storage[k]; },
    showToast: (t) => { state.toast = t; },
    navigateBack() {},
    navigateTo() {}
  };
  // 交接槽（services/handoff.js）读的是 App.globalData：同一用例内共用 state.app
  global.getApp = () => state.app;

  let def = null;
  global.Page = (d) => { def = d; };
  require(path.join(MINI_ROOT, 'pages', 'detail', 'detail.js'));
  // 与 detail.js 同实例（上面刚清过缓存，这里是第一次 require）
  const handoff = require(path.join(MINI_ROOT, 'services', 'handoff.js'));

  return {
    state,
    calls: () => state.calls,
    put: handoff.put,
    take: handoff.take,
    // 真实首帧：onLoad 里的 setData 与初始 data 一起进渲染层
    page() {
      const p = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) });
      p.setData = function (patch) {
        state.patches.push(patch);
        Object.assign(this.data, patch);
      };
      state.firstFrame = JSON.parse(JSON.stringify(def.data));
      p.onLoad({ id: o.letter.id });
      p.onShow();
      return p;
    }
  };
}

suite('详情页拆信幕 · 信封只画真实主题', () => {
  test('df-01 没有交接时首帧不画任何信封（既不画印花的，也不画小王子的）', () => {
    const h = load({});
    const p = h.page();

    eq(p.data.opening, true, '此时停在拆信幕上（动画在播）');
    eq(p.data.envSrc, '', '首帧没有信封可画：主题还没解析到，留空而不是回落默认款');
    eq(p.data.envFull, '', '预取节点也不该有地址');
    eq(p.data.theme.envelope, '', '主题同样留空，避免任何一处误用默认款');
    eq(h.calls().length, 3, '三个读接口都已发出但都还没回来（themes+papers 已合并为一次 theme.all）');
  });

  test('df-02 从首帧到云函数返回，任何一帧都不出现本地默认款的信封图', async () => {
    const h = load({});
    const p = h.page();
    await tick(40);

    // 渲染层真正画到的信封序列 = 首帧 data + 之后每一次 setData
    const frames = [h.state.firstFrame.envSrc].concat(
      h.state.patches.map((x) => x.envSrc).filter((v) => typeof v === 'string')
    );
    eq(frames.indexOf(DEFAULT_ENV), -1, '默认款（璀璨如初）的包内信封图任何一帧都不该出现：信封只来自这封信自己的主题');
    eq(p.data.envSrc, YINHUA_THUMB, '云函数回来后画的是这封信的印花信封');
  });

  test('df-03 交接槽里有主题 → 首帧就是这封信的信封，且先用列表缓存的小图', () => {
    const h = load({});
    h.put({ id: LETTER.id, name: '给失眠时的自己', theme: YINHUA });
    const p = h.page();

    eq(h.calls().length, 3, '三个读接口都还没回来（themes+papers 已合并为一次 theme.all；下面断言取的确实是首帧，不是云函数结果）');
    eq(p.data.envSrc, YINHUA_THUMB, '首帧画的是列表页刚渲染过的小图信封：图片缓存命中，第一帧就有信封');
    eq(p.data.envFull, YINHUA_ENV, '大图交给屏幕外的预取节点');
    eq(p.data.theme.id, 'yinhua', '主题已就位（拆信幕的纸色等同批落地）');
    eq(p.data.letter.name, '给失眠时的自己', '名字同批落地（动画里信封下面那行字）');
    p.onUnload();
  });

  test('df-04 大图加载完顶上，云函数回源后不回退成小图', async () => {
    const h = load({});
    h.put({ id: LETTER.id, name: '给失眠时的自己', theme: YINHUA });
    const p = h.page();

    p.onEnvFullLoaded(); // 屏幕外预取节点的 bindload

    eq(p.data.envSrc, YINHUA_ENV, '大图已进缓存，无缝顶上');
    eq(p.data.envFull, '', '预取节点撤掉，不再重复加载');

    await tick(40); // loadLetter 回源（云函数给的主题与交接的那份同源）

    eq(p.data.envSrc, YINHUA_ENV, '回源后仍是大图：换主题对象不退回小图，否则动画中间会糊一下');
    p.onUnload();
  });

  test('df-05 交接只服务刚点开的那封信：取用即清，id 不匹配丢弃', () => {
    const h = load({});

    h.put({ id: LETTER.id, name: '另一封', theme: YINHUA });
    eq(h.take('l-other'), null, 'id 不匹配 → 不认这次交接（详情页按无交接留空）');

    h.put({ id: LETTER.id, name: '给失眠时的自己', theme: YINHUA });
    eq((h.take(LETTER.id) || {}).name, '给失眠时的自己', 'id 匹配 → 取出');
    eq(h.take(LETTER.id), null, '取用即清：再取为空，不会残留给下一次直开本页');
  });

  test('df-06 结构：WXML 按 envSrc 画 + 大图预取节点 + 详情页不引用包内信封素材', () => {
    const img = DETAIL_WXML.split('\n').find((l) => l.indexOf('us-env-img') > -1);
    ok(!!img, 'detail.wxml 应有 .us-env-img');
    ok(/wx:if="\{\{\s*envSrc\s*\}\}"/.test(img), '.us-env-img 必须按 envSrc 条件渲染：没有信封时留空');
    const pre = DETAIL_WXML.split('\n').find((l) => l.indexOf('us-env-pre') > -1);
    ok(!!pre, '缺大图预取节点，信封会一直是列表那张小图');
    ok(/bindload="onEnvFullLoaded"/.test(pre), '预取节点要靠 bindload 触发切换');
    ok(/\.us-env-pre\s*\{[\s\S]*?position:\s*absolute/.test(DETAIL_WXSS), '.us-env-pre 必须绝对定位：不参与布局，否则信封会多占一份高度');
    eq(DETAIL_JS.indexOf('/assets/theme'), -1, 'detail.js 不得引用包内信封素材（信封一律来自主题数据）');
    eq(DETAIL_JS.indexOf('getOpenerEventChannel'), -1, '事件通道已废弃：emit 在 navigateTo success 里，晚于首帧');
  });

  test('df-07 结构：两个入口页都在跳转前完成交接，交接内容完整，且不再用事件通道', () => {
    ok(/globalData:\s*\{\}/.test(APP_JS), 'app.js 要声明 globalData（交接槽的容器）');
    for (const [name, src] of [['home.js', HOME_JS], ['clips.js', CLIPS_JS]]) {
      const putAt = src.indexOf('handoff.put(');
      const urlAt = src.indexOf("'/pages/detail/detail?id='");
      ok(putAt > -1, name + ' 应在跳转前 handoff.put(...) 交接主题');
      ok(urlAt > putAt, name + ' 的交接必须早于拼详情页 URL（navigateTo 的 success 回调晚于目标页首帧）');
      eq(src.indexOf('eventChannel'), -1, name + ' 不应再用事件通道传主题');

      // 交接内容：手写的 hint 表必须带 id —— put({ id: hint.id }) 拿不到 id 时，
      // take() 的 id 校验必然不通过，整份交接被静默丢弃（首帧就没有信封了）。
      // 这条曾漏网：home.js 的 _hints 少了 id，而旧断言只查 handoff.put 出现过。
      const hintLine = src.split('\n').find((l) => l.indexOf('_hints[String(') > -1);
      ok(!!hintLine, name + ' 应有按 id 取用的 _hints 表');
      ok(/\bid:\s*[A-Za-z_$][\w$]*\.id/.test(hintLine), name + ' 的 _hints 必须带 id：handoff.put/take 靠它配对');
      ok(/name:\s*[A-Za-z_$][\w$]*\.name/.test(hintLine), name + ' 的 _hints 必须带 name（拆信幕信封下那行字）');
      ok(/theme_id:\s*[A-Za-z_$][\w$]*\.theme_id/.test(hintLine), name + ' 的 _hints 必须带 theme_id（跳转前据此解析主题）');

      // 跳转前解析用的那份 themes 必须是**本页渲染用的快照**，不能只读不赋值：
      // 只读不赋值 ⇒ 永远走 `|| cachedThemes()`，而全局缓存会被 1h TTL 刷新，
      // 「详情页首帧 = 刚点那张卡片的信封」这条不变量就不再成立（home.js 曾如此）。
      ok(/this\._themes\s*=/.test(src), name + ' 必须给 this._themes 赋值（本页渲染快照），否则永远回落全局缓存');
      ok(/this\._isVip\s*=/.test(src), name + ' 必须给 this._isVip 赋值（专属款回落口径依赖它）');
    }
  });

  test('df-08 结构：入口页点按即预取信封两级素材 + 拆信幕对迟到的云图优雅降级', () => {
    // 云端主题（信封在云存储）的图片要走「fileID→临时URL→下载」，列表页"渲染过"不等于
    // "下载完"。三点守这里：
    //   ① 入口页在点按瞬间挂屏幕外预取节点（prefetchEnv），比详情页自己的两级 src
    //      早一个导航转场开始下载 —— 缓存按 URL 全局共享，拆信幕首帧才有图可命中；
    //   ② 信匣网格不做进入视口懒加载：视口外的信一点开就是必 miss 的缓存；
    //   ③ 云图万一仍迟到：拆信幕挂 fade 类淡入浮现（不突现），.us-env 预留信封高度
    //      （名字/邮戳不跳位）。
    const HOME_WXML = read(path.join('pages', 'home', 'home.wxml'));
    const CLIPS_WXML = read(path.join('pages', 'clips', 'clips.wxml'));
    for (const [name, src, jsSrc] of [['home.wxml', HOME_WXML, HOME_JS], ['clips.wxml', CLIPS_WXML, CLIPS_JS]]) {
      ok(src.indexOf('env-pre') > -1, name + ' 应有信封预取节点（点按即开始下载两级素材）');
      ok(/wx:if="\{\{\s*preEnv\s*\}\}"/.test(src), name + ' 预取小图节点按 preEnv 条件渲染');
      ok(/wx:if="\{\{\s*preEnvFull\s*\}\}"/.test(src), name + ' 预取大图节点按 preEnvFull 条件渲染');
      ok(jsSrc.indexOf('prefetchEnv') > -1, name + ' 对应页面逻辑应在跳转前调 prefetchEnv 预取');
      ok(jsSrc.indexOf('envelopeThumb') > -1 && jsSrc.indexOf('envelope') > -1, name + ' 预取两级素材（小图 + 大图）');
    }
    ok(HOME_WXML.indexOf('lazy-load') === -1, '信匣网格不做进入视口懒加载（clips 同口径，见 list-firstpaint）');

    const img = DETAIL_WXML.split('\n').find((l) => l.indexOf('us-env-img') > -1);
    ok(/envFade/.test(img) && /bindload="onEnvImgLoad"/.test(img), '拆信幕信封图按 envFade 挂淡入类并以 bindload 揭示');
    ok(/\.us-env\s*\{[\s\S]*?min-height/.test(DETAIL_WXSS), '.us-env 要预留信封高度：迟到的云图不把名字/邮戳顶得跳位');
    ok(/\.us-env-img\.fade\s*\{[\s\S]*?opacity:\s*0/.test(DETAIL_WXSS), 'fade 类挂载即透明，靠 bindload 后淡入，不突现');
  });
});
