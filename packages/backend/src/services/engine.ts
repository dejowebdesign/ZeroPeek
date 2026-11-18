/**
 * Server-authoritative game engine.
 *
 * The engine owns the phase machine (lobby → lead → question → reveal → board →
 * … → end), the per-question timer and the scoring. Clients never decide state:
 * they send an answer or a host command, and the engine validates it against
 * the live state before anything changes.
 *
 * Fast-path state lives in memory; every durable fact (phase, answers, scores)
 * is written through to the database, so a restart loses at most the current
 * question's in-flight timer, never recorded results.
 *
 * Emits domain events the socket layer forwards:
 *   `lobby`, `question`, `answers`, `reveal`, `board`, `ended`.
 */

import { EventEmitter } from 'node:events';

import type { Prisma } from '@prisma/client';

import {
  correctnessOf,
  GAME_PHASES,
  isAnswerable,
  isSuspiciouslyFast,
  questionDisplay,
  rankPlayers,
  scoreAnswer,
  snapshotToQuiz,
  type GamePhase,
  type HostReveal,
  type HostState,
  type LeadState,
  type OwnResult,
  type PointsDelta,
  type PublicPlayer,
  type PublicQuestion,
  type Question,
  type Quiz,
  type PlayerAnswerState,
  type PlayerSync,
  type RankDelta,
  type RankablePlayer,
  type ScoringSettings,
} from '@zeropeek/shared';
import { prisma } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import {
  findGameByPin,
  gameSettings,
  joinGame as joinGameRow,
  logEvent,
  listPlayers,
  setPhase,
} from './gameService.js';
import { getQuiz } from './quizService.js';
import { quizForGame, startWithSnapshot } from './snapshotService.js';

/** Grace period in ms added to the limit before a late answer is rejected. */
const ANSWER_GRACE_MS = 1500;

interface RuntimePlayer {
  id: string;
  nickname: string;
  avatar: string;
  score: number;
  correctCount: number;
  totalTimeMs: number;
  joinedAt: number;
  connected: boolean;
  answeredQuestionId: string | null;
}

interface RuntimeGame {
  id: string;
  pin: string;
  quiz: Quiz;
  settings: ScoringSettings;
  phase: GamePhase;
  currentIndex: number;
  /** Server timestamp (ms) the current question opened, or null. */
  openedAt: number | null;
  /**
   * Whether the running question is paused (Phase 6.5.3). While paused the
   * timer is cleared and no automatic transition may fire.
   */
  paused: boolean;
  /** Server timestamp (ms) the current question was paused, or null. */
  pausedAt: number | null;
  /** The remaining run time in ms at the moment of the pause, or null. */
  remainingMs: number | null;
  /** The question id the host skipped, so it is never scored (Phase 6.5.3). */
  skippedQuestionId: string | null;
  /**
   * Whether the server runs the **AUTO-controlled** transitions by itself (Phase
   * 6.9.3). The host's `AUTO` toggle sets this; the server is authoritative and
   * persists it, so a reload or a restart resumes the same mode. When it is on
   * the answer resolution (question → reveal) and the leaderboard advance (board
   * → next) run by themselves; when it is off the host triggers both. The reveal
   * window (reveal → leaderboard) and the start countdown are **not** AUTO-
   * controlled — they always run.
   */
  auto: boolean;
  /** Server timestamp (ms) the `lead` countdown started, or null. */
  leadStartedAt: number | null;
  /** Server timestamp (ms) the `lead` countdown ends, or null. */
  leadEndsAt: number | null;
  players: Map<string, RuntimePlayer>;
  /** Answer tally for the current question: questionId -> option key -> count. */
  distribution: Map<string, number>;
  timer: NodeJS.Timeout | null;
}

/** Event payloads emitted by the engine. */
export interface EngineEvents {
  lobby: [{ gameId: string; pin: string; players: PublicPlayer[] }];
  lead: [{ gameId: string; lead: LeadState }];
  question: [{ gameId: string; question: PublicQuestion }];
  answers: [{ gameId: string; questionId: string; answered: number; total: number }];
  reveal: [{ gameId: string; reveal: HostReveal; points: PointsDelta[] }];
  board: [{ gameId: string; players: PublicPlayer[]; ranks: RankDelta[]; hasNext: boolean }];
  ended: [{ gameId: string; players: PublicPlayer[] }];
  paused: [{ gameId: string; questionId: string; remainingMs: number }];
  resumed: [{ gameId: string; questionId: string; remainingMs: number }];
  /** The AUTO mode changed (Phase 6.9.3), broadcast to every host socket. */
  auto: [{ gameId: string; auto: boolean }];
}

/**
 * How long the reveal and leaderboard screens stay before their next step, in ms
 * (Phase 6.9.3). These are the single source of truth for the two fixed delays:
 * the server arms them, the client never holds a copy, and they are the same
 * values a restart re-arms. `REVEAL_MS` is the reveal window and runs in **both**
 * modes (reveal → leaderboard); `BOARD_MS` is the leaderboard advance and is
 * **AUTO only** (leaderboard → next question).
 */
export const REVEAL_MS = 4000;
export const BOARD_MS = 5000;

/**
 * The server-authoritative start countdown (Phase 6.9.1). After `start` the game
 * sits in the `lead` phase for this window before the first question opens, so
 * every client can show the same 5→0 countdown and the transition is owned by
 * the server alone. A host may skip it early.
 */
export const LEAD_SECONDS = 5;
export const LEAD_MS = LEAD_SECONDS * 1000;

/**
 * The full run time of a question, in ms: the visible limit plus the grace
 * period in which a late answer is still accepted. Both the timer and the
 * pause/resume arithmetic use this one value, so a resume can never drift from
 * what the clock was doing before the pause.
 */
function limitMs(question: Question): number {
  return question.timeLimit * 1000 + ANSWER_GRACE_MS;
}

/**
 * The neutralised reveal for a skipped question: only the question's identity and
 * text, never its solution or the answer distribution (Phase 6.5.3, decision B).
 * Built as the `HostReveal` skipped variant, which has no field that could hold
 * the solution, so a leak is impossible by construction.
 */
function skippedReveal(question: Question): HostReveal {
  return { skipped: true, question: { id: question.id, type: question.type, text: question.text } };
}

/** Whether an error is Prisma's unique-constraint violation (P2002). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

/**
 * The private outcome label for a stored answer's correctness (0..1).
 *
 * Matches the reveal path in `socket.ts` (`correctness >= 1 ? 'correct' : 'wrong'`)
 * and additionally reports `partial`, which `OwnResult` already allows.
 */
function outcomeOf(correctness: number): OwnResult['outcome'] {
  if (correctness >= 1) return 'correct';
  if (correctness > 0) return 'partial';
  return 'wrong';
}

function publicPlayer(player: RuntimePlayer): PublicPlayer {
  return {
    id: player.id,
    nickname: player.nickname,
    avatar: player.avatar,
    score: player.score,
    connected: player.connected,
  };
}

function rankable(player: RuntimePlayer): RankablePlayer {
  return {
    id: player.id,
    score: player.score,
    correctCount: player.correctCount,
    totalTimeMs: player.totalTimeMs,
    joinedAt: player.joinedAt,
  };
}

/**
 * The engine. One instance per server process; games are keyed by id.
 */
export class GameEngine extends EventEmitter<EngineEvents> {
  private readonly games = new Map<string, RuntimeGame>();

  /** In-flight game loads, so concurrent `get` calls share one runtime object. */
  private readonly loading = new Map<string, Promise<RuntimeGame>>();

  /**
   * In-flight answer submissions, keyed by `playerId:questionId`. Two events for
   * the same player and question are chained so the second sees the first's
   * committed result; different players or different questions use different keys
   * and still run in parallel. A key is dropped once its last task settles.
   */
  private readonly answerLocks = new Map<string, Promise<void>>();

  /**
   * In-flight phase transitions, keyed by game id. Every transition runs to
   * completion before the next one starts, so a fire-and-forget auto-reveal
   * cannot interleave with a host's `end`: without this, the reveal's
   * `setPhase('reveal')` write could land *after* `setPhase('end')` and leave a
   * finished game stuck in the `reveal` phase (and without an `endedAt`).
   */
  private readonly phaseLocks = new Map<string, Promise<void>>();

  /** Serialise `task` against any other phase transition of the same game. */
  private withPhaseLock<T>(gameId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.phaseLocks.get(gameId) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.phaseLocks.set(gameId, tail);
    void tail.then(() => {
      if (this.phaseLocks.get(gameId) === tail) this.phaseLocks.delete(gameId);
    });
    return run;
  }

  /** Serialise `task` against any other submission for the same key. */
  private withAnswerLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.answerLocks.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    // The tail never rejects, so one failure cannot poison the next in the queue.
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.answerLocks.set(key, tail);
    void tail.then(() => {
      if (this.answerLocks.get(key) === tail) this.answerLocks.delete(key);
    });
    return run;
  }

  /**
   * Forget the in-memory copy of a game, so the next `get` reloads it from the
   * database. Used by tests to prove the reload path (a fresh process after a
   * restart) reads the snapshot rather than a stale quiz.
   */
  evict(gameId: string): void {
    this.clearTimerSafe(gameId);
    this.games.delete(gameId);
  }

  private clearTimerSafe(gameId: string): void {
    const game = this.games.get(gameId);
    if (game?.timer) {
      clearTimeout(game.timer);
      game.timer = null;
    }
  }

  /** Create a game (in the database) and load it into memory. */
  async create(quizId: string, hostId: string) {
    const { createGame } = await import('./gameService.js');
    const row = await createGame(quizId, hostId);
    const quiz = await getQuiz(quizId);
    const runtime: RuntimeGame = {
      id: row.id,
      pin: row.pin,
      quiz,
      settings: gameSettings(row),
      phase: 'lobby',
      currentIndex: -1,
      openedAt: null,
      paused: false,
      pausedAt: null,
      remainingMs: null,
      skippedQuestionId: null,
      auto: false,
      leadStartedAt: null,
      leadEndsAt: null,
      players: new Map(),
      distribution: new Map(),
      timer: null,
    };
    this.games.set(row.id, runtime);
    await logEvent(row.id, 'created', { quizId });
    return runtime;
  }

  /** Get a loaded game, loading it from the database if necessary. */
  async get(gameId: string): Promise<RuntimeGame> {
    const existing = this.games.get(gameId);
    if (existing) return existing;
    // A game that is not in memory yet may be requested by several sockets at
    // once. Without this, each caller would build its own runtime object and the
    // last `set` would win, leaving the others mutating an orphaned copy.
    const inFlight = this.loading.get(gameId);
    if (inFlight) return inFlight;
    const load = this.load(gameId);
    this.loading.set(gameId, load);
    try {
      return await load;
    } finally {
      if (this.loading.get(gameId) === load) this.loading.delete(gameId);
    }
  }

  private async load(gameId: string): Promise<RuntimeGame> {
    const row = await prisma.game.findUnique({ where: { id: gameId } });
    if (!row) throw notFound('Game not found.');
    // `quizForGame` prefers the frozen snapshot, so a game that has already
    // started keeps the exact questions it began with even if the quiz has since
    // been edited or deleted (Phase 6.4).
    const quiz = await quizForGame({ id: row.id, quizId: row.quizId, phase: row.phase });
    const runtime: RuntimeGame = {
      id: row.id,
      pin: row.pin,
      quiz,
      settings: gameSettings(row),
      phase: row.phase as GamePhase,
      currentIndex: row.currentIndex,
      openedAt: null,
      paused: false,
      pausedAt: null,
      remainingMs: null,
      skippedQuestionId: null,
      auto: false,
      leadStartedAt: null,
      leadEndsAt: null,
      players: new Map(),
      distribution: new Map(),
      timer: null,
    };
    const players = await listPlayers(gameId);
    for (const player of players) {
      runtime.players.set(player.id, {
        id: player.id,
        nickname: player.nickname,
        avatar: player.avatar,
        score: player.score,
        correctCount: player.correctCount,
        totalTimeMs: player.totalTimeMs,
        joinedAt: player.joinedAt.getTime(),
        connected: player.connected,
        answeredQuestionId: null,
      });
    }
    // Recover what a restart can rebuild safely: which players already answered
    // the current question, and when the question opened. Both come from durable
    // rows, so a reconnecting player sees their real answer state and a
    // server-consistent clock instead of a fresh one.
    await this.recoverCurrentQuestion(runtime);
    this.games.set(gameId, runtime);
    return runtime;
  }

  /**
   * Restore the per-question runtime state that lives only in memory, from the
   * rows that survive a restart. A question that is still open when the process
   * dies has no timer left, so this also re-arms it for the remaining time (or
   * reveals immediately if it has already expired). A question the host had
   * paused is restored **paused**: no timer is armed, so a restart can never make
   * a paused game run on or auto-end (Phase 6.5.3).
   */
  private async recoverCurrentQuestion(runtime: RuntimeGame): Promise<void> {
    const question = this.currentQuestion(runtime);

    // Everything the recovery needs is in the game's event log, read in one query
    // and matched by `questionId` in JS rather than ordered by `createdAt`: the
    // column has only millisecond precision, so events written in the same tick
    // (a `reveal` and its `skipped`, a `paused` and its `resumed`) have no defined
    // order and a "latest event" lookup would be a coin flip.
    const events = await prisma.gameEvent.findMany({
      where: {
        gameId: runtime.id,
        type: { in: ['lead', 'question', 'paused', 'resumed', 'skipped', 'auto'] },
      },
      select: { type: true, data: true, createdAt: true },
    });
    const forQuestion = (type: string) =>
      events.filter(
        (event) =>
          event.type === type &&
          (event.data as { questionId?: string }).questionId === question?.id,
      );

    // The skipped flag outlives a restart: a question was skipped iff the log
    // holds a `skipped` event for it. A question is asked once per game and a skip
    // is never followed by re-asking it, so this is an existence check, and it
    // runs before the phase guard so a restart during `reveal`/`board` still
    // marks the question as skipped.
    runtime.skippedQuestionId = question && forQuestion('skipped').length > 0 ? question.id : null;

    // The AUTO mode is restored from the game's own event log (Phase 6.9.3): the
    // last `auto` event wins. Like the pause count, this is order-free — only the
    // *value* of the latest event matters, so it is read from the newest by
    // `createdAt` and ties are irrelevant because each event carries a boolean
    // and the log is append-only. No new column, no migration.
    const autoEvents = events.filter((event) => event.type === 'auto');
    runtime.auto =
      autoEvents
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((event) => (event.data as { auto?: boolean }).auto)
        .filter((value): value is boolean => typeof value === 'boolean')
        .at(-1) ?? false;

    // The start countdown (Phase 6.9.1). Its window is rebuilt from the `lead`
    // event's server `endsAt`, so a restart mid-countdown re-arms for the
    // *remaining* time and never restarts the countdown at the full window; if it
    // has already expired it advances at once. There is exactly one `lead` event
    // per game, so the newest is the only one.
    if (runtime.phase === 'lead') {
      const leadEvents = events.filter((event) => event.type === 'lead');
      const endsAt = leadEvents
        .map((event) => (event.data as { endsAt?: number }).endsAt)
        .filter((value): value is number => typeof value === 'number')
        .sort((a, b) => b - a)[0];
      const resolvedEndsAt = endsAt ?? Date.now() + LEAD_MS;
      runtime.leadStartedAt = resolvedEndsAt - LEAD_MS;
      runtime.leadEndsAt = resolvedEndsAt;
      const remainingMs = resolvedEndsAt - Date.now();
      if (remainingMs <= 0) {
        // Deferred: the runtime is not registered in `games` until `load` returns.
        setTimeout(() => {
          void this.advanceFromLead(runtime.id).catch(() => undefined);
        }, 0);
        return;
      }
      runtime.timer = setTimeout(() => {
        void this.advanceFromLead(runtime.id).catch(() => undefined);
      }, remainingMs);
      return;
    }

    // Restart recovery per phase. A process that dies mid-question, mid-reveal or
    // mid-board leaves no timer behind, so every phase with an automatic
    // successor must re-arm it here — otherwise the game is stuck on that screen
    // forever. The reveal window is re-armed for its **full** window (not a
    // remainder): the host is back in control and the screen is the live one, so
    // re-arming for the full window is the deterministic, restart-safe choice.
    // The question clock is different — it is the real, once-only clock, so it is
    // re-armed for the *remaining* time and reveals at once if expired.
    //
    // The AUTO mode was restored above from the game's own event log (Phase
    // 6.9.3). AUTO controls the answer resolution (question → reveal) and the
    // leaderboard advance (board → next): with AUTO **off** neither is armed, so a
    // recovered game waits for the host and never runs on by itself. The reveal
    // window (reveal → leaderboard) is **not** AUTO-controlled and is always
    // re-armed.
    if (runtime.phase === 'reveal') {
      runtime.timer = setTimeout(() => {
        void this.board(runtime.id).catch(() => undefined);
      }, REVEAL_MS);
      return;
    }

    if (runtime.phase === 'board') {
      if (!runtime.auto) return;
      runtime.timer = setTimeout(() => {
        void this.next(runtime.id).catch(() => undefined);
      }, BOARD_MS);
      return;
    }

    if (runtime.phase !== 'question' || !question) return;

    const answers = await prisma.playerAnswer.findMany({
      where: { gameId: runtime.id, questionId: question.id },
      select: { playerId: true, answer: true },
    });
    for (const answer of answers) {
      const player = runtime.players.get(answer.playerId);
      if (player) player.answeredQuestionId = question.id;
      const key = JSON.stringify(answer.answer ?? null);
      runtime.distribution.set(key, (runtime.distribution.get(key) ?? 0) + 1);
    }

    const opened = forQuestion('question')[0];
    runtime.openedAt = opened ? opened.createdAt.getTime() : Date.now();

    // Was the last word on this question a pause (rather than a resume)? Pause and
    // resume strictly alternate, starting with pause, so a count comparison is
    // order-free: more pauses than resumes means the game is paused at rest.
    const pauses = forQuestion('paused');
    if (pauses.length > forQuestion('resumed').length) {
      // Successive pauses freeze a non-increasing remainder, so the smallest is
      // the current one — again no reliance on event order.
      const remainingMs = Math.min(
        ...pauses.map((event) => (event.data as { remainingMs?: number }).remainingMs ?? 0),
      );
      runtime.paused = true;
      runtime.remainingMs = remainingMs;
      // Anchor the clock to "now" so the frozen remainder is exact and a later
      // resume continues from here; this needs no historical pause timestamp.
      runtime.pausedAt = Date.now();
      runtime.openedAt = Date.now() - (limitMs(question) - remainingMs);
      return;
    }

    // AUTO only: with AUTO off the host resolves the answers, so the recovered
    // question waits for the host instead of auto-revealing when the clock runs
    // out. The clock itself has already expired, but nothing fires until the host
    // acts (or turns AUTO on).
    if (!runtime.auto) return;
    if (question.type === 'slide') return;
    const remainingMs = limitMs(question) - (Date.now() - runtime.openedAt);
    if (remainingMs <= 0) {
      // Deferred, not called inline: the runtime is not registered in `games`
      // until `load` returns, and `reveal` -> `get` would otherwise await the
      // very load that is awaiting this method.
      setTimeout(() => {
        void this.reveal(runtime.id).catch(() => undefined);
      }, 0);
      return;
    }
    runtime.timer = setTimeout(() => {
      void this.reveal(runtime.id).catch(() => undefined);
    }, remainingMs);
  }

  /** The current question, or null when there is none. */
  currentQuestion(game: RuntimeGame): Question | null {
    return game.quiz.questions[game.currentIndex] ?? null;
  }

  /** Whether a question follows the current index (used to gate `Next`). */
  private hasNextQuestion(game: RuntimeGame): boolean {
    return game.currentIndex + 1 < game.quiz.questions.length;
  }

  /** The public (solution-free) view of the current question. */
  publicQuestion(game: RuntimeGame): PublicQuestion {
    const question = this.currentQuestion(game);
    if (!question) throw conflict('There is no open question.');
    return {
      id: question.id,
      type: question.type,
      text: question.text,
      timeLimit: question.timeLimit,
      display: questionDisplay(question),
      // The optional category and difficulty labels are display metadata, not
      // solution fields, so they are safe to send before the reveal (Phase 6.9.1).
      // Each is only set when present, so a question without one adds no key.
      ...(question.category === undefined ? {} : { category: question.category }),
      ...(question.difficulty === undefined ? {} : { difficulty: question.difficulty }),
      openedAt: game.openedAt ?? Date.now(),
      index: game.currentIndex,
      total: game.quiz.questions.length,
      paused: game.paused,
      remainingMs: game.paused ? (game.remainingMs ?? 0) : null,
    };
  }

  /** All players, sorted by the configured ranking. */
  leaderboard(game: RuntimeGame): PublicPlayer[] {
    const ranked = rankPlayers([...game.players.values()].map(rankable), game.settings.tieBreak);
    return ranked.map((entry) => publicPlayer(game.players.get(entry.id)!));
  }

  /** The current ranking as playerId → 1-based rank, derived from the leaderboard. */
  private rankByPlayer(game: RuntimeGame): Map<string, number> {
    const ranks = new Map<string, number>();
    this.leaderboard(game).forEach((player, index) => ranks.set(player.id, index + 1));
    return ranks;
  }

  /**
   * Per-player score changes for the current question (Phase 6.9.1).
   *
   * Read from the persisted `playerAnswer` rows, so the same values are produced
   * after a restart as live: `delta` is the sum of the rows' points (a regular
   * question has one row per player; a skip zeroes them, so the delta is the
   * refund). `previousScore = score - delta` reconstructs the pre-question value
   * and never touches the authoritative running total. Idempotent by
   * construction — it only reads, so re-emitting a reveal cannot double anything.
   */
  private async pointsDeltas(game: RuntimeGame, questionId: string): Promise<PointsDelta[]> {
    const rows = await prisma.playerAnswer.findMany({
      where: { gameId: game.id, questionId },
      select: { playerId: true, points: true },
    });
    const byPlayer = new Map<string, number>();
    for (const row of rows)
      byPlayer.set(row.playerId, (byPlayer.get(row.playerId) ?? 0) + row.points);
    return [...game.players.values()].map((player) => {
      const delta = byPlayer.get(player.id) ?? 0;
      return {
        playerId: player.id,
        previousScore: player.score - delta,
        delta,
        score: player.score,
      };
    });
  }

  /**
   * Per-player rank movements for the current question (Phase 6.9.1).
   *
   * `previousRank` is derived from the same ranking the reveal/board shows, with
   * each player's own delta removed from their score, so it is the position
   * *before* this question was scored. Deterministic and reconstructable: it is a
   * pure function of the current scores and the persisted deltas.
   */
  private async rankDeltas(game: RuntimeGame, questionId: string): Promise<RankDelta[]> {
    const deltas = await this.pointsDeltas(game, questionId);
    const deltaById = new Map(deltas.map((entry) => [entry.playerId, entry.delta]));
    const previous = rankPlayers(
      [...game.players.values()].map((player) => ({
        ...rankable(player),
        score: player.score - (deltaById.get(player.id) ?? 0),
      })),
      game.settings.tieBreak,
    );
    const previousRankById = new Map(previous.map((entry) => [entry.id, entry.rank]));
    const currentRankById = this.rankByPlayer(game);
    return deltas.map((entry) => ({
      playerId: entry.playerId,
      previousRank: previousRankById.get(entry.playerId) ?? 1,
      rank: currentRankById.get(entry.playerId) ?? 1,
      score: entry.score,
    }));
  }

  private clearTimer(game: RuntimeGame): void {
    if (game.timer) {
      clearTimeout(game.timer);
      game.timer = null;
    }
  }

  /** The lobby roster and PIN, broadcast to hosts and players. */
  emitLobby(game: RuntimeGame): void {
    // Never broadcast a lobby once the game has left it. A roster that arrives
    // after the question opened is exactly what stranded a host on the lobby
    // screen while the engine had already moved on.
    if (game.phase !== 'lobby') return;
    this.emit('lobby', {
      gameId: game.id,
      pin: game.pin,
      players: [...game.players.values()].map(publicPlayer),
    });
  }

  /**
   * Join a player to a game's lobby, serialised against the host's `start`.
   *
   * The row is written and the runtime updated under the same per-game phase
   * lock `start` takes, so the two can never interleave: either the join lands
   * first — and the player is in the roster the start freezes — or the start
   * lands first and the join is refused because the game has left the lobby.
   * Without this, a join that passed its own phase check could still commit its
   * row and broadcast a stale lobby *after* the game had started, leaving the
   * host on a lobby whose "Start game" the engine then rejects with "The game
   * has already started."
   */
  async join(pin: string, nickname: string, avatar = '', userId?: string) {
    // The lock is keyed by game id, so the game has to be resolved first. This
    // lookup is read-only and safe outside the lock.
    const found = await findGameByPin(pin);
    return this.withPhaseLock(found.id, async () => {
      // Re-checks the lobby phase from the database and rejects a duplicate
      // nickname; both happen under the lock, so the check and the write cannot
      // be split by a concurrent start.
      const { game, player } = await joinGameRow(pin, nickname, avatar, userId);
      await this.addPlayer(game.id, {
        id: player.id,
        nickname: player.nickname,
        avatar: player.avatar,
        joinedAt: player.joinedAt,
      });
      return { game, player };
    });
  }

  /** Add a player to the lobby (called by the socket layer after joinGame). */
  async addPlayer(
    gameId: string,
    player: {
      id: string;
      nickname: string;
      avatar: string;
      joinedAt: Date;
    },
  ): Promise<void> {
    const game = await this.get(gameId);
    const existing = game.players.get(player.id);
    if (existing) {
      // A signed-in player rejoining their own seat (Phase 6.8.3): refresh the
      // display fields, but never reset a live score or connection state, so a
      // reload mid-lobby cannot wipe progress or fake a reconnect.
      existing.nickname = player.nickname;
      existing.avatar = player.avatar;
      this.emitLobby(game);
      return;
    }
    game.players.set(player.id, {
      id: player.id,
      nickname: player.nickname,
      avatar: player.avatar,
      score: 0,
      correctCount: 0,
      totalTimeMs: 0,
      joinedAt: player.joinedAt.getTime(),
      connected: true,
      answeredQuestionId: null,
    });
    this.emitLobby(game);
  }

  /** Mark a player's connection state; emits a fresh lobby in the lobby phase. */
  async markConnected(gameId: string, playerId: string, connected: boolean): Promise<void> {
    const game = await this.get(gameId);
    const player = game.players.get(playerId);
    if (!player) return;
    player.connected = connected;
    if (game.phase === 'lobby') this.emitLobby(game);
  }

  /**
   * Move to the next question, or to the lead-in of the first one. Opens the
   * question and arms the timer.
   *
   * Only a started game may advance: `host:next` from the lobby would otherwise
   * open a question without freezing the quiz first, which is exactly the
   * snapshot guarantee Phase 6.4 has to keep.
   */
  async next(gameId: string): Promise<GamePhase> {
    return this.withPhaseLock(gameId, () => this.nextInternal(gameId));
  }

  private async nextInternal(gameId: string): Promise<GamePhase> {
    const game = await this.get(gameId);
    if (game.phase === 'lobby') throw conflict('Start the game first.');
    // `next` is only a legal successor of the **board**. Refusing it from
    // `question`/`reveal` is what makes a stale auto-advance timer — or a second,
    // rapid host click — a no-op instead of a silent skip of the whole open
    // question. Without this, a board timer armed before a manual advance could
    // fire afterwards and jump the game forward by one extra question.
    if (game.phase !== 'board') {
      throw conflict('There is no leaderboard to advance from.');
    }
    return this.advance(gameId, game);
  }

  /**
   * Open the question after the current index and arm its timer (or end the game
   * when the index runs past the last question). The phase guard lives in
   * `nextInternal`, so `startInternal` can reuse this to open the first question
   * from the lobby without pretending to be on a board.
   */
  private async advance(gameId: string, game: RuntimeGame): Promise<GamePhase> {
    this.clearTimer(game);

    const nextIndex = game.currentIndex + 1;
    if (nextIndex >= game.quiz.questions.length) {
      return this.endInternal(gameId);
    }

    game.currentIndex = nextIndex;
    game.phase = 'question';
    const question = game.quiz.questions[nextIndex]!;
    game.distribution = new Map();
    game.openedAt = Date.now();
    // A fresh question is never paused and never skipped; both belong to the
    // question they were set on (Phase 6.5.3).
    game.paused = false;
    game.pausedAt = null;
    game.remainingMs = null;
    game.skippedQuestionId = null;

    await setPhase(gameId, 'question', nextIndex);
    await logEvent(gameId, 'question', { index: nextIndex, questionId: question.id });

    this.emit('question', { gameId, question: this.publicQuestion(game) });
    this.emit('answers', {
      gameId,
      questionId: question.id,
      answered: 0,
      total: game.players.size,
    });

    if (question.type === 'slide') {
      // A slide has no timer; the host advances when ready.
      return 'question';
    }

    // AUTO only: with AUTO off the host resolves the answers by hand, so the
    // answer clock runs (the question still expires) but nothing auto-reveals.
    this.armQuestionClock(game, limitMs(question));

    return 'question';
  }

  /** Start the game: freeze the quiz, leave the lobby and begin the start countdown. */
  async start(gameId: string): Promise<GamePhase> {
    return this.withPhaseLock(gameId, () => this.startInternal(gameId));
  }

  private async startInternal(gameId: string): Promise<GamePhase> {
    const game = await this.get(gameId);
    if (game.phase !== 'lobby') throw conflict('The game has already started.');
    if (game.players.size === 0) throw conflict('Nobody has joined yet.');

    // Freeze the quiz **before** the countdown opens (Phase 6.4). The copy is
    // committed in one transaction with the start stamp, so from here on the run
    // reads the snapshot and a later quiz edit or delete cannot touch it. If this
    // throws, the game stays in the lobby and nothing is frozen.
    const snapshot = await startWithSnapshot(gameId);
    game.quiz = snapshotToQuiz(snapshot.quiz);
    game.currentIndex = -1;
    // The snapshot is in place, so it is safe to leave the lobby now. The first
    // question is opened by the `lead` countdown (Phase 6.9.1).
    return this.enterLead(gameId, game);
  }

  /**
   * Enter the server-authoritative start countdown (Phase 6.9.1).
   *
   * The window is fixed (`LEAD_MS`) and its start/end are server timestamps, so
   * every client renders the same countdown and the transition to `question` is
   * owned by the server. The timer is the same single `game.timer` the rest of
   * the engine uses — no second timer infrastructure.
   */
  private async enterLead(gameId: string, game: RuntimeGame): Promise<GamePhase> {
    this.clearTimer(game);
    const startedAt = Date.now();
    game.phase = 'lead';
    game.leadStartedAt = startedAt;
    game.leadEndsAt = startedAt + LEAD_MS;
    game.openedAt = null;
    game.paused = false;
    game.pausedAt = null;
    game.remainingMs = null;
    game.skippedQuestionId = null;

    await setPhase(gameId, 'lead', game.currentIndex);
    await logEvent(gameId, 'lead', { endsAt: game.leadEndsAt });

    this.emit('lead', { gameId, lead: this.leadState(game)! });

    game.timer = setTimeout(() => {
      void this.advanceFromLead(gameId).catch(() => undefined);
    }, LEAD_MS);

    return 'lead';
  }

  /** The countdown window as the host and players render it, or null outside `lead`. */
  leadState(game: RuntimeGame): LeadState | null {
    if (game.phase !== 'lead' || game.leadStartedAt === null || game.leadEndsAt === null) {
      return null;
    }
    return {
      startedAt: game.leadStartedAt,
      endsAt: game.leadEndsAt,
      durationSeconds: LEAD_SECONDS,
      skippable: true,
    };
  }

  /**
   * Open the first question once the countdown is over (Phase 6.9.1). Idempotent
   * against a duplicate timer callback or a host skip racing the timer: both call
   * this, and only the first wins the phase guard, so `question` is entered
   * exactly once.
   */
  private async advanceFromLead(gameId: string): Promise<GamePhase> {
    return this.withPhaseLock(gameId, async () => {
      const game = await this.get(gameId);
      // A game that has already left `lead` (skipped, or the timer fired twice)
      // is left untouched, so a late callback can never open a second question.
      if (game.phase !== 'lead') return game.phase;
      this.clearTimer(game);
      game.leadStartedAt = null;
      game.leadEndsAt = null;
      return this.advance(gameId, game);
    });
  }

  /**
   * Skip the start countdown and open the first question at once (Phase 6.9.1).
   *
   * Only legal in `lead`: from any other phase this is refused, so a stale or
   * duplicated skip cannot move the game. A duplicate skip is a harmless no-op
   * because `advanceFromLead` only acts while the game is still in `lead`.
   */
  async skipLead(gameId: string): Promise<GamePhase> {
    return this.withPhaseLock(gameId, async () => {
      const game = await this.get(gameId);
      if (game.phase !== 'lead') throw conflict('There is no countdown to skip.');
      this.clearTimer(game);
      game.leadStartedAt = null;
      game.leadEndsAt = null;
      return this.advance(gameId, game);
    });
  }

  /**
   * Set the AUTO mode (Phase 6.9.3) and return the authoritative value.
   *
   * The server owns the mode, so the client only asks for a value and the engine
   * decides. It is persisted in the existing append-only event log (no new
   * column, no migration) and mirrored onto the runtime, so a reload or a restart
   * resumes the exact mode the host left. Setting the value it already has is a
   * no-op: no event, no timer churn, so a duplicate or double-clicked toggle
   * cannot arm a second transition.
   *
   * AUTO controls **two** transitions: the answer resolution (question → reveal)
   * and the leaderboard advance (board → next question). The reveal window
   * (reveal → leaderboard after `REVEAL_MS`) is **not** AUTO-controlled — it runs
   * in both modes.
   *
   * Switching **off** cancels a pending answer resolution or leaderboard advance
   * so the host takes over, but it never touches the start countdown or the
   * always-on reveal window. Switching **on** picks up at once: on a live
   * question whose clock has already expired, or whose whole roster has already
   * answered, it resolves the answers immediately (that is the state the host
   * handed over); on a reveal or leaderboard it arms that screen's transition. No
   * round is ever re-resolved and no question is skipped: the target's own phase
   * guard still validates every transition, and a reveal already shown is left
   * untouched.
   */
  async setAuto(gameId: string, auto: boolean): Promise<boolean> {
    return this.withPhaseLock(gameId, async () => {
      const game = await this.get(gameId);
      if (game.auto === auto) return game.auto;
      game.auto = auto;
      await logEvent(gameId, 'auto', { auto });

      if (!auto) {
        // Off: stop the pending answer resolution (question) or leaderboard
        // advance (board). The reveal window keeps running — it is not AUTO.
        if (game.phase === 'question' || game.phase === 'board') this.clearTimer(game);
      } else {
        // On: catch up to the state the host handed over. A live question whose
        // clock has expired, or whose roster has fully answered, resolves now;
        // otherwise the clock is (re)armed for the exact remainder. A slide and a
        // paused question have no answer clock.
        await this.armQuestionAuto(game);
        this.armBoardAdvance(game);
      }

      this.emit('auto', { gameId, auto });
      return game.auto;
    });
  }

  /**
   * Bring the running question's AUTO resolution up to date after AUTO was turned
   * on (Phase 6.9.3). A no-op unless the game is on a live, unpaused, answerable
   * question. If the whole roster has answered, or the clock has already expired,
   * the reveal is triggered at once (deferred, so the `get` inside `reveal` does
   * not await this load); otherwise the clock is armed for the remaining time.
   */
  private async armQuestionAuto(game: RuntimeGame): Promise<void> {
    if (game.phase !== 'question' || game.paused) return;
    const question = this.currentQuestion(game);
    if (!question || question.type === 'slide') return;

    const answered = [...game.players.values()].filter(
      (entry) => entry.answeredQuestionId === question.id,
    ).length;
    const remainingMs = limitMs(question) - (Date.now() - (game.openedAt ?? Date.now()));
    if (answered >= game.players.size || remainingMs <= 0) {
      this.clearTimer(game);
      void this.reveal(game.id).catch(() => undefined);
      return;
    }
    this.armQuestionClock(game, remainingMs);
  }

  /**
   * Accept a player's answer. Enforces: the game is in the question phase, the
   * question id matches, the player has not answered yet, and the answer arrives
   * within the time limit (+grace). Returns whether it was accepted.
   *
   * Submissions for the same player and question are serialised by
   * `withAnswerLock`, and the runtime is advanced only once the write has
   * committed. Two near-simultaneous answers can therefore not both pass the
   * "already answered" check, double the score or inflate the distribution.
   */
  async submitAnswer(
    gameId: string,
    playerId: string,
    questionId: string,
    answer: unknown,
  ): Promise<{ accepted: boolean }> {
    const game = await this.get(gameId);
    return this.withAnswerLock(`${playerId}:${questionId}`, () =>
      this.acceptAnswer(game, playerId, questionId, answer),
    );
  }

  /**
   * The body of `submitAnswer`, always run under the per-(player, question) lock.
   *
   * The order matters: validate, commit both writes in one transaction, and only
   * then mirror the result into the runtime. A failed or duplicate write leaves
   * the in-memory state untouched, so it can never drift from the database.
   */
  private async acceptAnswer(
    game: RuntimeGame,
    playerId: string,
    questionId: string,
    answer: unknown,
  ): Promise<{ accepted: boolean }> {
    const gameId = game.id;
    // Re-validated inside the lock: the phase, the open question and the player's
    // own state may all have moved on while this submission waited its turn.
    if (game.phase !== 'question') throw conflict('No question is open.');
    // A paused question accepts no answers: the clock is frozen, so accepting one
    // would both break the pause and reopen a window the host closed.
    if (game.paused) throw conflict('The question is paused.');
    const question = this.currentQuestion(game);
    if (!question || question.id !== questionId) throw conflict('That question is not open.');
    if (!isAnswerable(question.type)) throw conflict('This question cannot be answered.');

    const player = game.players.get(playerId);
    if (!player) throw notFound('You are not in this game.');
    if (player.answeredQuestionId === questionId) {
      throw conflict('You have already answered.');
    }

    const openedAt = game.openedAt ?? Date.now();
    const elapsedMs = Date.now() - openedAt;
    if (elapsedMs > limitMs(question)) {
      throw conflict('Too late – the question is closed.');
    }

    const correctness = correctnessOf(question, answer);
    const flagged = isSuspiciouslyFast(elapsedMs, game.settings.speed);
    const result = scoreAnswer(question, elapsedMs, correctness, game.settings);
    const points = flagged && game.settings.speed.onSuspicious === 'zero' ? 0 : result.points;

    const score = player.score + points;
    const totalTimeMs = player.totalTimeMs + elapsedMs;
    const correctCount = player.correctCount + (result.outcome === 'correct' ? 1 : 0);

    try {
      // One transaction: the answer row and the running totals commit together,
      // so the database can never hold half of an accepted answer.
      await prisma.$transaction([
        prisma.playerAnswer.create({
          data: {
            gameId,
            playerId,
            questionId,
            answer: (answer ?? null) as Prisma.InputJsonValue,
            correctness,
            points,
            elapsedMs,
            flagged,
          },
        }),
        prisma.gamePlayer.update({
          where: { id: playerId },
          data: { score, correctCount, totalTimeMs },
        }),
      ]);
    } catch (error) {
      // The unique index on (playerId, questionId) is the backstop for a duplicate
      // that slipped past the in-memory guard (a second process, or a retry after a
      // lost acknowledgement). Report it with the same conflict the guard raises,
      // so the API contract does not change.
      if (isUniqueViolation(error)) throw conflict('You have already answered.');
      throw error;
    }

    // Committed: only now may the runtime mirror what the database stored.
    player.answeredQuestionId = questionId;
    player.score = score;
    player.totalTimeMs = totalTimeMs;
    player.correctCount = correctCount;

    const key = JSON.stringify(answer ?? null);
    game.distribution.set(key, (game.distribution.get(key) ?? 0) + 1);

    const answered = [...game.players.values()].filter(
      (entry) => entry.answeredQuestionId === questionId,
    ).length;
    this.emit('answers', { gameId, questionId, answered, total: game.players.size });

    // Everyone answered: reveal early — but only under AUTO (Phase 6.9.3). With
    // AUTO off the host resolves the answers, so a full roster still waits for the
    // host. `reveal` is idempotent, so the last players arriving together still
    // produce exactly one reveal.
    if (game.auto && answered >= game.players.size) {
      this.clearTimer(game);
      void this.reveal(gameId).catch(() => undefined);
    }

    return { accepted: true };
  }

  /**
   * The authoritative, phase-aware state to hand a player on (re)connect.
   *
   * This is the single place that decides what a reconnecting player sees, so a
   * player can never land in the lobby while the game runs. It reuses the public
   * engine views (`publicQuestion`, `leaderboard`) and reads the player's own
   * answer row from the database — the same durable row the reveal path uses —
   * so the runtime mirror cannot hide an answer that was committed before a
   * restart. The reveal's `correctIndex` and the quiz snapshot are never touched:
   * only `publicQuestion`, `PublicPlayer` and the player's own answer are sent.
   */
  async playerSync(game: RuntimeGame, playerId: string): Promise<PlayerSync> {
    const player = game.players.get(playerId);
    if (!player) throw notFound('You are not in this game.');

    const empty: PlayerSync = {
      phase: game.phase,
      question: null,
      answer: null,
      board: null,
      podium: null,
      placement: null,
      skipped: false,
      lead: null,
    };

    // The start countdown (Phase 6.9.1): a player who reconnects during it sees
    // the remaining time rather than the lobby. The timestamps are the server's,
    // so the client renders the same countdown it would have had live.
    if (game.phase === 'lead') {
      return { ...empty, board: this.leaderboard(game), lead: this.leadState(game) };
    }

    if (game.phase === 'lobby') {
      return { ...empty, board: this.leaderboard(game) };
    }

    if (game.phase === 'end') {
      const ranked = this.leaderboard(game);
      const index = ranked.findIndex((entry) => entry.id === playerId);
      return {
        ...empty,
        board: ranked,
        podium: ranked.slice(0, 3),
        placement: { rank: index === -1 ? ranked.length + 1 : index + 1, score: player.score },
      };
    }

    // question / reveal / board all describe a current question. `publicQuestion`
    // strips the solution, so nothing here can leak the answer before the reveal.
    const question = this.currentQuestion(game);
    if (!question) return empty;

    const stored = await prisma.playerAnswer.findUnique({
      where: { playerId_questionId: { playerId, questionId: question.id } },
    });
    // The leaderboard ranks every player, so the player's own rank comes from it;
    // nothing about another player's answers is exposed.
    const ranked = this.leaderboard(game);
    const rank = ranked.findIndex((entry) => entry.id === playerId) + 1;
    const ownRank = rank === 0 ? ranked.length : rank;
    const score = player.score;
    // A skipped question is never scored, so no verdict is shown for it — the
    // player sees that it was skipped instead (Phase 6.5.3).
    const skipped = game.skippedQuestionId === question.id;

    const answer: PlayerAnswerState = {
      questionId: question.id,
      answered: stored !== null,
      answer: stored ? (stored.answer ?? null) : null,
      // Only the reveal makes the result meaningful. This mirrors the live
      // `game:reveal` event, which also reports `unanswered` for a player who did
      // not answer, so a reconnect and a live reveal render identically. A
      // skipped question has no verdict and reports `skipped` here exactly as the
      // live event does, so a reconnecting player sees the same screen.
      result:
        game.phase !== 'reveal'
          ? null
          : skipped
            ? { outcome: 'skipped', points: 0, score, rank: ownRank }
            : stored
              ? {
                  outcome: outcomeOf(stored.correctness),
                  points: stored.points,
                  score,
                  rank: ownRank,
                }
              : { outcome: 'unanswered', points: 0, score, rank: ownRank },
    };

    return {
      ...empty,
      question: this.publicQuestion(game),
      answer,
      board: game.phase === 'board' ? ranked : null,
      skipped,
    };
  }

  /**
   * The authoritative, phase-aware state to hand a host on (re)connect.
   *
   * The host is the game master, never a participant: this never includes an
   * answer slot, and the roster is the same `PublicPlayer[]` the leaderboard
   * already uses, so a host can never appear in it. Unlike `PlayerSync` this may
   * expose the solution — but only from the reveal onwards, mirroring exactly
   * when `host:reveal` fires, so a reconnect cannot leak the answer early.
   */
  async hostState(game: RuntimeGame): Promise<HostState> {
    const roster = [...game.players.values()].map(publicPlayer);
    const empty: HostState = {
      gameId: game.id,
      pin: game.pin,
      phase: game.phase,
      question: null,
      reveal: null,
      players: null,
      podium: null,
      answers: null,
      auto: game.auto,
      paused: false,
      skipped: false,
      lead: null,
      points: null,
      ranks: null,
      hasNext: false,
    };

    // The start countdown (Phase 6.9.1): a host that reconnects mid-countdown
    // renders the remaining time from the server timestamps instead of restarting.
    if (game.phase === 'lead') {
      return { ...empty, players: roster, lead: this.leadState(game) };
    }

    if (game.phase === 'lobby') {
      return { ...empty, players: roster };
    }

    if (game.phase === 'end') {
      const ranked = this.leaderboard(game);
      return { ...empty, players: ranked, podium: ranked.slice(0, 3) };
    }

    const question = this.currentQuestion(game);
    if (!question) return empty;

    const answered = [...game.players.values()].filter(
      (player) => player.answeredQuestionId === question.id,
    ).length;
    const answers = { answered, total: game.players.size };
    const skipped = game.skippedQuestionId === question.id;

    if (game.phase === 'reveal') {
      // The reveal state carries the same per-player deltas the live
      // `host:reveal` broadcasts (Phase 6.9.1), rebuilt from the persisted rows.
      const points = await this.pointsDeltas(game, question.id);
      return {
        ...empty,
        question: this.publicQuestion(game),
        reveal: skipped
          ? skippedReveal(question)
          : { skipped: false, question, distribution: Object.fromEntries(game.distribution) },
        answers,
        skipped,
        points,
        ranks: await this.rankDeltas(game, question.id),
      };
    }

    if (game.phase === 'board') {
      return {
        ...empty,
        players: this.leaderboard(game),
        skipped,
        ranks: await this.rankDeltas(game, question.id),
        hasNext: this.hasNextQuestion(game),
      };
    }

    return { ...empty, question: this.publicQuestion(game), answers, paused: game.paused };
  }

  /** The player's own result for the current question. */
  ownResult(game: RuntimeGame, playerId: string) {
    const question = this.currentQuestion(game);
    const player = game.players.get(playerId);
    if (!question || !player)
      return { outcome: 'unanswered' as const, points: 0, score: 0, rank: 1 };
    const ranked = rankPlayers([...game.players.values()].map(rankable), game.settings.tieBreak);
    const entry = ranked.find((item) => item.id === playerId);
    const answered = player.answeredQuestionId === question.id;
    return {
      outcome: (answered ? (player.score > 0 ? 'correct' : 'wrong') : 'unanswered') as
        'correct' | 'wrong' | 'unanswered',
      points: 0,
      score: player.score,
      rank: entry?.rank ?? 1,
    };
  }

  /** Reveal the answer to the current question and show the distribution. */
  async reveal(gameId: string): Promise<GamePhase> {
    return this.withPhaseLock(gameId, () => this.revealInternal(gameId));
  }

  /**
   * Show the current question's solution — or, for a **skipped** question,
   * neutralise it instead (Phase 6.5.3).
   *
   * A skipped question is fully neutralised: it is never scored, and points any
   * player already earned for it are refunded so the question contributes
   * nothing to anyone's total. The refund is applied in a single transaction
   * (all answer rows zeroed, all player totals decremented) and is idempotent —
   * a second skip of the same question finds nothing left to refund. The
   * answers themselves are **kept** (only their `points` are zeroed), so the
   * history still shows what each player answered; the `skipped` event records
   * that the question was neutralised.
   *
   * The reveal emitted for a skip carries no solution and no distribution
   * (`skippedReveal`), so the host and the beamer can only show "question
   * skipped". A regular reveal is unchanged.
   *
   * Idempotent: the auto-reveal when everyone has answered may race a host
   * click, and a late timer may fire after the host already revealed.
   */
  private async revealInternal(
    gameId: string,
    options: { skipped?: boolean } = {},
  ): Promise<GamePhase> {
    const game = await this.get(gameId);
    // A no-op call must not clear the pending auto-advance timer. The timer is
    // the only thing that moves the game on from a screen, so clearing it on a
    // duplicate `reveal` (a double host click, or the auto-reveal racing a manual
    // one) would strand the game on the reveal screen forever (Phase 6.9.2
    // correction). The guards come first; only a real transition clears below.
    // A paused question never reveals on its own; only an explicit resume or
    // skip may leave the pause (Phase 6.5.3).
    if (game.paused && !options.skipped) return game.phase;
    if (game.phase === 'reveal' || game.phase === 'board' || game.phase === 'end') {
      return game.phase;
    }
    const question = this.currentQuestion(game);
    if (!question) throw conflict('There is no question to reveal.');

    this.clearTimer(game);

    const skipped = Boolean(options.skipped);

    // A skip neutralises the question: refund everything it awarded. Done before
    // the phase moves, so the emitted reveal already reflects the new totals and
    // a crash mid-refund cannot leave the game claiming a skipped question was
    // scored. `questionId` is set first, so a re-entrant skip is a no-op.
    if (skipped && game.skippedQuestionId !== question.id) {
      game.skippedQuestionId = question.id;
      await this.refundQuestion(game, question.id);
    }

    game.paused = false;
    game.pausedAt = null;
    game.remainingMs = null;
    game.phase = 'reveal';

    await setPhase(gameId, 'reveal', game.currentIndex);
    await logEvent(gameId, 'reveal', { questionId: question.id });
    if (skipped) {
      await logEvent(gameId, 'skipped', { questionId: question.id });
    }

    // Read the per-player score changes from the persisted rows (Phase 6.9.1).
    // For a skip the rows were just zeroed by `refundQuestion`, so the delta is
    // the refund; for a regular reveal it is the points each answer earned.
    const points = await this.pointsDeltas(game, question.id);

    this.emit('reveal', {
      gameId,
      reveal: skipped
        ? skippedReveal(question)
        : { skipped: false, question, distribution: Object.fromEntries(game.distribution) },
      points,
    });

    // The reveal window is fixed (Phase 6.9.3): reveal → leaderboard after 4 s,
    // in **both** modes. Only the answer resolution (question → reveal) and the
    // leaderboard advance (board → next) are AUTO-controlled.
    this.armRevealWindow(game);

    return 'reveal';
  }

  /**
   * Arm the answer clock for the running question (Phase 6.9.3): question →
   * reveal after `delayMs`. **AUTO only** — with AUTO off the host resolves the
   * answers by hand (`engine.reveal`), so no timer is armed and the question
   * stays open until the host acts. The delay is the full limit on a fresh
   * question and the exact remainder after a resume or a restart.
   *
   * The clock is anchored to `openedAt` (the server timestamp the question
   * opened) and its deadline never moves: the timer is a pure function of the
   * remaining time, so turning AUTO on/off does not restart or shift it. Any
   * timer already pending is replaced first, so there is never more than one.
   */
  private armQuestionClock(game: RuntimeGame, delayMs: number): void {
    if (!game.auto) return;
    this.clearTimer(game);
    game.timer = setTimeout(() => {
      void this.reveal(game.id).catch(() => undefined);
    }, delayMs);
  }

  /**
   * Arm the fixed reveal window (Phase 6.9.3): reveal → leaderboard after
   * `REVEAL_MS`. This one is **always** armed, in both modes — the concept fixes
   * the reveal at 4 seconds regardless of AUTO, and only the host's manual
   * `Leaderboard` click can shorten it.
   */
  private armRevealWindow(game: RuntimeGame): void {
    this.clearTimer(game);
    game.timer = setTimeout(() => {
      void this.board(game.id).catch(() => undefined);
    }, REVEAL_MS);
  }

  /**
   * Arm the leaderboard advance (Phase 6.9.3): board → next question after
   * `BOARD_MS`. **AUTO only** — with AUTO off the host starts the next round by
   * hand, so the leaderboard stays on screen for as long as the host wants.
   *
   * It only ever arms on the **board** phase. Without that guard a `setAuto(true)`
   * during a live question would arm a board advance on top of the answer clock,
   * overwriting the single `game.timer` slot and orphaning the answer clock — the
   * orphan then fired at expiry even after AUTO was switched off again, which
   * broke the "AUTO off ⇒ no automatic resolution" rule.
   */
  private armBoardAdvance(game: RuntimeGame): void {
    if (!game.auto) return;
    if (game.phase !== 'board') return;
    this.clearTimer(game);
    game.timer = setTimeout(() => {
      void this.next(game.id).catch(() => undefined);
    }, BOARD_MS);
  }

  /**
   * Undo everything a question awarded, atomically: every answer row for it is
   * zeroed (points, correctness, flagged — the raw answer and its timing are
   * kept for the report) and every player who scored on it has their `score`,
   * `correctCount` and `totalTimeMs` decremented by exactly what that row
   * granted. Runs in one transaction, so the totals can never disagree with the
   * rows. Idempotent by construction: after the rows are zeroed a second call
   * refunds nothing, because each row's contribution is read as 0.
   */
  private async refundQuestion(game: RuntimeGame, questionId: string): Promise<void> {
    const rows = await prisma.playerAnswer.findMany({
      where: { gameId: game.id, questionId },
      select: { id: true, playerId: true, points: true, correctness: true, elapsedMs: true },
    });
    if (rows.length === 0) return;

    const perPlayer = new Map<string, { points: number; correct: number; timeMs: number }>();
    for (const row of rows) {
      const entry = perPlayer.get(row.playerId) ?? { points: 0, correct: 0, timeMs: 0 };
      entry.points += row.points;
      entry.correct += row.correctness >= 1 ? 1 : 0;
      entry.timeMs += row.elapsedMs;
      perPlayer.set(row.playerId, entry);
    }

    await prisma.$transaction([
      prisma.playerAnswer.updateMany({
        where: { gameId: game.id, questionId },
        data: { points: 0, correctness: 0, flagged: false },
      }),
      ...[...perPlayer.entries()].map(([playerId, refund]) =>
        prisma.gamePlayer.update({
          where: { id: playerId },
          data: {
            score: { decrement: refund.points },
            correctCount: { decrement: refund.correct },
            totalTimeMs: { decrement: refund.timeMs },
          },
        }),
      ),
    ]);

    // Mirror the refund into the runtime only after the write commits, exactly
    // like `acceptAnswer`, so memory can never drift from the database.
    for (const [playerId, refund] of perPlayer) {
      const player = game.players.get(playerId);
      if (!player) continue;
      player.score -= refund.points;
      player.correctCount -= refund.correct;
      player.totalTimeMs -= refund.timeMs;
    }
  }

  /**
   * Pause the running question. Only a live question may be paused; the timer is
   * cleared and the remaining time is frozen server-side, so it can be restored
   * exactly by `resume` and survives a reconnect (Phase 6.5.3).
   */
  async pause(gameId: string): Promise<GamePhase> {
    return this.withPhaseLock(gameId, () => this.pauseInternal(gameId));
  }

  private async pauseInternal(gameId: string): Promise<GamePhase> {
    const game = await this.get(gameId);
    if (game.phase !== 'question') throw conflict('Only a running question can be paused.');
    if (game.paused) throw conflict('The question is already paused.');
    const question = this.currentQuestion(game);
    if (!question) throw conflict('There is no question to pause.');
    if (question.type === 'slide') throw conflict('A slide cannot be paused.');

    this.clearTimer(game);
    const remainingMs = Math.max(
      0,
      limitMs(question) - (Date.now() - (game.openedAt ?? Date.now())),
    );
    game.paused = true;
    game.pausedAt = Date.now();
    game.remainingMs = remainingMs;

    // Persisted in the existing event log (no migration): after a restart a
    // paused game must not silently run on or auto-end (Phase 6.5.3). Recovery
    // reads this back by `questionId`, so no event ordering is needed.
    await logEvent(gameId, 'paused', { questionId: question.id, remainingMs });

    this.emit('paused', { gameId, questionId: question.id, remainingMs });
    return game.phase;
  }

  /**
   * Resume a paused question with exactly the time that was left. The timer is
   * re-armed once and `openedAt` is shifted forward by the pause duration, so the
   * clock (and the elapsed-time scoring) continues as if the pause never
   * happened (Phase 6.5.3).
   */
  async resume(gameId: string): Promise<GamePhase> {
    return this.withPhaseLock(gameId, () => this.resumeInternal(gameId));
  }

  private async resumeInternal(gameId: string): Promise<GamePhase> {
    const game = await this.get(gameId);
    if (game.phase !== 'question') throw conflict('Only a running question can be resumed.');
    if (!game.paused) throw conflict('The question is not paused.');
    const question = this.currentQuestion(game);
    if (!question) throw conflict('There is no question to resume.');

    const remainingMs = game.remainingMs ?? limitMs(question);
    const pausedFor = game.pausedAt === null ? 0 : Date.now() - game.pausedAt;
    game.openedAt = (game.openedAt ?? Date.now()) + pausedFor;
    game.paused = false;
    game.pausedAt = null;
    game.remainingMs = null;

    // AUTO only: with AUTO off the host resolves the answers by hand, so the
    // remaining answer clock runs but nothing auto-reveals.
    this.armQuestionClock(game, remainingMs);

    await logEvent(gameId, 'resumed', { questionId: question.id, remainingMs });
    this.emit('resumed', { gameId, questionId: question.id, remainingMs });
    return game.phase;
  }

  /**
   * Skip the current question: it is **neutralised** (Phase 6.5.3, decision A).
   * It is never scored, points any player already earned for it are refunded by
   * `refundQuestion`, and the reveal emitted carries no solution and no
   * distribution, so the host and the beamer can only show "question skipped".
   * Works on a live or a paused question and reuses the reveal path, so it
   * cannot produce a second question or a duplicate phase change.
   */
  async skip(gameId: string): Promise<GamePhase> {
    return this.withPhaseLock(gameId, () => this.skipInternal(gameId));
  }

  private async skipInternal(gameId: string): Promise<GamePhase> {
    const game = await this.get(gameId);
    if (game.phase !== 'question') throw conflict('Only a running question can be skipped.');
    return this.revealInternal(gameId, { skipped: true });
  }

  /** Show the leaderboard for the current question. */
  async board(gameId: string): Promise<GamePhase> {
    return this.withPhaseLock(gameId, () => this.boardInternal(gameId));
  }

  private async boardInternal(gameId: string): Promise<GamePhase> {
    const game = await this.get(gameId);
    // Idempotent for a game already past the reveal, but never a legal jump from
    // an open question: a stale board timer that fires while a question is live
    // must not yank the screen to the leaderboard and lose the question.
    if (game.phase === 'board' || game.phase === 'end') return game.phase;
    if (game.phase !== 'reveal') throw conflict('There is nothing to rank yet.');
    // Cleared only once the call is known to be a real transition: a duplicate
    // `board` (a double host click, or the reveal's auto-timer racing a manual
    // click) must not clear the leaderboard's own auto-advance timer and strand
    // the game on the board (Phase 6.9.2 correction).
    this.clearTimer(game);
    game.paused = false;
    game.pausedAt = null;
    game.remainingMs = null;
    game.phase = 'board';
    await setPhase(gameId, 'board', game.currentIndex);
    // The rank movements for the question just scored (Phase 6.9.1), derived from
    // the same persisted deltas the reveal used, so the two screens always agree.
    const question = this.currentQuestion(game);
    const ranks = question ? await this.rankDeltas(game, question.id) : [];
    this.emit('board', {
      gameId,
      players: this.leaderboard(game),
      ranks,
      hasNext: this.hasNextQuestion(game),
    });

    // AUTO only (Phase 6.9.3): arm the advance to the next question. With AUTO off
    // the host starts the next round by hand, so the leaderboard stays on screen
    // for as long as the host wants to talk it through.
    this.armBoardAdvance(game);

    return 'board';
  }

  /** End the game and persist the final ordering. */
  async end(gameId: string): Promise<GamePhase> {
    return this.withPhaseLock(gameId, () => this.endInternal(gameId));
  }

  private async endInternal(gameId: string): Promise<GamePhase> {
    const game = await this.get(gameId);
    this.clearTimer(game);
    if (game.phase === 'end') return 'end';
    game.paused = false;
    game.pausedAt = null;
    game.remainingMs = null;
    game.phase = 'end';
    await setPhase(gameId, 'end', game.currentIndex, { endedAt: new Date() });
    await logEvent(gameId, 'ended', {});
    this.emit('ended', { gameId, players: this.leaderboard(game) });
    return 'end';
  }

  /** Whether the given phase is a legal successor of the current one. */
  static isKnownPhase(phase: string): phase is GamePhase {
    return (GAME_PHASES as readonly string[]).includes(phase);
  }
}

/** A single engine shared by the process. */
export const engine = new GameEngine();
