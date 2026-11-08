/**
 * Gameplay reliability: duplicate phase transitions and restart recovery.
 *
 * These tests cover the defects found in the "complete gameplay reliability"
 * audit:
 *
 *  - a host command (`next`) that is not validated against the *current* phase
 *    could advance the game from `question`, skipping the open question;
 *  - a **stale auto-advance timer** (armed before a manual transition) could
 *    fire afterwards and skip a whole question;
 *  - recovery after a backend restart only handled the `question` phase, so a
 *    restart during `reveal` or `board` left the game stuck on that screen with
 *    no timer to move it on.
 *
 * Skipped automatically when no database is reachable (see testing/db.ts).
 * "Restart" is simulated with `engine.evict`, which drops the in-memory runtime
 * so the next `get` rebuilds it from the rows exactly as a fresh process would.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Quiz } from '@zeropeek/shared';

import { prisma } from './db.js';
import { engine, BOARD_MS, REVEAL_MS } from './services/engine.js';
import { createUser } from './services/userService.js';
import { createQuiz } from './services/quizService.js';
import { createGame, joinGame } from './services/gameService.js';
import { canConnect, resetDatabase } from './testing/db.js';

const available = await canConnect();

const TWO_QUESTION_QUIZ: Quiz = {
  id: '00000000-0000-4000-8000-0000000000b1',
  title: 'Reliability test',
  description: '',
  theme: 'standard',
  defaultTimeLimit: 20,
  questions: [
    {
      id: '00000000-0000-4000-8000-0000000000b2',
      type: 'single',
      text: 'First question?',
      timeLimit: 20,
      points: 'standard',
      options: ['A', 'B'],
      correctIndex: 0,
    },
    {
      id: '00000000-0000-4000-8000-0000000000b3',
      type: 'single',
      text: 'Second question?',
      timeLimit: 20,
      points: 'standard',
      options: ['C', 'D'],
      correctIndex: 1,
    },
  ],
};

const ONE_QUESTION_QUIZ: Quiz = {
  id: '00000000-0000-4000-8000-0000000000c1',
  title: 'Single question',
  description: '',
  theme: 'standard',
  defaultTimeLimit: 20,
  questions: [
    {
      id: '00000000-0000-4000-8000-0000000000c2',
      type: 'single',
      text: 'Only question?',
      timeLimit: 20,
      points: 'standard',
      options: ['Yes', 'No'],
      correctIndex: 0,
    },
  ],
};

describe.skipIf(!available)('gameplay reliability', () => {
  let ownerId = '';
  let twoQuizId = '';
  let oneQuizId = '';

  beforeAll(async () => {
    await resetDatabase(prisma);
    const owner = await createUser({
      username: 'reliabilityhost',
      password: 'correct-horse-battery',
      role: 'TRAINER',
    });
    ownerId = owner.id;
    twoQuizId = (await createQuiz(ownerId, TWO_QUESTION_QUIZ)).id;
    oneQuizId = (await createQuiz(ownerId, ONE_QUESTION_QUIZ)).id;
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

  // Drop every runtime this suite created, so a timer armed by one test (the
  // reveal/board auto-advance) cannot fire into the next test's cleaned rows.
  const createdGames: string[] = [];
  afterEach(() => {
    for (const gameId of createdGames.splice(0)) engine.evict(gameId);
  });

  /** A started game with the named players. */
  async function startedGame(quizId: string, nicknames: string[] = ['Ada', 'Bob']) {
    const row = await createGame(quizId, ownerId);
    createdGames.push(row.id);
    const ids: string[] = [];
    for (const nickname of nicknames) {
      const { player } = await joinGame(row.pin, nickname);
      await engine.addPlayer(row.id, {
        id: player.id,
        nickname: player.nickname,
        avatar: player.avatar,
        joinedAt: player.joinedAt,
      });
      ids.push(player.id);
    }
    await engine.start(row.id);
    return { gameId: row.id, playerIds: ids };
  }

  describe('A – a transition is validated against the current phase', () => {
    it('refuses `next` while a question is open, so the question is not skipped', async () => {
      const { gameId } = await startedGame(twoQuizId);
      const first = engine.publicQuestion(await engine.get(gameId));

      // A host `next` (e.g. a stale auto-advance timer) while the question is
      // still open must be refused: advancing here would silently skip the
      // question that every player is currently answering.
      await expect(engine.next(gameId)).rejects.toThrow(/reveal|leaderboard|finish/i);

      const game = await engine.get(gameId);
      expect(game.phase).toBe('question');
      expect(engine.publicQuestion(game).id).toBe(first.id);
    });

    it('refuses a second `next` from the board and advances exactly one question', async () => {
      const { gameId } = await startedGame(twoQuizId);
      await engine.reveal(gameId);
      await engine.board(gameId);

      // Two rapid host clicks (or a click plus the board timer) must advance the
      // game by exactly one question, never two.
      await engine.next(gameId);
      await expect(engine.next(gameId)).rejects.toThrow(/reveal|leaderboard|finish/i);

      const game = await engine.get(gameId);
      expect(game.phase).toBe('question');
      expect(engine.publicQuestion(game).id).toBe(TWO_QUESTION_QUIZ.questions[1]!.id);
      expect(game.currentIndex).toBe(1);
    });

    it('a stale board timer does not advance a game that already moved on', async () => {
      const { gameId } = await startedGame(twoQuizId);
      await engine.reveal(gameId);
      // `board` arms the 6s auto-advance timer.
      await engine.board(gameId);
      // The host advances by hand before that timer fires.
      await engine.next(gameId);
      expect((await engine.get(gameId)).currentIndex).toBe(1);

      // Wait past the stale timer's deadline: it fires `next` on a game that is
      // already in `question`, which must be refused — otherwise the last
      // question would be skipped straight to the end.
      await new Promise((resolve) => setTimeout(resolve, BOARD_MS + 300));

      const game = await engine.get(gameId);
      expect(game.phase).toBe('question');
      expect(game.currentIndex).toBe(1);
      expect(engine.publicQuestion(game).id).toBe(TWO_QUESTION_QUIZ.questions[1]!.id);
    }, 20_000);

    it('a manual reveal and a manual board in the same tick produce one reveal and one board', async () => {
      const { gameId } = await startedGame(twoQuizId);
      let reveals = 0;
      let boards = 0;
      engine.on('reveal', () => {
        reveals += 1;
      });
      engine.on('board', () => {
        boards += 1;
      });

      await Promise.allSettled([engine.reveal(gameId), engine.board(gameId)]);

      const game = await engine.get(gameId);
      expect(game.phase).toBe('board');
      expect(reveals).toBe(1);
      expect(boards).toBe(1);
    });
  });

  describe('B – restart recovery for every phase', () => {
    it('re-arms the auto-advance after a restart during reveal', async () => {
      const { gameId } = await startedGame(twoQuizId);
      await engine.reveal(gameId);

      // Simulate a backend restart mid-reveal.
      engine.evict(gameId);
      const reloaded = await engine.get(gameId);
      expect(reloaded.phase).toBe('reveal');

      // The recovery must schedule the board transition, not leave the game
      // frozen on the reveal screen forever.
      await new Promise((resolve) => setTimeout(resolve, REVEAL_MS + 400));
      expect((await engine.get(gameId)).phase).toBe('board');
    }, 20_000);

    it('re-arms the auto-advance after a restart during board', async () => {
      const { gameId } = await startedGame(twoQuizId);
      await engine.reveal(gameId);
      await engine.board(gameId);

      engine.evict(gameId);
      const reloaded = await engine.get(gameId);
      expect(reloaded.phase).toBe('board');

      await new Promise((resolve) => setTimeout(resolve, BOARD_MS + 400));
      const game = await engine.get(gameId);
      expect(game.phase).toBe('question');
      expect(game.currentIndex).toBe(1);
    }, 20_000);

    it('ends the game after a restart on the board of the final question', async () => {
      const { gameId } = await startedGame(oneQuizId);
      await engine.reveal(gameId);
      await engine.board(gameId);

      engine.evict(gameId);
      await engine.get(gameId);

      await new Promise((resolve) => setTimeout(resolve, BOARD_MS + 400));
      const row = await prisma.game.findUnique({ where: { id: gameId } });
      expect(row!.phase).toBe('end');
      expect(row!.endedAt).not.toBeNull();
    }, 20_000);

    it('never advances past the phase it recovered to, even if a stale timer fires', async () => {
      const { gameId } = await startedGame(twoQuizId);
      // Arm the board timer, then restart while still in `reveal`.
      await engine.reveal(gameId);
      engine.evict(gameId);
      await engine.get(gameId);

      // Wait long enough for both the recovered reveal timer and any stale timer
      // to fire. The game must move reveal → board and stop there.
      await new Promise((resolve) => setTimeout(resolve, REVEAL_MS + 400));
      const game = await engine.get(gameId);
      expect(game.phase).toBe('board');
      expect(game.currentIndex).toBe(0);
    }, 20_000);
  });
});
