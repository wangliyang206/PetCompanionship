# -*- coding: utf-8 -*-
"""定位畸变来源：对指定动作帧算每三角形相似度偏差，输出偏差最大的三角形位置分布。
用法： blender -b -P locate_deform.py -- --input <rigged.glb> --action happy --frame 15
"""
import bpy, sys, argparse
from mathutils import Vector


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--action", default="happy")
    p.add_argument("--frame", type=int, default=15)
    return p.parse_args(argv)


def main():
    args = parse_args()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=args.input)
    # 选顶点最多的 mesh 作为目标（导入器生成的辅助形状在 glTF_not_exported 集合里）
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    mesh = max(meshes, key=lambda o: len(o.data.vertices))
    print(f"[loc] 目标 mesh: {mesh.name} verts={len(mesh.data.vertices)}")
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    tris = [tuple(p.vertices) for p in mesh.data.polygons if len(p.vertices) == 3]

    dg = bpy.context.evaluated_depsgraph_get()
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    dg.update()
    ev = mesh.evaluated_get(dg)
    rest = [ev.matrix_world @ v.co for v in ev.data.vertices]

    def lens(pts):
        return [((pts[a] - pts[b]).length, (pts[b] - pts[c]).length, (pts[c] - pts[a]).length)
                for a, b, c in tris]

    L0 = lens(rest)
    arm.animation_data.action = bpy.data.actions.get(args.action)
    bpy.context.scene.frame_set(args.frame)
    bpy.context.view_layer.update()
    dg.update()
    ev = mesh.evaluated_get(dg)
    cur = [ev.matrix_world @ v.co for v in ev.data.vertices]
    L1 = lens(cur)

    scored = []
    for i, ((a0, b0, c0), (a1, b1, c1)) in enumerate(zip(L0, L1)):
        if min(a0, b0, c0) < 1e-6:
            continue
        r = (a1 / a0, b1 / b0, c1 / c0)
        m = sum(r) / 3
        if m < 1e-9:
            continue
        dev = max(abs(v / m - 1) for v in r)
        vs = tris[i]
        ctr = sum((cur[v] for v in vs), Vector()) / 3
        scored.append((dev, ctr, max(a0, b0, c0)))
    scored.sort(key=lambda t: -t[0])
    n = len(scored)
    print(f"[loc] 三角形 {n} 个, p50={scored[n//2][0]*100:.2f}% p90={scored[int(n*.9)][0]*100:.2f}% "
          f"p99={scored[int(n*.99)][0]*100:.2f}% max={scored[0][0]*100:.2f}%")
    print("[loc] 偏差 Top20（dev% | 位置 x,y,z | 原始最大边长）:")
    for dev, c, esz in scored[:20]:
        print(f"  {dev*100:6.2f}%  x={c.x:+.4f} y={c.y:+.4f} z={c.z:+.4f}  esz={esz:.5f}")
    # 分区统计：按 z 高度和 |x| 粗分
    zones = {"head_top(>0.6H)": lambda c: c.z > 0.6 * 0.35,
             "ear_side(|x|>0.1)": lambda c: abs(c.x) > 0.1,
             "mid_body": lambda c: 0.2 * 0.35 < c.z <= 0.6 * 0.35,
             "low(<=0.2H)": lambda c: c.z <= 0.2 * 0.35}
    for zn, fn in zones.items():
        sel = [s for s in scored if fn(s[1])]
        if sel:
            sel.sort(key=lambda t: -t[0])
            print(f"[loc] {zn}: n={len(sel)} p99={sel[int(len(sel)*.99) if len(sel)>4 else -1][0]*100:.2f}% "
                  f"max={sel[0][0]*100:.2f}%")


main()
