---
name: mw-ship
description: 把一个 3D 打印件从「设计」送到「上架」的编排层：串起 校核 → 文案 → 渲染 → 发布模型 → 加打印配置，负责顺序、确认门、失败即停、结果落盘与最终报告，本身不做任何能力实现。当要做「一整件东西从建模到 MakerWorld 上架」「把这条流水线跑一遍」「按流程发布我的模型」「帮我走完设计到发布」时使用。单点能力分别走 print-part-check / mw-listing-check / makerworld-session / makerworld-publish。
---

# mw-ship — 从设计到上架（编排）

> ✅ 状态：骨架已建（2026-10-21）。本 skill 只写顺序与确认门；能力全部在原子 skill 里。

## 原子边界

| 做 | 不做（去哪） |
|---|---|
| 定义 `project.json`、排队各阶段、卡确认门、失败即停、写报告 | 建模、改参数、导 STL → `blender-part` |
| 决定「先做什么、什么时候停下来问人」 | 判 STL 能不能打 → `print-part-check` |
| 把每步结果写回 `project.json` 与 `stage-*.json` | 写/验文案 → `mw-listing-check` |
| 汇总最终 URL 与未完成项 | 登录态 → `makerworld-session` |
| | 填表/上传/封面裁剪/发配置 → `makerworld-publish` |

## 数据契约：`project.json`（唯一真源）

所有阶段只读它、只回写自己那一段。字段见 `mw-listing-check` 的输入契约，另有：

```json
{ "publish": { "modelId": null, "modelUrl": null, "profileUrl": null, "status": "new|model_live|profile_review|done" } }
```

阶段结果各写一份 `stage-<名字>.json`：

```json
{ "stage": "check", "status": "ok|blocked|failed", "artifacts": [], "metrics": {}, "failures": [], "next": "" }
```

## 顺序（串行，除画出来的一处并发）

```
0 设计/建模   blender-part：改参数 → 出 STL + report.json（**不开浏览器**）
                                              ──FAIL(建不出来/尺寸不对)──> 回 0 改参数
1 校核        print-part-check  ──FAIL──> 回 0，把断言数字原样贴出来（非流形 N / 越床 N mm）
2 渲染        出交付图（可选）；与 3 可并发
3 文案        mw-listing-check  ──FAIL──> 改 project.json 的 listing 块后重跑（不碰浏览器）
4 【确认门 A】素材齐不齐：实拍 ≥3、覆盖 3 个视图
5 【确认门 B】许可证三问（改编 / 商用 / 再分发）→ 落到 project.json 的 license
6 【确认门 C】标题 + 描述首段给用户过目
7 session.check ──NEED_LOGIN──> 停：请用户登录（makerworld-session -Action login）──> 继续
8 发布模型    makerworld-publish 流程 A ──> 写回 modelId / modelUrl，status=model_live
9 【确认门 D】现在要不要发打印配置（可选）
10 发配置     makerworld-publish 流程 B ──> 写回 profileUrl，status=profile_review
11 报告
```

**为什么是这个顺序**：

- **0–3 全离线，且最便宜**。建模和文案改十次都不产生任何平台副作用，所以必须排在要登录/要发布的前面。
- **登录态放在第 7 步、不放在最前面**。cookie 会过期：设计+渲染可能耗上一两小时，
  开头查完 `LOGGED_IN` 到真要发布时可能已经失效。**在浏览器步骤之前查一次**，11 秒的事。
- **第 8 步之后任何改动都要重新发布**（会多出重复条目），所以素材与文案必须在第 6 步前定稿。
- **2 与 3 可并发**：渲染只依赖 STL，文案只依赖设计事实，互不依赖。

## 失败策略

- **任何阶段 `failed`/`blocked` → 整条停**，不做"跳过继续"。已发布的模型不会因为后续失败而消失，
  但要避免产生第二个重复条目。
- 同一阶段**最多重试 1 次**；第二次仍失败就停，把 `failures` 原样贴给用户。
- 停的时候必须说清三件事：**卡在哪一步、判据给出的数字是什么、下一步该谁做什么**。

## 报告（每次必出）

```
模型：<title>  →  <modelUrl>（审核中/已发布）
打印配置：<profileUrl 或 "未发">
校核：非流形 0 / 包围盒 … / 每件 … g
文案：标题 N 字 · 标签 N 个 · 许可 <license>
未完成：<列表或"无">
```

## 与其他 skill 的关系

| 需要什么 | 去哪 |
|---|---|
| 建模、改参数、导 STL、几何自检 | `blender-part` |
| 判「能不能打」 | `print-part-check` |
| 判「文案过不过」 | `mw-listing-check` |
| 有没有登录态 | `makerworld-session` |
| 怎么点、怎么填、坑在哪 | `makerworld-publish` |
| 把这条流程做成 DSH 模式 | `~/.dsh/agent-modes/makerworld-ship/`（4 阶段子代理，见其 README） |
