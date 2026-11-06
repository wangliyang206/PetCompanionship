/**
 * 时间服务
 * - 离线时长计算（当前时间 - lastSeenTs）
 * - 时间戳单调校验：当前时间 < lastSeenTs 时按 lastSeenTs 处理并告警
 * - 今日零点/日期判定
 */

const _DAY_MS = 24 * 60 * 60 * 1000;

export class TimeService {

  /** 调试用虚拟时间偏移（仅 ?dev=1 快进时短暂置位，正常游戏恒为 0） */
  static debugOffsetMs = 0;

  /** 当前时间戳（ms）——统一入口，便于测试时 mock */
  static now(): number {
    return Date.now() + this.debugOffsetMs;
  }

  /**
   * 安全获取当前时间戳（防系统时间回拨）
   * 如果 now < lastSeenTs，返回 lastSeenTs 并打印告警。
   */
  static safeNow(lastSeenTs: number): number {
    const n = this.now();
    if (n < lastSeenTs) {
      console.warn('[TimeService] 检测到系统时间回拨！now=', n, 'lastSeen=', lastSeenTs, '按 lastSeenTs 处理');
      return lastSeenTs;
    }
    return n;
  }

  /** 离线时长（ms），最小为 0 */
  static offlineMsSince(lastSeenTs: number): number {
    const n = this.now();
    return Math.max(0, n - lastSeenTs);
  }

  /** 离线时长（小时） */
  static offlineHoursSince(lastSeenTs: number): number {
    return this.offlineMsSince(lastSeenTs) / (_DAY_MS / 24);
  }

  /** 离线时长（天） */
  static offlineDaysSince(lastSeenTs: number): number {
    return this.offlineMsSince(lastSeenTs) / _DAY_MS;
  }

  /** 返回给定时间戳的当日零点时间戳（本地时区） */
  static midnightOf(ts: number): number {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /** 今天零点 */
  static todayMidnight(): number {
    return this.midnightOf(this.now());
  }

  /** 明天零点 */
  static tomorrowMidnight(): number {
    return this.todayMidnight() + _DAY_MS;
  }

  /** 判断两个时间戳是否在同一天（本地时区） */
  static isSameDay(a: number, b: number): boolean {
    return this.midnightOf(a) === this.midnightOf(b);
  }

  /** 计算距下次"每日刷新"还剩多少毫秒 */
  static msUntilNextDay(): number {
    return this.tomorrowMidnight() - this.now();
  }

  /** 判断是否应该触发每日赠送（dailyGiftTs 不是今天） */
  static shouldTriggerDailyGift(dailyGiftTs: number): boolean {
    return !this.isSameDay(dailyGiftTs, this.now());
  }

  /** 判断是否满足 3 天保底蛋（距上次蛋发放 >= pityDays 天） */
  static isPityEggDue(eggPityTs: number, pityDays: number): boolean {
    if (eggPityTs === 0) return true;
    const days = this.offlineDaysSince(eggPityTs);
    return days >= pityDays;
  }

  /** 格式化时间戳为 yyyy-mm-dd（本地时区） */
  static toDateString(ts: number): string {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
