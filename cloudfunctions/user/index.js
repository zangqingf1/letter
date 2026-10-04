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
      // 静默建档：首次 callFunction 时确保 users 存在（不弹任何授权，PRD 第六节）。
      // 若该 openid 已被后台封禁（users.status='banned'），返回 banned 拒绝使用。
      case 'ensure': {
        const res = await db.collection('users').where({ _openid: OPENID }).limit(1).get();
        if (res.data.length) {
          if (res.data[0].status === 'banned') return { ok: false, error: 'banned' };
        } else {
          await db.collection('users').add({
            data: { _openid: OPENID, nickname: '', avatar_url: '', status: 'active', created_at: db.serverDate() }
          });
        }
        return { ok: true };
      }

      case 'getProfile': {
        const res = await db.collection('users').where({ _openid: OPENID }).limit(1).get();
        const u = res.data[0];
        // 后台封禁拦截：小程序端提示并拒绝进入使用
        if (u && u.status === 'banned') return { ok: false, error: 'banned' };
        return {
          ok: true,
          profile: u ? { nickname: u.nickname || '', avatar: u.avatar_url || '', birthday: u.birthday || '' } : null,
          registerDays: u ? daysSince(u.created_at) : 1
        };
      }

      case 'saveProfile': {
        const profile = event.profile || {};
        const data = {};
        // 昵称限长 32：旧版不限长，可写入超长字符串（并展示在后台用户列表）
        if (typeof profile.nickname === 'string') data.nickname = profile.nickname.slice(0, 32);
        // 头像为本地临时文件时由前端先上传云存储并传 fileID
        if (typeof profile.avatar === 'string' && profile.avatar.indexOf('cloud://') === 0) {
          data.avatar_url = profile.avatar;
        }
        // 生日只存「MM-DD」月日，不收出生年份（后续「生日来信」只需月日，也少收一份隐私）。
        // 合法月日写入；空串=清除；未传或非法值一律不动库（保留原值，非法注入不落库）。
        if (typeof profile.birthday === 'string') {
          if (profile.birthday === '' || validBirthday(profile.birthday)) {
            data.birthday = profile.birthday;
          }
        }
        const found = await db.collection('users').where({ _openid: OPENID }).limit(1).get();
        const cur = found.data[0];
        // 封禁用户不得再修改档案（ensure/getProfile 已拒绝，这里补齐写路径）
        if (cur && cur.status === 'banned') return { ok: false, error: 'banned' };
        if (!cur) {
          await db.collection('users').add({
            data: Object.assign({ _openid: OPENID, status: 'active', created_at: db.serverDate() }, data)
          });
        } else {
          await db.collection('users').where({ _openid: OPENID }).update({ data });
        }
        return { ok: true };
      }

      // 注销：物理删除该账号全部数据（PRD 第六节，BR-12 口径），不留软删除副本。
      // members（会员状态）也一并清除，保证「注销 = 清空该 openid 全部数据」的语义。
      // 九个集合互不依赖，并行删除（旧版逐个 await，注销耗时是必要值的近九倍）。
      case 'deactivate': {
        await Promise.all([
          db.collection('letters').where({ _openid: OPENID }).remove(),
          db.collection('open_records').where({ _openid: OPENID }).remove(),
          db.collection('reply_records').where({ _openid: OPENID }).remove(),
          db.collection('drafts').where({ _openid: OPENID }).remove(),
          db.collection('events').where({ _openid: OPENID }).remove(),
          db.collection('members').where({ _openid: OPENID }).remove(),
          db.collection('member_orders').where({ _openid: OPENID }).remove(),
          db.collection('feedback').where({ _openid: OPENID }).remove(),
          db.collection('users').where({ _openid: OPENID }).remove()
        ]);
        return { ok: true };
      }

      default:
        return { ok: false, error: 'unknown action: ' + action };
    }
  } catch (e) {
    // 错误详情只进日志：不回传 DB/SDK 原始 message
    // （'banned' 走各 action 的显式 return，不依赖此处文案）
    console.error('[user] action 失败', action, e);
    return { ok: false, error: 'internal error' };
  }
};

function daysSince(d) {
  if (!d) return 1;
  return Math.max(1, Math.floor((Date.now() - new Date(d).getTime()) / 86400000) + 1);
}

// 生日「MM-DD」合法性：月 01–12；日按月校验，二月恒按 29 天（闰日允许，无年份不判闰）。
function validBirthday(s) {
  if (!/^\d{2}-\d{2}$/.test(s)) return false;
  const month = Number(s.slice(0, 2));
  const day = Number(s.slice(3, 5));
  if (month < 1 || month > 12) return false;
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= maxDay;
}
