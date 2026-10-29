import { GAMES } from '../core/games';
import { getMatch, useStore } from '../core/store';
import { computeOutcome, computeStandings, nameOf } from '../core/ruleEngine';
import { formatUaeDateTime } from '../lib/time';
import { go } from '../lib/router';
import { Card, Notice, SectionTitle, StatusBadge } from '../ui/kit';
import { EvidenceCard } from '../ui/EvidenceCard';

export function Results({ id }: { id: string }) {
  const m = useStore((s) => s.matches.find((x) => x.id === id));
  const createMatch = useStore((s) => s.createMatch);
  if (!m) return <Notice kind="error" title="Match not found">It may have been deleted. <a className="underline" href="#/history">Back to history</a></Notice>;
  const game = GAMES[m.gameId];
  const standings = computeStandings(m);
  const outcome = computeOutcome(m);
  const reviewed = m.evidence.filter((e) => e.hostReview);
  const pending = m.evidence.filter((e) => e.status === 'pending_review');
  const rounds = m.rounds.slice().sort((a, b) => a.index - b.index);

  function rematch() {
    const src = getMatch(id)!;
    const { calibration: _c, elapsedSec: _e, ...config } = src.config as Record<string, unknown>;
    const keepCal = src.gameId === 'football' && src.judging === 'live' ? { calibration: (src.config as Record<string, unknown>).calibration } : {};
    const nid = createMatch({ gameId: src.gameId, mode: src.mode, judging: src.judging, config: { ...config, ...keepCal }, players: src.players, teams: src.teams });
    go(`/match/${nid}`);
  }

  return (
    <div className="space-y-5">
      <SectionTitle sub={`${formatUaeDateTime(m.createdAt)} · ${m.mode === 'team' ? 'Teams' : 'Individual'} · ${m.judging === 'live' ? 'Live camera' : 'Recorded video'}${m.status !== 'completed' ? ` · ${m.status}` : ''}`}>
        {game.emoji} {game.name} — results
      </SectionTitle>

      <Card className="text-center">
        <div className="text-sm uppercase tracking-widest text-ink-300">{outcome.kind === 'draw' ? 'Result' : 'Winner'}</div>
        <div className="mt-1 text-4xl font-black">
          {outcome.kind === 'winner' ? `🏆 ${nameOf(m, outcome.subjectId)}` : outcome.kind === 'draw' ? `Draw: ${outcome.subjectIds.map((s) => nameOf(m, s)).join(' & ')}` : '—'}
        </div>
        <ol className="mx-auto mt-4 max-w-md space-y-1 text-start">
          {standings.map((s) => (
            <li key={s.subjectId} className="flex items-center justify-between rounded-lg bg-ink-900 px-3 py-2">
              <span><b className="me-2 text-ink-300">#{s.rank}</b>{nameOf(m, s.subjectId)}</span>
              <span className="text-xl font-black tabular-nums">{s.points}{m.gameId === 'football' ? '' : ' pts'}</span>
            </li>
          ))}
        </ol>
        {m.gameId === 'action' && <p className="mt-2 text-xs text-ink-300">Totals combine performer points (AI match + cues) and guessing points, which are shown separately in each turn below.</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button className="btn-primary" onClick={rematch}>Rematch</button>
          <a className="btn-ghost" href={`#/setup/${m.gameId}`}>New setup</a>
          <a className="btn-ghost" href="#/">Back to home</a>
        </div>
      </Card>

      {m.achievements.length > 0 && (
        <Card>
          <h3 className="mb-2 text-lg font-bold">Achievements</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {m.achievements.map((a) => <li key={a.id + a.subjectId} className="rounded-xl bg-ink-900 p-3"><b>🏅 {a.title}</b> — {nameOf(m, a.subjectId)}<div className="text-sm text-ink-300">{a.reason}</div></li>)}
          </ul>
        </Card>
      )}

      {pending.length > 0 && <Notice kind="warn" title={`${pending.length} result(s) were never reviewed`}>They did not count towards the score.</Notice>}
      {reviewed.length > 0 && <Notice kind="info" title={`${reviewed.length} decision(s) were reviewed by the host`}>Each one shows the original AI result next to the host’s decision below.</Notice>}

      {m.gameId !== 'football' ? (
        <Card>
          <h3 className="mb-3 text-lg font-bold">Round by round</h3>
          <div className="space-y-3">
            {rounds.map((r) => (
              <details key={r.id} className="rounded-xl border border-ink-600 p-3">
                <summary className="cursor-pointer">
                  <span className="font-semibold">{r.label}</span>
                  {r.interrupted && <span className="chip ms-2 bg-ink-600">Interrupted — not scored</span>}
                  {r.info?.retaken && <span className="chip ms-2 bg-ink-600">Retaken</span>}
                  <span className="ms-2 text-sm text-ink-300">{r.results.map((x) => `${nameOf(m, x.subjectId)} ${x.total ?? '—'}`).join(' · ')}</span>
                </summary>
                {r.results.length > 0 && (
                  <table className="mt-3 w-full text-sm">
                    <thead><tr className="text-start text-ink-300"><th className="text-start">Player / team</th>{r.results[0].breakdown.map((b) => <th key={b.component} className="text-end">{b.component}</th>)}<th className="text-end">Total</th><th /></tr></thead>
                    <tbody>{r.results.map((x) => (
                      <tr key={x.subjectId} className="border-t border-ink-700">
                        <td className="py-1">{nameOf(m, x.subjectId)}</td>
                        {x.breakdown.map((b) => <td key={b.component} className="text-end tabular-nums">{b.points ?? '—'}/{b.max}</td>)}
                        <td className="text-end font-bold tabular-nums">{x.total ?? '—'}</td>
                        <td className="text-end"><StatusBadge status={m.evidence.find((e) => r.evidenceIds.includes(e.id) && e.subjectId === x.subjectId)?.status ?? x.status} /></td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
                <div className="mt-3 space-y-2">{m.evidence.filter((e) => e.roundId === r.id).map((e) => <EvidenceCard key={e.id} match={m} ev={e} />)}</div>
              </details>
            ))}
            {!rounds.length && <p className="text-ink-300">No rounds were played.</p>}
          </div>
        </Card>
      ) : (
        <Card>
          <h3 className="mb-3 text-lg font-bold">Goal events</h3>
          <div className="space-y-2">
            {m.evidence.slice().sort((a, b) => (a.mediaTimeSec ?? 0) - (b.mediaTimeSec ?? 0)).map((e) => <EvidenceCard key={e.id} match={m} ev={e} />)}
            {!m.evidence.length && <p className="text-ink-300">No goal events were detected.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
