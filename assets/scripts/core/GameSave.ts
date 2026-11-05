/**
 * 本地存档读写（JSON）
 * - 读写：sys.localStorage + JSON 序列化（Web/原生 JSB 环境统一走 cc sys 层）
 * - version 迁移骨架：当前版本与存档版本不一致时走迁移链
 * - 每次写操作后通知 Events.SaveDirty
 */

import { sys } from 'cc';
import { GameConfig } from './GameConfig';
import { SaveData, ExploreState, createDefaultSave } from './SaveData';
import { EggPattern } from './Enums';
import { Events, EventName } from './Events';
import { TimeService } from './TimeService';

export class GameSave {

  private static _data: SaveData | null = null;
  private static _dirty: boolean = false;
  private static _initialized: boolean = false;

  /** 当前是否已初始化（load 过） */
  static get isInitialized(): boolean { return this._initialized; }

  /** 当前内存中的存档数据（未 load 过返回 null） */
  static get data(): SaveData | null { return this._data; }

  /** 读取存档（首次启动时调用）。失败或不存在时返回新存档 */
  static load(): SaveData {
    this._initialized = true;
    let raw: string | null = null;
    try {
      raw = sys.localStorage.getItem(GameConfig.SAVE.KEY);
    } catch (e) {
      console.warn('[GameSave] sys.localStorage 不可用:', e);
    }

    if (!raw) {
      this._data = createDefaultSave();
      this.markDirty();
      console.log('[GameSave] 首次启动，已创建默认存档');
    } else {
      try {
        const parsed = JSON.parse(raw) as SaveData;
        this._data = this.migrate(parsed);
        console.log('[GameSave] 存档加载成功，version=', this._data.version);
      } catch (err) {
        console.error('[GameSave] 存档解析失败，重建存档:', err);
        this._data = createDefaultSave();
        this.markDirty();
      }
    }

    Events.emit(EventName.SaveLoaded, this._data);
    return this._data;
  }

  /** 写入存档到本地（dirty 时才真正做序列化 + 通知） */
  static flush(): void {
    if (!this._data || !this._dirty) return;
    try {
      // 更新时间戳（下线时间）；系统时间回拨时不倒退
      this._data.lastSeenTs = TimeService.safeNow(this._data.lastSeenTs);
      const json = JSON.stringify(this._data);
      sys.localStorage.setItem(GameConfig.SAVE.KEY, json);
      this._dirty = false;
      console.log('[GameSave] 存档已写入');
    } catch (err) {
      console.error('[GameSave] 写入失败:', err);
    }
  }

  /** 标记存档脏（数据改动时调用） */
  static markDirty(): void {
    this._dirty = true;
    Events.emit(EventName.SaveDirty);
  }

  /** 手动删除存档（调试 / 重置） */
  static delete(): void {
    try {
      sys.localStorage.removeItem(GameConfig.SAVE.KEY);
    } catch { /* ignore */ }
    this._data = null;
    this._dirty = false;
    this._initialized = false;
    console.log('[GameSave] 存档已删除');
  }

  // ===== 存档版本迁移 =====

  /** 迁移链（当前版本为目标） */
  private static migrate(save: SaveData): SaveData {
    const targetVer = GameConfig.SAVE.CURRENT_VERSION;
    if (save.version === targetVer) return save;
    if (save.version > targetVer) {
      console.warn('[GameSave] 存档版本高于当前代码版本，可能不兼容。version=', save.version, 'target=', targetVer);
      return save;
    }
    console.log('[GameSave] 存档迁移：', save.version, '→', targetVer);

    if (save.version < 2) {
      save = this.migrateV1toV2(save);
    }
    save.version = targetVer;
    return save;
  }

  /**
   * v1 → v2：
   * - collectionFlags 中 `explore_*` JSON 字符串项 → 独立 exploreStates 字段；
   * - collectionFlags 恢复纯 boolean；
   * - 旧蛋补 incubating=true（旧模型下蛋都在孵化中）与默认纹路；
   * - 补 exploreStates 字段。
   */
  private static migrateV1toV2(save: SaveData): SaveData {
    const legacyFlags = (save.collectionFlags ?? {}) as Record<string, unknown>;
    const flags: Record<string, boolean> = {};
    const exploreStates: Record<string, ExploreState> = save.exploreStates ?? {};

    for (const key of Object.keys(legacyFlags)) {
      const value = legacyFlags[key];
      if (key.startsWith('explore_') && typeof value === 'string') {
        try {
          exploreStates[key.slice('explore_'.length)] = JSON.parse(value) as ExploreState;
        } catch {
          console.warn('[GameSave] 迁移跳过无法解析的探索状态:', key);
        }
      } else {
        flags[key] = !!value;
      }
    }

    save.collectionFlags = flags;
    save.exploreStates = exploreStates;

    for (const egg of save.eggs ?? []) {
      if (egg.incubating === undefined) egg.incubating = true;
      if (egg.pattern === undefined) egg.pattern = EggPattern.Plain;
    }
    return save;
  }
}
