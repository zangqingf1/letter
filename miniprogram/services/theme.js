// 主题服务（技术架构文档.md §4.6）
// 主题与信纸版式统一出口：云端走 theme 云函数（themes / papers 集合，由 Web 后台维护），
// 空或失败一律回落本地静态配置（write/themes.js、write/papers.js），保证离线可用。
// 页面统一从这里取，不再各自 require themes.js。
const { DATA_SOURCE } = require('../config/env.js');
const cloud = require('./cloud.js');
const LOCAL_THEMES = require('../pages/write/themes.js');
const LOCAL_PAPERS = require('../pages/write/papers.js');

const CACHE_KEY = 'theme_cache';
const PAPERS_CACHE_KEY = 'papers_cache';
const CACHE_TTL = 60 * 60 * 1000; // 1h：后台改主题/版式/专属内容后尽快生效
// 缓存结构版本：v2 起信封大图下沉云存储（envelope 可为空/为 cloud://）。v1 缓存里的
// envelope 还是已删除的包内路径（渲染层报 Failed to load image / 127.0.0.1），必须
// 整体作废重拉 —— 版本号写入缓存对象，读取时不匹配即视为无缓存。改字段语义时记得递增。
const CACHE_VERSION = 2;

// 默认款 / 回落款（2026-09-20 起显式按 id 解析，不再依赖「列表第一套」）：
//   信纸默认 = 留白志 liubai；主题默认 = 璀璨如初 cuican。
// 云端列表按后台 sort 排序，第一套是谁由数据决定；显式 id 保证云端/本地回落口径一致，
// 后台怎么排序都不影响默认款。列表里找不到默认 id 时才退 list[0]（防御性兜底）。
const DEFAULT_THEME_ID = 'cuican';
const DEFAULT_PAPER_ID = 'liubai';

function pickDefault(list, id) {
  const arr = list || [];
  return arr.find((it) => it.id === id) || arr[0];
}

// 主题与版式合并取回（theme 云函数 all action）：详情/写信第二步/分享页每次进入都要
// 成对使用，分两次调用多付一次往返（冷启动场景可达秒级）。这里用一份 in-flight Promise
// 去重 —— getThemes 与 getPapers 同帧调用只发一次云函数，结果各写各的缓存
// （键不变，结构带 CACHE_VERSION 版本号：v1 旧缓存读取时整体作废重拉一次，
// 见 CACHE_VERSION 处注释 —— 大图下沉改造改了字段语义，不能沿用旧结构）。
// list / papers 两个 action 保留在云函数里给旧版客户端，前端一律走 all。
let allPending = null;
function fetchAll() {
  if (allPending) return allPending;
  allPending = cloud
    .call('theme', 'all', {})
    .then((r) => {
      allPending = null;
      const themes = normalizeThemes((r && r.themes) || []);
      const papers = normalizePapers((r && r.papers) || []);
      // 与旧版同口径：云端为空的类别不写缓存，读取侧回落本地静态配置
      if (themes.length) wx.setStorageSync(CACHE_KEY, { v: CACHE_VERSION, at: Date.now(), list: themes });
      if (papers.length) wx.setStorageSync(PAPERS_CACHE_KEY, { v: CACHE_VERSION, at: Date.now(), list: papers });
      return {
        themes: themes.length ? themes : normalizeThemes(LOCAL_THEMES),
        papers: papers.length ? papers : normalizePapers(LOCAL_PAPERS)
      };
    })
    .catch((err) => {
      allPending = null;
      throw err;
    });
  return allPending;
}

// 主题统一出口。force=true 时绕过本地缓存强刷（会员页用于即时展示后台新增的专属款）。
function getThemes(force) {
  if (DATA_SOURCE === 'cloud') {
    const cached = wx.getStorageSync(CACHE_KEY);
    if (!force && cached && cached.v === CACHE_VERSION && Date.now() - cached.at < CACHE_TTL && cached.list && cached.list.length) {
      // 读时再归一化一遍（幂等）：缓存若是在 liveSrc/字段兜底上线前写入的，
      // 里面可能还残留死路径等旧值，读时过滤保证出口永远干净
      return Promise.resolve(normalizeThemes(cached.list));
    }
    return fetchAll()
      .then((r) => r.themes)
      .catch(() => normalizeThemes(LOCAL_THEMES));
  }
  return Promise.resolve(normalizeThemes(LOCAL_THEMES));
}

// 同步读主题缓存（不发云调用）：详情页拆信动画要在首帧就画对信封与纸色，而云调用是异步的，
// 进页面时先同步取一份（无缓存返回空数组，调用方回落默认款）。写入仍只发生在 getThemes。
function cachedThemes() {
  if (DATA_SOURCE !== 'cloud') return normalizeThemes(LOCAL_THEMES);
  const cached = wx.getStorageSync(CACHE_KEY);
  if (cached && cached.v === CACHE_VERSION && cached.list && cached.list.length) return normalizeThemes(cached.list);
  return [];
}

// 主题字段归一化：信纸已是配色排版（无纸张图片），信封素材未就绪的主题
// 回落默认主题信封，palette/desk 缺失时回落默认主题，页面可零判断直接使用。
// palette 只认底色 base（墨色由版式自持）：判空必须判到 base 本身 —— 后台把底色清空后
// 存下来的是 { base: '' }，整体为真值，若写成 t.palette || def.palette 会让拆信动画
// 拿到空 background 画出一张透明纸，而不是回落默认款。
// ownEnvelope 标记是否有自有信封素材（无素材的主题在选择卡片上用色样展示，
// 避免所有卡片都渲染成同一张默认信封图）
function uniqueById(list) {
  const seen = {};
  return (list || []).filter((it) => (seen[it.id] ? false : (seen[it.id] = true)));
}

// 包内大图已全部删除（2026-10 下沉云存储，包内只留 thumb）：云端记录若残留
// `/assets/theme/<id>/envelope.jpg` 这类包内大图路径必然 404（渲染层报 Failed to
// load image / 127.0.0.1），这里当「未配置」丢弃，走 thumb 兜底静默回落；迁移完成
// 后云端值是 cloud:// 真值不受影响。注意只杀大图（/envelope.jpg 结尾）—— 包内
// 缩略图 envelope-thumb.jpg 依然存在且合法，不能误杀（否则 thumb 兜底链会掉到
// cloud:// 大图上，列表行白白解码高清图）。
function liveSrc(v) {
  if (typeof v !== 'string' || !v) return '';
  if (v.indexOf('/assets/') === 0 && /\/envelope\.jpg$/.test(v)) return '';
  return v;
}

function normalizeThemes(list) {
  const def = pickDefault(LOCAL_THEMES, DEFAULT_THEME_ID);
  return uniqueById((list || []).map((t) => {
    const env = liveSrc(t.envelope);
    const thumb = liveSrc(t.envelopeThumb);
    return Object.assign({}, t, {
      // ownEnvelope = 是否有可用的信封图（大图或缩略图任一即可）：2026-10 起大图下沉
      // 云存储、本地回落的 envelope 为空，卡片只靠 thumb 渲染，判定必须把 thumb 算进去，
      // 否则本地/离线场景所有卡片都退化成色样。死路径不算素材（按未配置处理）。
      ownEnvelope: !!(env || thumb),
      // envelope 兜底到 thumb：大图下沉云存储后，云端记录未配好（或本地/离线回落）时
      // envelope 可能为空，而写信完成幕、会员中心预览直接绑 envelope，为空就白块。
      // 回落 thumb 后这些位置至少有图（缩略图放大略糊但可见）；云端记录配好 cloud://
      // 后 t.envelope 为真值，自然走回大图，本兜底自动失效。
      envelope: env || thumb || def.envelopeThumb,
      envelopeThumb: thumb || env || def.envelopeThumb,
      palette: (t.palette && t.palette.base) ? t.palette : def.palette,
      desk: t.desk || def.desk,
      swatch: t.swatch || (t.palette && t.palette.base) || (def.palette && def.palette.base) || ''
    });
  }));
}

// 会员专属回退：非 VIP 时专属主题/版式一律按默认款渲染（老信不破坏数据，
// 开通会员后自动恢复，见 AGENTS.md 会员专区）。isVip 由各页面经 member 服务传入。
// 免费尝鲜款（freeTrial:true，如鎏金笺）带 premium 标记但不锁定：所有人可免费封存使用。
function isLocked(item, isVip) {
  return !!(item && item.premium && !item.freeTrial) && !isVip;
}

// 主题解析（同步，无云调用）：未知/缺失 theme_id 回落默认款（璀璨如初，按 id 显式解析），
// 非 VIP 的专属款同样回落默认款（会员过期后老信按默认款渲染，开通后自动恢复）。
// themes 传空（冷启动无缓存）回落本地静态配置 —— 与 paperOf 同口径，调用方可以直接拿它画首帧。
//
// 这是「列表卡片」与「详情拆信幕」**唯一的主题解析出口**：入口页在 navigateTo 之前
// 用它解析好这封信的主题、经 services/handoff.js 交给详情页，于是两处首帧画的一定是
// 同一张信封（详情页不再自己猜主题，也不会因为事件通道/云函数晚到而先亮默认款）。
function themeOf(themeId, themes, isVip) {
  const list = themes && themes.length ? themes : normalizeThemes(LOCAL_THEMES);
  const theme = list.find((t) => t.id === themeId) || pickDefault(list, DEFAULT_THEME_ID);
  return isLocked(theme, isVip) ? pickDefault(list, DEFAULT_THEME_ID) : theme;
}

// 网格/列表用小图信封：首页信匣、回形针列表、废纸篓行的缩略信封（避免解码高清大图）；未配置时回落主信封。
// 空数组与 null 同等回落本地静态配置（与 paperOf 同口径）：cachedThemes() 在冷启动无缓存时
// 返回 []，调用方要能直接拿它画首帧，不能在这里炸掉。
function envelopeThumbOf(themeId, themes, isVip) {
  const list = themes && themes.length ? themes : LOCAL_THEMES;
  const theme = themeOf(themeId, themes, isVip);
  const def = pickDefault(list, DEFAULT_THEME_ID);
  return theme.envelopeThumb || theme.envelope || def.envelopeThumb || def.envelope || '';
}

// 信纸版式（主题只绑信封与配色，版式独立选择）
// 云端 papers 集合由 Web 后台维护（admin 云函数），theme 云函数 papers action 下发
// （官方二十一款 + 会员专属版式，专属款带 premium:true）；云端为空/失败/本地模式一律
// 回落本地静态配置，保证离线可用。force=true 绕过缓存强刷（会员页用于即时展示后台新增的专属款）。
// 归一化兜底：字段缺失的项剔除，同一 id 去重，保证页面拿到的版式都可用于渲染。
function normalizePapers(list) {
  return uniqueById((list || []).filter((p) => p && p.id && p.name));
}

function getPapers(force) {
  if (DATA_SOURCE !== 'cloud') return Promise.resolve(normalizePapers(LOCAL_PAPERS));
  // 与 getThemes 同口径的本地缓存：详情/分享/写信第二步每次进入都取版式，
  // 无缓存会每次都打一次 theme 云函数（含 member_items 聚合）。
  const cached = wx.getStorageSync(PAPERS_CACHE_KEY);
  if (!force && cached && cached.v === CACHE_VERSION && Date.now() - cached.at < CACHE_TTL && cached.list && cached.list.length) {
    return Promise.resolve(cached.list);
  }
  // 与 getThemes 共享同一次 all 调用（fetchAll 内有 in-flight 去重），不再单独打 papers
  return fetchAll()
    .then((r) => r.papers)
    .catch(() => normalizePapers(LOCAL_PAPERS));
}

// 同步读版式缓存（不发云调用）：会员页首帧要立刻画出后台配置的专属款，
// 而 getPapers 是异步的；无缓存返回空数组，调用方回落本地静态配置。
// 与 cachedThemes 同口径，写入仍只发生在 getPapers。
function cachedPapers() {
  if (DATA_SOURCE !== 'cloud') return normalizePapers(LOCAL_PAPERS);
  const cached = wx.getStorageSync(PAPERS_CACHE_KEY);
  if (cached && cached.v === CACHE_VERSION && cached.list && cached.list.length) return cached.list;
  return [];
}

// 信件版式解析：未知/缺失 paper_id 回落默认款留白志（老信件视觉零跳变）；
// 非 VIP 的专属版式同样回落默认款（会员过期后老信按默认信纸渲染）
function paperOf(paperId, papers, isVip) {
  const list = papers && papers.length ? papers : normalizePapers(LOCAL_PAPERS);
  const paper = list.find((p) => p.id === paperId) || pickDefault(list, DEFAULT_PAPER_ID);
  return isLocked(paper, isVip) ? pickDefault(list, DEFAULT_PAPER_ID) : paper;
}

// 会话级「信封大图已下载」登记表：微信图片缓存按地址全局共享，某张大图在本会话内
// bindload 过一次后，再绑同一地址就是缓存秒出。拆信幕据此决定首帧直接画大图还是
// 先画小图等大图顶上（见 pages/detail/detail.js 的 envPatchOf）。登记来源：
// 入口页预取节点 / 首页 Wi-Fi 批量预取 / 详情页大图顶上（onEnvFullLoaded）。
// 只存内存不落 storage —— 冷启动后框架缓存是否仍在无法确知，宁可当作没下过
//（退回小图兜底，不会白块；小王子等包内素材本来就秒出，不受影响）。
const envReadySet = {};
function markEnvReady(src) {
  if (typeof src === 'string' && src) envReadySet[src] = true;
}
function isEnvReady(src) {
  return !!(src && envReadySet[src] === true);
}

module.exports = {
  getThemes, cachedThemes, themeOf, envelopeThumbOf, getPapers, cachedPapers, paperOf,
  isLocked,
  markEnvReady, isEnvReady,
  DEFAULT_THEME_ID, DEFAULT_PAPER_ID
};
