/**
 * 台词气泡（逻辑层）
 * - 队列管理 + 自动显示下一句
 * - UI 渲染由 Cocos Component 监听 DialogRequest 事件
 */

import { Events, EventName } from '../core/Events';

export class DialogBubble {

  static currentText: string | null = null;
  private static queue: string[] = [];

  static show(text: string): void {
    if (!text || text.trim().length === 0) return;
    this.queue.push(text);
    this.flush();
  }

  static showGreeting(text: string): void {
    this.queue.unshift(text);
    this.flush();
  }

  private static flush(): void {
    if (this.currentText) return;
    if (this.queue.length === 0) return;
    this.currentText = this.queue.shift()!;
    Events.emit(EventName.DialogRequest, this.currentText);
  }

  static next(): void {
    this.currentText = null;
    this.flush();
  }

  static clear(): void {
    this.currentText = null;
    this.queue = [];
  }
}
