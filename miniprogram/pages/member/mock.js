// 会员中心演示数据 —— 仅前端开发阶段用。本页已接入真实虚拟支付（个人·道具直购），
// 云端优先读 member 云函数（members 集合）；云函数未部署/未配置时回落本地演示态（本文件）。
// state: 'free'（未开通）/'vip'（已开通演示态）。页面可通过 member 服务的演示标记
// 「开通一次」在本地翻成 vip 态，用于预览；真实支付落地后本文件仅作兜底。
const MOCK_MEMBER = {
  state: 'free',
  level: '守候',     // vip 态等级称号（按累计时长分档：寄字 / 守候 / 长情）
  renew: false       // 道具直购为一次性购买，无自动续费
};

module.exports = { MOCK_MEMBER };
