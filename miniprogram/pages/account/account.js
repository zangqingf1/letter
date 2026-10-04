// 10 · 账号管理 —— 资料区使用微信官方「头像昵称填写能力」：
// 头像 open-type="chooseAvatar"、昵称 type="nickname" 输入框（合规方案，getUserProfile 已下线）。
// 资料/注销经 user 服务处理（本地 storage 或云端），「我的」页名片读取同一份数据。
const userService = require('../../services/user.js');
const privacyService = require('../../services/privacy.js');

// 生日只收「月 · 日」，不收出生年份：后续的「生日来信」只需要月日，也少收一份隐私。
// 二月恒按 29 天（闰日出生也允许，来信时机由后续功能自行归到 2/28 或 3/1）。
const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const DAYS_OF_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const BIRTHDAY_RE = /^(\d{2})-(\d{2})$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dayLabelsOfMonth(monthIdx) {
  const arr = [];
  for (let i = 1; i <= DAYS_OF_MONTH[monthIdx]; i += 1) arr.push(i + ' 日');
  return arr;
}

Page({
  data: {
    statusBarHeight: 20,
    profile: { nickname: '', avatar: '', birthday: '' },
    avatarChar: '友',
    wroteDays: '',
    birthdayRange: [MONTH_LABELS, dayLabelsOfMonth(0)],
    birthdayIndex: [0, 0],
    birthdayText: ''
  },

  onLoad() {
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });
    this.loadProfile();
    // 头像按钮（open-type="chooseAvatar"）与昵称输入框（type="nickname"）都是隐私组件：
    // 未同意《用户隐私保护指引》时点了不会有任何反应，且原生按钮拦不住点击，
    // 所以进页面就把授权弹窗消化掉，用户真正点头像时已是就绪状态
    privacyService.ensure().then((ok) => {
      if (!ok) {
        wx.showToast({
          title: '需同意隐私政策后才能修改头像昵称',
          icon: 'none',
          duration: 2500
        });
      }
    });
  },

  loadProfile() {
    userService.getProfile().then((profile) => {
      profile.birthday = profile.birthday || '';
      this.setData({
        profile,
        avatarChar: (profile.nickname || '友')[0],
        wroteDays: profile.wroteDays
      });
      this.applyBirthday(profile.birthday);
    }).catch((err) => console.error('[account] 资料读取失败', err));
  },

  // 把已存的 MM-DD 回填到两列选择器（非法/为空时显示占位文案）
  applyBirthday(birthday) {
    let m = 0;
    let d = 0;
    let text = '';
    const match = BIRTHDAY_RE.exec(birthday || '');
    if (match) {
      const mm = parseInt(match[1], 10);
      const dd = parseInt(match[2], 10);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= DAYS_OF_MONTH[mm - 1]) {
        m = mm - 1;
        d = dd - 1;
        text = (m + 1) + ' 月 ' + (d + 1) + ' 日';
      }
    }
    this.setData({
      birthdayRange: [MONTH_LABELS, dayLabelsOfMonth(m)],
      birthdayIndex: [m, d],
      birthdayText: text
    });
  },

  // 切月份列时联动天数列（并把已选日夹回当月范围内）
  onBirthdayColumn(e) {
    if (e.detail.column !== 0) return;
    const m = e.detail.value;
    const days = dayLabelsOfMonth(m);
    const d = Math.min(this.data.birthdayIndex[1], days.length - 1);
    this.setData({ 'birthdayRange[1]': days, birthdayIndex: [m, d] });
  },

  onBirthdayPick(e) {
    const v = e.detail.value || [];
    const m = v[0] || 0;
    const d = v[1] || 0;
    const birthday = pad2(m + 1) + '-' + pad2(d + 1);
    this.setData({
      'profile.birthday': birthday,
      birthdayText: (m + 1) + ' 月 ' + (d + 1) + ' 日'
    });
    this.saveProfile();
  },

  onBirthdayClear() {
    this.setData({ 'profile.birthday': '', birthdayText: '' });
    this.saveProfile();
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
    userService
      .saveProfile(this.data.profile)
      .catch((err) => {
        console.error('[account] 资料保存失败', err);
        wx.showToast({ title: '没存上，再试一次吧', icon: 'none' });
      });
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
