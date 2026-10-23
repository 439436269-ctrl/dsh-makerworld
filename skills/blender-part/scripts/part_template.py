# -*- coding: utf-8 -*-
"""
part_template.py — 参数化零件骨架（Blender headless）

用法:
  "D:\\SteamLibrary\\steamapps\\common\\Blender\\blender.exe" -b --factory-startup \
      -P part_template.py -- --out "D:\\x\\out" --name demo

约定（别改，改了两头对不上）:
  * 参数一律用 **毫米** 写；进 bmesh 前乘 MM=0.001（Blender 里 1 单位 = 1 m）
  * 导出 STL 用 global_scale=1000 变回毫米 —— 回读包围盒必须等于你写的毫米数
  * 先做布尔，最后倒角（倒角在布尔前做，布尔会把倒角边切开留下非流形）

产出的三件事:
  <name>.stl      给切片器
  <name>.blend    给人接手
  report.json     几何自检（体积/包围盒/非流形），可直接喂 print-part-check 对照
"""

import bpy
import bmesh
import json
import math
import os
import sys
from mathutils import Vector

MM = 0.001  # 毫米 -> Blender 单位(m)


# ---------------------------------------------------------------- 场景
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.length_unit = "MILLIMETERS"
    sc.unit_settings.scale_length = 1.0


def mk_obj(name, me):
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# ---------------------------------------------------------------- 图元
def _cap(bm, vb, vt):
    """把下方一环 vb 和上方一环 vt 缝成闭合体"""
    n = len(vb)
    bm.faces.new(vb[::-1])
    bm.faces.new(vt)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([vb[i], vb[j], vt[j], vt[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def mk_prism_plan(name, pts, z0, z1):
    """XY 闭合多边形沿 Z 拉伸（pts 用毫米）"""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vb = [bm.verts.new((x * MM, y * MM, z0 * MM)) for x, y in pts]
    vt = [bm.verts.new((x * MM, y * MM, z1 * MM)) for x, y in pts]
    _cap(bm, vb, vt)
    bm.to_mesh(me)
    bm.free()
    return mk_obj(name, me)


def mk_prism_yz(name, prof, x0, x1):
    """YZ 闭合多边形沿 X 拉伸（截面不是矩形时用）"""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vb = [bm.verts.new((x0 * MM, y * MM, z * MM)) for y, z in prof]
    vt = [bm.verts.new((x1 * MM, y * MM, z * MM)) for y, z in prof]
    _cap(bm, vb, vt)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))  # 凹多边形先三角化，布尔更稳
    bm.to_mesh(me)
    bm.free()
    return mk_obj(name, me)


def mk_box(name, x0, x1, y0, y1, z0, z1):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(((x1 - x0) * MM, (y1 - y0) * MM, (z1 - z0) * MM)), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(((x0 + x1) / 2 * MM, (y0 + y1) / 2 * MM, (z0 + z1) / 2 * MM)), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    return mk_obj(name, me)


def mk_cyl(name, r, z0, z1, cx=0.0, cy=0.0, segs=40):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                          radius1=r * MM, radius2=r * MM, depth=(z1 - z0) * MM)
    bmesh.ops.translate(bm, vec=Vector((cx * MM, cy * MM, (z0 + z1) / 2 * MM)), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    return mk_obj(name, me)


def fillet_rect(L, D, r, segs=10):
    """以原点为中心的圆角矩形轮廓（毫米），逆时针。
    注意：X/Y 都用「中心对称」坐标（±L/2, ±D/2）—— 别一个轴 0..L、另一个轴 ±D/2，
    那种混用会得到自交多边形：包围盒看起来对，体积却是错的。"""
    hx, hy = L / 2 - r, D / 2 - r
    pts = []
    for cx, cy, a0 in [(hx, hy, 0), (-hx, hy, 90), (-hx, -hy, 180), (hx, -hy, 270)]:
        for k in range(segs + 1):
            a = math.radians(a0 + 90 * k / segs)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


# ---------------------------------------------------------------- 布尔 / 倒角
def bool_op(target, cutter, op="DIFFERENCE"):
    """EXACT 求解器。**cutter 必须与 target 的所有面都不共面**，否则只切一部分。"""
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = target
    target.select_set(True)
    md = target.modifiers.new(name="bool", type="BOOLEAN")
    md.operation = op
    md.solver = "EXACT"
    md.object = cutter
    md.use_self = False
    bpy.ops.object.modifier_apply(modifier=md.name)
    if cutter.name in bpy.data.objects:
        bpy.data.objects.remove(cutter, do_unlink=True)
    return target


def apply_bevel(ob, width=0.6, segs=3, angle=30.0, seam_x=None, seam_eps=0.05):
    """按锐边加权倒角。seam_x 给定时，该 X 平面上的边不参与倒角。
    用途：两个件对接的拼缝面必须保持平的，否则各削 0.6 → 拼起来是 1.2mm 的 V 槽。"""
    me = ob.data
    me.attributes.get("bevel_weight_edge") or me.attributes.new("bevel_weight_edge", "FLOAT", "EDGE")
    bm = bmesh.new()
    bm.from_mesh(me)
    lay = bm.edges.layers.float.get("bevel_weight_edge") or bm.edges.layers.float.new("bevel_weight_edge")
    thr = math.radians(angle)
    for e in bm.edges:
        w = 0.0
        if len(e.link_faces) == 2:
            try:
                if e.calc_face_angle(0.0) > thr:
                    w = 1.0
            except ValueError:
                w = 0.0
        if w and seam_x is not None:
            if all(abs(v.co.x - seam_x * MM) <= seam_eps * MM for v in e.verts):
                w = 0.0
        e[lay] = w
    bm.to_mesh(me)
    bm.free()

    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    md = ob.modifiers.new(name="bev", type="BEVEL")
    md.width = width * MM
    md.segments = segs
    md.limit_method = "WEIGHT"
    if hasattr(md, "miter_outer"):
        md.miter_outer = "MITER_ARC"
    if hasattr(md, "use_clamp_overlap"):
        md.use_clamp_overlap = True
    bpy.ops.object.modifier_apply(modifier=md.name)
    return ob


def cleanup(ob):
    """化掉退化三角并重算法线（倒角会在墙角留零面积三角）"""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=list(bm.edges))
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data)
    bm.free()


def mesh_stats(ob):
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    vol = bm.calc_volume(signed=False)
    area = sum(f.calc_area() for f in bm.faces)
    nonman = sum(1 for e in bm.edges if not e.is_manifold)
    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    zs = [v.co.z for v in bm.verts]
    d = dict(
        name=ob.name,
        tris=sum(len(f.verts) - 2 for f in bm.faces),
        volume_cm3=round(vol * 1e6, 1),
        area_cm2=round(area * 1e4, 1),
        nonmanifold_edges=nonman,
        bbox_mm=[round((max(xs) - min(xs)) / MM, 2), round((max(ys) - min(ys)) / MM, 2),
                 round((max(zs) - min(zs)) / MM, 2)],
    )
    bm.free()
    return d


def export_stl(objs, path):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    kw = dict(filepath=path, export_selected_objects=True, apply_modifiers=True,
              global_scale=1000.0, ascii_format=False)
    try:
        bpy.ops.wm.stl_export(**kw)
    except TypeError:
        kw.pop("ascii_format", None)
        bpy.ops.wm.stl_export(**kw)
    return path


# ---------------------------------------------------------------- 示例零件
# 换成你自己的参数区：这里是「120×80×16 的浅盘，3mm 底、4mm 壁、外角 R8、底面 4 个 Ø20 脚窝」
P = dict(L=120.0, D=80.0, H=16.0, floor=3.0, wall=4.0, fillet=8.0, bevel=0.6,
         foot_d=20.0, foot_depth=0.6)


def build():
    P_ = P
    body = mk_prism_plan("part", fillet_rect(P_["L"], P_["D"], P_["fillet"]), 0.0, P_["H"])

    # 内腔：x/y 直接按壁厚内缩（**不要**再多缩，那是把墙做薄）；
    # 只在 +Z 方向多伸 1mm —— 刀具必须穿透开口，否则顶面共面会让 EXACT 切不干净。
    over = 1.0
    ix = P_["L"] / 2 - P_["wall"]
    iy = P_["D"] / 2 - P_["wall"]
    cavity = mk_box("cavity", -ix, ix, -iy, iy, P_["floor"], P_["H"] + over)
    bool_op(body, cavity)

    # 脚窝：从底面往上啃，-Z 方向多伸 1mm 穿底
    for i, x in enumerate((-P_["L"] / 4, P_["L"] / 4)):
        for j, y in enumerate((-P_["D"] / 4, P_["D"] / 4)):
            c = mk_cyl("pocket_%d%d" % (i, j), P_["foot_d"] / 2, -over, P_["foot_depth"], cx=x, cy=y)
            bool_op(body, c)

    apply_bevel(body, P_["bevel"])
    cleanup(body)
    return body


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = "out"
    name = "part"
    i = 0
    while i < len(argv):
        if argv[i] == "--out":
            i += 1; out = argv[i]
        elif argv[i] == "--name":
            i += 1; name = argv[i]
        i += 1
    os.makedirs(out, exist_ok=True)

    reset_scene()
    body = build()
    body.name = name

    stl = os.path.join(out, name + ".stl")
    export_stl([body], stl)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, name + ".blend"))

    rep = dict(part=mesh_stats(body), stl=stl, params=P)
    with open(os.path.join(out, "report.json"), "w", encoding="utf-8") as fh:
        json.dump(rep, fh, ensure_ascii=False, indent=2)
    print("PARTS_REPORT " + json.dumps(rep["part"], ensure_ascii=False))
    print("OK " + stl)


if __name__ == "__main__":
    main()
