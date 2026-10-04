const letterService = require('../../services/letter.js');
const draftService = require('../../services/draft.js');
const themeService = require('../../services/theme.js');
const memberService = require('../../services/member.js');
const handoff = require('../../services/handoff.js');
const { DATA_SOURCE } = require('../../config/env.js');

// 会员过期横幅「已读」标记：点一次横幅即落此标记不再显示；重新开通会员（回 VIP）时清除，
// 下次再过期仍会提示。只在首页读写，member 服务不感知（纯 UI 引导，不参与会员态判定）。
const EXPIRED_BANNER_KEY = 'member_expired_banner_dismissed';

// 今日来信（local 态）：同一天固定同一封（按日期种子确定性随机，次日重摇）；
// 云端态由 today 云函数按「用户+日期」确定并返回 todayId（BR-07，见架构文档 §5.2）
function pickTodayLetter(letters) {
  if (!letters.length) return null;
  const now = new Date();
  const daySeed = now.getFullYear() * 366 + (now.getMonth() + 1) * 31 + now.getDate();
  return letters[daySeed % letters.length];
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

// ≤8 封时基于信件 ID 生成 ±2° 伪随机倾角；超过 8 封收敛为整齐网格（倾角 0）。ID 兼容数字与字符串
function applyTilt(letters, isTidy) {
  if (isTidy) {
    return letters.map((l) => ({ ...l, tilt: 0 }));
  }
  return letters.map((l) => {
    const seed = typeof l.id === 'number' ? l.id : String(l.id).split('').reduce((s, c) => s + c.charCodeAt(0), 0);
    return { ...l, tilt: ((seed * 37) % 5) - 2 };
  });
}

// 信件日期文案：按创建时间补出「N月N日」（信件数据由 letter 服务提供）
function dateTextOf(letter) {
  if (letter.dateText) return letter.dateText;
  const n = new Date(letter.created_at || Date.now());
  return (n.getMonth() + 1) + '月' + n.getDate() + '日';
}

Page({
  data: {
    statusBarHeight: 20,
    // 冷启动骨架：initialRenderingCache static 用初始 data 渲染首帧（骨架态），
    // 首次数据到达后切真实内容；此后 onShow 刷新不再回骨架
    loading: true,
    letters: [],
    todayLetter: null,
    todayStamp: '',
    todayYear: '',
    draftCount: 0,
    hasLetters: false,
    isTidy: false,
    // 信封预取节点（见 openDetail / prefetchEnv）：初始为空不挂载
    preEnv: '',
    preEnvFull: '',
    // 新用户福利引导（会员中心可领 3 天体验会员）：服务端判定 trialAvailable，
    // 这里只负责显示横幅与跳转 —— 纯引导，不在首页发放/领取
    trialAvailable: false,
    // 会员过期横幅：服务端判定 expired（曾有会员但已到期）才显示，点一次即消失
    memberExpiredBanner: false
  },

  onLoad() {
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });
    // 首次加载交给 onShow（onLoad 后必然触发 onShow，这里再拉一次会重复请求）
  },

  onShow() {
    // 寄出流程回传的"新信落格"标记：消费后对刚寄出的那封信播落定动效
    let arrivingId = '';
    const flag = wx.getStorageSync('letter_just_arrived');
    if (flag) {
      wx.removeStorageSync('letter_just_arrived');
      arrivingId = flag;
    }
    this.loadMailbox(arrivingId);
    if (arrivingId) {
      // 动效播完（约 500ms）移除到达标记，避免后续刷新重播
      setTimeout(() => {
        if (!this.data.letters.some((l) => l.arriving)) return;
        this.setData({
          letters: this.data.letters.map((l) => (l.arriving ? { ...l, arriving: false } : l))
        });
      }, 800);
    }
  },

  // 信匣数据经 letter 服务获取（真实寄出的信排最前，演示数据按 DEMO_STATE 接入）；
  // 草稿横条按真实草稿显示（云端 today 聚合返回 draftCount，本地读 draft 服务）
  loadMailbox(arrivingId) {
    // 云模式下 today 聚合接口已返回 draftCount，无需再单独调 draft 服务
    const tasks = [letterService.getAll(), themeService.getThemes(), memberService.getMembership()];
    if (DATA_SOURCE !== 'cloud') tasks.push(draftService.list());
    Promise.all(tasks).then(
      ([box, themes, m, drafts]) => {
        const isVip = !!(m && m.state === 'vip');
        // 供 openDetail 在跳转前解析主题（专属主题对非 VIP 要回落默认款）：
        // 会员态与主题列表都留一份**本次渲染用的快照** —— 详情页首帧画的必须与用户刚点的那张
        // 卡片逐字同源（同一份 themes 算出来的信封），不能改走 cachedThemes() 那个随时会
        // 被 1h TTL 刷新的全局缓存（与 clips.js 同做法）
        this._isVip = isVip;
        this._themes = themes;
        // 回形针优先展示（BR-06）：只改排序，不改视觉
        const sorted = [...box.list].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
        const isTidy = sorted.length > 8;
        const now = new Date();

        // 只挑 WXML 渲染所需字段进 setData：question/answer 全文（单封可达数百字）
        // 不进渲染层，信匣网格每次 onShow 刷新的序列化体积与信件数量解耦
        const letters = applyTilt(sorted, isTidy).map((l) => ({
          id: l.id,
          name: l.name,
          dateText: dateTextOf(l),
          env: themeService.envelopeThumbOf(l.theme_id, themes, isVip),
          tilt: l.tilt,
          pinned: !!l.pinned,
          // 刚寄出的信：落格动效（淡入 + 10px 落定）
          arriving: !!(arrivingId && l.id === arrivingId)
        }));

        // 云端已确定今日来信（BR-07 同日固定）时直接命中，否则本地按日期种子随机
        const todayLetter = box.todayId
          ? letters.find((l) => l.id === box.todayId) || pickTodayLetter(letters)
          : pickTodayLetter(letters);

        // 进详情的动画首帧提示（id + 名称 + 主题）：列表投影刻意只带渲染所需字段（见上），
        // 这里另存一份按 id 取用，点开信封时经 services/handoff.js 在跳转前交给详情页。
        // **id 必须在** —— handoff.take() 会拿它与详情页的 options.id 比对，缺了就对不上，
        // 整份交接被丢弃（拆信幕退回「不画信封」，等于白交）。
        this._hints = {};
        for (const l of sorted) this._hints[String(l.id)] = { id: l.id, name: l.name, theme_id: l.theme_id };

        // 会员过期横幅（BR：过期告知）：云端 get 对「曾有会员但 expires_at 已过」回 expired
        // 标记（与从未开通区分）。点过一次就落 storage 标记不再显示；重新开通成为 VIP 时
        // 清掉标记，下次再过期仍会提示。读取失败（m 为 free 兜底）不带 expired，不会误报。
        if (isVip && wx.getStorageSync(EXPIRED_BANNER_KEY)) {
          wx.removeStorageSync(EXPIRED_BANNER_KEY);
        }
        const memberExpiredBanner = !!(m && m.expired) && !wx.getStorageSync(EXPIRED_BANNER_KEY);

        this.setData({
          loading: false,
          letters,
          draftCount: Math.max(box.draftCount || 0, Array.isArray(drafts) ? drafts.length : 0),
          hasLetters: letters.length > 0,
          isTidy,
          todayLetter,
          todayStamp: letters.length ? pad2(now.getMonth() + 1) + '.' + pad2(now.getDate()) : '',
          todayYear: letters.length ? String(now.getFullYear()) : '',
          trialAvailable: !!(m && m.trialAvailable),
          memberExpiredBanner
        });
      })
      .catch((err) => {
        // 信匣加载失败不再静默空白：报错留痕 + 温和提示（文案语气见设计规范）；
        // 骨架同时撤下，避免失败后停在占位态
        console.error('[home] 信匣加载失败', err);
        this.setData({ loading: false });
        wx.showToast({ title: '信匣暂时没有打开，稍后再来试试', icon: 'none' });
      });
  },

  onTapTodayLetter() {
    if (!this.data.todayLetter) {
      this.onTapWrite();
      return;
    }
    // 今日来信直接进入拆信/详情页
    this.openDetail(this.data.todayLetter.id);
  },

  // 新用户福利横幅：纯引导 —— 跳会员中心领取（领取动作只发生在会员中心，云端校验资格）
  onTapTrialBanner() {
    wx.navigateTo({ url: '/pages/member/member' });
  },

  // 会员过期横幅：点击进会员中心，同时落「已读」标记让横幅消失（点一次即消失）。
  // 重新开通会员后标记会被清掉（见 loadMailbox），下次再过期仍会提示。
  onTapExpiredBanner() {
    wx.setStorageSync(EXPIRED_BANNER_KEY, Date.now());
    this.setData({ memberExpiredBanner: false });
    wx.navigateTo({ url: '/pages/member/member' });
  },

  onTapLetter(e) {
    // 跳转拆信/详情页（每次拆信产生一条重读记录 BR-09，在详情页内自动记录）
    this.openDetail(e.currentTarget.dataset.id);
  },

  // 进入拆信/详情页：把列表里已知的名称与主题**在跳转前**放进同步交接槽，
  // 详情页 onLoad 同步取用 —— 拆信动画首帧就画对信封与名字，不必等云调用回来。
  // 不能走事件通道：emit 在 navigateTo 的 success 回调里，而时序是
  // 「目标页 onLoad/onShow → 首帧渲染 → success」，emit 到得比首帧还晚。
  openDetail(id) {
    const hint = this._hints && this._hints[String(id)];
    if (hint) {
      const theme = themeService.themeOf(hint.theme_id, this._themes || themeService.cachedThemes(), this._isVip);
      handoff.put({
        id: hint.id,
        name: hint.name,
        // 与列表缩略图同一个解析出口（未知 theme_id、非 VIP 的专属款都回落第一套）：
        // 详情页首帧画的，就是用户刚点的那张卡片上的信封
        theme
      });
      this.prefetchEnv(theme);
    }
    wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(id) });
  },

  // 点按即预取该信封的两级素材（非阻塞、失败静默）：本页挂上屏幕外节点立刻开始
  // 「fileID→临时URL→下载」，比详情页拆信幕自己的两级 src 早一个导航转场。图片缓存
  // 按 URL 全局共享（拆信幕首帧的小图正是靠它命中列表页渲染过的那张），云端主题
  // （如「印花」，素材在云存储）由此大概率在动画第一帧前就绪。包内素材（小王子）秒加载，无感。
  prefetchEnv(theme) {
    const thumb = (theme && theme.envelopeThumb) || '';
    const full = (theme && theme.envelope) || '';
    this.setData({ preEnv: thumb, preEnvFull: full !== thumb ? full : '' });
  },

  onTapDrafts() {
    // 草稿横条：回写信第一步（write 页保持空白新信、不自动预填，未写完的草稿
    // 以卡片陈列在书写区下方，点击卡片才载入续写，PRD 5.3）
    wx.navigateTo({ url: '/pages/write/write' });
  },

  onTapWrite() {
    // 跳转写信第一步「写下这封信」
    wx.navigateTo({ url: '/pages/write/write' });
  }
});
