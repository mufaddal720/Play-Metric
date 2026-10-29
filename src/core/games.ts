import type { GameId } from './types';

export interface GameInfo {
  id: GameId;
  name: string;
  emoji: string;
  objective: string;
  players: string;
  equipment: string;
  media: string;
  accent: string;
  modes: string;
}

export const GAMES: Record<GameId, GameInfo> = {
  freeze: {
    id: 'freeze', name: 'Freeze & Fool', emoji: '🧊',
    objective: 'Copy the target pose, then FREEZE. The AI measures how closely your body matches and how still you stay.',
    players: '1–4 in frame at once · individual or teams', equipment: 'A camera that can see everyone from head to toe',
    media: 'Video (pose analysis on device)', accent: 'from-uae-green/30', modes: 'Classic · Chaos · Mirror Match · Team Freeze',
  },
  football: {
    id: 'football', name: 'AI Football', emoji: '⚽',
    objective: 'Small-sided football with two mini goals. The AI tracks the ball and only counts a goal when it sees the ball cross the goal line.',
    players: '2 teams, any size', equipment: 'A brightly coloured ball, two small goals, a camera on a stand',
    media: 'Video (ball tracking on device)', accent: 'from-uae-red/30', modes: 'Timed match · live or recorded video',
  },
  action: {
    id: 'action', name: 'Action Detective', emoji: '🕵️',
    objective: 'Act out a secret action without speaking. Everyone else guesses. The AI checks the movement and the answers.',
    players: '2–12 · individual or teams', equipment: 'A camera that can see the performer’s whole upper body',
    media: 'Video (movement analysis) · optional voice guesses', accent: 'from-sand-400/30', modes: 'Easy · Medium · Hard',
  },
};
