'use strict';
/**
 * 写信第二步 · 体验会员专属款标识（2026-09-20 体验会员配套）。
 *
 * 为什么值得离线测：体验会员在服务端按 vip 态放行专属款（isVip=true，🔒 永不亮），
 * 如果 wxml/JS 忘了铺「体验」标识，体验用户看到的专属款与正式会员一模一样 ——
 * 「到期会收回」这件事完全不可感知，转化引导就断了。这里用静态结构断言守住三处：
 *   1) 预览纸右上角「体验」角标分支必须存在、且排在 🔒 之前（体验会员是 vip，
 *      依赖 lock 分支永远轮不到它）；
 *   2) 信封名不带任何（限免）/（体验）后缀 —— 标识统一走右上角胶囊角标，
 *      信封卡片要有 .tc-trial 体验角标（顺序 限免 → 体验 → 🔒）；
 *   3) step2.js 两处会员态 setData 都必须透传 trial（漏一处就会出现「半个页面知道」）。
 * 免费尝鲜款（freeTrial）永久免费，任何情况下都不挂「体验」标识 —— 条件里必须排除。
 */
const fs = require('fs');
const path = require('path');
const { suite, test, ok } = require('../runner');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, 'miniprogram', p), 'utf8');
const WXML = read(path.join('pages', 'write', 'step2.wxml'));
const WXSS = read(path.join('pages', 'write', 'step2.wxss'));
const JS = read(path.join('pages', 'write', 'step2.js'));

// 角标三分支的先后：免费尝鲜 → 体验 → 🔒（wx:elif 链按出现顺序命中）
function badgeOrder(region) {
  const cut = (marker) => {
    const i = region.indexOf(marker);
    return i === -1 ? Infinity : i;
  };
  return [cut('class="pv-free"'), cut('class="pv-trial"'), cut('class="pv-lock"')];
}

suite('写信第二步 · 体验会员专属款标识', () => {
  test('tb-01 预览纸角标：限免/体验/🔒 三分支有序，条件互斥', () => {
    const preview = WXML.slice(WXML.indexOf('preview-swiper'), WXML.indexOf('paper-ind'));
    ok(/class="pv-free">限免</.test(preview), '免费尝鲜款角标文案必须是「限免」');
    ok(preview.indexOf('class="pv-trial"') > -1, '预览纸应有 .pv-trial 体验角标节点');
    const [free, trial, lock] = badgeOrder(preview);
    ok(free < trial && trial < lock, '角标顺序必须为 限免 → 体验 → 🔒（体验会员是 vip，🔒 永不命中）');
    const trialLine = WXML.split('\n').find((l) => l.indexOf('pv-trial') > -1);
    ok(trialLine.indexOf('trial') > -1 && trialLine.indexOf('item.premium') > -1,
      '体验角标条件必须同时看 trial 与 item.premium');
    ok(trialLine.indexOf('!item.freeTrial') > -1, '免费尝鲜款永久免费，不得挂「体验」标识');
    ok(/\.pv-trial\s*\{/.test(WXSS), 'wxss 应有 .pv-trial 样式（胶囊角标）');
  });

  test('tb-02 信封标识统一走右上角角标：名称不带限免/体验后缀，卡片有体验胶囊', () => {
    // 名称一律干净：卡片名与顶部当前信封名都不得再拼（限免）/（体验）后缀
    const tcLine = WXML.split('\n').find((l) => l.indexOf('class="tc-name"') > -1);
    ok(!!tcLine, '主题卡片应有 tc-name 节点');
    ok(tcLine.indexOf('{{item.name}}') > -1, '信封卡片名只渲染 item.name 本身');
    ok(tcLine.indexOf('（限免）') === -1 && tcLine.indexOf('（体验）') === -1,
      '信封卡片名不得带（限免）/（体验）后缀（标识统一走右上角角标）');
    const labelLine = WXML.split('\n').find((l) => l.indexOf('theme-label') > -1);
    ok(!!labelLine && labelLine.indexOf('currentTheme.name}}') > -1
      && labelLine.indexOf('（限免）') === -1 && labelLine.indexOf('（体验）') === -1,
      '顶部当前信封名同样不得带（限免）/（体验）后缀');
    // 卡片角标三分支：限免 → 体验 → 🔒（wx:elif 链按出现顺序命中；freeTrial 在前已短路）
    const cardRegion = WXML.slice(WXML.indexOf('class="theme-row"'), WXML.indexOf('</scroll-view>'));
    ok(cardRegion.indexOf('class="tc-free"') > -1 && cardRegion.indexOf('限免') > -1,
      '主题卡片限免角标文案为「限免」');
    ok(cardRegion.indexOf('class="tc-trial"') > -1, '主题卡片应有 .tc-trial 体验角标节点');
    const trialCardLine = WXML.split('\n').find((l) => l.indexOf('tc-trial') > -1);
    ok(trialCardLine.indexOf('trial') > -1 && trialCardLine.indexOf('item.premium') > -1,
      '体验角标条件必须同时看 trial 与 item.premium');
    const tcOrder = ['class="tc-free"', 'class="tc-trial"', 'class="tc-lock"'].map((m) => {
      const i = cardRegion.indexOf(m);
      return i === -1 ? Infinity : i;
    });
    ok(tcOrder[0] < tcOrder[1] && tcOrder[1] < tcOrder[2],
      '卡片角标顺序必须为 限免 → 体验 → 🔒（freeTrial 在前已短路，天然排除限免款）');
    ok(/\.tc-trial\s*\{/.test(WXSS), 'wxss 应有 .tc-trial 样式（胶囊角标）');
  });

  test('tb-03 会员态落库：isVip 与 trial 必须成对出现（onLoad 回源 + onShow 刷新）', () => {
    // 两处落库形态不同：onLoad 先构造 update 对象再 setData，onShow 直接 setData —— 都按行抓
    const lines = JS.split('\n').filter((l) =>
      l.indexOf('isVip') > -1 && (l.indexOf('setData') > -1 || l.indexOf('const update') > -1));
    ok(lines.length >= 2, 'step2.js 应有两处会员态落库（onLoad 回源 update + onShow setData），实际 ' + lines.length + ' 处');
    for (const l of lines) {
      ok(l.indexOf('trial') > -1, '会员态落库必须同时透传 trial：' + l.trim().slice(0, 80));
    }
  });
});
