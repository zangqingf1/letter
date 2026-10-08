// 批量把 member_items 集合里会员专属主题的 assets.envelope 改为云存储 fileID。
// 背景：theme 云函数 listThemes 是「themes 集合 + member_items（kind='theme'）合并，
// 专属款同 id 覆盖官方款」——官方 14 套已在 themes 集合改成 cloud://，但其中 12 套
// 在 member_items 里还有专属款记录（assets.envelope 残留包内死路径），把修好的官方
// 记录盖掉了，导致前端拿到的仍是死路径 → 拆信幕永远缩略图。
//
// 用法：HB_KEY=<后台密钥> node output/batch-envelope-member-items.mjs [--dry-run]
// 安全性：只动 member_items 文档的 assets.envelope 一个字段（envelopeThumb 原样保留），
// 先 memberItemList 读全量，逐条比对后只对需要改的条目调 memberItemSave。
const API = 'https://cloudbase-d1gp46d6he3bbf9f0-1477338373.ap-shanghai.app.tcloudbase.com/admin';
const ENV_PREFIX = 'cloud://cloudbase-d1gp46d6he3bbf9f0.636c-cloudbase-d1gp46d6he3bbf9f0-1477338373';

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

const list = await call('memberItemList', { kind: 'theme' });
if (!list.ok) {
  console.error('memberItemList 失败：', list.error);
  process.exit(1);
}
const items = (list.items || []).filter((it) => IDS.indexOf(it.item_id) !== -1);
console.log('member_items 里命中待迁移名单的专属主题：', items.length, '条\n');

let fixed = 0;
for (const it of items) {
  const target = `${ENV_PREFIX}/theme/${it.item_id}/envelope.jpg`;
  const cur = (it.assets && it.assets.envelope) || '';
  if (cur === target) {
    console.log('已是 cloud://，跳过：', it.item_id);
    continue;
  }
  if (dryRun) {
    console.log('[dry-run]', it.item_id, '：', cur || '(空)', '→', target);
    fixed++;
    continue;
  }
  // memberItemSave 契约：整包挂在 item 字段下（kind/item_id/name 必填，其余字段
  // 云函数侧 pick 白名单自动过滤）；assets 整体覆盖（doc.assets = data.assets），
  // thumb 必须带上原值
  const assets = Object.assign({}, it.assets, { envelope: target });
  const r = await call('memberItemSave', {
    item: Object.assign({}, it, { assets })
  });
  if (r.ok) {
    console.log('已更新：', it.item_id, '→', target);
    fixed++;
  } else {
    console.error('失败：', it.item_id, r.error);
  }
}
console.log(`\n完成：${fixed}/${items.length} 条${dryRun ? '（dry-run 未写库）' : ''}`);
