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
  /**
   * The question's optional category label (Phase 6.9.1), copied verbatim from
   * the question. Display metadata only — like `text` it is never a solution
   * field, so it is safe to send before the reveal.
   */
  category?: string;
  /**
   * The question's optional difficulty label (Phase 6.9.1), copied verbatim from
   * the question. Display metadata only, like `category`.
   */
  difficulty?: string;
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

/**
 * The server-authoritative start countdown (Phase 6.9.1).
 *
 * After the host starts a game the engine enters the `lead` phase for a fixed,
 * server-owned window before the first question opens. The client renders the
 * countdown against these server timestamps (corrected by the Phase 6.8.5
 * clock sync); it never owns the timing, and the actual transition is decided by
 * the server alone. `endsAt - startedAt` is the full window, so a client can
 * compute the remaining time without a second source of truth.
 */
export interface LeadState {
  /** Server timestamp (ms) the countdown started. */
  startedAt: number;
  /** Server timestamp (ms) the countdown ends and the first question opens. */
  endsAt: number;
  /** The full countdown window in seconds. */
  durationSeconds: number;
  /** Whether the host may still skip the countdown (always true while in `lead`). */
  skippable: boolean;
}

/**
 * One player's score change for the revealed question (Phase 6.9.1).
 *
 * Presentation only: the absolute `score` stays the authoritative value, and a
 * delta is never a source of points. `previousScore + delta === score`, so the
 * change is self-consistent and can be recomputed server-side from the stored
 * answer row after a restart.
 */
export interface PointsDelta {
  playerId: string;
  /** The player's score before this question was scored. */
  previousScore: number;
  /** Points awarded for this question (negative after a skip refund). */
  delta: number;
  /** The player's score after this question was scored. */
  score: number;
}

/**
 * One player's rank movement for the current ranking (Phase 6.9.1).
 *
 * Presentation only: the absolute ordering stays the authoritative value and is
 * never computed on the client. `previousRank` is the position before the
 * revealed question's points were applied, so a rise shows as a smaller number.
 */
export interface RankDelta {
  playerId: string;
  /** The player's rank before the current question was scored (1-based). */
  previousRank: number;
  /** The player's rank after the current question was scored (1-based). */
  rank: number;
  /** The player's current score, the value the rank is derived from. */
  score: number;
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
  /**
   * The start countdown, only in the `lead` phase (Phase 6.9.1). A player who
   * reconnects during the countdown sees the remaining time instead of the
   * lobby; the timestamps come from the server and the client renders against
   * the clock sync.
   */
  lead: LeadState | null;
  /**
   * The background image of the round (Phase 6.10), as a catalogue id. The same
   * value every other client shows: it comes from the server, never from the
   * client, and a reconnect restores exactly the background the round is using.
   */
  background: string;
  /**
   * The carousel position behind that image (Phase 6.14): a catalogue id, or the
   * `random` sentinel when the round is on a random pick. Sent so a client can
   * describe the round the same way the host's picker does; it is never used to
   * paint the image, which is always `background`.
   */
  backgroundChoice: string;
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
  /**
   * Whether the server runs the AUTO-controlled transitions by itself (Phase
   * 6.9.3). The host toggle `AUTO` sets this; the server is authoritative, so a
   * host that reloads or reconnects resumes the exact mode the game is in. When
   * on, the answer resolution (question → reveal) and the leaderboard advance
   * (board → next) run by themselves; when off the host triggers both. The reveal
   * window (reveal → leaderboard) is not AUTO-controlled. It is always present, so
   * a fresh game (default `false`) and a resumed one are indistinguishable.
   */
  auto: boolean;
  /** Whether the running question is paused (Phase 6.5.3). */
  paused: boolean;
  /**
   * Whether the current question was skipped and will not be scored
   * (Phase 6.5.3). Only ever true in `reveal`.
   */
  skipped: boolean;
  /**
   * The start countdown, only in the `lead` phase (Phase 6.9.1). Carries the
   * server timestamps so a host that reconnects mid-countdown renders the
   * remaining time instead of restarting it.
   */
  lead: LeadState | null;
  /**
   * Per-player score changes for the revealed question, only in `reveal`
   * (Phase 6.9.1). Presentation only; the absolute scores in `players` remain
   * the authoritative values.
   */
  points: PointsDelta[] | null;
  /**
   * Per-player rank movements for the current ranking, only in `reveal` and
   * `board` (Phase 6.9.1). Presentation only; the ordering in `players` remains
   * the authoritative value.
   */
  ranks: RankDelta[] | null;
  /**
   * Whether a further question follows the one just played. Only meaningful on
   * the `board`, where it decides whether the host is offered `Next question`:
   * it is `false` on the last leaderboard, so no control suggests a question that
   * does not exist. Derived server-side from the quiz length, so a host that
   * reloads or reconnects on the board restores exactly the right controls.
   */
  hasNext: boolean;
  /**
   * The background image of the round (Phase 6.10), as a catalogue id.
   *
   * Server-authoritative: the host picks it (or asks for a random one), the
   * engine stores the concrete id and every client renders that same id, so the
   * host, the beamer and the players can never show different backgrounds. It is
   * fixed for the whole round — a new value appears only when the host changes
   * it deliberately — and always present, so a fresh game and a resumed one are
   * indistinguishable.
   */
  background: string;
  /**
   * The carousel position the host picked (Phase 6.14): a catalogue id, or the
   * `random` sentinel when the round is on a random pick.
   *
   * `background` stays the concrete image every client renders; this field is the
   * *choice* behind it, so the picker can show Random while the round is on a
   * random draw instead of naming a motif the host never selected. Always
   * present, so a host that reloads restores the label it had.
   */
  backgroundChoice: string;
}

/** The host's own connection state, as shown in the control bar. */
export type HostConnectionStatus = 'connected' | 'reconnecting' | 'offline';

/**
 * A clock-synchronisation probe (Phase 6.8.5).
 *
 * The countdown is derived from the server's `openedAt`, but a client can only
 * compare that to its own clock, and client clocks drift. The client therefore
 * measures the offset between its monotonic clock and the server's wall clock
 * with a short ping/pong round and renders the countdown against the corrected
 * time, so every device shows the same number.
 *
 * `id` is a client-generated correlation id. It is echoed verbatim in the
 * matching `ClockPong`, so a late reply is never mistaken for the answer to a
 * newer probe and can be discarded.
 */
export interface ClockPing {
  /** Client-generated correlation id; echoed verbatim in the matching pong. */
  id: string;
}

/** The server's answer to a `ClockPing`. */
export interface ClockPong {
  /** The `id` of the `ClockPing` this answers, unchanged. */
  id: string;
  /** The server's wall clock in ms since the Unix epoch, taken when it replied. */
  serverTime: number;
}

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
  /**
   * The start countdown began (Phase 6.9.1). Sent once when the engine enters
   * `lead`; the player renders the countdown against these server timestamps.
   */
  'game:lead': (payload: LeadState) => void;
  'game:question': (payload: PublicQuestion) => void;
  'game:reveal': (payload: { questionId: string; result: OwnResult; skipped?: boolean }) => void;
  'game:board': (payload: { players: PublicPlayer[] }) => void;
  'game:ended': (payload: { rank: number; score: number; podium: PublicPlayer[] }) => void;
  /**
   * A finished round this **guest** may keep (Phase 6.8.2). Sent only to the
   * guest's own socket, after the round ends. The client stores the proof locally
   * and may redeem it once after registering; a registered player never receives
   * it. The token is opaque and never leaves the browser except back to the
   * server on redeem.
   */
  'game:claimable': (payload: { gameId: string; playerId: string; token: string }) => void;
  'game:error': (payload: { message: string }) => void;
  /** The host's connection changed. Never carries any host session data. */
  'game:host': (payload: { status: HostPresence }) => void;
  /** This player was removed from the game by the host. */
  'game:kicked': (payload: { reason: 'kicked' }) => void;
  /** The running question was paused by the host. */
  'game:paused': (payload: { questionId: string; remainingMs: number }) => void;
  /** The running question was resumed with this remaining time. */
  'game:resumed': (payload: { questionId: string; remainingMs: number }) => void;
  /** The server's reply to a `clock:ping`, used to correct the local clock. */
  'clock:pong': (payload: ClockPong) => void;
  /**
   * The round's background changed (Phase 6.10). Sent to every player socket
   * when the host picks a different background. The payload is the catalogue id,
   * so a client that does not know it falls back to its default rather than
   * showing nothing. `choice` carries the carousel position (Phase 6.14) so a
   * player's status line can say "Random" rather than naming a motif.
   */
  'game:background': (payload: { background: string; choice: string }) => void;
}

/** Player → server events (namespace `/`). */
export interface PlayerClientEvents {
  /**
   * Join a lobby. A **signed-in** player may omit `nickname` and `avatar`: the
   * server then seats them under the account's own username and selected
   * character, so a registered player never has to re-enter a name and always
   * appears with their avatar. A `nickname` sent by a signed-in player is
   * ignored — the account name always wins — while a guest must supply one (and
   * their avatar stays empty). The ACK echoes the identity the server actually
   * seated, so the client shows what it joined as rather than what it typed.
   */
  'player:join': (
    payload: { pin: string; nickname?: string; avatar?: string },
    ack: Ack<{ playerId: string; gameId: string; token: string; nickname: string; avatar: string }>,
  ) => void;
  'player:answer': (
    payload: { questionId: string; answer: unknown },
    ack: Ack<{ accepted: boolean }>,
  ) => void;
  'player:rejoin': (
    payload: { gameId: string; playerId: string; token: string },
    ack: Ack<PlayerSync>,
  ) => void;
  /**
   * Measure the server clock (Phase 6.8.5). Fire-and-forget: the server answers
   * with a `clock:pong` event carrying the same `id`, so the client correlates
   * the reply and measures the round-trip itself. No acknowledgement is used, so
   * a dropped reply simply means the next probe in the round is the one that
   * counts.
   */
  'clock:ping': (payload: ClockPing) => void;
}

/** Server → host events (namespace `/host`). */
export interface HostServerEvents {
  'host:lobby': (payload: { pin: string; players: PublicPlayer[] }) => void;
  /**
   * The start countdown began (Phase 6.9.1). Sent once when the engine enters
   * `lead`; carries the server timestamps the host renders the countdown against.
   */
  'host:lead': (payload: LeadState) => void;
  'host:question': (payload: PublicQuestion) => void;
  'host:answers': (payload: { questionId: string; answered: number; total: number }) => void;
  /**
   * The revealed question, plus the per-player score changes for it (Phase
   * 6.9.1). `points` is presentation only and is always in step with the
   * absolute scores in the accompanying `host:board`.
   */
  'host:reveal': (payload: HostReveal & { points: PointsDelta[] }) => void;
  /**
   * The leaderboard, plus the per-player rank movements (Phase 6.9.1). `ranks`
   * is presentation only; `players` stays the authoritative ordering. `hasNext`
   * tells the host whether a further question follows, so `Next question` is only
   * offered when it would do something.
   */
  'host:board': (payload: {
    players: PublicPlayer[];
    ranks: RankDelta[];
    hasNext: boolean;
  }) => void;
  'host:ended': (payload: { players: PublicPlayer[] }) => void;
  'host:error': (payload: { message: string }) => void;
  /** The running question was paused; the timer is frozen (Phase 6.5.3). */
  'host:paused': (payload: { questionId: string; remainingMs: number }) => void;
  /** The running question was resumed with this remaining time (Phase 6.5.3). */
  'host:resumed': (payload: { questionId: string; remainingMs: number }) => void;
  /**
   * The AUTO mode changed (Phase 6.9.3). Broadcast to every host socket of the
   * game, so a second host tab (or a reconnect) stays in step with the toggle.
   * The server owns the value; this event only mirrors it.
   */
  'host:auto': (payload: { auto: boolean }) => void;
  /**
   * The round's background changed (Phase 6.10). Broadcast to every host socket
   * of the game, so a second host tab (or a reconnect) stays in step. The server
   * owns the value; this event only mirrors it. `choice` is the carousel position
   * (Phase 6.14), so the picker label follows the server too.
   */
  'host:background': (payload: { background: string; choice: string }) => void;
  /** The server's reply to a `clock:ping`, used to correct the local clock. */
  'clock:pong': (payload: ClockPong) => void;
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
  /**
   * Skip the start countdown and open the first question at once (Phase 6.9.1).
   * Only legal in the `lead` phase; a call from any other phase is rejected with
   * the usual conflict, and a duplicate call is a no-op that leaves the phase
   * unchanged. The engine still owns the transition.
   */
  'host:skipLead': (payload: { gameId: string }, ack: Ack<{ phase: GamePhase }>) => void;
  'host:kick': (payload: { gameId: string; playerId: string }, ack: Ack<{ ok: boolean }>) => void;
  'host:join': (payload: { gameId: string }, ack: Ack<HostState>) => void;
  /**
   * Set the AUTO mode (Phase 6.9.3). The server owns the value: it persists it,
   * runs the AUTO-controlled transitions when it is on (answer resolution and
   * leaderboard advance), and leaves them to the host when it is off. Turning it
   * **on** picks up the current state at once — a question whose clock has already
   * expired, or whose roster has fully answered, resolves immediately. A change
   * never re-resolves an already shown round and a duplicate set is a no-op, so it
   * cannot arm a second timer. The ACK carries the authoritative value.
   */
  'host:auto': (payload: { gameId: string; auto: boolean }, ack: Ack<{ auto: boolean }>) => void;
  /**
   * Choose the round's background (Phase 6.10). `background` is either a
   * catalogue id or the `random` sentinel, which the server resolves to one
   * concrete id **once**; the ACK carries the id that is now in force, so the
   * host renders the server's choice rather than its own guess. The server
   * validates the value against the catalogue, so a hand-made id is rejected.
   *
   * The ACK also carries `choice` (Phase 6.14): the position the server stored,
   * which is the sentinel when the round is on Random. The picker needs it to
   * label the round the way the host actually chose.
   */
  'host:background': (
    payload: { gameId: string; background: string },
    ack: Ack<{ background: string; choice: string }>,
  ) => void;
  /**
   * Measure the server clock (Phase 6.8.5). Fire-and-forget: the server answers
   * with a `clock:pong` event carrying the same `id`. See `PlayerClientEvents`.
   */
  'clock:ping': (payload: ClockPing) => void;
}

/** Convenience alias used by the frontend socket wrapper. */
export interface ServerToClientEvents extends PlayerServerEvents, HostServerEvents {}
export interface ClientToServerEvents extends PlayerClientEvents, HostClientEvents {}

/** Re-export so the ranking shape is available wherever events are handled. */
export type { RankablePlayer };
