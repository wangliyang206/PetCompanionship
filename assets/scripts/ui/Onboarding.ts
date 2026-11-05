/**
 * 新手三选一引导（逻辑层）
 * - 首次启动 → 随机抽系三枚灵卵 → 拖拽到软垫 → 孵化倒计时 → 摸蛋加速教学
 * - 二次启动不触发
 */

import { SaveData } from '../core/SaveData';
import { TimeService } from '../core/TimeService';
import { Xi, EggSource } from '../core/Enums';
import { MVP_STARTER_XIS } from '../egg/EggDefs';
import { getSpeciesByXi } from '../pet/PetDefs';
import { EggSystem } from '../egg/EggSystem';
import { Events, EventName } from '../core/Events';

export class Onboarding {

  /** 是否首次启动（没有宠物没有蛋） */
  static isFirstLaunch(save: SaveData): boolean {
    return save.pets.length === 0 && save.eggs.length === 0;
  }

  /** 随机抽取 3 只候选宠物用于三选一 */
  static rollStarterOptions(): string[] {
    const result: string[] = [];
    for (const xi of MVP_STARTER_XIS) {
      const list = getSpeciesByXi(xi);
      if (list.length === 0) continue;
      const pick = list[Math.floor(Math.random() * list.length)];
      result.push(pick.id);
    }
    // MVP 只有毛虫系，就给 3 只毛虫系的
    if (result.length < 3) {
      const mao = getSpeciesByXi(Xi.Mao);
      while (result.length < 3 && mao.length > 0) {
        const idx = Math.floor(Math.random() * mao.length);
        if (!result.includes(mao[idx].id)) result.push(mao[idx].id);
        else mao.splice(idx, 1); // 去掉重复
      }
    }
    return result.slice(0, 3);
  }

  /** 玩家选定了某一只 → 生成初始蛋 */
  static pickStarter(save: SaveData, speciesId: string): boolean {
    if (!this.isFirstLaunch(save)) return false;
    EggSystem.createEgg(save, speciesId, EggSource.Starter);
    Events.emit(EventName.EggAdded, save.eggs[save.eggs.length - 1]);
    return true;
  }
}
