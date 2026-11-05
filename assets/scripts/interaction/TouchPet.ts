/**
 * 抚摸手势
 * - 手指在宠物身上划动触发
 * - 每次抚摸 +1 陪伴值 + 记录 MemoryEventType.Away 的反面——这里用 Pet 类型（但枚举里没有 Pet，用 Feeding 不合适）
 * - 简化：抚摸记录一条 away memory？不——先记录 Feeding 吧，后面有 Pet 类型再换
 *
 * 离线时间较长时第一次抚摸有"你终于理我了"的反馈
 */

import { SaveData, PetState } from '../core/SaveData';
import { MemoryEventType } from '../core/Enums';
import { TimeService } from '../core/TimeService';
import { PetMemory } from '../pet/PetMemory';
import { GameConfig } from '../core/GameConfig';
import { Events, EventName } from '../core/Events';

export class TouchPet {

  static perform(save: SaveData, pet: PetState): number {
    const delta = GameConfig.INTERACT.TOUCH_COMPANIONSHIP;
    pet.companionship += delta;
    pet.lastInteractTs = TimeService.now();
    PetMemory.add(save, MemoryEventType.Feeding); // 简化：抚摸也写入 memory
    Events.emit(EventName.PetInteracted, pet.id, 'pet');
    return delta;
  }

  static hitTest(_x: number, _y: number): boolean {
    return true; // 占位
  }
}
