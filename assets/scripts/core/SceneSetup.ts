/**
 * 场景装配（B2/B3）：把表现层挂到 Main.scene 上
 * - PetAnchor 节点 → PetView 组件
 * - 运行时创建 Canvas + UI Camera + GameUI（场景本身不含 UI 节点，避免手写场景 JSON）
 * - 幂等：重复调用不会重复挂载
 */

import {
  builtinResMgr, Camera, Canvas, Color, director, Layers, Mesh, MeshRenderer,
  Node, ResolutionPolicy, Scene, UITransform, view,
} from 'cc';
import { GameSave } from '../core/GameSave';
import { makePlainMaterial, PetView } from '../pet/PetView';
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

    const anchor = scene.getChildByName('PetAnchor');
    if (anchor && !anchor.getComponent(PetView)) {
      anchor.addComponent(PetView);
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
   * 场景氛围（测试期占位美术）：把默认的灰盒子换成暖色小屋
   * - 相机清屏色改为奶油色，并关闭默认天空盒（默认天空盒偏灰蓝，画面显得“空壳”）
   * - 地面/巢换纯色材质，宠物脚下铺一块地毯
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

    this.paint(scene.getChildByName('Ground'), '#E7D3B7');
    this.paint(scene.getChildByName('Nest'), '#C89B6C');

    const groundLayer = scene.getChildByName('Ground')?.layer;

    // 后墙：挡住默认天空盒，保证画面底色是暖色（不依赖 skybox 开关是否生效）
    if (!scene.getChildByName('BackWall')) {
      const wall = new Node('BackWall');
      wall.layer = groundLayer ?? wall.layer;
      wall.setParent(scene);
      wall.setPosition(0, 3.2, -4.2);
      const mr = wall.addComponent(MeshRenderer);
      const box = builtinResMgr.get<Mesh>('box');
      if (box) mr.mesh = box;
      const mat = makePlainMaterial('#F7EBDC');
      if (mat) mr.material = mat;
      wall.setScale(14, 9, 0.2);
    }

    if (!scene.getChildByName('Rug')) {
      const rug = new Node('Rug');
      rug.layer = groundLayer ?? rug.layer;
      rug.setParent(scene);
      rug.setPosition(0.5, 0.006, 0.9);
      const mr = rug.addComponent(MeshRenderer);
      const box = builtinResMgr.get<Mesh>('box');
      if (box) mr.mesh = box;
      const mat = makePlainMaterial('#F3E2CC');
      if (mat) mr.material = mat;
      rug.setScale(2.4, 0.012, 2.4);
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
