'use strict';
/**
 * 隐私授权（miniprogram/services/privacy.js）：授权时机、拒绝兜底、缓存短路、隐私政策入口
 *
 * 为什么值得离线测：这一块全是「时序 + 分支」，不是数据逻辑 ——
 * 弹窗时机错（启动就弹）只是体验问题，手测里很难量化；用户拒绝后不 resolve(false)
 * 会让按钮**静默无反应**，而这在开发者工具的「已授权」环境里永远复现不出来；
 * precheck 若不短路，每次换头像都要多一轮异步往返。这些契约只有桩掉 API 才测得到。
 *
 * 与 MP 后台的对应关系：ensure() 的三个调用点必须与后台《用户隐私保护指引》的声明项
 * 一一对应（收集微信昵称头像 / 收集选中的照片或视频信息 / 相册·仅写入），漏一项对应功能
 * 在真机上直接 fail（errno 112）。本文件只守代码侧，后台侧靠「测试流程.md」§5.11 PV-09。
 */
const path = require('path');
const fs = require('fs');
const { suite, test, eq, ok } = require('../runner');

const MINI_ROOT = path.resolve(__dirname, '..', '..', 'miniprogram');
const SERVICE = path.join(MINI_ROOT, 'services', 'privacy.js');
const read = (rel) => fs.readFileSync(path.join(MINI_ROOT, rel), 'utf8');

/**
 * 每个用例一套全新的模块态：privacy.js 的 resolved 是模块级变量，不重建就会串味。
 * makeStub(seen) 返回该用例要装的 wx 桩；showToast / showModal 任何基础库都有，始终提供。
 */
function load(makeStub) {
  delete require.cache[require.resolve(SERVICE)];
  const seen = { toast: [], modal: [], calls: [] };
  global.wx = Object.assign({
    showToast: (o) => seen.toast.push(o && o.title),
    showModal: (o) => seen.modal.push(o && o.title)
  }, makeStub ? makeStub(seen) : {});
  return { service: require(SERVICE), seen };
}

// 「已授权」：getPrivacySetting 说不需要授权
const granted = (seen) => ({
  getPrivacySetting: (o) => { seen.calls.push('get'); o.success({ needAuthorization: false }); },
  requirePrivacyAuthorize: (o) => { seen.calls.push('req'); o.success(); }
});

// 「需授权」：allow 决定用户在弹窗里点是还是否
const needing = (seen, allow) => ({
  getPrivacySetting: (o) => { seen.calls.push('get'); o.success({ needAuthorization: true }); },
  requirePrivacyAuthorize: (o) => {
    seen.calls.push('req');
    if (allow) o.success(); else o.fail({ errMsg: 'privacy auth deny' });
  }
});

suite('隐私授权 · services/privacy.js', () => {

  test('低版本基础库（无隐私 API）：一律放行，不阻断业务', async () => {
    const { service } = load();
    eq(service.supported(), false, '没有 getPrivacySetting/requirePrivacyAuthorize 时应视为不支持');
    eq(await service.ensure(), true, '微信此时不做隐私校验，应直接放行而不是卡住');
  });

  test('已授权：ensure 放行，且不再唤起授权框', async () => {
    const { service, seen } = load(granted);
    eq(await service.ensure(), true);
    ok(seen.calls.indexOf('req') === -1, '已授权时不应再弹授权框');
  });

  test('已授权后短路：后续调用零接口开销', async () => {
    const { service, seen } = load(granted);
    await service.ensure();
    const n = seen.calls.length;
    await service.ensure();
    await service.ensure();
    eq(seen.calls.length, n, '授权已就绪后不应再重复查询');
  });

  test('需授权 · 用户同意：唤起官方授权框后放行', async () => {
    const { service, seen } = load((s) => needing(s, true));
    eq(await service.ensure(), true);
    ok(seen.calls.indexOf('req') > -1, '未授权时应唤起微信官方隐私弹窗');
  });

  test('需授权 · 用户拒绝：resolve(false) 而不是 reject', async () => {
    const { service } = load((s) => needing(s, false));
    let threw = false;
    let value = null;
    try { value = await service.ensure(); } catch (e) { threw = true; }
    ok(!threw, '抛错会让调用点的 .then 不执行，表现为「点了没反应」');
    eq(value, false, '应用 false 把提示文案的决定权交给调用点');
  });

  test('查询本身失败：不阻断业务，放行给真正的接口去报错', async () => {
    const { service } = load(() => ({
      getPrivacySetting: (o) => o.fail({ errMsg: 'boom' }),
      requirePrivacyAuthorize: (o) => o.success()
    }));
    eq(await service.ensure(), true, '查询失败若不放行，会造成所有隐私功能假死');
  });

  test('precheck：只检测，绝不主动弹窗（不在用户还没操作时打断）', async () => {
    const { service, seen } = load((s) => needing(s, true));
    service.precheck();
    await new Promise((r) => setTimeout(r));
    ok(seen.calls.indexOf('get') > -1, 'precheck 应发起一次检测');
    ok(seen.calls.indexOf('req') === -1, 'precheck 不应主动弹授权框');
  });

  test('precheck 命中已授权：后续 ensure 短路，零开销', async () => {
    const { service, seen } = load(granted);
    service.precheck();
    await new Promise((r) => setTimeout(r));
    const n = seen.calls.length;
    await service.ensure();
    eq(seen.calls.length, n, 'precheck 已缓存授权态时，ensure 不应再发请求');
  });

  test('隐私政策入口：打开成功，且不误报提示', async () => {
    const { service, seen } = load(() => ({ openPrivacyContract: (o) => o.success() }));
    eq(await service.openContract(), true);
    eq(seen.toast.length, 0, '成功时不应弹提示');
  });

  test('隐私政策入口：打开失败给用户可理解的提示', async () => {
    const { service, seen } = load(() => ({ openPrivacyContract: (o) => o.fail({ errMsg: 'no contract' }) }));
    eq(await service.openContract(), false);
    ok(seen.toast.length > 0, '未发布上线的小程序没有现网版指引，必须给提示而不是静默失败');
  });

  test('隐私政策入口：低版本无 openPrivacyContract 时提示升级微信', async () => {
    const { service, seen } = load();
    eq(await service.openContract(), false);
    ok(seen.toast.length > 0, '应提示用户升级微信，而不是点了没反应');
  });
});

suite('隐私授权 · 调用点契约（静态）', () => {

  test('app.js 启动预检已接入', () => {
    const src = read('app.js');
    ok(/privacyService\.precheck\(\)/.test(src), 'app.js onLaunch 应调用 privacyService.precheck()');
  });

  test('三个隐私调用点都接了 ensure（与后台声明项一一对应）', () => {
    const points = [
      ['pages/account/account.js', '头像 open-type=chooseAvatar / 昵称 type=nickname'],
      ['pages/feedback/feedback.js', '选图 wx.chooseMedia / wx.chooseImage'],
      ['pages/share/share.js', '写相册 wx.saveImageToPhotosAlbum']
    ];
    for (const [file, what] of points) {
      ok(/privacyService\.ensure\(\)/.test(read(file)),
        file + ' 未接入 ensure（' + what + '），真机上会在未授权时直接 fail');
    }
  });

  test('账号页在 onLoad 就完成授权检查（原生按钮拦不住点击）', () => {
    const src = read('pages/account/account.js');
    // 结束标记要用定义处 'loadProfile() {'，不能用 'loadProfile()' ——
    // onLoad 内部先调了一次 this.loadProfile()，后者会提前截断切片
    const onLoad = src.slice(src.indexOf('onLoad()'), src.indexOf('loadProfile() {'));
    ok(/privacyService\.ensure\(\)/.test(onLoad),
      'open-type="chooseAvatar" 的点击无法拦截，只能在进页面时先把授权消化掉');
  });

  test('保存相册的授权检查在 Canvas 导出之前（未授权不白导一次图）', () => {
    const src = read('pages/share/share.js');
    const onSave = src.slice(src.indexOf('onSave() {'), src.indexOf('savePostcard() {'));
    ok(/privacyService\.ensure\(\)/.test(onSave), 'onSave 应先做授权检查');
    ok(onSave.indexOf('this.savePostcard()') > -1, 'onSave 应把导出委托给 savePostcard');
    ok(onSave.indexOf('this.exportPostcard()') === -1,
      '导出不应留在 onSave 内联执行，否则未授权时会白等一次 Canvas 渲染');
  });

  test('反馈页选图前先 ensure，通过后才拉起选择器', () => {
    const src = read('pages/feedback/feedback.js');
    const onAddShot = src.slice(src.indexOf('onAddShot() {'), src.indexOf('pickShots(remain) {'));
    ok(/privacyService\.ensure\(\)/.test(onAddShot), 'onAddShot 应先做授权检查');
    ok(onAddShot.indexOf('this.pickShots(') > -1, '授权通过后才应委托 pickShots');
  });

  test('「我的」页已按产品决定移除隐私政策入口（2026-09）', () => {
    // privacy.js 的 openContract() 仍保留（微信托管指引的打开能力），只是不再有任何页面挂入口
    const js = read('pages/mine/mine.js');
    ok(!/onTapPrivacy/.test(js) && !/openContract/.test(js),
      'mine.js 不应再有 onTapPrivacy / openContract 调用');
    ok(!/onTapPrivacy|隐私政策/.test(read('pages/mine/mine.wxml')),
      'mine.wxml 不应再有隐私政策入口行');
  });

  test('隐私服务不落 storage、不调云函数（授权是设备侧事实）', () => {
    const src = read('services/privacy.js');
    ok(!/wx\.setStorage|wx\.getStorage/.test(src), '隐私授权态不应落 storage');
    ok(!/cloud\.call|wx\.cloud/.test(src), '隐私授权不涉及云端，不应有云调用');
  });
});
