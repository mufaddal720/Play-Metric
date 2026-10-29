export type GameId = 'freeze' | 'football' | 'action';
export type PlayMode = 'individual' | 'team';
export type JudgingSource = 'live' | 'recorded';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Player { id: string; name: string; teamId?: string }
export interface Team { id: string; name: string; color: string }

/**
 * automatic      – computed by the AI pipeline + rules engine with no human input
 * host_reviewed  – the host confirmed, rejected or set a score; the original AI result is preserved
 * pending_review – the AI was uncertain; no score is awarded until the host reviews or a retake happens
 * not_scored     – the AI was uncertain and the host chose not to award anything (or a retake replaced it)
 */
export type JudgingStatus = 'automatic' | 'host_reviewed' | 'pending_review' | 'not_scored';

export type EvidenceType =
  | 'pose_landmarks' | 'ball_track' | 'action_sequence' | 'guess_text' | 'guess_voice' | 'host_review';

export interface HostReview {
  originalScore: number | null;
  originalStatus: JudgingStatus;
  decision: 'confirm' | 'reject' | 'set_score' | 'retake';
  newScore: number | null;
  note: string;
  at: string;
}

/** Shared evidence format used by all three games (§22). */
export interface Evidence {
  id: string;
  matchId: string;
  gameId: GameId;
  roundId: string;
  subjectId: string;          // player or team id
  subjectType: 'player' | 'team';
  timestamp: string;          // ISO, displayed in UAE time
  mediaTimeSec?: number;      // time within the round / recording
  evidenceType: EvidenceType;
  observation: string;        // what was measured, in plain words
  measurements: Record<string, number | string | boolean>;
  confidence: number;         // 0..1
  uncertain: boolean;
  uncertaintyReason?: string;
  rule: string;               // the rule that was applied
  scoreComponent: string;
  scoreAwarded: number | null; // null = no score (uncertain / not applicable)
  maxScore: number;
  explanation: string;
  status: JudgingStatus;
  snapshotKey?: string;       // IndexedDB key of the evidence frame
  clipKey?: string;           // IndexedDB key of an optional saved recording
  hostReview?: HostReview;
}

/** A points award produced by the rules engine. `id` is the idempotency key used for duplicate prevention. */
export interface ScoreEvent {
  id: string;
  roundId: string;
  subjectId: string;
  points: number;
  component: string;
  evidenceIds: string[];
  at: string;
}

export interface RoundSubjectResult {
  subjectId: string;
  total: number | null;
  breakdown: { component: string; points: number | null; max: number }[];
  status: JudgingStatus;
  note?: string;
}

export interface RoundRecord {
  id: string;
  index: number;
  label: string;
  startedAt: string;
  completedAt?: string;
  results: RoundSubjectResult[];
  evidenceIds: string[];
  info?: Record<string, string | number | boolean>;
  interrupted?: boolean;
}

export interface Achievement { id: string; title: string; subjectId: string; reason: string }

export interface MatchRecord {
  id: string;
  gameId: GameId;
  createdAt: string;
  finishedAt?: string;
  status: 'active' | 'completed' | 'abandoned';
  mode: PlayMode;
  judging: JudgingSource;
  config: Record<string, unknown>;
  players: Player[];
  teams: Team[];
  rounds: RoundRecord[];
  evidence: Evidence[];
  scoreEvents: ScoreEvent[];
  achievements: Achievement[];
}
