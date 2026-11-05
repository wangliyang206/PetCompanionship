/**
 * 全局枚举定义
 * 所有模块共用，禁止在各文件中重复定义。
 */

/** 五系：毛虫 / 羽虫 / 鳞虫 / 介虫 / 倮虫 */
export enum Xi {
  Mao = 'mao',
  Yu = 'yu',
  Lin = 'lin',
  Jie = 'jie',
  Luo = 'luo',
}

/** 稀有度 */
export enum Rarity {
  Common = 'common',
  Rare = 'rare',
  Epic = 'epic',
  Legend = 'legend',
}

/** 成长阶段 */
export enum Stage {
  Egg = 'egg',
  Baby = 'baby',
  Adult = 'adult',
  Final = 'final',
}

/** 行为化状态（无数值条） */
export enum Behavior {
  Happy = 'happy',
  Calm = 'calm',
  Sad = 'sad',
  Expect = 'expect',
}

/** 蛋来源 */
export enum EggSource {
  Starter = 'starter',   // 新手三选一
  Daily = 'daily',       // 每日保底（3 天一次）
  Explore = 'explore',   // 探索带回
  Trial = 'trial',       // 终局试炼
}

/** 记忆事件类型 */
export enum MemoryEventType {
  Feeding = 'feeding',
  Playing = 'playing',
  ExploreReturn = 'explore_return',
  Milestone = 'milestone',
  Away = 'away',
  MissYou = 'missyou',
}
