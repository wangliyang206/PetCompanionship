/**
 * 抚摸手势
 * - 手指在宠物身上划动触发
 * - 每次抚摸 +1 陪伴值 + 记录 MemoryEventType.Pet（抚摸专属，不污染喂食记忆）
 *
 * 离线时间较长时第一次抚摸有"你终于理我了"的反馈
 */

import { SaveData, PetState } from '../core/SaveData';
import { MemoryEventType } from '../core/Enums';
import { TimeService } from '../core/TimeService';
import { PetMemory } from '../pet/PetMemory';
import { GameConfig } from '../core/GameConfig';
import { Events, EventName } from '../core/Events';
import { Economy } from '../economy/Economy';

export class TouchPet {

  static perform(save: SaveData, pet: PetState): number {
    const delta = GameConfig.INTERACT.TOUCH_COMPANIONSHIP;
    pet.companionship += delta;
    pet.lastInteractTs = TimeService.safeNow(save.lastSeenTs);
    PetMemory.add(save, MemoryEventType.Pet);
    Economy.awardInteractStardust(save, pet);
    Events.emit(EventName.PetInteracted, pet.id, 'pet');
    return delta;
  }

  static hitTest(_x: number, _y: number): boolean {
    return true; // 占位
  }
}
