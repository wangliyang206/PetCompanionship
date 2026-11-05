/**
 * 蛋类型与孵化配置
 * 所有蛋外观统一、纹路随机但与稀有度无关、孵化时长不透露蛋内物种。
 */

import { Xi, Rarity, EggSource } from '../core/Enums';

/** 蛋纹路类型（纯视觉，与稀有度无关） */
export enum EggPattern {
  Plain = 'plain',
  Swirl = 'swirl',
  Dots = 'dots',
  Zigzag = 'zigzag',
  Star = 'star',
}

/** 纹路数组（随机选取，完全不关联蛋内物种） */
export const ALL_PATTERNS: EggPattern[] = [
  EggPattern.Plain, EggPattern.Swirl, EggPattern.Dots, EggPattern.Zigzag, EggPattern.Star,
];

/** 随机取一个纹路 */
export function randomPattern(): EggPattern {
  return ALL_PATTERNS[Math.floor(Math.random() * ALL_PATTERNS.length)];
}

/** 判断是否初始蛋 */
export function isStarter(source: EggSource): boolean {
  return source === EggSource.Starter;
}

/** MVP 毛虫系三选一候选系（实际只从毛虫系抽） */
export const MVP_STARTER_XIS: Xi[] = [Xi.Mao];
