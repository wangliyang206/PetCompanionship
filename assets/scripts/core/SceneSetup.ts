/**
 * 场景装配（B2/B3）：把表现层挂到 Main.scene 上
 * - PetAnchor 节点 → PetView 组件
 * - 运行时创建 Canvas + UI Camera + GameUI（场景本身不含 UI 节点，避免手写场景 JSON）
 * - 幂等：重复调用不会重复挂载
 */

import { Camera, Canvas, director, Layers, Node, ResolutionPolicy, UITransform, view } from 'cc';
import { GameSave } from '../core/GameSave';
import { PetView } from '../pet/PetView';
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
