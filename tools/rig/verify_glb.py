# -*- coding: utf-8 -*-
"""对已导出的 rigged GLB 用与 rig_pet2.verify_deform 相同口径复算畸变（三角形相似度 p99）。
用法： blender -b -P verify_glb.py -- --input <rigged.glb>
"""
import bpy, sys, argparse


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    return p.parse_args(argv)


def main():
    args = parse_args()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=args.input)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    mesh = max(meshes, key=lambda o: len(o.data.vertices))
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    tris = [tuple(p.vertices) for p in mesh.data.polygons if len(p.vertices) == 3]

    dg = bpy.context.evaluated_depsgraph_get()
    arm.animation_data.action = None
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    dg.update()
    ev = mesh.evaluated_get(dg)
    rest = [ev.matrix_world @ v.co for v in ev.data.vertices]

    def lens(pts):
        return [((pts[a] - pts[b]).length, (pts[b] - pts[c]).length, (pts[c] - pts[a]).length)
                for a, b, c in tris]

    L0 = lens(rest)
    worst = (0.0, "", 0.0)
    for act in bpy.data.actions:
        arm.animation_data.action = act
        fmax = int(act.frame_range[1])
        for f in range(0, fmax + 1, max(1, fmax // 10)):
            bpy.context.scene.frame_set(f)
            bpy.context.view_layer.update()
            dg.update()
            ev = mesh.evaluated_get(dg)
            cur = [ev.matrix_world @ v.co for v in ev.data.vertices]
            L1 = lens(cur)
            devs = []
            for (a0, b0, c0), (a1, b1, c1) in zip(L0, L1):
                if min(a0, b0, c0) < 1e-6:
                    continue
                r = (a1 / a0, b1 / b0, c1 / c0)
                m = sum(r) / 3
                if m < 1e-9:
                    continue
                devs.append(max(abs(v / m - 1) for v in r))
            if not devs:
                continue
            devs.sort()
            p99 = devs[int(len(devs) * 0.99)]
            tag = f"{act.name}@{f}"
            flag = "  ←←" if p99 > 0.06 else ""
            print(f"  [frame] {tag:14s} p99={p99*100:7.3f}%  max={devs[-1]*100:7.2f}%{flag}")
            if p99 > worst[0]:
                worst = (p99, tag, devs[-1])
    verdict = "✅ 无可感知变形" if worst[0] < 0.02 else ("⚠️ 轻度变形" if worst[0] < 0.06 else "❌ 明显变形")
    print(f"[verify-glb] {args.input}  p99={worst[0]*100:.3f}% max={worst[2]*100:.2f}% "
          f"（{worst[1]}）　{verdict}")


main()
