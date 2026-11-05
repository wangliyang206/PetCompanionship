/**
 * 桌面小组件桥（T18）
 * - TS 侧：计算"主宠名 + 状态文案" → 推给 Android AppWidget
 * - 原生侧：com.petcomp.game.widget.PetWidgetStore（写 SharedPreferences 并刷新所有组件实例）
 * - 触发时机：主宠切换 / 阶段变化 / 互动 / 探索派出与归来 / 新宠入图鉴
 *
 * 文案规则：不出现稀有度，不使用数字进度（行为化表达）。
 */

import { sys } from 'cc';
import { SaveData } from '../core/SaveData';
import { Behavior } from '../core/Enums';
import { Events, EventName } from '../core/Events';
import { PetBehavior } from '../pet/PetBehavior';
import { getSpecies } from '../pet/PetDefs';
import { ExploreSystem } from '../explore/ExploreSystem';

const ANDROID_WIDGET = 'com.petcomp.game.widget.PetWidgetStore';

/** 行为 → 小组件状态文案 */
const STATUS_TEXT: Record<Behavior, string> = {
  [Behavior.Happy]: '在窝里开心转圈',
  [Behavior.Calm]: '在窝里静静待着',
  [Behavior.Sad]: '有点想你了',
  [Behavior.Expect]: '在门口等你了',
};

const STATUS_EXPLORING = '出门探险中啦';
const STATUS_EMPTY = '小窝空着，等你回来';

export class WidgetBridge {

  private static _attached = false;
  private static _save: SaveData | null = null;

  static get nativeAvailable(): boolean {
    const jsb = (globalThis as { jsb?: { reflection?: unknown } }).jsb;
    return !!(sys.isNative && jsb && jsb.reflection);
  }

  /** 注册刷新时机（App 启动时调用一次） */
  static attach(save: SaveData): void {
    this._save = save;
    if (this._attached) {
      this.refresh();
      return;
    }
    this._attached = true;

    const onRefresh = (): void => this.refresh();
    Events.on(EventName.ActivePetSwitched, onRefresh);
    Events.on(EventName.PetStageChanged, onRefresh);
    Events.on(EventName.PetInteracted, onRefresh);
    Events.on(EventName.PetCollected, onRefresh);
    Events.on(EventName.ExploreDispatched, onRefresh);
    Events.on(EventName.ExploreReturned, onRefresh);

    this.refresh();
  }

  /** 重新计算并推送小组件内容 */
  static refresh(): void {
    const save = this._save;
    if (!save) return;

    const pet = save.pets.find(p => p.id === save.activePetId);
    if (!pet) {
      this.push('', STATUS_EMPTY);
      return;
    }

    const species = getSpecies(pet.speciesId);
    const name = species ? species.name : '小家伙';
    const status = ExploreSystem.isExploring(save, pet.id)
      ? STATUS_EXPLORING
      : STATUS_TEXT[PetBehavior.evaluate(PetBehavior.computeInput(save, pet))];

    this.push(name, status);
  }

  private static push(name: string, status: string): void {
    const jsb = (globalThis as { jsb?: { reflection?: { callStaticMethod: (...a: unknown[]) => unknown } } }).jsb;
    if (!sys.isNative || !jsb?.reflection) {
      console.log('[WidgetBridge] 非原生环境，跳过组件更新:', name, status);
      return;
    }
    try {
      jsb.reflection.callStaticMethod(ANDROID_WIDGET, 'update',
        '(Ljava/lang/String;Ljava/lang/String;)V', name, status);
    } catch (err) {
      console.warn('[WidgetBridge] 组件更新失败:', err);
    }
  }
}
