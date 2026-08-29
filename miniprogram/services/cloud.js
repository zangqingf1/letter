// 云函数调用封装（唯一出口，页面禁止直接 wx.cloud 调用 —— 技术架构文档.md §3）
const { CLOUD_ENV } = require('../config/env.js');

let initialized = false;

function ensureInit() {
  if (initialized || !wx.cloud) return;
  wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
  initialized = true;
}

// call('letter', 'create', {...}) → Promise<result>
// 失败向上抛出，由各 service 决定降级策略（首页等列表类接口用缓存兜底，写操作显式 Toast）
function call(name, action, data) {
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

module.exports = { call };

// 上传本地文件到云存储（头像等），成功返回 fileID（云端档案只收 cloud:// 路径）
function uploadFile(filePath) {
  ensureInit();
  const ext = (filePath.match(/\.[a-zA-Z0-9]+$/) || ['.png'])[0];
  const cloudPath = 'avatars/a' + Date.now() + '-' + Math.floor(Math.random() * 10000) + ext;
  return wx.cloud.uploadFile({ cloudPath, filePath }).then((res) => res.fileID);
}

module.exports = { call, uploadFile };
