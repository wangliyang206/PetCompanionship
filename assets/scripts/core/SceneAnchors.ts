/**
 * 小窝锚点（T12/T22/T23）
 * - SceneSetup 运行时在场景里创建一组空节点（不新增美术资源），作为漫游目标与拖放落点
 * - 同时提供"世界坐标 → UI 坐标"的换算（与 GameUI 的宠物定位保持同一套换算）
 */

import { Camera, director, Node, Scene, Vec2, Vec3, view } from 'cc';
import { GameConfig } from './GameConfig';

export type AnchorName = 'Doorway' | 'SleepPad' | 'FoodBowl' | 'PlayPile' | 'Corner' | 'Window';

const ANCHORS: { name: AnchorName; key: keyof typeof GameConfig.SCENE }[] = [
  { name: 'Doorway', key: 'DOORWAY' },
  { name: 'SleepPad', key: 'SLEEP_PAD' },
  { name: 'FoodBowl', key: 'FOOD_BOWL' },
  { name: 'PlayPile', key: 'PLAY_PILE' },
  { name: 'Corner', key: 'CORNER' },
  { name: 'Window', key: 'WINDOW' },
];

export class SceneAnchors {

  private static _scene: Scene | null = null;

  /** 幂等地创建锚点节点（挂在场景根下，世界坐标即本地坐标） */
  static ensure(scene: Scene): void {
    this._scene = scene;
    for (const a of ANCHORS) {
      if (scene.getChildByName(a.name)) continue;
      const node = new Node(a.name);
      node.setParent(scene);
      const p = GameConfig.SCENE[a.key] as { x: number; z: number };
      node.setPosition(p.x, 0, p.z);
    }
    if (!scene.getChildByName('HomeSpot')) {
      const home = new Node('HomeSpot');
      home.setParent(scene);
      home.setPosition(GameConfig.SCENE.HOME.x, 0, GameConfig.SCENE.HOME.z);
    }
  }

  /** 当前场景（GameUI/组件里无需重复取 director.getScene） */
  static scene(): Scene | null {
    return this._scene ?? director.getScene();
  }

  static get(name: AnchorName): Node | null {
    return this.scene()?.getChildByName(name) ?? null;
  }

  static homePosition(): Vec3 {
    return new Vec3(GameConfig.SCENE.HOME.x, 0, GameConfig.SCENE.HOME.z);
  }

  static positionOf(name: AnchorName): Vec3 | null {
    const n = this.get(name);
    return n ? n.worldPosition.clone() : null;
  }

  /** 世界坐标 → UI 居中坐标（design 分辨率，和 GameUI 同一套换算） */
  static worldToUi(cam: Camera, world: Vec3, out?: Vec2): Vec2 {
    const r = out ?? new Vec2();
    const sp = cam.worldToScreen(world);
    const win = view.getVisibleSizeInPixel();
    const size = view.getVisibleSize();
    const nx = win.width > 0 ? sp.x / win.width : 0.5;
    const ny = win.height > 0 ? sp.y / win.height : 0.5;
    r.x = (nx - 0.5) * size.width;
    r.y = (ny - 0.5) * size.height;
    return r;
  }

  static uiPositionOf(cam: Camera, name: AnchorName, out?: Vec2): Vec2 | null {
    const p = this.positionOf(name);
    return p ? this.worldToUi(cam, p, out) : null;
  }

  /** 命中最近的落点（半径按设计像素） */
  static nearest(cam: Camera, x: number, y: number, radius: number): AnchorName | null {
    let best: AnchorName | null = null;
    let bestDist = radius;
    const tmp = new Vec2();
    for (const a of ANCHORS) {
      const p = this.uiPositionOf(cam, a.name, tmp);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bestDist) {
        bestDist = d;
        best = a.name;
      }
    }
    return best;
  }

  /**
   * 拖动换算：UI 像素位移 → 世界 XZ 位移。
   * 用当前位置附近投影出的"每世界单位对应多少 UI 像素"做线性近似，
   * 相机固定时足够稳定（真机手感可在 GameConfig.DRAG 里继续调）。
   */
  static uiPerWorld(cam: Camera, world: Vec3): Vec2 {
    const p0 = this.worldToUi(cam, world);
    const px = this.worldToUi(cam, new Vec3(world.x + 1, world.y, world.z));
    const pz = this.worldToUi(cam, new Vec3(world.x, world.y, world.z + 1));
    const dx = px.x - p0.x;
    const dz = pz.y - p0.y;
    return new Vec2(
      Math.abs(dx) > 0.05 ? dx : 1,
      Math.abs(dz) > 0.05 ? dz : 1,
    );
  }
}
