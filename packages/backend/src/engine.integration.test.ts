/**
 * Integration tests for the server-authoritative game engine.
 *
 * Skipped automatically when no database is reachable (see testing/db.ts).
 * These tests drive the real engine against a real database: they assert the
 * phase machine, that points are computed and persisted server-side, and that
 * invalid answers (duplicate, late, wrong phase) are rejected.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
});
