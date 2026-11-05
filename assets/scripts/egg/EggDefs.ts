/**
 * 蛋类型与孵化配置
 * 所有蛋外观统一、纹路随机但与稀有度无关、孵化时长不透露蛋内物种。
 */

import { EggSource, EggPattern } from '../core/Enums';

// 从 core/Enums 统一导出（枚举全局唯一定义在 core）
export { EggPattern };

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
