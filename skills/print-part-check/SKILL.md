---
name: print-part-check
description: 判断一个 STL 到底能不能打（非流形边、洞、是否越床、体积与耗材估算、零面积面），输出机器可读的 check.json。当需要「这个件能不能打」「模型有没有破面」「怎么验 STL 是不是闭合的」「打印床放不放得下」「估一下耗材多少克」「改完参数重新校核」时使用。不建模、不修网格，只做判据。
---

# print-part-check — STL 可打印性判据

> ✅ 状态：本机实测通过（2026-10-21，盘子架底座 half 98.53 cm³ / 113 g / 非流形 0，与 Blender bmesh 报告逐项一致）

## 原子边界

| 做 | 不做（去哪） |
|---|---|
| 读 STL，算几何判据，出 `check.json` | 建模、改几何 → 项目自己的 Blender 脚本 |
| 判「能不能打」（流形 / 洞 / 越床） | 判「好不好看」→ `part-render` + 人 |
| 估体积与耗材克数 | 精确切片代价 → 交给切片器（本 skill 只做量级） |

## 用法

```powershell
node "$env:USERPROFILE\.agents\skills\print-part-check\scripts\check_stl.mjs" `
    "D:\parts\plate-rack-base\out\stl\plate_rack_base_half.stl" `
    "D:\parts\plate-rack-base\out\stl\plate_rack_base_half_mirror.stl" `
    --bed 240 --density 1.24 --out "D:\parts\plate-rack-base\out\check.json"
```

- `--bed` 打印床边长（默认 240，A1/P1P 是 256，X1 是 256）
- `--density` 材料密度 g/cm³（PLA 1.24、PETG 1.27、ABS 1.04）
- 只传**要打印的件**，别传整个目录（目录里若有展示用的合体件会拉低总判，见下）
- 退出码：0 全通过 / 1 有失败 / 2 没找到 STL

## 输出契约

```json
{ "pass": true, "bed_mm": 240,
  "files": [{ "file": "...", "tris": 4546, "bbox_mm": [161,129,16],
              "volume_cm3": 98.53, "area_cm2": 561.5, "grams_est": 113,
              "nonmanifold_edges": 0, "boundary_edges": 0,
              "zero_area_faces": 0, "watertight": true, "fits_bed": true,
              "pass": true, "reasons": [] }] }
```

## 判据怎么读（别把两种坏边搞混）

| 字段 | 含义 | 判失败？ |
|---|---|---|
| `boundary_edges` | 只属于 1 个面的边 = **有洞**，网格没闭合 | ✅ 失败 |
| `nonmanifold_edges` | 被 **>2 个面**共享的边 = 非流形（布尔/倒角常这么坏） | ✅ 失败 |
| `zero_area_faces` | 面积 < 1e-9 mm² 的三角 | ❌ 只报数，不判失败（切片器能吞，但渲染会出黑点） |
| `fits_bed` | 三边都 ≤ bed | ✅ 失败 |
| `grams_est` | `壳 = min(体积, 面积×0.16)` + 其余 15% 填充 × 密度 | ❌ 估算，只做量级 |

体积用有向四面体和算，**只有闭合网格才有意义**（`watertight=false` 时体积仅供参考）。

## 已知事实：合体件的 28 条非流形边是「正常」的

`plate_rack_base_full.stl`（322×129×16）实测 `nonmanifold_edges=28`、`boundary_edges=0`。
**不是坏件**：它是两件各自完整的水盘在 x=0 贴合，拼缝处两道墙叠在一起，
于是那些边被 4 个面共享。它只用于展示，本来也越床（322 > 240）。
**判据只对「要打印的单件」有意义**——这也是不要把整个目录喂进脚本的原因。

## 坑

| 现象 | 根因 | 对策 |
|---|---|---|
| 两个本该同点的顶点被判成分裂 | STL 是 float32，坐标有 ~1e-6 抖动 | 脚本按 **0.001 mm 量化**焊点；更细的特征会被合并，别用它查 <1 µm 的缝 |
| 二进制 STL 被当成 ASCII | 有些二进制 STL 文件头以 `solid` 开头 | 脚本按 `文件长度 == 84 + n×50` 判定，不看文件头 |
| 控制台中文乱码 | Windows 控制台是 GBK，脚本输出 UTF-8 | **以 `--out` 的 JSON 文件为准**（UTF-8），控制台只当进度 |
| 体积明显偏小 | 网格有洞或法向翻了 | 先看 `boundary_edges`；为 0 再怀疑法向（本脚本用 `abs` 求和，法向翻转不影响体积） |
