---
name: blender-part
description: 用 Blender headless 把设计参数做成可打印零件（参数化脚本 → STL + blend + report.json），带图元/布尔/倒角/导出的可复制骨架和五条硬规矩。当要「用 blender 建模」「写参数化零件脚本」「这个件要改尺寸重新出 STL」「布尔切出来是坏的」「倒角把拼缝削出槽」「导出的 STL 尺寸不对」时使用。不判能不能打（走 print-part-check）、不渲染（走 part-render）、不做创意设计。
---

# blender-part — 参数化零件骨架

> ✅ 状态：本机实测通过（2026-10-21，模板独立跑通：120×80×16 浅盘 3172 面 / 47.1 cm³，
> 导出 STL 经 `print-part-check` 独立复核 47.11 cm³ / 非流形 0 / 边界 0）

## 原子边界

| 做 | 不做（去哪） |
|---|---|
| 建模骨架：图元、布尔、倒角、导出、几何自检 | 判「能不能打」→ `print-part-check`（它读 STL，独立于 Blender） |
| 五条几何硬规矩（坐标系/共面/顺序/拼缝/缩放） | 出交付图 → 渲染阶段 / `part-render` |
| 改参数重出 STL | 创意与尺寸决策 → 人 |

## 为什么这份骨架必须是 Python

`part_template.py` 跑在 Blender 进程里，而 Blender 的 `-P` **只吃 Python**——这是唯一不能换成 JS 的脚本。
其余环节（校核、文案、登录态）都已经改成 Node，见各自的 `scripts/*.mjs`。
别为了"统一语言"把这份改成 JS，会直接跑不起来。

## 用法

```powershell
$bl = "D:\SteamLibrary\steamapps\common\Blender\blender.exe"
$tpl = "$env:USERPROFILE\.agents\skills\blender-part\scripts\part_template.py"
& $bl -b --factory-startup -P $tpl -- --out "D:\x\out" --name demo
```

复制模板到项目里改成自己的零件，**别在 skill 目录里改**（那是所有项目共用的）。

```powershell
# 拿完立刻用独立实现复核 —— 别只信 Blender 自报
node "$env:USERPROFILE\.agents\skills\print-part-check\scripts\check_stl.mjs" "D:\x\out\demo.stl"
```

## 骨架里有什么

| 函数 | 用途 |
|---|---|
| `reset_scene()` | 空场景 + 毫米单位 |
| `mk_box` / `mk_cyl` / `mk_prism_plan` / `mk_prism_yz` | 四种图元（矩形/圆柱/XY 轮廓拉伸/YZ 截面拉伸） |
| `fillet_rect(L,D,r)` | 以原点为中心的圆角矩形轮廓 |
| `bool_op(target, cutter, op)` | EXACT 布尔并自动删刀具 |
| `apply_bevel(ob, w, seam_x=None)` | 按锐边加权倒角；`seam_x` 排除拼缝 |
| `cleanup(ob)` | 化退化三角、焊接、重算法线 |
| `mesh_stats(ob)` | 体积/面积/非流形/包围盒 |
| `export_stl(objs, path)` | 导出（`global_scale=1000`，毫米进毫米出） |

## 五条硬规矩（每条都是踩出来的）

1. **坐标系只选一套**。`fillet_rect` 用中心对称（±L/2）；如果你把它改成 0..L，
   内腔/脚窝的坐标也必须整套跟着换。**混用会得到自交多边形：包围盒看着对，体积是错的**
   （本轮实录：轮廓 x 用 0..L、y 用 ±D/2，体积报 103.3 cm³，正确值 152.7）。
2. **布尔刀具不许与零件面共面**。需要穿透时让刀具多伸 1 mm（`over=1.0`）；
   只在「必须切穿」的方向伸，**不要在壁厚方向多缩/多伸**——那会把墙做薄。
3. **先布尔，最后倒角**。倒角在布尔之前做，布尔会把倒角边切开，留下一圈非流形边界。
4. **拼缝面别倒角**：两个件对接的那个平面要平的，否则各削 0.6 → 拼起来 1.2 mm 的 V 槽。
   用 `apply_bevel(ob, seam_x=0.0)`。
5. **导出用 `global_scale=1000`**（模型单位是米、参数是毫米），回读包围盒必须等于你写的毫米数，
   否则切片出来的件是错尺寸。

## 坑表

| 现象 | 根因 | 对策 |
|---|---|---|
| 布尔切完零件没了/只剩一条 | 刀具坐标落到了零件外面（最常见是 Y 轴用了 0..D 而轮廓是 ±D/2） | 先只建图元打 `mesh_stats` 看包围盒，再加布尔逐段验 |
| 布尔只切掉一部分，留下两道残墙 | 刀具与零件共面 | 刀具伸进空腔 1 mm |
| 倒角后非流形边从 0 变几十 | 倒角在布尔前 | 调换顺序 |
| 墙角渲染有黑点 | 倒角留零面积三角 | `cleanup()`；`dissolve_degenerate` 清不掉时可忽略（切片器能吞） |
| 体积比预期小一半 | 轮廓自交（坐标系混用） | 见规矩 1 |
| `wm.stl_export` 报 TypeError | 版本参数差异 | 模板已带 `ascii_format` 兜底重试 |

## 设计方法（不是代码，但决定成败）

- **定位只用「量过的已知量」**：把没量过的尺寸（别人家零件的厚度、宽度）写进配合，
  等于把猜测固化成公差。先问「这个基准我量过吗」。
- **能做成独立件就别做接缝**：接缝只为打印床存在，每多一道缝就多一个漏水/错位/需打胶的理由。
- **抬离、避让这类需求给「固定高度台面」**，不要用 `宽度 × 斜率` 的复合公式——一改尺寸就全变。

## 上下游

```
blender-part（建模+导出） → print-part-check（判能不能打） → 渲染阶段 → 发布
```
