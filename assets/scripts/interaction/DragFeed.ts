/**
 * 拖拽喂食
 * - 从食物盘拖拽食物到宠物嘴边触发
 * - 扣除 1 食物库存 +2 陪伴值 + Feeding 记忆事件
 */

import { SaveData, PetState } from '../core/SaveData';
import { MemoryEventType } from '../core/Enums';
import { TimeService } from '../core/TimeService';
import { PetMemory } from '../pet/PetMemory';
import { GameConfig } from '../core/GameConfig';
import { Events, EventName } from '../core/Events';
import { Economy } from '../economy/Economy';

export class DragFeed {

  static perform(save: SaveData, pet: PetState, foodName: string = '小鱼干'): boolean {
    if (save.food < 1) {
      console.warn('[DragFeed] 食物不足');
      return false;
    }
    save.food -= 1;
    pet.companionship += GameConfig.INTERACT.FEED_COMPANIONSHIP;
    pet.lastInteractTs = TimeService.safeNow(save.lastSeenTs);
    PetMemory.add(save, MemoryEventType.Feeding, foodName);
    Economy.awardInteractStardust(save, pet);
    Events.emit(EventName.FoodChanged, save.food);
    Events.emit(EventName.PetInteracted, pet.id, 'feed');
    return true;
  }
}
