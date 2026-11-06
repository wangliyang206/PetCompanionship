/**
 * 食物经济 + 3 天保底蛋
 * - 每日登录送 DAILY_FOOD 食物（不送蛋）
 * - 每 3 天登录保底 1 颗蛋
 * - 所有产蛋通道都走 EggSystem.canHatch() 检查
 */

import { SaveData, PetState } from '../core/SaveData';
import { TimeService } from '../core/TimeService';
import { GameConfig } from '../core/GameConfig';
import { EggSystem } from '../egg/EggSystem';
import { EggSource, MemoryEventType } from '../core/Enums';
import { PetMemory } from '../pet/PetMemory';
import { MissYouService } from '../core/MissYouService';
import { Events, EventName } from '../core/Events';

export interface DailyResult {
  foodGained: number;
  pityEgg: boolean;
}

export class Economy {

  /** 检查并发放每日奖励 + 3 天保底蛋（孵化位满则蛋入窝边队列，不丢失） */
  static tryDaily(save: SaveData): DailyResult {
    const now = TimeService.safeNow(save.lastSeenTs);
    const result: DailyResult = { foodGained: 0, pityEgg: false };

    if (TimeService.shouldTriggerDailyGift(save.dailyGiftTs)) {
      save.food += GameConfig.ECON.DAILY_FOOD;
      save.dailyGiftTs = now;
      result.foodGained = GameConfig.ECON.DAILY_FOOD;
      Events.emit(EventName.FoodChanged, save.food);
    }

    if (TimeService.isPityEggDue(save.eggPityTs, GameConfig.SUPPLY.EGG_PITY_DAYS)) {
      const speciesId = EggSystem.rollSpecies(save);
      EggSystem.createEgg(save, speciesId, EggSource.Daily); // 位满自动排队
      save.eggPityTs = now;
      result.pityEgg = true;
      PetMemory.add(save, MemoryEventType.Milestone, 'pity_egg');
    }

    return result;
  }

  /**
   * 互动星尘（T13/T16）
   * - 抚摸/喂食/逗玩每次 +INTERACT_EARN
   * - 今日想见你 → ×MISSYOU_MULTIPLIER
   * - 每日互动上限 INTERACT_DAILY_CAP 次（当天记忆事件数达到上限后不再发放）
   * 注意：调用方需先写 PetMemory 再调用本方法，计数以记忆事件为准（不新增存档字段）。
   */
  static awardInteractStardust(save: SaveData, pet: PetState): number {
    const cfg = GameConfig.STARDUST;
    if (PetMemory.todayInteractCount(save) > cfg.INTERACT_DAILY_CAP) return 0;

    const double = GameConfig.ECON.MISSYOU_DOUBLE_STARDUST && MissYouService.isMissYouToday(pet);
    const gain = cfg.INTERACT_EARN * (double ? cfg.MISSYOU_MULTIPLIER : 1);
    save.stardust += gain;
    Events.emit(EventName.StardustChanged, save.stardust);
    return gain;
  }
}
