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

  // ===== 探索 =====
  EXPLORE: {
    DURATION_MIN: 240,                  // 每轮最短 4 小时
    DURATION_MAX: 480,                  // 每轮最长 8 小时
    FOOD_RATE: 0.8,                     // 带回食物概率
    FOOD_MIN: 1,                        // 带回食物下限
    FOOD_MAX: 3,                        // 带回食物上限
    SEE_STORY_RATE: 1.0,                // 每次带回见闻（喂记忆系统）
    UNLOCK_STAGE: Stage.Adult,          // 成体解锁探索
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
