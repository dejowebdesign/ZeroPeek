/**
 * Game reports and statistics.
 *
 * Everything here is derived from stored game data, so a report never depends
 * on in-memory state. Two exports are offered: a full CSV of every answer, and
 * a summary CSV of the final ranking.
 */

import { prisma } from '../db.js';
import { notFound } from '../errors.js';
import { getQuiz } from './quizService.js';
import { toQuestion } from '../mappers.js';

/** A finished game as shown in the reports list. */
export async function listGames(filter: { quizId?: string; limit?: number } = {}) {
  return prisma.game.findMany({
    where: { ...(filter.quizId ? { quizId: filter.quizId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: filter.limit ?? 50,
    select: {
      id: true,
      pin: true,
      phase: true,
      createdAt: true,
      endedAt: true,
      quiz: { select: { id: true, title: true } },
      _count: { select: { players: true } },
    },
  });
}

/** Full report for one game: ranking, per-question stats and per-player detail. */
export async function gameReport(gameId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      quiz: true,
      players: { orderBy: { score: 'desc' } },
      events: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!game) throw notFound('Game not found.');

  const quiz = await getQuiz(game.quizId);
  const answers = await prisma.playerAnswer.findMany({
    where: { gameId },
    include: { player: { select: { nickname: true } } },
  });

  // Per-question statistics: how many answered, how many were correct, mean
  // correctness. Unanswered questions still appear with zero counts.
  const perQuestion = quiz.questions.map((question, index) => {
    const rows = answers.filter((row) => row.questionId === question.id);
    const correct = rows.filter((row) => row.correctness >= 1).length;
    const meanCorrectness =
      rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + row.correctness, 0) / rows.length;
    return {
      index,
      questionId: question.id,
      type: question.type,
      text: question.text,
      answered: rows.length,
      correct,
      meanCorrectness: Number(meanCorrectness.toFixed(4)),
      flagged: rows.filter((row) => row.flagged).length,
    };
  });

  const perPlayer = game.players.map((player, index) => {
    const rows = answers.filter((row) => row.playerId === player.id);
    return {
      rank: index + 1,
      playerId: player.id,
      nickname: player.nickname,
      score: player.score,
      correctCount: player.correctCount,
      totalTimeMs: player.totalTimeMs,
      answered: rows.length,
    };
  });

  return {
    game: {
      id: game.id,
      pin: game.pin,
      phase: game.phase,
      createdAt: game.createdAt,
      startedAt: game.startedAt,
      endedAt: game.endedAt,
    },
    quiz: { id: quiz.id, title: quiz.title, questionCount: quiz.questions.length },
    players: perPlayer,
    questions: perQuestion,
    events: game.events.map((event) => ({
      type: event.type,
      at: event.createdAt,
      data: event.data,
    })),
  };
}

/** Aggregate statistics across games, optionally for one quiz. */
export async function quizStatistics(quizId: string) {
  const quiz = await getQuiz(quizId);
  const games = await prisma.game.findMany({
    where: { quizId, phase: 'end' },
    select: { id: true },
  });
  const gameIds = games.map((game) => game.id);

  const answers = gameIds.length
    ? await prisma.playerAnswer.findMany({ where: { gameId: { in: gameIds } } })
    : [];

  const perQuestion = quiz.questions.map((question, index) => {
    const rows = answers.filter((row) => row.questionId === question.id);
    const correct = rows.filter((row) => row.correctness >= 1).length;
    return {
      index,
      questionId: question.id,
      type: question.type,
      text: question.text,
      answered: rows.length,
      correct,
      correctRate: rows.length === 0 ? 0 : Number((correct / rows.length).toFixed(4)),
    };
  });

  return {
    quiz: { id: quiz.id, title: quiz.title },
    gamesPlayed: gameIds.length,
    totalAnswers: answers.length,
    questions: perQuestion,
  };
}

/** Escape one CSV field (RFC 4180): quote when it contains a delimiter. */
function csvField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\n');
}

/** Every answer of a game as CSV, one row per player and question. */
export async function exportAnswersCsv(gameId: string): Promise<string> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { quiz: { include: { questions: { orderBy: { position: 'asc' } } } } },
  });
  if (!game) throw notFound('Game not found.');

  const answers = await prisma.playerAnswer.findMany({
    where: { gameId },
    include: { player: { select: { nickname: true } } },
  });

  const header = [
    'pin',
    'nickname',
    'question_position',
    'question_type',
    'question_text',
    'answer',
    'correctness',
    'points',
    'elapsed_ms',
    'flagged',
  ];

  const rows: unknown[][] = [header];
  for (const player of await prisma.gamePlayer.findMany({
    where: { gameId },
    orderBy: { joinedAt: 'asc' },
  })) {
    for (const [position, question] of game.quiz.questions.entries()) {
      const row = answers.find(
        (entry) => entry.playerId === player.id && entry.questionId === question.id,
      );
      const mapped = toQuestion({
        id: question.id,
        quizId: question.quizId,
        type: question.type,
        text: question.text,
        timeLimit: question.timeLimit,
        points: question.points,
        position: question.position,
        payload: question.payload,
      });
      rows.push([
        game.pin,
        player.nickname,
        position + 1,
        mapped.type,
        mapped.text,
        row ? JSON.stringify(row.answer) : '',
        row ? row.correctness : '',
        row ? row.points : '',
        row ? row.elapsedMs : '',
        row ? row.flagged : '',
      ]);
    }
  }
  return toCsv(rows);
}

/** The final ranking of a game as CSV. */
export async function exportRankingCsv(gameId: string): Promise<string> {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw notFound('Game not found.');
  const players = await prisma.gamePlayer.findMany({
    where: { gameId },
    orderBy: [{ score: 'desc' }, { totalTimeMs: 'asc' }],
  });
  const rows: unknown[][] = [['rank', 'nickname', 'score', 'correct_count', 'total_time_ms']];
  players.forEach((player, index) => {
    rows.push([index + 1, player.nickname, player.score, player.correctCount, player.totalTimeMs]);
  });
  return toCsv(rows);
}
