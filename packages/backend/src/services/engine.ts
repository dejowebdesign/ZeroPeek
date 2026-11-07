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
  type OwnResult,
  type PublicPlayer,
  type PublicQuestion,
  type Question,
  type Quiz,
  type PlayerAnswerState,
  type PlayerSync,
  type RankablePlayer,
  type ScoringSettings,
} from '@zeropeek/shared';
import { prisma } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { gameSettings, logEvent, listPlayers, setPhase } from './gameService.js';
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
  players: Map<string, RuntimePlayer>;
  /** Answer tally for the current question: questionId -> option key -> count. */
  distribution: Map<string, number>;
  timer: NodeJS.Timeout | null;
}

/** Event payloads emitted by the engine. */
export interface EngineEvents {
  lobby: [{ gameId: string; pin: string; players: PublicPlayer[] }];
  question: [{ gameId: string; question: PublicQuestion }];
  answers: [{ gameId: string; questionId: string; answered: number; total: number }];
  reveal: [{ gameId: string; reveal: HostReveal }];
  board: [{ gameId: string; players: PublicPlayer[] }];
  ended: [{ gameId: string; players: PublicPlayer[] }];
  paused: [{ gameId: string; questionId: string; remainingMs: number }];
  resumed: [{ gameId: string; questionId: string; remainingMs: number }];
}

/** How long the reveal and board screens stay before auto-advance (ms). */
export const REVEAL_MS = 6000;
export const BOARD_MS = 6000;

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
      where: { gameId: runtime.id, type: { in: ['question', 'paused', 'resumed', 'skipped'] } },
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

  private clearTimer(game: RuntimeGame): void {
    if (game.timer) {
      clearTimeout(game.timer);
      game.timer = null;
    }
  }

  /** The lobby roster and PIN, broadcast to hosts and players. */
  emitLobby(game: RuntimeGame): void {
    this.emit('lobby', {
      gameId: game.id,
      pin: game.pin,
      players: [...game.players.values()].map(publicPlayer),
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

    game.timer = setTimeout(() => {
      void this.reveal(gameId).catch(() => undefined);
    }, limitMs(question));

    return 'question';
  }

  /** Start the game: freeze the quiz, leave the lobby and open the first question. */
  async start(gameId: string): Promise<GamePhase> {
    return this.withPhaseLock(gameId, () => this.startInternal(gameId));
  }

  private async startInternal(gameId: string): Promise<GamePhase> {
    const game = await this.get(gameId);
    if (game.phase !== 'lobby') throw conflict('The game has already started.');
    if (game.players.size === 0) throw conflict('Nobody has joined yet.');

    // Freeze the quiz **before** the first question opens (Phase 6.4). The copy
    // is committed in one transaction with the start stamp, so from here on the
    // run reads the snapshot and a later quiz edit or delete cannot touch it.
    // If this throws, the game stays in the lobby and nothing is frozen.
    const snapshot = await startWithSnapshot(gameId);
    game.quiz = snapshotToQuiz(snapshot.quiz);
    game.currentIndex = -1;
    // The snapshot is in place, so it is safe to leave the lobby now.
    game.phase = 'question';
    return this.nextInternal(gameId);
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

    // Everyone answered: reveal early. `reveal` is idempotent, so the last players
    // arriving together still produce exactly one reveal.
    if (answered >= game.players.size) {
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
    };

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
  hostState(game: RuntimeGame): HostState {
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
      paused: false,
      skipped: false,
    };

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
      return {
        ...empty,
        question: this.publicQuestion(game),
        reveal: skipped
          ? skippedReveal(question)
          : { skipped: false, question, distribution: Object.fromEntries(game.distribution) },
        answers,
        skipped,
      };
    }

    if (game.phase === 'board') {
      return { ...empty, players: this.leaderboard(game), skipped };
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
    this.clearTimer(game);
    // A paused question never reveals on its own; only an explicit resume or
    // skip may leave the pause (Phase 6.5.3).
    if (game.paused && !options.skipped) return game.phase;
    if (game.phase === 'reveal' || game.phase === 'board' || game.phase === 'end') {
      return game.phase;
    }
    const question = this.currentQuestion(game);
    if (!question) throw conflict('There is no question to reveal.');

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

    this.emit('reveal', {
      gameId,
      reveal: skipped
        ? skippedReveal(question)
        : { skipped: false, question, distribution: Object.fromEntries(game.distribution) },
    });

    game.timer = setTimeout(() => {
      void this.board(gameId).catch(() => undefined);
    }, REVEAL_MS);

    return 'reveal';
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

    game.timer = setTimeout(() => {
      void this.reveal(gameId).catch(() => undefined);
    }, remainingMs);

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
    this.clearTimer(game);
    if (game.phase === 'board' || game.phase === 'end') return game.phase;
    game.paused = false;
    game.pausedAt = null;
    game.remainingMs = null;
    game.phase = 'board';
    await setPhase(gameId, 'board', game.currentIndex);
    this.emit('board', { gameId, players: this.leaderboard(game) });

    game.timer = setTimeout(() => {
      void this.next(gameId).catch(() => undefined);
    }, BOARD_MS);

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
