// 批量把官方主题的 assets.envelope 改为云存储 fileID（大图下沉云存储 第 2 步）。
//
// 前置：14 张大图已上传云存储 theme/<id>/envelope.jpg（见 output/大图下沉云存储-执行清单.md）。
// 用法：在能拿到后台密钥的终端里运行（密钥不落盘，与 admin 后台同源手工管理）：
//   HB_KEY=<你的后台密钥> node output/batch-envelope-cloudid.mjs
//
// 安全性：themeSave 是整条覆盖（upsert），脚本先 themeList 取全量、只改 assets.envelope
// 一个字段后原样回写，不动其它字段；带 --dry-run 只打印不改库。
const API = 'https://cloudbase-d1gp46d6he3bbf9f0-1477338373.ap-shanghai.app.tcloudbase.com/admin';
const ENV_PREFIX = 'cloud://cloudbase-d1gp46d6he3bbf9f0.636c-cloudbase-d1gp46d6he3bbf9f0-1477338373';

// 待迁移的 14 套（yinhua 的素材本就在云存储，不在清单内，勿动）
const IDS = [
  'cuican', 'daoying', 'dielianhuajian', 'gonglu', 'huajianxinjian',
  'luori', 'meiguixingyun', 'niuyouguo', 'shanye', 'suiyuejinjian',
  'tiantan', 'xiaowangzi', 'xiarihangxian', 'yinranqingshu'
];

const dryRun = process.argv.includes('--dry-run');
const key = process.env.HB_KEY;
if (!key) {
  console.error('缺少 HB_KEY 环境变量（后台密钥，与 admin 后台浏览器里同源）');
  process.exit(1);
}

async function call(action, extra) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(Object.assign({ action, key }, extra || {}))
  });
  return res.json();
}

const list = await call('themeList');
if (!list.ok) {
  console.error('themeList 失败：', list.error);
  process.exit(1);
}
const byId = {};
for (const t of list.themes || []) byId[t.theme_id] = t;

let updated = 0;
for (const id of IDS) {
  const t = byId[id];
  if (!t) {
    console.log('跳过（云端无此主题）：', id);
    continue;
  }
  const assets = Object.assign({}, t.assets, {
    envelope: `${ENV_PREFIX}/theme/${id}/envelope.jpg`
  });
  if (dryRun) {
    console.log('[dry-run]', id, '→', assets.envelope);
    updated++;
    continue;
  }
  const r = await call('themeSave', { theme: Object.assign({}, t, { assets }) });
  if (r.ok) {
    console.log('已更新：', id, '→', assets.envelope);
    updated++;
  } else {
    console.error('失败：', id, r.error);
  }
}
console.log(`完成：${updated}/${IDS.length} 套`);
