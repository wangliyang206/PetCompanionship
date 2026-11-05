/**
 * 宠物视图（占位实现）
 * - Cocos Component 的 TS 层，负责挂载模型 + 按阶段过滤动画 + 行为状态机驱动动画切换
 * - 本文件是纯逻辑层（不依赖 Cocos API），实际绑定到 Node/Animation 的 Component 将在 Cocos 工程里创建
 */

import { SaveData, PetState } from '../core/SaveData';
import { PetDefs, getSpecies } from './PetDefs';
import { Behavior, Stage } from '../core/Enums';

export class PetViewModel {

  /** 获取当前阶段可用的动画名列表（按 PetDefs 里定义） */
  static animsForStage(pet: PetState): string[] {
    const def = getSpecies(pet.speciesId);
    if (!def) return [];
    return def.anims[pet.stage] ?? [];
  }

  /** 根据行为 + 当前阶段选一个动画名播放 */
  static pickAnim(pet: PetState, behavior: Behavior): string | null {
    const anims = this.animsForStage(pet);
    if (anims.length === 0) return null;

    // 行为 → 动画名匹配（宽松，找不到 fallback idle）
    const map: Record<Behavior, string[]> = {
      [Behavior.Happy]: ['happy', 'idle'],
      [Behavior.Calm]: ['idle'],
      [Behavior.Sad]: ['sad', 'idle'],
      [Behavior.Expect]: ['idle', 'play'],
    };
    const preferred = map[behavior];
    for (const name of preferred) {
      if (anims.includes(name)) return name;
    }
    return anims[0]; // 兜底
  }

  /** 模型资源路径 */
  static modelPath(pet: PetState): string {
    const def = getSpecies(pet.speciesId);
    if (!def) return '';
    return def.models[pet.stage] ?? '';
  }
}

// void import 消除未使用
void PetDefs;
