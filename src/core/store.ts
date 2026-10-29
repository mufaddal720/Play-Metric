import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GameId, MatchRecord, Player, Team } from './types';
import { uid } from '../lib/ids';

export const TEAM_COLORS = ['#E4002B', '#00843D', '#F5F5F5', '#C8A96A'];

export interface Settings {
  lang: 'en' | 'ar';
  rtlPreview: boolean;
  saveClips: boolean;
  allowVoiceGuesses: boolean;
  largeText: boolean;
  privacyAccepted: boolean;
}

/** The round currently in progress, persisted so a refresh can be detected and recovered safely. */
export interface InFlightRound { matchId: string; roundId: string; phase: string; startedAt: string }

interface State {
  players: Player[];
  teams: Team[];
  settings: Settings;
  matches: MatchRecord[];
  inFlight: InFlightRound | null;
  addPlayer(name: string): string | null;
  renamePlayer(id: string, name: string): void;
  removePlayer(id: string): void;
  setPlayerTeam(id: string, teamId: string | undefined): void;
  addTeam(name?: string): void;
  renameTeam(id: string, name: string): void;
  removeTeam(id: string): void;
  updateSettings(p: Partial<Settings>): void;
  createMatch(m: Omit<MatchRecord, 'id' | 'createdAt' | 'status' | 'rounds' | 'evidence' | 'scoreEvents' | 'achievements'>): string;
  updateMatch(id: string, fn: (m: MatchRecord) => MatchRecord): void;
  deleteMatch(id: string): void;
  clearHistory(): void;
  setInFlight(r: InFlightRound | null): void;
}

export const MAX_NAME = 24;
export const sanitizeName = (s: string) => s.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

export const useStore = create<State>()(
  persist(
    (setState, getState) => ({
      players: [],
      teams: [
        { id: 'team_falcons', name: 'Falcons', color: TEAM_COLORS[0] },
        { id: 'team_oryx', name: 'Oryx', color: TEAM_COLORS[1] },
      ],
      settings: { lang: 'en', rtlPreview: false, saveClips: false, allowVoiceGuesses: false, largeText: false, privacyAccepted: false },
      matches: [],
      inFlight: null,
      addPlayer(name) {
        const n = sanitizeName(name);
        if (!n) return 'Please enter a name.';
        if (getState().players.some((p) => p.name.toLowerCase() === n.toLowerCase())) return 'That name is already in use.';
        if (getState().players.length >= 12) return 'Up to 12 players can be added.';
        setState((s) => ({ players: [...s.players, { id: uid('p'), name: n }] }));
        return null;
      },
      renamePlayer(id, name) {
        const n = sanitizeName(name);
        if (n) setState((s) => ({ players: s.players.map((p) => (p.id === id ? { ...p, name: n } : p)) }));
      },
      removePlayer(id) { setState((s) => ({ players: s.players.filter((p) => p.id !== id) })); },
      setPlayerTeam(id, teamId) { setState((s) => ({ players: s.players.map((p) => (p.id === id ? { ...p, teamId } : p)) })); },
      addTeam(name) {
        setState((s) => s.teams.length >= 4 ? s : {
          teams: [...s.teams, { id: uid('t'), name: sanitizeName(name ?? '') || `Team ${s.teams.length + 1}`, color: TEAM_COLORS[s.teams.length % TEAM_COLORS.length] }],
        });
      },
      renameTeam(id, name) {
        const n = sanitizeName(name);
        if (n) setState((s) => ({ teams: s.teams.map((t) => (t.id === id ? { ...t, name: n } : t)) }));
      },
      removeTeam(id) {
        setState((s) => s.teams.length <= 2 ? s : {
          teams: s.teams.filter((t) => t.id !== id),
          players: s.players.map((p) => (p.teamId === id ? { ...p, teamId: undefined } : p)),
        });
      },
      updateSettings(p) { setState((s) => ({ settings: { ...s.settings, ...p } })); },
      createMatch(m) {
        const id = uid('match');
        const rec: MatchRecord = { ...m, id, createdAt: new Date().toISOString(), status: 'active', rounds: [], evidence: [], scoreEvents: [], achievements: [] };
        // Only one active match at a time: older unfinished matches are marked abandoned.
        setState((s) => ({ matches: [rec, ...s.matches.map((x) => (x.status === 'active' ? { ...x, status: 'abandoned' as const } : x))] }));
        return id;
      },
      updateMatch(id, fn) { setState((s) => ({ matches: s.matches.map((x) => (x.id === id ? fn(x) : x)) })); },
      deleteMatch(id) { setState((s) => ({ matches: s.matches.filter((x) => x.id !== id) })); },
      clearHistory() { setState({ matches: [], inFlight: null }); },
      setInFlight(r) { setState({ inFlight: r }); },
    }),
    {
      name: 'uae-ai-gameday-v1',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);

export function getMatch(id: string): MatchRecord | undefined {
  return useStore.getState().matches.find((m) => m.id === id);
}

export const GAME_IDS: GameId[] = ['freeze', 'football', 'action'];
