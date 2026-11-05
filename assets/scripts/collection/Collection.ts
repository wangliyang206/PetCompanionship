/**
 * 图鉴 / 主宠切换 / 系集齐奖励
 * - 图鉴状态：已拥有 / 未拥有（剪影"？？？"）/ 完全体标记
 * - 主宠切换：修改 activePetId 并通知事件
 * - 系集齐奖励：某系所有已实装阶段宠物全部完全体时发放标记
 */

import { SaveData, PetState } from '../core/SaveData';
import { Stage } from '../core/Enums';
import { GameConfig } from '../core/GameConfig';
import { PetDefs, getSpeciesByXi, ALL_SPECIES, getSpecies } from '../pet/PetDefs';
import { ExploreSystem } from '../explore/ExploreSystem';
import { Events, EventName } from '../core/Events';

export class Collection {

  /** 获取图鉴网格数据 */
  static getGrid(save: SaveData): GridEntry[] {
    return ALL_SPECIES.map(species => {
      const owned = save.pets.find(p => p.speciesId === species.id);
      return {
        species,
        owned: !!owned,
        fullyEvolved: owned ? owned.stage === Stage.Final : false,
      };
    });
  }

  /** 切换主宠（探索中的宠物不在小窝，不可切） */
  static switchActive(save: SaveData, petId: string): boolean {
    const pet = save.pets.find(p => p.id === petId);
    if (!pet) return false;
    if (ExploreSystem.isExploring(save, petId)) return false;
    save.activePetId = petId;
    Events.emit(EventName.ActivePetSwitched, petId);
    return true;
  }

  /** 获取当前主宠 state */
  static getActivePet(save: SaveData): PetState | undefined {
    return save.pets.find(p => p.id === save.activePetId);
  }

  /** 某系是否集齐所有宠物（定义层） */
  static isXiCollected(save: SaveData, xi: string): boolean {
    const list = getSpeciesByXi(xi as any);
    return list.every(s => save.pets.some(p => p.speciesId === s.id));
  }

  /** 某系是否全部完全体 */
  static isXiAllFinal(save: SaveData, xi: string): boolean {
    const list = getSpeciesByXi(xi as any);
    return list.every(s => {
      const pet = save.pets.find(p => p.speciesId === s.id);
      return pet && pet.stage === Stage.Final;
    });
  }

  /** 系集齐奖励是否已发过 */
  static hasXiReward(save: SaveData, xi: string): boolean {
    return !!save.collectionFlags[`reward_xi_${xi}`];
  }

  /** 发放系集齐奖励（标记 + 星尘奖励，数值见 GameConfig.STARDUST） */
  static grantXiReward(save: SaveData, xi: string): void {
    if (this.hasXiReward(save, xi)) return;
    save.collectionFlags[`reward_xi_${xi}`] = true;
    const bonus = GameConfig.STARDUST.MILESTONE_XI_COMPLETE;
    save.stardust += bonus;
    Events.emit(EventName.StardustChanged, save.stardust);
    console.log('[Collection] 系集齐奖励已发放，xi=', xi, 'stardust=', bonus);
  }

  /** 图鉴全部（五虫 25 只）是否集齐 */
  static isAllCollected(save: SaveData): boolean {
    return ALL_SPECIES.every(s => save.pets.some(p => p.speciesId === s.id));
  }

  /** 图鉴全部是否全完全体 */
  static isAllFinal(save: SaveData): boolean {
    return ALL_SPECIES.every(s => {
      const pet = save.pets.find(p => p.speciesId === s.id);
      return pet && pet.stage === Stage.Final;
    });
  }
}

export interface GridEntry {
  species: ReturnType<typeof getSpecies> extends undefined ? never : NonNullable<ReturnType<typeof getSpecies>>;
  owned: boolean;
  fullyEvolved: boolean;
}

// void 消除未使用
void PetDefs;
