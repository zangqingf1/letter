// 首页演示数据 —— 仅用于前端开发阶段的三个状态预览，接云端后整体替换。
// DEMO_STATE: 'empty'（0 封空态） | 'few'（1–6 封随机倾斜） | 'normal'（≥7 封整齐网格）
const DEMO_STATE = 'normal';

const MOCK_LETTERS = [
  { id: 1, name: '焦虑处理', pinned: true, dateText: '6月12日' },
  { id: 2, name: '关于选择', pinned: true, dateText: '5月3日' },
  { id: 3, name: '职业迷茫', pinned: false, dateText: '4月20日' },
  { id: 4, name: '人际关系', pinned: false, dateText: '3月12日' },
  { id: 5, name: '容貌焦虑', pinned: false, dateText: '3月2日' },
  { id: 6, name: '换工作考虑', pinned: false, dateText: '2月18日' },
  { id: 7, name: '存钱计划', pinned: false, dateText: '1月30日' },
  { id: 8, name: '自我告白', pinned: false, dateText: '1月12日' },
  { id: 9, name: '给失眠的自己', pinned: false, dateText: '去年12月8日' },
  { id: 10, name: '告别拖延', pinned: false, dateText: '去年11月25日' },
  { id: 11, name: '健康作息', pinned: false, dateText: '去年10月14日' },
  { id: 12, name: '理财规划', pinned: false, dateText: '去年9月6日' }
];

const MOCK_DRAFT_COUNT = 2;

module.exports = { MOCK_LETTERS, MOCK_DRAFT_COUNT, DEMO_STATE };
