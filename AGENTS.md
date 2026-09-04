# AGENTS.md — 心灵信箱 · 微信小程序开发规范

> 本文档是本仓库对后续 agent 的唯一入口，全部内容以**当前代码实际实现**为准（2026-08 核对）。新增页面或目录后必须同步更新「目录登记」一节。

## 项目概述

「心灵信箱」是一款微信小程序：用户把"当下想明白的问题 + 答案"写成数字信件封存，未来遇到类似问题时拆信重读并写下回信。

**三条不可违背的产品原则**（改动前先确认不与之冲突）：
- **100% 私人化**：无社区、公开内容、搜索他人、点赞、评论、好友关系。`sitemap.json` 全站 `disallow`，不被微信索引。
- **明确不使用 AI**：系统不做 AI 生成、改写、润色或心理分析，用户内容保持原文。
- **内容属于用户**：视觉主题只负责表达，不做内容分类或干预。

## 技术形态

- 微信小程序 + 微信云开发（CloudBase），无独立后端、无 npm 构建、无测试命令。
- appid `wx3afb5493420deef2`；**用微信开发者工具打开项目根目录 `D:\vibeCoding\j`**（根目录 `project.config.json` 配置 `miniprogramRoot: miniprogram/` + `cloudfunctionRoot: cloudfunctions/`；`miniprogram/project.config.json` 供在 miniprogram 目录内单独打开用，二者同 appid）。
- 数据源由 `miniprogram/config/env.js` 切换：`USE_CLOUD = true`（当前为云端模式，`CLOUD_ENV = 'cloudbase-d1gp46d6he3bbf9f0'`）；置 `false` 回落本地 storage 演示模式。改动云函数后需在开发者工具重新部署，否则 services 的版本校验（如 draft `VER===2`）会 console.warn 并静默回落。
- 改动后在开发者工具中预览验证，无构建命令与测试。

## 页面与信息架构

共 11 个页面（app.json），全部 `navigationStyle: custom`。底部 TabBar 仅两项：**信箱（home）/ 我的（mine）**；"写一封新信"为首页悬浮/底部主入口，不占 Tab。

1. **信匣 home（Tab1）**：三状态 empty/few/normal，本地模式由 `pages/home/mock.js` 的 `DEMO_STATE` 切换演示池。今日来信每日随机一次、当日固定（本地按日期种子确定性随机；云端由 `today` 云函数按「用户+日期」种子计算并写回 `today_letter_of`，跨设备同日一致）。few 态 1–6 封 ±2° 伪随机倾斜（按 id 种子），超过 8 封切三列整齐网格且回形针信件前置。条件性草稿横条（显示真实草稿数）。冷启动骨架：`home.json initialRenderingCache: static` + data.loading 首帧色块；数据统一在 onShow 拉（onLoad 不拉，避免双请求）。寄出回传 `letter_just_arrived`（storage，消费即清除）触发新信约 800ms「落格」动效。
2. **写信第一步 write**：一页信纸完成名称/问题/答案（均必填，字数上限常量 20/500/2000）。进入时空白新信，不自动预填；未写完的草稿以卡片陈列在书写区下方（「没写完的信」，点击载入续写，卡片可删除——二次确认后**彻底删除、不进废纸篓**，删当前正在写的同时清空表单）。保存时机仅两处：点「💾 存草稿」（成功即返回首页，Toast「已存草稿」跨页保留）或退出点系统弹窗「确定」（`enableAlertBeforeUnload`，message「这封信还没写完。」，仅表单有内容时触发）；**无自动保存**（无 10s/失焦/onHide）。多草稿 upsert（storage 键 `letter_drafts`，`currentDraftId` 跟踪）。
3. **写信第二步 step2**：上半预览区横向 swiper 左右滑动切换信纸版式（圆点指示 + 当前版式名，可点切），高度随内容自适应、长文纸内滚动；下半信封（主题）横滑卡片（有信封素材展示信封图，无素材展示配色色样）；火漆按钮「封存寄出」。寄出落 `paper_id + paper_version`（与 theme 同源锁定）、删对应草稿（按 draftId 精确清除；无 id 直开兜底 clearAll）、写 `letter_just_arrived` 并 switchTab 回首页。内容经 eventChannel 传入，直开本页回退读草稿。云端模式首次寄出弹一次账号确认（标记 `user_sealed_once`，注销清除）。寄出动效：火漆按压 → 全屏完成幕（固定文案「已封存。未来的某一天，它会在这里等你。」，点击任意处跳过）→ 淡出回信匣。**会员专属展示规则**：专属信纸（预览纸右上角）/专属主题（卡片右上角）非 VIP 带 🔒 但**可自由预览/选中**，仅点「封存寄出 / 保存修改并封存」时才弹会员引导（onLockedItem，「去开通」跳会员中心）；会员过期后编辑专属老信按默认版式/主题回退展示，未主动更换时保存**保留原专属 id**（开通后自动恢复）。
4. **详情 detail**：进入播拆信动画（约 1.3s，可点击跳过）并自动产生当日重读记录（同日不重复）。阅读态 = 信纸卡（固定纸色版式，`styles/paper.wxml` 共享模板渲染，与写信预览/分享图完全同构）+ 邮戳墙（收起展示最早 5 枚 + 今天，其余「+N 展开/收起」）+ 回信便签流（每条右上「撕掉」，二次确认后**物理删除、不进废纸篓**）+ 半屏回信抽屉（日期固定不可改，服务端生成回信日期；成功 Toast「📌 回信已贴好。这封信越来越厚了。」）+ 底部四图标操作栏：✏️ 编辑 / 📎 回形针 / 📤 分享 / 🗑 删除（删除确认「放纸篓」进 30 天废纸篓）。
5. **编辑**：详情页复用写信两步（`write?mode=edit&id=`，eventChannel 传全量信件），预填原信；**编辑态不提供存草稿**，退出保护 message「这次编辑还没有封存，确定离开吗？」，「确定」离开丢弃修改；第二步回选原主题与原版式，落款仍为「写于」创建日期（不显示改写时间），主按钮「保存修改并封存」，只更新内容/主题/版式并记 updated_at，重读记录与回信静默原样保留；完成幕「已重新封存。那些新的思考，也一起安放好了。」，navigateBack(delta 2) 回详情，不播落格动效。
6. **分享 share**：进入即全屏预览（固定纸色版式明信片，`styles/paper.wxml` 共享模板渲染；名称/问题/答案/写信日期四项固定全展示；**重读记录与回信永不入图**），底部小程序条（火漆 Logo 环 + 「心灵信箱 · 把答案寄给未来」+ 小程序码 `assets/qrcode.jpg`，加载失败回落暗格占位）。离屏 Canvas 2d 导出：宽 1080 固定、高按换行实测自适应（超长按字号²比例缩小字号、极端超长截断答案兜底），十款版式装饰由 `drawXxxStyle` 按 `paper.colors` 完整重绘（与 WXSS 同一套 rpx 值）；生成图不入云端历史。操作 = 保存到相册（权限拒绝引导 openSetting）/ 发给微信好友（`showShareImageMenu`，低版本 previewImage 兜底）。
7. **废纸篓 recycle**：30 天保留（`KEEP_DAYS=30`，临近 `WARN_DAYS=3` 天强调态）；左滑（跟手拖动、过半吸附、单行展开）露「↩️ 取回」（原样恢复，含重读与回信）与「🗑️ 彻底」（二次确认后物理删除）。首查且为空时一次性落演示数据（`recycle_demo_seeded` 标记）。云端另有 cleaner 定时清理 + listRecycle 兜底双通道。
8. **回形针 clips**：「我的」页回形针数量行进入；与信匣同源数据筛 `pinned`，纸条交替 ±0.5° 微倾 + 金色 clip.png 角标，轻触直达详情。回形针点亮/取下只在详情页底部操作栏做。
9. **我的 mine（Tab2）**：品牌区 + 名片（点击进账号管理）+ 2×2 微倾便签统计（信件总数/被重读总次数/回信条数/注册天数，本地演示值、云端 stats 实数）+ 回形针/废纸篓数量行（本地实时计算）+ 功能列表（关闭手写体开关项、用户协议/隐私/关于——后三项均为 TODO 占位）。
10. **账号管理 account**：微信官方头像（`open-type="chooseAvatar"`）与昵称（`type="nickname"`）填写能力；资料存 `account_profile`（云端头像先 uploadFile 换 cloud:// fileID），「我的」名片 onShow 读同源数据。注销 = 页内二次确认（「仍要注销/再想想」），确认后按 `user.js` 的 `USER_DATA_KEYS` 清单清除全部用户数据（`handwriting_off` 设备偏好保留），Toast 告别文案后 reLaunch 回首页；云端走 user 云函数 deactivate 物理删除。
11. **关于 about**：静态品牌介绍页（「我的」页功能列表「关于心灵信箱」进入），长卷式图文——Hero（logo + 标语）+ 壹贰叁肆四章（写下/封存/重逢/安放，全部插画为 WXSS 手绘：迷你信纸、信封火漆、CSS 逐字旋转邮戳、便签卡）+ 火漆印收尾；零数据依赖、不接 services（仅 statusBarHeight + 返回）。设计源文件：根目录 `心灵信箱-关于页设计提案.html`。
12. **会员中心 member**：付费 VIP 会员页（「我的」页金调入口行进入）——会员状态卡（free 虚线引导 / vip 金色火漆卡）+ 权益清单（专属信纸版式 / 专属主题信封 / 专属内容全解锁）+ 会员专属主题与版式展示（`premium.js` 色样卡 + 🔒，数据与写信页同源）+ 订阅半屏拉手（**一次性月卡 ¥1 / 季卡 ¥25.9 / 年卡 ¥99.9**）+ 开通成功完成幕。**已接入真实微信虚拟支付（个人·道具直购）**：`member` 云函数下单（signData+paySig+signature，`crypto` HMAC-SHA256）→ 前端 `wx.requestVirtualPayment` 拉起支付 → 支付成功后平台经云开发「消息推送」把 `xpay_goods_deliver_notify` 推回 member 云函数发货（写 `members` 集合，按 out_trade_no 幂等），前端轮询会员状态翻成 vip。OfferID / 现网 AppKey / 小程序 AppSecret 走云函数环境变量 `XPAY_OFFER_ID`/`XPAY_APP_KEY`/`XPAY_APP_SECRET`（code2Session 不支持云调用，用 AppSecret 经 HTTPS 直调 `sns/jscode2session` 换 sessionKey），道具 productId 在 `cloudfunctions/member/config.js` 填（与 MP 后台「道具管理」一致）；**未配置或本地模式回落演示态**（`member_demo_state` 本地标记，不产生扣款）。**会员专属内容已真实落地**：后台 `member_items`（kind=paper/theme）由 admin 增删改查，`theme` 云函数下发时并入主题/版式列表（`premium:true` 标记），写信第二步/详情/分享三端通用专属模板渲染（`styles/paper` pl-premium + `share.js drawPremiumStyle`，取色 bg/ink/gold，后台改配色即生效）；非 VIP 在写信页见锁定款（🔒，可自由预览/选中，点「封存寄出」时才引导开通），VIP 解锁；**会员过期回退**：非 VIP 时专属款在所有渲染端（首页/回形针/废纸篓缩略图、详情、分享、编辑预览）一律按默认款展示（`services/theme.js` paperOf/envelopeOf/envelopeThumbOf 按 isVip 回落 list[0]，数据不动），编辑保存未主动更换时保留原专属 id，开通后自动恢复；会员页点击专属信纸弹出真实版式模板渲染的示例预览，专属主题可配信封素材（member_items.assets，后台可填）展示真实信封图。**VIP 等级称号按累计会员天数分档**（members.total_days：寄字 <30 / 守候 <180 / 长情 ≥180，`member` 云函数 get 返回）。后台已预置 `members`（VIP 状态）/`member_items`（专属内容）集合与会员管理界面；`member_orders` 为订单集合（待支付/已发货）。

## 数据模型与业务规则

### 云数据库集合（11 个）
`users` / `letters`（信件主集合，含 status 控制在匣/废纸篓） / `open_records`（重读邮戳） / `reply_records`（回信） / `drafts`（多草稿，一草稿一文档） / `themes`（Web 后台维护，status='online' 才下发） / `papers`（信纸版式配色，Web 后台维护，status='online' 才经 theme/papers 下发） / `events`（埋点） / `members`（会员状态，后台 memberGrant / 小程序发货推送共同写入） / `member_items`（会员专属版式/主题内容，admin 增删改查，theme 云函数并入下发 premium 标记，与 premium.js 同源） / `member_orders`（会员订单：待支付/已发货，member 云函数订阅下单 + 发货推送更新）。本地模式对应 storage 键见「目录登记」services 一节。

### 信件字段
`id, name, question, answer, theme_id, theme_version, paper_id, paper_version, pinned, created_at, updated_at, opens[], replies[], deleted_at`。

### 关键业务规则（代码已实现，改动不得破坏）
- 草稿不进信匣网格、不参与今日来信随机；草稿删除为彻底删除。
- 拆信一次即产生一条重读记录，同日去重，用户不可编辑/删除单条；回信可整条「撕掉」（物理删除，不进废纸篓）。
- 回信日期服务端生成，接口不提供修改。
- 删除信件进废纸篓 30 天（purge_at = 删除时 + 30 天）；恢复时重读记录与回信原样恢复；彻底删除（手动或 cleaner 每日 03:00 定时 + listRecycle 兜底）不可恢复。
- 允许内容重复信件，不去重、不提供复制。
- 回形针（pinned）仅排序前置语义，不改数据归属。
- **信纸配色自持**（2026-08 改版）：信纸 = 固定纸色 + 固定排版（papers.js `colors`），不读取主题 palette；切换主题只换信封（主题卡片/拆信/完成幕）与预览区桌面底色 `desk`。十款版式：留白志 liubai（默认回落款，列表第一套）/ 号外头版 extra / 工程蓝图 blueprint / 存根票根 ticket / 大字标语 poster / 包豪斯几何 bauhaus / 黑胶唱片 vinyl / 素问笺 suwen / 墨夜笺 moye / 航空笺 airmail2（新 id，与旧 airmail 无关）。
- 主题与信纸版式均锁定创建时版本号；未知 theme_id/paper_id 一律回落默认（小王子 / 号外头版）。旧四款（su/airmail/notebook/weave）已移除，老信件 paper_id 失效后渲染为号外头版。
- **会员过期回退**：非 VIP 时专属主题/版式（premium:true）一律按默认款渲染（`theme.js` 的 paperOf/envelopeOf/envelopeThumbOf/paletteOf 均按 isVip 回落 list[0]，不破坏数据），详情/首页/分享/编辑预览随之回退；写信页专属款仍可预览选中、仅寄出时拦截（见 step2）。
- 信纸三端同构：step2 预览、detail 阅读、share 分享图共用 `styles/paper.wxml` 模板 + `styles/paper.wxss` 样式 + `paper-view.js` 展示数据；分享 Canvas 在 `share.js` 的 `drawXxxStyle` 按同一套 rpx 值重绘（取色只用 `paper.colors`），改动版式必须三处同步。
- 云端以 OPENID 做数据隔离：查询隐式带 `_openid`，不接受跨用户参数；云函数写入需显式落归属人字段。存在旧数据自愈机制（letter/today/open/reply 四函数内的 ensureOwned 孤儿信认领）。
- 所有云端列表查询显式 `limit(1000)`，规避云数据库默认 20 条截断。

## services 数据访问层（miniprogram/services/）

页面**禁止**直接 `wx.cloud` 调用或直读数据 storage 键，数据一律经 services 层；`cloud.js` 是云调用唯一出口（`call(name, action, data)` 统一 `{ok, error}` 约定、`uploadFile`/`downloadFile`）。

- **letter.js**：信件全生命周期——getAll/get/create/update/setPinned/recordOpen/addReply/removeReply/persist/moveToRecycle/listRecycle/restoreFromRecycle/purgeFromRecycle。双适配器：cloud 走 letter/open/reply/today 云函数，local 复刻原 storage 行为（键 `letters_mock`/`recycle_mock`/`demo_removed_ids`/`recycle_demo_seeded`）。`ensureReal()` 把演示信在首次写操作时落成真实信（按名称匹配详情 mock 补全正文）。
- **draft.js**：多草稿 list/save/remove/clearAll + 编辑态 getEdit/saveEdit/clearEdit。键 `letter_drafts`（含一次性迁移旧键 `letter_draft_current`）、`letter_edit_current`。云端要求 draft 云函数返回 `ver===2`。
- **user.js**：getProfile/saveProfile/getStats/deactivate；`USER_DATA_KEYS` 是注销清除清单的唯一定义处。
- **theme.js**：主题与信纸版式统一出口——getThemes/envelopeOf/envelopeThumbOf/paletteOf/getPapers/paperOf；云端走 theme 云函数（storage `theme_cache` TTL 24h），归一化兜底信封/palette/desk 与 `ownEnvelope`；getPapers 云端调 theme/papers action（papers 集合由 Web 后台维护），空/失败回落本地 papers.js。
- **analytics.js**：track(event, data)；cloud 攒批（5 条或 15s，失败重试 3 次）调 analytics 云函数 batch，不采集正文。现有事件名：`letter_open, reply_add, letter_delete, letter_restore, letter_permanent_delete, letter_content_complete, draft_save, letter_step2_view, theme_select, paper_select, letter_save, share_image_generate, share_image_save, share_send`。
- **member.js**：会员中心（真实虚拟支付）——getMembership/subscribe/checkIosVersion。getMembership 云端调 member/get（members 集合，与后台 memberGrant 同源），云函数未部署/未配置回落本地演示态；subscribe 云端调 member/subscribe 下单 → wx.requestVirtualPayment 拉起支付（失败含 cancel 时页面提示已取消），未配置 xpay（'not configured'）或本地模式回落 `member_demo_state` 演示开通（不产生扣款）。iOS 需微信 ≥ 8.0.68（checkIosVersion 前置校验）。

## 云函数清单（cloudfunctions/，Node.js + wx-server-sdk，action 分发，返回 `{ok, ...}`）

| 函数 | action | 说明 |
|---|---|---|
| user | ensure / getProfile / saveProfile / deactivate | 静默建档（首次进入不强制登录）；avatar 仅接受 cloud:// fileID；ensure/getProfile 对 status='banned'（后台封禁）返回 banned 拒绝使用；注销物理删除全部数据（含 members/member_orders 记录） |
| letter | get / create / update / pin / moveToRecycle / listRecycle / restore / purge | 核心函数：get 一次拼装信+邮戳+回信；create 校验必填、paper_id 默认 'extra'（2026-08 改，需重新部署）；30 天保留期常量在此 |
| today | mailbox | 今日来信（用户+日期种子确定性随机，写回 today_letter_of）+ 草稿计数聚合 |
| open | add | 重读记录，按 (openid, letter_id, open_date) 幂等去重 |
| reply | add / remove | 回信日期服务端生成；remove 按 created_at 定位单条物理删除 |
| draft | list / save / remove / clearAll | 多草稿 v2（VER=2 供部署校验），MAX_LIST=50 |
| theme | list / papers | 只读下发 status='online' 的主题（palette/desk/envelope/swatch）与信纸版式（paper_id/name/desc/colors），并**并入上架中的会员专属款**（member_items kind='paper'/'theme'，premium:true）；写操作一律走 Web 后台 admin 云函数 |
| admin | auth / themeList / themeSave / themeDelete / themeSeed / paperList / paperSave / paperDelete / paperSeed / statsOverview / statsTrend / eventsSummary / userList / userDetail / userBan / userUnban / memberList / memberGrant / memberRevoke / memberItemList / memberItemSave / memberItemDelete / memberItemSeed | Web 后台（admin/ 静态托管）专用：环境变量 ADMIN_KEY 密钥鉴权（未配置默认拒绝）；用户管理支持昵称搜索/状态筛选与封禁解封（users.status='banned'）；会员管理维护 members 集合（VIP 状态）与 member_items 集合（专属版式/主题）；**隐私红线——任何 action 不读取信件正文与回信内容，仅 count 聚合与 users projection** |
| stats | get | 一次聚合 letterTotal/rereadTotal/replyTotal/registerDays/pinnedCount/recycleCount |
| analytics | batch | 埋点批量入库（单批 ≤50） |
| member | get / subscribe（+ 虚拟支付发货推送回调 xpay_goods_deliver_notify） | 会员中心真实虚拟支付（个人·道具直购）：get 读 members 集合并按累计天数 total_days 分档返回 level（寄字/守候/长情）；subscribe 用 OfferID/AppKey/sessionKey 算 paySig+signature 下单返回 payData，落 member_orders（待支付）；发货推送回调按 out_trade_no 幂等发货写 members（granted_by='xpay'，累计 total_days），返回 `{ErrCode:0}`。配置走环境变量 XPAY_OFFER_ID/XPAY_APP_KEY/XPAY_APP_SECRET + config.js 道具表，未配置返回 'not configured' 前端回落演示态 |
| cleaner | （无 action，定时触发） | config.json 定时触发器 `recycle-clean-daily`，每日 03:00 物理清理到期废纸篓信件及其邮戳/回信 |

## 工作方式

- 小程序代码位于 `miniprogram/`，云函数位于 `cloudfunctions/`；无构建命令与测试，改动后在微信开发者工具中预览验证；云函数改动需重新部署对应函数。
- 数据一律经 `miniprogram/services/` 数据访问层读写；`config/env.js` 切换 local/cloud。完整架构见 `技术架构文档.md`。
- 本文件保持为未来 agent 的唯一入口；新增页面或目录后同步登记到下节。

### 目录登记

```
D:\vibeCoding\j\                     # 开发者工具打开此根目录
├── project.config.json              # 项目主配置（miniprogramRoot + cloudfunctionRoot）
├── project.private.config.json      # 开发者工具本地私有配置（不入库语义）
├── 技术架构文档.md                   # 云开发架构单一事实来源（集合设计/云函数/迁移/埋点/Web 后台）
├── admin/                           # ★ Web 管理后台（静态托管部署）：数据看板/主题/版式/用户管理；部署手册见 admin/README.md
├── 心灵信箱-信纸样式提案（6套）.html    # 信纸样式设计提案一（仅设计参考）
├── 心灵信箱-信纸样式提案二（6套·大胆版）.html  # 信纸样式设计提案二（07–12 号外/蓝图/票根/标语/几何/黑胶，已落码）
├── 心灵信箱-信纸样式重设计（原四款）.html  # 原四款重设计提案（仅设计参考，未落码）
├── picture/                         # 素材原图（logo、mailbox、回形针.png、小王子主题等，勿直接引用）
├── cloudfunctions/                  # 12 个云函数（清单见上节），各含 index.js + package.json
│   ├── member/                      # ★ 会员中心支付：config.js 里填道具 productId；OfferID/AppKey 走环境变量
│   └── cleaner/config.json          # 每日 03:00 定时触发器
└── miniprogram/
    ├── app.json / app.js / app.wxss # 10 页注册 + tabBar；app.js 云模式下 wx.cloud.init + 静默建档；app.wxss 是 Design Tokens 唯一样式来源
    ├── config/env.js                # 数据源切换（USE_CLOUD 当前 true / CLOUD_ENV）
    ├── project.config.json / project.private.config.json / sitemap.json
    ├── styles/                       # ★ 信纸共享渲染层：paper.wxml（十款版式唯一标记来源，三页 import）+ paper.wxss（装饰与排版唯一来源；配色与 papers.js colors 对应）
    ├── services/                    # ★ 数据访问层（见上文各文件职责）
    ├── assets/                      # 已压缩素材；原图在 picture/，勿直接引用
    │   ├── logo.png / name.png / mailbox.png / clip.png / empty-box.png / qrcode.jpg
    │   ├── tab-mail(-active).png / tab-mine(-active).png   # tabBar 图标 81×81
    │   └── theme/xiaowangzi/        # envelope.jpg 高清 + envelope-thumb.jpg 缩略（唯一有自有信封素材的主题；paper.png 为方案B前遗留、零引用）
    └── pages/
        ├── home/                    # 01 信匣（Tab1），三状态 + 今日来信 + 草稿横条 + 冷启动骨架；mock.js（DEMO_STATE: empty/few/normal）
        ├── write/                   # 02 写信两步：write.* 第一步（含草稿陈列区、编辑态 mode=edit 分支）；step2.* 第二步（版式 swiper + 主题横滑 + 寄出动效）；papers.js 十款信纸版式配置（id/colors 唯一事实来源；云端 papers 集合为空时的回落，与 admin seed 手工同步）；paper-view.js 三端共享展示数据；themes.js 7 套主题配置（palette+desk，palette 现仅剩主题色样占位用途）
        ├── detail/                  # 03 拆信/阅读/回信三状态：拆信动画、邮戳墙、回信便签流（可撕掉）、半屏回信抽屉、底部四图标操作栏、编辑/分享入口；mock.js（DEMO_STATE: multi/first）
        ├── share/                   # 04 分享明信片预览 + Canvas 2d 导出（宽 1080 自适应高、版式装饰层、qrcode.jpg 小程序码）
        ├── recycle/                 # 05 废纸篓：30 天/临近 3 天强调/左滑取回与彻底删除；mock.js（DEMO_STATE: full/empty）
        ├── clips/                   # 06 回形针优先展示列表（与信匣同源筛 pinned）
        ├── account/                 # 10 账号管理：官方头像昵称填写 + 注销（USER_DATA_KEYS 清除清单）
        ├── about/                   # 11 关于心灵信箱：静态品牌介绍页（WXSS 手绘插画长卷，零数据依赖）
        ├── member/                  # 12 会员中心：付费 VIP（真实虚拟支付：个人·道具直购）——状态卡/权益清单/专属主题版式锁定/订阅半屏拉手；mock.js + premium.js（专属版式与主题色样，不接入三端同构）
        └── mine/                    # 09 我的（Tab2）：名片 + 2×2 便签统计 + 回形针/废纸篓行 + 会员中心金调入口 + 功能列表；mock.js 演示值
```

## 当前已知遗留（接手时先看）

- `handwriting_off`（手写体无障碍开关）被 write/detail/share 三页读取，但**没有任何页面提供写入入口**（「我的」页开关项为 TODO 占位）。
- 「我的」页用户协议/隐私仍为占位（「关于心灵信箱」已落地 `pages/about/about`）。

- 云端模式头像上传已实现（saveProfile 非 cloud:// 头像先 uploadFile 换 fileID）。
- 会员中心 `pages/member/` 已接入真实虚拟支付（member 云函数 + wx.requestVirtualPayment），但需完成**部署前配置**才能真机跑通：MP 后台虚拟支付开通、道具管理创建并发布三档道具（productId 填入 `cloudfunctions/member/config.js`）、member 云函数环境变量 `XPAY_OFFER_ID`/`XPAY_APP_KEY`/`XPAY_APP_SECRET`、云开发「消息推送」把 `xpay_goods_deliver_notify` 绑定到 member 云函数（步骤见 `admin/README.md`）。未配置时自动回落本地演示态。专属版式/主题已接入三端同构渲染与写信页解锁，等级称号按 `members.total_days` 分档已落地。
- Web 后台（`admin/` + `admin` 云函数）需要人工在 CloudBase 控制台完成一次性配置才能用：部署函数、开启匿名登录、配 Web 安全域名、设 `ADMIN_KEY` 环境变量、上传静态文件、建 `papers`/`members`/`member_items` 集合并一键导入官方主题/版式/专属内容。步骤见 `admin/README.md`。
