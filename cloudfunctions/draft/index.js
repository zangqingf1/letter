// 云函数 draft —— 云端草稿备份（技术架构文档.md §5.4 三层防线之第二层）
// 多草稿：drafts 集合每条草稿一个文档，云端 _id 即草稿 id；
// 删除（remove/clearAll）为彻底删除，草稿未寄出，不进废纸篓 Recycle 集合。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const MAX_LIST = 50;
// 版本标记：v2 起为多草稿（一草稿一文档）；云端测试返回 ver 可确认部署的是新版
const VER = 2;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();

  try {
    switch (event.action) {
      case 'list': {
        const res = await db.collection('drafts').where({ _openid: OPENID }).limit(MAX_LIST).get();
        const drafts = res.data
          .filter((d) => d.name || d.question || d.answer)
          .map((d) => ({
            id: d._id,
            name: d.name || '',
            question: d.question || '',
            answer: d.answer || '',
            updatedAt: d.updated_at ? new Date(d.updated_at).getTime() : 0
          }))
          .sort((a, b) => b.updatedAt - a.updatedAt);
        return { ok: true, ver: VER, drafts };
      }

      case 'save': {
        const draft = event.draft || {};
        const data = {
          name: draft.name || '',
          question: draft.question || '',
          answer: draft.answer || '',
          updated_at: db.serverDate()
        };
        if (draft.id) {
          // _openid 一并约束：只允许更新本人的草稿文档
          await db.collection('drafts').where({ _openid: OPENID, _id: draft.id }).update({ data });
          return { ok: true, id: draft.id };
        }
        const added = await db
          .collection('drafts')
          .add({ data: Object.assign({ _openid: OPENID }, data) });
        return { ok: true, id: added._id };
      }

      case 'remove': {
        if (event.id) {
          await db.collection('drafts').where({ _openid: OPENID, _id: event.id }).remove();
        }
        return { ok: true };
      }

      case 'clearAll': {
        await db.collection('drafts').where({ _openid: OPENID }).remove();
        return { ok: true };
      }

      default:
        return { ok: false, error: 'unknown action: ' + event.action };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
