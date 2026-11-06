/**
 * 灵卵美术（纯 Graphics 绘制，零贴图依赖）
 * - 立体感：以左上为光源，用「蛋形套层」逐层收缩 + 偏移模拟球面明暗，
 *   再用边缘反射光、透壳暖光、镜面高光补出珠光质感
 * - 神奇纹路：三种神纹（星轨 / 灵纹 / 云纹），按蛋 id 稳定生成，同一枚蛋每次都一样
 * - 仙气：外发光、旋转星轨环、呼吸缩放、上浮光尘
 * - 不含任何物种 / 稀有度暗示
 */

import { Color, Graphics, Node, tween, UIOpacity, Vec3 } from 'cc';
import { uiNode } from './UiFactory';

export interface EggStyle {
  light: string; base: string; mid: string; deep: string;
  rim: string; glow: string; ink: string;
}

/** 五套等权配色（奶金 / 青玉 / 樱粉 / 紫曜 / 苍穹） */
export const EGG_STYLES: EggStyle[] = [
  { light: '#FFF9E4', base: '#F0D49E', mid: '#C9A063', deep: '#765027', rim: '#FFC274', glow: '#FF8E2E', ink: '#7C4E14' },
  { light: '#F4FFFA', base: '#C9EFE2', mid: '#7FC0AE', deep: '#255C51', rim: '#7CEBD2', glow: '#12C2A2', ink: '#1D6153' },
  { light: '#FFF7FA', base: '#F7D3DF', mid: '#D792A9', deep: '#73414F', rim: '#FFA9C2', glow: '#FF4D84', ink: '#8C4058' },
  { light: '#FAF5FF', base: '#DFD0F6', mid: '#AC8FD8', deep: '#4A336F', rim: '#C6A4FF', glow: '#7440DC', ink: '#4C2F86' },
  { light: '#F6FCFF', base: '#C6DFF6', mid: '#83AEDA', deep: '#2E537A', rim: '#A2CDFF', glow: '#2F82DC', ink: '#2B5478' },
];

const RX = 68;
const RY = 86;
const TAPER = 0.20;
const SEG = 80;
const LAYERS = 42;

// ===== 颜色与几何基础 =====

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
  const c = new Color(v[0], v[1], v[2], a);
  return c;
}

function mix(h1: string, h2: string, t: number): string {
  const a = rgb(h1), b = rgb(h2);
  const to = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${to(a[0] + (b[0] - a[0]) * t)}${to(a[1] + (b[1] - a[1]) * t)}${to(a[2] + (b[2] - a[2]) * t)}`;
}

/** 蛋形半宽（上窄下宽，比标准椭圆更像真蛋） */
function eggW(y: number): number {
  const k = Math.max(-1, Math.min(1, y / RY));
  return RX * Math.sqrt(Math.max(0, 1 - k * k)) * (1 - TAPER * k);
}

function eggPath(g: Graphics, sx: number, sy: number, ox: number, oy: number): void {
  for (let i = 0; i <= SEG; i++) {
    const t = (i / SEG) * Math.PI * 2;
    const c = Math.cos(t);
    const x = RX * Math.sin(t) * (1 - TAPER * c) * sx + ox;
    const y = RY * c * sy + oy;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.close();
}

function fillEgg(g: Graphics, sx: number, sy: number, ox: number, oy: number, c: Color): void {
  g.fillColor = c;
  eggPath(g, sx, sy, ox, oy);
  g.fill();
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

/** 椭圆弧描边（Graphics 只支持正圆弧，这里按折线近似） */
function arc(g: Graphics, cx: number, cy: number, rx: number, ry: number,
  a0: number, a1: number, c: Color, w: number, seg = 30): void {
  if (rx <= 0 || ry <= 0 || w <= 0) return;
  g.lineWidth = w;
  g.strokeColor = c;
  for (let i = 0; i <= seg; i++) {
    const a = a0 + (a1 - a0) * (i / seg);
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
}

function polyline(g: Graphics, pts: number[][], c: Color, w: number): void {
  if (pts.length < 2) return;
  g.lineWidth = w;
  g.strokeColor = c;
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.stroke();
}

/** 三次描边：外发光 → 内发光 → 本体线 → 高光芯 */
function glowStroke(g: Graphics, build: (g: Graphics) => void, ink: string, glow: string, w = 1.7): void {
  g.lineCap = Graphics.LineCap.ROUND;
  g.lineJoin = Graphics.LineJoin.ROUND;
  const passes: Array<[string, number, number]> = [
    [ink, 20, 8], [ink, 26, 3.8], [ink, 175, w], [glow, 60, 0.6],
  ];
  for (let i = 0; i < passes.length; i++) {
    const [hex, a, lw] = passes[i];
    g.lineWidth = lw;
    g.strokeColor = col(hex, a);
    build(g);
    g.stroke();
  }
}

// ===== 纹路构件 =====

function diamond(g: Graphics, x: number, y: number, s: number, hex: string, a = 255): void {
  g.fillColor = col(hex, a);
  g.moveTo(x, y + s);
  g.lineTo(x + s * 0.5, y);
  g.lineTo(x, y - s);
  g.lineTo(x - s * 0.5, y);
  g.close();
  g.fill();
}

function star4(g: Graphics, x: number, y: number, s: number, hex: string, a = 235): void {
  // 四角星：四次二次贝塞尔内凹
  g.fillColor = col(hex, 16);
  g.circle(x, y, s * 2.2);
  g.fill();
  g.fillColor = col(hex, a);
  g.moveTo(x, y + s);
  g.quadraticCurveTo(x + s * 0.15, y + s * 0.15, x + s, y);
  g.quadraticCurveTo(x + s * 0.15, y - s * 0.15, x, y - s);
  g.quadraticCurveTo(x - s * 0.15, y - s * 0.15, x - s, y);
  g.quadraticCurveTo(x - s * 0.15, y + s * 0.15, x, y + s);
  g.close();
  g.fill();
}

function orb(g: Graphics, x: number, y: number, r: number, hex: string): void {
  circle(g, x, y, r * 2.6, col(hex, 20));
  circle(g, x, y, r, col(hex, 200));
  circle(g, x, y, r * 0.38, col('#FFFFFF', 210));
}

// ===== 明暗色阶 =====

function ramp(st: EggStyle, t: number): Color {
  const v = Math.max(0, Math.min(1, t));
  if (v < 0.42) return col(mix(st.deep, st.mid, v / 0.42));
  if (v < 0.78) return col(mix(st.mid, st.base, (v - 0.42) / 0.36));
  return col(mix(st.base, st.light, (v - 0.78) / 0.22));
}

// ===== 单枚蛋绘制 =====

function drawAura(g: Graphics, st: EggStyle): void {
  for (let i = 0; i < 12; i++) ell(g, -2, 4, RX * 1.95 - 10 * i, RY * 1.70 - 10 * i, col(st.glow, 3));
  for (let i = 0; i < 5; i++) ell(g, -2, 4, RX * 1.22 - 8 * i, RY * 1.08 - 8 * i, col(st.rim, 3));
}

function drawOrbit(g: Graphics): void {
  const rx = RX * 1.52;
  const ry = RY * 0.42;
  for (let i = 0; i < 3; i++) arc(g, 0, -2, rx - i * 1.5, ry - i * 0.6, 0.15, Math.PI - 0.15, col('#FFE7C4', 5), 6, 40);
  arc(g, 0, -2, rx, ry, 0.1, Math.PI - 0.1, col('#FFE7C4', 90), 1.2, 40);
  arc(g, 0, -2, rx, ry, Math.PI + 0.3, Math.PI * 2 - 0.3, col('#FFE7C4', 55), 1.2, 40);
  for (let k = 0; k < 3; k++) {
    const a = 0.5 + k * 0.9;
    circle(g, Math.cos(a) * rx, Math.sin(a) * ry - 2, 2, col('#FFF6E0', 190));
  }
}

function drawBody(g: Graphics, st: EggStyle, id: string): void {
  let seed = hashId(id) || 1;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  // 剪影（暗面底色）
  fillEgg(g, 1, 1, 0, 0, col(st.deep));

  // 球面明暗：套层向光源方向收缩偏移
  for (let i = 0; i < LAYERS; i++) {
    const t = i / (LAYERS - 1);
    const e = Math.pow(t, 1.55);
    fillEgg(g, 1 - 0.58 * e, 1 - 0.58 * e, -26 * e, 30 * e, ramp(st, Math.min(1, e * 1.06)));
  }

  // 底部环境遮蔽
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    ell(g, 4 - 6 * t, -RY * 0.62 + 8 * t, eggW(-RY * 0.55) * 0.7 - 30 * t, 26 - 10 * t, col(st.deep, 3));
  }
  // 透壳暖光
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    ell(g, -1, -RY * 0.18 + 4 * t, 36 - 24 * t, 30 - 18 * t, col(st.rim, 4));
  }
  // 台面反光（底部）
  arc(g, 0, 2, RX * 0.94, RY * 0.93, 3.6, 5.5, col(st.rim, 16), 8, 30);
  arc(g, 0, 2, RX * 0.91, RY * 0.90, 3.75, 5.35, col(st.rim, 80), 2, 30);
  // 右下边缘反射光
  arc(g, 1, 1, RX * 0.935, RY * 0.925, -1.38, -0.38, col(st.rim, 22), 6, 30);
  arc(g, 1, 1, RX * 0.915, RY * 0.905, -1.28, -0.48, col(st.rim, 120), 1.6, 30);
  // 左上受光边缘
  arc(g, -1, -1, RX * 0.985, RY * 0.985, 1.75, 2.38, col(st.light, 26), 3.4, 30);
  arc(g, -1, -1, RX * 0.978, RY * 0.978, 1.85, 2.30, col(st.light, 120), 1.2, 30);

  // 珠光颗粒
  for (let i = 0; i < 24; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * 0.82;
    const y = Math.sin(a) * RY * 0.82 * rr;
    circle(g, Math.cos(a) * eggW(y) * 0.82 * rr, y, 0.5 + rnd() * 0.7, col(st.light, 40));
  }

  drawPattern(g, st, hashId(id + 'p') % 3, rnd);

  // 镜面高光
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    ell(g, -26 + 2 * t, 40 - 1.5 * t, 12 - 1.6 * i, 17 - 2.0 * i, col('#FFFFFF', 16 + 22 * t));
  }
  ell(g, -26, 38, 6.6, 9.6, col('#FFFFFF', 215));
  circle(g, -29, 44, 2.6, col('#FFFFFF', 245));
  circle(g, -16, 28, 1.5, col('#FFFFFF', 120));
}

function drawPattern(g: Graphics, st: EggStyle, mode: number, rnd: () => number): void {
  const ink = st.ink;
  const glow = st.rim;

  if (mode === 0) {
    // 星轨：螺旋 + 光珠 + 陨点
    const turns = 1.55;
    const pts: number[][] = [];
    for (let a = 0; a <= Math.PI * 2 * turns; a += 0.075) {
      const k = a / (Math.PI * 2 * turns);
      const rr = 0.10 + 0.42 * k;
      pts.push([Math.cos(a - 0.9) * RX * 0.86 * rr, Math.sin(a - 0.9) * RY * 0.86 * rr + 5]);
    }
    glowStroke(g, gg => {
      gg.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) gg.lineTo(pts[i][0], pts[i][1]);
    }, ink, glow, 1.8);
    for (let i = 9; i < pts.length - 4; i += 11) orb(g, pts[i][0], pts[i][1], 1.7, glow);
    const marks: number[][] = [[-36, 32], [-42, -26], [-4, -46]];
    for (let i = 0; i < marks.length; i++) diamond(g, marks[i][0], marks[i][1], 5, glow, 160);
    star4(g, 0, 5, 10, glow);
  } else if (mode === 1) {
    // 灵纹：两道纬带 + 竖脊 + 中心法印
    const bands = [30, -26];
    for (let b = 0; b < bands.length; b++) {
      const by = bands[b];
      const w = eggW(by) * 0.80;
      const pts: number[][] = [];
      for (let x = -w; x <= w; x += 3.5) pts.push([x, by - (1 - (x / w) * (x / w)) * 9]);
      glowStroke(g, gg => {
        gg.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) gg.lineTo(pts[i][0], pts[i][1]);
      }, ink, glow, 1.7);
      for (let i = 0; i < 3; i++) {
        const p = pts[Math.floor(4 + (pts.length - 9) * (i + 0.5) / 3)];
        diamond(g, p[0], p[1], 4.2, glow, 190);
      }
      orb(g, pts[0][0], pts[0][1], 1.5, glow);
      orb(g, pts[pts.length - 1][0], pts[pts.length - 1][1], 1.5, glow);
    }
    glowStroke(g, gg => { gg.moveTo(0, RY * 0.46); gg.lineTo(0, -RY * 0.50); }, ink, glow, 1.0);
    star4(g, 0, 4, 13, glow);
    diamond(g, 0, RY * 0.46, 5.4, glow, 190);
    diamond(g, 0, -RY * 0.50, 4.4, glow, 150);
    orb(g, 0, RY * 0.30, 1.6, glow);
    orb(g, 0, -RY * 0.32, 1.6, glow);
  } else {
    // 云纹：双如意卷云 + 星印
    for (let s = -1; s <= 1; s += 2) {
      const cx = s * RX * 0.34;
      const cy = -RY * 0.30;
      const pts: number[][] = [];
      for (let a = 0; a <= Math.PI * 2 * 1.45; a += 0.08) {
        const k = a / (Math.PI * 2 * 1.45);
        const rr = RX * 0.26 * (1 - k * 0.92);
        const dir = s > 0 ? 1 : -1;
        pts.push([cx + Math.cos(a * dir) * rr, cy + Math.sin(a * dir) * rr]);
      }
      glowStroke(g, gg => {
        gg.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) gg.lineTo(pts[i][0], pts[i][1]);
      }, ink, glow, 1.7);
      orb(g, pts[pts.length - 1][0], pts[pts.length - 1][1], 1.5, glow);
    }
    const cloud: number[][] = [];
    for (let x = -RX * 0.34; x <= RX * 0.34; x += 3) {
      cloud.push([x, -RY * 0.30 + Math.cos(x / (RX * 0.34) * Math.PI / 2) * 10 - 4]);
    }
    glowStroke(g, gg => {
      gg.moveTo(cloud[0][0], cloud[0][1]);
      for (let i = 1; i < cloud.length; i++) gg.lineTo(cloud[i][0], cloud[i][1]);
    }, ink, glow, 1.5);
    glowStroke(g, gg => { gg.moveTo(0, RY * 0.30); gg.lineTo(0, -RY * 0.22); }, ink, glow, 1.0);
    star4(g, 0, RY * 0.20, 12, glow);
    diamond(g, 0, RY * 0.44, 4.4, glow, 150);
  }

  // 壳内星尘
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = 0.5 + rnd() * 0.3;
    const y = Math.sin(a) * RY * rr;
    circle(g, Math.cos(a) * eggW(y) * rr, y, 0.6 + rnd() * 0.6, col(glow, 80));
  }
}

function drawSparks(g: Graphics, id: string, st: EggStyle): void {
  let seed = hashId(id + 's') || 7;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let k = 0; k < 4; k++) {
    diamond(g, -64 + rnd() * 128, -48 + rnd() * 104, 1.9 + rnd() * 1.2, '#FFF6E0', 140);
  }
  for (let k = 0; k < 3; k++) {
    circle(g, -52 + rnd() * 104, -20 + rnd() * 70, 1.2 + rnd(), col(st.rim, 120));
  }
}

// ===== 对外：光台（投影 + 光柱 + 台面光） =====

export function createEggPedestal(st: EggStyle): Node {
  const n = uiNode('EggPedestal', 240, 220);
  const g = n.addComponent(Graphics);

  // 落地投影
  ell(g, 2, 6, 54, 13, col('#02060E', 95));
  ell(g, 2, 6, 76, 18, col('#02060E', 44));

  // 台面发光
  for (let i = 0; i < 10; i++) ell(g, 0, 4, 90 - 5.5 * i, 18 - 1.1 * i, col(st.glow, 3));
  ell(g, 0, 4, 58, 12, col(st.glow, 30));
  ell(g, 0, 4, 32, 6, col('#FFFFFF', 44));

  return n;
}

// ===== 对外：构建一枚可动效的灵卵节点 =====

export function createEggNode(id: string, st: EggStyle, animate = true): Node {
  const root = uiNode('Egg', 260, 280);

  const aura = uiNode('EggAura', 260, 280);
  aura.setParent(root);
  const auraG = aura.addComponent(Graphics);
  drawAura(auraG, st);

  const orbit = uiNode('EggOrbit', 260, 280);
  orbit.setParent(root);
  orbit.angle = -18;
  const orbitG = orbit.addComponent(Graphics);
  drawOrbit(orbitG);

  const body = uiNode('EggBody', 260, 280);
  body.setParent(root);
  const bodyG = body.addComponent(Graphics);
  drawBody(bodyG, st, id);

  const sparks = uiNode('EggSparks', 260, 280);
  sparks.setParent(root);
  const sparkG = sparks.addComponent(Graphics);
  drawSparks(sparkG, id, st);

  if (!animate) return root;

  // 呼吸
  tween(body)
    .repeatForever(
      tween(body).to(2.4, { scale: new Vec3(1.028, 1.028, 1) }).to(2.4, { scale: new Vec3(1, 1, 1) }),
    )
    .start();

  // 星轨环缓慢自转
  tween(orbit).by(26, { angle: 360 }).repeatForever().start();

  // 外发光呼吸
  const auraOp = aura.addComponent(UIOpacity);
  auraOp.opacity = 200;
  tween(auraOp)
    .repeatForever(tween(auraOp).to(2.8, { opacity: 255 }).to(2.8, { opacity: 190 }))
    .start();

  // 光尘上浮
  const sparkOp = sparks.addComponent(UIOpacity);
  sparkOp.opacity = 0;
  tween(sparkOp)
    .repeatForever(tween(sparkOp).to(1.6, { opacity: 190 }).to(2.0, { opacity: 0 }))
    .start();
  tween(sparks)
    .repeatForever(
      tween(sparks)
        .call(() => sparks.setPosition(0, 0, 0))
        .to(3.6, { position: new Vec3(4, 46, 0) }),
    )
    .start();

  return root;
}

/** 字符串 → 稳定正整数（同一枚蛋外观恒定） */
export function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return h || 1;
}
