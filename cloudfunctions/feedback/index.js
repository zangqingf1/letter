// 云函数 feedback —— 问题反馈提交
// action add：只写不读、无跨用户查询；反馈文档含 _openid 与 images（cloud:// fileID 数组）。
// status: 'new' 供开发者后续在 CloudBase 控制台处理。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const CONTENT_MAX = 1000;
const CONTACT_MAX = 60;
const IMAGES_MAX = 9;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action;

  try {
    switch (action) {
      case 'add': {
        const content = typeof event.content === 'string' ? event.content.trim() : '';
        if (!content) return { ok: false, error: 'content is required' };
        if (content.length > CONTENT_MAX) return { ok: false, error: 'content too long' };

        const contact = typeof event.contact === 'string' ? event.contact.trim() : '';
        if (contact.length > CONTACT_MAX) return { ok: false, error: 'contact too long' };

        // 只接受 cloud:// 开头（前端已先上传云存储换 fileID），防止塞任意字符串/外链
        const raw = Array.isArray(event.images) ? event.images : [];
        const images = raw
          .filter((f) => typeof f === 'string' && f.indexOf('cloud://') === 0)
          .slice(0, IMAGES_MAX);
        if (images.length !== Math.min(raw.length, IMAGES_MAX)) {
          return { ok: false, error: 'invalid image' };
        }

        const device = typeof event.device === 'string' ? event.device.slice(0, 120) : '';

        await db.collection('feedback').add({
          data: {
            _openid: OPENID,
            content,
            contact,
            images,
            device,
            status: 'new',
            created_at: db.serverDate()
          }
        });
        return { ok: true };
      }

      default:
        return { ok: false, error: 'unknown action: ' + action };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
