# -*- coding: utf-8 -*-
"""诊断脚本：连通岛结构 / 流形性 / 截面形状 / 蒙皮拉伸率
用法： blender -b -P diag_mesh.py -- --input <rigged.glb>
"""
import bpy
import sys
import argparse
import math
from mathutils import Vector
from collections import defaultdict


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--frames", default="", help="逐帧拉伸诊断：action:frame,action:frame")
    return p.parse_args(argv)


def clear():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)


def main():
    args = parse_args()
    clear()
    bpy.ops.import_scene.gltf(filepath=args.input)
    all_mesh = [o for o in bpy.data.objects if o.type == 'MESH']
    for o in all_mesh:
        print(f"[对象] {o.name} verts={len(o.data.vertices)} vg={len(o.vertex_groups)} "
              f"mods={[m.type for m in o.modifiers]}")
    mesh_obj = max(all_mesh, key=lambda o: len(o.data.vertices))
    me = mesh_obj.data
    print(f"[模型] verts={len(me.vertices)} polys={len(me.polygons)}")

    # ---- 连通岛（按边 union-find）
    parent = list(range(len(me.vertices)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for e in me.edges:
        union(e.vertices[0], e.vertices[1])
    groups = defaultdict(list)
    for i in range(len(me.vertices)):
        groups[find(i)].append(i)
    islands = sorted(groups.values(), key=len, reverse=True)
    print(f"[岛] 总数={len(islands)}  最大岛占比={len(islands[0])/len(me.vertices)*100:.1f}%")
    mw = mesh_obj.matrix_world
    for k, isl in enumerate(islands[:12]):
        pts = [mw @ me.vertices[i].co for i in isl]
        c = sum(pts, Vector()) / len(pts)
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        print(f"  岛{k:02d} v={len(isl):5d} 质心=({c.x:+.3f},{c.y:+.3f},{c.z:+.3f}) "
              f"尺寸=({hi.x-lo.x:.3f},{hi.y-lo.y:.3f},{hi.z-lo.z:.3f})")

    # ---- 非流形边 / 边界边
    edge_face = defaultdict(int)
    for p in me.polygons:
        vs = list(p.vertices)
        for i in range(len(vs)):
            a, b = vs[i], vs[(i + 1) % len(vs)]
            edge_face[tuple(sorted((a, b)))] += 1
    boundary = sum(1 for v in edge_face.values() if v == 1)
    nonmani = sum(1 for v in edge_face.values() if v > 2)
    print(f"[拓扑] 边界边={boundary} 非流形边={nonmani} 边总数={len(edge_face)}")

    # ---- 沿 Z 分层的横截面（找腿/身体/头的真实位置）
    pts = [mw @ v.co for v in me.vertices]
    zmin = min(p.z for p in pts)
    zmax = max(p.z for p in pts)
    H = zmax - zmin
    print(f"[截面] H={H:.3f}")
    for k in range(12):
        z0 = zmin + H * k / 12
        z1 = zmin + H * (k + 1) / 12
        band = [p for p in pts if z0 <= p.z < z1]
        if not band:
            print(f"  z={k/12:.2f}~{(k+1)/12:.2f}H 无顶点")
            continue
        xs = [p.x for p in band]
        ys = [p.y for p in band]
        # X 方向直方图，看是否分成两簇（双腿）
        nb = 12
        hist = [0] * nb
        xmin, xmax = min(xs), max(xs)
        span = max(xmax - xmin, 1e-6)
        for x in xs:
            hist[min(nb - 1, int((x - xmin) / span * nb))] += 1
        bar = "".join("#" if h > len(band) * 0.06 else ("." if h else " ") for h in hist)
        print(f"  z={k/12:.2f}~{(k+1)/12:.2f}H n={len(band):5d} X[{xmin:+.3f},{xmax:+.3f}] "
              f"Y[{min(ys):+.3f},{max(ys):+.3f}] |{bar}|")

    # ---- 蒙皮拉伸率：逐帧比较边长相对静止的变化
    if args.frames:
        arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
        dg = bpy.context.evaluated_depsgraph_get()
        edges = [(e.vertices[0], e.vertices[1]) for e in me.edges]
        arm.animation_data.action = None
        for pb in arm.pose.bones:
            pb.location = (0, 0, 0)
            pb.rotation_euler = (0, 0, 0)
            pb.scale = (1, 1, 1)
        bpy.context.view_layer.update()
        dg.update()
        ev = mesh_obj.evaluated_get(dg)
        rest = [ev.matrix_world @ v.co for v in ev.data.vertices]
        rest_len = [(rest[a] - rest[b]).length for a, b in edges]
        for item in args.frames.split(","):
            act_name, fr = item.split(":")
            arm.animation_data.action = bpy.data.actions.get(act_name)
            bpy.context.scene.frame_set(int(fr))
            bpy.context.view_layer.update()
            dg.update()
            ev = mesh_obj.evaluated_get(dg)
            cur = [ev.matrix_world @ v.co for v in ev.data.vertices]
            ratios = []
            for (a, b), L0 in zip(edges, rest_len):
                if L0 < 1e-6:
                    continue
                L = (cur[a] - cur[b]).length
                ratios.append(L / L0)
            ratios.sort()
            n = len(ratios)
            p999 = ratios[int(n * 0.999)]
            print(f"[拉伸] {act_name}@{fr}: 边长比 中位={ratios[n//2]:.4f} "
                  f"p99={ratios[int(n*0.99)]:.3f} p99.9={p999:.3f} max={ratios[-1]:.3f} "
                  f">1.05的比例={sum(1 for r in ratios if r > 1.05)/n*100:.2f}% "
                  f"<0.95的比例={sum(1 for r in ratios if r < 0.95)/n*100:.2f}%")


main()
