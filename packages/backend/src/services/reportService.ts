/**
 * Game reports and statistics.
 *
 * Everything here is derived from stored game data, so a report never depends
 * on in-memory state. Two exports are offered: a full CSV of every answer, and
 * a summary CSV of the final ranking.
 *
 * Phase 6.4: a report reads the questions from the game's **snapshot**, never
 * from the live quiz. A game whose quiz was edited or deleted still reports the
 * questions exactly as they were asked.
 */

import { parseSnapshotData } from '@zeropeek/shared';

import { prisma } from '../db.js';
import { notFound } from '../errors.js';
import { getQuiz } from './quizService.js';
import { quizForGame } from './snapshotService.js';

/** A finished game as shown in the reports list. */
export async function listGames(filter: { quizId?: string; limit?: number } = {}) {
  const games = await prisma.game.findMany({
    where: { ...(filter.quizId ? { quizId: filter.quizId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: filter.limit ?? 50,
    select: {
      id: true,
      pin: true,
      phase: true,
      createdAt: true,
      endedAt: true,
      quizId: true,
      quiz: { select: { id: true, title: true } },
      snapshot: { select: { title: true, questionCount: true } },
      _count: { select: { players: true } },
    },
  });

  // The list prefers the frozen title (what the round was actually played as)
  // and falls back to the live quiz title for a game that has no snapshot yet.
  return games.map((game) => ({
    id: game.id,
    pin: game.pin,
    phase: game.phase,
    createdAt: game.createdAt,
    endedAt: game.endedAt,
    quiz: game.quiz
      ? { id: game.quiz.id, title: game.snapshot?.title ?? game.quiz.title }
      : game.snapshot
        ? { id: game.quizId, title: game.snapshot.title }
        : null,
    questionCount: game.snapshot?.questionCount ?? null,
    _count: game._count,
  }));
}

/** Full report for one game: ranking, per-question stats and per-player detail. */
export async function gameReport(gameId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      players: { orderBy: { score: 'desc' } },
      events: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!game) throw notFound('Game not found.');

  // The questions come from the snapshot the run was played with.
  const quiz = await quizForGame({ id: game.id, quizId: game.quizId, phase: game.phase });
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

/**
 * Aggregate statistics across games, optionally for one quiz.
 *
 * The per-question breakdown is built from each game's **snapshot**, keyed by
 * question id, so a question the author later rewrote or deleted still counts
 * exactly as it was asked. Games without a snapshot (started before Phase 6.4)
 * fall back to the live quiz so their history is not lost either.
 */
export async function quizStatistics(quizId: string) {
  const quiz = await getQuiz(quizId);
  const games = await prisma.game.findMany({
    where: { quizId, phase: 'end' },
    select: { id: true, snapshot: { select: { payload: true } } },
  });
  const gameIds = games.map((game) => game.id);

  const answers = gameIds.length
    ? await prisma.playerAnswer.findMany({ where: { gameId: { in: gameIds } } })
    : [];

  // A question only counts for the games whose snapshot actually contained it.
  // A game without a snapshot (started before Phase 6.4) falls back to the live
  // quiz, so its history is not lost.
  const liveIds = new Set(quiz.questions.map((question) => question.id));
  const gameQuestionIds = new Map<string, Set<string>>();
  for (const game of games) {
    const snapshot = parseSnapshotData(game.snapshot?.payload);
    gameQuestionIds.set(
      game.id,
      snapshot ? new Set(snapshot.quiz.questions.map((item) => item.id)) : liveIds,
    );
  }

  const perQuestion = quiz.questions.map((question, index) => {
    const rows = answers.filter(
      (row) =>
        row.questionId === question.id &&
        (gameQuestionIds.get(row.gameId)?.has(question.id) ?? false),
    );
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
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw notFound('Game not found.');

  // Questions come from the snapshot, so the export matches what was asked even
  // after the quiz was edited or deleted (Phase 6.4).
  const quiz = await quizForGame({ id: game.id, quizId: game.quizId, phase: game.phase });

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
    for (const [position, question] of quiz.questions.entries()) {
      const row = answers.find(
        (entry) => entry.playerId === player.id && entry.questionId === question.id,
      );
      rows.push([
        game.pin,
        player.nickname,
        position + 1,
        question.type,
        question.text,
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
