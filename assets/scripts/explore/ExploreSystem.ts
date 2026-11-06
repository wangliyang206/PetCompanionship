/**
 * 外出探索
 * - 成体及以上可派出
 * - 每轮 4~8 小时随机
 * - 离线结算：返回食物（80% 概率 1~3 份）、蛋（40% 概率，孵化位满则窝边排队）、见闻（必得）
 * - 探索期间该宠物不在小窝（PRD 2.8）：派出时若为主宠则自动切走/空窝，归来可归位
 *
 * 探索状态存于 SaveData.exploreStates（key=petId），不占用 collectionFlags。
 */

import { SaveData, PetState, ExploreState } from '../core/SaveData';
import { Stage, MemoryEventType, EggSource } from '../core/Enums';
import { TimeService } from '../core/TimeService';
import { GameConfig } from '../core/GameConfig';
import { PetMemory } from '../pet/PetMemory';
import { EggSystem } from '../egg/EggSystem';
import { Events, EventName } from '../core/Events';

export interface ExploreResult {
  foodGained: number;
  eggGained: boolean;
  eggQueued: boolean;      // 带回的蛋是否进入窝边等待队列（false=直接入孵）
  speciesIdIfEgg: string;
  story: string;
  recalled: boolean;       // 是否为中途召回（T12）
  multiplier: number;      // 实际收益倍率（短途 0.5 / 按外出比例折算）
}

export type ExploreKind = 'short' | 'long';

export class ExploreSystem {

  /** 检查宠物是否可以派出探索（成体以上且不在探索中） */
  static canDispatch(save: SaveData, pet: PetState): boolean {
    if (pet.stage !== Stage.Adult && pet.stage !== Stage.Final) return false;
    return !this.isExploring(save, pet.id);
  }

  /** 派出探索：short ≈2h（收益减半），long ≈8h（全额） */
  static dispatch(save: SaveData, pet: PetState, kind: ExploreKind = 'long'): ExploreState {
    const now = TimeService.safeNow(save.lastSeenTs);
    const cfg = GameConfig.EXPLORE;
    const durationMin = kind === 'short' ? cfg.DURATION_SHORT : cfg.DURATION_LONG;
    const endTs = now + durationMin * 60_000;

    const state: ExploreState = { startTs: now, endTs, returned: false };
    save.exploreStates[pet.id] = state;

    // PRD 2.8：探索期间该宠物不在小窝。若它是主宠，切换主宠或空窝。
    if (save.activePetId === pet.id) {
      const next = save.pets.find(p => p.id !== pet.id && !this.isExploring(save, p.id));
      save.activePetId = next ? next.id : '';
      Events.emit(EventName.ActivePetSwitched, save.activePetId);
    }

    Events.emit(EventName.ExploreDispatched, pet.id, endTs);
    return state;
  }

  /** 是否在探索中 */
  static isExploring(save: SaveData, petId: string): boolean {
    const data = save.exploreStates[petId];
    if (!data) return false;
    return !data.returned && TimeService.safeNow(save.lastSeenTs) < data.endTs;
  }

  /** 当前是否有宠物在探索（UI 显示召回按钮用） */
  static anyExploring(save: SaveData): boolean {
    return save.pets.some(p => this.isExploring(save, p.id));
  }

  /** 所有在探索中的宠物（召回按钮 / 结算用） */
  static exploringPets(save: SaveData): PetState[] {
    return save.pets.filter(p => this.isExploring(save, p.id));
  }

  /**
   * 中途召回（T12）：立即结算，按实际外出时长比例折算收益。
   * 外出比例低于 RECALL_MIN_RATIO 时视为空手（只带见闻）。
   */
  static recall(save: SaveData, pet: PetState): ExploreResult | null {
    if (!GameConfig.EXPLORE.RECALL_ALLOWED) return null;
    const data = save.exploreStates[pet.id];
    if (!data || data.returned) return null;
    if (!this.isExploring(save, pet.id)) return null;
    // 先记下原计划结束时间（折算比例要用），再把结束时间提前到现在
    const plannedEndTs = data.endTs;
    data.endTs = TimeService.safeNow(save.lastSeenTs);
    return this.settleReturn(save, pet, true, plannedEndTs);
  }

  /** 探索归来结算（离线结算调用；plannedEndTs 仅召回时传原计划结束时间） */
  static settleReturn(
    save: SaveData, pet: PetState, recalled: boolean = false, plannedEndTs?: number,
  ): ExploreResult | null {
    const data = save.exploreStates[pet.id];
    if (!data || data.returned) return null;
    const now = TimeService.safeNow(save.lastSeenTs);
    if (now < data.endTs) return null; // 还没到时间

    // 标记为已归来
    data.returned = true;

    // 归队：小窝空着时该宠物回主宠位
    if (!save.activePetId) {
      save.activePetId = pet.id;
      Events.emit(EventName.ActivePetSwitched, pet.id);
    }

    const cfg = GameConfig.EXPLORE;
    // 收益倍率：实际外出比例 × 短途档倍率（T12 2.8.2）
    const plannedEnd = plannedEndTs ?? data.endTs;
    const plannedMs = Math.max(1, plannedEnd - data.startTs);
    const elapsedMs = Math.max(0, now - data.startTs);
    const ratio = Math.min(1, elapsedMs / plannedMs);
    const isShort = plannedMs <= (cfg.DURATION_SHORT + cfg.DURATION_LONG) / 2 * 60_000;
    const multiplier = ratio * (isShort ? cfg.TRIP_SHORT_MULT : 1);
    const emptyHanded = recalled && ratio < cfg.RECALL_MIN_RATIO;

    // 随机掉落（按倍率折算概率与数量）
    const foodGained = emptyHanded ? 0
      : (Math.random() < cfg.FOOD_RATE * multiplier
        ? Math.max(1, Math.round(
          (cfg.FOOD_MIN + Math.floor(Math.random() * (cfg.FOOD_MAX - cfg.FOOD_MIN + 1))) * multiplier))
        : 0);
    save.food += foodGained;

    let eggGained = false;
    let eggQueued = false;
    let speciesIdIfEgg = '';
    if (!emptyHanded && Math.random() < cfg.EGG_RATE * multiplier) {
      // 蛋掉落——孵化位有空直接入孵，位满则窝边排队等待
      speciesIdIfEgg = EggSystem.rollSpecies(save);
      const egg = EggSystem.createEgg(save, speciesIdIfEgg, EggSource.Explore);
      eggGained = true;
      eggQueued = !egg.incubating;
    }

    // 见闻（必得）
    const baseStory = this.randomStory();
    const story = emptyHanded ? '刚出门就被叫回来了……这次什么也没带回来。' : baseStory;
    PetMemory.add(save, MemoryEventType.ExploreReturn, story);

    const result: ExploreResult = {
      foodGained, eggGained, eggQueued, speciesIdIfEgg, story, recalled, multiplier,
    };
    Events.emit(EventName.ExploreReturned, pet.id, result);
    Events.emit(EventName.FoodChanged, save.food);
    return result;
  }

  /** 扫描所有在探索中的宠物并结算（启动时调用） */
  static settleAll(save: SaveData): void {
    for (const pet of save.pets) {
      const data = save.exploreStates[pet.id];
      if (data && !data.returned && TimeService.safeNow(save.lastSeenTs) >= data.endTs) {
        this.settleReturn(save, pet);
      }
    }
  }

  private static randomStory(): string {
    const stories = [
      '今天在后山发现了一个特别大的树洞，里面有一只睡觉的刺猬！',
      '看到一群麻雀围成圈在啄地上的小虫子，好可爱。',
      '风特别大，差点被吹到树上去了……',
      '路边捡到了一朵奇怪的花，闻起来香香的。',
      '碰到一只特别凶的流浪猫，我赶紧躲起来了。',
      '发现了一颗特别圆的小石头，准备带给你！',
    ];
    return stories[Math.floor(Math.random() * stories.length)];
  }
}
