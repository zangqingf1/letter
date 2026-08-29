// 埋点服务（技术架构文档.md §7）
// 事件名严格以 PRD 第十三节为准（letter_preview 已删除，letter_step2_view 替代）；
// 新增事件先改 PRD 再上码。埋点不采集信件正文，props 仅含元数据。
const { DATA_SOURCE } = require('../config/env.js');
const cloud = require('./cloud.js');

const FLUSH_SIZE = 5;      // 攒批条数
const FLUSH_INTERVAL = 15 * 1000;
const MAX_RETRY = 3;

let queue = [];
let timer = null;

function track(event, data) {
  if (DATA_SOURCE !== 'cloud') {
    // 本地演示态保持现状：仅控制台输出，便于开发期观察
    console.log('[track]', event, data || '');
    return;
  }
  queue.push({ name: event, props: data || {}, client_ts: Date.now() });
  if (queue.length >= FLUSH_SIZE) {
    flush();
    return;
  }
  if (!timer) {
    timer = setTimeout(flush, FLUSH_INTERVAL);
  }
}

function flush(retry) {
  const attempt = retry || 0;
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  cloud
    .call('analytics', 'batch', { events: batch })
    .catch(() => {
      // 失败静默：塞回队首有限次重试，绝不影响主流程、不弹提示
      if (attempt < MAX_RETRY) {
        queue = batch.concat(queue);
        setTimeout(() => flush(attempt + 1), 3000);
      }
    });
}

module.exports = { track };
