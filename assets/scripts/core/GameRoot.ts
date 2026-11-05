/**
 * 启动编排（M4 接入点）
 * 读档 → 离线结算（排队蛋补位 / 成长 / 探索 / 每日奖励）→ 注册通知与小组件桥
 *
 * 使用方式：场景入口组件在 onLoad 调用 GameRoot.bootstrap()，在 onDestroy/暂停时调用 GameRoot.flush()。
 */

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

  /** 当前存档（未 bootstrap 前为 null） */
  static get save(): SaveData | null { return this._save; }

  /** 启动：读档 + 离线结算 + 桥接注册（幂等） */
  static bootstrap(): SaveData {
    const save = GameSave.load();

    // 离线结算顺序：先补位孵化（会产生新的倒计时），再结算成长与探索，最后发每日奖励
    EggSystem.promoteQueuedEggs(save);
    GrowthService.settleAllPets(save);
    ExploreSystem.settleAll(save);
    Economy.tryDaily(save);

    // 通知与桌面组件（内部按存档重排，可重复调用）
    NotifierBridge.attach(save);
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
