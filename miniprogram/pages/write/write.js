// 02 · 写信第一步「写下这封信」
// 同一页面覆盖两个状态：
//   状态一 空白初始态 —— 三个输入区均为空，主按钮置灰不可点；
//   状态二 填写中态 —— 手写体实时渲染，填完名称/问题/答案后主按钮激活，可进入第二步。

// 字数上限（PRD 第十五节待固化参数）：信纸已改为配色排版（无纸张图片、无版面限制），
// 原按信纸横线区定的 200 / 500 上限放开为 500 / 2000；名称仍限 20
const NAME_MAX = 20;
const QUESTION_MAX = 500;
const ANSWER_MAX = 2000;

// 草稿保护：仅在用户点「存草稿」或退出时点系统弹窗「确定」两种时机落草稿，
// 不做 10 秒/失焦/切后台自动保存（PRD 5.3 原自动保存策略已按用户修订移除），
// 经 draft 服务读写（本地 storage 第一道防线，云端 drafts 集合备份见架构文档 §5.4）
const draftService = require('../../services/draft.js');
const letterService = require('../../services/letter.js');
const analytics = require('../../services/analytics.js');

// 埋点统一走 analytics 服务（事件名见 PRD 第十三节）
function track(event, data) {
  analytics.track(event, data);
}

// URL 传参兜底解码：参数未编码或含裸 % 时 decodeURIComponent 会抛异常，退回原值
function safeDecode(v) {
  if (!v) return '';
  try {
    return decodeURIComponent(v);
  } catch (e) {
    return v;
  }
}

// 名称/问题/答案均必填，填齐才能进入第二步（PRD 5.2）
function canNextOf(name, question, answer) {
  return !!(name.trim() && question.trim() && answer.trim());
}

// 信头日期（素笺正席版式）：中文落款「二〇二六年 八月三十日」+ 右上角邮戳「2026.08.30」。
// 新写信落今天；编辑态落原信创建日期（与详情页「写于」口径一致）
const CN_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function cnYear(y) {
  return String(y).split('').map((c) => CN_DIGITS[+c]).join('');
}
function cnMonth(m) {
  if (m === 10) return '十';
  if (m === 11) return '十一';
  if (m === 12) return '十二';
  return CN_DIGITS[m];
}
function cnDay(d) {
  if (d <= 10) return d === 10 ? '十' : CN_DIGITS[d];
  const tens = Math.floor(d / 10);
  const ones = d % 10;
  return (tens === 1 ? '十' : CN_DIGITS[tens] + '十') + (ones ? CN_DIGITS[ones] : '');
}
function headDateOf(ts) {
  const t = ts ? new Date(ts) : new Date();
  const mm = t.getMonth() + 1;
  const dd = t.getDate();
  return {
    cn: cnYear(t.getFullYear()) + '年 ' + cnMonth(mm) + '月' + cnDay(dd) + '日',
    stamp: t.getFullYear() + '.' + ('0' + mm).slice(-2) + '.' + ('0' + dd).slice(-2)
  };
}

Page({
  data: {
    statusBarHeight: 20,
    NAME_MAX,
    QUESTION_MAX,
    ANSWER_MAX,
    name: '',
    question: '',
    answer: '',
    questionLen: 0,
    answerLen: 0,
    canNext: false,
    // 书写区下方陈列的未写完草稿（点击卡片载入续写，卡片上可删除；编辑态不显示）
    drafts: [],
    // 无障碍开关：关闭手写体（全局设置，我的页提供开关入口）
    handwritingOff: false,
    // 编辑态标记（供 wxml 隐藏「存草稿」按钮；编辑态仅「保存修改并封存」）
    isEdit: false,
    // 信头落款（新写信=今天，编辑态=原信创建日期）
    headDateCn: '',
    headDateStamp: ''
  },

  onLoad(options) {
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });

    this.contentCompleteTracked = false;
    // 当前正在写的草稿 id（''=尚未落成草稿的新信）；寄出后据此精确清除对应草稿
    this.currentDraftId = '';

    // 无障碍：读取「关闭手写体」设置
    // TODO: 我的页提供开关入口，统一读写该存储键
    this.setData({ handwritingOff: wx.getStorageSync('handwriting_off') === true });

    // 编辑模式：从详情页进入，预填原信内容（PRD 5.6，复用写信两步流程）
    this.editMode = !!(options && options.mode === 'edit');
    // 供 wxml 判断编辑态（编辑态不提供「存草稿」按钮）
    this.setData({ isEdit: this.editMode });
    this.editId = (options && options.id) || '';
    this.editThemeId = '';
    this.editPaperId = '';
    this.editCreatedAt = null;
    // 信头日期：新写信落今天；编辑态等预填到达后改落创建日期
    const hd = headDateOf(this.editMode ? null : Date.now());
    this.setData({ headDateCn: hd.cn, headDateStamp: hd.stamp });
    if (this.editMode) {
      this.setupEditPrefill();
    } else {
      // 无传参进入（首页信箱/草稿横条）：保持空白新信，不自动预填；
      // 未写完的草稿陈列在书写区下方，点击卡片才载入继续写
      this.loadDraftShelf();
      if (options && (options.name || options.question || options.answer)) {
        const name = safeDecode(options.name);
        const question = safeDecode(options.question);
        const answer = safeDecode(options.answer);
        this.setData({
          name,
          question,
          answer,
          questionLen: question.length,
          answerLen: answer.length
        });
        this.refreshCanNext();
      }
    }

    // 编辑过程有内容时，系统手势返回也给出退出提示（自定义返回按钮另有拦截）
    this.syncAlertBeforeUnload();
  },

  onUnload() {
    // 页面真正卸载（含系统弹窗「确定」离开）：
    // 新写信 → 退出确认落草稿（唯一自动保存时机之一）；编辑态 → 丢弃未封存修改回原信阅读态
    if (this.editMode) {
      if (!getApp()._editSealed) {
        draftService.clearEdit();
      }
    } else {
      this.saveDraft(true);
    }
    try {
      wx.disableAlertBeforeUnload();
    } catch (e) { /* 基础库不支持时忽略 */ }
  },

  onHide() {
    // 切后台不自动存草稿（仅「点存草稿」或「退出点确认」两种时机保存）；
    // 这里只做编辑态封存完成后的标志清理
    if (this.editMode && getApp()._editSealed) {
      getApp()._editSealed = false;
    }
  },

  // ── 编辑态预填（PRD 5.6 / 功能需求文档 六）──
  // 详情页经事件通道传入完整信件；直接编译预览本页时按 id 经 letter 服务回读兜底。
  setupEditPrefill() {
    this._editPrefilled = false;
    const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (ch && ch.on) {
      ch.on('letterData', (d) => this.applyEditPrefill(d));
    }
    if (!this.editId) return;
    letterService.get(this.editId).then((res) => {
      // isDemo 说明不是真实寄出的信（演示数据），不做编辑预填
      if (res.isDemo || !res.letter) return;
      const found = res.letter;
      this.applyEditPrefill({
        editId: found.id,
        name: found.name,
        question: found.question,
        answer: found.answer,
        themeId: found.theme_id,
        paperId: found.paper_id,
        createdAt: found.created_at
      });
    })
    .catch((err) => console.error('[write] 编辑预填读取失败', err));
  },

  applyEditPrefill(d) {
    if (this._editPrefilled || !d) return;
    this._editPrefilled = true;
    if (d.editId) this.editId = d.editId;
    this.editThemeId = d.themeId || '';
    this.editPaperId = d.paperId || '';
    this.editCreatedAt = d.createdAt || null;
    // 编辑态信头落款改用原信创建日期（未知则保持今天的兜底）
    const hd = headDateOf(this.editCreatedAt || Date.now());
    this.setData({ headDateCn: hd.cn, headDateStamp: hd.stamp });
    // 记录原信内容：返回时据此判断是否真的改过（没改过就不打扰用户确认）
    this._original = { name: d.name || '', question: d.question || '', answer: d.answer || '' };

    // 有该信未封存的编辑草稿（上次中途退出保存）则以草稿内容优先，防丢失恢复
    draftService.getEdit().then((editDraft) => {
      const hasDraft = editDraft && editDraft.letterId === this.editId &&
        (editDraft.name || editDraft.question || editDraft.answer);

      const name = hasDraft ? editDraft.name : (d.name || '');
      const question = hasDraft ? editDraft.question : (d.question || '');
      const answer = hasDraft ? editDraft.answer : (d.answer || '');
      this.setData({
        name,
        question,
        answer,
        questionLen: question.length,
        answerLen: answer.length
      });
      this.refreshCanNext();
      // 预填完成后按「是否有实际改动」重新评估手势返回提示
      this.syncAlertBeforeUnload();
    });
  },

  // ── 输入 ──
  // 每个按键只做一次 setData（内容与 canNext 同批），避免高频输入触发两次渲染层通信
  onNameInput(e) {
    const v = e.detail.value;
    this.setData({
      name: v,
      canNext: canNextOf(v, this.data.question, this.data.answer)
    });
    this.onContentChanged();
  },

  onQuestionInput(e) {
    const v = e.detail.value;
    this.setData({
      question: v,
      questionLen: v.length,
      canNext: canNextOf(this.data.name, v, this.data.answer)
    });
    this.onContentChanged();
  },

  onAnswerInput(e) {
    const v = e.detail.value;
    this.setData({
      answer: v,
      answerLen: v.length,
      canNext: canNextOf(this.data.name, this.data.question, v)
    });
    this.onContentChanged();
  },

  onContentChanged() {
    // 埋点：内容填写完成（名称/问题/答案首次填齐，每次进入页面只记一次；编辑态不重复计量）
    if (!this.editMode && !this.contentCompleteTracked && this.data.canNext) {
      this.contentCompleteTracked = true;
      track('letter_content_complete');
    }

    // 不自动存草稿：仅「点存草稿」或「退出点确认」两时机落草稿
    this.syncAlertBeforeUnload();
  },

  // ── 状态判定 ──
  hasContent() {
    const d = this.data;
    return !!(d.name.trim() || d.question.trim() || d.answer.trim());
  },

  refreshCanNext() {
    const d = this.data;
    // 名称/问题/答案均必填，填齐才能进入第二步
    this.setData({ canNext: canNextOf(d.name, d.question, d.answer) });
  },

  // ── 草稿 ──
  // 返回保存Promise（编辑态无 id 概念，resolve null）；保存后刷新书写区下方陈列
  saveDraft(silent) {
    if (!this.hasContent()) return Promise.resolve(null);
    const d = this.data;
    const content = { name: d.name, question: d.question, answer: d.answer };
    // 编辑态不存草稿（仅「保存修改并封存」，见 onTapNext 编辑态直接 go）；saveDraft 只服务新写信
    const draftId = this.currentDraftId;
    return draftService
      .save(Object.assign({ id: draftId }, content))
      .then((saved) => {
        // 只有当前草稿指针未变时才回写 id（避免切去写另一封时被旧保存覆盖）
        if (saved && saved.id && this.currentDraftId === draftId) {
          this.currentDraftId = saved.id;
        }
        this.loadDraftShelf();
        if (!silent) {
          // 埋点：保存草稿
          track('draft_save');
          wx.showToast({ title: '已存草稿', icon: 'success' });
        }
        return saved;
      });
  },

  // ── 草稿陈列（书写区下方）──
  loadDraftShelf() {
    if (this.editMode) return;
    draftService
      .list()
      .then((drafts) => {
        this._draftsRaw = drafts;
        this.setData({ drafts: drafts.map((d) => this.formatDraftItem(d)) });
      })
      .catch(() => {});
  },

  formatDraftItem(d) {
    const snippet = (d.question || d.answer || '').replace(/\s+/g, ' ').trim();
    const t = new Date(d.updatedAt || Date.now());
    return {
      id: d.id,
      name: d.name || '没起名字的信',
      snippet: snippet || '还没有写下内容',
      // 素笺正席版式：草稿卡日期为 mono 编目式「08.28」
      timeText: ('0' + (t.getMonth() + 1)).slice(-2) + '.' + ('0' + t.getDate()).slice(-2)
    };
  },

  // 点击草稿卡片：先保住当前内容（落成独立草稿，互不覆盖），再载入目标草稿继续写
  onTapDraftItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.currentDraftId) return;
    const raw = (this._draftsRaw || []).find((d) => d.id === id);
    if (!raw) return;
    this.saveDraft(true);
    this.currentDraftId = id;
    this.setData({
      name: raw.name || '',
      question: raw.question || '',
      answer: raw.answer || '',
      questionLen: (raw.question || '').length,
      answerLen: (raw.answer || '').length
    });
    this.refreshCanNext();
    this.syncAlertBeforeUnload();
  },

  // 删除陈列中的草稿：彻底删除，不进废纸篓（草稿未寄出，无重读/回信可恢复）
  onTapDraftDelete(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showModal({
      title: '删掉这封草稿？',
      content: '草稿还没有寄出，删除后不会进废纸篓，也无法找回。',
      confirmText: '撕毁',
      cancelText: '取消',
      confirmColor: '#6E7570',
      success: (res) => {
        if (!res.confirm) return;
        draftService.remove(id).then(() => {
          // 删的是正在写的这封：清空表单，避免下一次自动保存又把它写回
          if (id === this.currentDraftId) {
            this.currentDraftId = '';
            this.setData({
              name: '',
              question: '',
              answer: '',
              questionLen: 0,
              answerLen: 0
            });
            this.refreshCanNext();
            this.syncAlertBeforeUnload();
          }
          this.loadDraftShelf();
        });
      }
    });
  },

  // ── 底部操作 ──
  onTapSaveDraft() {
    // 编辑态不提供存草稿（仅「保存修改并封存」）；按钮已隐藏，此处兜底
    if (this.editMode) return;
    if (!this.hasContent()) {
      wx.showToast({ title: '先写下一点内容吧', icon: 'none' });
      return;
    }
    // 落草稿后返回信匣：「已存草稿」Toast 跨页面保留；草稿横条由首页 onShow 刷新。
    // 程序化 navigateBack 也会被 enableAlertBeforeUnload 拦截（部分基础库），已存草稿不再打扰，先禁用
    this.saveDraft(false).then(() => {
      wx.disableAlertBeforeUnload();
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack();
      } else {
        wx.switchTab({ url: '/pages/home/home' });
      }
    });
  },

  onTapNext() {
    if (!this.data.canNext) return;
    const d = this.data;
    // 跳转写信第二步「选择主题」，内容经事件通道传递（长文不走 URL）；
    // 编辑模式额外带信件 id / 原主题 / 原信纸版式 / 创建时间，供第二步双落款与回选
    const go = () => {
      wx.navigateTo({
        url: '/pages/write/step2' + (this.editMode ? '?mode=edit' : ''),
        success: (res) => {
          res.eventChannel.emit('letterData', {
            name: d.name,
            question: d.question,
            answer: d.answer,
            // 寄出成功后 step2 据此精确清除对应草稿（编辑态无草稿概念）
            draftId: this.currentDraftId || '',
            editMode: !!this.editMode,
            editId: this.editId || '',
            themeId: this.editThemeId || '',
            paperId: this.editPaperId || '',
            createdAt: this.editCreatedAt
          });
        }
      });
    };
    if (this.editMode) {
      go();
      return;
    }
    // 先确保当前内容已落草稿并拿到 id（避免 emitted draftId 为空时寄出误清全部草稿）
    Promise.resolve(this.saveDraft(true)).then(go);
  },

  // ── 退出保护 ──
  // 是否需要在离开前确认：返回按钮与系统手势返回共用同一份口径（避免两处重复判断不一致）
  shouldAlertLeave() {
    return this.editMode ? this.editChanged() : this.hasContent();
  },

  // 返回按钮与系统手势返回统一：仅 navigateBack，交由 enableAlertBeforeUnload 系统弹窗拦截。
  // 新写信「确定」离开 → onUnload saveDraft 落草稿；编辑态「确定」离开 → onUnload clearEdit 丢弃修改。
  onTapBack() {
    wx.navigateBack();
  },

  // 当前内容与原信是否有差异
  editChanged() {
    const d = this.data;
    const o = this._original || {};
    return d.name !== o.name || d.question !== o.question || d.answer !== o.answer;
  },

  // 有内容时开启系统手势返回的退出提示；无内容时关闭。
  // 口径与返回按钮共用 shouldAlertLeave（编辑态：内容与原信一致时不打扰用户）
  syncAlertBeforeUnload() {
    try {
      if (this.shouldAlertLeave()) {
        // 编辑态手势返回的提示文案与新写信区分（按钮为系统默认的确定/取消）
        wx.enableAlertBeforeUnload({
          message: this.editMode ? '这次编辑还没有封存，确定离开吗？' : '这封信还没写完。'
        });
      } else {
        wx.disableAlertBeforeUnload();
      }
    } catch (e) { /* 基础库不支持或非手势返回场景时忽略 */ }
  }
});
