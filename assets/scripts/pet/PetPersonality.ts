/**
 * 性格化参数（T14）
 * - 模型仍用团团占位（美术未产出），先用行为节奏体现性格差异
 * - 阿绒（戏精）：停留更短、移动更快、更爱主动说话
 * - 长风（胆小）：移动更慢、久别后第一次互动先炸毛
 * - 团团 = 基准
 */

import { PetState, SaveData } from '../core/SaveData';
import { TimeService } from '../core/TimeService';

export interface PersonalityDef {
  /** 漫游停留时长倍率（越小越活跃） */
  idleMult: number;
  /** 移动时长倍率（越大越慢） */
  moveMult: number;
  /** 空闲主动说话概率倍率 */
  bubbleRate: number;
  /** 久别（>30 分钟没互动）后的首次互动台词 */
  firstResponse?: string;
}

const BASE: PersonalityDef = { idleMult: 1, moveMult: 1, bubbleRate: 1 };

const TABLE: Record<string, PersonalityDef> = {
  mao_arong: {
    idleMult: 0.55,
    moveMult: 0.75,
    bubbleRate: 1.8,
  },
  mao_changfeng: {
    idleMult: 1.4,
    moveMult: 1.6,
    bubbleRate: 0.25,
    firstResponse: '……（炸毛）谁、谁准你突然摸过来的！',
  },
};

export class PetPersonality {
  static get(speciesId: string): PersonalityDef {
    return TABLE[speciesId] ?? BASE;
  }

  /** 久别后首次互动：返回特殊台词（只对胆小型生效） */
  static firstResponse(save: SaveData, pet: PetState): string | null {
    const def = this.get(pet.speciesId);
    if (!def.firstResponse) return null;
    const now = TimeService.safeNow(save.lastSeenTs);
    if (pet.lastInteractTs <= 0) return def.firstResponse;
    const hours = (now - pet.lastInteractTs) / 3600_000;
    return hours >= 0.5 ? def.firstResponse : null;
  }
}
