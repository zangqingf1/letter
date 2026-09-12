// 云函数 feedback —— 问题反馈提交
// action add：只写不读、无跨用户查询；反馈文档含 _openid 与 images（cloud:// fileID 数组）。
// status: 'new' 供开发者后续在 CloudBase 控制台处理。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const CONTENT_MAX = 1000;
// 与前端 pages/feedback/feedback.js 的 CONTACT_MAX 逐一对齐（前端输入框 maxlength 即此值）。
// 服务端兜底口径不宽于前端，否则直调云函数能写入前端从不让填的长度。
const CONTACT_MAX = 40;
const IMAGES_MAX = 9;

// 封禁拦截：后台把 users.status 置为 'banned' 后，本函数与 user 云函数一致拒绝服务。
// 查询失败按「未封禁」处理（可用性优先；封禁属运营管控，不作为数据安全边界）。
async function isBanned(openid) {
  if (!openid) return false;
  try {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
    return !!(res.data[0] && res.data[0].status === 'banned');
  } catch (e) {
    console.error('[ban] users 查询失败，按未封禁处理', e);
    return false;
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action;

  try {
    if (await isBanned(OPENID)) return { ok: false, error: 'banned' };
    switch (action) {
      case 'add': {
        const content = typeof event.content === 'string' ? event.content.trim() : '';
        if (!content) return { ok: false, error: 'content is required' };
        if (content.length > CONTENT_MAX) return { ok: false, error: 'content too long' };

        const contact = typeof event.contact === 'string' ? event.contact.trim() : '';
        if (contact.length > CONTACT_MAX) return { ok: false, error: 'contact too long' };

        // 只接受 cloud:// 开头（前端已先上传云存储换 fileID），防止塞任意字符串/外链。
        // 非法 fileID 与超量都**明确拒绝**：静默丢弃会让调用方误以为全部入库，
        // 且前端已上传到云存储的多余截图会变成无引用残留。
        const raw = Array.isArray(event.images) ? event.images : [];
        const images = raw.filter((f) => typeof f === 'string' && f.indexOf('cloud://') === 0);
        if (images.length !== raw.length) {
          return { ok: false, error: 'invalid image' };
        }
        if (images.length > IMAGES_MAX) {
          return { ok: false, error: 'too many images' };
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
    // 错误详情只进日志：不回传 DB/SDK 原始 message
    console.error('[feedback] action 失败', action, e);
    return { ok: false, error: 'internal error' };
  }
};
