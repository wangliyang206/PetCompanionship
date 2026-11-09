# -*- coding: utf-8 -*-
"""
宠物骨骼绑定 v2 —— 刚性部件绑定（零变形管线）
用法：
  blender -b -P rig_pet2.py -- --input <glb> --plan chibi|quadruped --out <glb> [--renders dir] [--height 0.35]

为什么不用软蒙皮权重：
  AI 生成的网格是「零件拼装」结构（实测 115 个连通岛、最大岛仅 7% 顶点、2792 条边界边）。
  软蒙皮会把同一个碎片内的顶点分给不同骨骼，动画时边长被拉伸 5~8 倍 → 玩家看到"变形/撕裂"。
  本管线改为「每个连通岛整体 100% 绑到唯一骨骼」，岛内顶点做纯刚体运动，
  几何形状数学上不可能改变；部件之间是刚体相对运动（卡通玩具关节感），配合小摆幅即可自然。

顺序很关键：先减面，再分岛、再绑骨。反了会让 Decimate 把权重插值改坏。
"""
import bpy
import sys
import os
import argparse
import math
from collections import defaultdict
from mathutils import Vector

TARGET_MESH = None  # 导出白名单，避免把场景里的杂项 mesh 带进 GLB


# ---------------------------------------------------------------- 基础

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--plan", default="chibi", choices=["quadruped", "chibi"])
    p.add_argument("--out", required=True)
    p.add_argument("--facing", default="-Y", choices=["-Y", "+Y"])
    p.add_argument("--height", type=float, default=0.35)
    p.add_argument("--renders", default="")
    p.add_argument("--max-tris", type=int, default=8000)
    p.add_argument("--tex-size", type=int, default=1024)
    p.add_argument("--no-legs", action="store_true", help="强制不生成腿部骨骼")
    p.add_argument("--mode", default="smooth", choices=["smooth", "rigid"],
                   help="smooth=减面焊成连通体后自动权重（关节平滑）；rigid=岛级刚性（零变形）")
    return p.parse_args(argv)


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures,
                  bpy.data.actions, bpy.data.images, bpy.data.objects):
        for item in list(block):
            if getattr(item, "users", 0) == 0:
                try:
                    block.remove(item)
                except Exception:
                    pass


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def join_meshes(objs):
    meshes = [o for o in objs if o.type == 'MESH']
    others = [o for o in objs if o.type != 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    mesh = bpy.context.view_layer.objects.active
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in others:
        bpy.data.objects.remove(o, do_unlink=True)
    return mesh


def clean_mesh(mesh):
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    try:
        bpy.ops.mesh.remove_doubles(threshold=0.0006)
    except AttributeError:
        bpy.ops.mesh.merge(type='BY_DISTANCE', threshold=0.0006)
    bpy.ops.mesh.delete_loose()
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    print(f"[clean] tris={len(mesh.data.polygons)} verts={len(mesh.data.vertices)}")


def bbox(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def normalize(mesh, target_height, facing):
    lo, hi = bbox(mesh)
    size = hi - lo
    s = target_height / max(size.z, 1e-6)
    mesh.scale = (s, s, s)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    lo, hi = bbox(mesh)
    c = (lo + hi) / 2
    mesh.location.x -= c.x
    mesh.location.y -= c.y
    mesh.location.z -= lo.z
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    if facing == "+Y":
        mesh.rotation_euler[2] = math.pi
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    lo, hi = bbox(mesh)
    print(f"[normalize] W={hi.x-lo.x:.3f} L={hi.y-lo.y:.3f} H={hi.z-lo.z:.3f}")


def compress(mesh, max_tris, tex_size):
    tris = len(mesh.data.polygons)
    if tris > max_tris:
        mod = mesh.modifiers.new("dec", 'DECIMATE')
        mod.ratio = max_tris / tris
        bpy.context.view_layer.objects.active = mesh
        mesh.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        print(f"[compress] 减面 {tris} → {len(mesh.data.polygons)} tris")
    for img in bpy.data.images:
        if img.size[0] > tex_size:
            w, h = img.size
            img.scale(tex_size, max(1, round(tex_size * h / w)))
            print(f"[compress] 贴图 {img.name} → {img.size[0]}x{img.size[1]}")


# ---------------------------------------------------------------- 连通岛

def find_islands(mesh):
    n = len(mesh.data.vertices)
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for e in mesh.data.edges:
        ra, rb = find(e.vertices[0]), find(e.vertices[1])
        if ra != rb:
            parent[rb] = ra
    groups = defaultdict(list)
    for i in range(n):
        groups[find(i)].append(i)

    mw = mesh.matrix_world
    out = []
    for idx in groups.values():
        pts = [mw @ mesh.data.vertices[i].co for i in idx]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        out.append({"idx": idx, "n": len(idx), "c": sum(pts, Vector()) / len(pts),
                    "lo": lo, "hi": hi, "size": hi - lo})
    out.sort(key=lambda d: -d["n"])
    print(f"[islands] 共 {len(out)} 个，最大占比 {out[0]['n']/n*100:.1f}%")
    return out


def analyze_geom(mesh, W, L, H, nvert):
    """按顶点分布拟合解剖结构（垂耳兔/团子等任意体型）。
    耳朵 = 每侧最外侧的细长带（z 跨度大、位置高、比身体同层明显更靠外）；
    脚   = 底部前方、左右分开的小簇。
    头型两种：
      直立型（垂耳兔坐姿）：头在躯干上方，颈部=宽度剖面局部极小；
      前置型（仓鼠/龙猫蹲伏团子）：头是一个前上方的大球，占 15%+ 顶点，
        没有细脖子——竖直"头在顶上"的骨架会让头骨悬空，脸部顶点全归躯干。"""
    pts = [v.co.copy() for v in mesh.data.vertices]

    # --- 前置头型检测：前上方 40%×0.30H 区域的顶点团
    y_min = min(p.y for p in pts)
    head_pts = [p for p in pts if p.y < y_min + 0.42 * L and p.z > 0.30 * H]
    horizontal_head = False
    head_c = body_c = None
    if len(head_pts) >= nvert * 0.15:
        hc = sum(head_pts, Vector()) / len(head_pts)
        rest_pts = [p for p in pts if p not in head_pts] or pts
        bc = sum(rest_pts, Vector()) / len(rest_pts)
        if (bc.y - hc.y) > 0.12 * L:
            horizontal_head = True
            head_c, body_c = hc, bc

    # --- 颈部：0.5~0.95H 分层宽度剖面找局部极小（仅直立型使用）
    z_head = 0.72 * H
    bands = []
    for k in range(16):
        z0, z1 = H * (0.50 + 0.45 * k / 16), H * (0.50 + 0.45 * (k + 1) / 16)
        sel = [p for p in pts if z0 <= p.z < z1]
        if sel:
            bands.append((z0, max(p.x for p in sel) - min(p.x for p in sel)))
    if len(bands) >= 5:
        ws = [b[1] for b in bands]
        for i in range(1, len(bands) - 1):
            if ws[i] <= ws[i - 1] and ws[i] <= ws[i + 1] and ws[i] < max(ws) * 0.9:
                z_head = bands[i][0]
                break

    ears, feet = {}, {}
    for side, sx in (("L", -1), ("R", 1)):
        if horizontal_head:
            # 前置型：耳 = 头球中心以上的最外侧带（避开腮部绒毛）
            side_pts = [p for p in pts
                        if head_c.z - 0.02 * H < p.z < 0.98 * H and p.x * sx > 0.03 * W]
            min_span, z_floor = 0.10 * H, head_c.z - 0.02 * H
        else:
            # 直立型：耳 = 该侧上半身最外侧 12% 的顶点
            side_pts = [p for p in pts if 0.28 * H < p.z < 0.96 * H and p.x * sx > 0.03 * W]
            min_span, z_floor = 0.24 * H, 0.05 * H
        side_pts.sort(key=lambda p: -p.x * sx)
        cand = side_pts[:max(40, int(len(side_pts) * 0.12))]
        ok = False
        if len(cand) >= nvert * 0.008:
            zs = sorted(p.z for p in cand)
            z_lo, z_hi = zs[int(len(zs) * 0.08)], zs[int(len(zs) * 0.92)]
            cx = sum(p.x for p in cand) / len(cand)
            body_ref = [p for p in pts if z_lo <= p.z <= z_hi]
            body_mean = sum(abs(p.x) for p in body_ref) / max(len(body_ref), 1)
            if (z_hi - z_lo) > min_span and abs(cx) > body_mean * 1.3:
                ears[side] = {"x": cx,
                              "y": sum(p.y for p in cand) / len(cand),
                              "z_hi": z_hi, "z_lo": z_lo}
                ok = True
        if not ok:
            ears[side] = None

        # --- 脚：底部 z<0.2H、偏前方的左右小簇
        cand_f = [p for p in pts if p.z < 0.20 * H and p.x * sx > 0.06 * W and p.y < 0.5 * L]
        if len(cand_f) >= nvert * 0.004:
            feet[side] = {"x": sum(p.x for p in cand_f) / len(cand_f),
                          "y": sum(p.y for p in cand_f) / len(cand_f),
                          "z_hi": min(0.30 * H, max(p.z for p in cand_f)),
                          "z_lo": min(p.z for p in cand_f)}
        else:
            feet[side] = None

    info = {"z_head": z_head, "ears": ears, "feet": feet, "W": W, "L": L, "H": H,
            "horizontal_head": horizontal_head,
            "head_c": head_c, "body_c": body_c}
    fmt = lambda d: (f"x={d['x']:+.3f} z=[{d['z_lo']:.3f},{d['z_hi']:.3f}]"
                     if d else "-")
    print(f"[analyze] 头型={'前置(团子)' if horizontal_head else '直立'} "
          f"z_head={z_head:.3f} ({z_head/H:.2f}H)")
    if head_c:
        print(f"[analyze] 头球质心=({head_c.x:+.3f},{head_c.y:+.3f},{head_c.z:+.3f}) "
              f"身体质心=({body_c.x:+.3f},{body_c.y:+.3f},{body_c.z:+.3f})")
    print(f"[analyze] 耳L[{fmt(ears['L'])}] 耳R[{fmt(ears['R'])}]")
    print(f"[analyze] 脚L[{fmt(feet['L'])}] 脚R[{fmt(feet['R'])}]")
    return info


# ---------------------------------------------------------------- 骨架

def _eb(arm, name, head, tail, parent=None, connect=False):
    b = arm.edit_bones.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    b.use_connect = connect
    if parent:
        b.parent = arm.edit_bones[parent]
    return b


def build_armature(info, use_legs, plan):
    """自适应骨架：骨骼位置按几何拟合，只建模型几何能支撑的骨骼。
    幼崽团子体型若检测不到脚 → 不建腿骨，走路用整体弹跳（chibi 标准做法）。
    前置头型（仓鼠蹲伏团子）：hips/chest 贯穿身体球，head 骨竖直插进头球
    内部——骨骼走进体块，热扩散才会把顶点分给正确的骨骼。"""
    W, L, H, zh = info["W"], info["L"], info["H"], info["z_head"]
    arm_data = bpy.data.armatures.new("PetRig")
    arm_obj = bpy.data.objects.new("PetRig", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.select_set(True)
    arm_data.display_type = 'OCTAHEDRAL'
    bpy.ops.object.mode_set(mode='EDIT')

    if info.get("horizontal_head"):
        hc, bc = info["head_c"], info["body_c"]
        _eb(arm_data, "root", (0, 0, 0), (0, 0, 0.06 * H))
        # hips：身体球内竖直短骨（下→上）
        _eb(arm_data, "hips",
            (0, bc.y + 0.10 * L, max(0.02 * H, bc.z - 0.14 * H)),
            (0, bc.y - 0.02 * L, bc.z + 0.06 * H), "root")
        # chest：身体球上部 → 颈点（头球后下沿）
        _eb(arm_data, "chest",
            (0, bc.y - 0.02 * L, bc.z + 0.06 * H),
            (0, max(hc.y + 0.02 * L, bc.y - 0.10 * L), max(hc.z - 0.14 * H, 0.20 * H)),
            "hips", True)
        # head：头球内部竖直骨（不吸附，保证落在球心附近）
        _eb(arm_data, "head",
            (hc.x, hc.y + 0.10 * L, max(0.02 * H, hc.z - 0.14 * H)),
            (hc.x, hc.y - 0.04 * L, min(0.98 * H, hc.z + 0.16 * H)),
            "chest")
    else:
        _eb(arm_data, "root", (0, 0, 0), (0, 0, 0.06 * H))
        _eb(arm_data, "hips", (0, 0.10 * L, 0.06 * H), (0, 0.02 * L, 0.42 * H), "root")
        _eb(arm_data, "chest", (0, 0.02 * L, 0.42 * H), (0, -0.02 * L, zh + 0.04 * H), "hips", True)
        _eb(arm_data, "head", (0, -0.02 * L, zh + 0.02 * H), (0, -0.04 * L, min(0.98 * H, zh + 0.34 * H)), "chest", True)

    # 耳骨：根在耳根（高处），尖在耳梢（低处）——垂耳沿垂下方向
    for side in ("L", "R"):
        d = info["ears"][side]
        if not d:
            continue
        x, y = d["x"], d["y"]
        _eb(arm_data, f"ear_{side}", (x, y, d["z_hi"] - 0.03 * H),
            (x, y, max(d["z_lo"], 0.05 * H)), "head")

    if use_legs:
        for side in ("L", "R"):
            d = info["feet"][side]
            if not d:
                continue
            x, y = d["x"], d["y"]
            _eb(arm_data, f"thigh_{side}", (x, y, d["z_hi"]),
                (x, y, max(d["z_lo"], 0.01 * H)), "hips")

    bpy.ops.object.mode_set(mode='OBJECT')
    names = [b.name for b in arm_data.bones]
    print(f"[armature] {len(names)} 骨: {names}")
    return arm_obj


# ---------------------------------------------------------------- 刚性绑定

def classify(d, info, bones):
    """按岛质心归属唯一骨骼。优先级：耳 > 腿 > 头 > 躯干（胸/髋）。
    整岛一致 → 岛内做刚体运动 → 零形变。"""
    W, H, zh = info["W"], info["H"], info["z_head"]
    c, sz = d["c"], d["size"]

    # 耳：外侧 + 细长 + 上半身
    if "ear_L" in bones or "ear_R" in bones:
        if c.z > 0.45 * H and abs(c.x) > 0.24 * W and sz.z > 1.25 * max(sz.x, 1e-6):
            return "ear_L" if c.x < 0 else "ear_R"

    # 腿：低处 + 外侧（限于骨骼实际存在时）
    low_legs = [b for b in bones if b.startswith("thigh_")]
    if low_legs and c.z < 0.34 * H and abs(c.x) > 0.10 * W and sz.z >= 0.35 * sz.y:
        return "thigh_L" if c.x < 0 else "thigh_R"

    # 头：颈部以上（留 2% 重叠带，减少边界露缝）
    if c.z > zh - 0.02 * H:
        return "head"

    # 躯干
    if c.z > 0.40 * H:
        return "chest"
    return "hips"


def rigid_bind(mesh, arm_obj, isl, info):
    bones = {b.name for b in arm_obj.data.bones if b.use_deform}
    vgs = {n: mesh.vertex_groups.new(name=n) for n in bones}
    stat = defaultdict(int)
    for d in isl:
        target = classify(d, info, bones)
        vgs[target].add(d["idx"], 1.0, 'REPLACE')
        stat[target] += 1
    mesh.parent = arm_obj
    mod = mesh.modifiers.new("Armature", 'ARMATURE')
    mod.object = arm_obj
    print(f"[bind] 刚性绑定：岛归属 " +
          " ".join(f"{k}={v}" for k, v in sorted(stat.items())))
    return stat


def smooth_bind(mesh, arm_obj):
    """自动权重（骨热扩散）。要求网格是连通封闭体——所以必须先减面焊接。"""
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    try:
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        print("[bind] 自动权重（骨热扩散）成功")
        return True
    except RuntimeError as e:
        print(f"[bind] 自动权重失败：{e} → 降级岛级刚性")
        return False


def sanitize_weights(mesh, arm_obj, H):
    """[已停用·两次实测均有害，勿再启用]
    1) 按骨骼距离设影响半径：团子体型上"离腿骨近"的是肚皮而非腿，
       纯距离判据把肚皮分给腿骨（p99 32%→89%）。
    2) 耳朵分区钳制（z 低于头球中心的顶点清耳权重）：热扩散的耳权重
       在脸上是大面积平滑渐变（37% 顶点），硬钳会在钳制线上形成接缝，
       耳朵一甩接缝撕裂（p99 20.7%→27.4%）。
    正确解法 = 让骨骼走进各自的体块（build_armature 前置头型分支），
    热扩散本身的平滑渐变视觉上是柔和过渡，指标偏高但无害。"""
    return 0


# ---------------------------------------------------------------- 动画

def reset_pose(arm_obj):
    for pb in arm_obj.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)


def make_actions(arm_obj, plan, has_legs):
    fps = 30
    pb = arm_obj.pose.bones
    actions = []

    def new_action(name, end):
        act = bpy.data.actions.new(name)
        act.use_frame_range = False
        arm_obj.animation_data_create()
        arm_obj.animation_data.action = act
        bpy.context.scene.frame_start = 0
        bpy.context.scene.frame_end = end
        # 全骨骼静止姿势打底，避免导出器把上一动作的残留姿势烘焙进来
        reset_pose(arm_obj)
        for p in arm_obj.pose.bones:
            p.rotation_mode = 'XYZ'
            for prop, val in (("location", (0, 0, 0)),
                              ("rotation_euler", (0, 0, 0)),
                              ("scale", (1, 1, 1))):
                setattr(p, prop, val)
                p.keyframe_insert(data_path=prop, frame=0)
                p.keyframe_insert(data_path=prop, frame=end)
        return act

    def key(bone, prop, frame, val, idx=-1):
        p = pb[bone]
        p.rotation_mode = 'XYZ'
        if idx < 0:
            setattr(p, prop, val)
        else:
            arr = list(getattr(p, prop))
            arr[idx] = val
            setattr(p, prop, arr)
        p.keyframe_insert(data_path=prop, frame=frame)

    # ---------- idle：呼吸（整体微缩放）+ 摆头 + 耳朵抖动
    a = new_action("idle", 96)
    for f, s in ((0, 1.0), (48, 1.022), (96, 1.0)):
        key("hips", "scale", f, (s, s, s))          # 均匀缩放=呼吸，形状不变
    for f, z in ((0, 0), (48, 0.004), (96, 0)):
        key("root", "location", f, z, 2)
    if "head" in pb:
        for f, yaw in ((0, -7), (32, 7), (64, -5), (96, -7)):
            key("head", "rotation_euler", f, math.radians(yaw), 2)
        for f, pit in ((0, 0), (48, 3), (96, 0)):
            key("head", "rotation_euler", f, math.radians(pit), 0)
    for side in ("L", "R"):
        n = f"ear_{side}"
        if n not in pb:
            continue
        for f, ang in ((0, 0), (24, 6), (48, -3), (72, 5), (96, 0)):
            key(n, "rotation_euler", f, math.radians(ang), 1)
    actions.append(a)

    # ---------- walk：整体弹跳 + 身体小幅前后/左右晃（chibi 标准步态）
    a = new_action("walk", 36)
    key("root", "location", 0, 0, 2)
    key("root", "location", 9, 0.012, 2)
    key("root", "location", 18, 0, 2)
    key("root", "location", 27, 0.012, 2)
    key("root", "location", 36, 0, 2)
    for f, pitch in ((0, -2), (9, 2), (18, -2), (27, 2), (36, -2)):
        key("hips", "rotation_euler", f, math.radians(pitch), 0)
    for f, roll in ((0, 2), (18, -2), (36, 2)):
        key("hips", "rotation_euler", f, math.radians(roll), 1)
    if "head" in pb:
        for f, bob in ((0, 1.5), (9, -1.5), (18, 1.5), (27, -1.5), (36, 1.5)):
            key("head", "rotation_euler", f, math.radians(bob), 0)
    if has_legs:
        for i, side in enumerate(("L", "R")):
            for f in range(0, 37, 3):
                ph = (f / fps) * (math.pi * 2 / 1.2) + (0 if i == 0 else math.pi)
                key(f"thigh_{side}", "rotation_euler", f, math.sin(ph) * 0.16, 0)
    actions.append(a)

    # ---------- happy：腾空 + 挤压拉伸 + 耳朵后甩
    a = new_action("happy", 36)
    for f, z in ((0, 0), (8, 0.02), (14, 0.075), (22, 0.02), (30, 0), (36, 0)):
        key("root", "location", f, z, 2)
    for f, sc in ((0, 0.94), (8, 1.06), (14, 1.0), (22, 1.04), (30, 1.0), (36, 1.0)):
        key("hips", "scale", f, (sc, sc, sc))       # 均匀缩放，不产生形状畸变
    for side in ("L", "R"):
        n = f"ear_{side}"
        if n not in pb:
            continue
        for f, ang in ((0, 0), (8, 12), (14, -22), (22, -8), (36, 0)):
            key(n, "rotation_euler", f, math.radians(ang), 0)
    if "head" in pb:
        for f, pit in ((0, 0), (8, 8), (14, -10), (22, 4), (36, 0)):
            key("head", "rotation_euler", f, math.radians(pit), 0)
    actions.append(a)

    # stash 到 NLA 供导出器按 action 导出
    for act in actions:
        track = arm_obj.animation_data.nla_tracks.new()
        track.strips.new(act.name, int(act.frame_range[0]), act)
        track.mute = True
    arm_obj.animation_data.action = None
    reset_pose(arm_obj)
    return actions


# ---------------------------------------------------------------- 导出 / 渲染 / 自检

def export_glb(out_path, mesh):
    bpy.ops.object.select_all(action='DESELECT')
    arm_obj = bpy.data.objects["PetRig"]
    arm_obj.select_set(True)
    mesh.select_set(True)  # 只导出目标 mesh，避免场景杂项混入
    bpy.context.view_layer.objects.active = arm_obj
    reset_pose(arm_obj)
    bpy.ops.export_scene.gltf(
        filepath=out_path, export_format='GLB', export_yup=True,
        export_animation_mode='ACTIONS', export_anim_single_armature=True,
        export_def_bones=True, export_apply=True, use_selection=True,
        export_skins=True, export_morph_animation=False)
    print(f"[export] {out_path}")


def setup_render(scene):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 20
    scene.render.resolution_x = 560
    scene.render.resolution_y = 560
    scene.render.film_transparent = False
    w = bpy.data.worlds.new("W")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.92, 0.92, 0.94, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = w
    keyl = bpy.data.lights.new("key", 'AREA')
    keyl.energy = 300
    ko = bpy.data.objects.new("key", keyl)
    ko.location = (1.5, -1.5, 2.0)
    ko.rotation_euler = (math.radians(40), 0, math.radians(45))
    bpy.context.collection.objects.link(ko)
    fill = bpy.data.lights.new("fill", 'AREA')
    fill.energy = 120
    fo = bpy.data.objects.new("fill", fill)
    fo.location = (-2.0, -1.0, 1.2)
    fo.rotation_euler = (math.radians(70), 0, math.radians(-60))
    bpy.context.collection.objects.link(fo)


def make_cam(name, loc, rot):
    cam = bpy.data.cameras.new(name)
    cam.lens = 60
    o = bpy.data.objects.new(name, cam)
    o.location = loc
    o.rotation_euler = rot
    bpy.context.collection.objects.link(o)
    return o


def verify_deform(mesh, arm_obj, actions, H):
    """自检：用「三角形相似度」衡量形状畸变。
    刚体运动 / 均匀缩放下三角形完全相似 → 偏差 0；剪切、拉伸、蒙皮混合 → 偏差上升。
    返回最大畸变率（0.02 = 2%），>2% 视为玩家可见变形。"""
    dg = bpy.context.evaluated_depsgraph_get()
    tris = [tuple(p.vertices) for p in mesh.data.polygons if len(p.vertices) == 3]
    arm_obj.animation_data.action = None
    reset_pose(arm_obj)
    bpy.context.view_layer.update()
    dg.update()
    ev = mesh.evaluated_get(dg)
    rest = [ev.matrix_world @ v.co for v in ev.data.vertices]

    def tri_lens(pts):
        out = []
        for a, b, c in tris:
            out.append(((pts[a] - pts[b]).length,
                        (pts[b] - pts[c]).length,
                        (pts[c] - pts[a]).length))
        return out

    L0 = tri_lens(rest)
    worst = (0.0, "", 0.0)
    for act in actions:
        arm_obj.animation_data.action = act
        fmax = int(act.frame_range[1])
        for f in range(0, fmax + 1, max(1, fmax // 10)):
            bpy.context.scene.frame_set(f)
            bpy.context.view_layer.update()
            dg.update()
            ev = mesh.evaluated_get(dg)
            cur = [ev.matrix_world @ v.co for v in ev.data.vertices]
            L = tri_lens(cur)
            devs = []
            for (a0, b0, c0), (a1, b1, c1) in zip(L0, L):
                if min(a0, b0, c0) < 1e-6:
                    continue
                r = (a1 / a0, b1 / b0, c1 / c0)
                m = sum(r) / 3.0
                if m < 1e-9:
                    continue
                devs.append(max(abs(v / m - 1.0) for v in r))
            if not devs:
                continue
            devs.sort()
            p99 = devs[int(len(devs) * 0.99)]
            if p99 > worst[0]:
                worst = (p99, f"{act.name}@{f}", devs[-1])
    arm_obj.animation_data.action = None
    reset_pose(arm_obj)
    verdict = "✅ 无可感知变形" if worst[0] < 0.02 else ("⚠️ 轻度变形" if worst[0] < 0.06 else "❌ 明显变形")
    print(f"[verify] 形状畸变 p99={worst[0]*100:.3f}% max={worst[2]*100:.2f}% "
          f"（{worst[1]}）　{verdict}")
    return worst[0]


def render_previews(renders_dir, arm_obj):
    os.makedirs(renders_dir, exist_ok=True)
    setup_render(bpy.context.scene)
    cam_front = make_cam("cam_f", (0, -1.05, 0.28), (math.radians(85), 0, 0))
    cam_34 = make_cam("cam_34", (0.75, -0.75, 0.42), (math.radians(72), 0, math.radians(45)))
    shots = [
        ("pure_rest", cam_34, 0, None),
        ("rest_front", cam_front, 0, None),
        ("idle_mid", cam_34, 48, "idle"),
        ("idle_headturn", cam_34, 32, "idle"),
        ("walk_up", cam_34, 9, "walk"),
        ("walk_down", cam_34, 18, "walk"),
        ("happy_air", cam_34, 14, "happy"),
        ("happy_land", cam_34, 30, "happy"),
    ]
    ad = arm_obj.animation_data
    for name, cam, frame, act_name in shots:
        reset_pose(arm_obj)
        ad.action = bpy.data.actions.get(act_name) if act_name else None
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        bpy.context.scene.camera = cam
        bpy.context.scene.render.filepath = os.path.join(renders_dir, f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"[render] {name}")
    ad.action = None
    reset_pose(arm_obj)


# ---------------------------------------------------------------- main

def main():
    global TARGET_MESH
    args = parse_args()
    clear_scene()
    objs = import_glb(args.input)
    mesh = join_meshes(objs)
    TARGET_MESH = mesh.name
    clean_mesh(mesh)
    normalize(mesh, args.height, args.facing)

    # 岛分析必须在减面之前做：Decimate 会把碎片焊成连通体，岛信息就没了
    lo, hi = bbox(mesh)
    W, L, H = hi.x - lo.x, hi.y - lo.y, hi.z - lo.z
    isl = find_islands(mesh)
    info = analyze_geom(mesh, W, L, H, len(mesh.data.vertices))
    use_legs = (not args.no_legs) and info["feet"]["L"] and info["feet"]["R"]

    if args.mode == "smooth":
        # 先减面焊接成连通封闭体 → 自动权重才有意义（骨热扩散要求流形）
        compress(mesh, args.max_tris, args.tex_size)
        arm_obj = build_armature(info, use_legs, args.plan)
        if smooth_bind(mesh, arm_obj):
            pass  # 权重后处理实测有害（见 sanitize_weights 注释），保留纯热扩散
        else:
            rigid_bind(mesh, arm_obj, isl, info)
    else:
        arm_obj = build_armature(info, use_legs, args.plan)
        rigid_bind(mesh, arm_obj, isl, info)
        compress(mesh, args.max_tris, args.tex_size)

    actions = make_actions(arm_obj, args.plan, use_legs)
    verify_deform(mesh, arm_obj, actions, H)
    export_glb(args.out, mesh)
    if args.renders:
        render_previews(args.renders, arm_obj)
    print(f"[done] mode={args.mode} legs={bool(use_legs)} "
          f"islands={len(isl)} 场景={[o.name for o in bpy.data.objects]}")


main()
