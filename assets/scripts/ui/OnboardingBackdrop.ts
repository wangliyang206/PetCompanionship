/**
 * 新手三选一背景（纯 Graphics 绘制）
 * - 深空渐变 + 星云 + 极光 + 星野 + 星座 + 浮尘
 * - 底部雾带与暗角负责压住画面，避免出现「一块平板」的廉价感
 * - 不依赖任何贴图，Web / Android 表现一致
 */

import { Color, Graphics, Node, tween, UIOpacity } from 'cc';
import { uiNode } from './UiFactory';

const rgbCache: Record<string, [number, number, number]> = {};

function rgb(hex: string): [number, number, number] {
  const hit = rgbCache[hex];
  if (hit) return hit;
  const h = hex.replace('#', '');
  const v: [number, number, number] = [
    parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16),
  ];
  rgbCache[hex] = v;
  return v;
}

function col(hex: string, a = 255): Color {
  const v = rgb(hex);
  return new Color(v[0], v[1], v[2], a);
}

function mix(h1: string, h2: string, t: number): string {
  const a = rgb(h1), b = rgb(h2);
  const to = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${to(a[0] + (b[0] - a[0]) * t)}${to(a[1] + (b[1] - a[1]) * t)}${to(a[2] + (b[2] - a[2]) * t)}`;
}

function ell(g: Graphics, x: number, y: number, rx: number, ry: number, c: Color): void {
  if (rx <= 0 || ry <= 0) return;
  g.fillColor = c;
  g.ellipse(x, y, rx, ry);
  g.fill();
}

function circle(g: Graphics, x: number, y: number, r: number, c: Color): void {
  if (r <= 0) return;
  g.fillColor = c;
  g.circle(x, y, r);
  g.fill();
}

function polyline(g: Graphics, pts: number[][], c: Color, w: number): void {
  if (pts.length < 2) return;
  g.lineWidth = w;
  g.strokeColor = c;
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.stroke();
}

function ellipseStroke(g: Graphics, cx: number, cy: number, rx: number, ry: number, c: Color, w: number, seg = 48): void {
  if (rx <= 0 || ry <= 0) return;
  g.lineWidth = w;
  g.strokeColor = c;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
}

function star4(g: Graphics, x: number, y: number, s: number, hex: string, a: number): void {
  g.fillColor = col(hex, a);
  g.moveTo(x, y + s);
  g.quadraticCurveTo(x + s * 0.15, y + s * 0.15, x + s, y);
  g.quadraticCurveTo(x + s * 0.15, y - s * 0.15, x, y - s);
  g.quadraticCurveTo(x - s * 0.15, y - s * 0.15, x - s, y);
  g.quadraticCurveTo(x - s * 0.15, y + s * 0.15, x, y + s);
  g.close();
  g.fill();
}

function makeRnd(seed: number): () => number {
  let s = seed || 1;
  return (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export function createOnboardingBackdrop(w: number, h: number): Node {
  const root = uiNode('OnboardBg', w, h);

  const base = uiNode('BgBase', w, h);
  base.setParent(root);
  drawBase(base.addComponent(Graphics), w, h);

  const sky = uiNode('BgSky', w, h);
  sky.setParent(root);
  drawSky(sky.addComponent(Graphics), w, h);

  const veil = uiNode('BgVeil', w, h);
  veil.setParent(root);
  drawVeil(veil.addComponent(Graphics), w, h);

  // 星野极缓慢呼吸，避免整屏像一张静态图
  const skyOp = sky.addComponent(UIOpacity);
  skyOp.opacity = 255;
  tween(skyOp).repeatForever(tween(skyOp).to(5.5, { opacity: 226 }).to(5.5, { opacity: 255 })).start();

  return root;
}

/** 底色：纵向渐变 + 星云 + 蛋群暖光 */
function drawBase(g: Graphics, w: number, h: number): void {
  const stops: Array<[number, string]> = [
    [0, '#03060C'], [0.18, '#07101D'], [0.42, '#0D192B'],
    [0.64, '#132137'], [0.83, '#0C1727'], [1, '#04070D'],
  ];
  const band = 10;
  for (let y = -h / 2; y < h / 2; y += band) {
    const t = (y + h / 2) / h;
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
    const p = Math.max(0, Math.min(1, (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0])));
    g.fillColor = col(mix(stops[i][1], stops[i + 1][1], p));
    g.rect(-w / 2, y - band, w, band * 2);
    g.fill();
  }

  // 星云（低透明度多层椭圆，软边无接缝）
  const rnd = makeRnd(3141);
  for (let i = 0; i < 26; i++) {
    const x = (rnd() - 0.5) * w * 1.3;
    const y = -h / 2 + rnd() * h;
    const rx = 140 + rnd() * 220;
    const ry = 80 + rnd() * 140;
    const hex = i % 3 === 0 ? '#2FA98F' : (i % 3 === 1 ? '#3C6BC4' : '#7A4FC0');
    ell(g, x, y, rx, ry, col(hex, 3));
    ell(g, x, y, rx * 0.6, ry * 0.6, col(hex, 3));
  }

  // 蛋群暖光
  for (let i = 0; i < 30; i++) {
    const t = i / 29;
    ell(g, 0, 30, 268 - 232 * t, 268 - 232 * t, col('#FF9E4A', Math.round(2 + t * 4)));
  }
}

/** 星野：星点 / 星座 / 星芒 / 浮尘 */
function drawSky(g: Graphics, w: number, h: number): void {
  const rnd = makeRnd(20261106);
  for (let i = 0; i < 155; i++) {
    const x = (rnd() - 0.5) * w;
    const y = -h / 2 + rnd() * h * 0.95;
    const rad = 0.5 + rnd() * 1.4;
    const warm = rnd() > 0.76;
    const hex = warm ? '#FFE7C4' : '#DCEBFF';
    const a = 50 + Math.floor(rnd() * 160);
    const s = Math.max(1, rad * 2);
    g.fillColor = col(hex, a);
    g.rect(x - s / 2, y - s / 2, s, s);
    g.fill();
    if (rad > 1.7) circle(g, x, y, rad * 3.6, col(hex, 9));
  }

  const cs: number[][] = [[-268, 478], [-214, 516], [-140, 492], [-88, 534], [-176, 440]];
  for (let i = 0; i < cs.length - 1; i++) polyline(g, [cs[i], cs[i + 1]], col('#BFD8FF', 22), 0.9);
  for (let i = 0; i < cs.length; i++) {
    circle(g, cs[i][0], cs[i][1], 1.4, col('#EAF4FF', 160));
    circle(g, cs[i][0], cs[i][1], 5, col('#CFE4FF', 9));
  }
  const cs2: number[][] = [[206, 544], [262, 502], [328, 524]];
  for (let i = 1; i < cs2.length; i++) polyline(g, [cs2[i - 1], cs2[i]], col('#BFD8FF', 18), 0.8);
  for (let i = 0; i < cs2.length; i++) circle(g, cs2[i][0], cs2[i][1], 1.3, col('#EAF4FF', 140));

  const sparks: number[][] = [
    [-306, 336, 9], [296, 390, 7], [-196, 164, 6], [338, 210, 5],
    [-40, 580, 8], [144, 616, 6], [-340, 102, 5],
  ];
  for (let i = 0; i < sparks.length; i++) {
    const [x, y, s] = sparks[i];
    star4(g, x, y, s, '#FFFFFF', 130);
    circle(g, x, y, s * 2.4, col('#DCEBFF', 12));
  }

  const d = makeRnd(77);
  for (let i = 0; i < 46; i++) {
    const x = (d() - 0.5) * w * 1.15;
    const y = -h / 2 + d() * h;
    circle(g, x, y, 0.7 + d() * 1.1, col('#FFE3BC', 14 + Math.floor(d() * 34)));
  }
}

/** 前雾：底部雾带 + 压暗 + 暗角 */
function drawVeil(g: Graphics, w: number, h: number): void {
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const y = -280 - t * 140;
    ell(g, 0, y, 460 - t * 40, 26 + t * 10, col('#9CC4FF', 3));
    ell(g, (i % 2 ? 1 : -1) * 70, y - 12, 400 - t * 30, 20 + t * 8, col('#FFD2A6', 2));
  }
  for (let i = 0; i < 8; i++) ell(g, 0, -500 - i * 14, 380 - i * 28, 26 + i * 8, col('#3E6FA8', 3));

  // 底部压暗
  for (let i = 0; i < 18; i++) {
    g.fillColor = col('#03060C', Math.round(2.4 + i * 2.6));
    g.rect(-w / 2, -h / 2 + i * 10, w, 10);
    g.fill();
  }

  // 暗角
  for (let i = 0; i < 26; i++) {
    ellipseStroke(g, 0, 60, 360 + i * 16, 600 + i * 26, col('#02040A', 2), 26);
  }
}
