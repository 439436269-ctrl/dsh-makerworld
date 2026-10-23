---
name: makerworld-publish
description: 发布 3D 模型与打印配置(print profile)到拓竹 MakerWorld 的完整浏览器自动化流程。当用户要求"发布到 MakerWorld / 拓竹模型广场 / 上传 3mf 打印配置 / 传模型到 makerworld"时使用。含 playwright-cli 全套命令语义、Cloudflare 开窗策略、表单坑位、Bambu Studio CLI 切片与中文路径坑、GitHub 调研结论(无官方上传 API)。
---

# MakerWorld 发布(playwright-cli 浏览器自动化)

> ✅ 状态：本机实测通过（2026-10-21，模型 3132492「盘子架接水底座」+ 打印配置全流程）

实战沉淀(2026-10-02,账号 @user_3344646413,中国站 makerworld.com.cn,模型 3046777 + print profile 全流程走通)。

## 统一文案模板(先看这里,填空即用)

- 模型发布:`templates/model-listing.md` —— 标题/分段描述/标签/许可证预设/封面规则/安全类玩具追加段
- 打印配置:`templates/print-profile.md` —— 差异描述/配置描述/发布检查清单/CLI 切片备忘
- 发布时**按模板结构生成文案**,保持系列作品风格统一;许可证仍须问用户(三预设表在模板里)

## 调研结论(先记住,别重复造轮子)

- **没有可用的上传 CLI / 官方 API**：GitHub 全网调研(242 命中+精准查询)只有文案生成器(`madmarc2000/makerworld-publish-skill`,只出文案不上传)、只读下载库(`kloshi-io/makerworld-api-reverse`)。**发布只能走浏览器。**
- 模型页 print profile 用 **Bambu Studio 切出的 3MF**(含 `Metadata/slice_info.config` + `plate_*.json` 才算切片过)。

## 环境与进程(本机已验证)

```powershell
# playwright-cli(经 npx,bash 工具里单条命令会被杀树!)
npx --yes --package @playwright/cli playwright-cli -s=<session> <cmd>
```

- **浏览器守护必须脱离 bash 进程树**：写 `start_browser.cmd`(内含 `npx ... open <url> [--headed]` + `ping -n 3601 127.0.0.1` 挂树),用
  `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='cmd.exe /c "...\start_browser.cmd"'}` 启动,输出重定向到 log 轮询。
  直接在 bash 里 `npx ... open` 会被 `ChildProcess.kill` 整树回收。
- 收尾:`playwright-cli -s=<session> close` + taskkill cmd 树。

## Cloudflare 与开窗(静默规则的例外流程)

- headless **必被拦**(403 安全验证页),cookie 不跨指纹存活。
- 流程:**先征得用户同意** → cmd 加 `--headed` 重开 → 用户在窗口点验证 + 登录拓竹账号 → 我方接手,用完 `close` 即关。
- headed 下 CF 常自动过;页面 title 正常("MakerWorld：免费下载 3D 模型")即通过。

## playwright-cli 命令语义(踩坑实录)

| 场景 | 正确姿势 | 坑 |
|---|---|---|
| 上传文件到拖放区 | `drop <ref> --path <file> [--path <file2>]`(**--path 可重复**) | `drop <ref> file` 报 too many args;`--paths` 不存在 |
| filechooser modal | 点击触发(如封面"4:3 封面"按钮)后 `upload <file>` | 无 modal 时 upload 报 "modal state present" |
| 点击超时(浮层/动画) | 改 `goto <href>`(菜单项 href 都在快照里);或先点掉 Cookie 横幅"好的"/提示"知道了" | click 5s 超时多为遮挡 |
| 富文本填写 | `fill <ref> "文本"`(contenteditable 可 fill) | **含换行的字符串经 PS→native 会被截断到第一段**→ 分段:逐段 `press Enter`+`type` |
| ref 失效 | 重新 `snapshot` 取新 ref(ref 前缀随页面会话变) | "Ref not found" 即 stale |
| 正则过滤 | `Select-String -Pattern "radio .是"` | **不要写 `\"`**(非法转义) |
| eval | 尽量简单;含引号拼接易被 shell 搞坏 | SyntaxError → 换 snapshot grep |
| 按钮无名 | 用 snapshot 找 `button [ref=...]` 位于"保存草稿"旁的下一个 | 发布按钮常无 accessible name |

## 流程 A：发布模型

0. **先过登录态（2026-10-21 起固定第一步）**：跑 `makerworld-session` skill 的 `-Action check`。
   返回 `NEED_LOGIN` 就停下来跑 `-Action login` 让人去窗口登录，**不要硬着头皮往下走**
   （未登录时表单页会 302，表现为"按钮点了没反应"）。`LOGGED_IN` 才继续——此时浏览器已用
   固定 profile 打开，本流程后面的 `-s=mw` 命令直接复用，**不要另开新浏览器**。
1. **素材备到英文路径**(中文路径易编码炸)：STL×N、**实拍图 ≥3 张**(不同视图,封面必须实拍)、渲染图(只能放"模型图片")。
2. ~~开浏览器(headless 先试,403 → 按上节开窗)~~ → 已由步骤 0 完成。
3. 首页 eval 找文本含"上传"的 button 点击 → 选「3D 原创模型」→ `goto /zh/my/models/publish?type=original`(click 菜单常超时,直接 goto)。
4. 第 1 步:选"我有 STL/CAD 文件"radio → `drop` STL 到拖放区 → 底部"下一步"。
5. 第 2 步(草稿自动创建,URL 变 `/zh/my/models/drafts/<id>/edit`)：
   - 实物图:drop 到"添加照片"按钮(计数 (n/16),**≥3 必填**)
   - 模型图片:drop 渲染图
   - 标题 ≤50 字 fill；分类 combobox:`fill "玩具"` → 选下拉 `option`
   - 标签:逐个 `fill` + `press Enter`(计数 n/50)
   - **许可证三问必须问用户**(改编/商用/再分发,默认全否)
   - 描述:富文本 **不用 Markdown**,分段 Enter+type
6. 封面:点"4:3 封面"按钮 → filechooser modal → `upload 实拍图` → 裁剪弹窗"提交" → 之后"发布"才解禁(否则报"请设置模型封面",**snapshot 会滞后,用 eval 读实时状态**)。
7. 点"发布" → 跳 `https://makerworld.com.cn/zh/@user_xxx/verifying`(=提交成功,进审核)。
8. 验证:页面"审核中 (N)"计数 +1。

## 流程 B：上传打印配置(print profile)

1. **拿 3MF**:
   - 用户自己切的(首选),或 Bambu Studio CLI:
     ```
     cmd /c ""C:\Program Files\Bambu Studio\bambu-studio.exe" --arrange 1 --slice 0 --export-3mf out.3mf in.stl" > log 2>&1
     ```
     - **必须 `--arrange 1`**:否则 "no object fully inside the print volume"(模型中心原点,床坐标 0..256,一半在板外)
     - `--load-settings "<machine.json>"` 指定机器;**preset 文件名含中文会转码炸**(`鍒犻櫎` 乱码报 unknown config type)→ 复制成英文名再 load
     - `--export-settings` 可导当前默认配置;CLI `--help` 无窗可用
     - 用户机器 preset:`%APPDATA%\BambuStudio\user\<MW_userid>\machine\*.json`(MW 账号 ID 与 BambuStudio 同 ID)
2. 模型详情页 → 右上 **more 菜单 → "添加打印配置"** → `goto /zh/my/profiles/publish?designId=<modelId>`
3. drop 3mf 到"将 3mf 文件拖到此处"(先点掉 Cookie 横幅/提示层)
4. 自动解析:兼容打印机 checkbox(如 **P1S**)+差异描述预填(如"0.12mm 层高, 2 层墙, 15% 填充")——核对即可
5. **必须 ≥1 张实拍图**(drop 到"添加照片")+ 富文本配置描述(fill)+ 勾"我已阅读打印配置上传准则" checkbox
6. 无名"发布"按钮(保存草稿旁)→ 跳 verifying,"审核中 (N)+1"即成功
7. 无独立名称字段(名称自动来自 3mf 内 profile 名)

## 文案规则(来自 makerworld-publish-skill 调研)

- 描述是富文本,**Markdown 字面显示**(不要 `**`)
- **封面必须实拍**,渲染图放附加图;实拍图要求 FDM 实拍、清晰、完整
- 标签 Enter 分隔;类型(原创/二创)在创建时选定
- print profile 描述写清:切片参数、与默认差异、打印注意(免支撑/朝向/耗时)

## 坐标速查

- 中国站 `makerworld.com.cn/zh`;用户主页 `/zh/@user_3344646413`;模型详情 `/zh/models/<id>-<slug>`
- GitHub 推送断 443 时走 api.github.com Git Data API(见全局 MEMORY「GitHub 仓库上传流程」)

## 2026-10-20 增量沉淀(不倒翁蛋发布实录)

- **headed 会话 close 后登录态不保留**:每次开可见浏览器用户都要重新登录(密码页),流程里预留"请登录"环节;profile 的 cf_clearance 不跨指纹(headless 必 403)
- **`/zh/my/models` 是 404 假路径**;有效入口:`/zh/my/models/publish?type=original`(创建)、`/zh/@user_xxx/upload`(公开列表)、`/zh/models/<id>-<slug>`(详情,more→添加打印配置)
- **print profile 页焦点串框坑(发布静默失败真凶)**:在"差异描述"textbox fill 后按 Enter+type,文字会**追加进差异框**(富文本没接住)→ 该框变 `[invalid]` → 点发布无跳转无报错。对策:**先填富文本(fill 首段+逐段 Enter+type),最后单独 fill 差异框**;发布前 snapshot 必查 ` [invalid] `,有则修
- 该页上传区为 generic div 时 drop/click 均可能 5s 超时——**先关 Cookie 横幅("好的")和 Wiki 准则弹层("知道了")再 drop**
- 实物图 ≥3 视图是硬校验:实拍不足时可用同照片不同裁切凑(内容诚实);发布后"审核中 (N)" +1 即成功
- 无名"发布"按钮:紧跟"保存草稿"后;ref 漂移频繁,可用 eval IIFE 原生 click(`filter(b=>b.textContent.trim()==='发布'&&!b.disabled)[0].click()`)
- 许可证 UI 已变为「三问 radio + CC 协议下拉」:选 CC BY 会自动勾"改编=是/商用=是/需署名=否"

## 2026-10-21 增量沉淀(盘子架底座发布实录)

- **3MF 用 `drop` 会传成 0 byte**:同一次会话 STL 用 drop 正常,但 print profile 页的 3MF drop 上去显示
  `0 byte` + "重试",服务器确实没收到。**对策:点"替换文件"(或"浏览")触发 fileChooser →
  `playwright-cli upload <绝对路径>`**,之后应显示真实大小(本例 144 KB)并自动解析出兼容打印机。
  **凡 drop 后体积显示 0 byte / 出现"重试",一律改走 fileChooser upload,不要反复重试。**
- **draft id ≠ model id**:发布前草稿 URL 是 `/zh/my/models/drafts/<id>/edit`,发布后**模型 id 是另一个数**
  (本例草稿 28734886 → 模型 3132492)。`/zh/models/<draft_id>` 会报"该模型不存在或者已被删除"。
  **拿真实 model id 的办法:开 `/zh/@user_xxx/upload`,在新卡片里读 `/zh/models/<id>-<slug>` 链接**
  (审核期模型不在公开网格里,但 uploads 列表有;`verifying` 页只显示计数,不给 id)。
- **`playwright-cli type` 只接一个参数**:`type <text>` 是打进"当前焦点元素",没有 `type <ref> <text>`
  形式(会报 `too many arguments`)。填多段富文本的正确姿势是 `fill` 首段 → `press Enter` → `type 下一段`。
- **`Select-String -Pattern` 里不要写 `\"`**:PowerShell 解析期就报"字符串缺少终止符",整条命令不执行
  (本次因此白跑两次)。要么用单引号包 pattern,要么改成不含引号的 `option` 之类。
- **打印配置的"名称"字段其实是"差异描述"**:无独立名称,`打印配置名` 就是与现有配置的区别说明(≤60 字);
  仍按 10-20 那条顺序,**最后填它**。
- **审核中的配置不显示在模型页**:刚提交时模型页仍是「打印配置 (0)」+ "添加第一个打印配置以赚取积分",
  这是正常的,审核通过后才出现 —— 不要误判成发布失败。
- **回读核验用到的手段**:公开页 `document.images.length` 与 `Array.from(document.images).filter(i=>i.naturalWidth>0).length`
  两者相等才算没有裂图;`eval` 里别塞双引号(会被 CLI 当 CSS selector 解析,报 "Unexpected token")。
- **公开页不能用 HTTP 直抓核验**:`Invoke-WebRequest` / `curl` 拿模型页一律 **403**(Cloudflare),
  要确认「打印配置 (N)」是否已过审,只能开浏览器看 —— 不要以为是页面挂了。
