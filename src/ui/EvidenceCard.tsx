import { useEffect, useState } from 'react';
import type { Evidence, MatchRecord } from '../core/types';
import { loadMedia } from '../core/mediaStore';
import { reviewEvidence } from '../core/matchOps';
import { nameOf } from '../core/ruleEngine';
import { formatUaeTime } from '../lib/time';
import { Modal, Notice, StatusBadge } from './kit';

export function useMediaUrl(key?: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!key) { setUrl(null); return; }
    let u: string | null = null, live = true;
    loadMedia(key).then((b) => { if (b && live) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [key]);
  return url;
}

export function EvidenceCard({ match, ev, allowReview = true, compact = false }: { match: MatchRecord; ev: Evidence; allowReview?: boolean; compact?: boolean }) {
  const img = useMediaUrl(ev.snapshotKey);
  const clip = useMediaUrl(ev.clipKey);
  const [open, setOpen] = useState(false);
  const [showData, setShowData] = useState(false);
  return (
    <div className="rounded-xl border border-ink-600 bg-ink-900/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">{nameOf(match, ev.subjectId)} · <span className="text-ink-300">{ev.scoreComponent}</span></div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-black tabular-nums">{ev.scoreAwarded === null ? '—' : ev.scoreAwarded}<span className="text-sm font-medium text-ink-300">/{ev.maxScore}</span></span>
          <StatusBadge status={ev.status} />
        </div>
      </div>
      {ev.uncertain && !ev.hostReview && (
        <div className="mt-2"><Notice kind="warn" title="Uncertain — no automatic score">{ev.uncertaintyReason}</Notice></div>
      )}
      <div className={`mt-2 grid gap-3 ${img && !compact ? 'sm:grid-cols-[160px_1fr]' : ''}`}>
        {img && !compact && <img src={img} alt="Evidence frame analysed by the AI" className="w-full rounded-lg border border-ink-600" />}
        <div className="space-y-1 text-sm">
          <p className="text-ink-200"><span className="text-ink-300">Observed: </span>{ev.observation}</p>
          <p>{ev.explanation}</p>
          <p className="text-xs text-ink-300">Rule: {ev.rule} · Confidence {Math.round(ev.confidence * 100)}% · {formatUaeTime(ev.timestamp)} GST{ev.mediaTimeSec !== undefined ? ` · t=${ev.mediaTimeSec.toFixed(1)} s` : ''}</p>
          {ev.hostReview && (
            <p className="rounded-lg bg-sand-400/10 p-2 text-xs text-sand-200">
              Host review ({ev.hostReview.decision.replace('_', ' ')}): original AI result {ev.hostReview.originalScore ?? 'no score'} ({ev.hostReview.originalStatus.replace('_', ' ')}) → {ev.hostReview.newScore ?? 'no score'}. Note: “{ev.hostReview.note}” at {formatUaeTime(ev.hostReview.at)} GST
            </p>
          )}
          {clip && <video src={clip} controls className="mt-2 w-full max-w-sm rounded-lg" />}
          <div className="flex flex-wrap gap-2 pt-1">
            <button className="text-xs text-ink-300 underline" onClick={() => setShowData(!showData)}>{showData ? 'Hide' : 'Show'} measurements</button>
            {allowReview && !ev.hostReview && match.status === 'active' && (
              <button className="text-xs font-semibold text-sand-200 underline" onClick={() => setOpen(true)}>Host review…</button>
            )}
          </div>
          {showData && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 rounded-lg bg-ink-800 p-2 font-mono text-[11px] text-ink-200 sm:grid-cols-3">
              {Object.entries(ev.measurements).map(([k, v]) => <div key={k} className="truncate"><dt className="inline text-ink-300">{k}: </dt><dd className="inline">{String(v)}</dd></div>)}
            </dl>
          )}
        </div>
      </div>
      <ReviewModal open={open} onClose={() => setOpen(false)} match={match} ev={ev} />
    </div>
  );
}

function ReviewModal({ open, onClose, match, ev }: { open: boolean; onClose: () => void; match: MatchRecord; ev: Evidence }) {
  const [decision, setDecision] = useState<'confirm' | 'reject' | 'set_score'>(ev.uncertain ? 'set_score' : 'confirm');
  const [score, setScore] = useState<number>(ev.scoreAwarded ?? (ev.maxScore === 1 ? 1 : 0));
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    const s = decision === 'reject' ? null : decision === 'confirm' ? (ev.scoreAwarded ?? (ev.maxScore === 1 ? 1 : null)) : score;
    if (decision === 'confirm' && s === null) { setErr('There is no AI score to confirm. Choose “Set score” instead.'); return; }
    const e = reviewEvidence(match.id, ev.id, decision, s, note);
    if (e) setErr(e); else onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={`Host review — ${nameOf(match, ev.subjectId)}`}>
      <p className="mb-3 text-sm text-ink-200">The original AI result ({ev.scoreAwarded ?? 'no score'}) is kept on record and your decision is labelled as host-reviewed in the results.</p>
      <fieldset className="mb-3 space-y-2">
        <legend className="label">Decision</legend>
        {ev.maxScore === 1 ? (
          <>
            <label className="flex items-center gap-2"><input type="radio" checked={decision === 'set_score' && score === 1} onChange={() => { setDecision('set_score'); setScore(1); }} /> Count this goal (manually reviewed)</label>
            <label className="flex items-center gap-2"><input type="radio" checked={decision === 'reject'} onChange={() => setDecision('reject')} /> No goal</label>
          </>
        ) : (
          <>
            {!ev.uncertain && <label className="flex items-center gap-2"><input type="radio" checked={decision === 'confirm'} onChange={() => setDecision('confirm')} /> Confirm the AI score</label>}
            <label className="flex items-center gap-2"><input type="radio" checked={decision === 'set_score'} onChange={() => setDecision('set_score')} /> Set a score</label>
            <label className="flex items-center gap-2"><input type="radio" checked={decision === 'reject'} onChange={() => setDecision('reject')} /> Award no points</label>
          </>
        )}
      </fieldset>
      {decision === 'set_score' && ev.maxScore > 1 && (
        <div className="mb-3">
          <label className="label" htmlFor="rv-score">Score (0–{ev.maxScore})</label>
          <input id="rv-score" type="number" min={0} max={ev.maxScore} className="input" value={score} onChange={(e) => setScore(Number(e.target.value))} />
        </div>
      )}
      <label className="label" htmlFor="rv-note">Reason (required)</label>
      <textarea id="rv-note" className="input min-h-[80px]" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Ball clearly crossed the line on the replay" />
      {err && <p className="mt-2 text-sm text-red-300" role="alert">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit}>Save review</button>
      </div>
    </Modal>
  );
}
