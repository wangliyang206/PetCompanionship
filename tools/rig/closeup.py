# -*- coding: utf-8 -*-
"""特写对比渲染：同一机位渲染静止帧与指定动作帧，肉眼验证畸变是否可见。
用法： blender -b -P closeup.py -- --input <rigged.glb> --action happy --frame 15 --out <dir>
"""
import bpy, sys, argparse, math, os


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--action", default="happy")
    p.add_argument("--frame", type=int, default=15)
    p.add_argument("--out", default="closeup")
    p.add_argument("--lookat", default="0,-0.18,0.10")
    p.add_argument("--campos", default="0.10,-0.42,0.14")
    return p.parse_args(argv)


def main():
    args = parse_args()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=args.input)
    mesh = max((o for o in bpy.data.objects if o.type == 'MESH'),
               key=lambda o: len(o.data.vertices))
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 32
    scene.render.resolution_x = 800
    scene.render.resolution_y = 800
    w = bpy.data.worlds.new("W")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.92, 0.92, 0.94, 1)
    scene.world = w
    keyl = bpy.data.lights.new("key", 'AREA')
    keyl.energy = 60
    ko = bpy.data.objects.new("key", keyl)
    ko.location = (0.5, -0.8, 0.6)
    ko.rotation_euler = (math.radians(50), 0, math.radians(30))
    bpy.context.collection.objects.link(ko)

    look = [float(v) for v in args.lookat.split(",")]
    campos = [float(v) for v in args.campos.split(",")]
    cam = bpy.data.cameras.new("cu")
    cam.lens = 50
    co = bpy.data.objects.new("cu", cam)
    co.location = campos
    d = [look[i] - campos[i] for i in range(3)]
    import mathutils
    co.rotation_euler = mathutils.Vector(d).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.collection.objects.link(co)
    scene.camera = co

    os.makedirs(args.out, exist_ok=True)
    shots = [("closeup_rest", None, 0), (f"closeup_{args.action}_{args.frame}", args.action, args.frame)]
    for name, act_name, f in shots:
        arm.animation_data.action = bpy.data.actions.get(act_name) if act_name else None
        scene.frame_set(f)
        scene.render.filepath = os.path.join(args.out, f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"[closeup] {name}")


main()
