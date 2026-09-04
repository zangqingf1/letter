# 心灵信箱 · Web 管理后台

纯静态单页后台（无构建步骤），部署到 CloudBase **静态网站托管**，通过 `admin` 云函数读写云数据库。管理主题（themes）、信纸版式（papers）、用户（users）、会员状态（members）与会员专属内容（member_items）、数据看板与用户统计。

> **隐私红线**：本后台不提供任何信件正文/回信内容的查看能力，所有统计均为计数聚合。这是产品「内容属于用户」原则的一部分，改动时不得破坏。

## 功能

| 模块 | 说明 |
|---|---|
| 数据看板 | 用户/信件/废纸篓/草稿/重读/回信 六项总量；近 7/30 天按天趋势；events 埋点按事件名聚合 |
| 主题管理 | themes 集合增删改查、上下架、排序、一键导入官方 7 套 |
| 版式管理 | papers 集合配色 colors/名称/上下架/排序管理、一键导入官方 10 套（版式视觉结构在代码中，后台不可新增结构） |
| 用户管理 | users 分页列表 + 昵称搜索 + 状态筛选（正常/封禁/注销）；封禁/解封账号；行内点开看统计详情（含草稿数、废纸篓数、会员状态、快捷设为会员） |
| 会员管理 · VIP 用户 | members 集合分页列表（按状态筛选）；按 openid 开通/续期/取消会员（套餐 + 有效期天数 + 自动续费标记） |
| 会员管理 · 专属内容 | member_items 集合按 **信纸 / 信封** 两个子 Tab 分开管理（增删改查、上下架、排序）；新建时可从已有的版式（papers）/主题（themes）中挑选，自动带入 ID/名称/配色，修改后保存为专属款；一键导入官方 5 款（3 专属信纸 + 2 专属信封） |

## 鉴权

- 两种配法任选其一：
  - **代码配法（最简单）**：打开 `cloudfunctions/admin/index.js`，把 `FALLBACK_KEY` 改成你的强密钥，随函数一起部署。
  - **环境变量配法**：控制台点函数名 `admin` 进详情 →「函数配置」→ 编辑环境变量，新增 `ADMIN_KEY`。
- 优先级：环境变量 > `FALLBACK_KEY`；两者都不配置时云函数拒绝一切请求（fail closed）。
- Web 端拿不到微信 openid，白名单以密钥形式落地；请使用强随机串，若仓库要公开需先移除代码里的密钥。

## 部署步骤（从头到尾完整清单）

1. **配密钥**：编辑 `cloudfunctions/admin/index.js` 的 `FALLBACK_KEY`（见上节）。
2. **部署云函数**：微信开发者工具 → cloudfunctions 目录 → 右键 `admin`「上传并部署：云端安装依赖」；`theme` 有改动（新增 papers action），同样重新部署。部署完在控制台云函数列表能看到 `admin` 状态正常。
3. **建 HTTP 网关路由**：控制台 →「HTTP 网关」→ 路由管理 →「添加该域名路由」：路由路径填 `/admin`，资源类型选**云函数**，资源对象选 `admin`，**跨域设置开启**（允许跨域，静态页才能调用），身份认证选**关闭/无需认证**（鉴权由密钥承担）。保存后得到路由地址：`默认域名 + /admin`。
4. **填路由地址**：编辑 `admin/app.js` 顶部 `CONFIG.API_URL`，把上一步的完整地址填进去。
5. **上传前端**：控制台 →「静态网站托管」→ 文件管理，在**根路径**上传 `index.html`、`style.css`、`app.js`（注意是「上传文件」且当前路径为 `/`；若 `index.html` 不在根路径，访问会报 404 NoSuchKey）。
6. **建集合**：控制台数据库新建 `papers` 集合（`themes` 若不存在也一并创建；`members`、`member_items` 同样需创建）。集合权限保持默认私有即可，后台全部经云函数读写。进入后台点「导入官方 7 套 / 导入官方 10 套 / 导入官方 5 款」完成初始化。
7. **验证**：浏览器打开静态托管默认域名 → 输入密钥登录 →「数据看板」有数字、主题/版式列表可见即通。

> 本方案不依赖 js-sdk、匿名登录与 Web 安全域名（旧方案被服务端 ACCESS_TOKEN_DISABLED 拦截后切换为 HTTP 网关直连）。HTTP 路由本身是公开的，但每个 action 都要求密钥，密钥不对一律拒绝。

## 会员管理说明（2026-09，后台预置 + 小程序真实支付）

- **members 集合**：VIP 用户状态，按 openid 一对一：`{ _openid, state:'vip'|'free', level:'month'|'quarter'|'year'|'custom', plan_name, expires_at, renew, total_days, granted_at, granted_by, updated_at }`。后台「开通/续期」由 `memberGrant` 写入（granted_by='admin'）；小程序真实支付发货由 member 云函数写入（granted_by='xpay'），两条链路共用一张表。`total_days` 为累计会员天数，驱动 VIP 等级称号分档（寄字/守候/长情）。
- **member_items 集合**：专属版式（kind='paper'，存 colors）与专属主题（kind='theme'，存 swatch + 可选 `assets` 信封素材），**已真实接入小程序**：`theme` 云函数下发时并入主题/版式列表（premium 标记），写信第二步/详情/分享三端以通用专属模板渲染（取色 bg/ink/gold，后台改配色即生效），非 VIP 写信页见锁定款（🔒，点击引导开通）；会员页点击专属信纸可预览真实版式渲染示例，专属主题配置 `assets.envelope` 后会员页/写信页显示真实信封图（留空回落默认信封，卡片显示色样）。seed 与 `miniprogram/pages/member/premium.js` 同源手工同步（改色请两处一起改）。
- **member_orders 集合**：会员订单（待支付/已发货）。member 云函数 `subscribe` 下单落 created；云开发「消息推送」把 `xpay_goods_deliver_notify` 推回后按 out_trade_no 幂等置 delivered 并写 members。
- **小程序端已接入真实虚拟支付（个人·道具直购）**：`services/member.js` 云端 `getMembership` 走 member/get、`subscribe` 走 member/subscribe → `wx.requestVirtualPayment`；**未配置时自动回落本地演示态**（`member_demo_state`，不产生扣款），后台预置的 VIP 状态与专属内容在未配置期不影响小程序行为。
- **用户管理**：新增 `status='banned'`（后台封禁）与 `banned_at`；`user` 云函数 `ensure/getProfile` 对封禁账号返回 `banned` 错误，小程序端 `services/user.js` 弹窗提示并阻断。「注销」仍物理删除全部数据（现含 members/member_orders 记录）。

## 会员中心真实支付部署清单（member 云函数）

小程序端已写好真实支付代码，要真机跑通需完成以下部署配置（未完成则自动回落本地演示态，不影响其它功能）：

1. **开通虚拟支付（个人）**：确认小程序主体为个人、服务类目含「工具」、已完成认证与备案；MP 后台 → 虚拟支付 → 开通 → 签约。记下 **OfferID** 与 **现网 AppKey**（虚拟支付 → 基本配置）。
2. **创建并发布道具**：MP 后台 → 虚拟支付 → 道具管理，创建三档一次性道具（**月卡 ¥1 / 季卡 ¥25.9 / 年卡 ¥99.9**），把三档 productId 填入 `cloudfunctions/member/config.js` 的 `PRODUCTS`（价格以 MP 后台为准，代码 goodsPrice 单位为「分」）。道具发布后约 10 分钟生效。
3. **部署 member 云函数**：微信开发者工具 → cloudfunctions 目录 → 右键 `member`「上传并部署：云端安装依赖」。
4. **配置环境变量**：控制台 → 函数 member → 配置 → 环境变量，新增 `XPAY_OFFER_ID`（OfferID）、`XPAY_APP_KEY`（现网 AppKey）与 `XPAY_APP_SECRET`（小程序 AppSecret，MP 后台 → 设置 → 开发设置获取；`code2Session` 不支持云调用，需用它 HTTPS 直调换取 sessionKey 算签名）。
5. **绑定发货推送**：开发者工具 → 云开发 → 设置 → 其他设置 → **消息推送** → 推送模式选「云函数」→ 添加配置：消息类型 `event`、事件类型 `xpay_goods_deliver_notify`、云函数选 `member`。member 云函数按 `event.Event` 识别该推送并发货，返回 `{ErrCode:0}`（非 0 平台会重试，最多 15 次）。
6. **iOS（可选）**：iOS 支付需微信 ≥ 8.0.68（代码已前置校验）；如需 iOS 端，另在 MP 后台配置小程序简称并开通苹果 IAP 支付。
7. **验证**：沙箱环境（env=1，需在 MP 后台沙箱配置加测试号）或小额真单：下单 → wx.requestVirtualPayment → 支付 → 收到发货推送 → members 翻 vip → 会员页轮询翻亮。后台「会员管理」可见该用户 VIP 记录（granted_by='xpay'）。

## 小程序侧联动

- 小程序 `services/theme.js`：`getThemes` / `getPapers` 云端模式分别调 `theme` 云函数的 `list` / `papers` action，只取 `status='online'` 文档；云端为空或失败回落本地内置配置，小程序永不被后台改动打挂。
- 信件锁定创建时的 `theme_version` / `paper_version`；老信件遇到已下架/已删除的版式按未知 id 回落第一套（留白志）渲染。
- 下架某主题/版式只影响新写信件的选择列表，不影响历史信件阅读。

## 文件

```
admin/
├── index.html   # 单页骨架（登录 + 主界面 + 编辑抽屉）
├── style.css    # 纸感风格样式
└── app.js       # 全部逻辑（顶部 CONFIG.API_URL 填 HTTP 网关路由地址）
```

后端在 `cloudfunctions/admin/`（action 分发，与其它云函数同风格），读取侧 `cloudfunctions/theme/` 与 `miniprogram/services/theme.js`。

## 更换云开发环境

同时改三处：`admin/app.js` 顶部 `CONFIG.API_URL`（重建路由）、`miniprogram/config/env.js` 的 `CLOUD_ENV`、新环境的云函数部署与 `papers`/`themes` 集合。
