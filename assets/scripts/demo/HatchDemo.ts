/**
 * 孵化流程演示组件（独立演示场景用，不参与正式玩法逻辑）
 * 流程：蛋静置轻晃 → 点击 → 摇晃加剧 → 破壳 → 幼崽登场播 idle
 *       → 可切 待机/走路/开心，可切 团团/长风 对比两只骨骼模型
 * 模型约定与正式 PetView 保持一致：
 *   - 蛋（mao_tuantuan_egg）是躺姿导出：绕 X +90° 站起，按局部 z 跨度归一化（Egg 0.75）
 *   - 骨骼幼崽（rigPet2 管线产出）本身直立：按 y 跨度归一化（Baby 0.85）
 * 通过 globalThis.hatchDemo 暴露给页面按钮 / CDP 调用（仅演示用）
 */
import {
  _decorator, Component, Node, Prefab, resources, instantiate,
  SkeletalAnimation, AnimationClip, input, Input, EventMouse, Camera, Color,
  MeshRenderer, Material, tween, Vec3,
  primitives, utils,
} from 'cc';

const { ccclass } = _decorator;

/** 两只已骨骼化的幼崽（rigPet2 管线产出，8 骨 idle/walk/happy） */
const PETS: Record<string, { path: string; label: string }> = {
  tuantuan: { path: 'models/tuantuan_rig/tuantuan_rig/tuantuan_rig', label: '团团' },
  changfeng: { path: 'models/changfeng_rig/changfeng_rig/changfeng_rig', label: '长风' },
};
/** 蛋改用内置球体：glb 运行时包围盒不可靠（PetRigDemo 实测结论），标定更稳 */
const EGG_R = 0.25;          // 蛋显示半径（世界单位，蛋总高 0.64 ≈ 幼崽 1.7 倍缩放下的身高）
/** 宠物缩放（CDP 实测标定）：scale 1.0 → 约 31% 屏高（1280x800 窗口），
 *  目标 55% 屏高 → 1.7。模型局部高 0.35（SMR bounds 实测） */
const PET_SCALE = 1.7;
/** 演示专用渲染层（bit10，避开引擎保留位）。
 *  GameRoot 会对任意场景自举（EVENT_AFTER_SCENE_LAUNCH），正式游戏世界
 *  （地面/窝/正式宠物/UI）全在 DEFAULT 层 —— DemoCamera 只渲染本层，
 *  正式世界无论往场景里塞什么都进不了演示画面 */
const DEMO_LAYER = 1 << 10;

@ccclass('HatchDemo')
export class HatchDemo extends Component {
  private holder: Node | null = null;       // 拖拽旋转作用于它
  private eggHolder: Node | null = null;    // 站起旋转 + 归一化
  private petNode: Node | null = null;
  private sAnim: SkeletalAnimation | null = null;
  private names: string[] = [];
  private cur = '';
  private stage: 'egg' | 'hatching' | 'pet' = 'egg';
  private petName = 'tuantuan';
  private hatchT = 0;                       // 破壳动画进度
  private wobT = 0;                         // 静置晃动相位
  private yaw = 0;
  private dragging = false;

  onLoad(): void {
    // 主灯挪到演示层：DemoCamera 只认 DEMO_LAYER，灯不在该层宠物就是黑的
    this.node.scene.children.forEach((n) => {
      if (n.name === 'Main Light') n.layer = DEMO_LAYER;
    });

    this.holder = new Node('DemoHolder');
    this.holder.setParent(this.node);
    this.holder.setPosition(0, 0, 0);
    this.setLayerDeep(this.holder, DEMO_LAYER);

    const g = globalThis as any;
    g.hatchDemo = {
      hatch: () => this.hatch(),
      pet: (n: string) => this.switchPet(n),
      play: (n: string) => this.play(n),
      stage: () => this.stage,
      current: () => this.petName,
      anim: () => this.cur,
      loaded: () => this.stage === 'pet' && !!this.sAnim,
    };

    this.makeCamera();
    this.bindInput();
    this.loadEgg();
    this.scheduleOnce(() => this.hideGameUI(), 4);
  }

  /** 独立高优先级演示相机（不依赖/不改动正式游戏相机） */
  private makeCamera(): void {
    const camNode = new Node('DemoCamera');
    camNode.setParent(this.node);
    camNode.layer = DEMO_LAYER;
    const cam = camNode.addComponent(Camera);
    cam.priority = 5000;
    cam.projection = Camera.ProjectionType.PERSPECTIVE;
    cam.fovAxis = 1;              // 1 = VERTICAL，先定轴再设 fov（改轴时引擎会换算 fov 值）
    cam.fov = 40;                 // 垂直 fov40：距离 3.2 处视口高 ≈ 2.33，构图按此推算
    cam.near = 0.01;
    cam.far = 100;
    cam.visibility = DEMO_LAYER;  // 只渲染演示层 → 正式世界（DEFAULT 层）彻底隔离
    cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    cam.clearColor = new Color(232, 237, 244, 255);
    camNode.setPosition(0, 0.45, 3.2);
    camNode.setRotationFromEuler(-8, 0, 0);
  }

  /** 递归设置节点层（蛋/宠物实例化后调用） */
  private setLayerDeep(n: Node, layer: number): void {
    n.layer = layer;
    for (const c of n.children) this.setLayerDeep(c, layer);
  }

  private bindInput(): void {
    input.on(Input.EventType.MOUSE_DOWN, () => {
      if (this.stage === 'egg') { this.hatch(); return; }
      this.dragging = true;
    }, this);
    input.on(Input.EventType.MOUSE_UP, () => { this.dragging = false; }, this);
    input.on(Input.EventType.MOUSE_MOVE, (e: EventMouse) => {
      if (!this.dragging || !this.holder || this.stage !== 'pet') return;
      this.yaw += e.getDeltaX() * 0.4;
      this.holder.setRotationFromEuler(0, this.yaw, 0);
    }, this);
  }

  // ---------- 蛋 ----------

  private loadEgg(): void {
    const node = new Node('EggModel');
    const mr = node.addComponent(MeshRenderer);
    try {
      // builtinResMgr 里没有内置球体网格（3.8 实测返回 null → 蛋隐形），
      // 用 primitives 程序化生成一个光滑球体
      mr.mesh = utils.MeshUtils.createMesh(primitives.sphere());
    } catch (e) {
      console.error('[HatchDemo] 球体网格生成失败', e);
    }
    const mat = new Material();
    mat.initialize({ effectName: 'builtin-unlit', defines: {}, });
    mat.setProperty('mainColor', new Color(238, 216, 168, 255));
    mr.material = mat;
    const holder = new Node('EggStand');
    holder.setParent(this.holder);
    holder.setScale(EGG_R, EGG_R * 1.28, EGG_R);   // 轻压扁拉高 = 蛋形
    holder.setPosition(0, EGG_R * 1.28, 0);        // 底部落地
    node.setParent(holder);
    this.eggHolder = holder;
    if (this.holder) this.setLayerDeep(this.holder, DEMO_LAYER);   // 蛋整棵树进演示层
    console.log('[HatchDemo] 蛋已就位，点击孵化');
  }

  // ---------- 破壳 ----------

  hatch(): void {
    if (this.stage !== 'egg') return;
    this.stage = 'hatching';
    this.hatchT = 0;
    console.log('[HatchDemo] 开始孵化');
  }

  /** 每帧驱动：egg=轻晃；hatching=先加剧晃 0.9s 再缩没，然后上幼崽 */
  update(dt: number): void {
    if (this.stage === 'egg' && this.eggHolder) {
      this.wobT += dt;
      const a = Math.sin(this.wobT * 3.2) * 5;
      this.eggHolder.setRotationFromEuler(a, 0, 0);
    } else if (this.stage === 'hatching' && this.eggHolder) {
      this.hatchT += dt;
      const t = this.hatchT;
      if (t < 0.9) {
        const a = Math.sin(t * 26) * (4 + t * 26);   // 越晃越猛
        this.eggHolder.setRotationFromEuler(a, 0, 0);
      } else if (t < 1.15) {
        const k = Math.max(0.001, 1 - (t - 0.9) / 0.25);
        this.eggHolder.setScale(k, k, k);
      } else {
        this.eggHolder.active = false;
        this.stage = 'pet';
        this.spawnPet(this.petName);
      }
    }
  }

  // ---------- 幼崽 ----------

  private spawnPet(name: string): void {
    const info = PETS[name];
    if (!info || !this.holder) return;
    this.petName = name;
    resources.load(`${info.path}`, Prefab, (err, prefab: Prefab) => {
      if (err || !prefab || !this.holder) {
        console.error('[HatchDemo] 幼崽模型加载失败', info.path, err && err.message);
        return;
      }
      if (this.petNode) this.petNode.destroy();
      const node = instantiate(prefab);
      node.setParent(this.holder);
      this.setLayerDeep(node, DEMO_LAYER);        // 宠物整棵树进演示层
      // rigPet2 管线产出口径一致（归一化 0.35 高、脚底 y≈0），
      // 运行时包围盒对蒙皮网格不可靠 → 直接用标定系数
      node.setScale(PET_SCALE, PET_SCALE, PET_SCALE);
      node.setPosition(0, 0, 0);
      // 登场小弹跳：scale 0 → 1
      const target = node.scale.clone();
      node.setScale(0.01, 0.01, 0.01);
      tween(node).to(0.3, { scale: new Vec3(target.x, target.y, target.z) },
        { easing: 'backOut' }).start();
      this.petNode = node;

      this.sAnim = node.getComponent(SkeletalAnimation)
        || node.getComponentInChildren(SkeletalAnimation);
      if (!this.sAnim) {
        console.error('[HatchDemo] prefab 内没有 SkeletalAnimation（模型未带骨骼？）');
        return;
      }
      const clips: AnimationClip[] = (this.sAnim.clips || []).filter(
        (c): c is AnimationClip => !!c,
      );
      this.names = clips.map((c) => c.name);
      (globalThis as any).__petClips = this.names.slice();
      console.log(`[HatchDemo] ${info.label} 登场，动画:`, this.names.join(', '));
      const idle = clips.find((c) => /idle/i.test(c.name)) || clips[0];
      if (idle) this.play(idle.name);
    });
  }

  private play(name: string): void {
    if (!this.sAnim) return;
    const hit = this.sAnim.clips.find((c) => !!c && c.name === name)
      || this.sAnim.clips.find((c) => !!c && new RegExp(name, 'i').test(c.name));
    if (!hit) {
      console.warn('[HatchDemo] 无此动画:', name, '可选:', this.names);
      return;
    }
    this.cur = hit.name;
    (globalThis as any).__petAnimName = hit.name;
    this.sAnim.crossFade(hit.name, 0.18);
    console.log('[HatchDemo] 播放', hit.name);
  }

  private switchPet(name: string): void {
    if (this.stage !== 'pet' || !PETS[name] || name === this.petName) return;
    this.spawnPet(name);
  }

  // ---------- 其它 ----------

  private hideGameUI(): void {
    const s = this.node.scene;
    s.children.forEach((n) => {
      if (n.name === 'Canvas' || n.name === 'PROFILER_NODE') n.active = false;
    });
  }
}
