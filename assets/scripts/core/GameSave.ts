/**
 * 本地存档读写（JSON）
 * - 读写：sys.localStorage + JSON 序列化
 * - version 迁移骨架：当前版本与存档版本不一致时走迁移链
 * - 每次写操作后通知 Events.SaveDirty
 */

import { GameConfig } from './GameConfig';
import { SaveData, createDefaultSave } from './SaveData';
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
    // 尝试从浏览器 localStorage 读取（Cocos Creator Web 平台）
    // 真机 Android 上 sys.localStorage 实际就是 WebView localStorage
    let raw: string | null = null;
    try {
      if (typeof localStorage !== 'undefined') {
        raw = localStorage.getItem(GameConfig.SAVE.KEY);
      }
    } catch (e) {
      console.warn('[GameSave] localStorage 不可用:', e);
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
      // 更新时间戳（下线时间）
      this._data.lastSeenTs = TimeService.now();
      const json = JSON.stringify(this._data);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(GameConfig.SAVE.KEY, json);
      }
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
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(GameConfig.SAVE.KEY);
      }
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
    // 未来有新版本时，在此处补迁移逻辑：
    // if (save.version < 2) { save = migrate_v1_to_v2(save); }
    save.version = targetVer;
    return save;
  }
}
