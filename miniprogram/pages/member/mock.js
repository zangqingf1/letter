// 会员中心演示数据 —— 仅前端开发阶段用。本页为纯 UI 展示（不接真实微信支付、无云函数）。
// state: 'free'（未开通）/'vip'（已开通演示态）。页面可通过 member 服务的演示标记
// 「开通一次」在本地翻成 vip 态，用于预览；真实支付落地后本文件废弃。
const MOCK_MEMBER = {
  state: 'free',
  level: '守候',     // vip 态等级称号（按累计时长分档：寄字 / 守候 / 长情）
  renew: true        // 自动续费
};

module.exports = { MOCK_MEMBER };
