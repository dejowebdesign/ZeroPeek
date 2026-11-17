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
    await engine.skipLead(row.id);
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
      // AUTO on: `board` arms the board auto-advance timer this test is about.
      await engine.setAuto(gameId, true);
      await engine.reveal(gameId);
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

    it('a duplicate `board` does not clear the auto-advance and strand the game', async () => {
      // The host double-clicks "Leaderboard" (or the reveal's auto-timer races a
      // manual click). The second `board` is a no-op, but it must not clear the
      // leaderboard's own auto-advance timer — otherwise the game sits on the
      // board forever with nothing left to move it on.
      const { gameId } = await startedGame(twoQuizId);
      await engine.setAuto(gameId, true);
      await engine.reveal(gameId);
      await engine.board(gameId);
      expect(await engine.board(gameId)).toBe('board');

      // The board timer must still fire and open the next question.
      await new Promise((resolve) => setTimeout(resolve, BOARD_MS + 400));

      const game = await engine.get(gameId);
      expect(game.phase).toBe('question');
      expect(game.currentIndex).toBe(1);
      expect(engine.publicQuestion(game).id).toBe(TWO_QUESTION_QUIZ.questions[1]!.id);
    }, 20_000);

    it('a duplicate `reveal` does not clear the auto-advance and strand the game', async () => {
      // The auto-reveal (everyone answered) races a manual host reveal, or the
      // host double-clicks "Reveal". The second `reveal` is a no-op, but it must
      // not clear the reveal's auto-advance timer, or the game is stuck on the
      // reveal screen forever.
      const { gameId } = await startedGame(twoQuizId);
      await engine.setAuto(gameId, true);
      await engine.reveal(gameId);
      expect(await engine.reveal(gameId)).toBe('reveal');

      await new Promise((resolve) => setTimeout(resolve, REVEAL_MS + 400));
      expect((await engine.get(gameId)).phase).toBe('board');
    }, 20_000);

    it('a duplicate `board` racing the reveal timer still reaches the next question', async () => {
      // Realistic stall trigger: the host clicks "Leaderboard" right as the
      // reveal's 6 s auto-timer fires. The reveal timer calls `board` on a game
      // already in `board`; that no-op must not cancel the board's timer.
      const { gameId } = await startedGame(twoQuizId);
      await engine.setAuto(gameId, true);
      await engine.reveal(gameId);
      // Wait for the reveal auto-timer to fire `board`.
      await new Promise((resolve) => setTimeout(resolve, REVEAL_MS + 400));
      expect((await engine.get(gameId)).phase).toBe('board');
      // The stale reveal callback's duplicate `board` — reproduced by a manual
      // duplicate click at the same moment.
      expect(await engine.board(gameId)).toBe('board');

      await new Promise((resolve) => setTimeout(resolve, BOARD_MS + 400));
      const game = await engine.get(gameId);
      expect(game.phase).toBe('question');
      expect(game.currentIndex).toBe(1);
    }, 30_000);
  });

  describe('B – restart recovery for every phase', () => {
    it('re-arms the auto-advance after a restart during reveal', async () => {
      const { gameId } = await startedGame(twoQuizId);
      await engine.setAuto(gameId, true);
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
      await engine.setAuto(gameId, true);
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
      await engine.setAuto(gameId, true);
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
      await engine.setAuto(gameId, true);
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

  describe('C – the AUTO mode (Phase 6.9.3)', () => {
    it('defaults to off and reports the value it set', async () => {
      const { gameId } = await startedGame(twoQuizId);
      expect((await engine.get(gameId)).auto).toBe(false);
      expect(await engine.setAuto(gameId, true)).toBe(true);
      expect((await engine.get(gameId)).auto).toBe(true);
      expect(await engine.setAuto(gameId, false)).toBe(false);
    });

    it('with AUTO off, a reveal still advances to the board after the fixed window', async () => {
      const { gameId } = await startedGame(twoQuizId);
      // The reveal window is NOT AUTO-controlled: it always runs.
      await engine.reveal(gameId);
      await new Promise((resolve) => setTimeout(resolve, REVEAL_MS + 400));
      expect((await engine.get(gameId)).phase).toBe('board');
    }, 20_000);

    it('with AUTO off, a board does not open the next question on its own', async () => {
      const { gameId } = await startedGame(twoQuizId);
      await engine.reveal(gameId);
      await engine.board(gameId);

      await new Promise((resolve) => setTimeout(resolve, BOARD_MS + 400));
      const game = await engine.get(gameId);
      expect(game.phase).toBe('board');
      expect(game.currentIndex).toBe(0);
    }, 20_000);

    it('with AUTO off, a full roster answering does not resolve the question', async () => {
      const { gameId, playerIds } = await startedGame(twoQuizId);
      const question = engine.publicQuestion(await engine.get(gameId));
      // Both players answer; AUTO is off, so the host resolves by hand.
      await engine.submitAnswer(gameId, playerIds[0]!, question.id, 0);
      await engine.submitAnswer(gameId, playerIds[1]!, question.id, 1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await engine.get(gameId)).phase).toBe('question');

      // The host resolves when ready.
      expect(await engine.reveal(gameId)).toBe('reveal');
    });

    it('with AUTO off, an expired question clock does not resolve the question', async () => {
      const { gameId } = await startedGame(twoQuizId);
      // Backdate the open question far past its limit; nothing is armed with AUTO
      // off, so the question must wait for the host, not reveal itself.
      (await engine.get(gameId)).openedAt = Date.now() - 60_000;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect((await engine.get(gameId)).phase).toBe('question');

      expect(await engine.reveal(gameId)).toBe('reveal');
    });

    it('with AUTO on, a full roster answering resolves the question', async () => {
      const { gameId, playerIds } = await startedGame(twoQuizId);
      await engine.setAuto(gameId, true);
      const question = engine.publicQuestion(await engine.get(gameId));
      await engine.submitAnswer(gameId, playerIds[0]!, question.id, 0);
      await engine.submitAnswer(gameId, playerIds[1]!, question.id, 1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await engine.get(gameId)).phase).toBe('reveal');
    });

    it('with AUTO on, the board opens the next question on its own', async () => {
      const { gameId } = await startedGame(twoQuizId);
      await engine.setAuto(gameId, true);
      await engine.reveal(gameId);
      await engine.board(gameId);

      await new Promise((resolve) => setTimeout(resolve, BOARD_MS + 400));
      const game = await engine.get(gameId);
      expect(game.phase).toBe('question');
      expect(game.currentIndex).toBe(1);
    }, 20_000);

    it('turning AUTO on after everyone answered resolves the question at once', async () => {
      const { gameId, playerIds } = await startedGame(twoQuizId);
      const question = engine.publicQuestion(await engine.get(gameId));
      // AUTO off: a full roster waits (see the test above). Turning it on must
      // pick up the state the host handed over and resolve immediately.
      await engine.submitAnswer(gameId, playerIds[0]!, question.id, 0);
      await engine.submitAnswer(gameId, playerIds[1]!, question.id, 1);
      await engine.setAuto(gameId, true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await engine.get(gameId)).phase).toBe('reveal');
    });

    it('turning AUTO on after the clock expired resolves the question at once', async () => {
      const { gameId } = await startedGame(twoQuizId);
      (await engine.get(gameId)).openedAt = Date.now() - 60_000;
      await engine.setAuto(gameId, true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await engine.get(gameId)).phase).toBe('reveal');
    });

    it('turning AUTO on during a running clock resolves when it expires', async () => {
      const { gameId } = await startedGame(twoQuizId);
      // 20 s limit + 1.5 s grace; leave ~200 ms on the clock.
      (await engine.get(gameId)).openedAt = Date.now() - 21_300;
      await engine.setAuto(gameId, true);
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect((await engine.get(gameId)).phase).toBe('reveal');
    }, 20_000);

    it('turning AUTO off during a question cancels the answer clock', async () => {
      const { gameId } = await startedGame(twoQuizId);
      await engine.setAuto(gameId, true);
      // Cancel well before the limit; the question must then wait for the host.
      await engine.setAuto(gameId, false);
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect((await engine.get(gameId)).phase).toBe('question');
    }, 20_000);

    it('turning AUTO off during a board cancels the pending advance', async () => {
      const { gameId } = await startedGame(twoQuizId);
      await engine.setAuto(gameId, true);
      await engine.reveal(gameId);
      await engine.board(gameId);
      // Cancel before the board timer fires; the host takes over.
      await engine.setAuto(gameId, false);

      await new Promise((resolve) => setTimeout(resolve, BOARD_MS + 400));
      const game = await engine.get(gameId);
      expect(game.phase).toBe('board');
      expect(game.currentIndex).toBe(0);
    }, 20_000);

    it('turning AUTO off during a reveal does not stop the fixed reveal window', async () => {
      const { gameId } = await startedGame(twoQuizId);
      await engine.setAuto(gameId, true);
      await engine.reveal(gameId);
      // The reveal window is not AUTO-controlled: turning AUTO off must not stop
      // the pending advance to the board.
      await engine.setAuto(gameId, false);

      await new Promise((resolve) => setTimeout(resolve, REVEAL_MS + 400));
      expect((await engine.get(gameId)).phase).toBe('board');
    }, 20_000);

    it('setting the value it already has is a no-op and arms nothing extra', async () => {
      const { gameId } = await startedGame(twoQuizId);
      // AUTO is already off; a second "off" must not throw and must not arm a
      // transition, so the open question stays put.
      expect(await engine.setAuto(gameId, false)).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect((await engine.get(gameId)).phase).toBe('question');
    }, 20_000);

    it('restores the mode from the event log across a restart', async () => {
      const { gameId } = await startedGame(twoQuizId);
      await engine.setAuto(gameId, true);
      await engine.reveal(gameId);

      engine.evict(gameId);
      const reloaded = await engine.get(gameId);
      // The mode is persisted as an `auto` event, so a fresh process resumes it.
      expect(reloaded.auto).toBe(true);
    });
  });
});
