// 06 · 回形针优先展示列表 —— 「我的」页回形针数量行进入
// 展示所有别着回形针（优先展示）的信件：主题信封 + 金色回形针角标，轻触直达拆信/详情。
// 回形针的点亮/取下在详情页底部操作栏完成（BR-06），返回本页 onShow 自动刷新。

const letterService = require('../../services/letter.js');
const themeService = require('../../services/theme.js');
const memberService = require('../../services/member.js');
const handoff = require('../../services/handoff.js');

// 信件日期文案：按创建时间补出「N月N日」（信件数据由 letter 服务提供）
function dateTextOf(letter) {
  if (letter.dateText) return letter.dateText;
  const n = new Date(letter.created_at || Date.now());
  return (n.getMonth() + 1) + '月' + n.getDate() + '日';
}

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    items: [],
    hasItems: false,
    // 信封预取节点（见 onTapRow / prefetchEnv）：初始为空不挂载
    preEnv: '',
    preEnvFull: ''
  },

  onLoad() {
    this._seq = 0; // onShow 会重入（详情页取下回形针返回），用它丢弃过期响应
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });
  },

  onShow() {
    this.loadClips();
  },

  // 数据经 letter 服务获取（与首页信匣同源，仅筛回形针点亮信件 —— PRD 第十节、BR-06）
  // 信封刻意不依赖任何云调用：主题取同步缓存（无缓存时 envelopeThumbOf 回落本地默认款），
  // 会员态取进程内缓存（无值先按非 VIP —— isVip 只影响专属主题的信封素材，等会员态回来再校正）。
  // 旧版把主题与会员态 Promise.all 进关键路径，冷容器时整行信封要等两个云函数拉起，慢 1~3s。
  loadClips() {
    const seq = ++this._seq;
    const themes = themeService.cachedThemes();
    const cachedMember = memberService.cachedMembership();
    const isVip = !!(cachedMember && cachedMember.state === 'vip');
    // 会员态与主题列表留一份：onTapRow 在跳转前解析主题时用**列表这一份**，
    // 保证详情页首帧的信封与刚点的那张纸条逐字同源（专属主题对非 VIP 要回落默认款）
    this._isVip = isVip;
    this._themes = themes;

    letterService
      .getAll()
      .then((box) => {
        if (seq !== this._seq) return; // 期间又刷新过，丢弃这次结果
        const pinned = box.list.filter((l) => l.pinned);
        // 进详情的动画首帧提示（名称 + 主题）：纸条只需要渲染字段，另存一份按 id 取用
        this._hints = {};
        for (const l of pinned) this._hints[String(l.id)] = { id: l.id, name: l.name, theme_id: l.theme_id };
        const items = pinned.map((l, i) => ({
          id: l.id,
          name: l.name,
          dateText: dateTextOf(l),
          theme_id: l.theme_id, // 仅用于信封后台校正时重算，不进模板
          env: themeService.envelopeThumbOf(l.theme_id, themes, isVip),
          // 纸条微倾错落（交替 ±0.5°，手作感）
          tilt: i % 2 === 0 ? -0.5 : 0.5
        }));

        this.setData({ loading: false, items, hasItems: items.length > 0 });
        this.refreshEnvelopes(seq);
      })
      .catch((err) => {
        if (seq !== this._seq) return;
        console.error('[clips] 回形针列表加载失败', err);
        this.setData({ loading: false });
        wx.showToast({ title: '纸条暂时取不出来，稍后再来试试', icon: 'none' });
      });
  },

  // 后台校正信封：主题列表与会员态回源后重算，只对真正变化的行 setData
  // （后台改了信封素材、或 VIP 开通/过期导致专属款切换）；普通款前后一致，不产生第二次渲染
  refreshEnvelopes(seq) {
    Promise.all([themeService.getThemes(), memberService.getMembership()])
      .then(([themes, m]) => {
        if (seq !== this._seq) return;
        const isVip = !!(m && m.state === 'vip');
        // 会员态/主题列表回源后校正：跳转前解析主题要用最新的一份（见 onTapRow）
        this._isVip = isVip;
        this._themes = themes;
        const patch = {};
        this.data.items.forEach((it, i) => {
          const env = themeService.envelopeThumbOf(it.theme_id, themes, isVip);
          if (env && env !== it.env) patch['items[' + i + '].env'] = env;
        });
        if (Object.keys(patch).length) this.setData(patch);
      })
      .catch((err) => console.error('[clips] 信封素材刷新失败', err));
  },

  onTapRow(e) {
    // 跳转拆信/详情页（拆信会产生今日重读记录 BR-09，在详情页内自动记录）
    const id = e.currentTarget.dataset.id;
    const hint = this._hints && this._hints[String(id)];
    // 主题与名字**在跳转前**放进同步交接槽：详情页 onLoad 同步取用，拆信动画首帧
    // 就画对信封与名字。不能走事件通道 —— emit 在 navigateTo success 里，晚于目标页首帧
    // （见 services/handoff.js）。主题用列表这一份，与刚点的那张纸条逐字同源。
    if (hint) {
      const theme = themeService.themeOf(hint.theme_id, this._themes || themeService.cachedThemes(), this._isVip);
      handoff.put({
        id: hint.id,
        name: hint.name,
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

  onTapBack() {
    wx.navigateBack();
  }
});
