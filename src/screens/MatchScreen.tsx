import { GAMES } from '../core/games';
import { useStore } from '../core/store';
import { Notice } from '../ui/kit';
import { FreezeGame } from '../games/freeze/FreezeGame';
import { FootballGame } from '../games/football/FootballGame';
import { ActionGame } from '../games/action/ActionGame';

export function MatchScreen({ id }: { id: string }) {
  // Read once on mount: the game components subscribe to live updates themselves.
  const match = useStore((s) => s.matches.find((m) => m.id === id));
  if (!match) return <Notice kind="error" title="Match not found">It may have been deleted. <a className="underline" href="#/">Home</a></Notice>;
  if (match.status !== 'active') return <Notice title="This match is finished"><a className="underline" href={`#/results/${id}`}>See the results</a></Notice>;
  const g = GAMES[match.gameId];
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-black">{g.emoji} {g.name}</h1>
      <p className="hidden rounded-xl border border-ink-600 bg-ink-800 p-2 text-sm text-ink-200 portrait:block md:portrait:hidden">↻ Tip: turn your phone sideways (landscape) for a wider camera view and more reliable judging.</p>
      {match.gameId === 'freeze' && <FreezeGame key={id} match={match} />}
      {match.gameId === 'football' && <FootballGame key={id} match={match} />}
      {match.gameId === 'action' && <ActionGame key={id} match={match} />}
    </div>
  );
}
