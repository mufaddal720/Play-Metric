import type { RawLandmark } from './body';

const BONES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

/** Text drawn on a mirrored overlay must be flipped back so it stays readable. */
export function drawLabel(g: CanvasRenderingContext2D, text: string, x: number, y: number, mirror: boolean, color = '#fff', bg = 'rgba(0,0,0,.65)') {
  g.save();
  g.translate(x, y);
  if (mirror) g.scale(-1, 1);
  const fs = Math.max(14, g.canvas.width / 45);
  g.font = `700 ${fs}px Inter, system-ui, sans-serif`;
  const w = g.measureText(text).width;
  g.fillStyle = bg;
  g.fillRect(-w / 2 - 6, -fs - 4, w + 12, fs + 10);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.fillText(text, 0, 0);
  g.restore();
}

export function drawSkeleton(g: CanvasRenderingContext2D, lm: RawLandmark[], color: string, label?: string, mirror = false) {
  const W = g.canvas.width, H = g.canvas.height;
  g.lineWidth = Math.max(3, W / 250);
  g.strokeStyle = color;
  g.lineCap = 'round';
  for (const [a, b] of BONES) {
    if ((lm[a].visibility ?? 1) < 0.5 || (lm[b].visibility ?? 1) < 0.5) continue;
    g.beginPath(); g.moveTo(lm[a].x * W, lm[a].y * H); g.lineTo(lm[b].x * W, lm[b].y * H); g.stroke();
  }
  g.fillStyle = '#fff';
  for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    if ((lm[i].visibility ?? 1) < 0.5) continue;
    g.beginPath(); g.arc(lm[i].x * W, lm[i].y * H, Math.max(3, W / 300), 0, Math.PI * 2); g.fill();
  }
  if (label) {
    const top = Math.min(...[0, 11, 12].map((i) => lm[i].y)) * H;
    drawLabel(g, label, lm[0].x * W, Math.max(30, top - 30), mirror, '#fff', color);
  }
}

export const SLOT_COLORS = ['#00843D', '#E4002B', '#C8A96A', '#4FA3FF'];
