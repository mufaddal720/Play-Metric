import { useEffect, useState } from 'react';
import type { SegmentId } from '../../perception/body';
import { bodyFromAngles, lerpAngles, PROPORTIONS } from './kinematics';
import { NEUTRAL_POSE } from './poses';

/**
 * Illustrated target drawn directly from the reference skeleton (mirror view). With `animate`,
 * the character moves from a neutral stance into the pose and then HOLDS the final reference —
 * the held frame is exactly the skeleton that is judged.
 */
export function PoseFigure({ angles, size = 220, animate = false, color = '#00843D', ghost }: {
  angles: Record<SegmentId, number>; size?: number; animate?: boolean; color?: string; ghost?: Record<SegmentId, number>;
}) {
  const [t, setT] = useState(animate ? 0 : 1);
  useEffect(() => {
    if (!animate) { setT(1); return; }
    setT(0);
    const start = performance.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / 900);
      setT(1 - (1 - k) ** 3);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [animate, JSON.stringify(angles)]);

  const a = t >= 1 ? angles : lerpAngles(NEUTRAL_POSE, angles, t);
  return (
    <svg viewBox="-2.4 -2.6 4.8 5" width={size} height={size * (5 / 4.8)} role="img" aria-label="Target pose illustration">
      <defs>
        <radialGradient id="floor" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#ffffff22" /><stop offset="100%" stopColor="#ffffff00" /></radialGradient>
      </defs>
      <ellipse cx="0" cy="2.05" rx="1.6" ry="0.18" fill="url(#floor)" />
      {ghost && <Stick angles={ghost} color="#ffffff" opacity={0.18} />}
      <Stick angles={a} color={color} opacity={1} />
      <text x="-2.2" y="-2.35" fontSize="0.2" fill="#9A9AA6">your left</text>
      <text x="2.2" y="-2.35" fontSize="0.2" fill="#9A9AA6" textAnchor="end">your right</text>
    </svg>
  );
}

function Stick({ angles, color, opacity }: { angles: Record<SegmentId, number>; color: string; opacity: number }) {
  const b = bodyFromAngles(angles, 1, 0, 0.1);
  const line = (p: keyof typeof b, q: keyof typeof b, w = 0.16) => (
    <line x1={b[p].x} y1={b[p].y} x2={b[q].x} y2={b[q].y} stroke={color} strokeWidth={w} strokeLinecap="round" />
  );
  const headC = { x: b.nose.x, y: b.nose.y - 0.05 };
  return (
    <g opacity={opacity}>
      <path d={`M${b.lShoulder.x} ${b.lShoulder.y} L${b.rShoulder.x} ${b.rShoulder.y} L${b.rHip.x} ${b.rHip.y} L${b.lHip.x} ${b.lHip.y} Z`} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={0.1} strokeLinejoin="round" />
      {line('lShoulder', 'lElbow')}{line('lElbow', 'lWrist', 0.14)}
      {line('rShoulder', 'rElbow')}{line('rElbow', 'rWrist', 0.14)}
      {line('lHip', 'lKnee', 0.18)}{line('lKnee', 'lAnkle', 0.16)}
      {line('rHip', 'rKnee', 0.18)}{line('rKnee', 'rAnkle', 0.16)}
      <circle cx={headC.x} cy={headC.y} r={PROPORTIONS.head} fill="#F6F1E7" stroke={color} strokeWidth={0.06} />
      {(['lWrist', 'rWrist'] as const).map((k) => <circle key={k} cx={b[k].x} cy={b[k].y} r={0.09} fill="#F6F1E7" />)}
      {/* left side marker so mirror orientation is explicit */}
      <circle cx={b.lShoulder.x} cy={b.lShoulder.y} r={0.07} fill="#E4002B" />
    </g>
  );
}
