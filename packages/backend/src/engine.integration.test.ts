/**
 * Integration tests for the server-authoritative game engine.
 *
 * Skipped automatically when no database is reachable (see testing/db.ts).
 * These tests drive the real engine against a real database: they assert the
 * phase machine, that points are computed and persisted server-side, and that
 * invalid answers (duplicate, late, wrong phase) are rejected.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Quiz } from '@zeropeek/shared';

import { prisma } from './db.js';
import { engine } from './services/engine.js';
import { createUser } from './services/userService.js';
import { createQuiz } from './services/quizService.js';
import { createGame, joinGame } from './services/gameService.js';
import { canConnect, resetDatabase } from './testing/db.js';

const available = await canConnect();

const QUIZ: Quiz = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Engine test',
  description: '',
  theme: 'standard',
  defaultTimeLimit: 20,
  questions: [
    {
      id: '00000000-0000-4000-8000-0000000000a1',
      type: 'single',
      text: 'Capital of France?',
      timeLimit: 20,
      points: 'standard',
      options: ['Paris', 'Rome'],
      correctIndex: 0,
    },
    {
      id: '00000000-0000-4000-8000-0000000000a2',
      type: 'single',
      text: 'Capital of Italy?',
      timeLimit: 20,
      points: 'standard',
      options: ['Milan', 'Rome'],
      correctIndex: 1,
    },
  ],
};

describe.skipIf(!available)('game engine integration', () => {
  let ownerId = '';
  let quizId = '';

  beforeAll(async () => {
    await resetDatabase(prisma);
    const owner = await createUser({
      username: 'enginehost',
      password: 'correct-horse-battery',
      role: 'TRAINER',
    });
    ownerId = owner.id;
    const quiz = await createQuiz(ownerId, QUIZ);
    quizId = quiz.id;
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.playerAnswer.deleteMany();
    await prisma.gameEvent.deleteMany();
    await prisma.gamePlayer.deleteMany();
    await prisma.game.deleteMany();
  });

  /** Create a game with the named players, loaded into the engine. */
  async function freshGame(nicknames: string[] = ['Ada']) {
    const row = await createGame(quizId, ownerId);
    const joined = [];
    for (const nickname of nicknames) {
      const { player } = await joinGame(row.pin, nickname);
      await engine.addPlayer(row.id, {
        id: player.id,
        nickname: player.nickname,
        avatar: player.avatar,
        joinedAt: player.joinedAt,
      });
      joined.push(player);
    }
    return {
      gameId: row.id,
      playerId: joined[0]!.id,
      playerIds: joined.map((p) => p.id),
      pin: row.pin,
    };
  }

  it('allocates a PIN in the shared alphabet', async () => {
    const row = await createGame(quizId, ownerId);
    expect(row.pin).toMatch(/^[234679ACDEFGHJKMNPQRTUVWXYZ]{6}$/);
  });

  it('refuses to start with no players', async () => {
    const row = await createGame(quizId, ownerId);
    await expect(engine.start(row.id)).rejects.toThrow(/joined/i);
  });

  it('runs the full lifecycle and persists a correct answer', async () => {
    // Two players: one answers, so the engine does not auto-reveal and the
    // host-driven reveal/board path is exercised deterministically.
    const { gameId, playerId } = await freshGame(['Ada', 'Bob']);

    const phases: string[] = [];
    engine.on('question', () => phases.push('question'));
    engine.on('reveal', () => phases.push('reveal'));
    engine.on('board', () => phases.push('board'));

    await engine.start(gameId);
    const question = engine.publicQuestion(await engine.get(gameId));
    expect(question.id).toBe(QUIZ.questions[0]!.id);
    // The public question must never contain the solution.
    expect(JSON.stringify(question)).not.toContain('correctIndex');

    const result = await engine.submitAnswer(gameId, playerId, question.id, 0);
    expect(result.accepted).toBe(true);

    // The answer is persisted with points computed on the server.
    const stored = await prisma.playerAnswer.findFirst({ where: { gameId, playerId } });
    expect(stored).not.toBeNull();
    expect(stored!.correctness).toBe(1);
    expect(stored!.points).toBeGreaterThan(0);

    const player = await prisma.gamePlayer.findUnique({ where: { id: playerId } });
    expect(player!.score).toBe(stored!.points);

    await engine.reveal(gameId);
    await engine.board(gameId);
    expect(phases.slice(0, 3)).toEqual(['question', 'reveal', 'board']);

    await engine.next(gameId);
    const second = engine.publicQuestion(await engine.get(gameId));
    expect(second.id).toBe(QUIZ.questions[1]!.id);

    await engine.end(gameId);
    expect((await prisma.game.findUnique({ where: { id: gameId } }))!.phase).toBe('end');
  });

  it('reveals automatically once every player has answered', async () => {
    const { gameId, playerId } = await freshGame(['Ada']);
    await engine.start(gameId);
    const question = engine.publicQuestion(await engine.get(gameId));
    await engine.submitAnswer(gameId, playerId, question.id, 0);
    // The auto-reveal is fire-and-forget; give it a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await engine.get(gameId)).phase).toBe('reveal');
  });

  it('awards no points for a wrong answer but still records it', async () => {
    const { gameId, playerId } = await freshGame();
    await engine.start(gameId);
    const question = engine.publicQuestion(await engine.get(gameId));

    await engine.submitAnswer(gameId, playerId, question.id, 1); // wrong option

    const stored = await prisma.playerAnswer.findFirst({ where: { gameId, playerId } });
    expect(stored!.correctness).toBe(0);
    expect(stored!.points).toBe(0);
    expect((await prisma.gamePlayer.findUnique({ where: { id: playerId } }))!.score).toBe(0);
  });

  it('rejects a second answer to the same question', async () => {
    const { gameId, playerId } = await freshGame(['Ada', 'Bob']);
    await engine.start(gameId);
    const question = engine.publicQuestion(await engine.get(gameId));
    await engine.submitAnswer(gameId, playerId, question.id, 0);
    await expect(engine.submitAnswer(gameId, playerId, question.id, 1)).rejects.toThrow(
      /already answered/i,
    );
  });

  it('rejects a late answer', async () => {
    const { gameId, playerId } = await freshGame();
    await engine.start(gameId);
    const game = await engine.get(gameId);
    const question = engine.publicQuestion(game);
    // Pretend the question opened long ago.
    game.openedAt = Date.now() - 10 * 60 * 1000;
    await expect(engine.submitAnswer(gameId, playerId, question.id, 0)).rejects.toThrow(/late/i);
  });

  it('rejects an answer when no question is open', async () => {
    const { gameId, playerId } = await freshGame();
    await expect(engine.submitAnswer(gameId, playerId, 'whatever', 0)).rejects.toThrow(
      /no question/i,
    );
  });

  it('accepts exactly one of several simultaneous answers to the same question', async () => {
    // Test A – a double click, parallel sockets or a retry must not be scored
    // twice. The game is evicted first, so the burst also exercises the cold-load
    // path: several sockets asking for a game the engine does not hold yet must
    // end up on one runtime, and the unique index must surface as a conflict
    // rather than an unexpected error.
    const { gameId, playerId } = await freshGame(['Ada', 'Bob']);
    await engine.start(gameId);
    const question = engine.publicQuestion(await engine.get(gameId));
    engine.evict(gameId);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () => engine.submitAnswer(gameId, playerId, question.id, 0)),
    );
    const accepted = outcomes.filter((entry) => entry.status === 'fulfilled');
    const rejected = outcomes.filter((entry) => entry.status === 'rejected');
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const entry of rejected) {
      expect((entry as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    }

    // Exactly one row, and the running totals advanced exactly once.
    const rows = await prisma.playerAnswer.findMany({ where: { gameId, playerId } });
    expect(rows).toHaveLength(1);
    const stored = rows[0]!;
    const player = await prisma.gamePlayer.findUnique({ where: { id: playerId } });
    expect(player!.score).toBe(stored.points);
    expect(player!.correctCount).toBe(1);
    expect(player!.totalTimeMs).toBe(stored.elapsedMs);

    // The runtime mirrors the database, and the distribution counted one answer.
    const runtime = await engine.get(gameId);
    const runtimePlayer = runtime.players.get(playerId)!;
    expect(runtimePlayer.score).toBe(stored.points);
    expect(runtimePlayer.correctCount).toBe(1);
    expect(runtimePlayer.totalTimeMs).toBe(stored.elapsedMs);
    expect([...runtime.distribution.values()]).toEqual([1]);
  });

  it('accepts only one of two different simultaneous answers from one player', async () => {
    // Test B – two different payloads racing for the same question. Exactly one
    // must win, and the outcome must be consistent with the stored row.
    const { gameId, playerId } = await freshGame(['Ada', 'Bob']);
    await engine.start(gameId);
    const question = engine.publicQuestion(await engine.get(gameId));

    const outcomes = await Promise.allSettled([
      engine.submitAnswer(gameId, playerId, question.id, 0), // correct
      engine.submitAnswer(gameId, playerId, question.id, 1), // wrong
    ]);
    expect(outcomes.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((entry) => entry.status === 'rejected')).toHaveLength(1);

    const rows = await prisma.playerAnswer.findMany({ where: { gameId, playerId } });
    expect(rows).toHaveLength(1);
    const player = await prisma.gamePlayer.findUnique({ where: { id: playerId } });
    // The score and the stored verdict agree, whichever payload won the race.
    expect(player!.score).toBe(rows[0]!.points);
    expect(player!.correctCount).toBe(rows[0]!.correctness === 1 ? 1 : 0);
  });

  it('accepts simultaneous answers from different players', async () => {
    // Test C – the lock is per player and question, so it must not serialise
    // unrelated players into a failure.
    const { gameId, playerIds } = await freshGame(['Ada', 'Bob']);
    await engine.start(gameId);
    const question = engine.publicQuestion(await engine.get(gameId));

    const outcomes = await Promise.allSettled(
      playerIds.map((id) => engine.submitAnswer(gameId, id, question.id, 0)),
    );
    expect(outcomes.every((entry) => entry.status === 'fulfilled')).toBe(true);
    expect(await prisma.playerAnswer.count({ where: { gameId } })).toBe(2);
  });

  it('leaves no trace when the write fails, and a later retry still works', async () => {
    // Test D – a failed persist must not leave points or statistics behind, and
    // the question must still be answerable afterwards.
    const { gameId, playerId } = await freshGame(['Ada', 'Bob']);
    await engine.start(gameId);
    const question = engine.publicQuestion(await engine.get(gameId));

    const originalTransaction = prisma.$transaction;
    const transaction = vi
      .spyOn(prisma, '$transaction')
      .mockRejectedValueOnce(new Error('write failed'));
    try {
      await expect(engine.submitAnswer(gameId, playerId, question.id, 0)).rejects.toThrow(
        /write failed/,
      );
    } finally {
      transaction.mockRestore();
      // The Prisma client is a Proxy: `mockRestore` clears the property instead of
      // restoring the original, so it has to be reassigned explicitly.
      prisma.$transaction = originalTransaction;
    }

    // Nothing was written and the runtime still thinks the player has not answered.
    expect(await prisma.playerAnswer.count({ where: { gameId, playerId } })).toBe(0);
    expect((await prisma.gamePlayer.findUnique({ where: { id: playerId } }))!.score).toBe(0);
    const runtime = await engine.get(gameId);
    expect(runtime.players.get(playerId)!.answeredQuestionId).toBeNull();
    expect(runtime.players.get(playerId)!.score).toBe(0);

    // The retry succeeds, because the phase is still open and no half-state stuck.
    await expect(engine.submitAnswer(gameId, playerId, question.id, 0)).resolves.toEqual({
      accepted: true,
    });
    expect(await prisma.playerAnswer.count({ where: { gameId, playerId } })).toBe(1);
  });

  it('reveals once when the last players answer the final question together', async () => {
    // Test E – the auto-reveal is triggered by the answered count; with the last
    // players arriving simultaneously it must still fire exactly once, and every
    // answer must be stored.
    const { gameId, playerIds } = await freshGame(['Ada', 'Bob', 'Cy']);
    await engine.start(gameId);
    const first = engine.publicQuestion(await engine.get(gameId));
    await engine.submitAnswer(gameId, playerIds[0]!, first.id, 0);

    await engine.reveal(gameId);
    await engine.board(gameId);
    await engine.next(gameId);
    const last = engine.publicQuestion(await engine.get(gameId));
    expect(last.id).toBe(QUIZ.questions[1]!.id);

    let reveals = 0;
    engine.on('reveal', () => {
      reveals += 1;
    });

    // All three players answer the last question at once, so the "everyone
    // answered" branch is reached by concurrent submissions.
    await Promise.allSettled(playerIds.map((id) => engine.submitAnswer(gameId, id, last.id, 1)));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(reveals).toBe(1);
    expect((await engine.get(gameId)).phase).toBe('reveal');
    expect(await prisma.playerAnswer.count({ where: { gameId, questionId: last.id } })).toBe(3);
  });

  it('ranks players by score', async () => {
    const row = await createGame(quizId, ownerId);
    const a = await joinGame(row.pin, 'Ada');
    const b = await joinGame(row.pin, 'Bob');
    for (const player of [a.player, b.player]) {
      await engine.addPlayer(row.id, {
        id: player.id,
        nickname: player.nickname,
        avatar: player.avatar,
        joinedAt: player.joinedAt,
      });
    }
    await engine.start(row.id);
    const question = engine.publicQuestion(await engine.get(row.id));
    await engine.submitAnswer(row.id, a.player.id, question.id, 0); // correct
    await engine.submitAnswer(row.id, b.player.id, question.id, 1); // wrong

    const board = engine.leaderboard(await engine.get(row.id));
    expect(board[0]!.nickname).toBe('Ada');
    expect(board[1]!.nickname).toBe('Bob');
  });

  it('shares one runtime when a cold game is loaded concurrently', async () => {
    // A game that is not in memory yet can be requested by several sockets at
    // once. Before the fix each caller built its own runtime, so an answer written
    // through one copy was invisible to the others and the totals drifted.
    const { gameId, playerId } = await freshGame(['Ada', 'Bob']);
    await engine.start(gameId);
    const question = engine.publicQuestion(await engine.get(gameId));
    engine.evict(gameId);

    const [first, second] = await Promise.all([engine.get(gameId), engine.get(gameId)]);
    expect(first).toBe(second);

    await engine.submitAnswer(gameId, playerId, question.id, 0);
    const runtime = await engine.get(gameId);
    const stored = await prisma.playerAnswer.findFirst({ where: { gameId, playerId } });
    expect(runtime.players.get(playerId)!.answeredQuestionId).toBe(question.id);
    expect(runtime.players.get(playerId)!.score).toBe(stored!.points);
  });

  it('never lets an auto-reveal overwrite a finished game', async () => {
    // With a single player, `submitAnswer` auto-reveals fire-and-forget while the
    // host may `end` the game in the same tick. Before the fix the two ran
    // concurrently and the reveal's `setPhase('reveal')` could land *after*
    // `setPhase('end')`, leaving a finished game persisted as `reveal` with no
    // `endedAt`. This drives that race many times to catch the interleaving.
    let stuck = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const { gameId, playerId } = await freshGame(['Ada']);
      await engine.start(gameId);
      const question = engine.publicQuestion(await engine.get(gameId));
      await engine.submitAnswer(gameId, playerId, question.id, 0);
      await engine.end(gameId);

      const row = await prisma.game.findUnique({ where: { id: gameId } });
      if (row!.phase !== 'end' || row!.endedAt === null) stuck += 1;
      engine.evict(gameId);
    }
    expect(stuck).toBe(0);
  }, 60_000);
});
