'use strict';
/**
 * 主题 palette：只剩底色 base 一个键，且判空必须判到 base 本身。
 *
 * 为什么值得离线测：
 *   1) 三档墨色 title/text/tag 是「信纸自持」改版（2026-08）前的遗留 —— 信纸墨色改由
 *      papers.js colors 自持后，渲染侧（paper.wxml / paper.wxss / share.js）再没有任何
 *      地方读它们。留着只会让后台多出三个「改了没反应」的取色框，2026-09 已清理；
 *      这里守住「别再被加回来」。
 *   2) 后台把某主题的底色清空后，库里存下来的是 `{ base: '' }` —— 整体是真值。
 *      旧写法 `t.palette || def.palette` 在此时**不会**回落，详情页拆信动画拿到空
 *      `background` 会画出一张**透明纸**。这比「颜色不对」难发现得多：本地演示态
 *      （USE_CLOUD=false）走的是静态配置，永远看不到这个分支。
 *
 * 两层断言：数据源（admin seed / themes.js 里只有 base）+ 归一化（空值回落默认款）。
 */
const fs = require('fs');
const path = require('path');
const { suite, test, eq, ok } = require('../runner');
const { createHarness } = require('../harness');

const ROOT = path.resolve(__dirname, '..', '..');
const MINI_ROOT = path.join(ROOT, 'miniprogram') + path.sep;
const LOCAL_THEMES = require(path.join(ROOT, 'miniprogram', 'pages', 'write', 'themes.js'));
const ADMIN_APP = fs.readFileSync(path.join(ROOT, 'admin', 'app.js'), 'utf8');
const ADMIN_KEY = 'a-strong-random-admin-key-for-tests-only';

// 默认款的底色（services/theme.js DEFAULT_THEME_ID = 'cuican' 璀璨如初）—— 归一化的回落目标
const DEFAULT_BASE = LOCAL_THEMES.find((t) => t.id === 'cuican').palette.base;

// 只桩 services/theme.js 需要的东西（wx.cloud + storage），不起真机、不连云
function loadThemeService(themes) {
  for (const k of Object.keys(require.cache)) {
    if (k.indexOf(MINI_ROOT) === 0) delete require.cache[k];
  }
  const storage = {};
  global.wx = {
    cloud: {
      init() {},
      callFunction: ({ name, data }) =>
        Promise.resolve({ result: { ok: true, themes: typeof themes === 'function' ? themes(name, data) : themes } })
    },
    getStorageSync: (k) => (k in storage ? storage[k] : null),
    setStorageSync(k, v) { storage[k] = v; },
    removeStorageSync(k) { delete storage[k]; }
  };
  return require(path.join(MINI_ROOT, 'services', 'theme.js'));
}

const baseOf = (list, id) => (list.find((t) => t.id === id) || {}).palette;

suite('主题 palette · 底色单键与回落', () => {
  test('pl-01 空 base（后台把底色清空）回落默认款，不画透明纸', async () => {
    const svc = loadThemeService([
      { id: 'xiaowangzi', name: '小王子', version: 2, palette: { base: '#F9F3E4' } },
      { id: 'kong', name: '清空底色的款', version: 1, palette: { base: '' } }
    ]);
    const list = await svc.getThemes();

    eq(baseOf(list, 'kong').base, DEFAULT_BASE, '空 base 必须回落默认款底色，否则拆信动画是透明纸');
    ok(!!baseOf(list, 'kong').base, '底色不能是空串');
  });

  test('pl-02 palette 整块缺失 / 空对象同样回落默认款', async () => {
    const svc = loadThemeService([
      { id: 'xiaowangzi', name: '小王子', version: 2, palette: { base: '#F9F3E4' } },
      { id: 'wu', name: '没有 palette', version: 1 },
      { id: 'kongdui', name: '空对象 palette', version: 1, palette: {} }
    ]);
    const list = await svc.getThemes();

    eq(baseOf(list, 'wu').base, DEFAULT_BASE);
    eq(baseOf(list, 'kongdui').base, DEFAULT_BASE);
  });

  test('pl-03 正常的 base 原样保留，且无 swatch 时由 base 推导', async () => {
    const svc = loadThemeService([
      { id: 'xiaowangzi', name: '小王子', version: 2, palette: { base: '#F9F3E4' } },
      { id: 'guiniao', name: '归鸟', version: 1, palette: { base: '#E9DCCF' } },
      { id: 'youSwatch', name: '带色样', version: 1, swatch: '#D9C3B2', palette: { base: '#E9DCCF' } }
    ]);
    const list = await svc.getThemes();

    eq(baseOf(list, 'guiniao').base, '#E9DCCF', '配好的底色不能被回落覆盖');
    eq(list.find((t) => t.id === 'guiniao').swatch, '#E9DCCF', '无 swatch 时用底色当卡片色样');
    eq(list.find((t) => t.id === 'youSwatch').swatch, '#D9C3B2', '配了 swatch 就用它，不被底色顶掉');
  });

  test('pl-04 本地静态配置与 admin seed 的 palette 都只有 base', () => {
    for (const t of LOCAL_THEMES) {
      eq(Object.keys(t.palette || {}), ['base'], `themes.js 的 ${t.id} 只该有 base`);
    }
    // 后台抽屉里不该再出现那三个取色框（它们指向的字段无人读取）
    for (const dead of ['palette.title', 'palette.text', 'palette.tag']) {
      eq(ADMIN_APP.indexOf(dead), -1, `admin/app.js 不该再引用 ${dead}`);
    }
  });

  test('pl-05 themeSeed / memberItemSeed 落库的主题只有 base', async () => {
    process.env.ADMIN_KEY = ADMIN_KEY;
    const h = createHarness();
    const main = h.load('admin');
    const call = (payload) => main(Object.assign({ key: ADMIN_KEY }, payload));

    const r1 = await call({ action: 'themeSeed' });
    ok(r1.ok && r1.seeded >= 1, '官方主题 seed 应落库');
    const r2 = await call({ action: 'memberItemSeed' });
    ok(r2.ok && r2.seeded >= 1, '专属内容 seed 应落库');

    const seeded = h.all('themes').concat(h.find('member_items', (x) => x.kind === 'theme'));
    // 专属主题已不再随 seed 内置（归鸟/星汐已删），seed 里只剩官方主题小王子一套
    ok(seeded.length >= 1, '官方主题 seed 应落库');
    for (const t of seeded) {
      eq(Object.keys(t.palette), ['base'], `${t.theme_id || t.item_id} 的 seed 只该有 base`);
    }
  });

  test('pl-06 免费尝鲜款（freeTrial）带 premium 标记但不锁定', async () => {
    const svc = loadThemeService([]);
    const def = { id: svc.DEFAULT_THEME_ID, name: '默认款', palette: { base: '#F6F3EA' } };
    const gold = { id: 'gold', name: '鎏金笺', premium: true, freeTrial: true, palette: { base: '#FAF4E6' } };
    const canglan = { id: 'canglan', name: '苍蓝笺', premium: true, palette: { base: '#DDEDEA' } };
    const list = [def, gold, canglan];
    eq(svc.themeOf('gold', list, false).id, 'gold', '免费尝鲜款非 VIP 也不得回落默认款');
    eq(svc.paperOf('gold', list, false).id, 'gold', '信纸版式同理');
    eq(svc.themeOf('canglan', list, false).id, svc.DEFAULT_THEME_ID, '普通专属款非 VIP 仍回落默认款');
    eq(svc.themeOf('canglan', list, true).id, 'canglan', 'VIP 正常使用专属款');
  });

  test('pl-07 isLocked 必须导出（step2 编辑落地/封存寄出直接调 themeService.isLocked）', () => {
    const svc = loadThemeService([]);
    eq(typeof svc.isLocked, 'function', 'theme 服务必须导出 isLocked —— 漏导出会在真机抛 isLocked is not a function（编辑/寄出全挂）');
    eq(svc.isLocked({ premium: true }, false), true, '专属款非 VIP 锁定');
    eq(svc.isLocked({ premium: true, freeTrial: true }, false), false, '免费尝鲜款不锁定');
    eq(svc.isLocked({ premium: true }, true), false, 'VIP 不锁定');
    eq(svc.isLocked(null, false), false, '空对象不锁定');
  });
});
