const { DATA_SOURCE, CLOUD_ENV } = require('./config/env.js');
const userService = require('./services/user.js');

App({
  onLaunch() {
    // 心灵信箱：首次进入不强制登录（PRD 第六节）
    if (DATA_SOURCE === 'cloud' && wx.cloud) {
      wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
      // 静默建档：首次调用时确保 users 档案存在（无授权弹窗，授权固定在寄出时触发）
      const ready = wx.cloud
        .callFunction({ name: 'user', data: { action: 'ensure' } })
        .catch(() => { /* 建档失败不阻塞启动，寄出/保存时还会重试 */ });
      // 「我的」页数据预热（静默）：stats 云函数只被「我的」页调用，常年冷启动，
      // 不预热则冷启动后首次切到「我的」要空等 1~3s。建档完成后并行拉资料与统计，
      // 等用户切 Tab 时缓存已就绪，首屏同步渲染（详见 services/user.js 的 prefetch）
      ready.then(() => userService.prefetch());
    }
  }
});
