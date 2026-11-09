/**
 * 骨骼动画演示组件（独立演示场景用，不参与正式玩法逻辑）
 * - 运行时从 resources 加载带骨骼的 glb（prefab 子资源）
 * - 自动播放 idle，支持 crossFade 切换 walk / happy
 * - 鼠标拖拽可绕 Y 轴旋转查看
 * - 通过 globalThis.petDemo 暴露给页面按钮调用（仅演示用）
 */
import {
  _decorator, Component, Node, Prefab, resources, instantiate,
  SkeletalAnimation, AnimationClip, input, Input, EventMouse, Camera, Color, Layers,
} from 'cc';

const { ccclass } = _decorator;

/** glb 的 prefab 子资源在 resources 下的路径候选（不同导入器版本略有差异） */
const PATHS = [
  'models/changfeng_rig/changfeng_rig',
  'models/changfeng_rig',
];

@ccclass('PetRigDemo')
export class PetRigDemo extends Component {
  private holder: Node | null = null;
  private sAnim: SkeletalAnimation | null = null;
  private names: string[] = [];
  private cur = '';
  private dragging = false;
  private yaw = 0;

  onLoad(): void {
    this.holder = new Node('PetHolder');
    this.holder.setParent(this.node);
    this.holder.setPosition(0, 0, 0);

    const g = globalThis as any;
    g.petDemo = {
      play: (n: string) => this.play(n),
      next: () => this.next(),
      list: () => this.names.slice(),
      current: () => this.cur,
      loaded: () => !!this.sAnim,
    };

    this.bindDrag();
    this.tryLoad(0);
  }

  private tryLoad(i: number): void {
    if (i >= PATHS.length) {
      console.error('[PetRigDemo] prefab 加载失败，尝试 loadDir');
      resources.loadDir('models/changfeng_rig', Prefab, (e, list) => {
        if (e || !list || !list.length) {
          console.error('[PetRigDemo] 所有加载方式均失败', e);
          return;
        }
        this.spawn(list[0]);
      });
      return;
    }
    resources.load(PATHS[i], Prefab, (err, prefab: Prefab) => {
      if (err || !prefab) {
        console.warn('[PetRigDemo] 路径失败', PATHS[i], err && err.message);
        this.tryLoad(i + 1);
        return;
      }
      console.log('[PetRigDemo] prefab 已加载:', PATHS[i]);
      this.spawn(prefab);
    });
  }

  private spawn(prefab: Prefab): void {
    if (!this.holder) return;
    const node = instantiate(prefab);
    node.setParent(this.holder);
    node.setPosition(0, 0, 0);

    this.sAnim = node.getComponent(SkeletalAnimation)
      || node.getComponentInChildren(SkeletalAnimation);

    if (!this.sAnim) {
      console.error('[PetRigDemo] prefab 内没有 SkeletalAnimation（模型可能未带骨骼）');
      return;
    }

    const clips: AnimationClip[] = this.sAnim.clips || [];
    this.names = clips.map((c) => c.name);
    console.log('[PetRigDemo] 动画剪辑:', this.names.join(', ') || '(空)');
    (globalThis as any).__petClips = this.names.slice();

    // 相机取景：glb 在引擎中的实际尺寸大于 Blender 归一化值（导入单位换算），
    // mesh.bounds 在 runtime 不可靠，故用实测标定距离。
    // 用独立的高优先级演示相机，避免被正式游戏逻辑改动取景。
    const camNode = new Node('DemoCamera');
    camNode.setParent(this.node);
    const cam = camNode.addComponent(Camera);
    cam.priority = 5000;
    cam.projection = Camera.ProjectionType.PERSPECTIVE;
    cam.fov = 40;
    cam.near = 0.01;
    cam.far = 100;
    cam.visibility = Layers.Enum.DEFAULT;
    cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    cam.clearColor = new Color(232, 237, 244, 255);
    camNode.setPosition(0, 0.45, 3.2);
    camNode.setRotationFromEuler(-8, 0, 0);

    // 演示模式：4 秒后收起正式游戏 UI（GameBootstrap 的选蛋/主界面），
    // 只在演示场景里生效，不改任何游戏代码
    this.scheduleOnce(() => this.hideGameUI(), 4);

    if (!clips.length) return;
    const idle = clips.find((c) => /idle/i.test(c.name)) || clips[0];
    this.play(idle.name);
  }

  private hideGameUI(): void {
    const s = this.node.scene;
    s.children.forEach((n) => {
      if (n.name === 'Canvas' || n.name === 'PROFILER_NODE') n.active = false;
    });
  }

  private play(name: string): void {
    if (!this.sAnim) {
      console.warn('[PetRigDemo] 模型未就绪');
      return;
    }
    const hit = this.sAnim.clips.find((c) => c.name === name)
      || this.sAnim.clips.find((c) => new RegExp(name, 'i').test(c.name));
    if (!hit) {
      console.warn('[PetRigDemo] 无此动画:', name, '可选:', this.names);
      return;
    }
    this.cur = hit.name;
    if (this.cur === hit.name && this.sAnim.getState(hit.name)?.isPlaying) {
      // 已在播放，重置到开头（便于重复点同一个按钮）
      this.sAnim.getState(hit.name)?.setTime(0);
    }
    this.sAnim.crossFade(hit.name, 0.18, true);
    (globalThis as any).__petAnimName = hit.name;
    console.log('[PetRigDemo] 播放', hit.name);
  }

  private next(): void {
    if (!this.names.length) return;
    const i = Math.max(0, this.names.indexOf(this.cur));
    this.play(this.names[(i + 1) % this.names.length]);
  }

  private bindDrag(): void {
    input.on(Input.EventType.MOUSE_DOWN, () => { this.dragging = true; }, this);
    input.on(Input.EventType.MOUSE_UP, () => { this.dragging = false; }, this);
    input.on(Input.EventType.MOUSE_MOVE, (e: EventMouse) => {
      if (!this.dragging || !this.holder) return;
      this.yaw += e.getDeltaX() * 0.4;
      this.holder.setRotationFromEuler(0, this.yaw, 0);
    }, this);
  }
}
