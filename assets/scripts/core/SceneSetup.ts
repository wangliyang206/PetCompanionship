/**
 * 场景装配（B2/B3）：把表现层挂到 Main.scene 上
 * - PetAnchor 节点 → PetView 组件
 * - 运行时创建 Canvas + UI Camera + GameUI（场景本身不含 UI 节点，避免手写场景 JSON）
 * - 幂等：重复调用不会重复挂载
 */

import {
  Camera, Canvas, Color, director, FogInfo, Layers, MeshRenderer,
  Node, ResolutionPolicy, Scene, UITransform, view,
} from 'cc';
import { GameSave } from '../core/GameSave';
import { GameConfig } from '../core/GameConfig';
import { makePlainMaterial, PetView } from '../pet/PetView';
import { WanderSystem } from '../pet/WanderSystem';
import { SceneAnchors } from './SceneAnchors';
import { GameUI } from '../ui/GameUI';

export class SceneSetup {

  private static _done = false;

  static setup(): void {
    if (this._done) return;
    const scene = director.getScene();
    if (!scene) return;
    this._done = true;

    // UI 常量按 720×1280 设计稿编写，先固定设计分辨率再搭 Canvas
    view.setDesignResolutionSize(720, 1280, ResolutionPolicy.FIXED_HEIGHT);

    this.styleScene(scene);
    SceneAnchors.ensure(scene);

    const anchor = scene.getChildByName('PetAnchor');
    if (anchor) {
      // PetAnchor 贴到软垫（窝）上：蛋孵化/幼崽都在这里开始
      anchor.setPosition(GameConfig.SCENE.HOME.x, 0, GameConfig.SCENE.HOME.z);
      if (!anchor.getComponent(PetView)) anchor.addComponent(PetView);
      if (!anchor.getComponent(WanderSystem)) anchor.addComponent(WanderSystem);
    }

    let canvasNode = scene.getChildByName('Canvas');
    if (!canvasNode) {
      canvasNode = this.createCanvas(scene);
    }
    if (!canvasNode.getComponent(GameUI)) {
      canvasNode.addComponent(GameUI);
    }
    console.log('[SceneSetup] 表现层已装配, save=', GameSave.isInitialized);
  }

  /**
   * 场景氛围（测试期占位美术）：奶油色底 + 一片看不到边的暖色地面
   * - 相机清屏色奶油色，关掉默认天空盒（偏灰蓝），场景底色与地面同族
   * - 地面放大到边界完全出画，再用线性雾淡入背景色 → 没有“漂浮小岛”的梯形硬边
   * - 3D 的窝（Nest）隐藏：窝由 UI 的 2D 软垫绘制，3D 方块会在垫子外围多出一圈“双窝”
   * - 不再创建后墙 / 地毯：纯色板在奶油底上只会露出直边和色差
   */
  private static styleScene(scene: Scene): void {
    const cam = scene.getChildByName('Main Camera')?.getComponent(Camera);
    if (cam) cam.clearColor = new Color(246, 237, 226, 255);

    try {
      const skybox = scene.globals?.skybox;
      if (skybox) skybox.enabled = false;
    } catch (e) {
      console.warn('[SceneSetup] 关闭天空盒失败:', e);
    }

    // 地面：场景里只有 8×8，镜头能直接看到四条边（截图里那块“灰色梯形阴影”就是它）。
    // 放大到 40×40 让边缘彻底出画，颜色贴背景色，只留一点点暖色差当“地板”。
    const ground = scene.getChildByName('Ground');
    if (ground) {
      ground.setScale(4, 1, 4);
      this.paint(ground, '#EFE1CD');
    }

    const nest = scene.getChildByName('Nest');
    if (nest) nest.active = false;

    // 远处的雾：地面在视距内淡入背景色，天然没有地平线硬边
    try {
      const fog = scene.globals?.fog;
      if (fog) {
        fog.enabled = true;
        fog.type = FogInfo.FogType.LINEAR;
        fog.fogColor = new Color(246, 237, 226, 255);
        fog.fogStart = 12;
        fog.fogEnd = 34;
      }
    } catch (e) {
      console.warn('[SceneSetup] 开启雾效失败:', e);
    }
  }

  private static paint(node: Node | null, hex: string): void {
    if (!node) return;
    const mr = node.getComponent(MeshRenderer);
    if (!mr) return;
    const mat = makePlainMaterial(hex);
    if (mat) mr.material = mat;
  }

  /** 运行时 2D 画布：中间坐标原点，1 单位 = 1 设计像素 */
  private static createCanvas(scene: Node): Node {
    const size = view.getVisibleSize();
    const px = view.getVisibleSizeInPixel();
    console.log('[SceneSetup] 可见尺寸 =', size.width, size.height, '像素 =', px.width, px.height);
    const root = new Node('Canvas');
    root.layer = Layers.Enum.UI_2D;
    scene.addChild(root);

    const tf = root.addComponent(UITransform);
    tf.setAnchorPoint(0.5, 0.5);
    tf.setContentSize(size.width, size.height);

    const camNode = new Node('UICamera');
    camNode.layer = Layers.Enum.UI_2D;
    root.addChild(camNode);
    camNode.setPosition(0, 0, 1000);

    const cam = camNode.addComponent(Camera);
    cam.projection = Camera.ProjectionType.ORTHO;
    cam.orthoHeight = size.height / 2;
    cam.near = 1;
    cam.far = 2000;
    cam.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
    cam.visibility = Layers.Enum.UI_2D;
    cam.priority = 1000;

    const canvas = root.addComponent(Canvas);
    canvas.cameraComponent = cam;
    canvas.alignCanvasWithScreen = false;
    return root;
  }
}
