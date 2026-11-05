/**
 * 存档相关接口定义（数据模型）
 * 严格按 docs/05-AI开发执行手册.md 第 4 节定义，不得私自改字段。
 */

import { Xi, Rarity, Stage, EggSource, MemoryEventType, EggPattern } from './Enums';

/** 存档主结构 */
export interface SaveData {
  version: number;                       // 存档版本，结构变更时 +1 并写迁移
  createdAt: number;                     // 首次启动时间戳(ms)
  lastSeenTs: number;                    // 上次退出时间戳（离线结算用）
  food: number;                          // 食物库存
  stardust: number;                      // 星尘（重复转化/互动奖励）
  dailyGiftTs: number;                   // 上次每日赠送时间（ms 时间戳）
  eggPityTs: number;                     // 上次 3 天保底蛋发放时间
  eggs: EggState[];                      // 全部蛋（含未孵化与窝边排队）
  pets: PetState[];                      // 全部已孵化宠物
  activePetId: string;                   // 当前主宠（同一时间只有主宠在场；''=空窝）
  memory: MemoryEvent[];                 // 记忆系统关键事件
  collectionFlags: Record<string, boolean>; // 图鉴/奖励/版图解锁标记
  exploreStates: Record<string, ExploreState>; // 各宠物探索状态（key=petId）
  notificationPrefs: NotificationPrefs;  // 通知偏好
}

/** 蛋状态 */
export interface EggState {
  id: string;
  speciesId: string;                     // 物种定义 id（如 mao_tuantuan）
  hatchesAt: number;                     // 孵化完成时间戳（ms）；排队中为 0
  source: EggSource;                     // 来源
  touchReduceMin: number;                // 抚摸累计缩短分钟数
  incubating: boolean;                   // true=孵化中；false=窝边排队等待孵化位
  pattern: EggPattern;                   // 蛋壳纹路（纯视觉，与稀有度无关）
}

/** 探索状态（独立字段，不塞 collectionFlags） */
export interface ExploreState {
  startTs: number;                       // 派出时间戳
  endTs: number;                         // 预计归来时间戳
  returned: boolean;                     // 是否已结算归来
}

/** 宠物状态 */
export interface PetState {
  id: string;
  speciesId: string;                     // 物种定义 id
  stage: Stage;                          // 当前阶段
  stageEnteredTs: number;                // 进入当前阶段的时间戳
  companionship: number;                 // 陪伴值（加速成长用）
  lastInteractTs: number;                // 上次互动时间
  missYouTs: number;                     // 上次被"今日想见你"选中的日期（yyyy-mm-dd）
}

/** 记忆事件 */
export interface MemoryEvent {
  ts: number;                            // 时间戳
  type: MemoryEventType;
  payload?: string;                      // 事件附带文本
}

/** 通知偏好 */
export interface NotificationPrefs {
  dailyMissYou: boolean;                 // "今日想见你"通知开关
}

/** 新建存档默认值 */
export function createDefaultSave(): SaveData {
  const now = Date.now();
  return {
    version: 2,
    createdAt: now,
    lastSeenTs: now,
    food: 0,
    stardust: 0,
    dailyGiftTs: 0,
    eggPityTs: 0,
    eggs: [],
    pets: [],
    activePetId: '',
    memory: [],
    collectionFlags: {},
    exploreStates: {},
    notificationPrefs: { dailyMissYou: true },
  };
}

// ===== 静态定义接口（为 PetDefs.ts 与 EggDefs.ts 使用）=====

export interface PetDefStatic {
  id: string;
  xi: Xi;
  name: string;
  rarity: Rarity;
  phase: 1 | 2;
  unlockLayer: 1 | 2 | 3 | 4 | 5;
  models: Partial<Record<Stage, string>>;
  anims: Partial<Record<Stage, string[]>>;
  themeColor: string;
  signature: string;
  lines: PetLines;
}

export interface PetLines {
  happy: string[];
  sad: string[];
  away: string[];
  feed: string[];
  pet: string[];
}
