/**
 * Integration tests for the server-authoritative game engine.
 *
 * Skipped automatically when no database is reachable (see testing/db.ts).
 * These tests drive the real engine against a real database: they assert the
 * phase machine, that points are computed and persisted server-side, and that
 * invalid answers (duplicate, late, wrong phase) are rejected.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HostReveal, Quiz } from '@zeropeek/shared';

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

  describe('pause / resume / skip (Phase 6.5.3)', () => {
    it('freezes the clock on pause and rejects answers while paused', async () => {
      const { gameId, playerId } = await freshGame(['Ada', 'Bob']);
      await engine.start(gameId);
      const question = engine.publicQuestion(await engine.get(gameId));

      await engine.pause(gameId);
      const paused = engine.publicQuestion(await engine.get(gameId));
      expect(paused.paused).toBe(true);
      expect(paused.remainingMs).toBeGreaterThan(0);
      // The frozen clock is persisted, so a restart can restore it.
      const event = await prisma.gameEvent.findFirst({
        where: { gameId, type: 'paused' },
        orderBy: { createdAt: 'desc' },
      });
      expect(event).not.toBeNull();

      await expect(engine.submitAnswer(gameId, playerId, question.id, 0)).rejects.toThrow(
        /paused/i,
      );
      // Pausing twice is a no-op error, not a second pause.
      await expect(engine.pause(gameId)).rejects.toThrow(/already paused/i);
    });

    it('resumes with the remaining time and keeps the question open', async () => {
      const { gameId } = await freshGame(['Ada', 'Bob']);
      await engine.start(gameId);
      await engine.pause(gameId);
      const before = engine.publicQuestion(await engine.get(gameId));

      await engine.resume(gameId);
      const after = engine.publicQuestion(await engine.get(gameId));
      expect(after.paused).toBe(false);
      expect(after.remainingMs).toBeNull();
      // The clock was shifted forward by the pause, so it did not run on.
      expect(after.openedAt).toBeGreaterThanOrEqual(before.openedAt);
      await expect(engine.resume(gameId)).rejects.toThrow(/not paused/i);
    });

    it('a paused question never auto-reveals on its own', async () => {
      // A one-player game would normally auto-reveal once the lone player answers,
      // and the timer would reveal on expiry. Pausing must disable both paths.
      const { gameId } = await freshGame(['Ada']);
      await engine.start(gameId);
      await engine.pause(gameId);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const game = await engine.get(gameId);
      expect(game.phase).toBe('question');
      expect(game.paused).toBe(true);
    });

    it('skip neutralises the question: points already awarded are refunded', async () => {
      const { gameId, playerIds } = await freshGame(['Ada', 'Bob']);
      const [ada, bob] = playerIds;
      await engine.start(gameId);
      const question = engine.publicQuestion(await engine.get(gameId));
      // Ada answers before the skip; Bob never gets the chance.
      const before = await engine.submitAnswer(gameId, ada!, question.id, 0);
      expect(before.accepted).toBe(true);
      const adaAwarded = (await prisma.gamePlayer.findUnique({ where: { id: ada! } }))!.score;
      expect(adaAwarded).toBeGreaterThan(0);

      const events: Array<{ reveal: HostReveal }> = [];
      engine.on('reveal', (payload) => events.push(payload));

      await engine.skip(gameId);
      const game = await engine.get(gameId);
      expect(game.phase).toBe('reveal');
      expect(events.at(-1)?.reveal.skipped).toBe(true);
      // The skipped reveal carries no solution and no distribution.
      expect(events.at(-1)?.reveal).not.toHaveProperty('distribution');

      // The skipped question is persisted as such.
      const skippedEvent = await prisma.gameEvent.findFirst({
        where: { gameId, type: 'skipped' },
      });
      expect(skippedEvent).not.toBeNull();

      // The question is neutralised: the points Ada had earned are refunded, so
      // the question contributes nothing to anyone's total.
      const adaAfter = (await prisma.gamePlayer.findUnique({ where: { id: ada! } }))!.score;
      const bobAfter = (await prisma.gamePlayer.findUnique({ where: { id: bob! } }))!.score;
      expect(adaAfter).toBe(0);
      expect(bobAfter).toBe(0);

      // A late answer after the skip is refused.
      await expect(engine.submitAnswer(gameId, bob!, question.id, 0)).rejects.toThrow();

      // The answer row is kept (for the report) but zeroed, so it is not shown
      // as a regularly scored answer.
      const kept = await prisma.playerAnswer.findFirst({
        where: { gameId, playerId: ada!, questionId: question.id },
      });
      expect(kept).not.toBeNull();
      expect(kept!.points).toBe(0);
      expect(kept!.correctness).toBe(0);

      // The next question is fresh again: not paused, not skipped.
      await engine.board(gameId);
      await engine.next(gameId);
      const next = engine.publicQuestion(await engine.get(gameId));
      expect(next.id).toBe(QUIZ.questions[1]!.id);
      expect(next.paused).toBe(false);
    });

    it('skip also works from a paused question', async () => {
      const { gameId } = await freshGame(['Ada', 'Bob']);
      await engine.start(gameId);
      await engine.pause(gameId);
      await engine.skip(gameId);
      expect((await engine.get(gameId)).phase).toBe('reveal');
    });

    it('reports a skipped question to a reconnecting player, not a verdict', async () => {
      const { gameId, playerIds } = await freshGame(['Ada', 'Bob']);
      const [ada] = playerIds;
      await engine.start(gameId);
      await engine.skip(gameId);

      // A reconnect during the skipped reveal must render the same screen the
      // live event did, so the sync carries `skipped` and a `skipped` result.
      const sync = await engine.playerSync(await engine.get(gameId), ada!);
      expect(sync.skipped).toBe(true);
      expect(sync.answer?.result?.outcome).toBe('skipped');
    });

    it('refuses pause, resume and skip outside a running question', async () => {
      const { gameId } = await freshGame(['Ada']);
      await expect(engine.pause(gameId)).rejects.toThrow(/running question/i);
      await expect(engine.resume(gameId)).rejects.toThrow(/running question/i);
      await expect(engine.skip(gameId)).rejects.toThrow(/running question/i);
    });

    it('restores a paused clock and a skipped flag after a cold reload', async () => {
      // Simulate a process restart: evict the runtime, then re-load from the rows.
      const { gameId } = await freshGame(['Ada', 'Bob']);
      await engine.start(gameId);
      await engine.pause(gameId);
      const before = engine.publicQuestion(await engine.get(gameId));
      engine.evict(gameId);

      const reloaded = await engine.get(gameId);
      expect(reloaded.paused).toBe(true);
      expect(reloaded.phase).toBe('question');
      expect(engine.publicQuestion(reloaded).paused).toBe(true);
      expect(engine.publicQuestion(reloaded).remainingMs).toBe(before.remainingMs);

      // A skipped question is remembered as skipped across the same restart.
      await engine.resume(gameId);
      await engine.skip(gameId);
      engine.evict(gameId);
      const afterSkip = await engine.get(gameId);
      const question = engine.currentQuestion(afterSkip);
      expect(question).not.toBeNull();
      expect(afterSkip.skippedQuestionId).toBe(question!.id);
    });

    // --- Decision A: a skip neutralises the question -------------------------

    it('skips a question with no answers and refunds nothing', async () => {
      const { gameId, playerIds } = await freshGame(['Ada', 'Bob']);
      await engine.start(gameId);
      await engine.skip(gameId);

      expect((await engine.get(gameId)).phase).toBe('reveal');
      for (const id of playerIds) {
        expect((await prisma.gamePlayer.findUnique({ where: { id } }))!.score).toBe(0);
      }
      expect(await prisma.playerAnswer.count({ where: { gameId } })).toBe(0);
    });

    it('neutralises a question answered correctly: no points survive', async () => {
      const { gameId, playerIds } = await freshGame(['Ada', 'Bob']);
      const [ada] = playerIds;
      await engine.start(gameId);
      const question = engine.publicQuestion(await engine.get(gameId));
      await engine.submitAnswer(gameId, ada!, question.id, 0); // correct
      expect((await prisma.gamePlayer.findUnique({ where: { id: ada! } }))!.score).toBeGreaterThan(
        0,
      );

      await engine.skip(gameId);
      const row = await prisma.gamePlayer.findUnique({ where: { id: ada! } });
      expect(row!.score).toBe(0);
      expect(row!.correctCount).toBe(0);
      // The answer is kept for the report, but zeroed so it is not a scored answer.
      const answer = await prisma.playerAnswer.findFirst({
        where: { gameId, playerId: ada!, questionId: question.id },
      });
      expect(answer).not.toBeNull();
      expect(answer!.points).toBe(0);
      expect(answer!.correctness).toBe(0);
    });

    it('never subtracts points for a wrong answer on a skipped question', async () => {
      const { gameId, playerIds } = await freshGame(['Ada', 'Bob']);
      const [ada] = playerIds;
      await engine.start(gameId);
      const question = engine.publicQuestion(await engine.get(gameId));
      await engine.submitAnswer(gameId, ada!, question.id, 1); // wrong option

      await engine.skip(gameId);
      expect((await prisma.gamePlayer.findUnique({ where: { id: ada! } }))!.score).toBe(0);
    });

    it('keeps points earned on earlier questions when a later one is skipped', async () => {
      const { gameId, playerIds } = await freshGame(['Ada', 'Bob']);
      const [ada, bob] = playerIds;
      await engine.start(gameId);
      // Q1: Ada answers correctly and is revealed normally — these points stand.
      const first = engine.publicQuestion(await engine.get(gameId));
      await engine.submitAnswer(gameId, ada!, first.id, 0);
      await engine.reveal(gameId);
      await engine.board(gameId);
      const earned = (await prisma.gamePlayer.findUnique({ where: { id: ada! } }))!.score;
      expect(earned).toBeGreaterThan(0);

      // Q2: Bob answers, then the host skips — only Q2 is neutralised.
      await engine.next(gameId);
      const second = engine.publicQuestion(await engine.get(gameId));
      await engine.submitAnswer(gameId, bob!, second.id, 1);
      await engine.skip(gameId);

      expect((await prisma.gamePlayer.findUnique({ where: { id: ada! } }))!.score).toBe(earned);
      expect((await prisma.gamePlayer.findUnique({ where: { id: bob! } }))!.score).toBe(0);
    });

    it('does not refund twice when a skip is triggered repeatedly', async () => {
      const { gameId, playerIds } = await freshGame(['Ada', 'Bob']);
      const [ada] = playerIds;
      await engine.start(gameId);
      const question = engine.publicQuestion(await engine.get(gameId));
      await engine.submitAnswer(gameId, ada!, question.id, 0);
      const earned = (await prisma.gamePlayer.findUnique({ where: { id: ada! } }))!.score;

      await engine.skip(gameId);
      // A second skip is refused (the phase already moved on); a concurrent one
      // is serialised by the phase lock. Either way, no second refund.
      await expect(engine.skip(gameId)).rejects.toThrow();
      const row = await prisma.gamePlayer.findUnique({ where: { id: ada! } });
      expect(row!.score).toBe(0);
      expect(row!.score).toBe(earned - earned);
    });

    it('leaves historical answer rows intact apart from the zeroed score', async () => {
      const { gameId, playerIds } = await freshGame(['Ada', 'Bob']);
      const [ada] = playerIds;
      await engine.start(gameId);
      const question = engine.publicQuestion(await engine.get(gameId));
      await engine.submitAnswer(gameId, ada!, question.id, 0);
      const before = await prisma.playerAnswer.findFirst({
        where: { gameId, playerId: ada!, questionId: question.id },
      });

      await engine.skip(gameId);
      const after = await prisma.playerAnswer.findFirst({
        where: { gameId, playerId: ada!, questionId: question.id },
      });
      // The row itself survives — the raw answer and its timing are untouched,
      // so the report can still show what was answered.
      expect(after).not.toBeNull();
      expect(after!.id).toBe(before!.id);
      expect(after!.answer).toEqual(before!.answer);
      expect(after!.elapsedMs).toBe(before!.elapsedMs);
    });

    it('continues normally into the next question after a skip', async () => {
      const { gameId, playerIds } = await freshGame(['Ada', 'Bob']);
      const [ada] = playerIds;
      await engine.start(gameId);
      await engine.skip(gameId);
      await engine.board(gameId);
      await engine.next(gameId);

      const second = engine.publicQuestion(await engine.get(gameId));
      expect(second.id).toBe(QUIZ.questions[1]!.id);
      expect(second.paused).toBe(false);
      // The new question is scored as usual: a correct answer earns points.
      await engine.submitAnswer(gameId, ada!, second.id, 1);
      expect((await prisma.gamePlayer.findUnique({ where: { id: ada! } }))!.score).toBeGreaterThan(
        0,
      );
    });

    it('ends correctly when the last question is skipped', async () => {
      const { gameId } = await freshGame(['Ada', 'Bob']);
      await engine.start(gameId);
      // Walk to the final question, skipping each one.
      for (let i = 0; i < QUIZ.questions.length; i += 1) {
        await engine.skip(gameId);
        if (i < QUIZ.questions.length - 1) {
          await engine.board(gameId);
          await engine.next(gameId);
        }
      }
      await engine.board(gameId);
      await engine.end(gameId);

      const row = await prisma.game.findUnique({ where: { id: gameId } });
      expect(row!.phase).toBe('end');
      expect(row!.endedAt).not.toBeNull();
    });

    it('stays race-safe when a skip and an end run in the same tick', async () => {
      let stuck = 0;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const { gameId, playerIds } = await freshGame(['Ada', 'Bob']);
        const [ada] = playerIds;
        await engine.start(gameId);
        const question = engine.publicQuestion(await engine.get(gameId));
        await engine.submitAnswer(gameId, ada!, question.id, 0);
        const earned = (await prisma.gamePlayer.findUnique({ where: { id: ada! } }))!.score;

        // Fire a skip and an end together: the phase lock must serialise them so
        // the game is never left mid-transition with a half-applied refund.
        await Promise.allSettled([engine.skip(gameId), engine.end(gameId)]);

        const row = await prisma.game.findUnique({ where: { id: gameId } });
        const player = await prisma.gamePlayer.findUnique({ where: { id: ada! } });
        if (row!.phase !== 'end' || row!.endedAt === null) stuck += 1;
        // The refund is all-or-nothing: either the skip won (score 0) or the end
        // won and the skip was refused (the earned points stand). Never a partial
        // refund, and never a score the question did not award.
        if (player!.score !== 0 && player!.score !== earned) stuck += 1;
        engine.evict(gameId);
      }
      expect(stuck).toBe(0);
    }, 60_000);
  });

  describe('slides cannot be paused (Phase 6.5.3, decision C)', () => {
    /** A game whose single question is a text slide (no clock, no answers). */
    async function slideGame(): Promise<{ gameId: string; playerId: string }> {
      const quiz = await createQuiz(ownerId, {
        title: 'Slide deck',
        questions: [
          {
            id: `slide-${Math.random().toString(36).slice(2, 10)}`,
            type: 'slide',
            text: 'Welcome',
            timeLimit: 0,
            points: 'none',
            body: 'Welcome to the show',
          },
        ],
      });
      const row = await createGame(quiz.id, ownerId);
      const { player } = await joinGame(row.pin, `Slide-${Math.random().toString(36).slice(2, 8)}`);
      await engine.addPlayer(row.id, {
        id: player.id,
        nickname: player.nickname,
        avatar: player.avatar,
        joinedAt: player.joinedAt,
      });
      await engine.start(row.id);
      return { gameId: row.id, playerId: player.id };
    }

    it('refuses to pause and resume a slide', async () => {
      const { gameId } = await slideGame();
      const question = engine.publicQuestion(await engine.get(gameId));
      expect(question.type).toBe('slide');

      // A slide has no clock to freeze, so both are refused by the engine — the
      // frontend omits the button, but the server is the authority.
      await expect(engine.pause(gameId)).rejects.toThrow(/slide/i);
      await expect(engine.resume(gameId)).rejects.toThrow(/running question|not paused/i);
      // The game is untouched: still on the slide, never paused.
      const game = await engine.get(gameId);
      expect(game.phase).toBe('question');
      expect(game.paused).toBe(false);
    });

    it('still allows a slide to be skipped, revealing no solution', async () => {
      const { gameId } = await slideGame();
      const reveal = new Promise<{ reveal: HostReveal }>((resolve) =>
        engine.once('reveal', resolve),
      );
      await engine.skip(gameId);
      const { reveal: payload } = await reveal;
      expect(payload.skipped).toBe(true);
      expect(payload).not.toHaveProperty('distribution');
    });
  });
});
