/**
 * 点击逗玩 + 长按破壳
 * - 点击宠物 → 逗玩 +1 陪伴值 + Playing 记忆
 * - 长按蛋 → 破壳加速（缩短孵化倒计时）
 */

import { SaveData, PetState, EggState } from '../core/SaveData';
import { MemoryEventType, EggSource, Stage } from '../core/Enums';
import { TimeService } from '../core/TimeService';
import { PetMemory } from '../pet/PetMemory';
import { GameConfig } from '../core/GameConfig';
import { Events, EventName } from '../core/Events';

export class PokePlay {

  /** 执行一次逗玩 */
  static poke(save: SaveData, pet: PetState): number {
    const delta = GameConfig.INTERACT.POKE_COMPANIONSHIP;
    pet.companionship += delta;
    pet.lastInteractTs = TimeService.now();
    PetMemory.add(save, MemoryEventType.Playing);
    Events.emit(EventName.PetInteracted, pet.id, 'play');
    return delta;
  }

  /**
   * 长按蛋破壳加速。
   * 初始蛋：每次缩短最多 STARTER_TOUCH_REDUCE_MAX_MIN 分钟。
   * 非初始蛋：每次缩短最多 NORMAL_TOUCH_REDUCE_MAX_MIN 分钟。
   * 直接修改 egg.hatchesAt（向现在靠近）。
   */
  static longPressEgg(save: SaveData, egg: EggState): number {
    const now = TimeService.now();
    const hatchMs = GameConfig.INTERACT.TOUCH_EGG_REDUCE_MIN * 60_000; // 每次缩短 2 分钟
    let reduce = hatchMs;

    // 初始蛋有最大加速
    if (egg.source === EggSource.Starter) {
      const totalReduceMs = (GameConfig.EGG.STARTER_HATCH_MIN - GameConfig.EGG.STARTER_TOUCH_FAST_MIN) * 60_000;
      const reduced = (egg.touchReduceMin || 0) * 60_000;
      const remainMs = totalReduceMs - reduced;
      reduce = Math.min(reduce, Math.max(0, remainMs));
      egg.touchReduceMin = (egg.touchReduceMin || 0) + GameConfig.INTERACT.TOUCH_EGG_REDUCE_MIN;
    } else {
      const totalMaxMs = GameConfig.EGG.NORMAL_TOUCH_REDUCE_MAX_MIN * 60_000;
      const alreadyReduced = (egg.touchReduceMin || 0) * 60_000;
      const remainMs = totalMaxMs - alreadyReduced;
      reduce = Math.min(reduce, Math.max(0, remainMs));
      egg.touchReduceMin = (egg.touchReduceMin || 0) + GameConfig.INTERACT.TOUCH_EGG_REDUCE_MIN;
    }

    const newHatchesAt = Math.max(now, egg.hatchesAt - reduce);
    egg.hatchesAt = newHatchesAt;

    // 摸蛋也算互动陪伴值（给未来孵化出的宠物）
    Events.emit(EventName.PetInteracted, 'egg:' + egg.id, 'pet');
    return reduce;
  }

  /** 蛋是否已经到孵化时间（用于倒计时结束） */
  static isEggReady(save: SaveData, egg: EggState): boolean {
    return TimeService.now() >= egg.hatchesAt;
  }

  /** 获取当前正在孵的蛋（若有） */
  static getIncubatingEgg(save: SaveData): EggState | undefined {
    // 同一时间只能孵 1 颗（GameConfig.EGG.INCUBATION_SLOTS = 1）
    return save.eggs.find(e => TimeService.now() < e.hatchesAt);
  }

  /** 长按破壳仪式：连续触摸使倒计时清零 */
  static forceHatchNow(egg: EggState): void {
    egg.hatchesAt = TimeService.now();
  }
}

// void import 消除未使用
void Stage;
