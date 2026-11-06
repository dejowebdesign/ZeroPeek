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
}

/** Result of the player's own answer, sent privately after the reveal. */
export interface OwnResult {
  outcome: 'correct' | 'partial' | 'wrong' | 'unanswered';
  points: number;
  score: number;
  rank: number;
}

/** Server → player events (namespace `/`). */
export interface PlayerServerEvents {
  'game:joined': (payload: { playerId: string; gameId: string; nickname: string }) => void;
  'game:state': (payload: { phase: GamePhase; players: PublicPlayer[] }) => void;
  'game:question': (payload: PublicQuestion) => void;
  'game:reveal': (payload: { questionId: string; result: OwnResult }) => void;
  'game:board': (payload: { players: PublicPlayer[] }) => void;
  'game:ended': (payload: { rank: number; score: number; podium: PublicPlayer[] }) => void;
  'game:error': (payload: { message: string }) => void;
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
    ack: Ack<{ ok: boolean }>,
  ) => void;
}

/** Server → host events (namespace `/host`). */
export interface HostServerEvents {
  'host:lobby': (payload: { pin: string; players: PublicPlayer[] }) => void;
  'host:question': (payload: PublicQuestion) => void;
  'host:answers': (payload: { questionId: string; answered: number; total: number }) => void;
  'host:reveal': (payload: { question: Question; distribution: Record<string, number> }) => void;
  'host:board': (payload: { players: PublicPlayer[] }) => void;
  'host:ended': (payload: { players: PublicPlayer[] }) => void;
  'host:error': (payload: { message: string }) => void;
}

/** Host → server events (namespace `/host`). */
export interface HostClientEvents {
  'host:create': (payload: { quizId: string }, ack: Ack<{ gameId: string; pin: string }>) => void;
  'host:start': (payload: { gameId: string }, ack: Ack<{ phase: GamePhase }>) => void;
  'host:next': (payload: { gameId: string }, ack: Ack<{ phase: GamePhase }>) => void;
  'host:reveal': (payload: { gameId: string }, ack: Ack<{ phase: GamePhase }>) => void;
  'host:board': (payload: { gameId: string }, ack: Ack<{ phase: GamePhase }>) => void;
  'host:end': (payload: { gameId: string }, ack: Ack<{ phase: GamePhase }>) => void;
  'host:kick': (payload: { gameId: string; playerId: string }, ack: Ack<{ ok: boolean }>) => void;
  'host:join': (
    payload: { gameId: string },
    ack: Ack<{ pin: string; phase: GamePhase; players: PublicPlayer[] }>,
  ) => void;
}

/** Convenience alias used by the frontend socket wrapper. */
export interface ServerToClientEvents extends PlayerServerEvents, HostServerEvents {}
export interface ClientToServerEvents extends PlayerClientEvents, HostClientEvents {}

/** Re-export so the ranking shape is available wherever events are handled. */
export type { RankablePlayer };
