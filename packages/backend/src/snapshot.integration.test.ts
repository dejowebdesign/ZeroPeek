/**
 * Integration tests for the immutable game snapshot (Phase 6.4).
 *
 * The product rule these tests pin down: once a game has started, editing or
 * deleting its quiz must not change the running round, its report, its exports
 * or its statistics. Before Phase 6.4 a quiz edit rewrote history (risk R-3);
 * these tests fail against that old behaviour and pass with the snapshot.
 *
 * Skipped automatically when no database is reachable (see testing/db.ts).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Quiz } from '@zeropeek/shared';

import { prisma } from './db.js';
import { engine } from './services/engine.js';
import { createUser } from './services/userService.js';
import { createQuiz, deleteQuiz, updateQuiz } from './services/quizService.js';
import { createGame, joinGame } from './services/gameService.js';
import {
  exportAnswersCsv,
  gameReport,
  listGames,
  quizStatistics,
} from './services/reportService.js';
import { findSnapshot } from './services/snapshotService.js';
import { canConnect, resetDatabase } from './testing/db.js';

const available = await canConnect();

/** A quiz whose questions are easy to tell apart after an edit. */
function quizFixture(suffix: string): Quiz {
  return {
    id: `00000000-0000-4000-8000-0000000001${suffix}`,
    title: 'Original title',
    description: '',
    theme: 'standard',
    defaultTimeLimit: 20,
    category: 'Geography',
    difficulty: 'Easy',
    questions: [
      {
        id: `00000000-0000-4000-8000-0000000002${suffix}a1`,
        type: 'single',
        text: 'ORIGINAL question one',
        timeLimit: 20,
        points: 'standard',
        options: ['A', 'B'],
        correctIndex: 0,
      },
      {
        id: `00000000-0000-4000-8000-0000000002${suffix}a2`,
        type: 'single',
        text: 'ORIGINAL question two',
        timeLimit: 20,
        points: 'standard',
        options: ['A', 'B'],
        correctIndex: 1,
      },
    ],
  };
}

describe.skipIf(!available)('game snapshot integration', () => {
  let ownerId = '';
  /** Monotonic counter so every test gets its own quiz and no ordering matters. */
  let seq = 0;

  beforeAll(async () => {
    await resetDatabase(prisma);
    const owner = await createUser({
      username: 'snapshotowner',
      password: 'correct-horse-battery',
      role: 'TRAINER',
    });
    ownerId = owner.id;
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  /** A fresh quiz owned by the test owner. */
  async function makeQuiz(): Promise<{ id: string }> {
    seq += 1;
    return createQuiz(ownerId, quizFixture(seq.toString(16).padStart(2, '0')));
  }

  /** Start a fresh game on `quizId` with one player and return its ids. */
  async function startedGame(quizId: string): Promise<{ gameId: string; playerId: string }> {
    const row = await createGame(quizId, ownerId);
    const { player } = await joinGame(row.pin, `Ada-${Math.random().toString(36).slice(2, 8)}`);
    await engine.addPlayer(row.id, {
      id: player.id,
      nickname: player.nickname,
      avatar: player.avatar,
      joinedAt: player.joinedAt,
    });
    await engine.start(row.id);
    return { gameId: row.id, playerId: player.id };
  }

  /** The one-question replacement used by the edit tests. */
  function editedQuiz(id: string): Partial<Quiz> {
    return {
      title: 'Edited title',
      questions: [
        {
          id: `${id}-edited`,
          type: 'single',
          text: 'EDITED question',
          timeLimit: 20,
          points: 'standard',
          options: ['A', 'B'],
          correctIndex: 0,
        },
      ],
    };
  }

  it('freezes the quiz when the game starts', async () => {
    const quiz = await makeQuiz();
    const { gameId } = await startedGame(quiz.id);
    const snapshot = await findSnapshot(gameId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.quiz.title).toBe('Original title');
    expect(snapshot!.quiz.questions[0]!.text).toBe('ORIGINAL question one');
  });

  it('is idempotent: starting twice keeps a single snapshot', async () => {
    const quiz = await makeQuiz();
    const { gameId } = await startedGame(quiz.id);
    // A second start is refused by the engine (already running), which is the
    // path a double-click takes; the snapshot must still be unique.
    await expect(engine.start(gameId)).rejects.toThrow(/already started/i);
    expect(await prisma.gameSnapshot.count({ where: { gameId } })).toBe(1);
  });

  it('keeps the running game on the frozen questions after the quiz is edited', async () => {
    const quiz = await makeQuiz();
    const { gameId } = await startedGame(quiz.id);

    await updateQuiz(quiz.id, ownerId, false, editedQuiz(quiz.id));

    // A fresh engine (no in-memory cache) must reload from the snapshot.
    engine.evict(gameId);
    const game = await engine.get(gameId);
    expect(game.quiz.questions).toHaveLength(2);
    expect(game.quiz.questions[0]!.text).toBe('ORIGINAL question one');
    expect(game.quiz.title).toBe('Original title');
  });

  it('reports the questions as they were asked, even after an edit', async () => {
    const quiz = await makeQuiz();
    const { gameId, playerId } = await startedGame(quiz.id);
    const question = engine.publicQuestion(await engine.get(gameId));
    await engine.submitAnswer(gameId, playerId, question.id, 0);

    await updateQuiz(quiz.id, ownerId, false, editedQuiz(quiz.id));

    const report = await gameReport(gameId);
    expect(report.quiz.title).toBe('Original title');
    expect(report.quiz.questionCount).toBe(2);
    expect(report.questions.map((row) => row.text)).toEqual([
      'ORIGINAL question one',
      'ORIGINAL question two',
    ]);
    // The answer is still attributed to the original question.
    expect(report.questions[0]!.answered).toBe(1);
    expect(report.questions[0]!.correct).toBe(1);
  });

  it('survives deleting the quiz: game, answers and report stay intact', async () => {
    const quiz = await makeQuiz();
    const { gameId, playerId } = await startedGame(quiz.id);
    const question = engine.publicQuestion(await engine.get(gameId));
    await engine.submitAnswer(gameId, playerId, question.id, 0);
    const before = await prisma.playerAnswer.count({ where: { gameId } });

    await deleteQuiz(quiz.id, ownerId, false);

    // The game row remains, but its `quiz_id` is cleared.
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    expect(game).not.toBeNull();
    expect(game!.quizId).toBeNull();
    // The answers were not cascaded away with the quiz.
    expect(await prisma.playerAnswer.count({ where: { gameId } })).toBe(before);

    // The report still renders from the snapshot.
    const report = await gameReport(gameId);
    expect(report.quiz.title).toBe('Original title');
    expect(report.quiz.questionCount).toBe(2);

    // The list shows the frozen title even though the live quiz is gone.
    const listed = (await listGames()).find((row) => row.id === gameId);
    expect(listed).toBeDefined();
    expect(listed!.quiz?.title).toBe('Original title');
    expect(listed!.questionCount).toBe(2);

    // The CSV export still names the original questions.
    const csv = await exportAnswersCsv(gameId);
    expect(csv).toContain('ORIGINAL question one');
    expect(csv).not.toContain('EDITED question');
  });

  it('counts statistics against the snapshot questions', async () => {
    const quiz = await makeQuiz();
    const { gameId, playerId } = await startedGame(quiz.id);
    const question = engine.publicQuestion(await engine.get(gameId));
    await engine.submitAnswer(gameId, playerId, question.id, 0);
    await engine.end(gameId);

    const stats = await quizStatistics(quiz.id);
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.questions[0]!.answered).toBe(1);
    expect(stats.questions[0]!.correct).toBe(1);
    expect(stats.questions[1]!.answered).toBe(0);
  });

  it('holds the database guarantees that protect history', async () => {
    // These two constraints *are* the R-3 fix, so assert them at the database
    // level. Without this, a future migration could silently reintroduce the
    // cascade that destroyed answer history. See the Phase 6.4 report §7.
    const answerFks = await prisma.$queryRawUnsafe<{ conname: string }[]>(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'player_answers'::regclass AND contype = 'f'`,
    );
    // `player_answers.question_id` deliberately has NO foreign key: the value is
    // a frozen historical id, and a foreign key would either cascade the answer
    // away or null the id when the quiz is deleted.
    expect(answerFks.map((row) => row.conname)).not.toContain('player_answers_question_id_fkey');

    // `games.quiz_id` must be SET NULL ('n'), so a game outlives its quiz.
    const gameFk = await prisma.$queryRawUnsafe<{ confdeltype: string }[]>(
      `SELECT confdeltype FROM pg_constraint WHERE conname = 'games_quiz_id_fkey'`,
    );
    expect(gameFk[0]?.confdeltype).toBe('n');
  });
});
