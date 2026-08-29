// 05 废纸篓演示数据 —— 仅用于前端开发阶段预览两个状态，接云端后整体替换。
// DEMO_STATE: 'full'（有内容态：普通弃置 + 临近删除强调） | 'empty'（空状态）
// deleted_at 按当前时间倒推，保证演示出「还有 22 天」与「还有 3 天」两种剩余天数。
const DEMO_STATE = 'full';

const DAY = 24 * 60 * 60 * 1000;

const DEMO_ITEMS = [
  {
    id: 'demo-r1',
    name: '关于职业选择的迷茫',
    theme_id: 'xiaowangzi',
    theme_version: 1,
    pinned: false,
    created_at: Date.now() - 40 * DAY,
    deleted_at: Date.now() - 8 * DAY // 剩余 22 天，普通弃置态
  },
  {
    id: 'demo-r2',
    name: '给失眠时的自己',
    theme_id: 'xiaowangzi',
    theme_version: 1,
    pinned: true,
    created_at: Date.now() - 80 * DAY,
    deleted_at: Date.now() - 27 * DAY // 剩余 3 天，临近删除强调态
  }
];

module.exports = { DEMO_ITEMS, DEMO_STATE };
