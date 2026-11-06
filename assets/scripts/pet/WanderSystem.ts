/**
 * 自主溜达（T23）
 * - 挂在 PetAnchor 上，按心情在小窝锚点之间随机游走（PRD 2.7.2）
 * - 心情驱动：开心小跑、平静踱步、失落蹲角落、期待去门口
 * - 任意互动立刻打断（停下 + 延迟恢复）；拖动/探索/蛋阶段不漫游
 * - 性格（T14）通过 PetPersonality 调整停留与移动节奏
 */

import {
  _decorator, Component, Node, Tween, tween, Vec3,
} from 'cc';
import { Behavior, Stage } from '../core/Enums';
import { Events, EventName } from '../core/Events';
import { GameSave } from '../core/GameSave';
import { GameConfig } from '../core/GameConfig';
import { SceneAnchors, AnchorName } from '../core/SceneAnchors';
import { Collection } from '../collection/Collection';
import { PetBehavior } from './PetBehavior';
import { PetPersonality } from './PetPersonality';
import { DialogBubble } from '../ui/DialogBubble';

const { ccclass } = _decorator;

const HAPPY_SPOTS: AnchorName[] = ['PlayPile', 'Window', 'SleepPad', 'Doorway'];
const CALM_SPOTS: AnchorName[] = ['SleepPad', 'Window', 'FoodBowl', 'PlayPile'];

@ccclass('WanderSystem')
export class WanderSystem extends Component {

  private static _inst: WanderSystem | null = null;
  static get instance(): WanderSystem | null { return this._inst; }

  private _wEnabled = false;
  private _wMoving = false;
  private _wDragging = false;
  private _wIdleLeft = 0;
  private _wResumeDelay = 0;
  private _wBehavior: Behavior = Behavior.Calm;

  onLoad(): void {
    WanderSystem._inst = this;
    Events.on(EventName.PetInteracted, this.onInteracted);
    Events.on(EventName.ActivePetSwitched, this.onSwitch);
    Events.on(EventName.PetStageChanged, this.onStageChanged);
    Events.on(EventName.PetBehaviorChanged, this.onBehaviorChanged);
  }

  onDestroy(): void {
    if (WanderSystem._inst === this) WanderSystem._inst = null;
    Events.off(EventName.PetInteracted, this.onInteracted);
    Events.off(EventName.ActivePetSwitched, this.onSwitch);
    Events.off(EventName.PetStageChanged, this.onStageChanged);
    Events.off(EventName.PetBehaviorChanged, this.onBehaviorChanged);
    Tween.stopAllByTarget(this.node);
  }

  start(): void {
    this.reset(0.8);
  }

  update(dt: number): void {
    if (!this._wEnabled || this._wDragging) return;
    if (this._wResumeDelay > 0) {
      this._wResumeDelay -= dt;
      return;
    }
    if (this._wMoving) return;
    this._wIdleLeft -= dt;
    if (this._wIdleLeft <= 0) this.pickNext();
  }

  // ===== 外部控制（DragPet 用）=====

  pauseForDrag(): void {
    Tween.stopAllByTarget(this.node);
    this._wMoving = false;
    this._wDragging = true;
  }

  /** 拖放结束后延迟恢复漫游 */
  resumeAfterDrag(delay: number): void {
    this._wDragging = false;
    this._wMoving = false;
    this._wResumeDelay = delay;
    this._wIdleLeft = delay;
    this.node.setPosition(this.node.position.x, 0, this.node.position.z);
  }

  /** 让宠物走回某个位置（拖动落在窝外角落时用） */
  moveTo(target: Vec3, duration: number = 1.6): void {
    Tween.stopAllByTarget(this.node);
    this._wMoving = true;
    this.faceTarget(target);
    this._wResumeDelay = duration;
    tween(this.node)
      .to(duration, { position: new Vec3(target.x, 0, target.z) })
      .call(() => { this._wMoving = false; })
      .start();
  }

  // ===== 主宠/阶段变化 =====

  private reset(delay: number): void {
    Tween.stopAllByTarget(this.node);
    this._wMoving = false;
    this._wDragging = false;
    const save = GameSave.data;
    const pet = save ? Collection.getActivePet(save) : undefined;
    this._wEnabled = !!pet && pet.stage !== Stage.Egg;
    this._wBehavior = this.computeBehavior();
    this._wIdleLeft = delay;
    this._wResumeDelay = 0;
    if (!this._wEnabled) {
      this.node.setPosition(SceneAnchors.homePosition());
    }
  }

  private onSwitch = (): void => this.reset(0.8);

  private onStageChanged = (petId: unknown, stage: unknown): void => {
    const save = GameSave.data;
    const pet = save ? Collection.getActivePet(save) : undefined;
    if (!pet || pet.id !== petId) return;
    if ((stage as Stage) === Stage.Egg) {
      this._wEnabled = false;
      Tween.stopAllByTarget(this.node);
      return;
    }
    this._wEnabled = true;
    this._wIdleLeft = 0.6;
  };

  private onBehaviorChanged = (petId: unknown, behavior: unknown): void => {
    const save = GameSave.data;
    const pet = save ? Collection.getActivePet(save) : undefined;
    if (!pet || pet.id !== petId) return;
    this._wBehavior = behavior as Behavior;
    if (!this._wMoving) this._wIdleLeft = Math.min(this._wIdleLeft, 0.8);
  };

  /** 任意互动打断：立刻停下，延迟后恢复 */
  private onInteracted = (): void => {
    if (!this._wEnabled || this._wDragging) return;
    Tween.stopAllByTarget(this.node);
    this.node.setPosition(this.node.position.x, 0, this.node.position.z);
    this._wMoving = false;
    this._wResumeDelay = GameConfig.WANDER.RESUME_DELAY;
    this._wIdleLeft = GameConfig.WANDER.RESUME_DELAY;
    this._wBehavior = this.computeBehavior();
  };

  // ===== 漫游决策 =====

  private computeBehavior(): Behavior {
    const save = GameSave.data;
    const pet = save ? Collection.getActivePet(save) : undefined;
    if (!save || !pet) return Behavior.Calm;
    return PetBehavior.evaluate(PetBehavior.computeInput(save, pet));
  }

  private pickNext(): void {
    const pet = GameSave.data ? Collection.getActivePet(GameSave.data) : undefined;
    if (!GameSave.data || !pet || pet.stage === Stage.Egg) {
      this._wEnabled = false;
      return;
    }
    const personality = PetPersonality.get(pet.speciesId);
    const w = GameConfig.WANDER;

    let spot: AnchorName;
    let speedMult = 1;
    let dwell = 0;
    switch (this._wBehavior) {
      case Behavior.Happy:
        spot = this.randomSpot(HAPPY_SPOTS);
        speedMult = w.MOVE_FAST_MULT;
        dwell = (w.IDLE_HAPPY_MIN + Math.random() * (w.IDLE_HAPPY_MAX - w.IDLE_HAPPY_MIN)) * personality.idleMult;
        break;
      case Behavior.Sad:
        spot = 'Corner';
        speedMult = w.MOVE_SLOW_MULT;
        dwell = w.IDLE_SAD * personality.idleMult;
        break;
      case Behavior.Expect:
        spot = 'Doorway';
        speedMult = 1;
        dwell = w.IDLE_MIN * personality.idleMult;
        break;
      default:
        spot = this.randomSpot(CALM_SPOTS);
        speedMult = w.MOVE_SLOW_MULT;
        dwell = (w.IDLE_MIN + Math.random() * (w.IDLE_MAX - w.IDLE_MIN)) * personality.idleMult;
        break;
    }

    const target = SceneAnchors.positionOf(spot) ?? SceneAnchors.homePosition();
    const from = this.node.position;
    const dist = Math.hypot(target.x - from.x, target.z - from.z);
    if (dist < 0.12) {
      this._wIdleLeft = dwell;
      this.maybeSpeak(personality.bubbleRate);
      return;
    }

    const base = w.MOVE_MIN + Math.random() * (w.MOVE_MAX - w.MOVE_MIN);
    const duration = Math.max(0.5, base * (0.6 + Math.min(1.4, dist / 2)) * speedMult * personality.moveMult);
    this.faceTarget(target);
    this._wMoving = true;
    tween(this.node)
      .to(duration, { position: new Vec3(target.x, 0, target.z) })
      .call(() => {
        this._wMoving = false;
        this._wIdleLeft = dwell;
        this.maybeSpeak(personality.bubbleRate);
      })
      .start();
  }

  private randomSpot(pool: AnchorName[]): AnchorName {
    if (pool.length === 0) return 'SleepPad';
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private faceTarget(target: Vec3): void {
    const dx = target.x - this.node.position.x;
    const dz = target.z - this.node.position.z;
    if (Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01) return;
    const deg = Math.atan2(dx, dz) * 180 / Math.PI;
    this.node.setRotationFromEuler(0, deg, 0);
  }

  /** 停留时偶尔主动说一句（阿绒概率更高，长风更低） */
  private maybeSpeak(rateMult: number): void {
    if (DialogBubble.currentText) return;
    const chance = GameConfig.WANDER.IDLE_CHANCE * rateMult;
    if (Math.random() > chance) return;
    const save = GameSave.data;
    const pet = save ? Collection.getActivePet(save) : undefined;
    if (!save || !pet) return;
    const line = PetBehavior.pickIdleLine(save, pet, this._wBehavior);
    if (line) DialogBubble.show(line);
  }
}
