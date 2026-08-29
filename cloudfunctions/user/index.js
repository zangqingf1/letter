// 云函数 user —— 用户档案与注销（技术架构文档.md §4.1 / §5.1）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action;

  try {
    switch (action) {
      // 静默建档：首次 callFunction 时确保 users 存在（不弹任何授权，PRD 第六节）
      case 'ensure': {
        const found = await db.collection('users').where({ _openid: OPENID }).count();
        if (found.total === 0) {
          await db.collection('users').add({
            data: { _openid: OPENID, nickname: '', avatar_url: '', status: 'active', created_at: db.serverDate() }
          });
        }
        return { ok: true };
      }

      case 'getProfile': {
        const res = await db.collection('users').where({ _openid: OPENID }).limit(1).get();
        const u = res.data[0];
        return {
          ok: true,
          profile: u ? { nickname: u.nickname || '', avatar: u.avatar_url || '' } : null,
          registerDays: u ? daysSince(u.created_at) : 1
        };
      }

      case 'saveProfile': {
        const profile = event.profile || {};
        const data = {};
        if (typeof profile.nickname === 'string') data.nickname = profile.nickname;
        // 头像为本地临时文件时由前端先上传云存储并传 fileID
        if (typeof profile.avatar === 'string' && profile.avatar.indexOf('cloud://') === 0) {
          data.avatar_url = profile.avatar;
        }
        const found = await db.collection('users').where({ _openid: OPENID }).count();
        if (found.total === 0) {
          await db.collection('users').add({
            data: Object.assign({ _openid: OPENID, status: 'active', created_at: db.serverDate() }, data)
          });
        } else {
          await db.collection('users').where({ _openid: OPENID }).update({ data });
        }
        return { ok: true };
      }

      // 注销：物理删除该账号全部数据（PRD 第六节，BR-12 口径），不留软删除副本
      case 'deactivate': {
        await db.collection('letters').where({ _openid: OPENID }).remove();
        await db.collection('open_records').where({ _openid: OPENID }).remove();
        await db.collection('reply_records').where({ _openid: OPENID }).remove();
        await db.collection('drafts').where({ _openid: OPENID }).remove();
        await db.collection('events').where({ _openid: OPENID }).remove();
        await db.collection('users').where({ _openid: OPENID }).remove();
        return { ok: true };
      }

      default:
        return { ok: false, error: 'unknown action: ' + action };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

function daysSince(d) {
  if (!d) return 1;
  return Math.max(1, Math.floor((Date.now() - new Date(d).getTime()) / 86400000) + 1);
}
