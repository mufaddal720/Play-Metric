import { GAMES } from '../core/games';
import { useStore } from '../core/store';
import { computeOutcome, nameOf } from '../core/ruleEngine';
import { deleteMediaWithPrefix } from '../core/mediaStore';
import { formatUaeDateTime } from '../lib/time';
import { Card, SectionTitle } from '../ui/kit';

export function History() {
  const { matches, deleteMatch } = useStore();
  return (
    <div className="space-y-4">
      <SectionTitle sub="Saved on this device only. Dates and times are UAE local time (GST).">Match history</SectionTitle>
      {!matches.length && <Card><p className="text-ink-300">No matches yet. <a className="underline" href="#/setup/freeze">Start one</a>.</p></Card>}
      <ul className="space-y-2">
        {matches.map((m) => {
          const o = computeOutcome(m);
          return (
            <li key={m.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="font-semibold">{GAMES[m.gameId].emoji} {GAMES[m.gameId].name} <span className="chip ms-1 bg-ink-600 capitalize">{m.status}</span></div>
                <div className="text-sm text-ink-300">{formatUaeDateTime(m.createdAt)} · {(m.gameId === 'football' ? m.teams : m.mode === 'team' ? m.teams : m.players).map((p) => p.name).join(', ')}</div>
                <div className="text-sm">{o.kind === 'winner' ? `Winner: ${nameOf(m, o.subjectId)}` : o.kind === 'draw' ? 'Draw' : ''}</div>
              </div>
              <div className="flex gap-2">
                {m.status === 'active' ? <a className="btn-primary" href={`#/match/${m.id}`}>Resume</a> : <a className="btn-ghost" href={`#/results/${m.id}`}>View</a>}
                <button className="btn-ghost" aria-label="Delete match" onClick={async () => { if (confirm('Delete this match and its evidence?')) { deleteMatch(m.id); await deleteMediaWithPrefix(`snap:${m.id}`); await deleteMediaWithPrefix(`clip:${m.id}`); } }}>Delete</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
