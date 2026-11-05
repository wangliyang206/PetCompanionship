/**
 * 启动编排（M4 接入点）
 * 读档 → 离线结算（排队蛋补位 / 成长 / 探索 / 每日奖励）→ 注册通知与小组件桥
 *
 * 自举方式：Main.scene 当前没有挂任何入口组件，主包脚本在场景加载前会被预导入
 * （`virtual:///prerequisite-imports/main`），因此本文件在模块加载时挂载引擎生命周期回调，
 * 保证 GameRoot 被调用一次；bootstrap 自带幂等守卫，未来挂入口组件重复调用也安全。
 */

import { director, Director, game, Game } from 'cc';
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

  /** 当前存档（未 bootstrap 前为 null） */
  static get save(): SaveData | null { return this._save; }

  /** 是否已完成启动编排 */
  static get booted(): boolean { return this._booted; }

  /** 启动：读档 + 离线结算 + 桥接注册（幂等） */
  static bootstrap(): SaveData {
    if (this._booted && this._save) return this._save;
    this._booted = true;

    const save = GameSave.load();

    // 离线结算顺序：先补位孵化（会产生新的倒计时），再结算成长与探索，最后发每日奖励
    EggSystem.promoteQueuedEggs(save);
    GrowthService.settleAllPets(save);
    ExploreSystem.settleAll(save);
    Economy.tryDaily(save);

    // 通知与桌面组件（内部按存档重排，可重复调用）
    NotifierBridge.attach(save);
    if (NotifierBridge.nativeAvailable && !NotifierBridge.hasPermission()) {
      NotifierBridge.requestPermission();
    }
    WidgetBridge.attach(save);

    GameSave.markDirty();
    this._save = save;
    return save;
  }

  /** 回到前台：补结算并刷新通知/组件 */
  static resume(): void {
    const save = this._save;
    if (!save) return;
    EggSystem.promoteQueuedEggs(save);
    GrowthService.settleAllPets(save);
    ExploreSystem.settleAll(save);
    NotifierBridge.resync(save);
    WidgetBridge.refresh();
  }

  /** 切后台/退出：落盘 */
  static flush(): void {
    GameSave.flush();
  }
}

// ===== 模块级自举（见文件头说明）=====
director.once(Director.EVENT_AFTER_SCENE_LAUNCH, () => {
  GameRoot.bootstrap();
  console.log('[GameRoot] 启动编排完成');
});

game.on(Game.EVENT_HIDE, () => {
  GameRoot.flush();
});

game.on(Game.EVENT_SHOW, () => {
  GameRoot.resume();
});
