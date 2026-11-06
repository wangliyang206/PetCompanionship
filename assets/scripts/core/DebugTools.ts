/**
 * 调试工具（T11/T13 验收）
 * - 仅 URL 带 ?dev=1 时启用，正式包不暴露入口
 * - 快进成长：前移 stageEnteredTs 走正常成长结算
 * - 快进 1/7 天：前移所有时间戳，模拟连续多日登录（每日食物 / 3 天保底 / 探索归来）
 */

import { SaveData } from './SaveData';
import { GameSave } from './GameSave';
import { TimeService } from './TimeService';
import { EggSystem } from '../egg/EggSystem';
import { GrowthService } from '../pet/GrowthService';
import { ExploreSystem } from '../explore/ExploreSystem';
import { Economy } from '../economy/Economy';
import { MissYouService } from '../core/MissYouService';

const DAY_MS = 24 * 3600_000;

export class DebugTools {

  static get enabled(): boolean {
    return typeof location !== 'undefined' && /[?&]dev=1/.test(location.search);
  }

  /** 快进成长 N 小时（不改变真实时间，只前移阶段起点） */
  static fastForwardGrowth(save: SaveData, hours: number, petId?: string): void {
    GrowthService.debugAdvance(save, hours, petId);
    GameSave.markDirty();
  }

  /**
   * 快进 N 天：用 TimeService.debugOffsetMs 逐天推进虚拟时钟，
   * 让每日奖励 / 3 天保底 / 成长 / 探索都按真实节奏结算一次，再把写入的未来时间戳归一化回当前。
   */
  static fastForwardDays(save: SaveData, days: number): void {
    if (days <= 0) return;
    const realNow = Date.now();
    const startOffset = TimeService.debugOffsetMs;
    try {
      for (let i = 1; i <= days; i++) {
        TimeService.debugOffsetMs = startOffset + i * DAY_MS;
        EggSystem.promoteQueuedEggs(save);
        GrowthService.settleAllPets(save);
        ExploreSystem.settleAll(save);
        Economy.tryDaily(save);
        MissYouService.ensureDaily(save);
      }
    } finally {
      TimeService.debugOffsetMs = startOffset;
    }

    // 归一化：模拟期间写入的"未来时间戳"整体回拨 N 天
    const shift = days * DAY_MS;
    const normalize = (ts: number): number => (ts > realNow ? ts - shift : ts);
    save.lastSeenTs = realNow;
    save.dailyGiftTs = normalize(save.dailyGiftTs);
    save.eggPityTs = save.eggPityTs > 0 ? Math.max(0, normalize(save.eggPityTs)) : 0;
    for (const egg of save.eggs) {
      if (egg.hatchesAt > 0) egg.hatchesAt = normalize(egg.hatchesAt);
    }
    for (const pet of save.pets) {
      pet.stageEnteredTs = normalize(pet.stageEnteredTs);
      if (pet.lastInteractTs > 0) pet.lastInteractTs = normalize(pet.lastInteractTs);
      if (pet.missYouTs > 0) pet.missYouTs = normalize(pet.missYouTs);
    }
    for (const petId of Object.keys(save.exploreStates)) {
      const st = save.exploreStates[petId];
      st.startTs = normalize(st.startTs);
      st.endTs = normalize(st.endTs);
    }
    for (const ev of save.memory) ev.ts = normalize(ev.ts);

    GameSave.markDirty();
  }
}
