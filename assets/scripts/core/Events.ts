/**
 * 全局事件总线
 * 所有跨模块通信走这里，禁止模块间直接持有引用（PetView 除外）。
 */

type Listener = (...args: unknown[]) => void;

export class Events {
  private static listeners: Map<string, Set<Listener>> = new Map();

  /** 订阅事件 */
  static on(event: string, handler: Listener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
  }

  /** 取消订阅 */
  static off(event: string, handler: Listener): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this.listeners.delete(event);
    }
  }

  /** 触发事件 */
  static emit(event: string, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (set) {
      // 复制一份避免迭代中被修改
      for (const h of Array.from(set)) {
        try { h(...args); }
        catch (err) { console.error(`[Events] handler error for "${event}":`, err); }
      }
    }
  }

  /** 清除所有订阅（测试 / 重开关卡时用） */
  static clear(): void {
    this.listeners.clear();
  }
}

// ===== 事件名常量（集中管理，避免魔法字符串）=====
export const EventName = {
  // 存档
  SaveLoaded: 'save:loaded',
  SaveDirty: 'save:dirty',

  // 宠物
  PetStageChanged: 'pet:stage_changed',       // 宠物阶段变化
  PetBehaviorChanged: 'pet:behavior_changed', // 行为状态变化
  PetInteracted: 'pet:interacted',           // 互动发生
  PetEmerged: 'pet:emerged',                 // 破壳

  // 蛋
  EggAdded: 'egg:added',
  EggHatched: 'egg:hatched',                 // 孵化倒计时到点
  EggBrokenShell: 'egg:broken_shell',        // 长按破壳
  EggIncubationStarted: 'egg:incubation_started', // 排队蛋入孵（孵化位空出）

  // 探索
  ExploreDispatched: 'explore:dispatched',
  ExploreReturned: 'explore:returned',

  // 经济
  FoodChanged: 'econ:food_changed',
  StardustChanged: 'econ:stardust_changed',
  DuplicateConverted: 'econ:duplicate_converted',

  // 图鉴
  PetCollected: 'collection:pet_collected',
  ActivePetSwitched: 'collection:active_switched',

  // UI
  DialogRequest: 'ui:dialog_request',
  MissYouToday: 'ui:missyou_today',
} as const;
