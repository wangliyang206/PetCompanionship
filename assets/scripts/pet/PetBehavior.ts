/**
 * 行为化状态机（无数值条）
 * 输入（离线时长 / 最近事件 / 当日互动量）→ 行为标签（Happy/Calm/Sad/Expect）
 * 同时负责台词选取（按事件优先级）
 *
 * 设计铁律：永远可修复无惩罚，离线仅表达 Sad。
 */

import { SaveData } from '../core/SaveData';
import { PetState } from '../core/SaveData';
import { Behavior } from '../core/Enums';
import { TimeService } from '../core/TimeService';
import { GameSave } from '../core/GameSave';
import { Events, EventName } from '../core/Events';
import { PetMemory } from './PetMemory';
import { PetDefs, getSpecies } from './PetDefs';

/** 行为状态机输入 */
export interface BehaviorInput {
  offlineHours: number;       // 离线时长（小时）
  todayInteractions: number;  // 当日互动数（抚摸+喂食+逗玩）
  recentFeedHours: number;    // 最近一次喂食距现在（小时，0 表示刚喂）
  recentPlayHours: number;    // 最近一次玩耍距现在（小时）
}

export class PetBehavior {

  /** 上次广播的行为（按 petId 记录，用于只在变化时发事件） */
  private static _last: Record<string, Behavior> = {};

  /** 根据存档 + 宠物状态计算输入 */
  static computeInput(save: SaveData, pet: PetState): BehaviorInput {
    const now = TimeService.safeNow(save.lastSeenTs);
    // 离线时长必须用"本次启动快照"：lastSeenTs 会被 30s 自动落盘刷新（D25）
    const sessionStart = GameSave.sessionStartTs > 0 ? GameSave.sessionStartTs : save.lastSeenTs;
    const offlineHours = Math.max(0, now - sessionStart) / 3600_000;

    // "今日" = 自然日：回看至今天零点
    const hoursSinceMidnight = Math.max(0, (now - TimeService.todayMidnight()) / 3600_000);
    const todayInteractions =
      PetMemory.feedCountSince(save, hoursSinceMidnight) +
      PetMemory.playCountSince(save, hoursSinceMidnight) +
      PetMemory.petCountSince(save, hoursSinceMidnight);

    // 最近一次喂食 / 玩耍距现在几小时
    const findHoursAgo = (type: string): number => {
      for (let i = save.memory.length - 1; i >= 0; i--) {
        if (save.memory[i].type === type) {
          return Math.max(0, (now - save.memory[i].ts) / 3600_000);
        }
      }
      return 999; // 从未发生过
    };

    return {
      offlineHours,
      todayInteractions,
      recentFeedHours: findHoursAgo('feeding'),
      recentPlayHours: findHoursAgo('playing'),
    };
  }

  /** 主判定：输入 → 行为标签 */
  static evaluate(input: BehaviorInput): Behavior {
    // 规则优先级（从上到下命中即返回）：

    // 1. 离线 > 24h 且还没被重新照顾 → Sad（互动 3 次后自动回暖，永远可修复）
    if (input.offlineHours > 24 && input.todayInteractions < 3) return Behavior.Sad;

    // 2. 刚互动过（今日互动 > 5 且最近 1h 内有喂食或玩耍）→ Happy
    if (input.todayInteractions > 5 && (input.recentFeedHours < 1 || input.recentPlayHours < 1)) {
      return Behavior.Happy;
    }

    // 3. 离线中等（2h~12h）→ Expect（抬头看门口等你）
    if (input.offlineHours >= 2 && input.offlineHours <= 12) {
      return Behavior.Expect;
    }

    // 4. 今日完全没互动、离线也不长 → Calm（安静蹲着）
    if (input.todayInteractions === 0 && input.offlineHours < 1) {
      return Behavior.Calm;
    }

    // 5. 今天互动很少（1~2 次）且离开了一会儿 → 轻度 Sad
    if (input.todayInteractions < 3 && input.offlineHours > 1) return Behavior.Sad;

    // 6. 默认 Calm
    return Behavior.Calm;
  }

  /**
   * 重新评估并广播行为变化（GameUI 每 30 秒调用一次）。
   * 只在标签变化时发 PetBehaviorChanged，避免重复打断动画。
   */
  static refresh(save: SaveData, pet: PetState): Behavior {
    const behavior = this.evaluate(this.computeInput(save, pet));
    if (this._last[pet.id] !== behavior) {
      this._last[pet.id] = behavior;
      Events.emit(EventName.PetBehaviorChanged, pet.id, behavior);
    }
    return behavior;
  }

  /** 当前缓存的行为标签（未评估过返回 Calm） */
  static current(petId: string): Behavior {
    return this._last[petId] ?? Behavior.Calm;
  }

  /** 宠物见到玩家回来时选一句"见面台词"（按事件优先级） */
  static pickGreetingLine(save: SaveData, pet: PetState): string {
    const species = getSpecies(pet.speciesId);
    if (!species) return '……';
    const input = this.computeInput(save, pet);

    // 优先级：离线时长 > 今日有没有互动 > 默认平静
    if (input.offlineHours > 24) {
      const arr = species.lines.away;
      return this.pickRandom(arr);
    }
    if (input.todayInteractions < 3 && input.offlineHours > 1) {
      const arr = species.lines.sad;
      return this.pickRandom(arr);
    }
    if (input.recentFeedHours < 0.5 || input.recentPlayHours < 0.5) {
      const arr = species.lines.happy;
      return this.pickRandom(arr);
    }
    // 默认：随便一句 away 或 happy
    return this.pickRandom([...species.lines.happy, ...species.lines.away]);
  }

  /** 选一句互动反馈台词（按互动类型） */
  static pickInteractLine(
    save: SaveData, pet: PetState, type: 'feed' | 'pet' | 'play',
  ): string {
    const species = getSpecies(pet.speciesId);
    if (!species) return '~';

    switch (type) {
      case 'feed': return this.pickRandom(species.lines.feed);
      case 'pet': return this.pickRandom(species.lines.pet);
      case 'play': return this.pickRandom(species.lines.happy);
    }
  }

  /** 行为标签 → 空闲台词（Sad 用 away 的"你去哪儿了呀"，Expect 用迎门句） */
  static pickIdleLine(save: SaveData, pet: PetState, behavior: Behavior): string {
    const species = getSpecies(pet.speciesId);
    if (!species) return '……';
    switch (behavior) {
      case Behavior.Sad: return this.pickRandom(species.lines.away);
      case Behavior.Expect: return this.pickRandom([...species.lines.away, ...species.lines.happy]);
      case Behavior.Happy: return this.pickRandom(species.lines.happy);
      default: return this.pickRandom(species.lines.pet);
    }
  }

  /** 清空行为缓存（切主宠 / 重开时用） */
  static reset(): void {
    this._last = {};
  }

  private static pickRandom(arr: string[]): string {
    if (!arr || arr.length === 0) return '……';
    return arr[Math.floor(Math.random() * arr.length)];
  }
}

// void import 避免未使用警告
void PetDefs;
