/**
 * 拖动宠物本体（T22）
 * - 按住宠物 ≥ HOLD_MS 后移动进入拖动（快速划动仍是抚摸，路由在 GameUI）
 * - 拖起上抬 → 跟随手指 → 放下回弹打滚
 * - 落点判定用锚点的 UI 投影：软垫/食盆/玩具堆/门口，其余视为窝外角落
 * - 漫游在拖动期间强制暂停，放下后恢复
 */

import { Camera, director, Node, Vec3 } from 'cc';
import { GameConfig } from '../core/GameConfig';
import { SceneAnchors, AnchorName } from '../core/SceneAnchors';
import { GameSave } from '../core/GameSave';
import { Collection } from '../collection/Collection';
import { PetView } from '../pet/PetView';
import { WanderSystem } from '../pet/WanderSystem';

export class DragPet {

  private _petView: PetView;
  private _cam: Camera | null = null;
  private _active = false;
  private _petId = '';
  private _startUi = { x: 0, y: 0 };
  private _startWorld = new Vec3();
  private _uiPerWorld = { x: 1, y: 1 };
  private _lastDx = 0;
  private _lastDy = 0;

  constructor(petView: PetView) {
    this._petView = petView;
  }

  get isDragging(): boolean { return this._active; }

  private get anchor(): Node {
    return this._petView.node;
  }

  private ensureCam(): Camera | null {
    if (!this._cam) {
      this._cam = director.getScene()?.getChildByName('Main Camera')?.getComponent(Camera) ?? null;
    }
    return this._cam;
  }

  /** 拖起：记录起点并上抬。返回是否成功进入拖动 */
  begin(x: number, y: number): boolean {
    const save = GameSave.data;
    const pet = save ? Collection.getActivePet(save) : undefined;
    if (!save || !pet) return false;
    const cam = this.ensureCam();
    if (!cam) return false;

    this._active = true;
    this._petId = pet.id;
    this._startUi = { x, y };
    this._startWorld = this.anchor.worldPosition.clone();
    const per = SceneAnchors.uiPerWorld(cam, this._startWorld);
    this._uiPerWorld = { x: per.x, y: per.y };
    this._lastDx = 0;
    this._lastDy = 0;

    WanderSystem.instance?.pauseForDrag();
    this.anchor.setPosition(this._startWorld.x, GameConfig.DRAG.LIFT_Y, this._startWorld.z);
    this._petView.playReaction('lift', 0.9);
    return true;
  }

  /** 跟随手指（UI 设计坐标） */
  move(x: number, y: number): void {
    if (!this._active) return;
    const dx = x - this._startUi.x;
    const dy = y - this._startUi.y;
    const cfg = GameConfig.DRAG;
    let wx = this._startWorld.x + dx / this._uiPerWorld.x;
    let wz = this._startWorld.z + dy / this._uiPerWorld.y;
    wx = Math.max(cfg.WORLD_MIN_X, Math.min(cfg.WORLD_MAX_X, wx));
    wz = Math.max(cfg.WORLD_MIN_Z, Math.min(cfg.WORLD_MAX_Z, wz));
    this.anchor.setPosition(wx, cfg.LIFT_Y, wz);

    // 方向变化较大时补一下摆动（不每帧重启补间）
    if (Math.abs(dx - this._lastDx) > 6 || Math.abs(dy - this._lastDy) > 6) {
      this._lastDx = dx;
      this._lastDy = dy;
    }
  }

  /** 放下：落地回弹 + 打滚，返回命中的锚点（null = 窝外角落） */
  end(x: number, y: number): AnchorName | null {
    if (!this._active) return null;
    this._active = false;
    const cam = this.ensureCam();
    const cfg = GameConfig.DRAG;

    this.anchor.setPosition(this.anchor.position.x, 0, this.anchor.position.z);
    this._petView.playReaction('drop', 0.55);

    const target = cam ? SceneAnchors.nearest(cam, x, y, cfg.DROP_RADIUS) : null;
    return target;
  }

  /** 放下后恢复漫游（不移动位置） */
  resumeWander(delay: number = 1.2): void {
    WanderSystem.instance?.resumeAfterDrag(delay);
  }

  /** 窝外角落：委屈回望后自行踱回原位（不惩罚） */
  walkHome(): void {
    const wander = WanderSystem.instance;
    if (!wander) return;
    wander.resumeAfterDrag(0);
    wander.moveTo(SceneAnchors.homePosition(), GameConfig.DRAG.RETURN_SEC);
  }

  /** 取消（弹窗关闭 / 中断） */
  cancel(): void {
    if (this._active) {
      this._active = false;
      this.anchor.setPosition(this.anchor.position.x, 0, this.anchor.position.z);
    }
    this.walkHome();
  }

  /** 当前拖动的宠物 id（探索派发用） */
  get petId(): string { return this._petId; }
}
