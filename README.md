# dsh-makerworld

把 **MakerWorld 出货流水线**装进 DeepSeek Harness 的 skill 包：1 个编排 skill + 5 个原子 skill，
装完即出现在 agent 的技能目录里，**不需要往 `~/.agents/skills` 拷任何文件**。

> Bundled skill pack for DSH: a MakerWorld publishing pipeline — design → check → listing → render →
> publish model → add print profile — served through a built-in skill provider.

写它是为了解决一个具体问题：把一件 3D 打印件从「设计」送到「上架」，中间有 6 个**互不相同**的失败模式
（打不出来 / 看不出 / 不合规 / 登录掉 / 静默未发布 / 3MF 传成 0 字节）。每个失败模式对应一个原子 skill，
每个原子都能单独测；编排层只负责顺序、确认门和失败即停。

## 包里有什么

| skill | 干什么 | 进出 |
|---|---|---|
| `mw-ship` | **编排**：设计 → 校核 → 渲染 → 文案 → 发布模型 → 加配置，含 4 道确认门 | `project.json` → 报告 |
| `blender-part` | 参数化建模骨架（图元/布尔/倒角/导出 + 五条硬规矩） | `.py` → STL + blend |
| `print-part-check` | 判「能不能打」：非流形边、洞、越床、体积与耗材 | STL → `check.json` |
| `mw-listing-check` | 判「文案过不过」：标题长度、实拍张数、标签、许可、Markdown | `project.json` → `lint.json` |
| `makerworld-session` | 登录态：固定 profile + 有头浏览器，一次登录之后免短信 | 会话状态 |
| `makerworld-publish` | 平台手册：填表、上传、封面裁剪、发打印配置，以及全部踩过的坑 | 浏览器操作 |

## 安装

```bash
# 直接从 GitHub（推荐；npm 尚未发布）
dsh plugin --profile web add github:439436269-ctrl/dsh-makerworld

# 本地开发
dsh plugin --profile web add "link:D:\codes\.dsh-plugins\src\dsh-makerworld"
```

卸载：`dsh plugin --profile web remove dsh-makerworld`。

只放出部分 skill（默认六个全放）——在 profile 自己的 `cordis.patch.yml` 里按 id 覆写：

```yaml
- id: dsh-makerworld
  config:
    enabledSkills: [mw-ship, print-part-check]
```

## 验证装没装好

```bash
node test/provider.test.mjs     # 包自身：6 个 skill 能否列出与加载
```

装进 profile 后，让 agent 说「列一下你的 skill，有没有 mw-ship」，能报出来即生效。
`lib/index.js` 在 `apply()` 里向 `ctx.skills` 注册一个 rank 600 的 provider —— **你自己的同名 skill 会胜出**，
不会被这个包遮蔽。

## 可选：多子代理形态（DSH agent 模式）

`agent-mode/` 下是同一个流程的**多子代理形态**：主代理只做确认门与验收，四个阶段各派一个子代理
（`subagent_design` / `subagent_listing` / `subagent_render` / `subagent_publish`），
阶段交接契约在 `agent-mode/stages.md`。

它是**独立的 bundle**，不随本包自动注册（改 profile 有把应用弄挂的风险，注册四步写在
`agent-mode/README.md` 里）。要点：

- `subagents` 服务与 `spawn` backend **由 profile 提供**，preset 里不要再挂 —— 挂了会
  `service "subagents" has been registered`，整个模式加载失败。
- 委派组要带 `isolate: { workflowEngine: true }`（照抄标准预设的 delegation 组）。
- `agent-mode/bundle/check.mjs` 是不变量检查：阶段名唯一、全部 spawn + maxDepth 1 + persona 非空、
  包可解析、**禁止在 preset 里重复挂服务**。改完必跑。

## 为什么这些判据可信

- **两套实现互证**：`blender-part` 自报的体积/包围盒，与 `print-part-check` 独立解析同一 STL 的结果对得上
  （模板件 47.1 cm³ vs 47.11 cm³；真实件 98.53 cm³ / 113 g，与 Blender bmesh 逐项一致）。
- **反例必须能抓住**：`mw-listing-check` 注入 5 类违规（标题 72 字、非法许可、重复标签、`**加粗**`、
  只留 2 张实拍）时全部报错、退出码 1；正例全绿。
- **「加载失败」这类问题只能靠日志**：结构对、组合通过都不代表运行时能加载 —— 部署后要看启动日志。

## 目录

```
lib/            provider（把 skills/ 提供给 ctx.skills）
skills/         六个 skill 的正文与脚本
agent-mode/     可选的多子代理形态（bundle + 阶段契约 + 检查器）
cordis.patch.yml
```

## License

MIT
