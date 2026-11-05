/**
 * 食物经济 + 3 天保底蛋
 * - 每日登录送 DAILY_FOOD 食物（不送蛋）
 * - 每 3 天登录保底 1 颗蛋
 * - 所有产蛋通道都走 EggSystem.canHatch() 检查
 */

import { SaveData } from '../core/SaveData';
import { TimeService } from '../core/TimeService';
import { GameConfig } from '../core/GameConfig';
import { EggSystem } from '../egg/EggSystem';
import { EggSource, MemoryEventType } from '../core/Enums';
import { PetMemory } from '../pet/PetMemory';
import { Events, EventName } from '../core/Events';

export interface DailyResult {
  foodGained: number;
  pityEgg: boolean;
}

export class Economy {

  /** 检查并发放每日奖励 + 3 天保底蛋 */
  static tryDaily(save: SaveData): DailyResult {
    const now = TimeService.now();
    const result: DailyResult = { foodGained: 0, pityEgg: false };

    if (TimeService.shouldTriggerDailyGift(save.dailyGiftTs)) {
      save.food += GameConfig.ECON.DAILY_FOOD;
      save.dailyGiftTs = now;
      result.foodGained = GameConfig.ECON.DAILY_FOOD;
      Events.emit(EventName.FoodChanged, save.food);
    }

    if (TimeService.isPityEggDue(save.eggPityTs, GameConfig.SUPPLY.EGG_PITY_DAYS)) {
      if (EggSystem.canHatch(save)) {
        const speciesId = EggSystem.rollSpecies(save);
        EggSystem.createEgg(save, speciesId, EggSource.Daily);
        save.eggPityTs = now;
        result.pityEgg = true;
        PetMemory.add(save, MemoryEventType.Milestone, 'pity_egg');
      }
    }

    return result;
  }
}
