// 会员服务（2026-09 会员中心纯 UI 展示）：只提供演示状态与「开通」mock，
// 不接真实微信支付、不产生扣款。真实付费接入后：getMembership 走云端 member 云函数
// （cloud.call('member','get')），subscribe 改云端下单（cloud.call('member','subscribe')），
// 届时需新增 cloudfunctions/member/ 并部署。约定与其它 service 一致：页面不直读 storage 键。
const { DATA_SOURCE } = require('../config/env.js');
const cloud = require('./cloud.js');
const { MOCK_MEMBER } = require('../pages/member/mock.js');

// 仅演示：开通一次后本地保持 vip 态，用于预览（真实支付落地后废弃）
const STATE_KEY = 'member_demo_state';

function getMembership() {
  // 预留云适配：真实付费落地后改为读云端会员状态；本期无论 local/cloud 都返回演示态
  if (DATA_SOURCE === 'cloud' && false) {
    return cloud.call('member', 'get', {}).then((r) => normalize(r));
  }
  const saved = wx.getStorageSync(STATE_KEY);
  const state = saved === 'vip' ? 'vip' : MOCK_MEMBER.state;
  return Promise.resolve(normalize({ state, level: MOCK_MEMBER.level, renew: MOCK_MEMBER.renew }));
}

function normalize(r) {
  return {
    state: (r && r.state) === 'vip' ? 'vip' : 'free',
    level: (r && r.level) || MOCK_MEMBER.level,
    renew: !!(r && r.renew) || MOCK_MEMBER.renew,
    expireDate: (r && r.expireDate) || '',
    planName: (r && r.planName) || ''
  };
}

// 纯 UI 演示开通：仅落本地演示标记（不真实扣款）。真实接入时应改为云端下单并返回支付参数。
function subscribe(plan) {
  wx.setStorageSync(STATE_KEY, 'vip');
  return Promise.resolve({ ok: true, plan: plan || '' });
}

// 注销时清除会员演示标记（避免重新注册后仍是 vip 演示态），供 user 服务 URL 清单复用
function resetDemo() {
  wx.removeStorageSync(STATE_KEY);
}

module.exports = { getMembership, subscribe, resetDemo, STATE_KEY };
