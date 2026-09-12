// 「我的」页演示数据 —— 仅用于前端开发阶段，接云端后整体替换。
// 统计口径见 PRD 第八节（信件总数 / 被重读总次数 / 回信条数 / 注册天数）。
const MOCK_USER = {
  nickname: '林深见鹿',
  avatar: '', // 为空时以昵称首字渲染圆形名片头像
  wroteDays: 128
};

const MOCK_STATS = {
  letterTotal: 12,
  rereadTotal: 38,
  replyTotal: 5,
  registerDays: 128
};

const MOCK_RECYCLE_COUNT = 1;

module.exports = { MOCK_USER, MOCK_STATS, MOCK_RECYCLE_COUNT };
