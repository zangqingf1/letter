// 12 · 问题反馈（从「我的」页功能列表进入）：文字（必填）+ 联系方式（选填）+ 多张截图（选填）
// 提交经 feedback 服务（云端落 feedback 集合，本地落 storage feedback_local）。
const feedbackService = require('../../services/feedback.js');

const CONTENT_MAX = 1000;
const CONTACT_MAX = 40;
const SHOTS_MAX = 9;

Page({
  data: {
    statusBarHeight: 20,
    contentMax: CONTENT_MAX,
    contactMax: CONTACT_MAX,
    shotsMax: SHOTS_MAX,
    content: '',
    contentLen: 0,
    contact: '',
    shots: [],
    submitting: false
  },

  onLoad() {
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });
  },

  onTapBack() {
    wx.navigateBack();
  },

  onContentInput(e) {
    const content = e.detail.value;
    this.setData({ content, contentLen: content.length });
  },

  onContactInput(e) {
    this.setData({ contact: e.detail.value });
  },

  // 追加截图：chooseMedia（低版本回落 chooseImage），一次最多选满剩余额度
  onAddShot() {
    const remain = SHOTS_MAX - this.data.shots.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多 ' + SHOTS_MAX + ' 张截图', icon: 'none' });
      return;
    }
    const append = (paths) => {
      this.setData({ shots: this.data.shots.concat(paths) });
    };
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => append((res.tempFiles || []).map((f) => f.tempFilePath))
      });
    } else {
      wx.chooseImage({
        count: remain,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => append(res.tempFilePaths || [])
      });
    }
  },

  onRemoveShot(e) {
    const index = e.currentTarget.dataset.index;
    const shots = this.data.shots.slice();
    shots.splice(index, 1);
    this.setData({ shots });
  },

  onTapSubmit() {
    const content = (this.data.content || '').trim();
    if (!content) {
      wx.showToast({ title: '先写下你想反馈的问题', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true });

    feedbackService
      .submit({
        content,
        contact: (this.data.contact || '').trim(),
        images: this.data.shots,
        device: buildDevice()
      })
      .then(() => {
        wx.showToast({ title: '谢谢，已收到你的反馈', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1200);
      })
      .catch((err) => {
        console.error('[feedback] 提交失败', err);
        this.setData({ submitting: false });
        wx.showToast({ title: '提交失败，请稍后再试', icon: 'none' });
      });
  }
});

// 附带脱敏环境信息（平台/系统/微信版本），便于复现问题；异常时静默降级为空串
function buildDevice() {
  const parts = [];
  try {
    const info = wx.getDeviceInfo ? wx.getDeviceInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {});
    if (info.platform) parts.push(info.platform);
    if (info.system) parts.push(info.system);
  } catch (e) {}
  try {
    const app = wx.getAppBaseInfo ? wx.getAppBaseInfo() : {};
    if (app.version) parts.push('微信 ' + app.version);
  } catch (e) {}
  return parts.join(' · ');
}
