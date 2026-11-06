/**
 * 今日想见你（T16 反歧视机制）
 * - 每天随机选 1 只已拥有宠物作为"今日想见你"，不按稀有度加权
 * - 与它互动星尘双倍（Economy 读取 pet.missYouTs）
 * - 每日只选一次；离线跨天启动时补选
 */

import { PetState, SaveData } from '../core/SaveData';
import { TimeService } from '../core/TimeService';
import { Events, EventName } from '../core/Events';
import { MemoryEventType } from '../core/Enums';
import { PetMemory } from '../pet/PetMemory';

export class MissYouService {

  /**
   * 保证今天已选出"想见你"的宠物；已选过则原样返回。
   * 候选池 = 当前已拥有的全部宠物（无稀有度权重）。
   */
  static ensureDaily(save: SaveData): string | null {
    if (save.pets.length === 0) return null;
    const today = TimeService.todayMidnight();

    const picked = save.pets.find(p => p.missYouTs > 0 && TimeService.midnightOf(p.missYouTs) === today);
    if (picked) return picked.id;

    const target = save.pets[Math.floor(Math.random() * save.pets.length)];
    target.missYouTs = today;
    PetMemory.add(save, MemoryEventType.Milestone, 'missyou:' + target.id);
    Events.emit(EventName.MissYouToday, target.id);
    return target.id;
  }

  /** 该宠物是否是今天的"想见你" */
  static isMissYouToday(pet: PetState): boolean {
    if (pet.missYouTs <= 0) return false;
    return TimeService.midnightOf(pet.missYouTs) === TimeService.todayMidnight();
  }

  /** 当前"想见你"的宠物（UI 标记用） */
  static current(save: SaveData): PetState | null {
    return save.pets.find(p => this.isMissYouToday(p)) ?? null;
  }
}
