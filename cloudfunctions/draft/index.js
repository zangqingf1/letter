// 云函数 draft —— 云端草稿备份（技术架构文档.md §5.4 三层防线之第二层）
// 多草稿：drafts 集合每条草稿一个文档，云端 _id 即草稿 id；
// 删除（remove/clearAll）为彻底删除，草稿未寄出，不进废纸篓 Recycle 集合。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const MAX_LIST = 50;
// 草稿字段上限：与写信页常量对齐（write.js NAME_MAX/QUESTION_MAX/ANSWER_MAX）。
// 草稿允许部分为空（未写完），故只限类型与长度，不做必填校验。
const NAME_MAX = 20;
const QUESTION_MAX = 500;
const ANSWER_MAX = 2000;
// 版本标记：v2 起为多草稿（一草稿一文档）；云端测试返回 ver 可确认部署的是新版
const VER = 2;

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

  try {
    if (await isBanned(OPENID)) return { ok: false, error: 'banned' };
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
        // 类型兜底 + 上限：旧版直接把任意类型/长度写入（可写入对象、超长文本撑大存储）
        const name = typeof draft.name === 'string' ? draft.name : '';
        const question = typeof draft.question === 'string' ? draft.question : '';
        const answer = typeof draft.answer === 'string' ? draft.answer : '';
        if (name.length > NAME_MAX || question.length > QUESTION_MAX || answer.length > ANSWER_MAX) {
          return { ok: false, error: 'draft too long' };
        }
        const data = {
          name,
          question,
          answer,
          updated_at: db.serverDate()
        };
        if (draft.id) {
          // _openid 一并约束：只允许更新本人的草稿文档。
          // 匹配 0 条（草稿已在其他设备被清/注销）时降级为新增，避免静默"保存成功"实际丢稿
          const updated = await db.collection('drafts').where({ _openid: OPENID, _id: draft.id }).update({ data });
          if (updated.stats && updated.stats.updated === 0) {
            const added = await db
              .collection('drafts')
              .add({ data: Object.assign({ _openid: OPENID }, data) });
            return { ok: true, id: added._id };
          }
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
    // 错误详情只进日志：不回传 DB/SDK 原始 message
    console.error('[draft] 处理失败', e);
    return { ok: false, error: 'internal error' };
  }
};
