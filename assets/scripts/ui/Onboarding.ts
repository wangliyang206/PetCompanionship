/**
 * 新手三选一引导（逻辑层）
 * - 首次启动 → 随机抽系三枚灵卵 → 拖拽到软垫 → 孵化倒计时 → 摸蛋加速教学
 * - 二次启动不触发
 */

import { SaveData } from '../core/SaveData';
import { EggSource } from '../core/Enums';
import { MVP_SPECIES } from '../pet/PetDefs';
import { EggSystem } from '../egg/EggSystem';
import { Events, EventName } from '../core/Events';

export class Onboarding {

  /** 是否首次启动（没有宠物没有蛋） */
  static isFirstLaunch(save: SaveData): boolean {
    return save.pets.length === 0 && save.eggs.length === 0;
  }

  /** 随机抽取 3 只候选宠物用于三选一（只从 MVP 实装池抽，不含占位） */
  static rollStarterOptions(): string[] {
    const pool = [...MVP_SPECIES];
    const result: string[] = [];
    while (result.length < 3 && pool.length > 0) {
      const idx = Math.floor(Math.random() * pool.length);
      result.push(pool[idx].id);
      pool.splice(idx, 1); // 三选一不重复
    }
    return result;
  }

  /** 玩家选定了某一只 → 生成初始蛋 */
  static pickStarter(save: SaveData, speciesId: string): boolean {
    if (!this.isFirstLaunch(save)) return false;
    EggSystem.createEgg(save, speciesId, EggSource.Starter);
    Events.emit(EventName.EggAdded, save.eggs[save.eggs.length - 1]);
    return true;
  }
}
