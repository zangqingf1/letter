// 03 · 信件详情 / 拆信阅读 / 回信
// 状态：多次拆开（邮戳墙 + 多条回信 + 回形针点亮）/ 首次拆开（1 枚邮戳 0 回信）/ 回信半屏弹层。
// 进入即播放拆信动画（开头 0.65s 静置缓冲 + 1.69s 动画，全程 ≤2.34s 可点击跳过），并按 BR-09 自动产生一条重读记录。

const letterService = require('../../services/letter.js');
const themeService = require('../../services/theme.js');
const memberService = require('../../services/member.js');
const analytics = require('../../services/analytics.js');
// 入口页在跳转前写好、本页 onLoad 同步取用的主题交接（见文件头「拆信幕」注释）
const handoff = require('../../services/handoff.js');
// 本地默认款（services/theme.js DEFAULT_THEME_ID = 'cuican' 璀璨如初，按 id 显式解析）：
// 只借它的纸色给拆信幕兜底，信封一律不借
const THEMES = require('../write/themes.js');
// data 初始默认信纸版式（DEFAULT_PAPER_ID = 'liubai' 留白志）；实际版式在 loadLetter 中按信件 paper_id 经 theme 服务解析
const PAPERS = require('../write/papers.js');
// 信纸渲染数据（共享模板 paper.wxml 只认 view 字段，与写信预览/分享图同构）
const { buildView, longDate } = require('../write/paper-view.js');

// 埋点统一走 analytics 服务（事件名见 PRD 第十三节）
function track(event, data) {
  analytics.track(event, data);
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function sameDay(a, b) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

// 收起态邮戳展示上限（最早 5 枚 + 今天，其余收进「+N 展开」，对应低保真状态 2）
const SHOW_STAMPS = 6;
// 拆信幕的初始主题：**只有纸色，没有信封**。
// 这里曾是 `THEMES[0]`（本地默认款小王子），于是任意一封信的拆信动画开场都先亮出
// 小王子的信封 —— 因为真主题原来有两条**异步**来源（入口页事件通道的 emit、loadLetter
// 的云函数），而 navigateTo 的时序是「目标页 onLoad/onShow → **首帧渲染** → 源页 success
// 回调」，emit 比首帧还晚。纯云端主题（如「印花」，信封素材在云存储）最刺眼：
// <image> 换 src 期间旧图还挂着，云图加载失败时整段 1.3s 动画就停在默认款上。
// 现在改成入口页**跳转前**解析好主题、经 services/handoff.js 同步交接，onLoad 里与
// statusBarHeight 同一批 setData ⇒ 首帧渲染的就是这封信真正的信封。
// 本常量只兜「没有交接」的情形（从外部直接打开本页，如开发预览）：此时不画任何信封
// （detail.wxml 按「有信封才画」渲染），等 loadLetter 回来再画，绝不凭空亮出默认款。
const BLANK_THEME = {
  id: '',
  name: '',
  envelope: '',
  envelopeThumb: '',
  ownEnvelope: false,
  palette: Object.assign({}, (THEMES.find((t) => t.id === 'cuican') || THEMES[0]).palette)
};

// 拆信幕信封的两级 src：**能画大图就画大图**（用户明确反馈小图放大糊），小图只作
// 「大图还没进缓存」的兜底。首帧直接画大图的两个条件 —— 本页已经顶上过（loadedFull，
// 回源换主题对象不回退），或登记表里这张大图本会话已下载过（themeService.isEnvReady：
// 入口页预取/首页 Wi-Fi 批量预取/上次打开同一主题时下载的，框架缓存按地址共享，秒出）。
// 其余情形仍先画小图：从没下过的大图直接绑 cloud://，首帧是透明占位等淡入，慢网时
// 整段动画都见不到信封 —— 这正是当年两级 src 要解决的问题，不能倒退。
// 云端没单独配小图（归一化时回落主图）时两者同源，只画一张。
// envFade：信封图与信封名**同拍淡入**的开关 —— 只要有图就挂 fade：挂载即透明，
// 大图 bindload 后两者同时淡入浮现（用户明确要求「大图和名称同时出现同时淡入」，
// 包内小图曾因不挂 fade 而让名字在进入瞬间直接蹦出来）。envIn 不在这里重置 ——
// 由 onEnvImgLoad 置位后保持，回源换主题/大图顶上的换 src 不重播淡入（换 src 期间
// 旧图一直挂着，本就无缝）。
function envPatchOf(theme, loadedFull) {
  const full = (theme && theme.envelope) || '';
  const thumb = (theme && theme.envelopeThumb) || '';
  const fullReady = !!full && ((loadedFull && full === loadedFull) || themeService.isEnvReady(full));
  const src = fullReady ? full : thumb || full;
  return {
    envSrc: src,
    envFull: full && full !== src ? full : '',
    envFade: !!src
  };
}

// 拆信动画总时长 = 全程节奏 ×1.3 后的口径：0.65s 开场静置缓冲（仅整幕与信纸延迟，
// 信封本体不延迟——「等图」由 .us-env-img.fade 的 bindload 淡入处理；wxss 的
// unseal-fade/paper-out 的 delay 与此同步）+ 1.69s 动画本体；REVEAL_CAP_MS 是揭幕
// 兜底 —— 数据迟迟不到也不让页面停在动画上
const OPEN_ANIM_MS = 2340;
const REVEAL_CAP_MS = 4000;

Page({
  data: {
    statusBarHeight: 20,
    letter: { name: '', question: '', answer: '' },
    theme: BLANK_THEME,
    // 拆信幕信封：envSrc 是实际在画的那张（能画大图就画大图，见 envPatchOf；没进过
    // 缓存时首帧=列表缓存的小图），envFull 是待顶上的大图；
    // envFade=云端素材挂载即透明、envIn=已加载完可淡入（见 envPatchOf / onEnvImgLoad）
    envSrc: '',
    envFull: '',
    envFade: false,
    envIn: false,
    paper: PAPERS.find((p) => p.id === 'liubai') || PAPERS[0],
    view: buildView({ name: '', question: '', answer: '' }, { created: new Date() }),
    openCount: 0,
    stamps: [],
    moreChip: null,
    stampsExpanded: false,
    replyCount: 0,
    replies: [],
    pinned: false,
    opening: true, // 拆信动画播放中
    openStampText: '',
    replyOpen: false,
    todayLongText: '',
    keyboardHeight: 0,
    noteToast: false
  },

  onLoad(options) {
    const id = options && options.id;
    const win = wx.getWindowInfo();
    const patch = { statusBarHeight: win.statusBarHeight || 20 };

    // 入口页（信匣 / 回形针）在跳转**之前**放进交接槽的主题与名字：与 statusBarHeight
    // 同一批 setData，所以首帧渲染的就是这封信真正的信封与名字 —— 零等待，且不依赖
    // 事件通道（emit 在 navigateTo success 里，比首帧还晚）与云函数（更晚）。
    // 信封两级 src：先画列表页缓存里的小图，大图由 wxml 的预取节点加载完顶上。
    const hint = handoff.take(id);
    if (hint) {
      if (hint.theme) Object.assign(patch, envPatchOf(hint.theme), { theme: hint.theme });
      if (hint.name) patch.letter = Object.assign({}, this.data.letter, { name: hint.name });
    }
    this.setData(patch);

    this.loadLetter(id);

    // 揭幕 = 动画播完 且 数据就绪（见 revealIfReady）：数据晚于动画时停在拆信幕上，
    // 避免先露一张空白信纸；revealCap 兜住加载异常，不让页面永久停在动画
    this.openTimer = setTimeout(() => this.onAnimDone(), OPEN_ANIM_MS);
    this.revealCap = setTimeout(() => this.onDataReady(), REVEAL_CAP_MS);
  },

  onUnload() {
    if (this.openTimer) clearTimeout(this.openTimer);
    if (this.revealCap) clearTimeout(this.revealCap);
  },

  onShow() {
    // 首次显示由 onLoad 负责；此后（从编辑/分享返回）重读信件刷新内容
    if (!this._shownOnce) {
      this._shownOnce = true;
      return;
    }
    if (!this.isDemo && this.data.letter && this.data.letter.id) {
      this.loadLetter(this.data.letter.id, true);
    }
  },

  // 读取信件（经 letter 服务：真实寄出的信优先，否则演示数据预览态）并记录重读。
  // record: true → 云端在 letter.get 同一次调用内落重读记录并返回邮戳墙（BR-09，同日幂等），
  // 页面不再单独打一次 open 云函数：渲染路径上只有一轮云函数往返。
  // isRefresh：从编辑/分享返回后的内容刷新，不重复上报拆信埋点（BR-09 今日记录本就幂等）
  loadLetter(id, isRefresh) {
    Promise.all([
      letterService.get(id, { record: true }),
      themeService.getThemes(),
      themeService.getPapers(),
      memberService.getMembership()
    ]).then(([res, themes, papers, m]) => {
      const letter = res.letter;
      const isVip = !!(m && m.state === 'vip');
      this.isDemo = res.isDemo;

      // 主题解析：未知 theme_id 与非 VIP 的专属款都回落默认主题（会员过期后老信回退，
      // 开通后自动恢复）。与入口页跳转前交接用的是同一个出口，首帧到回源不会跳款。
      const theme = themeService.themeOf(letter.theme_id, themes, isVip);
      // 信纸版式解析（未知/缺失 paper_id 回落列表第一套；非 VIP 专属版式同样回落默认）
      const paper = themeService.paperOf(letter.paper_id, papers, isVip);
      const today = new Date();
      const created = new Date(letter.created_at);
      // 落款长日期（三端同口径）：写于
      const dateText = longDate(created);
      // 信纸渲染数据（票面日期/编号/首字下沉等由此派生，与预览/分享一致）
      const view = buildView(letter, { created: created, dateText: dateText });

      if (!isRefresh) track('letter_open', { letter_id: letter.id });

      // 一次 setData 带齐主信、邮戳墙与回信流（原生层只通信一次）
      this.setData({
        letter,
        theme,
        // 信封 src 按回源后的主题重算（首帧那份来自交接槽，正常情况这里一致）
        ...envPatchOf(theme, this._envFullLoaded),
        paper,
        view,
        pinned: !!letter.pinned,
        openStampText: pad2(today.getMonth() + 1) + '.' + pad2(today.getDate()),
        todayLongText: today.getFullYear() + '年' + (today.getMonth() + 1) + '月' + today.getDate() + '日',
        ...this.buildRecords(letter.opens || []),
        ...this.buildReplies(letter.replies || [])
      });
      this.onDataReady();
    })
    .catch((err) => {
      console.error('[detail] 信件读取失败', err);
      wx.showToast({ title: '这封信暂时取不出来，稍后再来试试', icon: 'none' });
      // 失败也要揭幕：停在拆信幕上更像卡死（原因已由 Toast 说明）
      this.onDataReady();
    });
  },

  // 邮戳列表：收起时展示最早 5 枚 + 今天一枚，其余收进「+N 展开」
  // expanded：显式传入展开态（onToggleStamps 合并 setData 时 data 尚未更新，须传切换后的值）
  buildRecords(opens, expanded) {
    const stampsExpanded = expanded !== undefined ? expanded : this.data.stampsExpanded;
    const now = Date.now();
    const all = opens.map((ts) => {
      const d = new Date(ts);
      const isToday = sameDay(ts, now);
      return {
        ts,
        date: pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()),
        today: isToday,
        // 戳痕成行版式：每枚邮戳都带印文（旧戳「重读」、今日戳「今天」）
        label: isToday ? '今天' : '重读'
      };
    });
    let stamps = all;
    let moreChip = null;
    if (!stampsExpanded && all.length > SHOW_STAMPS) {
      const head = all.slice(0, SHOW_STAMPS - 1);
      const todayStamp = all[all.length - 1];
      stamps = todayStamp.today ? head.concat([todayStamp]) : all.slice(0, SHOW_STAMPS);
      moreChip = { count: all.length - stamps.length };
    }
    return { openCount: all.length, stamps, moreChip };
  },

  buildReplies(replies) {
    const list = replies
      .slice()
      .sort((a, b) => a.ts - b.ts)
      .map((r, i) => {
        const d = new Date(r.ts);
        return {
          ts: r.ts,
          dateText: d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()),
          // 戳痕成行版式：便签头部 mono 编目「R-01 · 06.18」
          no: 'R-' + pad2(i + 1),
          dateShort: pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()),
          text: r.text
        };
      });
    return { replyCount: list.length, replies: list };
  },

  // ── 拆信动画 / 揭幕 ──
  // 信封图就绪（仅云端 src 挂 fade 类）：挂载即透明，这里切 in 类淡入浮现，避免动画
  // 中段突现一张图。只切一次：此后大图顶上、回源换主题的换 src 都不重播淡入 ——
  // 换 src 期间旧图一直挂着，本就无缝（见 envPatchOf 的 envIn 说明）。
  onEnvImgLoad() {
    if (!this.data.envFade || this.data.envIn) return;
    this.setData({ envIn: true });
  },

  // 信封大图就绪（wxml 里那个屏幕外的预取节点）：换成大图，撤掉预取节点。
  // 记下已顶上过的大图地址 —— loadLetter 回源时主题对象会换一份新的，但大图没变，
  // 这时要接着用大图而不是退回小图（见 envPatchOf）；同时登记进会话级「已下载」表，
  // 本会话内再打开同一主题的信，首帧就直接画大图（services/theme.js markEnvReady）。
  onEnvFullLoaded() {
    const full = this.data.envFull;
    if (!full) return;
    themeService.markEnvReady(full);
    this._envFullLoaded = full;
    this.setData({ envSrc: full, envFull: '' });
  },

  // 动画播完 / 点击跳过：跳过只跳过动画，不跳过数据 —— 数据没到就揭幕等于先露一张白纸
  onAnimDone() {
    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
    this._animDone = true;
    this.revealIfReady();
  },

  // 数据就绪（拿到信件 / 读取失败 / 兜底超时）
  onDataReady() {
    if (this.revealCap) {
      clearTimeout(this.revealCap);
      this.revealCap = null;
    }
    this._dataReady = true;
    this.revealIfReady();
  },

  // 揭幕：动画与数据都就绪才撤下拆信幕
  revealIfReady() {
    if (this._revealed || !this._animDone || !this._dataReady) return;
    this._revealed = true;
    this.setData({ opening: false });
  },

  onSkipOpen() {
    this.onAnimDone();
  },

  onTapBack() {
    wx.navigateBack();
  },

  // ── 重读记录展开/收起 ──
  onToggleStamps() {
    const stampsExpanded = !this.data.stampsExpanded;
    // buildRecords 须按"切换后"的展开态计算，显式传入避免读到旧 data
    this.setData({
      stampsExpanded,
      ...this.buildRecords(this.data.letter.opens, stampsExpanded)
    });
  },

  // ── 回信弹层 ──
  // 输入内容不放 data：文本域自己持有，逐键 setData 会让每次按键都过一次渲染层
  // （本页很重：信纸模板 + 邮戳墙 + 便签流，低端机上表现为输入卡顿/丢字）。
  // 草稿存实例字段 _replyDraft，提交时读；弹层是 wx:if 挂载的，重开即空白文本域。
  onOpenReply() {
    this._replyDraft = '';
    this.setData({ replyOpen: true, keyboardHeight: 0 });
  },

  onCloseReply() {
    this._replyDraft = '';
    this.setData({ replyOpen: false, keyboardHeight: 0 });
  },

  onReplyInput(e) {
    this._replyDraft = e.detail.value;
  },

  // 软键盘避让：弹层整体向上推升（抽屉 padding-bottom 抬到键盘上方）。
  // keyboardheightchange 在键盘动画期间会连发多次，高度没变就不重复 setData
  onKeyboard(e) {
    const height = (e.detail && e.detail.height) || 0;
    if (height === this.data.keyboardHeight) return;
    this.setData({ keyboardHeight: height });
  },

  onKeyboardBlur() {
    this.setData({ keyboardHeight: 0 });
  },

  noop() {},

  onSaveReply() {
    const text = (this._replyDraft || '').trim();
    if (!text) {
      wx.showToast({ title: '写点什么再贴吧', icon: 'none' });
      return;
    }
    const letter = this.data.letter;
    // 先收键盘再发起写请求：贴上是网络操作（云函数首次调用含冷启动，可能到秒级），
    // 不让用户对着弹出的键盘干等；失败时弹层与文本域内容都原样留着，可直接重试
    if (wx.hideKeyboard) wx.hideKeyboard();
    // 回信经 letter 服务落库（BR-10：日期自动生成不可改），返回更新后的回信数组；
    // 失败保留输入内容并提示，不关闭弹层（用户可重试）
    letterService.addReply(letter, text).then((replies) => {
      track('reply_add', { letter_id: letter.id });
      this._replyDraft = '';

      // 一次 setData 带齐信件、回信流与弹层关闭态
      this.setData({
        letter,
        ...this.buildReplies(replies || []),
        replyOpen: false,
        keyboardHeight: 0,
        noteToast: true
      });
      // 便签样式轻反馈（PRD 固定文案），2 秒后淡出
      setTimeout(() => this.setData({ noteToast: false }), 2000);
    }).catch((err) => {
      console.error('[detail] 回信保存失败', err);
      wx.showToast({ title: '回信没有贴上，再试一次吧', icon: 'none' });
    });
  },

  // ── 撕掉回信（便签右上角入口：物理删除不进废纸篓，二次确认）──
  onTapReplyDelete(e) {
    const ts = Number(e.currentTarget.dataset.ts);
    wx.showModal({
      title: '撕掉这封回信？',
      content: '撕掉后这段回信就找不回来了。',
      confirmText: '撕掉',
      cancelText: '留下',
      confirmColor: '#6E7570',
      success: (res) => {
        if (!res.confirm) return;
        const letter = this.data.letter;
        // 按 ts 精确删除单条回信，经 letter 服务落库（演示信会先落成真实信）
        letterService.removeReply(letter, ts).then((replies) => {
          this.setData({
            letter,
            ...this.buildReplies(replies || [])
          });
          wx.showToast({ title: '回信已撕掉', icon: 'none' });
        }).catch((err) => {
          console.error('[detail] 回信删除失败', err);
          wx.showToast({ title: '回信没撕掉，再试一次吧', icon: 'none' });
        });
      }
    });
  },

  // ── 底部操作栏 ──
  onTapEdit() {
    // 编辑复用写信两步流程（预填内容，主按钮「保存修改并封存」，静默保留重读记录与回信 PRD 5.6）；
    // 经事件通道传入完整信件（演示数据不在 letters_mock 中也能预填）
    const l = this.data.letter;
    wx.navigateTo({
      url: '/pages/write/write?mode=edit&id=' + encodeURIComponent(l.id),
      success: (res) => {
        res.eventChannel.emit('letterData', {
          editMode: true,
          editId: l.id,
          name: l.name,
          question: l.question,
          answer: l.answer,
          themeId: l.theme_id,
          paperId: l.paper_id,
          createdAt: l.created_at
        });
      }
    });
  },

  onTogglePin() {
    const letter = this.data.letter;
    const next = !this.data.pinned;
    // 回形针只在详情页操作（BR-06），经 letter 服务落库（演示信会先落成真实信）
    letterService.setPinned(letter, next).then(() => {
      letter.pinned = next;
      this.setData({ letter, pinned: next });
    }).catch((err) => {
      console.error('[detail] 回形针操作失败', err);
      wx.showToast({ title: '回形针没别上，再试一次吧', icon: 'none' });
    });
  },

  onTapShare() {
    // 进入分享明信片预览页（重读记录与回信永不入图 BR-15，在分享页内保证）
    wx.navigateTo({ url: '/pages/share/share?id=' + encodeURIComponent(this.data.letter.id) });
  },

  onTapDelete() {
    wx.showModal({
      title: '把这封信放进废纸篓？',
      content: '30 天后它会离开，这期间随时可以取回来。',
      confirmText: '放纸篓',
      cancelText: '再想想',
      confirmColor: '#6B8E85',
      success: (res) => {
        if (!res.confirm) return;
        track('letter_delete', { letter_id: this.data.letter.id });
        // 废纸篓 30 天保留：重读记录与回信随信件原样保留（BR-11），经 letter 服务落库
        // 等云端确认后再返回，失败留在本页提示（旧数据无归属人时服务端会拒绝）
        letterService
          .moveToRecycle(this.data.letter)
          .then(() => wx.navigateBack())
          .catch((err) => {
            console.error('[detail] 删除失败', err);
            wx.showToast({ title: '这封信暂时删不掉，稍后再来试试', icon: 'none' });
          });
      }
    });
  }
});
