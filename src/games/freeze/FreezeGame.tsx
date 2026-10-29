import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Difficulty, Evidence, MatchRecord, RoundRecord } from '../../core/types';
import { useStore } from '../../core/store';
import { commitRound, completeMatch, retakeRound, type Award } from '../../core/matchOps';
import { snapshotCanvas, saveMedia } from '../../core/mediaStore';
import { computeStandings, nameOf } from '../../core/ruleEngine';
import { useCamera, validateVideoFile } from '../../camera/useCamera';
import { CameraControls } from '../../camera/CameraControls';
import { LiveBadge, VideoStage, type VideoSource, type VideoStageHandle } from '../../camera/VideoStage';
import { RoundRecorder } from '../../camera/recorder';
import { getPoseLandmarker, nextTimestamp } from '../../perception/visionRuntime';
import { type Body, toBody } from '../../perception/body';
import { PersonTracker, type TrackFrame } from '../../perception/personTracker';
import { drawLabel, drawSkeleton, SLOT_COLORS } from '../../perception/draw';
import { uid } from '../../lib/ids';
import { go } from '../../lib/router';
import { beep } from '../../lib/sound';
import { Card, Countdown, Notice, ScoreBar } from '../../ui/kit';
import { EvidenceCard } from '../../ui/EvidenceCard';
import { POSES, poseById, type PoseSpec } from './poses';
import { evaluateFreeze, mirrorPose, teamFreezeScore, type FreezeEvaluation } from './evaluator';
import { chaosSchedule, nextPhase, phaseDuration, targetAt, type FreezePhase, type Timing } from './roundMachine';
import { PoseFigure } from './PoseFigure';

export interface FreezeConfig {
  variant: 'classic' | 'chaos' | 'mirror' | 'team';
  rounds: number;
  difficulty: Difficulty;
  timing: Timing;
  poseIds: string[];
  slotPlayerIds: string[]; // left-to-right order in front of the camera
}

const PHASE_LABEL: Record<FreezePhase, string> = {
  READY: 'Ready', PREPARE: 'Get ready…', COPY: 'Copy the pose!', FREEZE: 'FREEZE!', ANALYSE: 'AI is analysing…', VERDICT: 'Verdict', COMPLETE: 'Match complete',
};

export function FreezeGame({ match }: { match: MatchRecord }) {
  const cfg = match.config as unknown as FreezeConfig;
  const settings = useStore((s) => s.settings);
  const setInFlight = useStore((s) => s.setInFlight);
  const slots = cfg.slotPlayerIds.length;
  const recorded = match.judging === 'recorded';

  // ---------------- camera / source
  const [deviceId, setDeviceId] = useState<string>();
  const cam = useCamera({ enabled: !recorded, deviceId, facingMode: 'user' });
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const source: VideoSource = useMemo(() => (recorded ? { kind: 'file', url: fileUrl ?? '' } : { kind: 'live', stream: cam.stream }), [recorded, fileUrl, cam.stream]);
  const stage = useRef<VideoStageHandle>(null);

  // ---------------- model
  const [model, setModel] = useState<PoseLandmarker | null>(null);
  const [modelErr, setModelErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getPoseLandmarker(Math.min(4, Math.max(1, slots))).then((m) => live && setModel(m)).catch((e) => live && setModelErr(String(e?.message ?? e)));
    return () => { live = false; };
  }, [slots]);

  // ---------------- round state
  const doneRounds = match.rounds.filter((r) => !r.interrupted && !r.info?.retaken).length;
  const [roundIndex, setRoundIndex] = useState(doneRounds);
  const [phase, setPhase] = useState<FreezePhase>(doneRounds >= cfg.rounds ? 'COMPLETE' : 'READY');
  const [paused, setPaused] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [roundId, setRoundId] = useState(() => uid('round'));
  const [visibleCount, setVisibleCount] = useState(0);
  const [copyElapsed, setCopyElapsed] = useState(0);
  const [lastResult, setLastResult] = useState<{ roundId: string; evals: { playerId: string; ev: FreezeEvaluation; target: PoseSpec }[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const endsAt = useRef(0);
  const pausedLeft = useRef(0);
  const tracker = useRef(new PersonTracker(slots));
  const freezeFrames = useRef<TrackFrame[]>([]);
  const recorder = useRef(new RoundRecorder());
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const fileFreezeStart = useRef(0);
  const [fileStartSec, setFileStartSec] = useState(0);
  const committedRounds = useRef(new Set<string>());

  // Pose pool for this match: deterministic order per round, never repeating until the pool is used up.
  const pool = cfg.poseIds.length ? cfg.poseIds : POSES.map((p) => p.id);
  const basePoseId = pool[roundIndex % pool.length];
  const schedule = useMemo(() => (cfg.variant === 'chaos' ? chaosSchedule(roundId, pool, cfg.timing.copy) : [{ at: 0, poseId: basePoseId }]), [cfg.variant, roundId, basePoseId]);
  const [manualPoseId, setManualPoseId] = useState<string | null>(null);
  const currentPoseId = manualPoseId ?? (phase === 'COPY' ? targetAt(schedule, copyElapsed) : phase === 'PREPARE' || phase === 'READY' ? schedule[0].poseId : targetAt(schedule, cfg.timing.copy));
  const judgedPoseRef = useRef<string>(currentPoseId);
  const pose = poseById(currentPoseId)!;

  // ---------------- refresh recovery: a round that was in progress when the page reloaded is never scored.
  useEffect(() => {
    const inflight = useStore.getState().inFlight;
    if (inflight && inflight.matchId === match.id && !match.rounds.some((r) => r.id === inflight.roundId)) {
      const r: RoundRecord = { id: inflight.roundId, index: doneRounds, label: `Round ${doneRounds + 1}`, startedAt: inflight.startedAt, results: [], evidenceIds: [], interrupted: true, info: { reason: 'Page refreshed or closed during the round' } };
      commitRound(match.id, r, [], []);
      setNotice('The previous round was interrupted (page refresh) and was not scored. You can play it again now.');
      setInFlight(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------- camera disconnect → pause safely
  useEffect(() => {
    if (cam.status === 'disconnected' && ['PREPARE', 'COPY', 'FREEZE'].includes(phaseRef.current)) {
      abortRound('The camera disconnected, so this attempt was cancelled and not scored.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam.status]);

  // ---------------- timer
  useEffect(() => {
    if (recorded) return;
    const dur = phaseDuration(phase, cfg.timing);
    if (dur === null) return;
    endsAt.current = performance.now() + dur * 1000;
    setRemaining(dur);
    if (phase === 'FREEZE') beep('freeze'); else beep('tick');
  }, [phase, roundId]);

  useEffect(() => {
    const i = setInterval(() => {
      const ph = phaseRef.current;
      if (paused || recorded || phaseDuration(ph, cfg.timing) === null) return;
      const left = (endsAt.current - performance.now()) / 1000;
      setRemaining(Math.max(0, left));
      if (ph === 'COPY') setCopyElapsed(cfg.timing.copy - left);
      if (left <= 0) advanceRef.current();
    }, 100);
    return () => clearInterval(i);
  });

  const advance = useCallback(() => {
    const ph = phaseRef.current;
    const nxt = nextPhase(ph, roundIndex, cfg.rounds);
    if (ph === 'COPY') {
      judgedPoseRef.current = manualPoseId ?? targetAt(schedule, cfg.timing.copy);
      freezeFrames.current = [];
    }
    if (nxt === 'ANALYSE') { setPhase('ANALYSE'); setTimeout(() => analyseRef.current(), 50); return; }
    setPhase(nxt);
  }, [roundIndex, cfg.rounds, schedule, manualPoseId, cfg.timing.copy]);
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  function startRound() {
    if (!model) return;
    tracker.current = new PersonTracker(slots);
    freezeFrames.current = [];
    setCopyElapsed(0);
    setPaused(false);
    setNotice(null);
    setInFlight({ matchId: match.id, roundId, phase: 'PREPARE', startedAt: new Date().toISOString() });
    if (settings.saveClips && cam.stream) recorder.current.start(cam.stream);
    setPhase('PREPARE');
  }

  function abortRound(msg: string) {
    recorder.current.stop();
    freezeFrames.current = [];
    setPaused(false);
    setNotice(msg);
    setPhase('READY');
    setInFlight(null);
  }

  function togglePause() {
    if (!paused) {
      if (phase === 'FREEZE') { abortRound('Paused during the freeze — that attempt was discarded so nobody is scored on a partial freeze. Start the round again when ready.'); return; }
      pausedLeft.current = endsAt.current - performance.now();
      setPaused(true);
    } else {
      endsAt.current = performance.now() + pausedLeft.current;
      setPaused(false);
    }
  }

  // ---------------- per-frame analysis
  const onFrame = useCallback((video: HTMLVideoElement, overlay: HTMLCanvasElement) => {
    const g = overlay.getContext('2d')!;
    g.clearRect(0, 0, overlay.width, overlay.height);
    if (!model) return;
    let res;
    try { res = model.detectForVideo(video, nextTimestamp()); } catch { return; }
    const aspect = video.videoWidth / video.videoHeight;
    const now = recorded ? video.currentTime : performance.now() / 1000;
    const bodies: Body[] = res.landmarks.map((l) => toBody(l, aspect, true));
    const tf = tracker.current.assign(bodies, now);
    setVisibleCount(bodies.length);
    tf.bodies.forEach((b, slot) => {
      if (!b) return;
      const idx = bodies.indexOf(b);
      const name = nameOf(match, cfg.slotPlayerIds[slot]);
      drawSkeleton(g, res.landmarks[idx], SLOT_COLORS[slot % SLOT_COLORS.length], name, true);
    });
    const ph = phaseRef.current;
    if (recorded) {
      const t = video.currentTime;
      if (ph === 'FREEZE' && t >= fileFreezeStart.current) freezeFrames.current.push(tf);
      if (ph === 'FREEZE' && t >= fileFreezeStart.current + cfg.timing.freeze) { video.pause(); phaseRef.current = 'ANALYSE'; setPhase('ANALYSE'); setTimeout(() => analyseRef.current(), 50); }
    } else if (ph === 'FREEZE') {
      freezeFrames.current.push(tf);
    }
    if (ph === 'FREEZE') drawLabel(g, 'FREEZE!', overlay.width / 2, 60, true, '#fff', 'rgba(228,0,43,.85)');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, recorded]);

  // ---------------- judging
  async function analyse() {
    const rid = roundId;
    if (committedRounds.current.has(rid)) return; // duplicate-submission guard
    committedRounds.current.add(rid);
    const frames = freezeFrames.current;
    const judgedPose = poseById(judgedPoseRef.current)!;
    const expected = Math.max(5, Math.round(frames.length > 0 ? (frames.length / Math.max(0.5, frames[frames.length - 1].t - frames[0].t)) * cfg.timing.freeze : 15 * cfg.timing.freeze));
    const switchDuring = tracker.current.switches.some((t) => frames.length && t >= frames[0].t);
    const clip = await recorder.current.stop();
    const clipKey = clip ? `clip:${match.id}:${rid}` : undefined;
    if (clip && clipKey) await saveMedia(clipKey, clip);
    const snapKey = await (async () => { const c = stage.current?.composite(); return c ? snapshotCanvas(c, `snap:${match.id}:${rid}`) : undefined; })();

    const evals = cfg.slotPlayerIds.map((playerId, slot) => {
      const target = cfg.variant === 'mirror' && slot === 1 ? mirrorPose(judgedPose) : judgedPose;
      const playerFrames = frames.map((f) => f.bodies[slot]).filter((b): b is Body => !!b);
      return { playerId, target, ev: evaluateFreeze(target, playerFrames, { difficulty: cfg.difficulty, expectedFrames: expected, identitySwitch: switchDuring }) };
    });

    const now = new Date().toISOString();
    const label = `Round ${roundIndex + 1}: ${judgedPose.name}`;
    const evidence: Evidence[] = [];
    const awards: Award[] = [];
    const results: RoundRecord['results'] = [];
    const teamMode = match.mode === 'team';
    for (const { playerId, ev, target } of evals) {
      const id = uid('ev');
      evidence.push({
        id, matchId: match.id, gameId: 'freeze', roundId: rid, subjectId: playerId, subjectType: 'player', timestamp: now,
        evidenceType: 'pose_landmarks',
        observation: ev.uncertain
          ? `Tracked in ${ev.framesUsed} frames during the ${cfg.timing.freeze}s freeze.`
          : `${ev.framesUsed} frames analysed. Similarity ${ev.similarity}/60, positions ${ev.positions}/25 (${ev.checks.filter((c) => c.passed).length}/${ev.checks.length} held), stability ${ev.stability}/15 (movement ${ev.movement} torso-lengths).`,
        measurements: {
          ...ev.measurements, target: target.name + (target.id.endsWith('~mirrored') ? ' (mirrored)' : ''), similarityPts: ev.similarity ?? 'n/a',
          positionsPts: ev.positions ?? 'n/a', stabilityPts: ev.stability ?? 'n/a', individualScore: ev.total ?? 'n/a', roundLabel: label,
          ...(teamMode ? { contributesTo: 'team score' } : {}),
        },
        confidence: ev.confidence, uncertain: ev.uncertain, uncertaintyReason: ev.uncertaintyReasons.join('; ') || undefined,
        rule: 'Freeze & Fool: similarity 60 + required positions 25 + stability 15',
        scoreComponent: teamMode ? 'Individual pose score (counts toward team)' : 'Freeze & Fool round score',
        scoreAwarded: ev.total, maxScore: 100, explanation: ev.explanation,
        status: ev.uncertain ? 'pending_review' : 'automatic', snapshotKey: snapKey, clipKey,
      });
      if (!teamMode) {
        if (ev.total !== null) awards.push({ event: { id: `${rid}:${playerId}`, roundId: rid, subjectId: playerId, points: ev.total, component: 'Freeze & Fool round', evidenceIds: [id], at: now }, max: 100 });
        results.push({
          subjectId: playerId, total: ev.total, status: ev.uncertain ? 'pending_review' : 'automatic',
          breakdown: [{ component: 'Pose similarity', points: ev.similarity, max: 60 }, { component: 'Required positions', points: ev.positions, max: 25 }, { component: 'Freeze stability', points: ev.stability, max: 15 }],
        });
      }
    }
    if (teamMode) {
      for (const team of match.teams) {
        const members = evals.filter((e) => match.players.find((p) => p.id === e.playerId)?.teamId === team.id);
        if (!members.length) continue;
        const ts = teamFreezeScore(members.map((m) => m.ev.total));
        const id = uid('ev');
        evidence.push({
          id, matchId: match.id, gameId: 'freeze', roundId: rid, subjectId: team.id, subjectType: 'team', timestamp: now, evidenceType: 'pose_landmarks',
          observation: `Individual scores: ${members.map((m) => `${nameOf(match, m.playerId)} ${m.ev.total ?? 'uncertain'}`).join(', ')}.`,
          measurements: { validMembers: ts.validCount, members: members.length, unityBonus: ts.bonus, roundLabel: label },
          confidence: Math.min(...members.map((m) => m.ev.confidence)), uncertain: ts.uncertain,
          uncertaintyReason: ts.uncertain ? 'fewer than half of the team members could be judged reliably' : undefined,
          rule: `Team score = average of valid individual scores + ${5} unity bonus if every member scores 60+, capped at 100`,
          scoreComponent: 'Team Freeze round score', scoreAwarded: ts.score, maxScore: 100,
          explanation: ts.uncertain ? 'No team score: not enough members were tracked reliably. Retake the round or ask the host to review.'
            : `Average of ${ts.validCount} valid score(s)${ts.bonus ? ` plus the ${ts.bonus}-point unity bonus (everyone scored 60+)` : ''}${ts.validCount < members.length ? '. Members who could not be tracked were left out of the average' : ''}.`,
          status: ts.uncertain ? 'pending_review' : 'automatic', snapshotKey: snapKey,
        });
        if (ts.score !== null) awards.push({ event: { id: `${rid}:${team.id}`, roundId: rid, subjectId: team.id, points: ts.score, component: 'Team Freeze round', evidenceIds: [id], at: now }, max: 100 });
        results.push({ subjectId: team.id, total: ts.score, status: ts.uncertain ? 'pending_review' : 'automatic', breakdown: [{ component: 'Average of members', points: ts.score === null ? null : ts.score - ts.bonus, max: 100 }, { component: 'Unity bonus', points: ts.bonus, max: 5 }] });
      }
    }
    const round: RoundRecord = { id: rid, index: roundIndex, label, startedAt: now, completedAt: now, results, evidenceIds: evidence.map((e) => e.id), info: { pose: judgedPose.id, variant: cfg.variant } };
    commitRound(match.id, round, evidence, awards);
    setInFlight(null);
    setLastResult({ roundId: rid, evals });
    setPhase('VERDICT');
    beep('done');
  }

  // A failed analysis never produces a verdict: the attempt is cancelled and can be replayed.
  async function safeAnalyse() {
    try { await analyse(); } catch (e) {
      committedRounds.current.delete(roundId);
      abortRound(`The AI analysis failed (${(e as Error)?.message ?? 'unknown error'}). Nothing was scored — please play the round again.`);
    }
  }
  const analyseRef = useRef(safeAnalyse);
  analyseRef.current = safeAnalyse;

  function nextRoundOrFinish(retake = false) {
    if (retake && lastResult) retakeRound(match.id, lastResult.roundId, 'Retake requested after an uncertain AI result');
    const nextIndex = retake ? roundIndex : roundIndex + 1;
    if (nextIndex >= cfg.rounds) { completeMatch(match.id); go(`/results/${match.id}`); return; }
    setRoundIndex(nextIndex);
    setRoundId(uid('round'));
    setManualPoseId(null);
    setLastResult(null);
    setPhase('READY');
  }

  function endMatch() {
    if (!confirm('End the match now? Completed rounds keep their scores; the current round is not scored.')) return;
    recorder.current.stop();
    completeMatch(match.id);
    go(`/results/${match.id}`);
  }

  const live = useStore((s) => s.matches.find((m) => m.id === match.id)) ?? match;
  const standings = computeStandings(live);
  const roundEvidence = lastResult ? live.evidence.filter((e) => e.roundId === lastResult.roundId) : [];
  const anyUncertain = roundEvidence.some((e) => e.status === 'pending_review');
  const counting = ['PREPARE', 'COPY', 'FREEZE'].includes(phase);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <VideoStage
          ref={stage} source={source} mirror onFrame={onFrame} running={!!model}
          className="aspect-video"
          badge={!recorded && cam.status === 'live' ? <LiveBadge recording={settings.saveClips && counting} /> : undefined}
          onFileError={setFileErr}
        >
          {counting && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/80 to-transparent p-4">
              <div className="text-2xl font-black drop-shadow sm:text-4xl">{PHASE_LABEL[phase]}</div>
              {!recorded && <Countdown seconds={remaining} label={paused ? 'Paused' : 'seconds'} />}
            </div>
          )}
          {phase === 'ANALYSE' && <div className="absolute inset-0 grid place-items-center bg-black/60"><div className="text-center"><div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-uae-green" />AI is measuring the freeze…</div></div>}
        </VideoStage>

        {!recorded && <CameraControls status={cam.status} error={cam.error} devices={cam.devices} deviceId={deviceId} onDevice={setDeviceId} onRetry={cam.retry} />}
        {recorded && (
          <Card>
            <label className="label" htmlFor="freeze-file">Recorded video (analysed on this device, never uploaded)</label>
            <input id="freeze-file" type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v" className="input"
              onChange={(e) => {
                const f = e.target.files?.[0]; if (!f) return;
                const err = validateVideoFile(f); setFileErr(err);
                if (!err) { if (fileUrl) URL.revokeObjectURL(fileUrl); setFileUrl(URL.createObjectURL(f)); }
              }} />
            {fileUrl && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="freeze-start">Freeze starts at (seconds into the video)</label>
                  <input id="freeze-start" type="number" min={0} step={0.1} className="input" value={fileStartSec} onChange={(e) => setFileStartSec(Math.max(0, Number(e.target.value)))} />
                  <button className="mt-2 text-sm underline" onClick={() => { const v = stage.current?.video; if (v) setFileStartSec(Math.round(v.currentTime * 10) / 10); }}>Use current video position</button>
                </div>
                <div className="flex gap-2 sm:items-end">
                  <button className="btn-ghost" onClick={() => { const v = stage.current?.video; if (v) (v.paused ? v.play() : v.pause()); }}>Play / pause preview</button>
                </div>
              </div>
            )}
          </Card>
        )}
        {fileErr && <Notice kind="error">{fileErr}</Notice>}
        {modelErr && <Notice kind="error" title="The AI model could not load">{modelErr}. Check your connection and reload the page. No scores will be produced without the model.</Notice>}
        {!model && !modelErr && <Notice>Loading the pose-detection model (runs on this device)…</Notice>}
        {notice && <Notice kind="warn">{notice}</Notice>}
      </div>

      <div className="space-y-4">
        <Card>
          <div className="mb-2 flex items-center justify-between text-sm text-ink-300">
            <span>Round {Math.min(roundIndex + 1, cfg.rounds)} of {cfg.rounds}</span>
            <span className="capitalize">{cfg.variant === 'team' ? 'Team Freeze' : cfg.variant === 'mirror' ? 'Mirror Match' : cfg.variant} · {cfg.difficulty}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="shrink-0 rounded-xl bg-ink-900 p-1"><PoseFigure angles={pose.angles} size={cfg.variant === 'mirror' ? 110 : 150} animate={phase === 'PREPARE' || phase === 'COPY'} /></div>
            {cfg.variant === 'mirror' && <div className="shrink-0 rounded-xl bg-ink-900 p-1"><PoseFigure angles={mirrorPose(pose).angles} size={110} color="#E4002B" /></div>}
            <div className="min-w-0">
              <div className="text-xl font-bold">{pose.emoji} {pose.name}</div>
              <p className="text-sm text-ink-200">{pose.instructions}</p>
              {cfg.variant === 'mirror' && <p className="mt-1 text-xs text-ink-300">Left player copies the green figure, right player the red mirror image.</p>}
              {cfg.variant === 'chaos' && phase === 'COPY' && <p className="mt-1 text-xs font-semibold text-sand-200">Chaos! The target can change — the pose showing when FREEZE starts is the one judged.</p>}
            </div>
          </div>
          {phase === 'READY' && recorded && (
            <div className="mt-3">
              <label className="label" htmlFor="pose-pick">Target pose in this clip</label>
              <select id="pose-pick" className="input" value={currentPoseId} onChange={(e) => setManualPoseId(e.target.value)}>
                {POSES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {phase === 'READY' && !recorded && (
              <button className="btn-primary flex-1" disabled={!model || cam.status !== 'live'} onClick={startRound}>Start round {roundIndex + 1}</button>
            )}
            {phase === 'READY' && recorded && (
              <button className="btn-primary flex-1" disabled={!model || !fileUrl} onClick={() => {
                const v = stage.current?.video; if (!v) return;
                judgedPoseRef.current = currentPoseId; tracker.current = new PersonTracker(slots); freezeFrames.current = [];
                fileFreezeStart.current = fileStartSec; v.currentTime = Math.max(0, fileStartSec - 1.5); v.play(); setPhase('FREEZE');
              }}>Judge this clip</button>
            )}
            {counting && !recorded && <button className="btn-ghost" onClick={togglePause}>{paused ? 'Resume' : 'Pause'}</button>}
            {phase === 'VERDICT' && (
              <>
                {anyUncertain && <button className="btn-ghost" onClick={() => nextRoundOrFinish(true)}>Retake round</button>}
                <button className="btn-primary flex-1" onClick={() => nextRoundOrFinish(false)}>{roundIndex + 1 >= cfg.rounds ? 'See results' : 'Next round'}</button>
              </>
            )}
            {phase === 'COMPLETE' && <button className="btn-primary flex-1" onClick={() => { completeMatch(match.id); go(`/results/${match.id}`); }}>See results</button>}
            <button className="btn-danger" onClick={endMatch}>End match</button>
          </div>
          {phase === 'READY' && !recorded && (
            <p className={`mt-3 text-sm ${visibleCount >= slots ? 'text-green-300' : 'text-sand-200'}`}>
              {visibleCount >= slots ? `✓ ${visibleCount} player(s) detected — ready.` : `${visibleCount} of ${slots} player(s) visible. Stand left to right in this order: ${cfg.slotPlayerIds.map((id) => nameOf(match, id)).join(' → ')}.`}
            </p>
          )}
        </Card>

        {phase === 'VERDICT' && lastResult && (
          <Card>
            <h3 className="mb-2 text-lg font-bold">AI verdict</h3>
            {anyUncertain && <div className="mb-3"><Notice kind="warn" title="Some results are uncertain">No score was given where the AI could not measure reliably. Retake the round, or use “Host review” on that result.</Notice></div>}
            <div className="space-y-3">
              {lastResult.evals.map(({ playerId, ev }) => (
                <div key={playerId}>
                  <div className="flex justify-between font-semibold"><span>{nameOf(live, playerId)}</span><span>{ev.total ?? '—'}/100</span></div>
                  {!ev.uncertain && (
                    <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-ink-300">
                      <div>Similarity {ev.similarity}/60<ScoreBar value={ev.similarity} max={60} /></div>
                      <div>Positions {ev.positions}/25<ScoreBar value={ev.positions} max={25} color="bg-sand-400" /></div>
                      <div>Stability {ev.stability}/15<ScoreBar value={ev.stability} max={15} color="bg-uae-red" /></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <details className="mt-3" open={anyUncertain}>
              <summary className="cursor-pointer text-sm text-ink-300">Evidence & explanations</summary>
              <div className="mt-2 space-y-2">{roundEvidence.map((e) => <EvidenceCard key={e.id} match={live} ev={e} />)}</div>
            </details>
          </Card>
        )}

        <Card>
          <h3 className="mb-2 font-bold">Leaderboard</h3>
          <ol className="space-y-1">
            {standings.map((s) => (
              <li key={s.subjectId} className="flex justify-between"><span>{s.rank}. {nameOf(live, s.subjectId)}</span><span className="font-bold tabular-nums">{s.points}</span></li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-ink-300">Only confirmed scores count. Uncertain results show no points until reviewed.</p>
        </Card>
      </div>
    </div>
  );
}
