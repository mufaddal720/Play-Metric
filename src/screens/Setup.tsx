import { useMemo, useState } from 'react';
import { GAMES } from '../core/games';
import { GAME_IDS, useStore } from '../core/store';
import type { Difficulty, GameId, JudgingSource, Player, PlayMode, Team } from '../core/types';
import { go } from '../lib/router';
import { Card, Notice, SectionTitle } from '../ui/kit';
import { POSES } from '../games/freeze/poses';
import { DEFAULT_TIMING, CHAOS_TIMING, validateTiming, type Timing } from '../games/freeze/roundMachine';
import type { FreezeConfig } from '../games/freeze/FreezeGame';
import type { FootballConfig } from '../games/football/FootballGame';
import type { ActionConfig } from '../games/action/ActionGame';

/** Validates a configuration before a match can start (§26 invalid match configuration). Pure, so it is unit-tested. */
export function validateSetup(game: GameId, mode: PlayMode, players: Player[], teams: Team[], opts: { freezeVariant?: FreezeConfig['variant']; timing?: Timing; rounds?: number; durationMin?: number }): string[] {
  const errs: string[] = [];
  const teamsUsed = teams.filter((t) => players.some((p) => p.teamId === t.id));
  if (game === 'football') {
    if (teams.length < 2) errs.push('Football needs two teams.');
    if (!opts.durationMin || opts.durationMin < 1 || opts.durationMin > 60) errs.push('Match duration must be 1–60 minutes.');
    return errs;
  }
  if (!players.length) errs.push('Add at least one player.');
  if (mode === 'team') {
    if (players.some((p) => !p.teamId)) errs.push('Assign every player to a team (or switch to individual mode).');
    if (teamsUsed.length < 2) errs.push('Team mode needs players in at least two teams.');
  }
  if (game === 'freeze') {
    if (players.length > 4) errs.push('At most 4 players can be judged in one camera frame. Select up to 4 players.');
    if (opts.freezeVariant === 'mirror' && players.length !== 2) errs.push('Mirror Match needs exactly 2 players.');
    if (opts.timing) { const e = validateTiming(opts.timing); if (e) errs.push(e); }
    if (!opts.rounds || opts.rounds < 1 || opts.rounds > 12) errs.push('Rounds must be 1–12.');
  }
  if (game === 'action') {
    if (players.length < 2) errs.push('Action Detective needs at least 2 players (one acts, others guess).');
    if (mode === 'team') {
      for (const t of teamsUsed) if (players.filter((p) => p.teamId === t.id).length < 2) errs.push(`Team “${t.name}” needs at least 2 players so someone can guess.`);
    }
    if (!opts.rounds || opts.rounds < 1 || opts.rounds > 5) errs.push('Turns per player must be 1–5.');
  }
  return errs;
}

export function Setup({ initialGame }: { initialGame: GameId }) {
  const s = useStore();
  const [game, setGame] = useState<GameId>(GAME_IDS.includes(initialGame) ? initialGame : 'freeze');
  const [mode, setMode] = useState<PlayMode>('individual');
  const [judging, setJudging] = useState<JudgingSource>('live');
  const [newName, setNewName] = useState('');
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(s.players.map((p) => p.id)));
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [rounds, setRounds] = useState(3);
  const [variant, setVariant] = useState<FreezeConfig['variant']>('classic');
  const [timing, setTiming] = useState<Timing>(DEFAULT_TIMING);
  const [poseIds, setPoseIds] = useState<string[]>([]);
  const [durationMin, setDurationMin] = useState(5);
  const [restart, setRestart] = useState<FootballConfig['restart']>('auto');
  const [detector, setDetector] = useState<FootballConfig['detector']>('fused');
  const [goalAwards, setGoalAwards] = useState<[string, string]>([s.teams[1]?.id ?? '', s.teams[0]?.id ?? '']);
  const [turns, setTurns] = useState(1);

  const effectiveMode: PlayMode = game === 'football' ? 'team' : variant === 'team' && game === 'freeze' ? 'team' : mode;
  const players = s.players.filter((p) => selected.has(p.id));
  const footballTeams = s.teams.slice(0, 2);
  const errors = useMemo(() => validateSetup(game, effectiveMode, players, s.teams, { freezeVariant: variant, timing, rounds: game === 'action' ? turns : rounds, durationMin }),
    [game, effectiveMode, players, s.teams, variant, timing, rounds, turns, durationMin]);

  function add() {
    const err = s.addPlayer(newName);
    setNameErr(err);
    if (!err) {
      setNewName('');
      const all = useStore.getState().players; const p = all[all.length - 1];
      if (p) setSelected((x) => new Set([...x, p.id]));
    }
  }

  function start() {
    if (errors.length) return;
    const teams = game === 'football' ? footballTeams : effectiveMode === 'team' ? s.teams.filter((t) => players.some((p) => p.teamId === t.id)) : [];
    const matchPlayers = game === 'football' ? [] : players.map((p) => ({ ...p, teamId: effectiveMode === 'team' ? p.teamId : undefined }));
    let config: Record<string, unknown>;
    if (game === 'freeze') {
      // Challenge order is shuffled (this only chooses which pose comes next — it never affects scoring).
      const pool = (poseIds.length ? poseIds : POSES.filter((p) => difficulty !== 'easy' || p.difficulty !== 'hard').map((p) => p.id))
        .map((id) => ({ id, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.id);
      const ordered = effectiveMode === 'team' ? [...matchPlayers].sort((a, b) => (a.teamId ?? '').localeCompare(b.teamId ?? '')) : matchPlayers;
      config = { variant, rounds, difficulty, timing: variant === 'chaos' ? { ...CHAOS_TIMING, freeze: timing.freeze } : timing, poseIds: pool, slotPlayerIds: ordered.map((p) => p.id) } satisfies FreezeConfig;
    } else if (game === 'football') {
      config = { durationMin, restart, detector, goalAwards } satisfies FootballConfig;
    } else {
      config = { difficulty, turnsPerPlayer: turns, performerIds: matchPlayers.map((p) => p.id) } satisfies ActionConfig;
    }
    const id = s.createMatch({ gameId: game, mode: effectiveMode, judging: game === 'action' ? 'live' : judging, config, players: matchPlayers, teams });
    go(`/match/${id}`);
  }

  return (
    <div className="space-y-5">
      <SectionTitle sub="Pick a game, add players, choose the rules, then start.">Match setup</SectionTitle>

      <div role="tablist" aria-label="Game" className="grid gap-2 sm:grid-cols-3">
        {GAME_IDS.map((id) => (
          <button key={id} role="tab" aria-selected={game === id} onClick={() => setGame(id)}
            className={`card p-4 text-start transition ${game === id ? 'border-uae-green ring-2 ring-uae-green' : 'hover:bg-ink-700'}`}>
            <div className="text-2xl">{GAMES[id].emoji} <span className="font-bold">{GAMES[id].name}</span></div>
            <div className="mt-1 text-sm text-ink-300">{GAMES[id].players}</div>
            <div className="text-xs text-ink-300">{GAMES[id].media}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {game !== 'football' ? (
          <Card>
            <h3 className="mb-3 text-lg font-bold">Players</h3>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <label htmlFor="new-player" className="sr-only">Player name</label>
              <input id="new-player" className="input" placeholder="First name or nickname" maxLength={24} value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button className="btn-primary shrink-0">Add</button>
            </form>
            {nameErr && <p className="mt-1 text-sm text-red-300" role="alert">{nameErr}</p>}
            <ul className="mt-3 space-y-2">
              {s.players.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-ink-900 p-2">
                  <input type="checkbox" aria-label={`Include ${p.name}`} className="h-5 w-5" checked={selected.has(p.id)}
                    onChange={(e) => setSelected((x) => { const n = new Set(x); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />
                  <input aria-label="Player name" className="input min-w-0 flex-1 !py-1.5" defaultValue={p.name} maxLength={24} onBlur={(e) => s.renamePlayer(p.id, e.target.value)} />
                  {effectiveMode === 'team' && (
                    <select aria-label={`Team for ${p.name}`} className="input w-auto !py-1.5" value={p.teamId ?? ''} onChange={(e) => s.setPlayerTeam(p.id, e.target.value || undefined)}>
                      <option value="">No team</option>
                      {s.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  )}
                  <button className="btn-ghost !min-h-0 px-3 py-1.5" aria-label={`Remove ${p.name}`} onClick={() => { s.removePlayer(p.id); setSelected((x) => { const n = new Set(x); n.delete(p.id); return n; }); }}>✕</button>
                </li>
              ))}
              {!s.players.length && <li className="text-sm text-ink-300">No players yet — add a name above.</li>}
            </ul>
            <p className="mt-2 text-xs text-ink-300">Names are stored only on this device.</p>
          </Card>
        ) : (
          <Card>
            <h3 className="mb-3 text-lg font-bold">Teams</h3>
            <p className="text-sm text-ink-300">Football is judged per team, so individual players are not needed.</p>
          </Card>
        )}

        <Card>
          <h3 className="mb-3 text-lg font-bold">Rules</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {game === 'freeze' && (
              <>
                <div className="sm:col-span-2">
                  <span className="label">Mode</span>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(['classic', 'chaos', 'mirror', 'team'] as const).map((v) => (
                      <button key={v} type="button" onClick={() => setVariant(v)} aria-pressed={variant === v}
                        className={`btn ${variant === v ? 'bg-uae-green' : 'bg-ink-700'} capitalize`}>{v === 'team' ? 'Team Freeze' : v === 'mirror' ? 'Mirror Match' : v}</button>
                    ))}
                  </div>
                </div>
                <Num label="Rounds" value={rounds} set={setRounds} min={1} max={12} />
                <Diff value={difficulty} set={setDifficulty} />
                <Num label="Prepare (s)" value={timing.prepare} set={(v) => setTiming({ ...timing, prepare: v })} min={2} max={15} />
                <Num label="Copy (s)" value={timing.copy} set={(v) => setTiming({ ...timing, copy: v })} min={3} max={20} />
                <Num label="Freeze (s)" value={timing.freeze} set={(v) => setTiming({ ...timing, freeze: v })} min={2} max={8} />
                <Judging value={judging} set={setJudging} />
                <details className="sm:col-span-2">
                  <summary className="cursor-pointer text-sm text-ink-300">Choose specific poses (optional)</summary>
                  <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {POSES.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={poseIds.includes(p.id)} onChange={(e) => setPoseIds((x) => (e.target.checked ? [...x, p.id] : x.filter((i) => i !== p.id)))} />
                        {p.emoji} {p.name} <span className="text-ink-300">({p.difficulty})</span>
                      </label>
                    ))}
                  </div>
                </details>
              </>
            )}
            {game === 'football' && (
              <>
                {footballTeams.map((t, i) => (
                  <div key={t.id}>
                    <label className="label" htmlFor={`team-${t.id}`}>Team {i + 1} name</label>
                    <input id={`team-${t.id}`} className="input" defaultValue={t.name} maxLength={24} onBlur={(e) => s.renameTeam(t.id, e.target.value)} />
                  </div>
                ))}
                <Num label="Match length (min)" value={durationMin} set={setDurationMin} min={1} max={60} />
                <div>
                  <label className="label" htmlFor="restart">Restart rule after a goal</label>
                  <select id="restart" className="input" value={restart} onChange={(e) => setRestart(e.target.value as FootballConfig['restart'])}>
                    <option value="auto">Automatic: ball back in play for 1.5 s</option>
                    <option value="host">Host presses Kick-off</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="detector">Ball detection</label>
                  <select id="detector" className="input" value={detector} onChange={(e) => setDetector(e.target.value as FootballConfig['detector'])}>
                    <option value="fused">Colour tracker + AI detector (recommended)</option>
                    <option value="colour">Colour tracker only</option>
                    <option value="ml">AI “sports ball” detector only</option>
                  </select>
                </div>
                {[0, 1].map((i) => (
                  <div key={i}>
                    <label className="label" htmlFor={`award-${i}`}>Ball in Goal {i + 1} scores for</label>
                    <select id={`award-${i}`} className="input" value={goalAwards[i]} onChange={(e) => setGoalAwards((g) => { const n: [string, string] = [...g]; n[i] = e.target.value; return n; })}>
                      {footballTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                ))}
                <Judging value={judging} set={setJudging} />
              </>
            )}
            {game === 'action' && (
              <>
                <div className="sm:col-span-2">
                  <span className="label">Mode</span>
                  <div className="grid grid-cols-2 gap-2">
                    {(['individual', 'team'] as const).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`btn capitalize ${mode === m ? 'bg-uae-green' : 'bg-ink-700'}`}>{m}</button>)}
                  </div>
                </div>
                <Diff value={difficulty} set={setDifficulty} />
                <Num label="Turns per player" value={turns} set={setTurns} min={1} max={5} />
                <p className="text-sm text-ink-300 sm:col-span-2">Time limit per turn: easy 60 s, medium 45 s, hard 40 s. Action Detective is judged live.</p>
              </>
            )}
          </div>
          {effectiveMode === 'team' && game !== 'football' && (
            <div className="mt-4">
              <span className="label">Teams</span>
              <div className="space-y-2">
                {s.teams.map((t) => (
                  <div key={t.id} className="flex items-center gap-2">
                    <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden />
                    <input aria-label="Team name" className="input !py-1.5" defaultValue={t.name} maxLength={24} onBlur={(e) => s.renameTeam(t.id, e.target.value)} />
                    {s.teams.length > 2 && <button className="btn-ghost !min-h-0 px-3 py-1.5" onClick={() => s.removeTeam(t.id)} aria-label={`Remove team ${t.name}`}>✕</button>}
                  </div>
                ))}
                {s.teams.length < 4 && <button className="btn-ghost" onClick={() => s.addTeam()}>Add team</button>}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h3 className="mb-2 font-bold">Before you start — {GAMES[game].name}</h3>
        <p className="text-ink-200">{GAMES[game].objective}</p>
        <p className="mt-1 text-sm text-ink-300">Equipment: {GAMES[game].equipment}. <a href="#/how" className="underline">Full rules</a></p>
        {errors.length > 0 && <div className="mt-3"><Notice kind="warn" title="Fix these to start">{errors.map((e) => <div key={e}>• {e}</div>)}</Notice></div>}
        <button className="btn-primary mt-4 w-full text-lg sm:w-auto sm:px-10" disabled={errors.length > 0} onClick={start}>Start match</button>
      </Card>
    </div>
  );
}

function Num({ label, value, set, min, max }: { label: string; value: number; set: (v: number) => void; min: number; max: number }) {
  const id = `num-${label.replace(/\W+/g, '-')}`;
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} type="number" className="input" min={min} max={max} value={value} onChange={(e) => set(Math.round(Number(e.target.value)))} />
    </div>
  );
}
function Diff({ value, set }: { value: Difficulty; set: (d: Difficulty) => void }) {
  return (
    <div>
      <label className="label" htmlFor="difficulty">Difficulty</label>
      <select id="difficulty" className="input" value={value} onChange={(e) => set(e.target.value as Difficulty)}>
        <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
      </select>
    </div>
  );
}
function Judging({ value, set }: { value: JudgingSource; set: (j: JudgingSource) => void }) {
  return (
    <div>
      <label className="label" htmlFor="judging">Judging</label>
      <select id="judging" className="input" value={value} onChange={(e) => set(e.target.value as JudgingSource)}>
        <option value="live">Live camera</option>
        <option value="recorded">Recorded video file</option>
      </select>
    </div>
  );
}
