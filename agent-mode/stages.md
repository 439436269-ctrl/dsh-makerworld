# stages.md — MakerWorld 出货线 阶段交接契约

> 子代理按这里干活；**能力规格**在对应原子 skill（冲突时以 skill 为准）。
> 每个阶段都必须写 `stage-<名字>.json` 到项目目录：

```json
{ "stage": "design", "status": "ok|blocked|failed",
  "artifacts": ["out/stl/a.stl"], "metrics": {"nonmanifold": 0, "bbox": [161,129,16]},
  "failures": [], "next": "listing/render" }
```

---

## design —— 设计子代理

- **进**：项目目录、参数（底盘尺寸 / 材料 / 已有 3MF）、上一轮 stage-design.json
- **做**：从 `blender-part` 的骨架复制一份（图元/布尔/倒角/导出/自检都已带好），改参数 →
  Blender headless 出 STL → 跑 `print-part-check` → 写 stage-design.json
- **不要从零写建模脚本**：`blender-part` 的五条硬规矩（坐标系只选一套、刀具不共面、先布尔后倒角、
  拼缝不倒角、导出 scale=1000）每一条都对应一次真实的废件；照抄骨架比重新踩一遍便宜
- **产物**：`out/stl/*.stl`、`out/report.json`、`stage-design.json`
- **验收**（缺一即 failed）：
  1. 每个 STL 非流形边 **0**
  2. 单件包围盒 < 打印床（默认 240；可传 bed_mm）
  3. 配合尺寸有实测证据（射线打点 / 回读），不能只有渲染图
  4. Blender 自报的体积/包围盒与 `print-part-check` 独立解析的结果对得上（两套实现互证）
- **禁止**：渲染、文案、发布
- **重派**：带 `failures` 与具体断言数字重派同一阶段

## listing —— 文案子代理

- **进**：`stage-design.json`、项目事实（尺寸/材料/实测数字）
- **做**：写 `project.json` 的 `listing` 块 → 跑 `mw-listing-check` 到全绿
- **产物**：`project.json`、`stage-listing.json`
- **验收**：标题 ≤50 字；标签 8–10；许可证三选一；描述 6 段、无 Markdown、单段 ≤200 字
- **禁止**：编造未做过的实测；改几何
- **注意**：许可证必须由用户在确认门选定，子代理只按已选值落笔

## render —— 渲染子代理

- **进**：`stage-design.json`（STL/blend）、镜头表（主图/本体/爆开或剖面/顶视）
- **做**：Blender Cycles 出图 → `renders/*.png` + `stage-render.json`
- **产物**：PNG（≥2 张，建议 4 张）、`stage-render.json`
- **验收**：图能打开且非空白；主图看得出「零件在用什么位置」；剖面能读出壁厚
- **三个顺序坑**（照做，否则构图会裁切）：fit 相机前 `view_layer.update()`；分辨率在 fit **之前**设；剖面切割的刀具面不许与模型面共面
- **禁止**：改几何、写文案

## publish —— 发布子代理（独占 `-s=mw`）

- **进**：`project.json`（listing + media）、`stage-design.json`、3MF（可选）、许可证
- **做**：
  1. `makerworld-session -Action check`；**NEED_LOGIN 立即停**，回报主代理（不自己登录）
  2. 按 `makerworld-publish` 流程 A 发模型（STL → 实拍 ≥3 → 渲染图 → 标题/分类/标签/许可证/描述 → 4:3 封面 → 发布）
  3. 拿真实 modelId（从 `/zh/@user_xxx/upload` 新卡片链接读，**不是 draft id**）
  4. 有 3MF 才走流程 B 发打印配置（**必须 fileChooser upload，drop 会 0 byte**）
- **产物**：`stage-publish.json`（modelId / modelUrl / profileUrl / 审核状态）
- **验收**：模型页可匿名打开；图 `naturalWidth>0`；「下载 STL」在；提交后计数 +1
- **禁止**：重复发布同一模型；替用户重切 3MF；同时开两个浏览器会话

---

## 串并行

```
design ──┬─→ listing ──┐
         └─→ render  ──┴─→ 确认门 → publish
```

`listing` 与 `render` 都只依赖 design 的产物，可在同一条消息里并发；其余必须串行。

## 主代理的确认门（子代理不得自行跨过）

1. 素材齐：实拍 ≥3 张（不同视图）
2. 许可证三问（改编 / 商用 / 再分发）
3. 文案过目（标题 + 描述首段）
4. 是否现在发打印配置（可选）
