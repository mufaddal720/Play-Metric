import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ObjectDetector } from '@mediapipe/tasks-vision';
import type { Evidence, MatchRecord, RoundRecord } from '../../core/types';
import { useStore } from '../../core/store';
import { commitRound, completeMatch } from '../../core/matchOps';
import { snapshotCanvas } from '../../core/mediaStore';
import { computeTotals, nameOf } from '../../core/ruleEngine';
import { useCamera, validateVideoFile } from '../../camera/useCamera';
import { CameraControls } from '../../camera/CameraControls';
import { LiveBadge, VideoStage, type VideoSource, type VideoStageHandle } from '../../camera/VideoStage';
import { getObjectDetector, nextTimestamp } from '../../perception/visionRuntime';
import { type ColourModel, findBlobs, learnColour, pickBall } from '../../perception/colorBall';
import { drawLabel } from '../../perception/draw';
import { formatClock } from '../../lib/time';
import { uid } from '../../lib/ids';
import { go } from '../../lib/router';
import { beep } from '../../lib/sound';
import { Card, Notice } from '../../ui/kit';
import { EvidenceCard } from '../../ui/EvidenceCard';
import { type BallObs, DEFAULT_GOAL_RULES, type GoalDef, GoalDetector, type GoalEvent } from './goalDetector';
import { type P, distToSegment, pointInPolygon } from './geometry';

export interface FootballConfig {
  durationMin: number;
  restart: 'auto' | 'host';
  detector: 'fused' | 'colour' | 'ml';
  goalAwards: [string, string]; // team credited when the ball enters goal 1 / goal 2
  calibration?: Calibration;
}
/** All calibration points are stored as fractions of the frame (0..1) so they survive resolution changes. */
export interface Calibration { pitch: P[]; goals: { p1: P; p2: P; inside: P }[]; colour: ColourModel | null; procWidth: number; ballTest?: { rate: number; radius: number; ok: boolean; fps?: number } }

type Step = 'pitch' | 'goal1' | 'goal2' | 'ball' | 'test' | 'ready';
const PROC_W = 480;
/** Below this analysis rate the ball moves too far between observations for reliable line-crossing checks. */
const MIN_FPS = 10;

export function FootballGame({ match }: { match: MatchRecord }) {
  const cfg = match.config as unknown as FootballConfig;
  const updateMatch = useStore((s) => s.updateMatch);
  const recorded = match.judging === 'recorded';
  const [deviceId, setDeviceId] = useState<string>();
  const cam = useCamera({ enabled: !recorded, deviceId, facingMode: 'environment' });
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const source: VideoSource = useMemo(() => (recorded ? { kind: 'file', url: fileUrl ?? '' } : { kind: 'live', stream: cam.stream }), [recorded, fileUrl, cam.stream]);
  const stage = useRef<VideoStageHandle>(null);

  const [detector, setDetector] = useState<ObjectDetector | null>(null);
  const [modelErr, setModelErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getObjectDetector().then((d) => live && setDetector(d)).catch((e) => live && setModelErr(String(e?.message ?? e)));
    return () => { live = false; };
  }, []);

  // ---------------- calibration
  const [cal, setCal] = useState<Calibration>(() => cfg.calibration ?? { pitch: [], goals: [], colour: null, procWidth: PROC_W });
  const [step, setStep] = useState<Step>(cfg.calibration?.ballTest ? 'ready' : 'pitch');
  const [pending, setPending] = useState<P[]>([]);
  const [calErr, setCalErr] = useState<string | null>(null);
  const calRef = useRef(cal);
  calRef.current = cal;

  const saveCal = (c: Calibration) => { setCal(c); updateMatch(match.id, (m) => ({ ...m, config: { ...m.config, calibration: c } })); };

  const onClick = (x: number, y: number) => {
    const v = stage.current?.video;
    if (!v) return;
    const pt = { x: x / v.videoWidth, y: y / v.videoHeight };
    if (step === 'pitch') {
      const pts = [...pending, pt];
      if (pts.length === 4) { saveCal({ ...cal, pitch: pts }); setPending([]); setStep('goal1'); } else setPending(pts);
    } else if (step === 'goal1' || step === 'goal2') {
      const pts = [...pending, pt];
      if (pts.length === 3) {
        const g = { p1: pts[0], p2: pts[1], inside: pts[2] };
        const goals = step === 'goal1' ? [g] : [cal.goals[0], g];
        saveCal({ ...cal, goals }); setPending([]); setStep(step === 'goal1' ? 'goal2' : 'ball');
      } else setPending(pts);
    } else if (step === 'ball') {
      const frame = grab();
      if (!frame) return;
      const s = frame.w / v.videoWidth;
      const model = learnColour(frame.data, frame.w, frame.h, Math.round(x * s), Math.round(y * s), 3);
      if (model) { setCalErr(null); saveCal({ ...cal, colour: model, procWidth: frame.w }); startTest(); }
      else setCalErr('That colour covers too much of the picture to be the ball. Tap directly on the ball (a brightly coloured ball works best).');
    }
  };

  // ---------------- frame grabbing at analysis resolution
  const proc = useRef<HTMLCanvasElement | null>(null);
  function grab(): { data: Uint8ClampedArray; w: number; h: number } | null {
    const v = stage.current?.video;
    if (!v || !v.videoWidth) return null;
    proc.current ??= document.createElement('canvas');
    const c = proc.current;
    const w = Math.min(PROC_W, v.videoWidth), h = Math.round((v.videoHeight / v.videoWidth) * w);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(v, 0, 0, w, h);
    return { data: g.getImageData(0, 0, w, h).data, w, h };
  }

  // ---------------- ball tracking test
  const test = useRef<{ until: number; frames: number; hits: number; radii: number[] } | null>(null);
  const [testResult, setTestResult] = useState<Calibration['ballTest'] | null>(cal.ballTest ?? null);
  function startTest() {
    setStep('test'); setTestResult(null); test.current = { until: performance.now() + 4000, frames: 0, hits: 0, radii: [] };
    if (recorded) stage.current?.video?.play(); // a recorded video must play for the test; it is rewound afterwards
  }

  // ---------------- match state
  const [clockRunning, setClockRunning] = useState(false);
  const [elapsed, setElapsed] = useState(() => Number((match.config as { elapsedSec?: number }).elapsedSec ?? 0));
  const elapsedRef = useRef(elapsed);
  const lastTick = useRef<number | null>(null);
  const goalDet = useRef<GoalDetector | null>(null);
  const [armed, setArmed] = useState(true);
  const [ballSeen, setBallSeen] = useState(false);
  const [persons, setPersons] = useState(0);
  const trail = useRef<BallObs[]>([]);
  const lastBall = useRef<BallObs | null>(null);
  const frameNo = useRef(0);
  const fpsWin = useRef<number[]>([]);
  const lastMl = useRef(0);
  const perf = useRef({ frames: 0, ml: 0, colour: 0 });
  const [fps, setFps] = useState(0);
  const mlBall = useRef<{ x: number; y: number; r: number; score: number; t: number } | null>(null);
  const handled = useRef(new Set<string>());
  const [toast, setToast] = useState<string | null>(null);
  const durationSec = cfg.durationMin * 60;
  const fullTime = elapsed >= durationSec;

  const goalsPx = useCallback((w: number, h: number): GoalDef[] => cal.goals.map((g, i) => ({
    id: `G${i + 1}`, label: `Goal ${i + 1}`, awardTo: cfg.goalAwards[i],
    p1: { x: g.p1.x * w, y: g.p1.y * h }, p2: { x: g.p2.x * w, y: g.p2.y * h }, inside: { x: g.inside.x * w, y: g.inside.y * h },
  })), [cal.goals, cfg.goalAwards]);

  // clock
  useEffect(() => {
    if (!clockRunning || recorded) { lastTick.current = null; return; }
    const i = setInterval(() => {
      const now = performance.now();
      if (lastTick.current !== null) {
        elapsedRef.current = Math.min(durationSec, elapsedRef.current + (now - lastTick.current) / 1000);
        setElapsed(elapsedRef.current);
        if (elapsedRef.current >= durationSec) { setClockRunning(false); beep('done'); }
      }
      lastTick.current = now;
    }, 200);
    return () => clearInterval(i);
  }, [clockRunning, recorded, durationSec]);

  // persist the clock so a refresh resumes at the right time (goals already recorded stay recorded)
  useEffect(() => {
    const i = setInterval(() => updateMatch(match.id, (m) => ({ ...m, config: { ...m.config, elapsedSec: Math.round(elapsedRef.current) } })), 3000);
    return () => clearInterval(i);
  }, [match.id, updateMatch]);

  useEffect(() => { if (cam.status === 'disconnected') { setClockRunning(false); setToast('Camera disconnected — the clock is paused. Reconnect to continue.'); } }, [cam.status]);

  function kickOff() {
    const v = stage.current?.video;
    if (!v) return;
    const w = Math.min(PROC_W, v.videoWidth), h = Math.round((v.videoHeight / v.videoWidth) * w);
    goalDet.current ??= new GoalDetector(goalsPx(w, h), { ...DEFAULT_GOAL_RULES, restart: cfg.restart });
    goalDet.current.restart();
    setArmed(true);
    if (recorded) { v.play(); }
    setClockRunning(true);
  }

  // ---------------- per-frame analysis
  const onFrame = useCallback((video: HTMLVideoElement, overlay: HTMLCanvasElement) => {
    const g = overlay.getContext('2d')!;
    const W = overlay.width, H = overlay.height;
    g.clearRect(0, 0, W, H);
    const c = calRef.current;
    // calibration overlay
    g.lineWidth = Math.max(2, W / 400);
    if (c.pitch.length === 4) {
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.setLineDash([10, 8]); g.beginPath();
      c.pitch.forEach((p, i) => (i ? g.lineTo(p.x * W, p.y * H) : g.moveTo(p.x * W, p.y * H))); g.closePath(); g.stroke(); g.setLineDash([]);
    }
    c.goals.forEach((gl, i) => {
      g.strokeStyle = goalDet.current && !goalDet.current.isArmed ? '#9A9AA6' : i === 0 ? '#E4002B' : '#00843D';
      g.lineWidth = Math.max(4, W / 200);
      g.beginPath(); g.moveTo(gl.p1.x * W, gl.p1.y * H); g.lineTo(gl.p2.x * W, gl.p2.y * H); g.stroke();
      g.fillStyle = g.strokeStyle; g.beginPath(); g.arc(gl.inside.x * W, gl.inside.y * H, 6, 0, Math.PI * 2); g.fill();
      drawLabel(g, `Goal ${i + 1} → ${nameOf(match, cfg.goalAwards[i])}`, ((gl.p1.x + gl.p2.x) / 2) * W, Math.min(gl.p1.y, gl.p2.y) * H - 10, false);
    });
    pendingRef.current.forEach((p) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(p.x * W, p.y * H, 7, 0, Math.PI * 2); g.fill(); });

    const st = stepRef.current;
    const tracking = st === 'test' || (st === 'ready');
    if (!tracking) return;
    const frame = grab();
    if (!frame) return;
    const sx = W / frame.w, sy = H / frame.h;
    const t = recorded ? video.currentTime : performance.now() / 1000;
    frameNo.current++;

    // ML detector (EfficientDet-Lite0, COCO "sports ball" + "person")
    const mode = cfg.detector;
    // Analysis frame rate (shown to the host): goal verification needs dense observations.
    fpsWin.current.push(performance.now());
    while (fpsWin.current.length && fpsWin.current[0] < performance.now() - 2000) fpsWin.current.shift();
    if (frameNo.current % 10 === 0) setFps(Math.round(fpsWin.current.length / 2));
    // The neural detector is slower than colour tracking, so in fused mode it runs only when the colour
    // tracker has lost the ball, plus a cross-check about once per second.
    const colourHealthy = !!c.colour && lastBall.current?.source === 'colour' && t - lastBall.current.t < 0.3;
    const runMl = mode === 'ml' || (mode === 'fused' && (!colourHealthy || performance.now() - lastMl.current > 1000));
    const tMl = performance.now();
    if (detectorRef.current && runMl) {
      lastMl.current = performance.now();
      try {
        const res = detectorRef.current.detectForVideo(video, nextTimestamp());
        let people = 0;
        let best: typeof mlBall.current = null;
        for (const d of res.detections) {
          const cat = d.categories[0];
          const bb = d.boundingBox!;
          if (cat.categoryName === 'person') {
            people++;
            g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; g.strokeRect(bb.originX, bb.originY, bb.width, bb.height);
          } else if (cat.categoryName === 'sports ball' && (!best || cat.score > best.score)) {
            best = { x: (bb.originX + bb.width / 2) / sx, y: (bb.originY + bb.height / 2) / sy, r: Math.max(bb.width, bb.height) / 2 / sx, score: cat.score, t };
          }
        }
        mlBall.current = best;
        setPersons(people);
      } catch { /* a failed frame is skipped, never guessed */ }
    }

    perf.current.ml += performance.now() - tMl;
    const tCol = performance.now();
    // colour tracker
    let obs: BallObs | null = null;
    const model = c.colour;
    if (model && mode !== 'ml') {
      const goals = goalsPx(frame.w, frame.h);
      const pitchPx = c.pitch.map((p) => ({ x: p.x * frame.w, y: p.y * frame.h }));
      const inPlay = (x: number, y: number) => (pitchPx.length < 4 || pointInPolygon({ x, y }, pitchPx)) || goals.some((gl) => distToSegment({ x, y }, gl.p1, gl.p2) < 1.5 * Math.hypot(gl.p2.x - gl.p1.x, gl.p2.y - gl.p1.y));
      const blobs = findBlobs(frame.data, frame.w, frame.h, model).filter((b) => inPlay(b.x, b.y));
      const prev = lastBall.current && t - lastBall.current.t < 0.5 ? lastBall.current : null;
      const b = pickBall(blobs, model, prev, frame.w * 0.25);
      if (b) obs = { t, x: b.x, y: b.y, conf: b.conf, source: 'colour' };
    }
    perf.current.colour += performance.now() - tCol;
    perf.current.frames++;
    (window as unknown as { __footballPerf?: unknown }).__footballPerf = perf.current;
    const ml = mlBall.current && Math.abs(mlBall.current.t - t) < 0.2 ? mlBall.current : null;
    if (obs && ml && Math.hypot(ml.x - obs.x, ml.y - obs.y) < Math.max(8, ml.r * 2)) obs.conf = Math.min(1, obs.conf + 0.2);
    if (!obs && ml && (mode !== 'colour')) obs = { t, x: ml.x, y: ml.y, conf: ml.score, source: 'ml' };
    if (obs) { lastBall.current = obs; trail.current.push(obs); if (trail.current.length > 30) trail.current.shift(); }
    setBallSeen(!!obs);

    // draw ball + trail
    g.strokeStyle = 'rgba(255,214,0,.8)'; g.lineWidth = 3; g.beginPath();
    trail.current.filter((o) => t - o.t < 1).forEach((o, i) => (i ? g.lineTo(o.x * sx, o.y * sy) : g.moveTo(o.x * sx, o.y * sy))); g.stroke();
    if (obs) {
      g.strokeStyle = obs.source === 'colour' ? '#FFD600' : '#4FA3FF'; g.lineWidth = 4;
      g.beginPath(); g.arc(obs.x * sx, obs.y * sy, Math.max(10, (model?.radius ?? 6) * sx * 1.6), 0, Math.PI * 2); g.stroke();
    }

    // ball test bookkeeping
    if (st === 'test' && test.current && !(recorded && video.paused)) {
      test.current.frames++;
      if (obs) { test.current.hits++; if (obs.source === 'colour' && model) test.current.radii.push(model.radius); }
      if (performance.now() > test.current.until) {
        const rate = test.current.hits / Math.max(1, test.current.frames);
        const radius = model?.radius ?? (ml ? ml.r : 0);
        const res = { rate: Math.round(rate * 100) / 100, radius: Math.round(radius * 10) / 10, ok: rate >= 0.6 && radius >= 3 && fpsWin.current.length / 2 >= MIN_FPS, fps: Math.round(fpsWin.current.length / 2) };
        test.current = null;
        setTestResult(res);
        saveCal({ ...calRef.current, ballTest: res });
        setStep('ready');
        if (recorded) { video.pause(); video.currentTime = 0; trail.current = []; lastBall.current = null; }
      }
      return;
    }

    // goal detection only while the match clock is running
    if (!clockRunningRef.current || !goalDet.current || (recorded && video.paused)) return;
    if (recorded) { elapsedRef.current = Math.min(durationSec, video.currentTime); setElapsed(elapsedRef.current); }
    const events = goalDet.current.push(t, obs);
    setArmed(goalDet.current.isArmed);
    for (const ev of events) handleGoal(ev, video);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorded, cfg.detector, goalsPx, durationSec]);

  const stepRef = useRef(step); stepRef.current = step;
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const detectorRef = useRef(detector); detectorRef.current = detector;
  const clockRunningRef = useRef(clockRunning); clockRunningRef.current = clockRunning;

  async function handleGoal(ev: GoalEvent, video: HTMLVideoElement) {
    if (handled.current.has(ev.id)) return; // duplicate guard (also enforced by the rules engine)
    handled.current.add(ev.id);
    const now = new Date().toISOString();
    const clock = recorded ? video.currentTime : elapsedRef.current;
    const evidenceId = uid('ev');
    const snap = await (async () => { const c = stage.current?.composite(); return c ? snapshotCanvas(c, `snap:${match.id}:${evidenceId}`, 420) : undefined; })();
    const confirmed = ev.decision === 'confirmed';
    const goalName = `Goal ${ev.goalId.slice(1)}`;
    const evidence: Evidence = {
      id: evidenceId, matchId: match.id, gameId: 'football', roundId: `${match.id}:play`, subjectId: ev.awardTo, subjectType: 'team', timestamp: now,
      mediaTimeSec: clock, evidenceType: 'ball_track',
      observation: `Ball crossed the ${goalName} line at ${formatClock(clock)} (crossing point ${Math.round(Number(ev.measurements.crossingPointOnMouth) * 100)}% along the goal mouth). ${ev.measurements.observationsBefore} tracked positions before the line, ${ev.measurements.observationsInside} inside the goal; largest gap at the line ${ev.measurements.gapAtLineSec} s.`,
      measurements: { ...ev.measurements, goal: goalName, matchClock: formatClock(clock), detector: cfg.detector },
      confidence: Number(ev.measurements.meanConfidence) || 0, uncertain: !confirmed, uncertaintyReason: confirmed ? undefined : ev.reasons.join('; '),
      rule: 'Goal = tracked approach + crossing between the posts in the scoring direction + ball seen inside; one goal per restart',
      scoreComponent: 'Goal', scoreAwarded: confirmed ? 1 : null, maxScore: 1,
      explanation: confirmed
        ? `Goal confirmed for ${nameOf(match, ev.awardTo)}: the ball was tracked approaching, crossed the goal line between the posts, and was seen inside the goal.`
        : `Possible goal for ${nameOf(match, ev.awardTo)}, but it could not be verified automatically (${ev.reasons.join('; ')}). The host must review it — it is not on the scoreboard yet.`,
      status: confirmed ? 'automatic' : 'pending_review', snapshotKey: snap,
    };
    const round: RoundRecord = {
      id: `${match.id}:play`, index: 0, label: 'Match', startedAt: match.createdAt, results: [],
      evidenceIds: [...(useStore.getState().matches.find((m) => m.id === match.id)?.rounds[0]?.evidenceIds ?? []), evidenceId],
    };
    commitRound(match.id, round, [evidence], confirmed ? [{ event: { id: `${match.id}:${ev.id}`, roundId: round.id, subjectId: ev.awardTo, points: 1, component: 'Goal', evidenceIds: [evidenceId], at: now }, max: 1 }] : []);
    beep('goal');
    setToast(confirmed ? `GOAL! ${nameOf(match, ev.awardTo)} — verified by the AI at ${formatClock(clock)}.` : `Possible goal at ${formatClock(clock)} needs host review.`);
    if (cfg.restart === 'host') setClockRunning((r) => r); // clock keeps running; goals stay locked until "Kick-off"
  }

  function finish() {
    if (useStore.getState().matches.find((m) => m.id === match.id)?.evidence.some((e) => e.status === 'pending_review')
      && !confirm('Some possible goals still need host review. Unreviewed events will not count. Finish anyway?')) return;
    setClockRunning(false);
    completeMatch(match.id);
    go(`/results/${match.id}`);
  }

  const live = useStore((s) => s.matches.find((m) => m.id === match.id)) ?? match;
  const totals = computeTotals(live);
  const pendingReview = live.evidence.filter((e) => e.status === 'pending_review');
  const goalLog = live.evidence.filter((e) => e.gameId === 'football').slice().reverse();
  const stepHelp: Record<Step, string> = {
    pitch: `Tap the 4 corners of the playing area (${pending.length}/4). Or skip if the whole frame is the pitch.`,
    goal1: `Goal 1 (scores for ${nameOf(match, cfg.goalAwards[0])}): tap the LEFT post, the RIGHT post, then a point INSIDE the goal (${pending.length}/3).`,
    goal2: `Goal 2 (scores for ${nameOf(match, cfg.goalAwards[1])}): tap the LEFT post, the RIGHT post, then a point INSIDE the goal (${pending.length}/3).`,
    ball: cfg.detector === 'ml' ? 'AI-detector mode: press “Test ball tracking” and roll the ball across the pitch.' : 'Place the ball in view and tap it once so the AI learns its colour.',
    test: 'Testing ball tracking for 4 seconds — roll the ball slowly across the pitch…',
    ready: 'Setup complete.',
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <VideoStage ref={stage} source={source} onFrame={onFrame} running onOverlayClick={['pitch', 'goal1', 'goal2', 'ball'].includes(step) ? onClick : undefined}
          className="aspect-video" onFileError={setFileErr}
          badge={!recorded && cam.status === 'live' ? <LiveBadge /> : undefined}
          onEnded={() => setClockRunning(false)}>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
            <div className="rounded-xl bg-black/75 px-4 py-2 text-center">
              <div className="flex items-center gap-4 text-2xl font-black tabular-nums sm:text-3xl">
                <span style={{ color: live.teams[0]?.color }}>{live.teams[0]?.name}</span>
                <span>{totals[live.teams[0]?.id] ?? 0} – {totals[live.teams[1]?.id] ?? 0}</span>
                <span style={{ color: live.teams[1]?.color === '#F5F5F5' ? '#fff' : live.teams[1]?.color }}>{live.teams[1]?.name}</span>
              </div>
              <div className="text-sm text-ink-200">{formatClock(elapsed)} / {formatClock(durationSec)} {clockRunning ? '' : fullTime ? '· Full time' : '· Clock stopped'}</div>
            </div>
          </div>
        </VideoStage>
        {!recorded && <CameraControls status={cam.status} error={cam.error} devices={cam.devices} deviceId={deviceId} onDevice={setDeviceId} onRetry={cam.retry} />}
        {recorded && (
          <Card>
            <label className="label" htmlFor="fb-file">Match video (analysed on this device, never uploaded)</label>
            <input id="fb-file" type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v" className="input" onChange={(e) => {
              const f = e.target.files?.[0]; if (!f) return;
              const err = validateVideoFile(f); setFileErr(err);
              if (!err) { if (fileUrl) URL.revokeObjectURL(fileUrl); setFileUrl(URL.createObjectURL(f)); }
            }} />
            <p className="mt-2 text-xs text-ink-300">Calibrate on the first frame, then press Kick-off to analyse the video from the start.</p>
          </Card>
        )}
        {fileErr && <Notice kind="error">{fileErr}</Notice>}
        {modelErr && <Notice kind="warn" title="AI ball detector unavailable">{modelErr}. Colour tracking still works if you tap the ball during setup.</Notice>}
        {toast && <Notice kind={toast.startsWith('GOAL') ? 'ok' : 'warn'}>{toast}</Notice>}
      </div>

      <div className="space-y-4">
        {step !== 'ready' && (
          <Card>
            <h3 className="mb-1 text-lg font-bold">Camera & pitch setup</h3>
            <ol className="mb-3 list-inside list-decimal space-y-1 text-sm text-ink-200">
              <li>Fix the camera high and to the side so the whole pitch and both goal mouths are visible.</li>
              <li>Use a brightly coloured ball that stands out from the floor and clothing.</li>
              <li>Mark the pitch, both goal lines and the ball below.</li>
            </ol>
            <Notice kind="info" title={`Step: ${step === 'test' ? 'ball test' : step}`}>{stepHelp[step]}</Notice>
            {calErr && <div className="mt-2"><Notice kind="error">{calErr}</Notice></div>}
            <div className="mt-3 flex flex-wrap gap-2">
              {step === 'pitch' && <button className="btn-ghost" onClick={() => { saveCal({ ...cal, pitch: [] }); setPending([]); setStep('goal1'); }}>Skip pitch boundary</button>}
              {pending.length > 0 && <button className="btn-ghost" onClick={() => setPending([])}>Undo points</button>}
              {step === 'ball' && cfg.detector !== 'colour' && <button className="btn-primary" disabled={!detector} onClick={() => startTest()}>Test ball tracking</button>}
              {step !== 'pitch' && step !== 'test' && <button className="btn-ghost" onClick={() => { setPending([]); setStep('pitch'); goalDet.current = null; }}>Restart setup</button>}
            </div>
          </Card>
        )}
        {step === 'ready' && (
          <Card>
            <h3 className="mb-2 text-lg font-bold">Match control</h3>
            {testResult && (
              <div className="mb-3">
                <Notice kind={testResult.ok ? 'ok' : 'warn'} title={testResult.ok ? 'Ball tracking looks usable' : 'Ball tracking is weak'}>
                  Ball found in {Math.round(testResult.rate * 100)}% of test frames (target ≥ 60%), apparent radius {testResult.radius}px at {PROC_W}px analysis width (target ≥ 3px).
                  {testResult.fps !== undefined && ` Analysis speed ${testResult.fps} frames/s (target ≥ ${MIN_FPS}).`}
                  {!testResult.ok && ' Move the camera closer, add light, use a brighter ball, or use a faster device / close other apps, then re-run setup. Goals that cannot be verified will be sent to host review rather than guessed.'}
                </Notice>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-ink-900 p-2">Ball: <b className={ballSeen ? 'text-green-300' : 'text-sand-200'}>{ballSeen ? 'tracked' : 'not seen'}</b></div>
              <div className="rounded-lg bg-ink-900 p-2">Players seen: <b>{persons}</b></div>
              <div className="col-span-2 rounded-lg bg-ink-900 p-2">Analysis speed: <b className={fps >= MIN_FPS ? 'text-green-300' : 'text-sand-200'}>{fps} frames/s</b>{fps < MIN_FPS && fps > 0 ? ' — low: fast shots may need host review' : ''}</div>
              <div className="col-span-2 rounded-lg bg-ink-900 p-2">Goal detection: <b className={armed ? 'text-green-300' : 'text-sand-200'}>{armed ? 'armed' : cfg.restart === 'host' ? 'locked — press Kick-off after a goal' : 'locked until the ball is back in play'}</b></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {!clockRunning && !fullTime && <button className="btn-primary flex-1" disabled={!recorded && cam.status !== 'live'} onClick={kickOff}>{elapsed > 0 ? 'Kick-off / resume' : 'Kick-off'}</button>}
              {clockRunning && <button className="btn-ghost flex-1" onClick={() => { setClockRunning(false); if (recorded) stage.current?.video?.pause(); }}>Pause clock</button>}
              {clockRunning && cfg.restart === 'host' && !armed && <button className="btn-light" onClick={() => { goalDet.current?.restart(); setArmed(true); }}>Kick-off (re-arm)</button>}
              <button className="btn-danger" onClick={finish}>{fullTime ? 'Finish match' : 'End match'}</button>
            </div>
            <button className="mt-2 text-xs text-ink-300 underline" onClick={() => { setClockRunning(false); goalDet.current = null; setStep('pitch'); }}>Recalibrate</button>
          </Card>
        )}
        {pendingReview.length > 0 && (
          <Card>
            <h3 className="mb-2 font-bold text-sand-200">Needs host review ({pendingReview.length})</h3>
            <div className="space-y-2">{pendingReview.map((e) => <EvidenceCard key={e.id} match={live} ev={e} />)}</div>
          </Card>
        )}
        <Card>
          <h3 className="mb-2 font-bold">Event log</h3>
          {goalLog.length === 0 ? <p className="text-sm text-ink-300">No goal events yet. The scoreboard changes only after a goal is confirmed.</p> : (
            <div className="space-y-2">{goalLog.filter((e) => e.status !== 'pending_review').map((e) => <EvidenceCard key={e.id} match={live} ev={e} compact />)}</div>
          )}
        </Card>
      </div>
    </div>
  );
}
