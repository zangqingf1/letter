// 云函数 draft —— 云端草稿备份（技术架构文档.md §5.4 三层防线之第二层）
// 第一版每用户一条进行中草稿（PRD 第十五节第 7 条）；本地与云端以 updated_at 新者为准。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();

  try {
    switch (event.action) {
      case 'get': {
        const res = await db.collection('drafts').where({ _openid: OPENID }).limit(1).get();
        const d = res.data[0];
        return {
          ok: true,
          draft: d
            ? {
                name: d.name || '',
                question: d.question || '',
                answer: d.answer || '',
                letterId: d.letter_id || '',
                updatedAt: d.updated_at ? new Date(d.updated_at).getTime() : 0
              }
            : null
        };
      }

      case 'save': {
        const draft = event.draft || {};
        const data = {
          name: draft.name || '',
          question: draft.question || '',
          answer: draft.answer || '',
          letter_id: draft.letterId || '',
          updated_at: db.serverDate()
        };
        const found = await db.collection('drafts').where({ _openid: OPENID }).count();
        if (found.total === 0) {
          await db.collection('drafts').add({ data: Object.assign({ _openid: OPENID }, data) });
        } else {
          // 本地较新时不覆盖（新者为准，架构文档 §5.4）
          const cur = await db.collection('drafts').where({ _openid: OPENID }).limit(1).get();
          const curTime = cur.data[0] && cur.data[0].updated_at ? new Date(cur.data[0].updated_at).getTime() : 0;
          if (!draft.updatedAt || draft.updatedAt >= curTime) {
            await db.collection('drafts').where({ _openid: OPENID }).update({ data });
          }
        }
        return { ok: true };
      }

      case 'clear': {
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
