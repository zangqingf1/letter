# admin Web 后台 · 界面测试

对应 `测试流程.md` §8。这里把「网络」这一层换成 mock，`admin/app.js` 与 `admin/index.html`
一行未改（仅在响应时注入一段同源脚本挂载假 fetch），所以测的仍是真实前端代码。

```bash
node tests/admin-ui/mock-server.js        # → http://127.0.0.1:8799/
```

mock 数据：25 个用户（20 条/页，第 5 个已封禁、第 7 个已注销）、23 条反馈、6 个 VIP 会员、
2 个主题（1 上架 1 下架）、5 个版式（1 下架）、4 条会员专属内容（其中 `vinyl` / `xiaowangzi`
与主题/版式列表同 id，用来验证状态列的「👑 会员」标签，另两条是只存在于专属内容的独立 id）。
页面里可用 `window.__ui` 检查调用：

```js
__ui.calls                 // [{ action, data }] 全部请求
__ui.callsOf('userBan')    // 按 action 过滤
__ui.reset()               // 清空记录
__ui.failNext('userList')  // 让下一个该请求返回业务错误，测错误分支
```

## 为什么 CSP 允许这样注入

`admin/index.html` 的 CSP 是 `script-src 'self'`（禁内联脚本，杜绝第三方脚本窃取管理员密钥）。
mock 脚本由同一台 mock 服务器以 `/__mock-api.js` 提供，仍属同源，因此注入的是
`<script src="/__mock-api.js">` 而不是内联代码——不触碰 CSP 规则。

## 已执行的检查与结果（2026-09 实测通过）

| 项 | 操作 | 结果 |
|---|---|---|
| 登录 | 输入密钥点登录 | 进入主界面，`auth` 携带 `key` |
| 数据看板 | 进入即渲染 | 6 张统计卡 + 埋点表 2 行 + 趋势表 7 行（近 7 天） |
| 用户分页 | 25 人看第 1/2 页 | 20 行 / 5 行；第 1 页「上一页」禁用，末页「下一页」禁用；来回切换状态正确 |
| 状态筛选 | 选「已封禁」 | 只剩 1 行，徽标「已封禁」，操作按钮变「解封」 |
| 昵称搜索 | 输入「用户02」 | 1 行，共 1 人；重置按钮恢复全量 |
| 封禁 | 点「封禁」 | 确认文案正确，`userBan` 传 `openid-u02`，列表刷新为已封禁 |
| 反馈列表 | 进入 | 23 条，第 1 页 20 行，截图列显示「📷 2」 |
| 反馈详情 | 点行 | 展开详情行：反馈全文、`截图预览（2 张，点击放大）`、1 张缩略图 + 1 个 fileID 文本（无 url 的截图按 fileID 兜底显示） |
| 截图灯箱 | 点缩略图 | 灯箱打开，计数 `1 / 1`，图片 src 正确；按 Esc 关闭 |
| 标记已处理 | 详情行内按钮 | `feedbackUpdate{id,status:done}`，Toast「已标记为已处理」，列表状态刷新 |
| 删除反馈 | 详情行内按钮 | 确认文案含「将连同其云端截图一并删除，不可恢复」，`feedbackDelete` 后总数 23 → 22 |
| 会员续期 | 「续期」→ 抽屉选年卡 → 提交 | `memberGrant{plan:'year',days:366}`，抽屉关闭，Toast「已续期」 |
| 会员撤销 | 行内「取消」 | 确认「取消用户「用户04」的会员资格？」，`memberRevoke{openid-u04}` |
| 主题上下架 | 点「下架」 | `themeSave{theme_id:'xiaowangzi',status:'offline'}`，行内徽标同步 |
| 主题抽屉字段 | 点「编辑」 | 取色框只有 3 个：`swatch` / `desk` / `palette.base`；**没有** `palette.title` / `palette.text` / `palette.tag`（三档墨色 2026-09 已清理，信纸墨色由版式自持） |
| 主题底色落库 | 改底色 → 保存 | `themeSave` 的 `theme.palette` 是 `{base:'#xxxxxx'}`（只有 base 一个键） |
| 主题底色清空 | 清空底色框 → 保存 | `palette` 落成 `{}`（不是 `{base:''}`）—— 服务端归一化按「有没有 base」判空，空对象才能回落默认款 |
| 专属内容主题抽屉 | 会员管理 → 专属内容 → 信封 → 编辑 | 同样只有 `swatch` / `desk` / `paletteBase` 三个取色框，保存后 `item.palette` 只含 base |
| 主题拖动排序 | 按住「墨夜」行首拖动块拖到「小王子」下方 | 行随指针挪位（拖动态纸色加深），松手 `themeSave` 只回写值变化的两行（`moye.sort=1` / `xiaowangzi.sort=0`，**仍带原 status**）、Toast「顺序已更新」，列表按新顺序重渲染 |
| 拖动块只点不拖 | 点一下拖动块 | 不产生任何请求、顺序不变 |
| 会员专属标签 | 主题/版式页看状态列 | `xiaowangzi` / `vinyl` 行多一枚金色「👑 会员」（与「上架」并排）；其余行只有「上架/下架」 |
| 版式拖动排序 | 把 `liubai` 拖到第 3 位 | `paperSave` 恰好 3 次（`extra=0` / `blueprint=1` / `liubai=2`），未动的 `ticket` / `vinyl` 不发请求 |
| 版式页 | 进入 | 5 行，配色色数正确显示 |
| 退出登录 | 点「退出登录」 | 回到登录视图，主界面隐藏 |

## 未覆盖（需要真网关）

- 真实 HTTP 网关的跨域、鉴权、限流行为 → 见 `测试流程.md` §8 AD-02/AD-14（需 `ADMIN_KEY`）
- 截图临时 URL 的真实换取（`getTempFileURL`）→ 需云环境
- 云存储文件是否真被删除 → 需云环境
