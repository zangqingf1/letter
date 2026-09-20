// 云函数 admin —— Web 后台管理系统唯一后端入口（技术架构文档.md「Web 后台」一节）
// 鉴权：环境变量 ADMIN_KEY（在 CloudBase 控制台配置）；Web 端每次请求携带 event.key 比对，
// 未配置密钥时默认拒绝全部请求（fail closed）。
// 隐私红线（产品原则「内容属于用户」）：本函数任何 action 都不读取信件正文——
// letters 只做 count 聚合、userList/userDetail 显式 field projection，永不返回
// name/question/answer 与回信 content。改动时必须维持这条红线。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const crypto = require('crypto');
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

const TZ = '+0800';
const DAY = 86400000;

// ── 官方默认配置 seed（与 miniprogram/pages/write/themes.js / papers.js 同源手工同步）──
// 官方主题十五套（小王子 + 印花 + 2026-09 新增六套 + 2026-09-20 新增七套），信封素材均为
// 小程序包内路径（云存储 fileID 与云环境绑定，不入 seed）。默认/回落款是璀璨如初（id
// 'cuican'）：小程序端按 services/theme.js 的 DEFAULT_THEME_ID 显式解析，与本 seed 的
// sort 排序无关（sort 只决定选择卡陈列次序；2026-09-20 前默认款是小王子）。
// 历史版本的 6 套无素材主题（晨光/雨夜/牛皮纸/棉麻/花笺/咖啡渍）已删除；若线上 themes
// 集合仍留有这批旧记录，需在后台「主题管理」逐条删除，否则会继续下发。
const SEED_THEMES = [
  // palette 只放底色 base：三档墨色（title/text/tag）已随「信纸自持」改版失去消费方，2026-09 清理
  { theme_id: 'xiaowangzi', name: '小王子', desc: '温柔童话', version: 2, swatch: '', palette: { base: '#F9F3E4' }, desk: '#EDE9DC', assets: { envelope: '/assets/theme/xiaowangzi/envelope.jpg', envelopeThumb: '/assets/theme/xiaowangzi/envelope-thumb.jpg' } },
  // 印花 2026-09-18 上线时素材存云存储，2026-09 起搬进包内（assets 改包内路径，云存储旧图可删）。
  // themeSeed 只补缺不覆盖：线上既有 yinhua 文档需在后台「主题管理」把两个素材路径改成包内路径。
  { theme_id: 'yinhua', name: '印花', desc: '纸间花草', version: 1, swatch: '', palette: { base: '#F0ECE2' }, desk: '#E4E6DA', assets: { envelope: '/assets/theme/yinhua/envelope.jpg', envelopeThumb: '/assets/theme/yinhua/envelope-thumb.jpg' } },
  // 2026-09 新增六套：素材自上线起即为包内路径（原图在 picture/新主题/），themeSeed 直接建齐。
  { theme_id: 'daoying', name: '倒影里的秋', desc: '湖畔秋信', version: 1, swatch: '', palette: { base: '#F4EFE2' }, desk: '#E8E4D3', assets: { envelope: '/assets/theme/daoying/envelope.jpg', envelopeThumb: '/assets/theme/daoying/envelope-thumb.jpg' } },
  { theme_id: 'gonglu', name: '公路情书', desc: '麦浪旅人', version: 1, swatch: '', palette: { base: '#F3EDDA' }, desk: '#EAE4CE', assets: { envelope: '/assets/theme/gonglu/envelope.jpg', envelopeThumb: '/assets/theme/gonglu/envelope-thumb.jpg' } },
  { theme_id: 'tiantan', name: '天坛往事', desc: '红墙飞鸟', version: 1, swatch: '', palette: { base: '#F2EFE6' }, desk: '#E6E2D6', assets: { envelope: '/assets/theme/tiantan/envelope.jpg', envelopeThumb: '/assets/theme/tiantan/envelope-thumb.jpg' } },
  { theme_id: 'shanye', name: '山野来信', desc: '山湖秘境', version: 1, swatch: '', palette: { base: '#F3EFDC' }, desk: '#E5E6CC', assets: { envelope: '/assets/theme/shanye/envelope.jpg', envelopeThumb: '/assets/theme/shanye/envelope-thumb.jpg' } },
  { theme_id: 'cuican', name: '璀璨如初', desc: '烟火如诗', version: 1, swatch: '', palette: { base: '#F6F3EA' }, desk: '#ECE8DE', assets: { envelope: '/assets/theme/cuican/envelope.jpg', envelopeThumb: '/assets/theme/cuican/envelope-thumb.jpg' } },
  { theme_id: 'luori', name: '落日归海', desc: '晚霞入海', version: 1, swatch: '', palette: { base: '#F5EBD9' }, desk: '#F0DFC6', assets: { envelope: '/assets/theme/luori/envelope.jpg', envelopeThumb: '/assets/theme/luori/envelope-thumb.jpg' } },
  // 2026-09-20 新增七套：素材自上线起即为包内路径（原图在 picture/新主题2/，居中裁到 890×616），themeSeed 直接建齐。
  { theme_id: 'niuyouguo', name: '牛油果', desc: '一颗温柔的绿', version: 1, swatch: '', palette: { base: '#F4F4E7' }, desk: '#EAECD6', assets: { envelope: '/assets/theme/niuyouguo/envelope.jpg', envelopeThumb: '/assets/theme/niuyouguo/envelope-thumb.jpg' } },
  { theme_id: 'meiguixingyun', name: '玫瑰星云', desc: '星尘与玫瑰', version: 1, swatch: '', palette: { base: '#F7EFE9' }, desk: '#EEE3DE', assets: { envelope: '/assets/theme/meiguixingyun/envelope.jpg', envelopeThumb: '/assets/theme/meiguixingyun/envelope-thumb.jpg' } },
  { theme_id: 'dielianhuajian', name: '蝶恋花笺', desc: '蝶影过花间', version: 1, swatch: '', palette: { base: '#F6F6EF' }, desk: '#ECEDE0', assets: { envelope: '/assets/theme/dielianhuajian/envelope.jpg', envelopeThumb: '/assets/theme/dielianhuajian/envelope-thumb.jpg' } },
  { theme_id: 'huajianxinjian', name: '花间信笺', desc: '鎏金花影', version: 1, swatch: '', palette: { base: '#F7F1E5' }, desk: '#F0E6D8', assets: { envelope: '/assets/theme/huajianxinjian/envelope.jpg', envelopeThumb: '/assets/theme/huajianxinjian/envelope-thumb.jpg' } },
  { theme_id: 'xiarihangxian', name: '夏日航线', desc: '盛夏航空信', version: 1, swatch: '', palette: { base: '#F5EADA' }, desk: '#E9DCC8', assets: { envelope: '/assets/theme/xiarihangxian/envelope.jpg', envelopeThumb: '/assets/theme/xiarihangxian/envelope-thumb.jpg' } },
  { theme_id: 'suiyuejinjian', name: '岁月金笺', desc: '鎏金素笺', version: 1, swatch: '', palette: { base: '#F5F1E3' }, desk: '#ECE5D3', assets: { envelope: '/assets/theme/suiyuejinjian/envelope.jpg', envelopeThumb: '/assets/theme/suiyuejinjian/envelope-thumb.jpg' } },
  { theme_id: 'yinranqingshu', name: '洇染情书', desc: '水彩洇开的信', version: 1, swatch: '', palette: { base: '#F0F2F1' }, desk: '#E3E8EA', assets: { envelope: '/assets/theme/yinranqingshu/envelope.jpg', envelopeThumb: '/assets/theme/yinranqingshu/envelope-thumb.jpg' } }
];

// 二十一款信纸版式：后台只管名称/描述/配色/上下架/排序/版本；版式视觉结构在
// 小程序代码三端同构（styles/paper.wxml + paper.wxss + share.js drawXxxStyle），
// 新增版式结构必须改代码发版，后台无法凭空创建。
const SEED_PAPERS = [
  { paper_id: 'liubai', name: '留白志', desc: '编辑部极简 · 短线页脚', version: 1, colors: { bg: '#FEFEFC', ink: '#33302A', deep: '#1D1B17', gray: '#8A8478', faint: '#B3AC9C', fainter: '#A29B8A', line: '#ECE8DE', date: '#6E695E' } },
  { paper_id: 'extra', name: '号外头版', desc: '报纸头版 · 首字下沉', version: 1, colors: { bg: '#F5EFDE', ink: '#262219', deep: '#1E1B14', sub: '#5A5240', accent: '#A33B24', faint: '#B9AE93' } },
  { paper_id: 'blueprint', name: '工程蓝图', desc: '白线网格 · 标题栏落日期', version: 1, colors: { bg: '#16324F', line: '#EAF2F8', title: '#FFFFFF', body: '#EAF2F8', q: '#C9DCEA', accent: '#9CC4E4', grid: 'rgba(234,242,248,0.10)' } },
  { paper_id: 'ticket', name: '存根票根', desc: '凭证票面 · 条码编号', version: 1, colors: { bg: '#F6EDDC', ink: '#2E2A26', deep: '#26221D', accent: '#C2452D', sub: '#8A6A5A', gray: '#6E675C', divider: '#C9BBA0' } },
  { paper_id: 'poster', name: '大字标语', desc: '海报直给 · 描边水印方章', version: 1, colors: { bg: '#F0E9DA', ink: '#221E18', deep: '#17140F', red: '#B5342A', cream: '#F5EFE0', gray: '#6E6552', wm: 'rgba(150,132,96,0.30)' } },
  { paper_id: 'bauhaus', name: '包豪斯几何', desc: '红圆蓝角黄块', version: 1, colors: { bg: '#FAF7EF', ink: '#17150F', red: '#D9402A', blue: '#1F4FA0', yellow: '#E8B33C', gray: '#5C584C' } },
  { paper_id: 'vinyl', name: '黑胶唱片', desc: '暗纸盘芯 · 深夜重读', version: 1, colors: { bg: '#1B1A1C', text: '#D9D2C4', bright: '#F0E9D8', accent: '#C24A2E', gray: '#9C9484', dim: '#6E685C' } },
  { paper_id: 'suwen', name: '素问笺', desc: '问答朱印对帖 · 斜盖邮戳', version: 1, colors: { bg: '#FAF7F0', ink: '#3B372F', deep: '#2E2B25', accent: '#A63B2A', line: '#D8D2C2', gray: '#6B6557' } },
  { paper_id: 'moye', name: '墨夜笺', desc: '暗夜纸面 · 暖金细线', version: 1, colors: { bg: '#1D2027', bg1: '#2A2F3A', bg2: '#22262E', bg3: '#1D2027', text: '#DDD6C6', bright: '#F0E9D8', gold: '#C6A870', goldDim: 'rgba(198,168,112,0.45)', goldFaint: 'rgba(198,168,112,0.28)', gray: '#B4AD9D' } },
  { paper_id: 'airmail2', name: '航空笺', desc: '全幅斜纹画框 · 邮票邮戳', version: 1, colors: { bg: '#FCFBF4', stripe1: '#C2452D', stripe2: '#F3EFE2', stripe3: '#33557E', ink: '#22303E', red: '#C2452D', blue: '#33557E', qGray: '#6B7B8A', aBlue: '#29405A', tan: '#A8A18C', dash: '#C9C2AC', stampPaper: '#F4F0E1', stampLine: '#CFC8B2' } },
  { paper_id: 'shupai', name: '竖排笺', desc: '从右往左 · 竖着写的信', version: 1, colors: { bg: '#FAF7F0', ink: '#3A362C', deep: '#2C2921', gray: '#847E6C', tan: '#8B8264', tanLine: '#C9C2AC', fill: '#6E6752', date: '#A29B85' } },
  { paper_id: 'yixian', name: '一线笺', desc: '整张纸只有一根线', version: 1, colors: { bg: '#FFFFFF', ink: '#33312B', deep: '#26241E', gray: '#8A8471', faint: '#A9A28C', line: '#DCD8CB', ring: '#C4BEA9', sub: '#6E695C' } },
  { paper_id: 'banxin', name: '版心笺', desc: '信是一页书 · 题记与页码', version: 1, colors: { bg: '#F9F5EA', ink: '#33302A', deep: '#26231D', gray: '#8A8471', faint: '#A39B85', line: '#C9C2AC', orn: '#B9AE8F', rhLine: 'rgba(163,155,133,0.5)' } },
  { paper_id: 'juzhong', name: '居中笺', desc: '压在桌面正中的诗笺', version: 1, colors: { bg: '#F2EEE3', ink: '#35322A', deep: '#2B2822', gray: '#8A8471', faint: '#A29B85', gold: '#B9A36A', line: 'rgba(163,155,133,0.55)', brand: '#B3AB94' } },
  { paper_id: 'caiqie', name: '裁切笺', desc: '一张还没裁开的印刷品', version: 1, colors: { bg: '#FCFCFA', ink: '#2F2F2B', deep: '#23231F', gray: '#7E7E72', faint: '#A9A99E', line: '#E3E3D9', mark: '#C6C6BC', sub: '#55554C' } },
  { paper_id: 'xingtu', name: '星图观测笺', desc: '深蓝夜空 · 观测记录', version: 1, colors: { bg: '#101A30', ink: '#E4E8F7', bright: '#F2F4FF', gray: '#9AA5C6', blue: '#8E9AC2', gold: '#D8B26A', goldSoft: 'rgba(216,178,106,0.75)', coord: 'rgba(148,165,220,0.55)', grid: 'rgba(148,165,220,0.07)', star: '#E8C98A', starLine: 'rgba(216,178,106,0.35)' } },
  { paper_id: 'jiaopian', name: '胶片底片', desc: '35mm 胶片 · 一格画面', version: 1, colors: { bg: '#211E1A', ink: '#E9E4D8', bright: '#F4F0E4', gray: '#A89F8C', accent: '#D98C4A', footDim: 'rgba(233,228,216,0.45)', footLine: 'rgba(233,228,216,0.3)', frame: 'rgba(233,228,216,0.55)', perf: 'rgba(238,233,220,0.9)', mark: 'rgba(233,228,216,0.4)' } },
  { paper_id: 'rili', name: '日历撕页', desc: '那一页永远不撕的日历', version: 1, colors: { bg: '#FBFAF4', ink: '#2E2C26', deep: '#23211C', red: '#B23B2E', cream: '#F7F1E2', creamDim: 'rgba(247,241,226,0.85)', gray: '#6E6A5C', faint: '#A29B86', tear: 'rgba(150,140,110,0.55)', line: 'rgba(150,140,110,0.45)' } },
  { paper_id: 'chufang', name: '深夜处方笺', desc: '医师：三个月后的我', version: 1, colors: { bg: '#F4F7F0', ink: '#2F352E', deep: '#24352A', red: '#B23B2E', gray: '#8A9284', sub: '#565C52', fieldLine: 'rgba(47,53,46,0.45)', deepLine: 'rgba(36,53,42,0.5)', sealLine: 'rgba(178,59,46,0.75)', sealIn: 'rgba(178,59,46,0.85)', sealInner: 'rgba(178,59,46,0.5)' } },
  { paper_id: 'zhongduan', name: '终端笺', desc: '琥珀磷屏 · 深夜运行', version: 1, colors: { bg: '#16110A', amber: '#E8A33D', bright: '#F5C169', aAmber: '#F0BE71', qDim: 'rgba(245,193,105,0.62)', barDim: 'rgba(232,163,61,0.65)', fileDim: 'rgba(232,163,61,0.7)', promptDim: 'rgba(232,163,61,0.6)', statusDim: 'rgba(232,163,61,0.75)', footDim: 'rgba(232,163,61,0.55)', line: 'rgba(232,163,61,0.3)', frame: 'rgba(232,163,61,0.4)' } },
  { paper_id: 'zhengshu', name: '结业证书', desc: '兹证明这一课已修完', version: 1, colors: { bg: '#F8F3E4', ink: '#3A3428', ink2: '#4A4335', title: '#7A5F28', orn: '#9C7C3C', orgK: '#A2916A', capLine: 'rgba(156,124,60,0.45)', courseTxt: '#6E6552', red: '#B23B2E', redSeal: 'rgba(178,59,46,0.92)', redRing: 'rgba(178,59,46,0.8)', cream: '#F8F3E4', frame: '#9C7C3C', innerFrame: 'rgba(156,124,60,0.55)' } }
];

// 会员专属内容（member_items 集合 seed，与 miniprogram/pages/member/premium.js 同源手工同步）。
// 本表驱动三端：theme 云函数下发时把上架的专属款并入主题/版式列表（premium:true），
// 写信页解锁 / 详情 / 分享渲染均以它为准，后台改配色即生效。
const SEED_MEMBER_ITEMS = [
  { kind: 'paper', item_id: 'gold', name: '鎏金笺', desc: '暖金细线 · 专属', version: 1, colors: { bg: '#FAF4E6', ink: '#4A4033', gold: '#C6A870' } },
  { kind: 'paper', item_id: 'canglan', name: '苍蓝笺', desc: '静谧深青 · 专属', version: 1, colors: { bg: '#DDEDEA', ink: '#2E4440', gold: '#9FC8C0' } },
  { kind: 'paper', item_id: 'yinxiang', name: '银厢笺', desc: '墨银浮雕 · 专属', version: 1, colors: { bg: '#EDF0EE', ink: '#3A4240', gold: '#B9C4C0' } }
  // 专属主题（原 归鸟/星汐）已移除：需要时在后台「会员管理 → 专属内容」自行新建 kind='theme' 条目。
];

// 会员套餐中文名（memberGrant 写入 members.plan_name）
const PLAN_NAMES = { month: '月卡', quarter: '季卡', year: '年卡', custom: '自定义' };

// 正则转义，供昵称模糊搜索拼接（userList keyword）
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 选择器字段类型化：这些值会直接进 where()，若为对象（如 {"$ne":null}）会被数据库当作
// 查询操作符，导致全表命中 —— themeDelete/paperDelete/memberItemDelete 会清空整个集合、
// userBan/memberRevoke 会批量封禁。故一律要求字符串并限制长度，非法返回 null。
function selectorField(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > (max || 64)) return null;
  return s;
}

// openid 选择器：微信 openid 为 [A-Za-z0-9_-] 的短串
function openidField(v) {
  const s = selectorField(v, 64);
  return s && /^[A-Za-z0-9_-]+$/.test(s) ? s : null;
}

// 管理员密钥：只读环境变量 ADMIN_KEY（在 CloudBase 控制台配置）。
// 未配置时 checkKey 直接拒绝一切请求（密钥不得落入仓库，历史泄露的密钥须视为已失效并轮换）。
// 比较前双方各做一次 SHA-256：既避免长度差异泄露，也让 timingSafeEqual 可用于等长缓冲。
function checkKey(event) {
  const key = process.env.ADMIN_KEY || '';
  if (!key) return false;
  if (typeof event.key !== 'string') return false;
  const a = crypto.createHash('sha256').update(event.key).digest();
  const b = crypto.createHash('sha256').update(key).digest();
  return crypto.timingSafeEqual(a, b);
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

// 按 idKey upsert 一条主题/版式文档
async function upsertConfig(coll, idKey, data) {
  const now = new Date();
  const doc = Object.assign(pick(data, [idKey, 'name', 'desc', 'version', 'status', 'sort', 'swatch', 'palette', 'desk', 'colors']), {
    updated_at: now
  });
  if (idKey === 'theme_id') doc.assets = data.assets || {};
  const found = await db.collection(coll).where({ [idKey]: data[idKey] }).limit(1).get();
  if (found.data.length) {
    await db.collection(coll).doc(found.data[0]._id).update({ data: doc });
    return { id: found.data[0]._id, updated: true };
  }
  doc.created_at = now;
  const added = await db.collection(coll).add({ data: doc });
  return { id: added._id, updated: false };
}

// 会员专属 id 表：member_items 里已有的 item_id（kind='paper'/'theme'），
// 供 themeList/paperList 给每行打 premium 标记 —— 后台状态列据此显示「👑 会员」标签。
// 是否 online 不参与判断：专属款只要在 member_items 里存在就已「是专属款」，
// 它的上下架在「会员管理 → 专属内容」维护（这里再叠一层 status 判断只会让标记乱跳）。
async function premiumIdMap(kind) {
  const res = await db.collection('member_items').where({ kind }).limit(200).get();
  const map = {};
  for (const it of res.data) map[it.item_id] = true;
  return map;
}

// 按 (kind, item_id) upsert 一条会员专属版式/主题文档
async function upsertMemberItem(data) {
  const now = new Date();
  const doc = Object.assign(pick(data, ['kind', 'item_id', 'name', 'desc', 'version', 'status', 'sort', 'colors', 'swatch', 'palette', 'desk']), {
    updated_at: now
  });
  if (data.assets && typeof data.assets === 'object') doc.assets = data.assets;
  const found = await db.collection('member_items').where({ kind: data.kind, item_id: data.item_id }).limit(1).get();
  if (found.data.length) {
    await db.collection('member_items').doc(found.data[0]._id).update({ data: doc });
    return { id: found.data[0]._id, updated: true };
  }
  doc.created_at = now;
  const added = await db.collection('member_items').add({ data: doc });
  return { id: added._id, updated: false };
}

// 按天聚合某集合的 created_at（东八区日期串）
async function countByDay(coll, since) {
  const res = await db
    .collection(coll)
    .aggregate()
    .match({ created_at: _.gte(since) })
    .addFields({ day: $.dateToString({ date: '$created_at', format: '%Y-%m-%d', timezone: TZ }) })
    .group({ _id: '$day', count: $.sum(1) })
    .end();
  const map = {};
  for (const row of res.list) map[row._id] = row.count;
  return map;
}

// 近 N 天的日期串列表（今天起倒推，东八区）
function dayKeys(days) {
  const keys = [];
  const nowCn = Date.now() + 8 * 3600000;
  for (let i = 0; i < days; i++) {
    keys.push(new Date(nowCn - i * DAY).toISOString().slice(0, 10));
  }
  return keys.reverse();
}

// 一批 openid 在指定集合里的条数（不取任何内容字段）
async function countByOpenid(coll, openIds) {
  if (!openIds.length) return {};
  const res = await db
    .collection(coll)
    .aggregate()
    .match({ _openid: _.in(openIds) })
    .group({ _id: '$_openid', count: $.sum(1) })
    .end();
  const map = {};
  for (const row of res.list) map[row._id] = row.count;
  return map;
}

async function userDetail(openid) {
  // 五项计数与会员状态互不依赖，和用户档案一并并发；旧版把这五项排成一批、
  // 会员状态再单独串行一次，等于多一个往返（后台点开用户详情时才走这里）。
  const [u, letters, recycled, opens, replies, drafts, m] = await Promise.all([
    db
      .collection('users')
      .where({ _openid: openid })
      .field({ nickname: true, avatar_url: true, status: true, banned_at: true, created_at: true })
      .limit(1)
      .get(),
    db.collection('letters').where({ _openid: openid, status: 'active' }).count(),
    db.collection('letters').where({ _openid: openid, status: 'recycled' }).count(),
    db.collection('open_records').where({ _openid: openid }).count(),
    db.collection('reply_records').where({ _openid: openid }).count(),
    db.collection('drafts').where({ _openid: openid }).count(),
    db.collection('members').where({ _openid: openid }).limit(1).get()
  ]);
  const member = m.data[0] || null;
  return {
    user: u.data[0] || null,
    letterTotal: letters.total,
    recycleTotal: recycled.total,
    rereadTotal: opens.total,
    replyTotal: replies.total,
    draftTotal: drafts.total,
    member: member
      ? {
          state: member.state || 'free',
          level: member.level || '',
          plan_name: member.plan_name || '',
          expires_at: member.expires_at || null,
          renew: !!member.renew,
          granted_at: member.granted_at || null
        }
      : null
  };
}

// 一批 openid 在 members 集合里的会员状态（key=openid）
async function memberMapByOpenid(openIds) {
  if (!openIds.length) return {};
  const res = await db
    .collection('members')
    .where({ _openid: _.in(openIds), state: 'vip', expires_at: _.gte(new Date()) })
    .field({ _openid: true, state: true, level: true, expires_at: true, plan_name: true })
    .get();
  const map = {};
  for (const row of res.data) map[row._openid] = row;
  return map;
}

// HTTP 网关调用适配：路由直连本函数时，event 为 HTTP 请求结构（body 是 JSON 串），
// 需解析后走同一套 action 分发，并按 HTTP 响应格式返回；OPTIONS 预检直接放行。
function parseHttpEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const method = event.httpMethod || (event.requestContext && event.requestContext.http && event.requestContext.http.method);
  if (!method) return null;
  if (method.toUpperCase() === 'OPTIONS') return { options: true };
  let body = event.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
  }
  return body && typeof body === 'object' ? body : {};
}

// 跨域来源：环境变量 ADMIN_ORIGIN（多个逗号分隔）配置后只回显白名单来源，
// 非白名单不回 ACAO（浏览器侧拒绝），避免任意站点直接打这个端点做暴力破解。
// 未配置时回落 '*' 以兼容既有部署 —— 此时务必在 HTTP 网关侧配置限流（见 admin/README.md）。
const ADMIN_ORIGINS = (process.env.ADMIN_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeaders(rawEvent) {
  const h = (rawEvent && rawEvent.headers) || {};
  const origin = h.origin || h.Origin || '';
  const base = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (!ADMIN_ORIGINS.length) return Object.assign({ 'Access-Control-Allow-Origin': '*' }, base);
  if (origin && ADMIN_ORIGINS.indexOf(origin) !== -1) {
    return Object.assign({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }, base);
  }
  return base;
}

exports.main = async (event) => {
  const http = parseHttpEvent(event);
  if (!http) return handleAction(event);
  const headers = corsHeaders(event);
  if (http.options) return { statusCode: 204, headers, body: '' };
  const result = await handleAction(http);
  return { statusCode: 200, headers, body: JSON.stringify(result) };
};

async function handleAction(event) {
  if (!checkKey(event)) return { ok: false, error: 'unauthorized' };
  const action = event.action;

  try {
    switch (action) {
      // ── 鉴权 ──
      case 'auth':
        return { ok: true, role: 'admin' };

      // ── 主题管理 ──
      case 'themeList': {
        const [res, premium] = await Promise.all([
          db.collection('themes').orderBy('sort', 'asc').limit(200).get(),
          premiumIdMap('theme')
        ]);
        return {
          ok: true,
          themes: res.data.map((t) => Object.assign({}, t, { premium: !!premium[t.theme_id] }))
        };
      }
      case 'themeSave': {
        const theme = event.theme || {};
        const themeId = selectorField(theme.theme_id, 64);
        if (!themeId || typeof theme.name !== 'string' || !theme.name.trim()) {
          return { ok: false, error: 'theme_id 与 name 必填' };
        }
        const r = await upsertConfig('themes', 'theme_id', Object.assign({}, theme, { theme_id: themeId }));
        return { ok: true, ...r };
      }
      case 'themeDelete': {
        const themeId = selectorField(event.theme_id, 64);
        if (!themeId) return { ok: false, error: 'theme_id 非法' };
        const r = await db.collection('themes').where({ theme_id: themeId }).remove();
        return { ok: true, removed: r.stats.removed };
      }
      case 'themeSeed': {
        let seeded = 0;
        for (const t of SEED_THEMES) {
          const exists = await db.collection('themes').where({ theme_id: t.theme_id }).limit(1).get();
          if (!exists.data.length) {
            await db.collection('themes').add({
              data: Object.assign({}, t, {
                status: 'online',
                sort: SEED_THEMES.indexOf(t),
                created_at: new Date(),
                updated_at: new Date()
              })
            });
            seeded++;
          }
        }
        return { ok: true, seeded, skipped: SEED_THEMES.length - seeded };
      }

      // ── 版式管理 ──
      case 'paperList': {
        const [res, premium] = await Promise.all([
          db.collection('papers').orderBy('sort', 'asc').limit(200).get(),
          premiumIdMap('paper')
        ]);
        return {
          ok: true,
          papers: res.data.map((p) => Object.assign({}, p, { premium: !!premium[p.paper_id] }))
        };
      }
      case 'paperSave': {
        const paper = event.paper || {};
        const paperId = selectorField(paper.paper_id, 64);
        if (!paperId || typeof paper.name !== 'string' || !paper.name.trim()) {
          return { ok: false, error: 'paper_id 与 name 必填' };
        }
        const r = await upsertConfig('papers', 'paper_id', Object.assign({}, paper, { paper_id: paperId }));
        return { ok: true, ...r };
      }
      case 'paperDelete': {
        const paperId = selectorField(event.paper_id, 64);
        if (!paperId) return { ok: false, error: 'paper_id 非法' };
        const r = await db.collection('papers').where({ paper_id: paperId }).remove();
        return { ok: true, removed: r.stats.removed };
      }
      case 'paperSeed': {
        let seeded = 0;
        for (let i = 0; i < SEED_PAPERS.length; i++) {
          const p = SEED_PAPERS[i];
          const exists = await db.collection('papers').where({ paper_id: p.paper_id }).limit(1).get();
          if (!exists.data.length) {
            await db.collection('papers').add({
              data: Object.assign({}, p, {
                status: 'online',
                sort: i,
                created_at: new Date(),
                updated_at: new Date()
              })
            });
            seeded++;
          }
        }
        return { ok: true, seeded, skipped: SEED_PAPERS.length - seeded };
      }

      // ── 数据看板（全部 count / 聚合，零正文）──
      case 'statsOverview': {
        const [users, letters, recycled, drafts, opens, replies] = await Promise.all([
          db.collection('users').count(),
          db.collection('letters').where({ status: 'active' }).count(),
          db.collection('letters').where({ status: 'recycled' }).count(),
          db.collection('drafts').count(),
          db.collection('open_records').count(),
          db.collection('reply_records').count()
        ]);
        return {
          ok: true,
          userTotal: users.total,
          letterTotal: letters.total,
          recycleTotal: recycled.total,
          draftTotal: drafts.total,
          rereadTotal: opens.total,
          replyTotal: replies.total
        };
      }
      case 'statsTrend': {
        const days = Number(event.days) === 30 ? 30 : 7;
        const since = new Date(Date.now() - days * DAY);
        const [users, letters, opens, replies] = await Promise.all([
          countByDay('users', since),
          countByDay('letters', since),
          countByDay('open_records', since),
          countByDay('reply_records', since)
        ]);
        const keys = dayKeys(days);
        return {
          ok: true,
          days: days,
          trend: keys.map((d) => ({
            day: d,
            users: users[d] || 0,
            letters: letters[d] || 0,
            opens: opens[d] || 0,
            replies: replies[d] || 0
          }))
        };
      }
      case 'eventsSummary': {
        const since7 = new Date(Date.now() - 7 * DAY);
        // 两个聚合互不依赖（全量 + 近 7 天），一次并发（旧版串行，看板每次打开多一个往返）
        const [all, recent] = await Promise.all([
          db
            .collection('events')
            .aggregate()
            .group({ _id: '$name', count: $.sum(1) })
            .end(),
          db
            .collection('events')
            .aggregate()
            .match({ created_at: _.gte(since7) })
            .group({ _id: '$name', count: $.sum(1) })
            .end()
        ]);
        const recentMap = {};
        for (const row of recent.list) recentMap[row._id] = row.count;
        return {
          ok: true,
          events: all.list
            .map((r) => ({ name: r._id || '(空)', total: r.count, last7: recentMap[r._id] || 0 }))
            .sort((a, b) => b.total - a.total)
        };
      }

      // ── 用户管理（profile + count，零内容字段）──
      case 'userList': {
        const pageSize = 20;
        const page = Math.min(500, Math.max(1, Number(event.page) || 1));
        const where = {};
        // 枚举白名单：与面板筛选项一致（全部/正常/已封禁/已注销），避免任意值进入查询
        if (event.status === 'active' || event.status === 'banned' || event.status === 'deactivated') {
          where.status = event.status;
        }
        const keyword = selectorField(event.keyword, 64);
        if (keyword) {
          where.nickname = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' });
        }
        const base = Object.keys(where).length ? db.collection('users').where(where) : db.collection('users');
        const total = (await base.count()).total;
        const res = await base
          .orderBy('created_at', 'desc')
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .field({ _openid: true, nickname: true, avatar_url: true, status: true, banned_at: true, created_at: true })
          .get();
        const openIds = res.data.map((u) => u._openid);
        const [letters, opens, replies, memberMap] = await Promise.all([
          countByOpenid('letters', openIds),
          countByOpenid('open_records', openIds),
          countByOpenid('reply_records', openIds),
          memberMapByOpenid(openIds)
        ]);
        return {
          ok: true,
          page,
          pageSize,
          total,
          users: res.data.map((u) => {
            const vip = memberMap[u._openid];
            return {
              openid: u._openid,
              nickname: u.nickname || '',
              avatar: u.avatar_url || '',
              status: u.status || 'active',
              banned_at: u.banned_at || null,
              created_at: u.created_at,
              letterTotal: letters[u._openid] || 0,
              rereadTotal: opens[u._openid] || 0,
              replyTotal: replies[u._openid] || 0,
              memberState: vip ? 'vip' : 'free',
              memberLevel: vip ? vip.level : ''
            };
          })
        };
      }
      case 'userBan': {
        const openid = openidField(event.openid);
        if (!openid) return { ok: false, error: 'openid 非法' };
        await db.collection('users').where({ _openid: openid }).update({
          data: { status: 'banned', banned_at: new Date() }
        });
        return { ok: true };
      }
      case 'userUnban': {
        const openid = openidField(event.openid);
        if (!openid) return { ok: false, error: 'openid 非法' };
        await db.collection('users').where({ _openid: openid }).update({
          data: { status: 'active', banned_at: null }
        });
        return { ok: true };
      }
      case 'userDetail': {
        const openid = openidField(event.openid);
        if (!openid) return { ok: false, error: 'openid 非法' };
        const d = await userDetail(openid);
        return { ok: true, ...d };
      }

      // ── 会员管理（members 集合：VIP 用户状态，后台预置，小程序本期仍为演示态）──
      case 'memberList': {
        const pageSize = 20;
        const page = Math.min(500, Math.max(1, Number(event.page) || 1));
        const where = {};
        if (event.state === 'vip' || event.state === 'free') where.state = event.state;
        const base = Object.keys(where).length ? db.collection('members').where(where) : db.collection('members');
        const total = (await base.count()).total;
        const res = await base
          .orderBy('updated_at', 'desc')
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .get();
        const openIds = res.data.map((m) => m._openid);
        const userRows = openIds.length
          ? await db.collection('users')
              .where({ _openid: _.in(openIds) })
              .field({ _openid: true, nickname: true, avatar_url: true, created_at: true })
              .get()
          : { data: [] };
        const userMap = {};
        for (const u of userRows.data) userMap[u._openid] = u;
        return {
          ok: true,
          page,
          pageSize,
          total,
          members: res.data.map((m) => ({
            openid: m._openid,
            nickname: (userMap[m._openid] && userMap[m._openid].nickname) || '',
            avatar: (userMap[m._openid] && userMap[m._openid].avatar_url) || '',
            userCreatedAt: (userMap[m._openid] && userMap[m._openid].created_at) || null,
            state: m.state || 'free',
            level: m.level || '',
            plan_name: m.plan_name || '',
            expires_at: m.expires_at || null,
            renew: !!m.renew,
            granted_at: m.granted_at || null,
            updated_at: m.updated_at || null,
            granted_by: m.granted_by || ''
          }))
        };
      }
      case 'memberGrant': {
        const openid = openidField(event.openid);
        if (!openid) return { ok: false, error: 'openid 非法' };
        // plan 只允许已知档位（PLAN_NAMES 的键），避免写入任意 level 字符串
        const plan = PLAN_NAMES[event.plan] ? event.plan : 'month';
        const days = Number(event.days);
        if (!(days > 0) || days > 3650) return { ok: false, error: '有效期天数需为 1–3650' };
        // 建档校验与现有会员记录互不依赖，一次并发（旧版串行，发卡多一个往返）
        const [userExistsRes, found] = await Promise.all([
          db.collection('users').where({ _openid: openid }).count(),
          db.collection('members').where({ _openid: openid }).limit(1).get()
        ]);
        if (userExistsRes.total === 0) return { ok: false, error: '该 openid 未建档（无此用户）' };
        const now = new Date();
        let base = now.getTime();
        if (found.data.length && found.data[0].state === 'vip' && found.data[0].expires_at) {
          const t = new Date(found.data[0].expires_at).getTime();
          if (t > base) base = t;
        }
        const expiresAt = new Date(base + days * DAY);
        const doc = {
          state: 'vip',
          level: plan,
          plan_name: PLAN_NAMES[plan] || '自定义',
          expires_at: expiresAt,
          renew: !!event.renew,
          granted_at: now,
          granted_by: 'admin',
          updated_at: now
        };
        if (found.data.length) {
          doc.total_days = (found.data[0].total_days || 0) + days;
          await db.collection('members').doc(found.data[0]._id).update({ data: doc });
          return { ok: true, updated: true };
        }
        doc.total_days = days;
        await db.collection('members').add({ data: Object.assign({ _openid: openid }, doc) });
        return { ok: true, updated: false };
      }
      case 'memberRevoke': {
        const openid = openidField(event.openid);
        if (!openid) return { ok: false, error: 'openid 非法' };
        const r = await db.collection('members').where({ _openid: openid }).update({
          data: { state: 'free', updated_at: new Date() }
        });
        return { ok: true, updated: (r.stats && r.stats.updated) || 0 };
      }

      // ── 会员专属内容（member_items 集合：专属版式/主题，后台增删改查）──
      case 'memberItemList': {
        const where = {};
        if (event.kind === 'paper' || event.kind === 'theme') where.kind = event.kind;
        const base = Object.keys(where).length ? db.collection('member_items').where(where) : db.collection('member_items');
        const res = await base.orderBy('sort', 'asc').limit(200).get();
        return { ok: true, items: res.data };
      }
      case 'memberItemSave': {
        const item = event.item || {};
        if (!item.kind || (item.kind !== 'paper' && item.kind !== 'theme')) {
          return { ok: false, error: 'kind 必须为 paper / theme' };
        }
        const itemId = selectorField(item.item_id, 64);
        if (!itemId || typeof item.name !== 'string' || !item.name.trim()) {
          return { ok: false, error: 'item_id 与 name 必填' };
        }
        const r = await upsertMemberItem(Object.assign({}, item, { item_id: itemId }));
        return { ok: true, ...r };
      }
      case 'memberItemDelete': {
        const kind = event.kind === 'paper' || event.kind === 'theme' ? event.kind : null;
        const itemId = selectorField(event.item_id, 64);
        if (!kind || !itemId) return { ok: false, error: 'kind 与 item_id 非法' };
        const r = await db.collection('member_items').where({ kind: kind, item_id: itemId }).remove();
        return { ok: true, removed: r.stats.removed };
      }
      case 'memberItemSeed': {
        let seeded = 0;
        for (const it of SEED_MEMBER_ITEMS) {
          const exists = await db.collection('member_items').where({ kind: it.kind, item_id: it.item_id }).limit(1).get();
          if (!exists.data.length) {
            await db.collection('member_items').add({
              data: Object.assign({}, it, {
                status: 'online',
                sort: SEED_MEMBER_ITEMS.indexOf(it),
                created_at: new Date(),
                updated_at: new Date()
              })
            });
            seeded++;
          }
        }
        return { ok: true, seeded, skipped: SEED_MEMBER_ITEMS.length - seeded };
      }

      // ── 问题反馈管理（feedback 集合：用户主动提交给开发者的内容，属隐私红线例外；
      //    其余内容字段红线照旧 —— letters/reply_records 永不读取）──
      case 'feedbackList': {
        const pageSize = 20;
        const page = Math.min(500, Math.max(1, Number(event.page) || 1));
        const where = {};
        if (event.status === 'new' || event.status === 'done') where.status = event.status;
        const base = Object.keys(where).length
          ? db.collection('feedback').where(where)
          : db.collection('feedback');
        const total = (await base.count()).total;
        const res = await base
          .orderBy('created_at', 'desc')
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .get();
        return {
          ok: true,
          page,
          pageSize,
          total,
          items: res.data.map((f) => ({
            id: f._id,
            openid: f._openid || '',
            content: f.content || '',
            contact: f.contact || '',
            imageCount: Array.isArray(f.images) ? f.images.length : 0,
            device: f.device || '',
            status: f.status || 'new',
            handled_at: f.handled_at || null,
            created_at: f.created_at
          }))
        };
      }
      case 'feedbackDetail': {
        const id = selectorField(event.id, 64);
        if (!id) return { ok: false, error: 'id 非法' };
        const doc = await db.collection('feedback').doc(id).get().catch(() => null);
        if (!doc || !doc.data) return { ok: false, error: '反馈不存在或已被删除' };
        const f = doc.data;
        // 截图是 cloud:// fileID，Web 端 <img> 无法直显，换取临时可访问 URL
        const fileList = Array.isArray(f.images) ? f.images.slice(0, 9) : [];
        let urlMap = {};
        if (fileList.length) {
          const r = await cloud.getTempFileURL({ fileList }).catch(() => ({ fileList: [] }));
          for (const it of r.fileList || []) {
            if (it && it.tempFileURL) urlMap[it.fileID] = it.tempFileURL;
          }
        }
        return {
          ok: true,
          detail: {
            id: doc._id,
            openid: f._openid || '',
            content: f.content || '',
            contact: f.contact || '',
            device: f.device || '',
            status: f.status || 'new',
            created_at: f.created_at,
            handled_at: f.handled_at || null,
            images: fileList.map((fileID) => ({ fileID, url: urlMap[fileID] || '' }))
          }
        };
      }
      case 'feedbackUpdate': {
        const id = selectorField(event.id, 64);
        if (!id) return { ok: false, error: 'id 非法' };
        if (event.status !== 'new' && event.status !== 'done') {
          return { ok: false, error: 'status 需为 new / done' };
        }
        const now = new Date();
        const data = { status: event.status, updated_at: now };
        if (event.status === 'done') {
          data.handled_at = now;
          data.handled_by = 'admin';
        } else {
          data.handled_at = null;
          data.handled_by = '';
        }
        const r = await db.collection('feedback').doc(id).update({ data });
        return { ok: true, updated: (r.stats && r.stats.updated) || 0 };
      }
      case 'feedbackDelete': {
        const id = selectorField(event.id, 64);
        if (!id) return { ok: false, error: 'id 非法' };
        const doc = await db.collection('feedback').doc(id).get().catch(() => null);
        const images =
          doc && doc.data && Array.isArray(doc.data.images) ? doc.data.images.slice(0, 50) : [];
        if (images.length) {
          await cloud.deleteFile({ fileList: images }).catch(() => {});
        }
        const r = await db.collection('feedback').doc(id).remove();
        return { ok: true, removed: (r.stats && r.stats.removed) || 0 };
      }

      default:
        return { ok: false, error: 'unknown action' };
    }
  } catch (e) {
    // 错误详情只进日志：不回传 DB/SDK 原始 message（集合名、索引提示等便于侦察）
    console.error('[admin] action 失败', action, e);
    return { ok: false, error: 'internal error' };
  }
};
