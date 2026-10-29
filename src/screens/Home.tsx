import { GAMES } from '../core/games';
import { GAME_IDS, useStore } from '../core/store';
import { useT } from '../i18n';
import { formatUaeDateTime } from '../lib/time';
import { computeOutcome, nameOf } from '../core/ruleEngine';

export function Home() {
  const t = useT();
  const matches = useStore((s) => s.matches);
  const active = matches.find((m) => m.status === 'active');
  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-ink-600 bg-gradient-to-br from-ink-800 to-ink-900 p-6 sm:p-10">
        <div className="absolute inset-y-0 start-0 w-2 bg-uae-red" aria-hidden />
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sand-400">{t('location')} · Family AI Game Day · Cycle 3</p>
          <h1 className="mt-3 text-3xl font-black leading-tight sm:text-5xl">{t('gameTitle')}</h1>
          <p className="mt-3 text-lg text-ink-200">{t('tagline')}</p>
          <p className="mt-3 text-ink-300">{t('intro')}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a className="btn-primary px-6 text-lg" href="#/setup/freeze">{t('play')}</a>
            <a className="btn-ghost" href="#/how">{t('howToPlay')}</a>
            <a className="btn-ghost" href="#/history">{t('history')}</a>
            <a className="btn-ghost" href="#/settings">{t('settings')}</a>
          </div>
        </div>
      </section>

      {active && (
        <a href={`#/match/${active.id}`} className="card flex items-center justify-between gap-3 border-uae-green/60 p-4 hover:bg-ink-700">
          <span><b>Continue match:</b> {GAMES[active.gameId].name} · started {formatUaeDateTime(active.createdAt)}</span>
          <span className="btn-primary">Resume</span>
        </a>
      )}

      <section aria-labelledby="games-h">
        <h2 id="games-h" className="mb-4 text-2xl font-bold">Choose a game</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {GAME_IDS.map((id) => {
            const g = GAMES[id];
            return (
              <article key={id} className={`card flex flex-col overflow-hidden bg-gradient-to-b ${g.accent} to-ink-800/80 p-5`}>
                <div className="text-5xl" aria-hidden>{g.emoji}</div>
                <h3 className="mt-3 text-2xl font-extrabold">{g.name}</h3>
                <p className="mt-2 flex-1 text-ink-200">{g.objective}</p>
                <dl className="mt-4 space-y-1 text-sm">
                  <div><dt className="inline text-ink-300">{t('players')}: </dt><dd className="inline">{g.players}</dd></div>
                  <div><dt className="inline text-ink-300">{t('equipment')}: </dt><dd className="inline">{g.equipment}</dd></div>
                  <div><dt className="inline text-ink-300">{t('needs')}: </dt><dd className="inline">{g.media}</dd></div>
                  <div><dt className="inline text-ink-300">Modes: </dt><dd className="inline">{g.modes}</dd></div>
                </dl>
                <a href={`#/setup/${id}`} className="btn-primary mt-5">{t('play')} {g.name}</a>
              </article>
            );
          })}
        </div>
      </section>

      {matches.filter((m) => m.status === 'completed').length > 0 && (
        <section>
          <h2 className="mb-3 text-xl font-bold">Recent results</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {matches.filter((m) => m.status === 'completed').slice(0, 4).map((m) => {
              const o = computeOutcome(m);
              return (
                <li key={m.id}><a href={`#/results/${m.id}`} className="card block p-3 hover:bg-ink-700">
                  <div className="font-semibold">{GAMES[m.gameId].emoji} {GAMES[m.gameId].name}</div>
                  <div className="text-sm text-ink-300">{formatUaeDateTime(m.finishedAt ?? m.createdAt)} · {o.kind === 'winner' ? `Winner: ${nameOf(m, o.subjectId)}` : o.kind === 'draw' ? 'Draw' : '—'}</div>
                </a></li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
