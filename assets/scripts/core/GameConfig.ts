/**
 * 数值配置（唯一数值真相源）
 * 所有游戏数值都从这里读取，禁止硬编码在逻辑里。
 * 改动必须同步 docs/05-AI开发执行手册.md 第 5 节。
 */

import { Stage } from './Enums';

export const GameConfig = {
  // ===== 孵化 =====
  EGG: {
    STARTER_HATCH_MIN: 15,              // 初始蛋 15 分钟（新手三选一）
    STARTER_TOUCH_FAST_MIN: 5,          // 抚摸加速后最快 5 分钟（首次会话内破壳）
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
  },

  // ===== 探索 =====
  EXPLORE: {
    DURATION_MIN: 240,                  // 每轮最短 4 小时
    DURATION_MAX: 480,                  // 每轮最长 8 小时
    FOOD_RATE: 0.8,                     // 带回食物概率
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
  },

  // ===== 存档 =====
  SAVE: {
    CURRENT_VERSION: 1,                 // 存档版本号（结构变更时 +1 并写迁移）
    KEY: 'PetCompanionship.SaveData',   // localStorage key
  },
};

export type GameConfigType = typeof GameConfig;
