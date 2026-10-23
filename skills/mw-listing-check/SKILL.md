---
name: mw-listing-check
description: 发布前把 MakerWorld 模型文案卡在合规线上（标题 ≤50 字、实拍 ≥3、标签数与重复、许可证三选一、描述禁 Markdown 与超长段），输出机器可读的 lint.json。当要「检查文案能不能过」「标题超长没超长」「这段描述会不会被平台当字面显示」「标签是不是太多/重复」「许可证选哪个」「发布前先把关」时使用。只做判据，不生成文案、不碰浏览器。
---

# mw-listing-check — 发布前文案门

> ✅ 状态：本机实测通过（2026-10-21，盘子架底座真实文案全绿：标题 33 字 / 6 段 435 字 / 9 标签 / 4 实拍；注入 5 类违规的反例全部抓到）

## 原子边界

| 做 | 不做（去哪） |
|---|---|
| 读 `project.json` 的 listing 块，判合规，出 `lint.json` | 写文案 → 写文案的 agent / 人 |
| 卡平台的硬规则（字数/张数/枚举） | 填表上传 → `makerworld-publish` |
| 拦「富文本会原样显示 Markdown」这类体验坑 | 判断文案好不好读 → 人 |

## 用法

```powershell
node "$env:USERPROFILE\.agents\skills\mw-listing-check\scripts\lint_listing.mjs" `
    "D:\parts\plate-rack-base\project.json" --out "D:\parts\plate-rack-base\out\lint.json"
```

退出码 0 = 全绿；1 = 有 errors（warnings 不影响退出码）。

## 输入契约（`project.json`）

```json
{ "title": "≤50 字", "category": "收纳工具",
  "license": "CC-BY-NC | FULL-OPEN | NO-DERIV",
  "tags": ["..."],
  "desc": ["段1", "段2", "..."],
  "media": { "photos": ["..."], "renders": ["..."], "cover": "photo_01.jpg" },
  "geometry": { "stl": ["..."] } }
```

`license` 三个枚举对应发布页那两个问题：

| 值 | 含义 | 发布页怎么勾 |
|---|---|---|
| `CC-BY-NC` | 可改编、不可商用 | 改编=是 + 商用=否 → 落 CC BY-NC |
| `FULL-OPEN` | 改编/商用/再分发都允许 | 改编=是 + 商用=是 |
| `NO-DERIV` | 只许下载打印 | 改编=否 |

**发布页只有「改编」「商用」两问，没有单独的「再分发」开关**——别在文案里承诺平台没有的许可。

## 判据（errors 级）

- 标题 1–50 字，无 Markdown
- 分类非空
- 许可证在三枚举内
- 标签非空、≤50、无重复
- 描述 ≥4 段、每段 ≤200 字、总计 ≤2000 字、**无 Markdown**（`**`、`#`、`- ` 开头、反引号、图片/链接语法）
- 实拍图 ≥3 张（平台硬校验），≤16
- 渲染图 ≤16
- `cover` 必须在 `photos` 里（封面必须实拍）
- `geometry.stl` 非空

warnings 级：标签不在 8–10、描述不是 6 段、没指定 cover、标签超 30 字。

## 为什么把 Markdown 当硬错误

平台描述是**富文本编辑器**，`**加粗**` 不渲染，会原样显示星号——读者看到的是
「**重点**：这是加粗」。同理 `#` 标题、`-` 列表、反引号在那边都只是字面字符。
**写文案时就用纯文本分段**，不要写 Markdown 再指望它渲染。

## 坑

| 现象 | 根因 | 对策 |
|---|---|---|
| `JSONDecodeError: Unexpected UTF-8 BOM` | PowerShell 的 `Set-Content -Encoding UTF8` 写出带 BOM | 脚本已用 `utf-8-sig` 读，两种都能读 |
| 标题字数对不上平台计数 | 平台按**字符**算（一个汉字=1），不是字节 | 脚本用 `len()` 数字符，与平台一致 |
| 描述里用「·」分隔看起来像列表 | 那是普通字符，不会被当 Markdown | 允许；只有行首 `- ` 才算列表语法 |

## 与下游的分工

`lint.json` 全绿**只是必要条件**：它保证不会被平台的表单校验拦下，
但「读起来是不是人话」不在判据里。发布前仍要人工过一眼标题与首段。
