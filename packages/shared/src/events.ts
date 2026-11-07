/**
 * Socket.IO event contracts, shared by client and server.
 *
 * Both directions are typed here so the backend, the player and the host can
 * never drift apart (ADR 0003). The server is authoritative: every client
 * message carries an acknowledgement typed as `Ack<T>`.
 *
 * Namespaces (ADR 0003):
 *   `/`      – players
 *   `/host`  – hosts, authenticated by session cookie
 */

import type { GamePhase, QuestionType } from './constants.js';
import type { Question } from './questions.js';
import type { RankablePlayer } from './scoring.js';

/** Standard acknowledgement shape. Exactly one of `data` / `error` is set. */
export type Ack<T> = (result: { ok: true; data: T } | { ok: false; error: string }) => void;

/** A player as shown in the lobby and on the leaderboard. */
export interface PublicPlayer {
  id: string;
  nickname: string;
  avatar: string;
  score: number;
  connected: boolean;
}

/** The current question as sent to players: no correct answers included. */
export interface PublicQuestion {
  id: string;
  type: QuestionType;
  text: string;
  timeLimit: number;
  /** Type-specific display data with all solution fields removed. */
  display: Record<string, unknown>;
  /** Server timestamp (ms) when the question opened, for clock-independent timing. */
  openedAt: number;
  index: number;
  total: number;
  /** Whether the host has paused the running question (Phase 6.5.3). */
  paused: boolean;
  /**
   * The server-side remaining time in ms while `paused`, else null. The client
   * freezes its countdown at exactly this value, so pause never rewinds the
   * clock and resume continues from the same point.
   */
  remainingMs: number | null;
}

/** Result of the player's own answer, sent privately after the reveal. */
export interface OwnResult {
  outcome: 'correct' | 'partial' | 'wrong' | 'unanswered' | 'skipped';
  points: number;
  score: number;
  rank: number;
}

/** The player's own state for the current question, safe to send at any time. */
export interface PlayerAnswerState {
  /** The id of the question this state describes. */
  questionId: string;
  /** Whether this player has already submitted an answer for it. */
  answered: boolean;
  /** The answer this player submitted, or null. Only their own answer. */
  answer: unknown | null;
  /** The player's private result, populated only from `reveal` onwards. */
  result: OwnResult | null;
}

/**
 * The authoritative, phase-aware state a player receives on (re)connect.
 *
 * One envelope covers every phase, so a reconnect can never land a player in the
 * lobby while the game is running. `question` is always the solution-free public
 * view; `result` is the player's own private result; `board`/`podium` are the
 * same public rankings every player may see. Nothing here is derived on the
 * client and no field carries the correct answer before the reveal.
 */
export interface PlayerSync {
  phase: GamePhase;
  /** The current public question, or null outside `question`/`reveal`/`board`. */
  question: PublicQuestion | null;
  /** This player's own answer state for the current question, or null. */
  answer: PlayerAnswerState | null;
  /** The public roster / leaderboard, ordered by rank, or null if not applicable. */
  board: PublicPlayer[] | null;
  /** The final top-three placement, only in the `end` phase. */
  podium: PublicPlayer[] | null;
  /** This player's own final rank and score, only in the `end` phase. */
  placement: { rank: number; score: number } | null;
  /**
   * Whether the current question was skipped by the host and is therefore not
   * scored (Phase 6.5.3). The player is told the question was skipped instead of
   * being shown a correct/wrong verdict.
   */
  skipped: boolean;
}

/**
 * The authoritative, phase-aware state a host receives on (re)connect.
 *
 * Deliberately separate from `PlayerSync`: a host may see the solution and the
 * full answer distribution, and may never answer, so the two contracts must not
 * be interchangeable. Every field maps 1:1 onto an existing host event payload,
 * so a reconnect renders through the same code as the live events and the host
 * screen can never drift from what the engine broadcasts.
 *
 * Nothing here is derived on the client. `question` carries the full `Question`
 * (with `correctIndex`) only from the reveal onwards, mirroring `host:reveal`;
 * before that it is the solution-free `PublicQuestion` of `host:question`.
 */
export interface HostState {
  gameId: string;
  pin: string;
  phase: GamePhase;
  /** The open question, or null outside `question`/`reveal`/`board`. */
  question: PublicQuestion | null;
  /**
   * The revealed question, only in `reveal`. A skipped question carries **no**
   * solution or distribution (Phase 6.5.3); see `HostReveal`.
   */
  reveal: HostReveal | null;
  /** The full roster / leaderboard, or null if not applicable. */
  players: PublicPlayer[] | null;
  /** The final ranking, only in `end`. */
  podium: PublicPlayer[] | null;
  /** Answered / total for the open question, or null. */
  answers: { answered: number; total: number } | null;
  /** Whether the running question is paused (Phase 6.5.3). */
  paused: boolean;
  /**
   * Whether the current question was skipped and will not be scored
   * (Phase 6.5.3). Only ever true in `reveal`.
   */
  skipped: boolean;
}

/** The host's own connection state, as shown in the control bar. */
export type HostConnectionStatus = 'connected' | 'reconnecting' | 'offline';

/**
 * The reveal as shown to a host, in two mutually exclusive shapes (Phase 6.5.3).
 *
 * A **skipped** question is neutralised: it is never scored and its solution
 * must never leave the server. The skipped variant therefore carries only the
 * question's identity and text, so a leak is impossible **by construction** —
 * there is no field that could hold the solution, the correct option or the
 * answer distribution. A regular reveal is unchanged.
 */
export type HostReveal =
  | { skipped: false; question: Question; distribution: Record<string, number> }
  | { skipped: true; question: { id: string; type: QuestionType; text: string } };

/**
 * The host's reachability, as shown to **players** (Phase 6.5.3).
 *
 * `connected` means a host socket is currently in the game's host room;
 * `reconnecting` means none is, and the server will announce `connected` again
 * when one returns. This is deliberately only the host's connection, never the
 * game phase: a host can be away while the game runs on, and a status change
 * never moves the phase.
 */
export type HostPresence = 'connected' | 'reconnecting';

/** Server → player events (namespace `/`). */
export interface PlayerServerEvents {
  'game:joined': (payload: { playerId: string; gameId: string; nickname: string }) => void;
  'game:state': (payload: { phase: GamePhase; players: PublicPlayer[] }) => void;
  'game:question': (payload: PublicQuestion) => void;
  'game:reveal': (payload: { questionId: string; result: OwnResult; skipped?: boolean }) => void;
  'game:board': (payload: { players: PublicPlayer[] }) => void;
  'game:ended': (payload: { rank: number; score: number; podium: PublicPlayer[] }) => void;
  'game:error': (payload: { message: string }) => void;
  /** The host's connection changed. Never carries any host session data. */
  'game:host': (payload: { status: HostPresence }) => void;
  /** This player was removed from the game by the host. */
  'game:kicked': (payload: { reason: 'kicked' }) => void;
  /** The running question was paused by the host. */
  'game:paused': (payload: { questionId: string; remainingMs: number }) => void;
  /** The running question was resumed with this remaining time. */
  'game:resumed': (payload: { questionId: string; remainingMs: number }) => void;
}

/** Player → server events (namespace `/`). */
export interface PlayerClientEvents {
  'player:join': (
    payload: { pin: string; nickname: string; avatar?: string },
    ack: Ack<{ playerId: string; gameId: string; token: string }>,
  ) => void;
  'player:answer': (
    payload: { questionId: string; answer: unknown },
    ack: Ack<{ accepted: boolean }>,
  ) => void;
  'player:rejoin': (
    payload: { gameId: string; playerId: string; token: string },
    ack: Ack<PlayerSync>,
  ) => void;
}

/** Server → host events (namespace `/host`). */
export interface HostServerEvents {
  'host:lobby': (payload: { pin: string; players: PublicPlayer[] }) => void;
  'host:question': (payload: PublicQuestion) => void;
  'host:answers': (payload: { questionId: string; answered: number; total: number }) => void;
  'host:reveal': (payload: HostReveal) => void;
  'host:board': (payload: { players: PublicPlayer[] }) => void;
  'host:ended': (payload: { players: PublicPlayer[] }) => void;
  'host:error': (payload: { message: string }) => void;
  /** The running question was paused; the timer is frozen (Phase 6.5.3). */
  'host:paused': (payload: { questionId: string; remainingMs: number }) => void;
  /** The running question was resumed with this remaining time (Phase 6.5.3). */
  'host:resumed': (payload: { questionId: string; remainingMs: number }) => void;
}

/** Host → server events (namespace `/host`). */
export interface HostClientEvents {
  'host:create': (payload: { quizId: string }, ack: Ack<HostState>) => void;
  'host:start': (payload: { gameId: string }, ack: Ack<{ phase: GamePhase }>) => void;
  'host:next': (payload: { gameId: string }, ack: Ack<{ phase: GamePhase }>) => void;
  'host:reveal': (payload: { gameId: string }, ack: Ack<{ phase: GamePhase }>) => void;
  'host:board': (payload: { gameId: string }, ack: Ack<{ phase: GamePhase }>) => void;
  'host:end': (payload: { gameId: string }, ack: Ack<{ phase: GamePhase }>) => void;
  'host:pause': (payload: { gameId: string }, ack: Ack<{ phase: GamePhase }>) => void;
  'host:resume': (payload: { gameId: string }, ack: Ack<{ phase: GamePhase }>) => void;
  'host:skip': (payload: { gameId: string }, ack: Ack<{ phase: GamePhase }>) => void;
  'host:kick': (payload: { gameId: string; playerId: string }, ack: Ack<{ ok: boolean }>) => void;
  'host:join': (payload: { gameId: string }, ack: Ack<HostState>) => void;
}

/** Convenience alias used by the frontend socket wrapper. */
export interface ServerToClientEvents extends PlayerServerEvents, HostServerEvents {}
export interface ClientToServerEvents extends PlayerClientEvents, HostClientEvents {}

/** Re-export so the ranking shape is available wherever events are handled. */
export type { RankablePlayer };
