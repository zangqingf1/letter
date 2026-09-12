// 环境与数据源切换（技术架构文档.md §3 / §9）
// DATA_SOURCE：
//   'cloud' —— 微信云开发（当前默认：云函数已部署、CLOUD_ENV 已填真实环境 ID）
//   'local' —— 本地演示态（storage 键 letters_mock 等 + pages/*/mock.js），
//              把 USE_CLOUD 置 false（或清空 CLOUD_ENV）即回落，用于离线开发
const USE_CLOUD = true;             // 云端联调开关：云函数已部署（2026-08）
const CLOUD_ENV = 'cloudbase-d1gp46d6he3bbf9f0';

let dataSource = USE_CLOUD ? 'cloud' : 'local';
if (dataSource === 'cloud' && !CLOUD_ENV) dataSource = 'local';

module.exports = { DATA_SOURCE: dataSource, CLOUD_ENV };
