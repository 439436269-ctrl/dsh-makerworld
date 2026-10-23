# makerworld-ship —— DSH agent 模式（多子代理）

把「3D 打印件：开发 → 校核 → 文案 → 渲染 → 发布 → 加打印配置」做成一个可选模式：
**主代理只做确认门与验收**，四个阶段各派一个专属子代理。

> 状态：2026-10-21 建好 bundle，`check.mjs` 全绿（4 阶段 / 0 warnings）。
> **已注册进 desktop profile（2026-10-21 19:36），待重启后验证运行时。** 见「验证记录」。
> **已备份到极空间**：`公共分组/agent-modes/makerworld-ship/`（2026-10-21 20:06，5 文件，verify PASS）。
> 换机器时把整个目录拷回 `~/.dsh/agent-modes/makerworld-ship/`，再按下文「安装」四步注册。

## 模式结构

| 阶段 | 工具名 | 干什么 | 产物 |
|---|---|---|---|
| design | `subagent_design` | 写/改 Blender 参数化脚本、导 STL、跑 `print-part-check` | `out/stl/*.stl` `stage-design.json` |
| listing | `subagent_listing` | 文案（标题/分类/标签/许可/6 段描述）+ `mw-listing-check` | `project.json` `stage-listing.json` |
| render | `subagent_render` | Blender 出交付图（主图/本体/爆开或剖面/顶视） | `renders/*.png` `stage-render.json` |
| publish | `subagent_publish` | 独占 `-s=mw` 发模型与打印配置 | `stage-publish.json`（modelId/URL） |

```
design ──┬─→ listing ──┐
         └─→ render  ──┴─→ 【确认门】→ publish
```

`listing` 与 `render` 可并发；`design`、`publish` 必须串行。**publish 独占浏览器会话**
（同一时刻只许一个子代理碰 `-s=mw`，否则两个代理会抢同一个浏览器上下文）。

确认门全留主代理：素材齐（实拍≥3）、许可证三问、文案过目、是否现在发配置。
阶段交接契约见 [`stages.md`](stages.md)。

## 为什么 publish 必须是一个「独占」子代理

发布是这条链上唯一**有状态**的一步：浏览器会话、登录态、草稿 id 都是全局的，不能并行、不能隔离。
但它又是 token 最重的一步（几十张 snapshot）。所以正确做法不是「拆细」，而是**整段交给一个
子代理串行跑完**——主代理只看它回来的 `stage-publish.json`。

## 安装（4 步，照 dsh-agent-preset-mode 的踩坑）

1. `<profile>/package.json` → `dependencies` 加
   `"dsh-agent-mode-makerworld": "link:../../agent-modes/makerworld-ship/bundle"`
2. 同一文件 → `dsh.profile.bundles` 末尾追加 `dsh-agent-mode-makerworld`（最后应用）
3. `<profile>/node_modules/dsh-agent-mode-makerworld` 建 junction 指向 bundle
4. `<profile>/pnpm-lock.yaml` 的 `importers..dependencies` 加 `specifier`/`version` 两条 `link:`，
   再 `pnpm install --lockfile-only --frozen-lockfile --ignore-scripts` 验一致性

**改完必须重启 DSH**（preset 只在启动时加载、新会话才绑定）；已有会话保留旧组合。

## 为什么还没注册

两个理由，都是「顺序」问题：

1. **原子 skill 还没建完**。阶段 persona 指向 `print-part-check` / `mw-listing-check` / `mw-ship`，
   这些要到 2026-10-21 18:01 的那轮任务里才建。现在装上去，子代理没有可调的能力。
2. **风险窗口**。改 profile 的 package.json 与 lockfile 一旦出错，DSH 起不来；而 18:01 的任务
   依赖这个应用在跑。所以先出 bundle、后注册。

## 验证记录

| 项 | 结果 |
|---|---|
| `node bundle/check.mjs` | ✅ 4 阶段子代理、toolName 唯一、全部 spawn + maxDepth 1 + persona 非空；包解析（profile + 全局安装双根）通过 |
| 注册四步 | ✅ 2026-10-21 19:36 —— package.json（dep + bundles）、junction、lockfile importer 都改了，备份在 `package.json.bak-makerworld-20261021-193536` / `pnpm-lock.yaml.bak-makerworld-20261021-193536` |
| `pnpm install --lockfile-only --frozen-lockfile` | ✅ exit 0（lockfile 与 package.json 一致，18 entries 过供应链策略） |
| `dsh --profile web --dump-config --patch …` | ✅ exit 0，组合结果里能看到 `preset-makerworld-ship` 与 4 个阶段行 |
| **这个 exit 0 的含金量** | ⚠️ **只证明 YAML 能组合，不证明包能解析**——对照实验：包里写一个不存在的 `@deepseek-ai/dsh-does-not-exist-xyz`，`dump-config` 同样 exit 0 |
| 运行时（模式出现在列表、子代理认领身份） | ⏳ **未验证，需重启 DSH** |

## 注册后怎么验（重启一次）

1. 设置 → 通用 → **Agent 模式**：应出现「MakerWorld 出货线」
2. 用该模式新开一个会话，问「你现在是什么模式、有哪些子代理工具」——应答出 persona 身份
   与 `subagent_design / subagent_listing / subagent_render / subagent_publish` 四个工具名
3. 让它派一个 `subagent_design`，看子代理是否**自己认领 design 身份**、且被拒再委派（maxDepth=1）

## 回退

从 `dsh.profile.bundles` 删掉这一行 + 删 junction + `pnpm install`，重启即回原样。
bundle 本身在 `~/.dsh/agent-modes/makerworld-ship/`，删目录也只是丢这个模式。
