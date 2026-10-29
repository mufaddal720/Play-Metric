import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Difficulty, Evidence, MatchRecord, RoundRecord } from '../../core/types';
import { useStore } from '../../core/store';
import { commitRound, completeMatch, retakeRound, type Award } from '../../core/matchOps';
import { saveMedia, snapshotCanvas } from '../../core/mediaStore';
import { computeStandings, nameOf } from '../../core/ruleEngine';
import { useCamera } from '../../camera/useCamera';
import { CameraControls } from '../../camera/CameraControls';
import { LiveBadge, VideoStage, type VideoStageHandle } from '../../camera/VideoStage';
import { RoundRecorder } from '../../camera/recorder';
import { getPoseLandmarker, nextTimestamp } from '../../perception/visionRuntime';
import { type Body, toBody, torsoLength } from '../../perception/body';
import { drawSkeleton } from '../../perception/draw';
import { uid } from '../../lib/ids';
import { go } from '../../lib/router';
import { beep } from '../../lib/sound';
import { seededRandom } from '../freeze/roundMachine';
import { Card, Countdown, Notice, ScoreBar } from '../../ui/kit';
import { EvidenceCard } from '../../ui/EvidenceCard';
import { ACTIONS, actionById } from './actions';
import { evaluateAction, GUESS_POINTS, QUICK_GUESS_FRACTION, type ActionEvaluation } from './evaluator';
import type { TimedBody } from './features';
import { isCorrectGuess } from './answerMatch';

export interface ActionConfig { difficulty: Difficulty; turnsPerPlayer: number; performerIds: string[] }
type Phase = 'handover' | 'secret' | 'perform' | 'analyse' | 'verdict';
const MIN_PERFORM_SEC = 8;

/** Deterministic action deck for the match: shuffled once (seeded by match id), no repeats until exhausted. */
export function actionDeck(matchId: string, difficulty: Difficulty, count: number): string[] {
  const pool = ACTIONS.filter((a) => a.difficulty === difficulty).map((a) => a.id);
  const rnd = seededRandom(matchId);
  const out: string[] = [];
  while (out.length < count) {
    const deck = [...pool];
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    out.push(...deck);
  }
  return out.slice(0, count);
}

interface Guess { playerId: string; text: string; correct: boolean; atSec: number; via: 'text' | 'voice' }

export function ActionGame({ match }: { match: MatchRecord }) {
  const cfg = match.config as unknown as ActionConfig;
  const settings = useStore((s) => s.settings);
  const setInFlight = useStore((s) => s.setInFlight);
  const turns = useMemo(() => {
    const t: string[] = [];
    for (let r = 0; r < cfg.turnsPerPlayer; r++) t.push(...cfg.performerIds);
    return t;
  }, [cfg]);
  const deck = useMemo(() => actionDeck(match.id, cfg.difficulty, turns.length), [match.id, cfg.difficulty, turns.length]);

  const done = match.rounds.filter((r) => !r.interrupted && !r.info?.retaken).length;
  const [turn, setTurn] = useState(Math.min(done, turns.length - 1));
  const [phase, setPhase] = useState<Phase>('handover');
  const [revealed, setRevealed] = useState(false);
  const [roundId, setRoundId] = useState(() => uid('round'));
  const [retakeOffset, setRetakeOffset] = useState(0);
  const performerId = turns[turn];
  const action = actionById(deck[(turn + retakeOffset) % deck.length]) ?? ACTIONS[0];
  const guessers = match.mode === 'team'
    ? match.players.filter((p) => p.id !== performerId && p.teamId === match.players.find((x) => x.id === performerId)?.teamId)
    : match.players.filter((p) => p.id !== performerId);

  // camera + model (only while performing/judging)
  const [deviceId, setDeviceId] = useState<string>();
  const camOn = phase === 'perform' || phase === 'secret' || phase === 'analyse';
  const cam = useCamera({ enabled: camOn, deviceId, facingMode: 'user' });
  const source = useMemo(() => ({ kind: 'live' as const, stream: cam.stream }), [cam.stream]);
  const stage = useRef<VideoStageHandle>(null);
  const [model, setModel] = useState<PoseLandmarker | null>(null);
  const [modelErr, setModelErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getPoseLandmarker(2).then((m) => live && setModel(m)).catch((e) => live && setModelErr(String(e?.message ?? e)));
    return () => { live = false; };
  }, []);

  // performance state
  const seq = useRef<TimedBody[]>([]);
  const startedAt = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [guesser, setGuesser] = useState<string>('');
  const [text, setText] = useState('');
  const [seen, setSeen] = useState(false);
  const [result, setResult] = useState<{ ev: ActionEvaluation; roundId: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const recorder = useRef(new RoundRecorder());
  const committed = useRef(new Set<string>());
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const correct = guesses.find((g) => g.correct);

  useEffect(() => { setGuesser(guessers[0]?.id ?? ''); }, [turn]); // eslint-disable-line react-hooks/exhaustive-deps

  // refresh recovery
  useEffect(() => {
    const inflight = useStore.getState().inFlight;
    if (inflight && inflight.matchId === match.id && !match.rounds.some((r) => r.id === inflight.roundId)) {
      commitRound(match.id, { id: inflight.roundId, index: done, label: `Turn ${done + 1}`, startedAt: inflight.startedAt, results: [], evidenceIds: [], interrupted: true, info: { reason: 'Page refreshed during the turn' } }, [], []);
      setNotice('The previous turn was interrupted by a page refresh and was not scored.');
      setInFlight(null);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cam.status === 'disconnected' && phaseRef.current === 'perform') {
      recorder.current.stop();
      setNotice('The camera disconnected during the performance. This turn was cancelled without a score — press Start acting to try again.');
      setPhase('secret');
      setInFlight(null);
    }
  }, [cam.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // timer
  useEffect(() => {
    if (phase !== 'perform') return;
    const i = setInterval(() => {
      const e = (performance.now() - startedAt.current) / 1000;
      setElapsed(e);
      if (e >= action.timeLimit) finishPerformance();
      else if (correctRef.current && e >= MIN_PERFORM_SEC && e - correctRef.current.atSec >= 2) finishPerformance();
    }, 200);
    return () => clearInterval(i);
  });
  const correctRef = useRef<Guess | undefined>(undefined); correctRef.current = correct;

  const onFrame = useCallback((video: HTMLVideoElement, overlay: HTMLCanvasElement) => {
    const g = overlay.getContext('2d')!;
    g.clearRect(0, 0, overlay.width, overlay.height);
    if (!model) return;
    let res;
    try { res = model.detectForVideo(video, nextTimestamp()); } catch { return; }
    const aspect = video.videoWidth / video.videoHeight;
    const bodies = res.landmarks.map((l) => toBody(l, aspect, true));
    // the performer is the largest (closest) body in view
    let idx = -1, best = 0;
    bodies.forEach((b, i) => { const s = torsoLength(b); if (s > best) { best = s; idx = i; } });
    setSeen(idx >= 0);
    if (idx >= 0) drawSkeleton(g, res.landmarks[idx], '#C8A96A', 'Performer', true);
    if (phaseRef.current === 'perform') seq.current.push({ t: performance.now() / 1000, body: idx >= 0 ? (bodies[idx] as Body) : null });
  }, [model]);

  function startActing() {
    seq.current = [];
    setGuesses([]);
    setResult(null);
    setNotice(null);
    startedAt.current = performance.now();
    setElapsed(0);
    setInFlight({ matchId: match.id, roundId, phase: 'perform', startedAt: new Date().toISOString() });
    if (settings.saveClips && cam.stream) recorder.current.start(cam.stream);
    beep('tick');
    setPhase('perform');
  }

  function submitGuess(raw: string, via: 'text' | 'voice' = 'text') {
    const t = raw.trim();
    if (!t || !guesser || correct || phase !== 'perform') return;
    const atSec = (performance.now() - startedAt.current) / 1000;
    if (atSec > action.timeLimit) return;
    const ok = isCorrectGuess(t, action).correct;
    setGuesses((gs) => [...gs, { playerId: guesser, text: t.slice(0, 80), correct: ok, atSec, via }]);
    setText('');
    if (ok) beep('goal');
  }

  const finishPerformance = useCallback(() => {
    if (phaseRef.current !== 'perform') return;
    phaseRef.current = 'analyse';
    setPhase('analyse');
    setTimeout(() => judgeRef.current(), 50);
  }, []);

  async function judge() {
    const rid = roundId;
    if (committed.current.has(rid)) return;
    committed.current.add(rid);
    const ev = evaluateAction(action, seq.current);
    const clip = await recorder.current.stop();
    const clipKey = clip ? `clip:${match.id}:${rid}` : undefined;
    if (clip && clipKey) await saveMedia(clipKey, clip);
    const c = stage.current?.composite();
    const snap = c ? await snapshotCanvas(c, `snap:${match.id}:${rid}`) : undefined;
    const now = new Date().toISOString();
    const perfSec = Math.round((seq.current.length ? seq.current[seq.current.length - 1].t - seq.current[0].t : 0) * 10) / 10;
    const label = `Turn ${turn + 1}: ${nameOf(match, performerId)} — ${action.name}`;
    const status = ev.uncertain ? 'pending_review' as const : 'automatic' as const;
    const common = { matchId: match.id, gameId: 'action' as const, roundId: rid, timestamp: now, snapshotKey: snap, clipKey };
    const observed = ev.observedId ? actionById(ev.observedId)?.name : null;
    const matchEv: Evidence = {
      ...common, id: uid('ev'), subjectId: performerId, subjectType: 'player', evidenceType: 'action_sequence',
      observation: ev.uncertain ? `${seq.current.length} frames over ${perfSec} s.` : `${seq.current.length} frames over ${perfSec} s. Observed action: ${observed} (${Math.round((ev.ranking[0]?.score ?? 0) * 100)}%). Assigned “${action.name}” scored ${Math.round((ev.assignedScore ?? 0) * 100)}%.`,
      measurements: { ...ev.measurements, assigned: action.id, assignedName: action.name, roundLabel: label },
      confidence: ev.confidence, uncertain: ev.uncertain, uncertaintyReason: ev.reasons.join('; ') || undefined,
      rule: 'AI action match = 60 × S_assigned × D (D = 1 if assigned ranks first, else max(0.5, 1 − 2·gap))',
      scoreComponent: 'AI action match', scoreAwarded: ev.matchPoints, maxScore: 60, explanation: ev.explanation, status,
    };
    const cueEv: Evidence = {
      ...common, id: uid('ev'), subjectId: performerId, subjectType: 'player', evidenceType: 'action_sequence',
      observation: ev.cues.length ? ev.cues.map((c) => `${c.passed ? '✓' : '✗'} ${c.label} (${Math.round(c.degree * 100)}%)`).join(' · ') : 'Cues could not be measured.',
      measurements: Object.fromEntries(ev.cues.map((c) => [`cue_${c.id}`, c.degree])),
      confidence: ev.confidence, uncertain: ev.uncertain, uncertaintyReason: ev.reasons.join('; ') || undefined,
      rule: 'Cue completion = 25 × cues seen (≥ 60%) / total cues', scoreComponent: 'Action cues', scoreAwarded: ev.cuePoints, maxScore: 25,
      explanation: ev.uncertain ? 'Not scored because the performance could not be measured reliably.' : `${ev.cues.filter((c) => c.passed).length} of ${ev.cues.length} movement cues for “${action.name}” were seen.`,
      status,
    };
    const evidence: Evidence[] = [matchEv, cueEv];
    const awards: Award[] = [];
    if (ev.matchPoints !== null) awards.push({ event: { id: `${rid}:match`, roundId: rid, subjectId: performerId, points: ev.matchPoints, component: 'AI action match', evidenceIds: [matchEv.id], at: now }, max: 60 });
    if (ev.cuePoints !== null) awards.push({ event: { id: `${rid}:cues`, roundId: rid, subjectId: performerId, points: ev.cuePoints, component: 'Action cues', evidenceIds: [cueEv.id], at: now }, max: 25 });

    const win = guesses.find((g) => g.correct);
    const guessEv: Evidence = {
      ...common, id: uid('ev'), subjectId: win?.playerId ?? (guessers[0]?.id ?? performerId), subjectType: 'player',
      evidenceType: win?.via === 'voice' ? 'guess_voice' : 'guess_text',
      observation: guesses.length ? guesses.map((g) => `${nameOf(match, g.playerId)}: “${g.text}” ${g.correct ? '✓' : '✗'} at ${g.atSec.toFixed(1)} s`).join(' · ') : 'No guesses were submitted.',
      measurements: win ? { elapsedSec: Math.round(win.atSec * 10) / 10, elapsedFraction: Math.round((win.atSec / action.timeLimit) * 100) / 100, attempts: guesses.length, via: win.via } : { attempts: guesses.length },
      confidence: 1, uncertain: false, rule: `Correct answer = ${GUESS_POINTS} points to the first correct guesser within ${action.timeLimit} s`,
      scoreComponent: 'Correct guess', scoreAwarded: win ? GUESS_POINTS : 0, maxScore: GUESS_POINTS,
      explanation: win ? `${nameOf(match, win.playerId)} guessed “${win.text}”, which matches the secret action “${action.name}”, after ${win.atSec.toFixed(1)} s.` : `Nobody guessed “${action.name}” within the time limit, so no guessing points were awarded.`,
      status: 'automatic',
    };
    evidence.push(guessEv);
    if (win) awards.push({ event: { id: `${rid}:guess`, roundId: rid, subjectId: win.playerId, points: GUESS_POINTS, component: 'Correct guess', evidenceIds: [guessEv.id], at: now }, max: GUESS_POINTS });

    const round: RoundRecord = {
      id: rid, index: turn, label, startedAt: now, completedAt: now, evidenceIds: evidence.map((e) => e.id),
      info: { action: action.id, performer: performerId, guesses: guesses.length, quickGuess: !!win && win.atSec <= QUICK_GUESS_FRACTION * action.timeLimit },
      results: [
        { subjectId: performerId, total: ev.uncertain ? null : (ev.matchPoints ?? 0) + (ev.cuePoints ?? 0), status, breakdown: [{ component: 'AI action match', points: ev.matchPoints, max: 60 }, { component: 'Action cues', points: ev.cuePoints, max: 25 }] },
        ...(win ? [{ subjectId: win.playerId, total: GUESS_POINTS, status: 'automatic' as const, breakdown: [{ component: 'Correct guess', points: GUESS_POINTS, max: GUESS_POINTS }] }] : []),
      ],
    };
    commitRound(match.id, round, evidence, awards);
    setInFlight(null);
    setResult({ ev, roundId: rid });
    setPhase('verdict');
    beep('done');
  }
  async function safeJudge() {
    try { await judge(); } catch (e) {
      committed.current.delete(roundId);
      recorder.current.stop();
      setInFlight(null);
      setNotice(`The AI analysis failed (${(e as Error)?.message ?? 'unknown error'}). Nothing was scored — press Start acting to try again.`);
      setPhase('secret');
    }
  }
  const judgeRef = useRef(safeJudge); judgeRef.current = safeJudge;

  function next(retake = false) {
    if (retake && result) { retakeRound(match.id, result.roundId, 'Performer retried after an uncertain AI result'); setRetakeOffset((o) => o + 1); }
    const n = retake ? turn : turn + 1;
    if (n >= turns.length) { completeMatch(match.id); go(`/results/${match.id}`); return; }
    setTurn(n);
    setRoundId(uid('round'));
    setResult(null);
    setGuesses([]);
    setRevealed(false);
    setPhase('handover');
  }

  function endMatch() {
    if (!confirm('End the game now? Finished turns keep their scores; the current turn is not scored.')) return;
    recorder.current.stop();
    completeMatch(match.id);
    go(`/results/${match.id}`);
  }

  // optional voice guesses (Web Speech API)
  const SR = (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;
  const [listening, setListening] = useState(false);
  function voiceGuess() {
    if (!SR) return;
    const r = new SR();
    r.lang = 'en-GB'; r.interimResults = false; r.maxAlternatives = 3;
    r.onresult = (e) => {
      const alts = Array.from({ length: e.results[0].length }, (_, i) => e.results[0][i].transcript);
      const hit = alts.find((a) => isCorrectGuess(a, action).correct) ?? alts[0];
      submitGuess(hit, 'voice');
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    setListening(true);
    r.start();
  }

  const live = useStore((s) => s.matches.find((m) => m.id === match.id)) ?? match;
  const standings = computeStandings(live);
  const roundEvidence = result ? live.evidence.filter((e) => e.roundId === result.roundId) : [];
  const left = Math.max(0, action.timeLimit - elapsed);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        {phase === 'handover' && (
          <Card className="text-center">
            <div className="text-sm uppercase tracking-widest text-ink-300">Turn {turn + 1} of {turns.length} · {cfg.difficulty}</div>
            <h2 className="mt-2 text-3xl font-black">Pass the device to {nameOf(match, performerId)}</h2>
            <p className="mt-2 text-ink-200">Everyone else: look away from the screen until {nameOf(match, performerId)} has seen the secret action.</p>
            <button className="btn-primary mt-5" onClick={() => setPhase('secret')}>I’m {nameOf(match, performerId)} — show my secret</button>
          </Card>
        )}
        {phase === 'secret' && (
          <Card className="text-center">
            <h2 className="text-2xl font-bold">Your secret action</h2>
            <p className="mt-1 text-sm text-ink-300">Press and hold the card to reveal it. Let go to hide it again.</p>
            <button
              className="mx-auto mt-4 block w-full max-w-md select-none rounded-2xl border-2 border-dashed border-sand-400 bg-ink-900 p-8 text-xl font-bold"
              onPointerDown={() => setRevealed(true)} onPointerUp={() => setRevealed(false)} onPointerLeave={() => setRevealed(false)}
              onKeyDown={(e) => e.key === ' ' && setRevealed(true)} onKeyUp={() => setRevealed(false)}
              aria-label="Hold to reveal the secret action">
              {revealed ? <><div className="text-5xl">{action.emoji}</div><div className="mt-2">{action.secretPrompt}</div><div className="mt-2 text-sm font-normal text-ink-300">No talking or sounds! {action.safety}</div></> : '🔒 Hold to reveal'}
            </button>
            <p className="mt-4 text-sm text-ink-300">Stand where the camera can see your whole upper body (whole body is best). You have {action.timeLimit} seconds.</p>
            <button className="btn-primary mt-4" disabled={!model || cam.status !== 'live'} onClick={startActing}>Start acting</button>
            {!seen && cam.status === 'live' && model && <p className="mt-2 text-sm text-sand-200">The camera can’t see a performer yet — step into view.</p>}
          </Card>
        )}
        {(phase === 'secret' || phase === 'perform' || phase === 'analyse') && (
          <VideoStage ref={stage} source={source} mirror onFrame={onFrame} running={!!model} className={phase === 'secret' ? 'aspect-video max-h-64' : 'aspect-video'}
            badge={cam.status === 'live' ? <LiveBadge recording={settings.saveClips && phase === 'perform'} /> : undefined}>
            {phase === 'perform' && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/80 to-transparent p-4">
                <div className="text-xl font-bold">{nameOf(match, performerId)} is acting…{correct && <div className="text-base text-green-300">Correct guess! Keep acting a moment so the AI can judge.</div>}</div>
                <Countdown seconds={left} label="seconds left" />
              </div>
            )}
            {phase === 'analyse' && <div className="absolute inset-0 grid place-items-center bg-black/60">AI is analysing the movement…</div>}
          </VideoStage>
        )}
        {camOn && <CameraControls status={cam.status} error={cam.error} devices={cam.devices} deviceId={deviceId} onDevice={setDeviceId} onRetry={cam.retry} />}
        {modelErr && <Notice kind="error" title="The AI model could not load">{modelErr}</Notice>}
        {notice && <Notice kind="warn">{notice}</Notice>}

        {phase === 'verdict' && result && (
          <Card>
            <div className="text-sm uppercase tracking-widest text-ink-300">The answer was</div>
            <h2 className="text-3xl font-black">{action.emoji} {action.name}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-ink-900 p-3">
                <div className="font-semibold">Performer · {nameOf(match, performerId)}</div>
                {result.ev.uncertain ? <Notice kind="warn" title="AI could not judge confidently">{result.ev.reasons.join('; ')}</Notice> : (
                  <div className="mt-2 space-y-2 text-sm">
                    <div>AI action match {result.ev.matchPoints}/60<ScoreBar value={result.ev.matchPoints} max={60} /></div>
                    <div>Movement cues {result.ev.cuePoints}/25<ScoreBar value={result.ev.cuePoints} max={25} color="bg-sand-400" /></div>
                    <div className="text-xs text-ink-300">AI observed: <b>{result.ev.observedId ? actionById(result.ev.observedId)?.name : '—'}</b> · confidence {Math.round(result.ev.confidence * 100)}%</div>
                  </div>
                )}
                <ul className="mt-2 space-y-0.5 text-xs">
                  {result.ev.cues.map((c) => <li key={c.id} className={c.passed ? 'text-green-300' : 'text-ink-300'}>{c.passed ? '✓' : '✗'} {c.label} ({Math.round(c.degree * 100)}%){c.required ? '' : ' · optional'}</li>)}
                </ul>
              </div>
              <div className="rounded-xl bg-ink-900 p-3">
                <div className="font-semibold">Guessers</div>
                {correct ? <p className="mt-2 text-sm text-green-300">✓ {nameOf(match, correct.playerId)} got it in {correct.atSec.toFixed(1)} s (+{GUESS_POINTS})</p> : <p className="mt-2 text-sm text-ink-300">No correct guess — 0 points.</p>}
                <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-ink-300">{guesses.map((g, i) => <li key={i}>{nameOf(match, g.playerId)}: “{g.text}” {g.correct ? '✓' : '✗'}</li>)}</ul>
              </div>
            </div>
            <details className="mt-3" open={result.ev.uncertain}>
              <summary className="cursor-pointer text-sm text-ink-300">Evidence & explanations</summary>
              <div className="mt-2 space-y-2">{roundEvidence.map((e) => <EvidenceCard key={e.id} match={live} ev={e} />)}</div>
            </details>
            <div className="mt-4 flex flex-wrap gap-2">
              {result.ev.uncertain && <button className="btn-ghost" onClick={() => next(true)}>Retry with a new action</button>}
              <button className="btn-primary flex-1" onClick={() => next(false)}>{turn + 1 >= turns.length ? 'See results' : 'Next turn'}</button>
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        {phase === 'perform' && (
          <Card>
            <h3 className="mb-2 text-lg font-bold">Guesses</h3>
            {guessers.length === 0 ? <Notice kind="warn">No one can guess in this setup (team mode needs at least two players per team).</Notice> : (
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); submitGuess(text); }}>
                <label className="label" htmlFor="guesser">Who is guessing?</label>
                <select id="guesser" className="input" value={guesser} onChange={(e) => setGuesser(e.target.value)}>
                  {guessers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <label className="label" htmlFor="guess">Guess</label>
                <input id="guess" className="input" autoComplete="off" maxLength={80} value={text} disabled={!!correct} onChange={(e) => setText(e.target.value)} placeholder="Type a guess and press Enter" />
                <div className="flex gap-2">
                  <button className="btn-primary flex-1" disabled={!!correct || !text.trim()}>Submit guess</button>
                  {settings.allowVoiceGuesses && SR && <button type="button" className="btn-ghost" disabled={!!correct || listening} onClick={voiceGuess}>{listening ? '🎙 Listening…' : '🎙 Speak'}</button>}
                </div>
                {settings.allowVoiceGuesses && SR && <p className="text-xs text-ink-300">Voice guesses use your browser’s speech service (in Chrome this is processed by Google). Only the recognised words are kept.</p>}
              </form>
            )}
            <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-sm">
              {guesses.slice().reverse().map((g, i) => <li key={i} className={g.correct ? 'text-green-300' : 'text-ink-200'}>{nameOf(match, g.playerId)}: “{g.text}” {g.correct ? '✓ correct!' : '✗'}</li>)}
            </ul>
            <button className="btn-ghost mt-3 w-full" disabled={elapsed < 3} onClick={finishPerformance}>Stop acting & judge</button>
          </Card>
        )}
        <Card>
          <h3 className="mb-2 font-bold">Scores</h3>
          <ol className="space-y-1">{standings.map((s) => <li key={s.subjectId} className="flex justify-between"><span>{s.rank}. {nameOf(live, s.subjectId)}</span><b className="tabular-nums">{s.points}</b></li>)}</ol>
          <p className="mt-2 text-xs text-ink-300">Performers earn up to 85 (AI match 60 + cues 25). The first correct guesser earns 15. These are kept separate.</p>
          <button className="btn-danger mt-3 w-full" onClick={endMatch}>End game</button>
        </Card>
      </div>
    </div>
  );
}

interface SpeechRec {
  lang: string; interimResults: boolean; maxAlternatives: number;
  onresult: (e: { results: { length: number; [i: number]: { transcript: string } }[] }) => void;
  onend: () => void; onerror: () => void; start(): void;
}
