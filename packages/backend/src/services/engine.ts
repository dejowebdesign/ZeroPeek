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
  reveal: [{ gameId: string; question: Question; distribution: Record<string, number> }];
  board: [{ gameId: string; players: PublicPlayer[] }];
  ended: [{ gameId: string; players: PublicPlayer[] }];
}

/** How long the reveal and board screens stay before auto-advance (ms). */
export const REVEAL_MS = 6000;
export const BOARD_MS = 6000;

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
   * reveals immediately if it has already expired).
   */
  private async recoverCurrentQuestion(runtime: RuntimeGame): Promise<void> {
    if (runtime.phase !== 'question') return;
    const question = this.currentQuestion(runtime);
    if (!question) return;

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

    const opened = await prisma.gameEvent.findFirst({
      where: { gameId: runtime.id, type: 'question' },
      orderBy: { createdAt: 'desc' },
    });
    const openedAt = opened ? opened.createdAt.getTime() : Date.now();
    runtime.openedAt = openedAt;

    if (question.type === 'slide') return;
    const remainingMs = question.timeLimit * 1000 + ANSWER_GRACE_MS - (Date.now() - openedAt);
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

  private emitLobby(game: RuntimeGame): void {
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
    const game = await this.get(gameId);
    if (game.phase === 'lobby') throw conflict('Start the game first.');
    this.clearTimer(game);

    const nextIndex = game.currentIndex + 1;
    if (nextIndex >= game.quiz.questions.length) {
      return this.end(gameId);
    }

    game.currentIndex = nextIndex;
    game.phase = 'question';
    const question = game.quiz.questions[nextIndex]!;
    game.distribution = new Map();
    game.openedAt = Date.now();

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

    const limitMs = question.timeLimit * 1000 + ANSWER_GRACE_MS;
    game.timer = setTimeout(() => {
      void this.reveal(gameId).catch(() => undefined);
    }, limitMs);

    return 'question';
  }

  /** Start the game: freeze the quiz, leave the lobby and open the first question. */
  async start(gameId: string): Promise<GamePhase> {
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
    return this.next(gameId);
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
    if (elapsedMs > question.timeLimit * 1000 + ANSWER_GRACE_MS) {
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

    const answer: PlayerAnswerState = {
      questionId: question.id,
      answered: stored !== null,
      answer: stored ? (stored.answer ?? null) : null,
      // Only the reveal makes the result meaningful. This mirrors the live
      // `game:reveal` event, which also reports `unanswered` for a player who did
      // not answer, so a reconnect and a live reveal render identically.
      result:
        game.phase === 'reveal'
          ? stored
            ? {
                outcome: outcomeOf(stored.correctness),
                points: stored.points,
                score,
                rank: ownRank,
              }
            : { outcome: 'unanswered', points: 0, score, rank: ownRank }
          : null,
    };

    return {
      ...empty,
      question: this.publicQuestion(game),
      answer,
      board: game.phase === 'board' ? ranked : null,
    };
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
    const game = await this.get(gameId);
    this.clearTimer(game);
    // Idempotent: the auto-reveal when everyone has answered may race a host
    // click, and a late timer may fire after the host already revealed.
    if (game.phase === 'reveal' || game.phase === 'board' || game.phase === 'end') {
      return game.phase;
    }
    const question = this.currentQuestion(game);
    if (!question) throw conflict('There is no question to reveal.');
    game.phase = 'reveal';

    await setPhase(gameId, 'reveal', game.currentIndex);
    await logEvent(gameId, 'reveal', { questionId: question.id });

    this.emit('reveal', {
      gameId,
      question,
      distribution: Object.fromEntries(game.distribution),
    });

    game.timer = setTimeout(() => {
      void this.board(gameId).catch(() => undefined);
    }, REVEAL_MS);

    return 'reveal';
  }

  /** Show the leaderboard for the current question. */
  async board(gameId: string): Promise<GamePhase> {
    const game = await this.get(gameId);
    this.clearTimer(game);
    if (game.phase === 'board' || game.phase === 'end') return game.phase;
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
    const game = await this.get(gameId);
    this.clearTimer(game);
    if (game.phase === 'end') return 'end';
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
