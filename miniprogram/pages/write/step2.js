// 02 · 写信第二步「选信纸并寄出」
// 状态：默认选中态 / 切换主题态（预览实时刷新）。
// 数据来源：第一步经 eventChannel 传入；直接编译预览本页时回退读取本地草稿。

const THEMES = require('./themes.js');
const letterService = require('../../services/letter.js');
const draftService = require('../../services/draft.js');
const analytics = require('../../services/analytics.js');
const { DATA_SOURCE } = require('../../config/env.js');
const cloud = require('../../services/cloud.js');

// 首次寄出的账号提示标记（仅云模式需要；注销时随用户数据清除，见 services/user.js）
const SEALED_ONCE_KEY = 'user_sealed_once';

// 埋点统一走 analytics 服务（事件名见 PRD 第十三节；letter_step2_view 替代已删除的 letter_preview）
function track(event, data) {
  analytics.track(event, data);
}

function todayText() {
  const n = new Date();
  return n.getFullYear() + '年' + (n.getMonth() + 1) + '月' + n.getDate() + '日';
}

Page({
  data: {
    statusBarHeight: 20,
    themes: THEMES,
    currentIndex: 0,
    currentTheme: THEMES[0],
    letter: { name: '', question: '', answer: '' },
    dateText: todayText(),
    editMode: false,
    editId: '',
    sealing: false,
    paperStyle: '' // 预览信纸的等比放大样式（onReady 按预览区实测计算）
  },

  onLoad(options) {
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });

    // 第一步经事件通道传入信件内容（避免长文走 URL）；编辑模式额外带信件 id / 原主题 / 创建时间
    const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (ch && ch.on) {
      ch.on('letterData', (d) => {
        if (d) this.applyLetterData(d);
      });
    }
    // 兜底：编辑模式按 id 经 letter 服务回读（直接编译预览本页时用）
    if (options && options.mode === 'edit' && options.id) {
      letterService.get(options.id).then((res) => {
        if (res.isDemo || !res.letter) return;
        const found = res.letter;
        this.applyLetterData({
          editMode: true,
          editId: found.id,
          name: found.name,
          question: found.question,
          answer: found.answer,
          themeId: found.theme_id,
          createdAt: found.created_at
        });
      })
      .catch((err) => console.error('[step2] 编辑回读失败', err));
    } else if (!(options && options.mode === 'edit')) {
      // 兜底：开发者工具直接预览本页时读取草稿（编辑模式不得读"新信"草稿）
      draftService.get().then((draft) => {
        if (draft) {
          this.setData({
            letter: { name: draft.name || '', question: draft.question || '', answer: draft.answer || '' }
          });
        }
      });
    }

    // 埋点：进入第二步
    track('letter_step2_view');
  },

  // 应用第一步传入的信件内容；编辑态回选原主题并生成「写于 · 改于」双落款
  applyLetterData(d) {
    const update = {
      letter: { name: d.name || '', question: d.question || '', answer: d.answer || '' }
    };
    if (d.editMode) {
      update.editMode = true;
      update.editId = d.editId || '';
      if (d.themeId) {
        const index = this.data.themes.findIndex((t) => t.id === d.themeId);
        if (index > -1) {
          update.currentIndex = index;
          update.currentTheme = this.data.themes[index];
        }
      }
      if (d.createdAt) {
        // 双落款：写于（创建日期，保留不变 PRD 5.6）· 改于（当前系统时间实时生成）
        const c = new Date(d.createdAt);
        update.dateText = (c.getMonth() + 1) + '月' + c.getDate() + '日 · 改于 ' + todayText();
      }
    }
    this.setData(update);
  },

  onReady() {
    this.fitPaper();
  },

  // 预览信纸等比放大至恰好充满预览区：以 590rpx 基准宽按桌面可用空间计算 scale，
  // 用 transform 缩放保证正文与信纸素材的相对位置（横线对位）不因放大而错位。
  fitPaper() {
    const query = wx.createSelectorQuery();
    query.select('.preview').boundingClientRect();
    query.exec((res) => {
      const rect = res && res[0];
      if (!rect || !rect.width || !rect.height) return;
      const win = wx.getWindowInfo();
      const paperW = (win.windowWidth * 590) / 750; // .lv-paper 基准宽 590rpx
      const paperH = (paperW * 857) / 640;          // 信纸素材比例 640×857
      const scale = Math.min(rect.width / paperW, rect.height / paperH);
      if (scale > 1.01) {
        this.setData({ paperStyle: 'transform: scale(' + scale.toFixed(3) + ');' });
      }
    });
  },

  // ── 主题选择 ──
  onSelectTheme(e) {
    const index = Number(e.currentTarget.dataset.index);
    const theme = this.data.themes[index];
    // 素材未就绪的主题只展示占位色样，不可选中
    if (theme.pending) {
      wx.showToast({ title: '这套信纸还在路上，先挑一套能用的吧', icon: 'none' });
      return;
    }
    if (index === this.data.currentIndex) return;
    // 埋点：切换信纸主题
    track('theme_select', { theme_id: theme.id });
    // 换素材同时播 60ms 级"翻页"微动效，播完移除类以便下次重放
    this.setData({ currentIndex: index, currentTheme: theme, flipping: true });
    setTimeout(() => {
      this.setData({ flipping: false });
    }, 260);
  },

  // ── 返回修改：回到第一步，已填内容随页面栈保留 ──
  onTapBack() {
    wx.navigateBack();
  },

  // ── 封存寄出 ──
  onTapSend() {
    if (this.data.sealing) return;
    const d = this.data;
    if (!d.letter.name.trim() || !d.letter.question.trim() || !d.letter.answer.trim()) {
      wx.showToast({ title: '信还没写完整，回去补一补吧', icon: 'none' });
      return;
    }

    // TODO: 未登录用户此时触发微信授权，授权后当前内容自动保留并正式保存（PRD：授权固定在寄出时触发）

    if (d.editMode) {
      this.sealEdit();
      return;
    }

    // 埋点：寄出信件（核心转化）
    track('letter_save');

    // 未封存过信的账号在寄出时提示一次（PRD 第六节：授权固定在寄出时触发；
    // 云开发下身份为静默 openid，此处为确认提示，确认后当前内容自动保留不重填）
    this.confirmSeal()
      .then((ok) => {
        if (!ok) return;
        // 寄出经 letter 服务落库（含 theme_id + theme_version，PRD 第十节 Letter）；
        // 失败显式提示重试，绝不静默丢弃（防数据丢失，架构文档 §11）
        letterService
          .create({
            name: d.letter.name,
            question: d.letter.question,
            answer: d.letter.answer,
            theme_id: d.currentTheme.id,
            theme_version: d.currentTheme.version
          })
          .then((newLetterId) => {
            // 信已寄出，草稿完成使命
            draftService.clear();
            this.startSealFx(newLetterId);
          })
          .catch(() => {
            wx.showToast({ title: '寄出没有成功，再试一次吧', icon: 'none' });
          });
      });
  },

  // 首次寄出确认（PRD 建议文案：封存这封信需要一个账号，好让未来的你一定找得到它。）
  confirmSeal() {
    return new Promise((resolve) => {
      if (DATA_SOURCE !== 'cloud' || wx.getStorageSync(SEALED_ONCE_KEY)) {
        resolve(true);
        return;
      }
      wx.showModal({
        title: '封存这封信需要一个账号',
        content: '好让未来的你一定找得到它。这封信会先为你留好，不会丢。',
        confirmText: '封存寄出',
        cancelText: '再想想',
        confirmColor: '#6B8E85',
        success: (res) => {
          if (!res.confirm) {
            resolve(false);
            return;
          }
          wx.setStorageSync(SEALED_ONCE_KEY, true);
          // 静默确保云端档案存在（openid 免额外授权），失败不阻塞寄出
          cloud.call('user', 'ensure', {}).catch(() => {});
          resolve(true);
        },
        fail: () => resolve(false)
      });
    });
  },

  // 寄出动效时间轴（纸张物理感，全程可点击跳过）：
  // 火漆按压 300ms（预览信纸轻沉折起）→ 完成幕：信封落定 → 固定文案 ≈1s → 幕布淡出 → 回首页
  startSealFx(newLetterId) {
    this._newLetterId = newLetterId || '';
    this._leaving = false;
    this.setData({ sealing: true });
    this._fxTimer1 = setTimeout(() => this.setData({ fx: true }), 300);
    this._fxTimer2 = setTimeout(() => this.leaveSeal(), 1350);
  },

  // 编辑保存：只更新内容与主题（写于保留、记改于），重读记录与回信静默原样保留（PRD 5.6）
  sealEdit() {
    const d = this.data;
    const theme = d.currentTheme;

    // 埋点：寄出/保存信件（核心转化，编辑走同一转化口径）
    track('letter_save', { letter_id: d.editId, mode: 'edit' });

    letterService
      .update(d.editId, {
        name: d.letter.name,
        question: d.letter.question,
        answer: d.letter.answer,
        theme_id: theme.id,
        theme_version: theme.version
      })
      .then((saved) => {
        // 演示数据（不在信匣存储中）不持久化，仅完成动效返回
        // 编辑草稿完成使命；标记一次性抑制，避免返回详情途中 write 页 onHide 又把过期草稿写回
        draftService.clearEdit();
        getApp()._editSealed = true;
        this.startSealFx('');
        if (!saved) {
          console.log('[step2] 编辑结果未持久化（演示数据）');
        }
      })
      .catch(() => {
        wx.showToast({ title: '保存没有成功，再试一次吧', icon: 'none' });
      });
  },

  // 完成幕任意处点击跳过（所有动画可跳过）
  onSkipFx() {
    this.leaveSeal();
  },

  leaveSeal() {
    if (this._leaving) return;
    this._leaving = true;
    clearTimeout(this._fxTimer1);
    clearTimeout(this._fxTimer2);
    // 编辑保存回详情（跨过第一步）；新信回首页信匣并带"新信落格"标记（编辑不播落格动效）
    const leave = this.data.editMode
      ? () => {
          const stack = getCurrentPages().length;
          if (stack > 2) {
            wx.navigateBack({ delta: 2 });
          } else if (stack > 1) {
            wx.navigateBack({ delta: 1 });
          } else {
            wx.switchTab({ url: '/pages/home/home' });
          }
        }
      : () => {
          wx.setStorageSync('letter_just_arrived', this._newLetterId || '');
          wx.switchTab({ url: '/pages/home/home' });
        };
    if (this.data.fx && !this.data.fxOut) {
      this.setData({ fxOut: true });
      setTimeout(leave, 220);
    } else {
      leave();
    }
  },

  onUnload() {
    clearTimeout(this._fxTimer1);
    clearTimeout(this._fxTimer2);
  }
});
