'use strict';
/**
 * 分享图「预览即成品」（方案 A）：预览区直接显示生成好的明信片文件本身
 *
 * 为什么值得离线测：改造前预览走 WXML（styles/paper.wxss）、导出走 Canvas
 * （pages/write/paper-specs.js），两套口径必然漂移，且其中四类差异在双渲染器下
 * **补不掉** —— 圆角与投影、字体度量（line-height: normal 的 asc/desc 近似）、
 * 断行禁则（canvas 侧是自实现的 wrapLines）、CSS 渐变与旋转（靠 drawAbsXxx 手绘近似）。
 * 方案 A 的解法不是「把差异补得更小」，而是把第二条渲染路径整个删掉：预览显示的就是
 * 保存/分享出去的那个文件，一致性从「尽量接近」变成结构性保证。
 *
 * 本套件守的就是这条结构，四条契约：
 *   1. 预览在 shot 态渲染 shotSrc 这张图，WXML 版式模板只剩降级分支；
 *   2. 整页只出图一次，预览 / 保存 / 分享共用同一份文件（不再二次绘制）；
 *   3. 出图失败不静默 —— 回落降级预览，保存时真的重试；
 *   4. 骨架高度按成品等比占位，换图时不跳高。
 * 一旦有人把 WXML 预览改回常规路径、或让保存重新出一次图，这里立刻红。
 *
 * 注意：本文件设置全局 wx / Page 供 require 期读取（与 share-canvas.test.js 同一套做法）。
 */
const path = require('path');
const fs = require('fs');
const { suite, test, ok, eq } = require('../runner');

const MINI_ROOT = path.resolve(__dirname, '..', '..', 'miniprogram') + path.sep;
const SHARE = path.join(MINI_ROOT, 'pages', 'share', 'share.js');
const ANALYTICS = path.join(MINI_ROOT, 'services', 'analytics.js');
const read = (rel) => fs.readFileSync(path.join(MINI_ROOT, rel), 'utf8');

// 预览宽 630rpx → 导出宽 1080px 的换算系数（与 share.js 的 K 同源）
const K = 1080 / 630;

// canvas 2d 上下文桩：只做确定性度量，方法集与 share.js 实际调用的 ctx.xxx 一一对应。
// 本套件不校验坐标（那是 share-canvas.test.js 的活），只看「出图几次、出成什么状态」。
function fakeCtx() {
  return {
    font: '16px sans-serif',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    _size() {
      const m = /(\d+(?:\.\d+)?)px/.exec(this.font);
      return m ? parseFloat(m[1]) : 16;
    },
    measureText(s) {
      const size = this._size();
      let w = 0;
      for (const ch of String(s)) w += ch.codePointAt(0) >= 0x2e80 ? size : size * 0.5;
      return { width: w };
    },
    save() {}, restore() {}, translate() {}, rotate() {}, clip() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, rect() {}, arc() {}, arcTo() {},
    setLineDash() {}, stroke() {}, fill() {}, drawImage() {}, clearRect() {},
    createRadialGradient() { return { addColorStop() {} }; },
    fillText() {}, strokeText() {}, fillRect() {}, strokeRect() {}
  };
}

// 埋点服务在云端模式（config/env.js USE_CLOUD=true）下会挂 15s 的攒批定时器，
// 把测试进程一直吊着不退出。本套件不测埋点，直接把模块桩掉。
function stubAnalytics() {
  const id = require.resolve(ANALYTICS);
  require.cache[id] = { id, filename: ANALYTICS, loaded: true, exports: { track() {} } };
}

// 等待若干轮 task，把 actOnShot / ensureShot 的 Promise 链跑完
function tick(n) {
  let p = Promise.resolve();
  for (let i = 0; i < (n || 2); i += 1) p = p.then(() => new Promise((r) => setTimeout(r, 0)));
  return p;
}

const VIEW = {
  name: '留白',
  question: '我为什么总在深夜想明白事情？',
  answer: '因为夜里没有人打扰，判断力回来了。',
  dropChar: '因',
  answerRest: '为夜里没有人打扰，判断力回来了。',
  stubChars: '凭此信·随时重读'.split(''),
  stampText: '09.12',
  yearText: '2026',
  dotDate: '2026.09.12',
  dateLong: '2026年9月12日',
  serial: 'NO.20260912',
  serialNo: '20260912',
  dwgNo: '2026-0912'
};

/** failFirst：让第一次出图失败，用来验证降级与重试 */
function load(opts) {
  const fail = { next: !!(opts && opts.failFirst) };
  const seen = { files: 0, album: 0, shareMenu: [], previews: [], toasts: [] };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => fakeCtx(),
    // 小程序码解码回调：本地路径直接 onload，避免用例挂在图片加载上
    createImage: () => {
      const img = {};
      Object.defineProperty(img, 'src', {
        set() { setTimeout(() => img.onload && img.onload(), 0); }
      });
      return img;
    }
  };
  global.wx = {
    getWindowInfo: () => ({ statusBarHeight: 44 }),
    getStorageSync: () => null,
    setStorageSync() {},
    removeStorageSync() {},
    showToast: (o) => seen.toasts.push(o && o.title),
    showModal() {},
    openSetting() {},
    previewImage: (o) => seen.previews.push(o.urls[0]),
    showShareImageMenu: (o) => seen.shareMenu.push(o.path),
    saveImageToPhotosAlbum: (o) => {
      seen.album += 1;
      if (o.success) o.success();
    },
    // 隐私授权：声明为「不需要授权」，ensure() 直接放行
    getPrivacySetting: (o) => o.success({ needAuthorization: false }),
    requirePrivacyAuthorize: (o) => o.success(),
    createSelectorQuery: () => ({
      select: () => ({ fields: () => ({ exec: (cb) => cb([{ node: canvas }]) }) })
    }),
    canvasToTempFilePath: (o) => {
      if (fail.next) {
        fail.next = false;
        o.fail(new Error('canvas 出图失败'));
        return;
      }
      seen.files += 1;
      o.success({ tempFilePath: '/tmp/share-shot-' + seen.files + '.jpg' });
    }
  };
  stubAnalytics();
  let def = null;
  global.Page = (d) => { def = d; };
  delete require.cache[require.resolve(SHARE)];
  require(SHARE);
  // 页面实例桩：data 拷一份，setData 直接合并（真机行为对本套件的断言足够）
  def.data = JSON.parse(JSON.stringify(def.data));
  def.setData = (patch, cb) => {
    Object.assign(def.data, patch);
    if (cb) cb();
  };
  return { page: def, canvas, seen, fail };
}

/** 填一份真实形状的数据，避免用默认的空信件跑排版 */
function ready(page) {
  page.data.view = Object.assign({}, VIEW);
  page.data.theme = { id: 'xiaowangzi' };
}

suite('分享图预览即成品（方案 A）', () => {
  test('预览在 shot 态渲染生成图本身，WXML 版式模板只剩降级分支', () => {
    const wxml = read(path.join('pages', 'share', 'share.wxml'));
    const shotAt = wxml.indexOf("stage === 'shot'");
    const loadingAt = wxml.indexOf("stage === 'loading'");
    const elseAt = wxml.indexOf('wx:else');
    const tplAt = wxml.indexOf('paper-letter');

    ok(shotAt > -1 && loadingAt > shotAt && elseAt > loadingAt,
      '预览区必须有 shot / loading / else 三态分支');
    ok(wxml.slice(shotAt, loadingAt).indexOf('src="{{shotSrc}}"') > -1,
      'shot 态必须显示 shotSrc 这张图（预览即成品）');
    ok(tplAt > elseAt, 'WXML 版式模板（paper-letter）只能留在降级分支里');
    eq(wxml.indexOf('paper-letter', tplAt + 1), -1, 'paper-letter 只应有一处，不得再有第二条预览路径');
  });

  test('整页只出图一次：预览 / 保存 / 分享共用同一个文件', async () => {
    const { page, seen } = load();
    ready(page);
    const a = await page.ensureShot();
    const b = await page.ensureShot();
    eq(a, b, '重复调用必须复用同一张图，不得重复绘制');
    eq(seen.files, 1, 'canvasToTempFilePath 只应被调用一次');
    eq(page.data.stage, 'shot');
    eq(page.data.shotSrc, a, '预览显示的就是这个文件本身');
  });

  test('骨架高度按成品等比占位（换图时不跳高）', async () => {
    const { page, canvas } = load();
    ready(page);
    await page.ensureShot();
    ok(page.data.shotH > 0, '骨架高度必须在出图前量出来');
    eq(page.data.shotH, Math.round(canvas.height / K),
      '骨架高 = 成品高 ÷ (1080/630)，与预览同宽 630rpx');
  });

  test('出图失败不静默：回落降级预览，保存时会重试', async () => {
    const { page, seen } = load({ failFirst: true });
    ready(page);
    let err = null;
    await page.ensureShot().catch((e) => { err = e; });
    ok(err, '首次出图失败要把错误抛给调用方（否则失败会被吞掉）');
    eq(page.data.stage, 'fallback', '失败要回落降级预览，不能停在骨架上');
    eq(seen.files, 0);

    const file = await page.ensureShot();
    eq(page.data.stage, 'shot');
    eq(seen.files, 1, '失败后再调一次必须真的重试');
    eq(page.data.shotSrc, file);
  });

  test('连点去重：一次点击不触发两遍相册写入 / 分享面板', async () => {
    const { page } = load();
    ready(page);
    let runs = 0;
    page.actOnShot(() => { runs += 1; });
    page.actOnShot(() => { runs += 1; });
    await tick(3);
    eq(runs, 1, '并发的两次点击只应执行一次');

    page.actOnShot(() => { runs += 1; });
    await tick(3);
    eq(runs, 2, '上一次结束后应能再次触发（去重旗标必须复位）');
  });

  test('保存与分享复用预览那张图，不再重新出图', async () => {
    const { page, seen } = load();
    ready(page);
    await page.ensureShot();
    eq(seen.files, 1);

    page.onSend();
    await tick(3);
    eq(seen.shareMenu, [page.data.shotSrc], '分享面板拿到的就是预览显示的同一份文件');
    eq(seen.files, 1, '分享不得再出一次图');

    page.onSave();
    await tick(3);
    eq(seen.album, 1, '授权通过后应写入相册一次');
    eq(seen.files, 1, '保存不得再出一次图');

    page.onPreviewShot();
    eq(seen.previews, [page.data.shotSrc], '点开大图看的也是同一份文件');
  });

  test('已卸载的页面不再 setData（出图是页面级异步）', () => {
    const { page } = load();
    const before = page.data.stage;
    page._destroyed = true;
    page.commit({ stage: 'shot' });
    eq(page.data.stage, before, '页面已卸载时 commit 必须静默丢弃');
  });
});
