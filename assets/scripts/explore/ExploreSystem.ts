/**
 * 外出探索
 * - 成体及以上可派出
 * - 每轮 4~8 小时随机
 * - 离线结算：返回食物（80% 概率）、蛋（40% 概率）、见闻（必得）
 * - 探索期间该宠物不在小窝（activePet 自动切换到另一个？MVP 先不管，探索时宠物仍在 scene 但显示"外出中"状态）
 *
 * 注：MVP 简化实现——探索只是给宠物加一个 exploreStartTs，离线结算时统一处理。
 */

import { SaveData, PetState } from '../core/SaveData';
import { Stage, MemoryEventType } from '../core/Enums';
import { TimeService } from '../core/TimeService';
import { GameConfig } from '../core/GameConfig';
import { PetMemory } from '../pet/PetMemory';
import { EggSystem } from '../egg/EggSystem';
import { EggSource } from '../core/Enums';
import { Events, EventName } from '../core/Events';

export interface ExploreData {
  startTs: number;
  endTs: number;
  returned: boolean;
}

export interface ExploreResult {
  foodGained: number;
  eggGained: boolean;
  speciesIdIfEgg: string;
  story: string;
}

export class ExploreSystem {

  private static EXPLORE_KEY = '_explore';

  /** 检查宠物是否可以派出探索 */
  static canDispatch(pet: PetState): boolean {
    return pet.stage === Stage.Adult || pet.stage === Stage.Final;
  }

  /** 派出探索 */
  static dispatch(save: SaveData, pet: PetState): ExploreData {
    const now = TimeService.now();
    const durationMin = GameConfig.EXPLORE.DURATION_MIN +
      Math.floor(Math.random() * (GameConfig.EXPLORE.DURATION_MAX - GameConfig.EXPLORE.DURATION_MIN));
    const endTs = now + durationMin * 60_000;

    // 把探索数据挂到 collectionFlags（简单持久化）
    save.collectionFlags[`explore_${pet.id}`] = JSON.stringify({
      startTs: now, endTs, returned: false,
    });

    Events.emit(EventName.ExploreDispatched, pet.id, endTs);
    return { startTs: now, endTs, returned: false };
  }

  /** 是否在探索中 */
  static isExploring(save: SaveData, petId: string): boolean {
    const raw = save.collectionFlags[`explore_${petId}`];
    if (typeof raw !== 'string' || !raw) return false;
    const data = JSON.parse(raw) as ExploreData;
    return !data.returned && TimeService.now() < data.endTs;
  }

  /** 探索归来结算（离线结算调用） */
  static settleReturn(save: SaveData, pet: PetState): ExploreResult | null {
    const raw = save.collectionFlags[`explore_${pet.id}`];
    if (typeof raw !== 'string' || !raw) return null;
    const data = JSON.parse(raw) as ExploreData;
    if (data.returned) return null;
    if (TimeService.now() < data.endTs) return null; // 还没到时间

    // 标记为已归来
    data.returned = true;
    save.collectionFlags[`explore_${pet.id}`] = JSON.stringify(data);

    // 随机掉落
    const foodGained = Math.random() < GameConfig.EXPLORE.FOOD_RATE
      ? 1 + Math.floor(Math.random() * 3)  // 1~3 食物
      : 0;
    save.food += foodGained;

    let eggGained = false;
    let speciesIdIfEgg = '';
    if (Math.random() < GameConfig.SUPPLY.EXPLORE_EGG_RATE) {
      // 蛋掉落——需要孵化位有空
      if (EggSystem.canHatch(save)) {
        speciesIdIfEgg = EggSystem.rollSpecies(save);
        EggSystem.createEgg(save, speciesIdIfEgg, EggSource.Explore);
        eggGained = true;
      }
    }

    // 见闻（必得）
    const story = this.randomStory();
    PetMemory.add(save, MemoryEventType.ExploreReturn, story);

    const result: ExploreResult = { foodGained, eggGained, speciesIdIfEgg, story };
    Events.emit(EventName.ExploreReturned, pet.id, result);
    Events.emit(EventName.FoodChanged, save.food);
    return result;
  }

  /** 扫描所有在探索中的宠物并结算（启动时调用） */
  static settleAll(save: SaveData): void {
    for (const pet of save.pets) {
      const raw = save.collectionFlags[`explore_${pet.id}`];
      if (typeof raw === 'string' && raw) {
        const data = JSON.parse(raw) as ExploreData;
        if (!data.returned && TimeService.now() >= data.endTs) {
          this.settleReturn(save, pet);
        }
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
