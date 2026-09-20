// 页面间同步交接槽（纯内存，不落盘、不发云调用）
//
// 为什么需要它：navigateTo 的时序是
//   「目标页 onLoad → 目标页 onShow → **目标页首帧渲染** → 源页 success 回调」
// 事件通道的 emit 写在 success 里，因此**必然晚于目标页首帧**；凡是「目标页首帧就要画对」
// 的数据都不能走事件通道（详情页拆信动画的信封与名字正是这种情况：晚一步 setData，
// 首帧就已经把默认款画上去了，见 pages/detail/detail.js 的 BLANK_THEME 注释）。
// 这里改在跳转**之前**写入交接槽，目标页 onLoad 同步取用，首帧即正确、零等待。
//
// 存在 App.globalData 而非模块级变量：作用域与小程序实例一致，冷启动天然清空，
// 也不会像 storage 那样落盘后残留。take() 取用即清并校验 id —— 只服务「刚刚被点开的
// 那封信」，不留给之后任何一次直开本页的情形。
function store() {
  if (typeof getApp !== 'function') return null;
  const app = getApp();
  return (app && app.globalData) || null;
}

// 跳转前写入（入口页）：hint 形如 { id, name, theme }
function put(hint) {
  const g = store();
  if (g) g.unsealHint = hint;
}

// 目标页 onLoad 同步取出（详情页）：id 不匹配或已被消费返回 null，调用方自行兜底
function take(id) {
  const g = store();
  if (!g || !g.unsealHint) return null;
  const hint = g.unsealHint;
  g.unsealHint = null;
  return String(hint.id) === String(id) ? hint : null;
}

module.exports = { put, take };
