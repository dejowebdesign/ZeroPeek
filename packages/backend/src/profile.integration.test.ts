/**
 * Integration tests for player profiles (Phase 6.6) against a real PostgreSQL.
 *
 * Skipped automatically when no database is reachable (see `testing/db.ts`).
 * Two concerns are covered:
 *
 *   1. The API and its authorisation: a signed-in account can only ever read and
 *      change its **own** profile; a client cannot smuggle a statistic, an XP
 *      value or a `userId`; there is no history endpoint.
 *   2. The statistics: won games, podiums and accuracy are computed from the
 *      persisted finished games, ties are counted, skipped questions excluded,
 *      and a guest seat (no `userId`) is never attributed to an account.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './db.js';
import { createUser } from './services/userService.js';
import { canConnect, resetDatabase } from './testing/db.js';

const available = await canConnect();

describe.skipIf(!available)('player profile integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: loadConfig({ NODE_ENV: 'test', COOKIE_SECURE: 'false' }) });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  /** Create an account and sign it in; returns its cookie and CSRF token. */
  async function signIn(username: string): Promise<{ cookie: string; csrf: string; id: string }> {
    const user = await createUser({ username, password: 'correct-horse-battery', role: 'PLAYER' });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: 'correct-horse-battery' },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers['set-cookie'];
    return {
      cookie: (Array.isArray(setCookie) ? setCookie[0] : String(setCookie)).split(';')[0]!,
      csrf: login.json().csrfToken,
      id: user.id,
    };
  }

  const as = (
    session: { cookie: string; csrf: string },
    method: 'GET' | 'PUT' | 'POST',
    url: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url,
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
      ...(payload === undefined ? {} : { payload }),
    });

  /**
   * Seed a finished game whose players are given explicitly. `roster` maps a
   * seat to a `userId` (or `null` for a guest). Returns the game id.
   */
  async function finishedGame(
    roster: Array<{ userId: string | null; score: number; correctCount?: number }>,
    options: { skippedQuestionId?: string } = {},
  ): Promise<string> {
    const game = await prisma.game.create({
      data: {
        pin: String(Math.floor(100000 + Math.random() * 900000)),
        phase: 'end',
        currentIndex: 0,
        endedAt: new Date(),
        settings: { tieBreak: ['correctCount', 'totalTime', 'joinedAt'] },
      },
    });
    for (const [index, seat] of roster.entries()) {
      const player = await prisma.gamePlayer.create({
        data: {
          gameId: game.id,
          userId: seat.userId,
          nickname: `p${index}`,
          token: `token-${game.id}-${index}`,
          score: seat.score,
          correctCount: seat.correctCount ?? 0,
          joinedAt: new Date(index * 1000),
        },
      });
      // One answer row per seat so the accuracy has real data behind it. A
      // skipped question is recorded in the event log and must be excluded.
      await prisma.playerAnswer.create({
        data: {
          gameId: game.id,
          playerId: player.id,
          questionId: options.skippedQuestionId ?? 'q-answered',
          correctness: seat.correctCount && seat.correctCount > 0 ? 1 : 0,
          points: 0,
          answeredAt: new Date(),
        },
      });
    }
    if (options.skippedQuestionId) {
      await prisma.gameEvent.create({
        data: { gameId: game.id, type: 'skipped', data: { questionId: options.skippedQuestionId } },
      });
    }
    return game.id;
  }

  describe('authorisation', () => {
    it('refuses an unauthenticated profile read', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/profile' });
      expect(response.statusCode).toBe(401);
    });

    it('refuses an unauthenticated profile write', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/profile',
        payload: { selectedCharacterId: 'ethan' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('refuses a write without the CSRF token', async () => {
      const me = await signIn('alice');
      const response = await app.inject({
        method: 'PUT',
        url: '/api/profile',
        headers: { cookie: me.cookie },
        payload: { selectedCharacterId: 'ethan' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns only the authenticated account’s own profile', async () => {
      const alice = await signIn('alice');
      const bob = await signIn('bob');

      const response = await as(alice, 'GET', '/api/profile');
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.user.id).toBe(alice.id);
      expect(body.user.username).toBe('alice');
      expect(body.user.id).not.toBe(bob.id);
    });

    it('ignores a client-supplied user id and never leaks another profile', async () => {
      const alice = await signIn('alice');
      await signIn('bob');

      // There is no `userId` parameter; a query/body id must change nothing.
      const response = await app.inject({
        method: 'GET',
        url: '/api/profile?userId=bob',
        headers: { cookie: alice.cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().user.username).toBe('alice');
    });

    it('has no player-visible history endpoint', async () => {
      const alice = await signIn('alice');
      for (const url of ['/api/profile/history', '/api/profile/games', '/api/profile/results']) {
        const response = await app.inject({
          method: 'GET',
          url,
          headers: { cookie: alice.cookie },
        });
        expect(response.statusCode).toBe(404);
      }
    });
  });

  describe('profile write', () => {
    it('stores a chosen character and reads it back', async () => {
      const alice = await signIn('alice');
      const write = await as(alice, 'PUT', '/api/profile', { selectedCharacterId: 'ethan' });
      expect(write.statusCode).toBe(200);
      expect(write.json().selectedCharacterId).toBe('ethan');

      const read = await as(alice, 'GET', '/api/profile');
      expect(read.json().profile.selectedCharacterId).toBe('ethan');
    });

    it('clears the chosen character with null', async () => {
      const alice = await signIn('alice');
      await as(alice, 'PUT', '/api/profile', { selectedCharacterId: 'ethan' });
      const cleared = await as(alice, 'PUT', '/api/profile', { selectedCharacterId: null });
      expect(cleared.json().selectedCharacterId).toBeNull();
    });

    it('rejects a body that tries to set a statistic, XP or a userId', async () => {
      const alice = await signIn('alice');
      for (const payload of [
        { wins: 99 },
        { xp: 5000 },
        { level: 9 },
        { userId: 'someone-else' },
        { gamesPlayed: 100 },
      ]) {
        const response = await as(alice, 'PUT', '/api/profile', payload);
        expect(response.statusCode).toBe(422);
      }
      // Nothing was written by the rejected requests.
      const read = await as(alice, 'GET', '/api/profile');
      expect(read.json().profile.selectedCharacterId).toBeNull();
    });
  });

  describe('statistics', () => {
    it('is all zeros with a null accuracy for a fresh account', async () => {
      const alice = await signIn('alice');
      const body = (await as(alice, 'GET', '/api/profile')).json();
      expect(body.stats).toEqual({
        gamesPlayed: 0,
        wins: 0,
        podiums: 0,
        correctAnswers: 0,
        answeredCount: 0,
        accuracy: null,
      });
    });

    it('counts a win when the account’s seat ranked first', async () => {
      const alice = await signIn('alice');
      const bob = await signIn('bob');
      await finishedGame([
        { userId: alice.id, score: 1000, correctCount: 1 },
        { userId: bob.id, score: 200, correctCount: 0 },
      ]);

      const body = (await as(alice, 'GET', '/api/profile')).json();
      expect(body.stats.gamesPlayed).toBe(1);
      expect(body.stats.wins).toBe(1);
      expect(body.stats.podiums).toBe(1);
    });

    it('counts a shared first place as a win for both tied leaders', async () => {
      const alice = await signIn('alice');
      const bob = await signIn('bob');
      await finishedGame([
        { userId: alice.id, score: 1000, correctCount: 2 },
        { userId: bob.id, score: 1000, correctCount: 2 },
      ]);

      const a = (await as(alice, 'GET', '/api/profile')).json();
      const b = (await as(bob, 'GET', '/api/profile')).json();
      expect(a.stats.wins).toBe(1);
      expect(b.stats.wins).toBe(1);
    });

    it('counts a podium for third place but not a win', async () => {
      const alice = await signIn('alice');
      const others = await Promise.all(['bea', 'cam', 'dan'].map((name) => signIn(name)));
      await finishedGame([
        { userId: others[0]!.id, score: 3000 },
        { userId: others[1]!.id, score: 2000 },
        { userId: alice.id, score: 1000 },
        { userId: others[2]!.id, score: 500 },
      ]);

      const body = (await as(alice, 'GET', '/api/profile')).json();
      expect(body.stats.wins).toBe(0);
      expect(body.stats.podiums).toBe(1);
    });

    it('does not count an unfinished game', async () => {
      const alice = await signIn('alice');
      const game = await prisma.game.create({
        data: { pin: '111111', phase: 'question', currentIndex: 0 },
      });
      await prisma.gamePlayer.create({
        data: {
          gameId: game.id,
          userId: alice.id,
          nickname: 'a',
          token: 't-unfinished',
          score: 900,
        },
      });

      const body = (await as(alice, 'GET', '/api/profile')).json();
      expect(body.stats.gamesPlayed).toBe(0);
    });

    it('never attributes a guest seat (no userId) to an account', async () => {
      const alice = await signIn('alice');
      await finishedGame([
        { userId: null, score: 5000, correctCount: 5 },
        { userId: alice.id, score: 100, correctCount: 1 },
      ]);

      const body = (await as(alice, 'GET', '/api/profile')).json();
      // The guest won the game; the account still only sees its own seat.
      expect(body.stats.gamesPlayed).toBe(1);
      expect(body.stats.wins).toBe(0);
      expect(body.stats.podiums).toBe(1);
    });

    it('excludes a skipped (neutralised) question from the accuracy', async () => {
      const alice = await signIn('alice');
      const game = await prisma.game.create({
        data: { pin: '222222', phase: 'end', currentIndex: 0, endedAt: new Date() },
      });
      const seat = await prisma.gamePlayer.create({
        data: { gameId: game.id, userId: alice.id, nickname: 'a', token: 't-skip', score: 1000 },
      });
      // Two answers: one normal and correct, one on a question the host skipped.
      await prisma.playerAnswer.create({
        data: {
          gameId: game.id,
          playerId: seat.id,
          questionId: 'q1',
          correctness: 1,
          points: 1000,
        },
      });
      await prisma.playerAnswer.create({
        data: { gameId: game.id, playerId: seat.id, questionId: 'q2', correctness: 0, points: 0 },
      });
      await prisma.gameEvent.create({
        data: { gameId: game.id, type: 'skipped', data: { questionId: 'q2' } },
      });

      const body = (await as(alice, 'GET', '/api/profile')).json();
      expect(body.stats.correctAnswers).toBe(1);
      expect(body.stats.answeredCount).toBe(1);
      expect(body.stats.accuracy).toBe(1);
    });

    it('computes accuracy across several games', async () => {
      const alice = await signIn('alice');
      await finishedGame([{ userId: alice.id, score: 1000, correctCount: 1 }]);
      await finishedGame([{ userId: alice.id, score: 500, correctCount: 0 }]);

      const body = (await as(alice, 'GET', '/api/profile')).json();
      expect(body.stats.gamesPlayed).toBe(2);
      expect(body.stats.correctAnswers).toBe(1);
      expect(body.stats.answeredCount).toBe(2);
      expect(body.stats.accuracy).toBe(0.5);
    });
  });

  describe('profile lifecycle', () => {
    it('creates exactly one profile, idempotently, on repeated reads', async () => {
      const alice = await signIn('alice');

      // No profile row exists before the first read.
      expect(await prisma.playerProfile.count({ where: { userId: alice.id } })).toBe(0);

      const first = await as(alice, 'GET', '/api/profile');
      const second = await as(alice, 'GET', '/api/profile');
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);

      // Two reads, still exactly one row, and the same id both times.
      expect(await prisma.playerProfile.count({ where: { userId: alice.id } })).toBe(1);
      expect(second.json().profile).toEqual(first.json().profile);
    });

    it('creates the profile lazily for an account that predates it', async () => {
      // An account created without a profile stands in for one that existed
      // before Phase 6.6: no backfill migration, the first read materialises it.
      const user = await createUser({
        username: 'veteran',
        password: 'correct-horse-battery',
        role: 'PLAYER',
      });
      expect(await prisma.playerProfile.count({ where: { userId: user.id } })).toBe(0);

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'veteran', password: 'correct-horse-battery' },
      });
      const setCookie = login.headers['set-cookie'];
      const session = {
        cookie: (Array.isArray(setCookie) ? setCookie[0] : String(setCookie)).split(';')[0]!,
        csrf: login.json().csrfToken,
      };

      const read = await as(session, 'GET', '/api/profile');
      expect(read.statusCode).toBe(200);
      expect(read.json().user.username).toBe('veteran');
      expect(await prisma.playerProfile.count({ where: { userId: user.id } })).toBe(1);

      // The account stays fully usable afterwards: it can write its profile.
      const write = await as(session, 'PUT', '/api/profile', { selectedCharacterId: 'ethan' });
      expect(write.statusCode).toBe(200);
      expect(write.json().selectedCharacterId).toBe('ethan');
    });

    it('never lets one account change another account’s profile', async () => {
      const alice = await signIn('alice');
      const bob = await signIn('bob');

      await as(alice, 'PUT', '/api/profile', { selectedCharacterId: 'ethan' });
      await as(bob, 'PUT', '/api/profile', { selectedCharacterId: 'maya' });

      // Each account sees only its own value …
      expect((await as(alice, 'GET', '/api/profile')).json().profile.selectedCharacterId).toBe(
        'ethan',
      );
      expect((await as(bob, 'GET', '/api/profile')).json().profile.selectedCharacterId).toBe(
        'maya',
      );

      // … and each row in the database holds exactly that value, so Alice's
      // write could not have touched Bob's row (and vice versa).
      const aliceRow = await prisma.playerProfile.findUnique({ where: { userId: alice.id } });
      const bobRow = await prisma.playerProfile.findUnique({ where: { userId: bob.id } });
      expect(aliceRow?.selectedCharacterId).toBe('ethan');
      expect(bobRow?.selectedCharacterId).toBe('maya');
      expect(aliceRow?.id).not.toBe(bobRow?.id);
    });

    it('gives a guest participant no durable profile', async () => {
      // A guest seat is a `GamePlayer` with no `userId`. It plays a finished
      // game, and must leave no `PlayerProfile` and no `User` behind.
      await finishedGame([{ userId: null, score: 900, correctCount: 1 }]);

      expect(await prisma.playerProfile.count()).toBe(0);
      expect(await prisma.user.count()).toBe(0);
    });
  });

  describe('no IP data', () => {
    it('never exposes an IP field in the profile response', async () => {
      const alice = await signIn('alice');
      const body = (await as(alice, 'GET', '/api/profile')).json();
      const text = JSON.stringify(body).toLowerCase();
      expect(text).not.toContain('ip');
      expect(text).not.toContain('address');
    });

    it('stores no IP-like column on the profile table', async () => {
      // Guards against an IP address (or a hash of one) ever being added to the
      // durable profile: the table must have no column that could hold one.
      const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'player_profiles'
      `;
      const names = columns.map((column) => column.column_name.toLowerCase());
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect(name).not.toContain('ip');
        expect(name).not.toContain('address');
      }
    });
  });
});
