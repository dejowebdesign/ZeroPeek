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
  type GamePhase,
  type PublicPlayer,
  type PublicQuestion,
  type Question,
  type Quiz,
  type RankablePlayer,
  type ScoringSettings,
} from '@zeropeek/shared';

import { prisma } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { getQuiz } from './quizService.js';
import { gameSettings, logEvent, listPlayers, setPhase } from './gameService.js';

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

    const row = await prisma.game.findUnique({ where: { id: gameId } });
    if (!row) throw notFound('Game not found.');
    const quiz = await getQuiz(row.quizId);
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
    this.games.set(gameId, runtime);
    return runtime;
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
   */
  async next(gameId: string): Promise<GamePhase> {
    const game = await this.get(gameId);
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

    await setPhase(gameId, 'question', nextIndex, {
      ...(nextIndex === 0 ? { startedAt: new Date() } : {}),
    });
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

  /** Start the game: leave the lobby and open the first question. */
  async start(gameId: string): Promise<GamePhase> {
    const game = await this.get(gameId);
    if (game.phase !== 'lobby') throw conflict('The game has already started.');
    if (game.players.size === 0) throw conflict('Nobody has joined yet.');
    game.currentIndex = -1;
    return this.next(gameId);
  }

  /**
   * Accept a player's answer. Enforces: the game is in the question phase, the
   * question id matches, the player has not answered yet, and the answer
   * arrives within the time limit (+grace). Returns whether it was accepted.
   */
  async submitAnswer(
    gameId: string,
    playerId: string,
    questionId: string,
    answer: unknown,
  ): Promise<{ accepted: boolean }> {
    const game = await this.get(gameId);
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

    player.answeredQuestionId = questionId;
    player.score += points;
    player.totalTimeMs += elapsedMs;
    if (result.outcome === 'correct') player.correctCount += 1;

    const key = JSON.stringify(answer ?? null);
    game.distribution.set(key, (game.distribution.get(key) ?? 0) + 1);

    await prisma.playerAnswer.create({
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
    });
    await prisma.gamePlayer.update({
      where: { id: playerId },
      data: {
        score: player.score,
        correctCount: player.correctCount,
        totalTimeMs: player.totalTimeMs,
      },
    });

    const answered = [...game.players.values()].filter(
      (entry) => entry.answeredQuestionId === questionId,
    ).length;
    this.emit('answers', { gameId, questionId, answered, total: game.players.size });

    // Everyone answered: reveal early.
    if (answered >= game.players.size) {
      this.clearTimer(game);
      void this.reveal(gameId).catch(() => undefined);
    }

    return { accepted: true };
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
