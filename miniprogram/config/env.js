// 环境与数据源切换（技术架构文档.md §3 / §9）
// DATA_SOURCE：
//   'local' —— 本地演示态（storage 键 letters_mock 等 + pages/*/mock.js），云端部署前的默认值
//   'cloud' —— 微信云开发（需先在开发者工具开通云开发环境、部署 cloudfunctions/ 并把
//              CLOUD_ENV 填为真实环境 ID；架构文档 §10 M1）
const USE_CLOUD = true;             // 云端联调开关：云函数已部署（2026-08）
const CLOUD_ENV = 'cloudbase-d1gp46d6he3bbf9f0';

let dataSource = USE_CLOUD ? 'cloud' : 'local';
if (dataSource === 'cloud' && !CLOUD_ENV) dataSource = 'local';

module.exports = { DATA_SOURCE: dataSource, CLOUD_ENV };
