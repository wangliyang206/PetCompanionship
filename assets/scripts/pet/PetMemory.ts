/**
 * 记忆系统
 * - 只存关键事件列表（最多保留 50 条，超出 FIFO 淘汰）
 * - 台词按事件优先级选取（离线时长 > 近期互动 > 探索）
 * - 提供"最近 X 小时喂食"、"最近探索"等查询
 */

import { SaveData } from '../core/SaveData';
import { MemoryEvent } from '../core/SaveData';
import { MemoryEventType } from '../core/Enums';
import { TimeService } from '../core/TimeService';
import { GameConfig } from '../core/GameConfig';

export class PetMemory {

  /** 添加一条事件 */
  static add(save: SaveData, type: MemoryEventType, payload?: string): void {
    const ev: MemoryEvent = { ts: TimeService.safeNow(save.lastSeenTs), type, payload };
    const max = GameConfig.MEMORY.MAX_EVENTS;
    save.memory.push(ev);
    if (save.memory.length > max) {
      save.memory = save.memory.slice(-max);
    }
  }

  /** 清空（调试 / 重置） */
  static clear(save: SaveData): void {
    save.memory = [];
  }

  /** 最近一次 Away 事件 */
  static lastAway(save: SaveData): MemoryEvent | undefined {
    for (let i = save.memory.length - 1; i >= 0; i--) {
      if (save.memory[i].type === MemoryEventType.Away) return save.memory[i];
    }
    return undefined;
  }

  /** 最近 N 小时内喂食事件数 */
  static feedCountSince(save: SaveData, hours: number): number {
    const since = TimeService.now() - hours * 3600_000;
    return save.memory.filter(m => m.type === MemoryEventType.Feeding && m.ts >= since).length;
  }

  /** 最近 N 小时内玩耍事件数 */
  static playCountSince(save: SaveData, hours: number): number {
    const since = TimeService.now() - hours * 3600_000;
    return save.memory.filter(m => m.type === MemoryEventType.Playing && m.ts >= since).length;
  }

  /** 最近 N 小时内抚摸事件数 */
  static petCountSince(save: SaveData, hours: number): number {
    const since = TimeService.now() - hours * 3600_000;
    return save.memory.filter(m => m.type === MemoryEventType.Pet && m.ts >= since).length;
  }

  /** 最近 N 小时内互动数（喂食+玩耍+抚摸） */
  static totalInteractSince(save: SaveData, hours: number): number {
    return this.feedCountSince(save, hours) + this.playCountSince(save, hours) + this.petCountSince(save, hours);
  }

  /** 最近一次探索归来事件 */
  static lastExploreStory(save: SaveData): MemoryEvent | undefined {
    for (let i = save.memory.length - 1; i >= 0; i--) {
      if (save.memory[i].type === MemoryEventType.ExploreReturn) return save.memory[i];
    }
    return undefined;
  }
}
