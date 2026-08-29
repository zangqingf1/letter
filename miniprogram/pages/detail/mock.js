// 03 详情页演示数据 —— 仅用于前端开发阶段预览「03 · 信件详情 / 拆信阅读 / 回信」的多个状态，接云端后整体替换。
// DEMO_STATE: 'multi'（多次拆开：邮戳墙 + 多条回信 + 回形针点亮） | 'first'（首次拆开：仅今日 1 枚邮戳、0 条回信）
// 进入详情页时会按 BR-09 自动补一条「今天」的重读记录，因此 multi 预置 11 条历史邮戳 + 今天 = 12 次。
const DEMO_STATE = 'multi';

function ts(y, m, d) {
  return new Date(y, m - 1, d, 9, 30).getTime();
}
const Y = new Date().getFullYear();

const DEMO_LETTERS = {
  multi: {
    id: 'demo-multi',
    name: '给失眠时的自己',
    question: '深夜脑子停不下来，一直在焦虑明年的职业发展，完全睡不着。',
    answer: '未来的焦虑解决不了现在的问题。既然尽力了，就先把今天过好，睡觉也是一种能力。',
    theme_id: 'xiaowangzi',
    theme_version: 1,
    pinned: true,
    created_at: ts(Y, 3, 12),
    updated_at: ts(Y, 6, 1),
    opens: [
      ts(Y, 3, 12), ts(Y, 3, 15), ts(Y, 4, 2), ts(Y, 5, 18), ts(Y, 6, 1),
      ts(Y, 6, 20), ts(Y, 7, 3), ts(Y, 7, 15), ts(Y, 8, 2), ts(Y, 8, 10), ts(Y, 8, 20)
    ],
    replies: [
      { ts: ts(Y, 5, 18), text: '今天又失眠了，重新读了这封信，心情平复了很多。真的，睡觉也是一种能力。' },
      { ts: ts(Y, 8, 2), text: '答应了新 offer 反而更踏实，原来最坏的结果并没有那么可怕。' }
    ]
  },
  first: {
    id: 'demo-first',
    name: '关于职业选择的迷茫',
    question: '我不确定要不要跨行，怕试错成本太高。',
    answer: '不试试，我会一直想。最坏的结果，也比停在原地好。',
    theme_id: 'xiaowangzi',
    theme_version: 1,
    pinned: false,
    created_at: ts(Y, 8, 1),
    opens: [],
    replies: []
  }
};

module.exports = { DEMO_LETTERS, DEMO_STATE };
