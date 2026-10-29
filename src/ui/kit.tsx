import { type ReactNode, useEffect, useRef } from 'react';
import type { JudgingStatus } from '../core/types';
import { useT } from '../i18n';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-4 sm:p-6 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-bold sm:text-2xl">{children}</h2>
      {sub && <p className="mt-1 text-ink-300">{sub}</p>}
    </div>
  );
}

export function StatusBadge({ status }: { status: JudgingStatus }) {
  const t = useT();
  const map: Record<JudgingStatus, [string, string]> = {
    automatic: [t('automatic'), 'bg-uae-green/20 text-green-300 border border-uae-green/50'],
    host_reviewed: [t('hostReviewed'), 'bg-sand-400/20 text-sand-200 border border-sand-400/50'],
    pending_review: [t('pendingReview'), 'bg-uae-red/20 text-red-200 border border-uae-red/50'],
    not_scored: [t('notScored'), 'bg-ink-600 text-ink-200 border border-ink-500'],
  };
  const [label, cls] = map[status];
  return <span className={`chip ${cls}`}>{label}</span>;
}

export function Notice({ kind = 'info', title, children }: { kind?: 'info' | 'warn' | 'error' | 'ok'; title?: string; children: ReactNode }) {
  const cls = {
    info: 'border-ink-500 bg-ink-700/60',
    warn: 'border-sand-400/60 bg-sand-400/10',
    error: 'border-uae-red/70 bg-uae-red/10',
    ok: 'border-uae-green/70 bg-uae-green/10',
  }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${cls}`}>
      {title && <div className="mb-1 font-semibold">{title}</div>}
      <div className="text-ink-200">{children}</div>
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center" onClick={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className="card max-h-[90vh] w-full max-w-lg overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold">{title}</h3>
          <button className="btn-ghost !min-h-0 px-3 py-1" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ScoreBar({ value, max, color = 'bg-uae-green' }: { value: number | null; max: number; color?: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-ink-600" aria-hidden>
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Countdown({ seconds, label }: { seconds: number; label: string }) {
  return (
    <div className="text-center" aria-live="polite">
      <div className="text-sm uppercase tracking-widest text-ink-300">{label}</div>
      <div className="text-6xl font-black tabular-nums sm:text-7xl">{Math.ceil(seconds)}</div>
    </div>
  );
}
