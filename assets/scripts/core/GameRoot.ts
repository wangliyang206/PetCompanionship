/**
 * 启动编排（M4 接入点）
 * 读档 → 离线结算（排队蛋补位 / 成长 / 探索 / 每日奖励）→ 注册通知与小组件桥
 *
 * 自举方式：Main.scene 当前没有挂任何入口组件，主包脚本在场景加载前会被预导入
 * （`virtual:///prerequisite-imports/main`），因此本文件在模块加载时挂载引擎生命周期回调，
 * 保证 GameRoot 被调用一次；bootstrap 自带幂等守卫，未来挂入口组件重复调用也安全。
 */

import { director, Director, game, Game } from 'cc';
import { SceneSetup } from './SceneSetup';
import { SaveData } from './SaveData';
import { GameSave } from './GameSave';
import { EggSystem } from '../egg/EggSystem';
import { GrowthService } from '../pet/GrowthService';
import { ExploreSystem } from '../explore/ExploreSystem';
import { Economy } from '../economy/Economy';
import { NotifierBridge } from '../notify/NotifierBridge';
import { WidgetBridge } from '../widget/WidgetBridge';

export class GameRoot {

  private static _save: SaveData | null = null;
  private static _booted = false;
  private static _autosaveTimer: ReturnType<typeof setInterval> | null = null;

  /** 当前存档（未 bootstrap 前为 null） */
  static get save(): SaveData | null { return this._save; }

  /** 是否已完成启动编排 */
  static get booted(): boolean { return this._booted; }

  /** 启动：读档 + 离线结算 + 桥接注册（幂等） */
  static bootstrap(): SaveData {
    if (this._booted && this._save) return this._save;
    this._booted = true;

    const save = GameSave.load();

    // 先挂事件监听，再离线结算：完全体/破壳/探索归来等事件在结算期间发出，
    // 若监听晚于结算会永久丢失（P2-8）
    NotifierBridge.attach(save);
    WidgetBridge.attach(save);
    if (NotifierBridge.nativeAvailable && !NotifierBridge.hasPermission()) {
      NotifierBridge.requestPermission();
    }

    // 离线结算顺序：先补位孵化（会产生新的倒计时），再结算成长与探索，最后发每日奖励
    EggSystem.promoteQueuedEggs(save);
    GrowthService.settleAllPets(save);
    ExploreSystem.settleAll(save);
    Economy.tryDaily(save);

    GameSave.markDirty();
    this._save = save;
    this.startAutosave();
    SceneSetup.setup();
    return save;
  }

  /** 定时落盘：进程被系统杀掉（非 EVENT_HIDE）时不丢进度 */
  private static startAutosave(): void {
    if (this._autosaveTimer) return;
    this._autosaveTimer = setInterval(() => {
      GameSave.flush();
    }, 30_000);
  }

  /** 回到前台：补结算并刷新通知/组件 */
  static resume(): void {
    const save = this._save;
    if (!save) return;
    // 先按旧存档重排（清掉过期闹钟），再结算：结算期间发出的完全体事件不会被随后的重排取消
    NotifierBridge.resync(save);
    EggSystem.promoteQueuedEggs(save);
    GrowthService.settleAllPets(save);
    ExploreSystem.settleAll(save);
    WidgetBridge.refresh();
    GameSave.flush();
  }

  /** 切后台/退出：落盘 */
  static flush(): void {
    GameSave.flush();
  }
}

// ===== 模块级自举（见文件头说明）=====
const launch = (tag: string): void => {
  GameRoot.bootstrap();
  console.log(`[GameRoot] 启动编排完成（${tag}）`);
};

director.once(Director.EVENT_AFTER_SCENE_LAUNCH, () => launch('scene-launch'));

// 兜底：若脚本是在场景已运行后才被导入（编辑器预览 / 热重载），场景启动事件不会再触发，
// 延迟一拍检查并直接启动一次（bootstrap 幂等）。
setTimeout(() => {
  if (!GameRoot.booted && director.getScene()) launch('late-import');
}, 0);

game.on(Game.EVENT_HIDE, () => {
  GameRoot.flush();
});

game.on(Game.EVENT_SHOW, () => {
  GameRoot.resume();
});
