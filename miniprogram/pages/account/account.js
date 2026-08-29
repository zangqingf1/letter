// 10 · 账号管理 —— 资料区使用微信官方「头像昵称填写能力」：
// 头像 open-type="chooseAvatar"、昵称 type="nickname" 输入框（合规方案，getUserProfile 已下线）。
// 资料/注销经 user 服务处理（本地 storage 或云端），「我的」页名片读取同一份数据。
const userService = require('../../services/user.js');

Page({
  data: {
    statusBarHeight: 20,
    profile: { nickname: '', avatar: '' },
    avatarChar: '友',
    wroteDays: ''
  },

  onLoad() {
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });
    this.loadProfile();
  },

  loadProfile() {
    userService.getProfile().then((profile) => {
      this.setData({
        profile,
        avatarChar: (profile.nickname || '友')[0],
        wroteDays: profile.wroteDays
      });
    });
  },

  // 官方头像填写能力回调：e.detail.avatarUrl 为微信临时路径，先落成本地文件再存，避免重启后失效
  onChooseAvatar(e) {
    const tempPath = e.detail.avatarUrl;
    if (!tempPath) return;
    wx.getFileSystemManager().saveFile({
      tempFilePath: tempPath,
      success: (res) => this.applyAvatar(res.savedFilePath),
      fail: () => this.applyAvatar(tempPath)
    });
  },

  applyAvatar(avatar) {
    this.setData({ 'profile.avatar': avatar });
    // 云模式会先上传云存储换 fileID 再落库，成功/失败都给出反馈
    userService
      .saveProfile(this.data.profile)
      .then(() => wx.showToast({ title: '头像已换好', icon: 'none' }))
      .catch((err) => {
        console.error('[account] 头像保存失败', err);
        wx.showToast({ title: '头像没存上，再试一次', icon: 'none' });
      });
  },

  // type="nickname" 输入框失焦/确认时保存（键盘上方会有"使用微信昵称"快捷填入）
  onNicknameBlur(e) {
    const nickname = (e.detail.value || '').trim();
    this.setData({ 'profile.nickname': nickname, avatarChar: (nickname || '友')[0] });
    this.saveProfile();
  },

  saveProfile() {
    userService.saveProfile(this.data.profile);
  },

  onTapBack() {
    wx.navigateBack();
  },

  // 账号注销（PRD 第六节）：页内二次确认弹窗，确认文案为 PRD 固定原文
  onTapDeactivate() {
    wx.showModal({
      title: '确定注销吗？',
      content: '注销后，匣子里的所有信件、回信和痕迹都会被销毁，无法找回。',
      confirmText: '仍要注销',
      cancelText: '再想想',
      confirmColor: '#6E7570',
      success: (res) => {
        if (!res.confirm) return;
        this.deactivate();
      }
    });
  },

  deactivate() {
    // 清本地数据键 + 云端物理删除该账号全部数据（PRD 第六节），由 user 服务统一处理
    userService.deactivate();
    wx.showToast({ title: '已注销。愿未来的你，一切都好。', icon: 'none', duration: 1800 });
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/home/home' });
    }, 1600);
  }
});
