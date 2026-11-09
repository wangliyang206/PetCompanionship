# -*- coding: utf-8 -*-
"""
宠物骨骼绑定批量脚本（免费管线，配合 Blender 4.x 使用）
用法：
  blender -b -P rig_pet.py -- --input <glb> --plan quadruped|chibi --out <glb> [--facing -Y|+Y] [--height 0.3]

流程：导入 GLB → 合并清理 → 归一化（贴地/居中/缩放）→ 按体型方案建模板骨架
     → 自动权重（失败降级为距离权重）→ 生成演示动画 → 导出 GLB + 渲染预览图
骨架命名遵循 docs/07-宠物模型与动画规格.md §2 模板。
"""
import bpy
import sys
import argparse
import math
from mathutils import Vector


# ---------------------------------------------------------------- utilities

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--plan", default="quadruped", choices=["quadruped", "chibi"])
    p.add_argument("--out", required=True)
    p.add_argument("--facing", default="-Y", choices=["-Y", "+Y"])
    p.add_argument("--height", type=float, default=0.30, help="归一化后的身高（米）")
    p.add_argument("--renders", default="", help="预览图输出目录")
    p.add_argument("--max-tris", type=int, default=8000, help="减面目标三角面数")
    p.add_argument("--tex-size", type=int, default=1024, help="贴图缩放目标边长")
    return p.parse_args(argv)


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures,
                  bpy.data.actions, bpy.data.images):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


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
    # 清空父级，拿到干净的变换
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
        bpy.ops.mesh.remove_doubles(threshold=0.0008)
    except AttributeError:
        bpy.ops.mesh.merge(type='BY_DISTANCE', threshold=0.0008)
    bpy.ops.mesh.delete_loose()
    # 法线朝外，重复面处理
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
    mesh.location.z -= lo.z  # 脚底贴地
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    if facing == "+Y":
        mesh.rotation_euler[2] = math.pi  # 统一转为面朝 -Y
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    lo, hi = bbox(mesh)
    print(f"[normalize] size=({hi.x-lo.x:.3f}, {hi.y-lo.y:.3f}, {hi.z-lo.z:.3f})")


# ---------------------------------------------------------------- skeleton

def _eb(arm, name, head, tail, parent=None, connect=False):
    b = arm.edit_bones.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    b.use_connect = connect  # 仅位置恰好衔接的链才允许吸附连接，否则会被吸到父骨尾端
    if parent:
        b.parent = arm.edit_bones[parent]
    return b


def build_quadruped(arm, W, L, H):
    """面朝 -Y。W=宽 L=长 H=高"""
    hipZ = 0.62 * H
    _eb(arm, "root", (0, 0.05 * L, 0), (0, 0.05 * L, 0.03 * H))
    _eb(arm, "hips", (0, 0.22 * L, hipZ), (0, 0.05 * L, hipZ), "root")
    _eb(arm, "spine", (0, 0.05 * L, hipZ), (0, -0.12 * L, hipZ), "hips", connect=True)
    _eb(arm, "chest", (0, -0.12 * L, hipZ), (0, -0.28 * L, hipZ), "spine", connect=True)
    neckZ = hipZ + 0.10 * H
    _eb(arm, "neck", (0, -0.28 * L, neckZ), (0, -0.36 * L, neckZ + 0.06 * H), "chest", connect=True)
    headTopZ = min(neckZ + 0.30 * H, H)
    _eb(arm, "head", (0, -0.36 * L, neckZ + 0.06 * H), (0, -0.44 * L, headTopZ), "neck", connect=True)
    _eb(arm, "ear_L", (-0.08 * W, -0.38 * L, headTopZ * 0.96),
        (-0.10 * W, -0.36 * L, headTopZ * 1.12), "head")
    _eb(arm, "ear_R", (0.08 * W, -0.38 * L, headTopZ * 0.96),
        (0.10 * W, -0.36 * L, headTopZ * 1.12), "head")
    _eb(arm, "jaw", (0, -0.42 * L, neckZ + 0.02 * H),
        (0, -0.46 * L, neckZ - 0.02 * H), "head")
    for i in range(1, 4):
        prev = "hips" if i == 1 else f"tail_{i-1:02d}"
        y = 0.22 * L + (i - 1) * 0.10 * L
        z = hipZ + (0.06 if i == 1 else 0.02) * H + (i - 1) * 0.02 * H
        _eb(arm, f"tail_{i:02d}", (0, y, z), (0, y + 0.10 * L, z + 0.01 * H),
            None if i == 1 else prev)
    # 四肢：前后各一对
    for side, sx in (("L", -1), ("R", 1)):
        x = sx * 0.30 * W
        _eb(arm, f"shoulder_{side}", (sx * 0.12 * W, -0.26 * L, hipZ + 0.04 * H),
            (x, -0.28 * L, hipZ), "chest")
        _eb(arm, f"upperArm_{side}", (x, -0.28 * L, hipZ),
            (x, -0.28 * L, 0.42 * H), f"shoulder_{side}", connect=True)
        _eb(arm, f"forearm_{side}", (x, -0.28 * L, 0.42 * H),
            (x, -0.30 * L, 0.16 * H), f"upperArm_{side}", connect=True)
        _eb(arm, f"hand_{side}", (x, -0.30 * L, 0.16 * H),
            (x, -0.32 * L, 0.01), f"forearm_{side}", connect=True)
        _eb(arm, f"thigh_{side}", (x, 0.20 * L, hipZ),
            (x, 0.22 * L, 0.40 * H), "hips")
        _eb(arm, f"shin_{side}", (x, 0.22 * L, 0.40 * H),
            (x, 0.24 * L, 0.14 * H), f"thigh_{side}", connect=True)
        _eb(arm, f"foot_{side}", (x, 0.24 * L, 0.14 * H),
            (x, 0.22 * L, 0.01), f"shin_{side}", connect=True)


def build_chibi(arm, W, L, H):
    """直立小矮子（长风型），面朝 -Y"""
    hipZ = 0.42 * H
    _eb(arm, "root", (0, 0, 0), (0, 0, 0.03 * H))
    _eb(arm, "hips", (0, 0, hipZ), (0, 0, hipZ + 0.06 * H), "root")
    _eb(arm, "spine", (0, 0, hipZ + 0.06 * H), (0, 0, 0.62 * H), "hips", connect=True)
    _eb(arm, "chest", (0, 0, 0.62 * H), (0, 0, 0.74 * H), "spine", connect=True)
    _eb(arm, "neck", (0, 0, 0.74 * H), (0, 0, 0.80 * H), "chest", connect=True)
    _eb(arm, "head", (0, 0, 0.80 * H), (0, 0, H), "neck", connect=True)
    # 大耳朵（2 节）
    for side, sx in (("L", -1), ("R", 1)):
        x = sx * 0.30 * W
        _eb(arm, f"ear_{side}_01", (x, 0.02 * L, 0.94 * H),
            (x, 0.06 * L, 1.06 * H), "head")
        _eb(arm, f"ear_{side}_02", (x, 0.06 * L, 1.06 * H),
            (x, 0.10 * L, 1.14 * H), f"ear_{side}_01", connect=True)
    # 短手
    for side, sx in (("L", -1), ("R", 1)):
        x = sx * 0.42 * W
        _eb(arm, f"shoulder_{side}", (sx * 0.22 * W, 0, 0.70 * H),
            (x, 0.02 * L, 0.62 * H), "chest")
        _eb(arm, f"upperArm_{side}", (x, 0.02 * L, 0.62 * H),
            (x, 0.04 * L, 0.50 * H), f"shoulder_{side}", connect=True)
        _eb(arm, f"hand_{side}", (x, 0.04 * L, 0.50 * H),
            (x, 0.04 * L, 0.42 * H), f"upperArm_{side}", connect=True)
    # 短腿
    for side, sx in (("L", -1), ("R", 1)):
        x = sx * 0.22 * W
        _eb(arm, f"thigh_{side}", (x, 0, hipZ), (x, 0.02 * L, 0.24 * H), "hips")
        _eb(arm, f"shin_{side}", (x, 0.02 * L, 0.24 * H), (x, 0.02 * L, 0.10 * H),
            f"thigh_{side}", connect=True)
        _eb(arm, f"foot_{side}", (x, 0.02 * L, 0.10 * H), (x, -0.04 * L, 0.01),
            f"shin_{side}", connect=True)
    # 圆尾巴（1 节，可留空）
    _eb(arm, "tail_01", (0, 0.10 * L, hipZ + 0.02 * H), (0, 0.18 * L, hipZ), "hips")


PLANS = {"quadruped": build_quadruped, "chibi": build_chibi}


def build_armature(plan, mesh):
    lo, hi = bbox(mesh)
    W, L, H = hi.x - lo.x, hi.y - lo.y, hi.z - lo.z
    arm_data = bpy.data.armatures.new("PetRig")
    arm_obj = bpy.data.objects.new("PetRig", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.select_set(True)
    arm_data.display_type = 'OCTAHEDRAL'
    bpy.ops.object.mode_set(mode='EDIT')
    PLANS[plan](arm_data, W, L, H)
    bpy.ops.object.mode_set(mode='OBJECT')
    print(f"[armature] bones={len(arm_data.bones)} (W={W:.3f} L={L:.3f} H={H:.3f})")
    return arm_obj


# ---------------------------------------------------------------- skinning

def _pt_seg(p, a, b):
    """点到线段距离"""
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (p - (a + ab * t)).length


def auto_weight(mesh, arm_obj):
    """限定影响半径的距离权重：每根骨只带动自己周围一圈顶点，
    避免自动权重把身体顶点分给腿骨、一动就扭肚子（试点教训）。
    返回 (mesh 是否已挂到骨架, 使用的方案名)。"""
    import numpy as np  # noqa: F401  (保持与 Blender 内置 numpy 一致性)

    H = max(bbox(mesh)[1].z, 1e-6)
    limb = ("thigh", "shin", "foot", "shoulder", "upperArm", "forearm", "hand")
    ear = ("ear",)
    segs = []  # (name, head, tail, radius)
    mw = arm_obj.matrix_world
    for b in arm_obj.data.bones:
        if not b.use_deform:
            continue
        n = b.name
        if n.startswith(limb):
            r = 0.10 * H
        elif n.startswith(ear):
            r = 0.07 * H
        elif n.startswith("tail"):
            r = 0.12 * H
        else:
            r = 0.16 * H
        segs.append((n, mw @ b.head_local, mw @ b.tail_local, r))
    vgs = {n: mesh.vertex_groups.new(name=n) for n, _, _, _ in segs}
    mwi = mesh.matrix_world.inverted()
    for v in mesh.data.vertices:
        co = mesh.matrix_world @ v.co
        scored = []
        for name, a, bpt, r in segs:
            d = _pt_seg(co, a, bpt)
            if d >= r:
                continue
            t = 1.0 - d / r
            scored.append((t * t * (3 - 2 * t), name))  # smoothstep 衰减
        if not scored:
            # 不在任何骨骼影响圈内 → 挂到最近骨骼（保持跟随不撕裂）
            name, a, bpt, _ = min(segs, key=lambda s: _pt_seg(co, s[1], s[2]))
            vgs[name].add([v.index], 1.0, 'REPLACE')
            continue
        scored.sort(reverse=True)
        top = scored[:4]
        total = sum(s for s, _ in top)
        for s, name in top:
            vgs[name].add([v.index], s / total, 'REPLACE')
    mesh.parent = arm_obj
    mod = mesh.modifiers.new("Armature", 'ARMATURE')
    mod.object = arm_obj
    print(f"[skin] 限定半径距离权重完成（bones={len(segs)}）")
    return True, "BOUNDED"




# ---------------------------------------------------------------- animation

def make_actions(arm_obj, plan):
    fps = 30

    def new_action(name, end):
        act = bpy.data.actions.new(name)
        act.use_frame_range = False
        arm_obj.animation_data_create()
        arm_obj.animation_data.action = act
        bpy.context.scene.frame_start = 0
        bpy.context.scene.frame_end = end
        # 全骨骼静止姿势打底：导出器会全量烘焙骨骼姿势（23骨×3属性），
        # 若某骨骼在某段动画里没有 keyframe，就会带入上一动作的残留值
        # （试点踩坑：walk 里混进 idle 扭头 → 玩家看到"走路变形"）。
        # 每段动画都自带完整姿势，之后的具体动画键会覆盖对应帧。
        reset_pose(arm_obj)
        for pb in arm_obj.pose.bones:
            pb.rotation_mode = 'XYZ'
            for prop, val in (("location", (0, 0, 0)),
                              ("rotation_euler", (0, 0, 0)),
                              ("scale", (1, 1, 1))):
                setattr(pb, prop, val)
                pb.keyframe_insert(data_path=prop, frame=0)
                pb.keyframe_insert(data_path=prop, frame=end)
        return act

    def key(pose_bone, prop, frame, value, idx=-1):
        pose_bone.rotation_mode = 'XYZ'
        if idx < 0:
            setattr(pose_bone, prop, value)
        else:
            arr = list(getattr(pose_bone, prop))
            arr[idx] = value
            setattr(pose_bone, prop, arr)
        pose_bone.keyframe_insert(data_path=prop, frame=frame)

    pb = arm_obj.pose.bones
    actions = []

    # --- idle：呼吸 + 轻微摆头/甩尾 ---
    a = new_action("idle", 4 * fps)
    for f0 in (0, 2 * fps, 4 * fps):
        key(pb["hips"], "location", f0, 0.012 if f0 == 2 * fps else 0, 2)
    key(pb["head"], "rotation_euler", 0, math.radians(-16), 2)
    key(pb["head"], "rotation_euler", 2 * fps, math.radians(16), 2)
    key(pb["head"], "rotation_euler", 4 * fps, math.radians(-16), 2)
    if "tail_01" in pb:
        for f0 in (0, fps, 2 * fps, 3 * fps, 4 * fps):
            key(pb["tail_01"], "rotation_euler", f0,
                math.radians(28 if (f0 // fps) % 2 == 0 else -28), 2)
    if "ear_L" in pb or "ear_L_01" in pb:
        e = "ear_L_01" if "ear_L_01" in pb else "ear_L"
        key(pb[e], "rotation_euler", 0, 0, 2)
        key(pb[e], "rotation_euler", 2 * fps, math.radians(8), 2)
        key(pb[e], "rotation_euler", 4 * fps, 0, 2)
    actions.append(a)

    # --- walk：四腿交替 / 直立小碎步 ---
    a = new_action("walk", int(1.2 * fps))
    legs = ["thigh_L", "thigh_R"]
    amp = 0.30 if plan == "quadruped" else 0.15
    for i, ln in enumerate(legs):
        for f0 in range(0, int(1.2 * fps) + 1):
            ph = (f0 / fps) * (math.pi * 2 / 1.2) + (0 if i == 0 else math.pi)
            key(pb[ln], "rotation_euler", f0, math.sin(ph) * amp, 0)
    for f0 in range(0, int(1.2 * fps) + 1, 3):
        ph = (f0 / fps) * (math.pi * 4 / 1.2)
        key(pb["hips"], "location", f0, abs(math.sin(ph)) * 0.005, 2)
    actions.append(a)

    # --- happy：蹦跳 ---
    a = new_action("happy", fps)
    key(pb["root"], "location", 0, (0, 0, 0))
    key(pb["root"], "location", int(0.3 * fps), 0.13, 2)
    key(pb["root"], "location", fps, 0, 2)
    if "ear_L_01" in pb or "ear_L" in pb:
        for side in ("L", "R"):
            e = f"ear_{side}_01" if f"ear_{side}_01" in pb else f"ear_{side}"
            key(pb[e], "rotation_euler", 0, (0, 0, 0))
            key(pb[e], "rotation_euler", int(0.3 * fps), math.radians(-25), 0)
            key(pb[e], "rotation_euler", fps, 0, 0)
    actions.append(a)

    # 全部 stash 到 NLA，供 glTF 导出器按 ACTION 导出
    arm_obj.animation_data_create()
    for act in actions:
        track = arm_obj.animation_data.nla_tracks.new()
        strip = track.strips.new(act.name, int(act.frame_range[0]), act)
        track.mute = True
    arm_obj.animation_data.action = None
    return actions


# ---------------------------------------------------------------- export / render

def reset_pose(arm_obj):
    """把所有姿态骨骼复位到静止姿势。
    切换动作时未被新动作 keyframe 控制的通道会残留上一动作的值，
    导致渲染/导出被上一个动作污染（试点踩坑），必须先复位。"""
    for pb in arm_obj.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
    arm_obj.data.bones.active = None


def compress(mesh, max_tris, tex_size):
    """减面 + 缩贴图（07 §5 预算：幼崽≤8k面、贴图≤1024²）"""
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


def export_glb(out_path):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.data.objects["PetRig"].select_set(True)
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.select_set(True)
    bpy.context.view_layer.objects.active = bpy.data.objects["PetRig"]
    reset_pose(arm_obj := bpy.data.objects["PetRig"])
    bpy.ops.export_scene.gltf(
        filepath=out_path, export_format='GLB', export_yup=True,
        export_animation_mode='ACTIONS', export_anim_single_armature=True,
        export_def_bones=True, export_apply=True, use_selection=True,
        export_skins=True, export_morph_animation=False)
    print(f"[export] {out_path}")


def setup_render(scene):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.render.resolution_x = 560
    scene.render.resolution_y = 560
    scene.render.film_transparent = False
    w = bpy.data.worlds.new("W")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.92, 0.92, 0.94, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = w
    # 灯光
    key = bpy.data.lights.new("key", 'AREA')
    key.energy = 300
    ko = bpy.data.objects.new("key", key)
    ko.location = (1.5, -1.5, 2.0)
    ko.rotation_euler = (math.radians(40), 0, math.radians(45))
    bpy.context.collection.objects.link(ko)
    fill = bpy.data.lights.new("fill", 'AREA')
    fill.energy = 120
    fo = bpy.data.objects.new("fill", fill)
    fo.location = (-2.0, -1.0, 1.2)
    fo.rotation_euler = (math.radians(70), 0, math.radians(-60))
    bpy.context.collection.objects.link(fo)


def render_pose(cam_obj, out_png):
    scene = bpy.context.scene
    scene.camera = cam_obj
    scene.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print(f"[render] {out_png}")


def make_cam(name, loc, rot):
    cam = bpy.data.cameras.new(name)
    cam.lens = 60
    o = bpy.data.objects.new(name, cam)
    o.location = loc
    o.rotation_euler = rot
    bpy.context.collection.objects.link(o)
    return o


def render_previews(renders_dir, arm_obj):
    import os
    os.makedirs(renders_dir, exist_ok=True)
    setup_render(bpy.context.scene)
    cam_front = make_cam("cam_f", (0, -1.05, 0.28), (math.radians(85), 0, 0))
    cam_34 = make_cam("cam_34", (0.75, -0.75, 0.42),
                      (math.radians(72), 0, math.radians(45)))
    shots = [
        ("pure_rest", cam_34, 1),                    # 无动画纯静止（诊断用）
        ("rest_front", cam_front, 1),
        ("rest_34", cam_34, 1),
        ("pose_headturn", cam_34, 2 * 30 + 15),      # idle 中段：扭头
        ("pose_happy", cam_34, 15),                  # happy 跳起
        ("pose_walk", cam_34, 18),                   # walk 迈步
        ("pose_walk_b", cam_34, 30),                 # walk 另一相位
        ("pose_walk_c", cam_34, 9),                  # walk 第三相位
    ]
    ad = arm_obj.animation_data
    pb = arm_obj.pose.bones
    for name, cam, frame in shots:
        reset_pose(arm_obj)
        if name == "pure_rest":
            ad.action = None
        else:
            act_name = "idle" if name.startswith("rest") or name == "pose_headturn" \
                else ("happy" if "happy" in name else "walk")
            ad.action = bpy.data.actions.get(act_name)
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        dbg = pb.get("hips")
        print(f"[dbg] {name} act={ad.action.name if ad.action else None} "
              f"frame={frame} hips_loc=({dbg.location.x:.3f},{dbg.location.y:.3f},{dbg.location.z:.3f})")
        render_pose(cam, os.path.join(renders_dir, f"{name}.png"))
    ad.action = None


# ---------------------------------------------------------------- main

def main():
    args = parse_args()
    clear_scene()
    objs = import_glb(args.input)
    mesh = join_meshes(objs)
    clean_mesh(mesh)
    normalize(mesh, args.height, args.facing)
    arm_obj = build_armature(args.plan, mesh)
    _, skin_name = auto_weight(mesh, arm_obj)
    make_actions(arm_obj, args.plan)
    compress(mesh, args.max_tris, args.tex_size)
    export_glb(args.out)
    if args.renders:
        render_previews(args.renders, arm_obj)
    print(f"[done] plan={args.plan} skin={skin_name}")


main()
