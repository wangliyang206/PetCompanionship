/**
 * 蛋系统
 * - 产蛋节奏阀门（3 天保底 / 探索 40% 掉率）
 * - 孵化位管理（同时只能孵 1 颗）
 * - 孵化倒计时结算
 * - 破壳揭晓（稀有度光效 → 新宠物入图鉴 / 重复转星尘）
 *
 * 铁律：
 *   - 蛋的外观/纹路/孵化时长/任何 UI/通知都不得泄露蛋内物种与稀有度
 *   - B 阶段（图鉴未集齐）：产蛋只从未拥有种类中抽；A 阶段（集齐后）：重复转星尘 20
 *   - 孵化位 = 1，硬阀门
 */

import { SaveData, EggState, PetState } from '../core/SaveData';
import { EggSource, Stage, MemoryEventType, Rarity } from '../core/Enums';
import { TimeService } from '../core/TimeService';
import { GameConfig } from '../core/GameConfig';
import { getSpecies, ALL_SPECIES } from '../pet/PetDefs';
import { PetMemory } from '../pet/PetMemory';
import { Events, EventName } from '../core/Events';

export interface HatchResult {
  pet: PetState | null;
  dupStardust: number;
  rarity: Rarity;
  speciesId: string;
}

export class EggSystem {

  /** 生成一颗蛋 */
  static createEgg(save: SaveData, speciesId: string, source: EggSource, hatchesAt?: number): EggState {
    const starter = source === EggSource.Starter;
    const hatchMs = (starter ? GameConfig.EGG.STARTER_HATCH_MIN : GameConfig.EGG.NORMAL_HATCH_MIN) * 60_000;
    const egg: EggState = {
      id: 'egg_' + Math.random().toString(36).slice(2, 10),
      speciesId,
      hatchesAt: hatchesAt ?? (TimeService.now() + hatchMs),
      source,
      touchReduceMin: 0,
    };
    save.eggs.push(egg);
    Events.emit(EventName.EggAdded, egg);
    return egg;
  }

  /** 当前孵化中蛋数量 */
  static incubatingCount(save: SaveData): number {
    const now = TimeService.now();
    return save.eggs.filter(e => e.hatchesAt > now).length;
  }

  /** 是否还能放入新蛋 */
  static canHatch(save: SaveData): boolean {
    return this.incubatingCount(save) < GameConfig.EGG.INCUBATION_SLOTS;
  }

  /**
   * 产蛋选物种（B/A 阶段自动处理）。
   * B 阶段只从未拥有种类中抽；A 阶段全池。
   */
  static rollSpecies(save: SaveData): string {
    const ownedIds = new Set(save.pets.map(p => p.speciesId));
    const unowned = ALL_SPECIES.filter(s => !ownedIds.has(s.id));
    if (unowned.length > 0) {
      return unowned[Math.floor(Math.random() * unowned.length)].id;
    }
    return ALL_SPECIES[Math.floor(Math.random() * ALL_SPECIES.length)].id;
  }

  /** 返回所有已到孵化时间的蛋 */
  static findReadyEggs(save: SaveData): EggState[] {
    const now = TimeService.now();
    return save.eggs.filter(e => e.hatchesAt <= now);
  }

  /**
   * 破壳揭晓：把蛋变成宠物（或重复转星尘）。
   */
  static hatchEgg(save: SaveData, egg: EggState): HatchResult {
    Events.emit(EventName.EggBrokenShell, egg);
    const speciesId = egg.speciesId;
    const species = getSpecies(speciesId);
    const rarity: Rarity = species ? species.rarity : Rarity.Common;

    // 从蛋列表移除
    const idx = save.eggs.indexOf(egg);
    if (idx >= 0) save.eggs.splice(idx, 1);

    // 判断是否重复
    const owned = save.pets.some(p => p.speciesId === speciesId);
    const allOwned = ALL_SPECIES.every(s => save.pets.some(p => p.speciesId === s.id));

    if (owned && allOwned) {
      // A 阶段 → 重复转星尘
      const dust = GameConfig.ECON.DUPLICATE_TO_STARDUST;
      save.stardust += dust;
      Events.emit(EventName.StardustChanged, save.stardust);
      return { pet: null, dupStardust: dust, rarity, speciesId };
    }

    // 新增宠物
    const now = TimeService.now();
    const pet: PetState = {
      id: 'pet_' + Math.random().toString(36).slice(2, 10),
      speciesId,
      stage: Stage.Baby,
      stageEnteredTs: now,
      companionship: 0,
      lastInteractTs: now,
      missYouTs: 0,
    };
    save.pets.push(pet);
    if (!save.activePetId) save.activePetId = pet.id;
    PetMemory.add(save, MemoryEventType.Milestone, 'hatch:' + speciesId);
    Events.emit(EventName.PetCollected, pet.id, speciesId);
    return { pet, dupStardust: 0, rarity, speciesId };
  }
}
