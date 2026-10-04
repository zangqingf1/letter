// 反馈服务：问题反馈提交（文字 + 多张截图；联系方式输入框已移除，字段保留兼容旧数据）
// 云端调 feedback 云函数 add，落 feedback 集合（含 _openid、images fileID 数组）；
// 本地演示态写 storage 键 feedback_local（数组，保留最近 MAX_LOCAL 条，截图存本地临时路径）。
const { DATA_SOURCE } = require('../config/env.js');
const cloud = require('./cloud.js');

const FEEDBACK_KEY = 'feedback_local';
const MAX_LOCAL = 20;

// 提交反馈。
// cloud：先把 images（本地临时路径）逐张上传云存储换 fileID，再落 feedback 集合；
// local：直接写 storage。
// 返回 Promise，成功 resolve，失败 reject（由页面 Toast 提示）。
function submit({ content, contact, images, device }) {
  // contact 已不再由前端收集；保留可选入参仅为兼容，未传时按空串落库
  const payload = {
    content: typeof content === 'string' ? content : '',
    contact: typeof contact === 'string' ? contact : '',
    images: Array.isArray(images) ? images : [],
    device: typeof device === 'string' ? device : ''
  };

  if (DATA_SOURCE === 'cloud') {
    const uploads = payload.images.map((p) => cloud.uploadFile(p, 'feedback'));
    return Promise.all(uploads)
      .then((fileIDs) =>
        cloud.call('feedback', 'add', Object.assign({}, payload, { images: fileIDs }))
      );
  }

  const list = wx.getStorageSync(FEEDBACK_KEY) || [];
  list.unshift(Object.assign({}, payload, { created_at: Date.now() }));
  wx.setStorageSync(FEEDBACK_KEY, list.slice(0, MAX_LOCAL));
  return Promise.resolve(true);
}

module.exports = { submit, FEEDBACK_KEY };
