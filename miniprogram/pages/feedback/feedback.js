// 12 · 问题反馈（从「我的」页功能列表进入）：文字（必填）+ 多张截图（选填）
// 提交经 feedback 服务（云端落 feedback 集合，本地落 storage feedback_local）。
const feedbackService = require('../../services/feedback.js');
const privacyService = require('../../services/privacy.js');

const CONTENT_MAX = 1000;
const SHOTS_MAX = 9;
// 单张截图上限 5MB：客户端预检（服务端只能拿到 fileID，无法便捷校验字节数），
// 避免超大图长期占用云存储配额。
const SHOT_MAX_BYTES = 5 * 1024 * 1024;

// 读取本地临时文件字节数（低版本 chooseImage 不返回 size，用文件系统 statSync 兜底）
function fileSizeOf(path) {
  try {
    const fs = wx.getFileSystemManager && wx.getFileSystemManager();
    if (fs && fs.statSync) return fs.statSync(path).size || 0;
  } catch (e) {
    // 读取失败按未知处理（放行，不因预检失败阻断提交）
  }
  return 0;
}

Page({
  data: {
    statusBarHeight: 20,
    contentMax: CONTENT_MAX,
    shotsMax: SHOTS_MAX,
    content: '',
    contentLen: 0,
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

  // 追加截图：选图属隐私接口（收集你选中的照片或视频信息），
  // 未同意《用户隐私保护指引》时 chooseMedia 会直接 fail，用户会以为按钮坏了 —— 先确保授权
  onAddShot() {
    const remain = SHOTS_MAX - this.data.shots.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多 ' + SHOTS_MAX + ' 张截图', icon: 'none' });
      return;
    }
    privacyService.ensure().then((ok) => {
      if (!ok) {
        wx.showToast({ title: '需同意隐私政策后才能选择截图', icon: 'none' });
        return;
      }
      this.pickShots(remain);
    });
  },

  // chooseMedia（低版本回落 chooseImage），一次最多选满剩余额度
  pickShots(remain) {
    const append = (items) => {
      const ok = [];
      let skipped = 0;
      for (const it of items) {
        const path = typeof it === 'string' ? it : it.tempFilePath;
        if (!path) continue;
        const size = typeof it === 'string' ? fileSizeOf(path) : it.size || 0;
        if (size > SHOT_MAX_BYTES) {
          skipped += 1;
          continue;
        }
        ok.push(path);
      }
      if (skipped) wx.showToast({ title: skipped + ' 张超过 5MB，已跳过', icon: 'none' });
      if (ok.length) this.setData({ shots: this.data.shots.concat(ok) });
    };
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => append(res.tempFiles || [])
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
