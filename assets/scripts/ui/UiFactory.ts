/**
 * 运行时 UI 构件（占位样式）
 * - 场景不含 UI 节点，表现层全部在运行时用 Graphics / Label 搭建（无需美术资源）
 * - 只提供布局与点击热区，颜色/圆角等纯视觉参数集中在这里
 */

import { Color, Graphics, Label, Layers, Node, UITransform } from 'cc';

export const UI = {
  BG: new Color(255, 246, 232, 235),
  BG_SOLID: new Color(255, 246, 232, 255),
  CARD: new Color(255, 255, 255, 255),
  WARM: new Color(217, 160, 102, 255),
  WARM_DARK: new Color(184, 130, 76, 255),
  TEXT: new Color(90, 74, 58, 255),
  TEXT_LIGHT: new Color(140, 120, 100, 255),
  SHADOW: new Color(0, 0, 0, 40),
  MASK: new Color(40, 32, 26, 170),
  RARITY_COMMON: new Color(255, 255, 255, 255),
  GOOD: new Color(122, 178, 120, 255),
  FONT: 24,
};

/** 创建一个带 UITransform 的空节点（父节点为 null 时需自行 setParent） */
export function uiNode(name: string, w = 0, h = 0): Node {
  const node = new Node(name);
  node.layer = Layers.Enum.UI_2D; // 运行时节点默认在 DEFAULT 层，UI 相机只渲染 UI_2D
  const tf = node.addComponent(UITransform);
  tf.setAnchorPoint(0.5, 0.5);
  if (w > 0 || h > 0) tf.setContentSize(w, h);
  return node;
}

/** 纯色/圆角面板（Graphics 绘制，自带点击热区） */
export function panel(name: string, w: number, h: number, color: Color, radius = 16): Node {
  const node = uiNode(name, w, h);
  const g = node.addComponent(Graphics);
  g.fillColor = color;
  g.roundRect(-w / 2, -h / 2, w, h, radius);
  g.fill();
  return node;
}

/** 文本节点（默认系统字体，Android/Web 均可渲染中文） */
export function label(
  name: string, text: string, fontSize = UI.FONT,
  color: Color = UI.TEXT, w = 0, h = 0,
): Node {
  const node = uiNode(name, w, h);
  const lb = node.addComponent(Label);
  lb.string = text;
  lb.fontSize = fontSize;
  lb.lineHeight = fontSize + 6;
  lb.color = color;
  lb.horizontalAlign = Label.HorizontalAlign.CENTER;
  lb.verticalAlign = Label.VerticalAlign.CENTER;
  lb.overflow = Label.Overflow.NONE;
  return node;
}

/** 按钮：面板 + 文本，返回节点（点击回调由调用方绑定） */
export function button(
  name: string, text: string, w: number, h: number,
  color: Color = UI.WARM, textColor: Color = new Color(255, 255, 255, 255), fontSize = UI.FONT,
): Node {
  const node = panel(name, w, h, color, Math.min(18, h / 2));
  node.name = name;
  const lb = label(name + 'Label', text, fontSize, textColor, w, h);
  lb.setParent(node);
  return node;
}

/** 圆形节点（Graphics 绘制） */
export function circle(name: string, r: number, color: Color): Node {
  const node = uiNode(name, r * 2, r * 2);
  const g = node.addComponent(Graphics);
  g.fillColor = color;
  g.circle(0, 0, r);
  g.fill();
  return node;
}

/** 重绘面板底色（尺寸变化时用） */
export function repaintPanel(node: Node, w: number, h: number, color: Color, radius = 16): void {
  const g = node.getComponent(Graphics);
  if (!g) return;
  g.clear();
  g.fillColor = color;
  g.roundRect(-w / 2, -h / 2, w, h, radius);
  g.fill();
  const tf = node.getComponent(UITransform);
  if (tf) tf.setContentSize(w, h);
}
