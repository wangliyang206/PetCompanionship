/**
 * 数值配置（唯一数值真相源）
 * 所有游戏数值都从这里读取，禁止硬编码在逻辑里。
 * 改动必须同步 docs/05-AI开发执行手册.md 第 5 节。
 */

import { Stage } from './Enums';

export const GameConfig = {
  // ===== 孵化 =====
  EGG: {
    STARTER_HATCH_MIN: 1,               // 初始蛋 1 分钟（测试期临时缩短，上线前回调 15，见 docs/06 D17）
    STARTER_TOUCH_FAST_MIN: 1,          // 抚摸加速后最快 1 分钟（测试期与总时长一致）
    NORMAL_HATCH_MIN: 240,              // 所有非初始蛋统一 4 小时（不得按稀有度区分！）
    NORMAL_TOUCH_REDUCE_MAX_MIN: 60,    // 抚摸累计最多缩短 60 分钟
    INCUBATION_SLOTS: 1,                // 同时只能孵 1 颗（硬阀门）
  },

  // ===== 蛋产出阀门 =====
  SUPPLY: {
    DAILY_GIFT_EGG: false,              // 每日登录只送食物不送蛋
    EGG_PITY_DAYS: 3,                   // 每 3 天登录保底 1 颗蛋
    EXPLORE_EGG_RATE: 0.4,              // 探索带回蛋概率
  },

  // ===== 成长（小时；真实时间流逝 + 陪伴值加速）=====
  GROWTH: {
    BABY_HOURS: 36,                     // 幼崽→成体 1.5 天
    ADULT_HOURS: 96,                    // 成体→完全体 4 天
    COMPANIONSHIP_SPEEDUP_MAX: 0.25,    // 陪伴值最多缩短剩余时间 25%
    COMPANIONSHIP_PER_PERCENT: 10,      // 每 10 点陪伴值 = 1% 加速
  },

  // ===== 探索（PRD 2.8.1 / 2.8.2：拖到门口派出，两档时长，可召回）=====
  EXPLORE: {
    UNLOCK_STAGE: Stage.Adult,          // 成体解锁探索
    DURATION_SHORT: 120,                // 短途 ~2 小时（收益减半档）
    DURATION_LONG: 480,                 // 远征 ~8 小时（全额收益档）
    TRIP_SHORT_MULT: 0.5,               // 短途收益倍率
    FOOD_RATE: 0.8,                     // 带回食物概率（远征基准）
    FOOD_MIN: 1,                        // 带回食物下限
    FOOD_MAX: 3,                        // 带回食物上限
    EGG_RATE: 0.4,                      // 带回虫卵概率（远征基准）
    SEE_STORY_RATE: 1.0,                // 每次带回见闻（喂记忆系统）
    RECALL_ALLOWED: true,               // 允许中途召回
    RECALL_MIN_RATIO: 0.2,              // 召回时低于该外出比例视为空手（只带见闻）
  },

  // ===== 自主溜达（PRD 2.7.2）=====
  WANDER: {
    IDLE_MIN: 3.0,                      // 平静：停留秒数下限
    IDLE_MAX: 7.0,                      // 平静：停留秒数上限
    IDLE_HAPPY_MIN: 1.2,                // 开心：停留更短
    IDLE_HAPPY_MAX: 2.4,
    IDLE_SAD: 15.0,                     // 失落：长时间蹲角落
    MOVE_MIN: 1.2,                      // 单段移动基础秒数
    MOVE_MAX: 2.8,
    MOVE_FAST_MULT: 0.55,               // 开心小跑倍率
    MOVE_SLOW_MULT: 1.8,                // 平静踱步倍率
    RESUME_DELAY: 2.5,                  // 被互动打断后恢复漫游的延迟（秒）
    IDLE_CHANCE: 0.35,                  // 停留时主动说话的基准概率（性格会放大）
  },

  // ===== 拖动宠物（PRD 2.7.1）=====
  DRAG: {
    HOLD_MS: 300,                       // 按住超过该时长再移动 = 拖动宠物（否则算抚摸）
    LIFT_Y: 0.28,                       // 拖起时离地高度（世界单位）
    DROP_RADIUS: 110,                   // 落点判定半径（设计像素）
    REBOUND_MS: 260,                    // 落地回弹时长
    RETURN_SEC: 1.6,                    // 窝外角落自行踱回时长
    WORLD_MIN_X: -2.4,
    WORLD_MAX_X: 2.4,
    WORLD_MIN_Z: -2.6,
    WORLD_MAX_Z: 2.0,
  },

  // ===== 小窝锚点（运行时由 SceneSetup 创建空节点，纯移动/落点判定用）=====
  SCENE: {
    HOME: { x: 0.6, z: 0.8 },           // 与 Main.scene 的 PetAnchor 初始位置一致
    DOORWAY: { x: 0.2, z: -2.4 },       // 门口 / 小背包锚点（拖到这里派出探索）
    SLEEP_PAD: { x: -1.2, z: -1.0 },    // 软垫（与场景 Nest 重合）
    FOOD_BOWL: { x: -1.8, z: 1.4 },     // 食盆
    PLAY_PILE: { x: 1.8, z: 0.2 },      // 玩具堆
    CORNER: { x: -2.2, z: -1.8 },       // 窝外角落（失落蹲这里）
    WINDOW: { x: 2.2, z: -1.0 },        // 窗边
  },

  // ===== 经济 =====
  ECON: {
    DAILY_FOOD: 3,                      // 每日登录送食物
    DUPLICATE_TO_STARDUST: 20,          // 重复孵化转星尘（A 阶段）
    MISSYOU_DOUBLE_STARDUST: true,      // 今日想见你互动双倍星尘
  },

  // ===== 互动加速 =====
  INTERACT: {
    TOUCH_COMPANIONSHIP: 1,             // 抚摸 +1 陪伴值
    FEED_COMPANIONSHIP: 2,              // 喂食 +2 陪伴值
    POKE_COMPANIONSHIP: 1,              // 逗玩 +1 陪伴值
    TOUCH_EGG_REDUCE_MIN: 2,            // 摸蛋一次缩短 2 分钟
  },

  // ===== 星尘（PRD 2.9，数值可调参）=====
  STARDUST: {
    INTERACT_EARN: 1,                   // 每次抚摸/喂食/逗玩 +1
    INTERACT_DAILY_CAP: 20,             // 互动星尘每日上限（防刷）
    MISSYOU_MULTIPLIER: 2,              // 今日想见你互动双倍
    SPEEDUP_COST: 10,                   // 加速成长单价
    SPEEDUP_MINUTES: 30,                // 每 10 星尘 -30 分钟
    FOOD_COST: 5,                       // 兑换食物单价
    FOOD_PER_EXCHANGE: 1,               // 5 星尘 = 1 食物
    MILESTONE_FINAL: 30,                // 完全体达成奖励
    MILESTONE_XI_COMPLETE: 100,         // 系集齐奖励
  },

  // ===== 记忆系统 =====
  MEMORY: {
    MAX_EVENTS: 50,                     // 记忆事件最多保留条数（FIFO 淘汰）
  },

  // ===== 稀有度（破壳揭晓光效颜色）=====
  RARITY_FX: {
    Common: null as string | null,
    Rare: '#4AA3FF',                    // 蓝光
    Epic: '#B06AFF',                    // 紫光
    Legend: '#FFD34D',                  // 金光
  },

  // ===== 通知 =====
  NOTIFY: {
    MISSYOU_DAILY: true,                // 每日 1 条轮换通知，用户可关
    MISSYOU_HOUR: 19,                    // 每日"今日想见你"提醒时刻（本地 24 小时制）
    ID_HATCH: 1001,                      // 孵化完成通知 id（单孵化位，固定）
    ID_EXPLORE: 1002,                    // 探索归来通知 id 基址（按 petId 散列偏移）
    ID_FINAL: 1003,                      // 完全体达成通知 id
    ID_MISSYOU: 1004,                    // 今日想见你通知 id
    CHANNEL_ID: 'pet_events',            // Android 通知渠道 id
  },

  // ===== 存档 =====
  SAVE: {
    CURRENT_VERSION: 2,                 // 存档版本号（结构变更时 +1 并写迁移）
    KEY: 'PetCompanionship.SaveData',   // sys.localStorage key
  },
};

export type GameConfigType = typeof GameConfig;
