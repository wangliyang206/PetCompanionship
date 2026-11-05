/**
 * 成长结算服务
 * - 真实时间流逝 + 陪伴值加速（最多缩短剩余时间 25%）
 * - 离线期间统一结算（启动时调用 settleAllPets）
 * - 阶段推进自动解锁对应动画集
 */

import { SaveData, PetState } from '../core/SaveData';
import { Stage, MemoryEventType } from '../core/Enums';
import { TimeService } from '../core/TimeService';
import { GameConfig } from '../core/GameConfig';
import { PetMemory } from '../pet/PetMemory';
import { Events, EventName } from '../core/Events';

export class GrowthService {

  /** 阶段默认时长（小时） */
  private static baseDurationHours(from: Stage): number {
    switch (from) {
      case Stage.Egg: return 0; // 蛋阶段由 EggSystem 管
      case Stage.Baby: return GameConfig.GROWTH.BABY_HOURS;
      case Stage.Adult: return GameConfig.GROWTH.ADULT_HOURS;
      case Stage.Final: return 0; // 最终阶段不再成长
      default: return 0;
    }
  }

  /** 计算陪伴值加速比例（0~MAX） */
  private static speedupRatio(pet: PetState): number {
    // 陪伴值每 10 点 = 1% 加速，封顶 MAX
    const ratio = Math.min(GameConfig.GROWTH.COMPANIONSHIP_SPEEDUP_MAX, pet.companionship / 1000);
    return ratio;
  }

  /** 阶段还剩多少毫秒才可以推进 */
  static remainingMs(pet: PetState): number {
    if (pet.stage === Stage.Final) return 0;
    const baseHours = this.baseDurationHours(pet.stage);
    if (baseHours <= 0) return 0;

    const totalMs = baseHours * 3600_000;
    const speedup = this.speedupRatio(pet);
    const effectiveMs = totalMs * (1 - speedup); // 陪伴值加速后总时长
    const elapsed = TimeService.now() - pet.stageEnteredTs;
    return Math.max(0, effectiveMs - elapsed);
  }

  /** 结算宠物成长（可能推进阶段） */
  static settlePet(save: SaveData, pet: PetState): void {
    if (pet.stage === Stage.Final) return;
    const remaining = this.remainingMs(pet);
    if (remaining <= 0) {
      this.advanceStage(save, pet);
      // 继续推进（可能一步到位进 Final）
      this.settlePet(save, pet);
    }
  }

  /** 推进到下一阶段 */
  private static advanceStage(save: SaveData, pet: PetState): void {
    const next = this.nextStage(pet.stage);
    if (!next) return;
    const oldStage = pet.stage;
    pet.stage = next;
    pet.stageEnteredTs = TimeService.now();
    pet.companionship = 0; // 陪伴值清零，新的阶段开始积累

    PetMemory.add(save, MemoryEventType.Milestone, `stage:${oldStage}->${next}`);
    Events.emit(EventName.PetStageChanged, pet.id, next);
  }

  /** 下一阶段 */
  private static nextStage(stage: Stage): Stage | null {
    switch (stage) {
      case Stage.Baby: return Stage.Adult;
      case Stage.Adult: return Stage.Final;
      default: return null;
    }
  }

  /** 离线后统一结算所有宠物 */
  static settleAllPets(save: SaveData): void {
    for (const pet of save.pets) {
      this.settlePet(save, pet);
    }
  }
}
