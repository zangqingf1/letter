# 心灵信箱 · Web 管理后台

纯静态单页后台（无构建步骤），部署到 CloudBase **静态网站托管**，通过 `admin` 云函数读写云数据库。管理主题（themes）、信纸版式（papers）、数据看板与用户统计。

> **隐私红线**：本后台不提供任何信件正文/回信内容的查看能力，所有统计均为计数聚合。这是产品「内容属于用户」原则的一部分，改动时不得破坏。

## 功能

| 模块 | 说明 |
|---|---|
| 数据看板 | 用户/信件/废纸篓/草稿/重读/回信 六项总量；近 7/30 天按天趋势；events 埋点按事件名聚合 |
| 主题管理 | themes 集合增删改查、上下架、排序、一键导入官方 7 套 |
| 版式管理 | papers 集合配色 colors/名称/上下架/排序管理、一键导入官方 10 套（版式视觉结构在代码中，后台不可新增结构） |
| 用户管理 | users 集合分页列表（昵称/注册时间/状态）+ 每人信件/重读/回信计数，点击行看统计详情 |

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
6. **建集合**：控制台数据库新建 `papers` 集合（`themes` 若不存在也一并创建；集合权限保持默认私有即可，后台全部经云函数读写）。进入后台点「导入官方 7 套 / 导入官方 10 套」完成初始化。
7. **验证**：浏览器打开静态托管默认域名 → 输入密钥登录 →「数据看板」有数字、主题/版式列表可见即通。

> 本方案不依赖 js-sdk、匿名登录与 Web 安全域名（旧方案被服务端 ACCESS_TOKEN_DISABLED 拦截后切换为 HTTP 网关直连）。HTTP 路由本身是公开的，但每个 action 都要求密钥，密钥不对一律拒绝。

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
