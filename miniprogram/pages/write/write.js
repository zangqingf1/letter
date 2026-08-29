// 02 · 写信第一步「写下这封信」
// 同一页面覆盖两个状态：
//   状态一 空白初始态 —— 三个输入区均为空，主按钮置灰不可点；
//   状态二 填写中态 —— 手写体实时渲染，填完名称/问题/答案后主按钮激活，可进入第二步。

// 字数上限：PRD 第十五节待固化参数，先按线框稿 200 / 500 实现，名称暂限 20
const NAME_MAX = 20;
const QUESTION_MAX = 200;
const ANSWER_MAX = 500;

// 草稿保护：每 10 秒或输入框失焦时自动保存（PRD 5.3）
const AUTOSAVE_INTERVAL = 10 * 1000;
// TODO: 接入云端后替换为 Draft 实体（PRD 第十节）
const DRAFT_KEY = 'letter_draft_current';
// 编辑模式的防丢失草稿使用独立存储键：letter_draft_current 是"新信"草稿（首页草稿横条读取），
// 编辑已有信件不能与之混用（step2.js 同名常量与此保持一致）
const EDIT_DRAFT_KEY = 'letter_edit_current';

// TODO: 接入真实埋点（事件名见 PRD 第十三节）
function track(event, data) {
  console.log('[track]', event, data || '');
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
    // 无障碍开关：关闭手写体（全局设置，我的页提供开关入口）
    handwritingOff: false
  },

  onLoad(options) {
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });

    this.autosaveTimer = null;
    this.contentCompleteTracked = false;

    // 无障碍：读取「关闭手写体」设置
    // TODO: 我的页提供开关入口，统一读写该存储键
    this.setData({ handwritingOff: wx.getStorageSync('handwriting_off') === true });

    // 编辑模式：从详情页进入，预填原信内容（PRD 5.6，复用写信两步流程）
    this.editMode = !!(options && options.mode === 'edit');
    this.editId = (options && options.id) || '';
    this.editThemeId = '';
    this.editCreatedAt = null;
    if (this.editMode) {
      this.setupEditPrefill();
    } else if (options && (options.name || options.question || options.answer)) {
      this.setData({
        name: decodeURIComponent(options.name || ''),
        question: decodeURIComponent(options.question || ''),
        answer: decodeURIComponent(options.answer || ''),
        questionLen: decodeURIComponent(options.question || '').length,
        answerLen: decodeURIComponent(options.answer || '').length
      });
      this.refreshCanNext();
    }

    // 编辑过程有内容时，系统手势返回也给出退出提示（自定义返回按钮另有拦截）
    this.syncAlertBeforeUnload();
  },

  onUnload() {
    if (this.autosaveTimer) {
      clearInterval(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    try {
      wx.disableAlertBeforeUnload();
    } catch (e) { /* 基础库不支持时忽略 */ }
  },

  onHide() {
    // 编辑保存完成后返回详情的回栈过程不再写编辑草稿（step2 已清除，防止残留过期草稿）
    if (this.editMode && getApp()._editSealed) {
      getApp()._editSealed = false;
      return;
    }
    // 切后台前兜底保存一次，降低异常退出损失
    this.saveDraft(true);
  },

  // ── 编辑态预填（PRD 5.6 / 功能需求文档 六）──
  // 详情页经事件通道传入完整信件（兼容不在 letters_mock 中的演示数据）；
  // 直接编译预览本页时按 id 回读 letters_mock 兜底。
  setupEditPrefill() {
    this._editPrefilled = false;
    const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (ch && ch.on) {
      ch.on('letterData', (d) => this.applyEditPrefill(d));
    }
    if (!this.editId) return;
    const letters = wx.getStorageSync('letters_mock') || [];
    const found = letters.find((l) => l.id === this.editId);
    if (found) {
      this.applyEditPrefill({
        editId: found.id,
        name: found.name,
        question: found.question,
        answer: found.answer,
        themeId: found.theme_id,
        createdAt: found.created_at
      });
    }
  },

  applyEditPrefill(d) {
    if (this._editPrefilled || !d) return;
    this._editPrefilled = true;
    if (d.editId) this.editId = d.editId;
    this.editThemeId = d.themeId || '';
    this.editCreatedAt = d.createdAt || null;
    // 记录原信内容：返回时据此判断是否真的改过（没改过就不打扰用户确认）
    this._original = { name: d.name || '', question: d.question || '', answer: d.answer || '' };

    // 有该信未封存的编辑草稿（上次中途退出保存）则以草稿内容优先，防丢失恢复
    const editDraft = wx.getStorageSync(EDIT_DRAFT_KEY);
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
  },

  // ── 输入 ──
  onNameInput(e) {
    this.setData({ name: e.detail.value });
    this.onContentChanged();
  },

  onQuestionInput(e) {
    const v = e.detail.value;
    this.setData({ question: v, questionLen: v.length });
    this.onContentChanged();
  },

  onAnswerInput(e) {
    const v = e.detail.value;
    this.setData({ answer: v, answerLen: v.length });
    this.onContentChanged();
  },

  onContentChanged() {
    const wasComplete = this.data.canNext;
    this.refreshCanNext();

    // 埋点：内容填写完成（名称/问题/答案首次填齐，每次进入页面只记一次；编辑态不重复计量）
    if (!this.editMode && !this.contentCompleteTracked && this.data.canNext) {
      this.contentCompleteTracked = true;
      track('letter_content_complete');
    }

    // 首次输入后启动自动保存计时
    if (!this.autosaveTimer && this.hasContent()) {
      this.autosaveTimer = setInterval(() => this.saveDraft(true), AUTOSAVE_INTERVAL);
    }

    this.syncAlertBeforeUnload();

    if (!wasComplete && this.data.canNext) {
      this.saveDraft(true);
    }
  },

  // 输入框失焦时自动保存
  onFieldBlur() {
    if (this.hasContent()) {
      this.saveDraft(true);
    }
  },

  // ── 状态判定 ──
  hasContent() {
    const d = this.data;
    return !!(d.name.trim() || d.question.trim() || d.answer.trim());
  },

  refreshCanNext() {
    const d = this.data;
    // 名称/问题/答案均必填，填齐才能进入第二步
    this.setData({
      canNext: !!(d.name.trim() && d.question.trim() && d.answer.trim())
    });
  },

  // ── 草稿 ──
  saveDraft(silent) {
    if (!this.hasContent()) return;
    const d = this.data;
    if (this.editMode) {
      // 编辑草稿带信件 id 独立存放；正式保存（保存修改并封存）时由 step2 清除
      wx.setStorageSync(EDIT_DRAFT_KEY, {
        letterId: this.editId,
        name: d.name,
        question: d.question,
        answer: d.answer,
        updatedAt: Date.now()
      });
      return;
    }
    wx.setStorageSync(DRAFT_KEY, {
      name: d.name,
      question: d.question,
      answer: d.answer,
      updatedAt: Date.now()
    });
    if (!silent) {
      // 埋点：保存草稿
      track('draft_save');
      wx.showToast({ title: '已存草稿', icon: 'success' });
    }
  },

  discardDraft() {
    if (this.editMode) {
      wx.removeStorageSync(EDIT_DRAFT_KEY);
      return;
    }
    wx.removeStorageSync(DRAFT_KEY);
  },

  // ── 底部操作 ──
  onTapSaveDraft() {
    if (!this.hasContent()) {
      wx.showToast({ title: '先写下一点内容吧', icon: 'none' });
      return;
    }
    this.saveDraft(false);
  },

  onTapNext() {
    if (!this.data.canNext) return;
    const d = this.data;
    // 跳转写信第二步「选信纸并寄出」，内容经事件通道传递（长文不走 URL）；
    // 编辑模式额外带信件 id / 原主题 / 创建时间，供第二步双落款与主题回选
    wx.navigateTo({
      url: '/pages/write/step2' + (this.editMode ? '?mode=edit' : ''),
      success: (res) => {
        res.eventChannel.emit('letterData', {
          name: d.name,
          question: d.question,
          answer: d.answer,
          editMode: !!this.editMode,
          editId: this.editId || '',
          themeId: this.editThemeId || '',
          createdAt: this.editCreatedAt
        });
      }
    });
  },

  // ── 退出保护 ──
  onTapBack() {
    if (this.editMode) {
      this.onTapBackInEdit();
      return;
    }
    if (this.hasContent()) {
      // 中途退出提示（PRD 5.3 固定文案）
      wx.showModal({
        title: '这封信还没写完。',
        confirmText: '存为草稿',
        cancelText: '不要了',
        success: (res) => {
          if (res.confirm) {
            this.saveDraft(true);
          } else {
            this.discardDraft();
          }
          wx.navigateBack();
        }
      });
      return;
    }
    wx.navigateBack();
  },

  // 编辑态返回：改过内容才询问是否取消编辑；确认后丢弃本次修改，回到原信的阅读态
  onTapBackInEdit() {
    if (!this.editChanged()) {
      wx.navigateBack();
      return;
    }
    wx.showModal({
      title: '这次编辑还没有封存。',
      content: '现在离开，修改不会保留，这封信还是原来的样子。',
      confirmText: '取消编辑',
      cancelText: '继续编辑',
      confirmColor: '#6B8E85',
      success: (res) => {
        if (!res.confirm) return;
        // 取消编辑：丢弃编辑草稿，信件保持原样（重读记录与回信本就未动）
        wx.removeStorageSync(EDIT_DRAFT_KEY);
        wx.navigateBack();
      }
    });
  },

  // 当前内容与原信是否有差异
  editChanged() {
    const d = this.data;
    const o = this._original || {};
    return d.name !== o.name || d.question !== o.question || d.answer !== o.answer;
  },

  // 有内容时开启系统手势返回的退出提示；无内容时关闭
  syncAlertBeforeUnload() {
    try {
      if (this.hasContent()) {
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
