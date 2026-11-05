/**
 * 本地通知桥（T17）
 * - TS 侧唯一入口：订阅游戏事件 → 调度 Android 本地通知（App 关闭也能到时提醒）
 * - 原生侧：com.petcomp.game.notify.PetNotificationBridge（AlarmManager + NotificationChannel）
 * - 编辑器 / Web / 未注入原生代码时静默降级（只打日志，不影响游戏逻辑）
 *
 * 文案铁律：任何通知都不得出现物种名与稀有度（docs/03 7.4）。
 */

import { sys } from 'cc';
import { SaveData, EggState } from '../core/SaveData';
import { GameConfig } from '../core/GameConfig';
import { Events, EventName } from '../core/Events';
import { Stage } from '../core/Enums';
import { TimeService } from '../core/TimeService';
import { getSpecies } from '../pet/PetDefs';

/** 原生桥类名（Java） */
const ANDROID_BRIDGE = 'com.petcomp.game.notify.PetNotificationBridge';

/** 通知文案（宠物口吻；不得泄露稀有度） */
const COPY = {
  HATCH_TITLE: '小窝里有点动静',
  HATCH_BODY: '壳、壳在动！！快来快来！',
  EXPLORE_TITLE: '出门的家伙回来了',
  EXPLORE_BODY: '我回来啦！好像带了点什么给你诶！',
  FINAL_TITLE: '它长大了',
  FINAL_BODY: '我长大啦！以后的以后也要在一起哦。',
  MISSYOU_BODY: '今天……可以来见我一下吗？',
};

export class NotifierBridge {

  private static _attached = false;
  private static _save: SaveData | null = null;

  /** 原生调用是否可用（编辑器 / Web 下为 false） */
  static get nativeAvailable(): boolean {
    const jsb = (globalThis as { jsb?: { reflection?: unknown } }).jsb;
    return !!(sys.isNative && jsb && jsb.reflection);
  }

  /** 注册事件监听 + 按存档重排全部待触发通知（App 启动时调用一次） */
  static attach(save: SaveData): void {
    this._save = save;
    if (this._attached) {
      this.resync(save);
      return;
    }
    this._attached = true;

    Events.on(EventName.EggAdded, (egg) => this.onEggScheduled(egg as EggState));
    Events.on(EventName.EggIncubationStarted, (egg) => this.onEggScheduled(egg as EggState));
    Events.on(EventName.EggBrokenShell, () => this.cancel(GameConfig.NOTIFY.ID_HATCH));
    Events.on(EventName.ExploreDispatched, (petId, endTs) =>
      this.onExploreDispatched(petId as string, endTs as number));
    Events.on(EventName.ExploreReturned, (petId) =>
      this.cancel(this.exploreNotifyId(petId as string)));
    Events.on(EventName.PetStageChanged, (petId, stage) =>
      this.onStageChanged(petId as string, stage as Stage));

    this.resync(save);
  }

  /** 请求通知权限（Android 13+；其它版本自动视为已授权） */
  static requestPermission(): void {
    this.call('requestPermission', '()V');
  }

  /** 是否已获得通知权限 */
  static hasPermission(): boolean {
    return this.call('hasPermission', '()Z') === true;
  }

  /** 取消全部通知（用户关闭通知 / 重置存档） */
  static cancelAll(): void {
    this.call('cancelAll', '()V');
  }

  /** 按当前存档重排通知：孵化倒计时、探索归来、每日"今日想见你" */
  static resync(save: SaveData): void {
    this._save = save;
    this.cancelAll();
    const now = TimeService.safeNow(save.lastSeenTs);

    for (const egg of save.eggs) {
      if (egg.incubating && egg.hatchesAt > now) {
        this.schedule(GameConfig.NOTIFY.ID_HATCH, COPY.HATCH_TITLE, COPY.HATCH_BODY, egg.hatchesAt);
        break; // 单孵化位
      }
    }

    for (const petId of Object.keys(save.exploreStates)) {
      const state = save.exploreStates[petId];
      if (!state.returned && state.endTs > now) {
        this.schedule(this.exploreNotifyId(petId), COPY.EXPLORE_TITLE, COPY.EXPLORE_BODY, state.endTs);
      }
    }

    this.scheduleMissYou(save, now);
  }

  // ===== 事件处理 =====

  private static onEggScheduled(egg: EggState): void {
    if (!egg.incubating || egg.hatchesAt <= 0) return; // 窝边排队的蛋不提醒
    this.schedule(GameConfig.NOTIFY.ID_HATCH, COPY.HATCH_TITLE, COPY.HATCH_BODY, egg.hatchesAt);
  }

  private static onExploreDispatched(petId: string, endTs: number): void {
    this.schedule(this.exploreNotifyId(petId), COPY.EXPLORE_TITLE, COPY.EXPLORE_BODY, endTs);
  }

  private static onStageChanged(petId: string, stage: Stage): void {
    if (stage !== Stage.Final) return;
    const pet = this._save?.pets.find(p => p.id === petId);
    const species = pet ? getSpecies(pet.speciesId) : undefined;
    const title = species ? `${species.name}长大了` : COPY.FINAL_TITLE;
    this.schedule(GameConfig.NOTIFY.ID_FINAL, title, COPY.FINAL_BODY, TimeService.now());
  }

  /** 每日"今日想见你"：按日轮换一只，用户可关 */
  private static scheduleMissYou(save: SaveData, now: number): void {
    if (!GameConfig.NOTIFY.MISSYOU_DAILY) return;
    if (!save.notificationPrefs?.dailyMissYou) return;
    if (save.pets.length === 0) return;

    const dayIndex = Math.floor(TimeService.midnightOf(now) / 86_400_000);
    const pet = save.pets[dayIndex % save.pets.length];
    const species = getSpecies(pet.speciesId);
    const title = `${species ? species.name : '小家伙'}在等你`;
    this.schedule(GameConfig.NOTIFY.ID_MISSYOU, title, COPY.MISSYOU_BODY, this.nextMissYouTs(now));
  }

  /** 下一个 MISSYOU_HOUR 时刻 */
  private static nextMissYouTs(now: number): number {
    const d = new Date(now);
    d.setHours(GameConfig.NOTIFY.MISSYOU_HOUR, 0, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  // ===== 原生调用 =====

  /** 探索通知 id：petId 稳定散列，保证调度与取消一致 */
  private static exploreNotifyId(petId: string): number {
    let h = 0;
    for (let i = 0; i < petId.length; i++) {
      h = (h * 31 + petId.charCodeAt(i)) % 90;
    }
    return GameConfig.NOTIFY.ID_EXPLORE + h;
  }

  private static schedule(id: number, title: string, body: string, atMs: number): void {
    // 时间戳以字符串传原生（避免 JSB 长整型转换差异）
    this.call('schedule', '(ILjava/lang/String;Ljava/lang/String;Ljava/lang/String;)V',
      id, title, body, String(Math.round(atMs)));
  }

  private static cancel(id: number): void {
    this.call('cancel', '(I)V', id);
  }

  private static call(method: string, signature: string, ...args: unknown[]): unknown {
    const jsb = (globalThis as { jsb?: { reflection?: { callStaticMethod: (...a: unknown[]) => unknown } } }).jsb;
    if (!sys.isNative || !jsb?.reflection) {
      console.log('[NotifierBridge] 非原生环境，跳过原生调用:', method, ...args);
      return null;
    }
    try {
      return jsb.reflection.callStaticMethod(ANDROID_BRIDGE, method, signature, ...args);
    } catch (err) {
      console.warn('[NotifierBridge] 原生调用失败:', method, err);
      return null;
    }
  }
}
