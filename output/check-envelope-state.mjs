// 只读诊断：云端两处主题记录（themes 官方款 + member_items 会员专属款）的信封素材
// 现在到底是什么（大图下沉验收用）。
// 用法：HB_KEY=<你的后台密钥> node output/check-envelope-state.mjs
// 只调 themeList / memberItemList，不写任何东西。
// 注意：theme 云函数下发时 member_items 的专属款会**同 id 覆盖**官方款 ——
// 只看 themes 集合会误判「已迁移完成」（踩过一次），两个集合必须都看。
const API = 'https://cloudbase-d1gp46d6he3bbf9f0-1477338373.ap-shanghai.app.tcloudbase.com/admin';
const ENV_PREFIX = 'cloud://cloudbase-d1gp46d6he3bbf9f0.636c-cloudbase-d1gp46d6he3bbf9f0-1477338373';

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

const r = await call('themeList');
if (!r.ok) {
  console.error('themeList 失败：', r.error);
  process.exit(1);
}
const mi = await call('memberItemList', { kind: 'theme' });
if (!mi.ok) {
  console.error('memberItemList 失败：', mi.error);
  process.exit(1);
}

const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n);
function envState(env, id) {
  if (!env) return '空（前端回落 thumb）';
  if (env.startsWith('cloud://')) return env === `${ENV_PREFIX}/theme/${id}/envelope.jpg` ? 'cloud:// 正确' : 'cloud:// 但路径异常 → ' + env;
  if (env.startsWith('/assets/')) return '包内死路径（包里已删，liveSrc 会丢弃）';
  return '其它 → ' + env;
}

console.log('== themes 集合（官方款，共', (r.themes || []).length, '套）==\n');
for (const t of r.themes || []) {
  const env = (t.assets && t.assets.envelope) || '';
  const thumb = (t.assets && t.assets.envelopeThumb) || '';
  console.log(`${pad(t.theme_id, 16)} envelope: ${envState(env, t.theme_id)}`);
  console.log(`${''.padEnd(16)} thumb  : ${thumb ? (thumb.startsWith('cloud://') ? 'cloud://' : thumb) : '空'}`);
}

console.log('\n== member_items 集合（会员专属款，同 id 覆盖官方款！theme 共',
  (mi.items || []).filter((x) => x.kind === 'theme').length, '条）==\n');
for (const it of mi.items || []) {
  if (it.kind !== 'theme') continue;
  const env = (it.assets && it.assets.envelope) || '';
  console.log(`${pad(it.item_id, 16)} envelope: ${envState(env, it.item_id)}`);
}

console.log('\n判定：两个集合里所有记录都是「cloud:// 正确」才是迁移完成；');
console.log('member_items 残留死路径时，官方款修得再对也会被它盖掉（前端看到的还是死路径）。');
