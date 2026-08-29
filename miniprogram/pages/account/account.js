// 10 · 账号管理 —— 资料区使用微信官方「头像昵称填写能力」：
// 头像 open-type="chooseAvatar"、昵称 type="nickname" 输入框（合规方案，getUserProfile 已下线）。
// 头像/昵称保存在本地 storage（account_profile），「我的」页名片读取同一份数据。
const { MOCK_USER } = require('../mine/mock.js');

const PROFILE_KEY = 'account_profile';

// 注销时清除的用户数据键：信件、废纸篓、两处草稿、落格动效标记、本地资料。
// handwriting_off（手写体无障碍开关）属于设备偏好，不随注销清除。
const USER_DATA_KEYS = [
  'letters_mock',
  'recycle_mock',
  'letter_draft_current',
  'letter_edit_current',
  'letter_just_arrived',
  PROFILE_KEY
];

Page({
  data: {
    statusBarHeight: 20,
    profile: { nickname: '', avatar: '' },
    avatarChar: '友',
    wroteDays: MOCK_USER.wroteDays
  },

  onLoad() {
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });
    this.loadProfile();
  },

  // 本地已保存资料优先，未设置过回落演示数据（与「我的」页名片同口径）
  loadProfile() {
    const saved = wx.getStorageSync(PROFILE_KEY);
    const profile = {
      nickname: (saved && saved.nickname) || MOCK_USER.nickname,
      avatar: (saved && saved.avatar) || ''
    };
    this.setData({ profile, avatarChar: (profile.nickname || '友')[0] });
  },

  // 官方头像填写能力回调：e.detail.avatarUrl 为微信临时路径，先落成本地文件再存 storage，避免重启后失效
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
    this.saveProfile();
    wx.showToast({ title: '头像已换好', icon: 'none' });
  },

  // type="nickname" 输入框失焦/确认时保存（键盘上方会有"使用微信昵称"快捷填入）
  onNicknameBlur(e) {
    const nickname = (e.detail.value || '').trim();
    this.setData({ 'profile.nickname': nickname, avatarChar: (nickname || '友')[0] });
    this.saveProfile();
  },

  saveProfile() {
    wx.setStorageSync(PROFILE_KEY, this.data.profile);
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
    USER_DATA_KEYS.forEach((k) => wx.removeStorageSync(k));
    // TODO: 接云端后调用注销接口删除账号及全部服务端数据（PRD 第十节 User/账号状态）
    wx.showToast({ title: '已注销。愿未来的你，一切都好。', icon: 'none', duration: 1800 });
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/home/home' });
    }, 1600);
  }
});
