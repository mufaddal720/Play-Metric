/** Short synthesised cues (no audio files, no microphone). */
let ctx: AudioContext | null = null;
export function beep(kind: 'tick' | 'freeze' | 'done' | 'goal') {
  try {
    ctx ??= new AudioContext();
    const spec = { tick: [660, 0.08], freeze: [880, 0.35], done: [520, 0.2], goal: [740, 0.5] }[kind];
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = spec[0];
    o.type = kind === 'goal' ? 'triangle' : 'sine';
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + spec[1]);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + spec[1]);
  } catch { /* audio is optional */ }
}
