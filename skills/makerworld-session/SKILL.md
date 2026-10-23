---
name: makerworld-session
description: 为 MakerWorld 发布准备并复用登录态（一次性登录，之后免短信验证码）。当需要「每次发模型都要重新登录」「登录态能不能存下来」「cookie 能保存吗」「打开 MakerWorld 又是登录页」「cf_clearance 不跨会话」或任何 makerworld 发布流程开始前，先用本 skill 把会话准备好，再交给 makerworld-publish 去填表。
---

# MakerWorld 登录态（playwright-cli 持久 profile）

> ✅ 状态：本机实测通过（2026-10-21，cookie 跨 close→reopen 存活已验证；Bambu 账号一次性登录后免短信待下一次发布复验）

## 为什么以前每次都要重登

`playwright-cli open` 默认起的是**临时 profile**（浏览器关掉，cookie 跟着没）。所以每次发模型都要
重新过 Cloudflare + 收短信验证码。

`playwright-cli` 本身就带持久化参数（`--persistent` + `--profile <目录>`），**把 profile 指到固定目录**，
cookie / localStorage / cf_clearance 就都落盘，下次同一目录起来仍然是登录态。

**实测证据（2026-10-21）**：用 `--persistent --profile ~/.mw-browser` 打开 baidu 写入
`mwtest=alive`，`close` 之后用同一目录重开，`document.cookie` 里 `mwtest=alive` 仍在。

## 三条铁律

1. **必须 headed**。headless 被 Cloudflare 直接 403，而且 cf_clearance 不跨指纹。
2. **profile 目录固定且唯一**：`%USERPROFILE%\.mw-browser`（macOS：`~/.mw-browser`）。
   换目录 = 换浏览器身份 = 要重新登录。
3. **浏览器 channel 也要一致**（默认 chromium 就一直 chromium）。换 channel（如 `--browser chrome`）
   指纹变了，CF 会重新盘问。

## 用法（Node，跨平台，本机已验证）

```powershell
$S = "$env:USERPROFILE\.agents\skills\makerworld-session\scripts\makerworld-session.mjs"

node $S check    # 只查，桌面会弹一个窗口；11~30 秒
node $S login    # 首次/过期时用：轮询等人登录（默认最多 600 秒，--timeout 可调）
node $S open     # 只开窗不判断（要自己操作时）
node $S close    # 收尾（profile 保留）
```

macOS / Linux 用同一个 `.mjs`，路径换成 `~/.agents/skills/...` 即可 —— 这是不再用 `.ps1` 的原因。

## 实现要点（Node 版踩过的两个坑）

1. **`open` 会一直阻塞到浏览器关闭**，所以必须脱离进程树启动。
   Windows 上**不要** `spawn('cmd.exe', ['/c', 一整行命令])`：引号会在 cmd 里被吃掉，
   浏览器根本起不来（表现为 `browser_open_timeout`）。**写成 `.cmd` 文件再启动**才对。
2. **不要 `execFile(..., {shell:true})`**：Node 24 会报 `DEP0190`（带 shell 传 args 数组 =
   拼接未转义的参数）。用 `exec(整串命令)` 代替，参数都是内部常量，无注入面。
3. 不再需要旧版那个 `ping -n 7201` 保活：`open` 本身活到浏览器关闭为止，
   `close` 之后它自己退出，不留挂着的 cmd。

## 输出契约（给上层编排读）

脚本只打一行 `KEY=VALUE`，脚本返回码 0=成功：

| 输出 | 含义 |
|---|---|
| `STATE=LOGGED_IN` | 已登录，可以直接进发布流程 |
| `STATE=NEED_LOGIN` | 未登录/已过期，先跑 `-Action login` 并让人去窗口操作 |
| `STATE=LOGIN_OK` | `login` 动作检测到登录成功 |
| `URL=<当前地址>` | 附带当前页，便于排错 |
| `ERR=<原因>` | profile 被占用 / CF 拦截 / 超时 |

## 判据：怎么判断"已登录"

用 **`/zh/my/models/publish?type=original`**（需要登录才能进的创建页）作为探针：
未登录会被 302 到 `bambulab.cn/zh-cn/sign-in?ticket=...`。
**不要**用首页判断——首页未登录也能看，会假阳性。

```
Page URL 含 sign-in  -> NEED_LOGIN
Page URL 含 makerworld.com.cn -> LOGGED_IN
```

## 失败模式

| 现象 | 根因 | 对策 |
|---|---|---|
| 打开就是登录页（手机号已预填） | profile 是新的 / cookie 过期 | 跑 `-Action login`，只需这一次 |
| 403 安全验证页 | 用了 headless，或换了 profile/channel | 回到 headed + 同一 profile |
| `Target page, context or browser has been closed` | 上一轮没 close 就又被任务树回收 | 先 `-Action close` 再 open |
| profile 被占用（`ProcessSingleton`） | 同时开了两个同目录浏览器 | 关掉残留 chrome/msedge 再试 |
| 登录后仍 403 | 换过 IP（代理/热点） | 用同一出口 IP 重新过一次 CF |

## 与 makerworld-publish 的分工

本 skill **只负责"有没有登录态"**；填表、上传、封面裁剪、打印配置发布全在 `makerworld-publish`。
发布流程开头固定插一步 `check`：`NEED_LOGIN` 就停下来让人登录，不要硬着头皮往下走
（那种情况下表单页会 302，表现为"按钮点了没反应"）。
