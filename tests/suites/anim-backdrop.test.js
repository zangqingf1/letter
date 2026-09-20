'use strict';
/**
 * 拆信幕、封存完成幕与阅读页/分享页的背景色随主题（desk = 主题桌面底色）。
 *
 * 为什么值得离线测：
 *   拆信幕与完成幕的背景原本写死（#EDE9DC、rgba(244,243,238,.96)），而 #EDE9DC
 *   恰好就是默认款（小王子）的 desk —— 等于所有主题的动画都泡在小王子的桌面色里。
 *   现在改成 WXML 内联绑定：拆信幕绑 `theme.desk`，完成幕绑 `currentTheme.desk`
 *   （与 step2 预览区同源）；阅读页（detail）与分享页（share）的页面背景同绑
 *   `theme.desk` —— 拆开一封信，从拆信动画到阅读/分享，整段体验都是同一主题的氛围。
 *   绑定缺失时回落原色值，默认款视觉不变。
 *
 * 数据侧保证绑定永远有值：
 *   - write/themes.js 每套官方主题都声明 desk；
 *   - services/theme.js 云端归一化 `desk: t.desk || def.desk` 兜底（含会员专属款）；
 *   - detail 的 BLANK_THEME 刻意没有 desk —— 无交接时回落中性色，不提前亮出主题。
 *
 * 断言为静态结构检查（读文件），不桩 wx/Page。
 */
const fs = require('fs');
const path = require('path');
const { suite, test, eq, ok } = require('../runner');

const ROOT = path.resolve(__dirname, '..', '..');
const MINI_ROOT = path.join(ROOT, 'miniprogram') + path.sep;
const read = (p) => fs.readFileSync(path.join(MINI_ROOT, p), 'utf8');
const DETAIL_WXML = read(path.join('pages', 'detail', 'detail.wxml'));
const DETAIL_WXSS = read(path.join('pages', 'detail', 'detail.wxss'));
const STEP2_WXML = read(path.join('pages', 'write', 'step2.wxml'));
const STEP2_WXSS = read(path.join('pages', 'write', 'step2.wxss'));
const THEMES_JS = read(path.join('pages', 'write', 'themes.js'));
const SHARE_WXML = read(path.join('pages', 'share', 'share.wxml'));
const THEME_SVC = read(path.join('services', 'theme.js'));

// 内联样式必须带兜底：WXML 的 || 右侧就是历史色值，保证 BLANK_THEME / 异常数据不透明
const UNSEAL_BG = 'theme.desk || \'#EDE9DC\'';
const FX_BG = 'currentTheme.desk || \'#F4F3EE\'';
const PAGE_BG = 'theme.desk || \'#F4F3EE\'';

suite('动画背景 · 拆信幕与完成幕随主题 desk', () => {
  test('ab-01 拆信幕背景绑定 theme.desk，缺省回落历史色', () => {
    const line = DETAIL_WXML.split('\n').find((l) => l.indexOf('class="unseal"') > -1);
    ok(!!line, 'detail.wxml 应有 .unseal 拆信幕节点');
    ok(line.indexOf('style=') > -1 && line.indexOf(UNSEAL_BG) > -1,
      '拆信幕背景应内联绑 theme.desk（历史色 #EDE9DC 作兜底）');
    ok(/\.unseal\s*\{[\s\S]*?background:\s*#EDE9DC/.test(DETAIL_WXSS),
      'wxss 保留同值兜底：绑定异常时仍是历史观感');
  });

  test('ab-02 完成幕背景绑定 currentTheme.desk，与预览区同源', () => {
    const line = STEP2_WXML.split('\n').find((l) => l.indexOf('class="send-fx') > -1);
    ok(!!line, 'step2.wxml 应有 .send-fx 完成幕节点');
    ok(line.indexOf('style=') > -1 && line.indexOf(FX_BG) > -1,
      '完成幕背景应内联绑 currentTheme.desk（历史色 #F4F3EE 作兜底）');
    const preview = STEP2_WXML.split('\n').find((l) => l.indexOf('class="preview') > -1);
    ok(!!preview && preview.indexOf('currentTheme.desk') > -1,
      '预览区同绑 currentTheme.desk：完成幕与预览区同一个桌面色，不另立口径');
    ok(/\.send-fx\s*\{[\s\S]*?background:\s*rgba\(244,\s*243,\s*238/.test(STEP2_WXSS),
      'wxss 保留同值兜底');
  });

  test('ab-03 主题数据侧保证 desk 恒有值；BLANK_THEME 刻意不带 desk', () => {
    // 官方主题（2026-09 起八套）每套都声明 desk：desk 数应与主题条目数一致，新增主题漏配即 FAIL
    ok(/desk:\s*'#[0-9A-Fa-f]{6}'/.test(THEMES_JS), 'themes.js 官方主题应声明 desk 桌面底色');
    const themeCount = (THEMES_JS.match(/id: '/g) || []).length;
    ok(themeCount >= 2, 'themes.js 应至少有两套官方主题');
    eq((THEMES_JS.match(/desk:/g) || []).length, themeCount, '每套官方主题各一份 desk，不得漏配');
    // 云端归一化兜底（含会员专属款）：缺失时回落默认主题的 desk
    ok(/desk:\s*t\.desk\s*\|\|\s*def\.desk/.test(THEME_SVC),
      'services/theme.js 归一化应按 def.desk 兜底，保证绑定永远有值');
    // 拆信幕的 BLANK_THEME 不带 desk：无交接时回落中性色，不提前亮出默认主题氛围
    const DETAIL_JS = read(path.join('pages', 'detail', 'detail.js'));
    const blank = DETAIL_JS.slice(DETAIL_JS.indexOf('BLANK_THEME'));
    ok(blank.indexOf('desk') === -1 || blank.indexOf('desk') > blank.indexOf('};'),
      'BLANK_THEME 不应携带 desk：无交接时不提前亮出任何主题的桌面色');
  });

  test('ab-04 阅读页背景绑定 theme.desk，与拆信幕同源', () => {
    // .page 根节点：行首无缩进的是页面根（内部节点都有缩进），且必须带 statusBarHeight 内联
    const line = DETAIL_WXML.split('\n').find((l) => l.indexOf('<view class="page"') === 0);
    ok(!!line, 'detail.wxml 应有 .page 根节点');
    ok(line.indexOf('statusBarHeight') > -1, '根节点保留 statusBarHeight 内联（顶部安全区）');
    ok(line.indexOf(PAGE_BG) > -1, '阅读页背景应内联绑 theme.desk（#F4F3EE 作兜底，= 历史 --color-base-light）');
  });

  test('ab-05 分享页背景绑定 theme.desk', () => {
    const line = SHARE_WXML.split('\n').find((l) => l.indexOf('<view class="page"') === 0);
    ok(!!line, 'share.wxml 应有 .page 根节点');
    ok(line.indexOf(PAGE_BG) > -1, '分享页背景应内联绑 theme.desk（#F4F3EE 作兜底）');
  });
});
