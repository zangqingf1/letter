// 云函数调用封装（唯一出口，页面禁止直接 wx.cloud 调用 —— 技术架构文档.md §3）
const { CLOUD_ENV } = require('../config/env.js');

let initialized = false;

function ensureInit() {
  if (initialized || !wx.cloud) return;
  wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
  initialized = true;
}

// call('letter', 'create', {...}) → Promise<result>
// 失败向上抛出，由各 service 决定降级策略（首页等列表类接口用缓存兜底，写操作显式 Toast）。
// 必须始终返回 Promise：若未初始化（无 wx.cloud）也会以拒绝态抛出，否则同步 throw 会绕过
// 调用方的 .catch，导致写操作（删除/回信/回形针等）静默无响应、无任何 Toast。
function call(name, action, data) {
  if (!wx.cloud) {
    return Promise.reject(new Error(name + '.' + action + ': cloud 未初始化'));
  }
  ensureInit();
  return wx.cloud
    .callFunction({ name, data: Object.assign({ action: action }, data || {}) })
    .then((res) => {
      const result = res.result;
      // 云函数统一返回 { ok, error }：ok=false 必须转成真正的 Promise 拒绝，
      // 否则上游会把失败当成功、拿空数据静默渲染（首页信匣曾因此整页空白无提示）
      if (result && result.ok === false) {
        return Promise.reject(new Error(name + '.' + action + ': ' + (result.error || 'unknown error')));
      }
      return result;
    });
}

// 上传本地文件到云存储（头像、问题反馈截图等），成功返回 fileID（云端档案只收 cloud:// 路径）。
// dir 指定云存储子目录（默认 'avatars' 头像；反馈截图传 'feedback'），默认值保持既有调用不变。
// 与 call() 一致：未初始化时也以拒绝态返回，保证调用方的 .catch 能拿到反馈。
function uploadFile(filePath, dir) {
  if (!wx.cloud) {
    return Promise.reject(new Error('cloud 未初始化'));
  }
  ensureInit();
  const folder = (typeof dir === 'string' && dir) ? dir : 'avatars';
  const ext = (filePath.match(/\.[a-zA-Z0-9]+$/) || ['.png'])[0];
  const cloudPath = folder + '/f' + Date.now() + '-' + Math.floor(Math.random() * 10000) + ext;
  return wx.cloud.uploadFile({ cloudPath, filePath }).then((res) => res.fileID);
}

// 云存储文件下载为本地临时路径（fileID → tempFilePath）。
// <image> 组件可直接渲染 cloud:// fileID，但离屏 Canvas 的 createImage() 需要
// 本地/网络路径 —— 分享图导出等场景先经此中转。
function downloadFile(fileID) {
  if (!wx.cloud) {
    return Promise.reject(new Error('cloud 未初始化'));
  }
  ensureInit();
  return wx.cloud.downloadFile({ fileID }).then((res) => res.tempFilePath);
}

module.exports = { call, uploadFile, downloadFile };
