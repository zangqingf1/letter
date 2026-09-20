// 隐私授权服务：小程序《用户隐私保护指引》机制的统一出口
//
// 背景：微信要求调用隐私接口/组件之前，用户须先同意《小程序用户隐私保护指引》，
// 未授权时接口直接失败（errno 112 / "api scope is not declared in the privacy agreement"）。
// 本项目实际用到 4 处隐私能力，与 MP 后台「用户隐私保护指引」的声明项一一对应：
//   · account 页  open-type="chooseAvatar" / type="nickname" → 收集你的微信昵称、头像
//   · feedback 页 wx.chooseMedia / wx.chooseImage           → 收集你选中的照片或视频信息
//   · share 页    wx.saveImageToPhotosAlbum                 → 相册（仅写入）
// 后台漏声明其中任一项，对应功能在真机上就会静默坏掉，所以改动调用点时两边必须同步核对。
//
// 为什么除了 app.js 的启动预检还要有 ensure()：启动时那一次只做「检测」不弹窗（见 precheck），
// 而用户可能中途才拒绝；调用点再兜一次，保证「用户点了按钮一定有反馈」而不是静默失败。
// 低版本基础库（< 2.32.1）没有这套 API，此时微信不做隐私校验，一律放行。

// 本会话内已确认授权就绪，后续调用直接短路，省掉每次的 getPrivacySetting 异步往返
let resolved = false;

function supported() {
  return !!(wx.getPrivacySetting && wx.requirePrivacyAuthorize);
}

// 确保隐私授权就绪。已授权 / 低版本 → resolve(true)；未授权时唤起微信官方隐私弹窗。
// 用户拒绝也 resolve(false) 而不是 reject：由调用点决定提示文案，
// 这里直接吞掉会让用户不明白「点了为什么没反应」。
function ensure() {
  if (resolved || !supported()) return Promise.resolve(true);
  return new Promise((resolve) => {
    wx.getPrivacySetting({
      success: (res) => {
        if (!res.needAuthorization) {
          resolved = true;
          resolve(true);
          return;
        }
        wx.requirePrivacyAuthorize({
          success: () => { resolved = true; resolve(true); },
          fail: () => resolve(false)
        });
      },
      // 查询本身失败（异常）不阻断业务，放行给真正的接口去报错，避免这里造成假死
      fail: () => resolve(true)
    });
  });
}

// 启动预检（app.js onLaunch 调用）：提前问一次「是否需要授权」并把结果缓存下来。
// 刻意**不**主动弹授权框 —— 用户刚进小程序、还没做任何操作就被弹窗打断体验很差；
// 授权弹窗统一放在用户真正点下按钮时（ensure），那时的动机与上下文最清楚。
function precheck() {
  if (!supported()) return;
  wx.getPrivacySetting({
    success: (res) => { if (!res.needAuthorization) resolved = true; },
    fail: () => {}
  });
}

// 打开微信托管的《小程序用户隐私保护指引》（「我的」页隐私政策入口，免自建页面与托管）。
// 注意：小程序未发布上线前还没有「现网版本」的指引，此时打开会失败 ——
// 给一句可理解的提示即可，发布上线后回到后台同步一次就正常了。
function openContract() {
  if (!wx.openPrivacyContract) {
    wx.showToast({ title: '请更新微信后查看', icon: 'none' });
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    wx.openPrivacyContract({
      success: () => resolve(true),
      fail: (err) => {
        console.warn('[privacy] 隐私协议打开失败', err);
        wx.showToast({ title: '隐私政策暂时打不开，请稍后再试', icon: 'none' });
        resolve(false);
      }
    });
  });
}

module.exports = { ensure, precheck, openContract, supported };
