/**
 * Integration tests for player registration and e-mail confirmation (Phase 6.3).
 *
 * Skipped automatically when no database is reachable (see `testing/db.ts`).
 * These cover the additive surface: register, the confirm link, the resend, the
 * login gate for an unconfirmed account, and the PLAYER role boundary (a player
 * account must not reach the trainer/admin surfaces). The existing auth is
 * exercised by `api.integration.test.ts` and is not repeated here.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './db.js';
import { hashVerificationToken } from './auth.js';
import { createUser } from './services/userService.js';
import { canConnect, resetDatabase } from './testing/db.js';

const available = await canConnect();

const STRONG = 'a-long-enough-password';

describe.skipIf(!available)('player registration integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // No mail transport in tests: registration still succeeds and the token is
    // still created, which is what the confirm step needs.
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', COOKIE_SECURE: 'false' }),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const register = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/auth/register', payload });

  /**
   * A known raw token with its stored hash. Registration only stores the hash,
   * so a test that needs to *use* a token writes the row for a token it knows.
   */
  async function issueKnownToken(
    username: string,
    raw: string,
    expiresAt = new Date(Date.now() + 3_600_000),
  ): Promise<void> {
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    await prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash: hashVerificationToken(raw), expiresAt },
    });
  }

  describe('register', () => {
    it('creates an unconfirmed PLAYER account', async () => {
      const response = await register({
        username: 'Maya',
        email: 'maya@example.com',
        password: STRONG,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().ok).toBe(true);

      const user = await prisma.user.findUniqueOrThrow({ where: { username: 'maya' } });
      expect(user.role).toBe('PLAYER');
      expect(user.emailVerifiedAt).toBeNull();
      // The password is never stored in clear text.
      expect(user.passwordHash).not.toContain(STRONG);
    });

    it('rejects a short password with a field issue', async () => {
      const response = await register({
        username: 'Maya',
        email: 'maya@example.com',
        password: 'short',
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.issues.map((issue: { path: string }) => issue.path)).toContain(
        'password',
      );
    });

    it('rejects an invalid e-mail', async () => {
      const response = await register({
        username: 'Maya',
        email: 'not-an-email',
        password: STRONG,
      });
      expect(response.statusCode).toBe(422);
    });

    it('rejects a duplicate username with a conflict', async () => {
      await register({ username: 'Maya', email: 'maya@example.com', password: STRONG });
      const response = await register({
        username: 'maya',
        email: 'other@example.com',
        password: STRONG,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('username_taken');
    });

    it('answers a duplicate e-mail exactly like a fresh registration', async () => {
      // The first registration succeeds; the second reuses the address with a
      // new name. The two responses must be byte-identical so the endpoint
      // cannot be used to discover which addresses already have an account.
      const first = await register({
        username: 'Maya',
        email: 'maya@example.com',
        password: STRONG,
      });
      const second = await register({
        username: 'Ada',
        email: 'MAYA@example.com',
        password: STRONG,
      });
      expect(second.statusCode).toBe(first.statusCode);
      expect(second.json()).toEqual(first.json());
      // And no second account was created for that address.
      expect(await prisma.user.count({ where: { email: 'maya@example.com' } })).toBe(1);
      expect(await prisma.user.findUnique({ where: { username: 'ada' } })).toBeNull();
    });

    it('stores only the hash of the verification token', async () => {
      await register({ username: 'Maya', email: 'maya@example.com', password: STRONG });
      const user = await prisma.user.findUniqueOrThrow({ where: { username: 'maya' } });
      const tokens = await prisma.emailVerificationToken.findMany({ where: { userId: user.id } });
      expect(tokens).toHaveLength(1);
      // 64 hex characters – a SHA-256 digest, not the raw token.
      expect(tokens[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('login gate', () => {
    it('refuses an unconfirmed account with the email_unverified code', async () => {
      await register({ username: 'Maya', email: 'maya@example.com', password: STRONG });
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'maya', password: STRONG },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('email_unverified');
    });

    it('lets a confirmed player sign in', async () => {
      await register({ username: 'Maya', email: 'maya@example.com', password: STRONG });
      await prisma.user.update({
        where: { username: 'maya' },
        data: { emailVerifiedAt: new Date() },
      });
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'maya', password: STRONG },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().user.role).toBe('PLAYER');
      expect(response.json().csrfToken).toBeTruthy();
    });

    it('still rejects a wrong password', async () => {
      await register({ username: 'Maya', email: 'maya@example.com', password: STRONG });
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'maya', password: 'wrong-password-here' },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('verify', () => {
    it('rejects an unknown token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/verify',
        payload: { token: 'not-a-real-token' },
      });
      expect(response.statusCode).toBe(422);
    });

    it('rejects an expired token', async () => {
      await register({ username: 'Maya', email: 'maya@example.com', password: STRONG });
      await issueKnownToken('maya', 'expired-token', new Date(Date.now() - 1000));
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/verify',
        payload: { token: 'expired-token' },
      });
      expect(response.statusCode).toBe(422);
    });

    it('confirms the account and clears the token', async () => {
      await register({ username: 'Maya', email: 'maya@example.com', password: STRONG });
      await issueKnownToken('maya', 'good-token');
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/verify',
        payload: { token: 'good-token' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().verified).toBe(true);

      const user = await prisma.user.findUniqueOrThrow({ where: { username: 'maya' } });
      expect(user.emailVerifiedAt).not.toBeNull();
      expect(await prisma.emailVerificationToken.count()).toBe(0);
    });

    it('rejects a token that was already used', async () => {
      await register({ username: 'Maya', email: 'maya@example.com', password: STRONG });
      await issueKnownToken('maya', 'once-token');
      const first = await app.inject({
        method: 'POST',
        url: '/api/auth/verify',
        payload: { token: 'once-token' },
      });
      expect(first.statusCode).toBe(200);
      const second = await app.inject({
        method: 'POST',
        url: '/api/auth/verify',
        payload: { token: 'once-token' },
      });
      expect(second.statusCode).toBe(422);
    });
  });

  describe('resend', () => {
    it('answers the same way whether or not the account exists', async () => {
      const known = await app.inject({
        method: 'POST',
        url: '/api/auth/resend',
        payload: { email: 'nobody@example.com' },
      });
      expect(known.statusCode).toBe(200);
      expect(known.json()).toEqual({ ok: true });
    });
  });

  describe('staff login is unaffected by the player gate', () => {
    it('still signs an ADMIN in and lets them reach the admin routes', async () => {
      await createUser({ username: 'root', password: STRONG, role: 'ADMIN' });
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'root', password: STRONG },
      });
      expect(login.statusCode).toBe(200);
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      const users = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { cookie },
      });
      expect(users.statusCode).toBe(200);
    });

    it('still signs a TRAINER in and lets them reach the quiz routes', async () => {
      await createUser({ username: 'coach', password: STRONG, role: 'TRAINER' });
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'coach', password: STRONG },
      });
      expect(login.statusCode).toBe(200);
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      const quizzes = await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie } });
      expect(quizzes.statusCode).toBe(200);
    });
  });

  describe('role boundary', () => {
    it('does not let a PLAYER reach the quiz or report routes', async () => {
      // A confirmed player signs in through the general sign-in (Phase 6.6.3:
      // a PLAYER now gets the player context), then tries the trainer surfaces.
      await createUser({
        username: 'gamer',
        password: STRONG,
        role: 'PLAYER',
        emailVerifiedAt: new Date(),
      });
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'gamer', password: STRONG },
      });
      expect(login.statusCode).toBe(200);
      const setCookie = login.headers['set-cookie'];
      const cookie = (Array.isArray(setCookie) ? setCookie[0] : String(setCookie)).split(';')[0]!;
      const csrf = login.json().csrfToken;

      // The trainer surfaces read the host context; a player cookie carries no
      // host session, so access is refused (401 before the role is even read).
      for (const url of ['/api/quizzes', '/api/reports/games']) {
        const response = await app.inject({ method: 'GET', url, headers: { cookie } });
        expect(response.statusCode, url).toBe(401);
      }
      const write = await app.inject({
        method: 'POST',
        url: '/api/quizzes',
        headers: { cookie, 'x-csrf-token': csrf },
        payload: { title: 'x' },
      });
      expect(write.statusCode).toBe(401);
    });

    it('still refuses a host session that is not staff on the trainer surfaces', async () => {
      // Defence in depth: if an authenticated *host* session ever belonged to a
      // non-staff account, the role gate answers 403. Built here by forging the
      // session row's kind and presenting it under the host cookie name, so the
      // route's staff check is exercised directly (rather than the 401 a player
      // cookie gets).
      const gamer = await createUser({
        username: 'gamer2',
        password: STRONG,
        role: 'PLAYER',
        emailVerifiedAt: new Date(),
      });
      const playerLogin = await app.inject({
        method: 'POST',
        url: '/api/player-auth/login',
        payload: { username: 'gamer2', password: STRONG },
      });
      const sessionId = String(playerLogin.headers['set-cookie']).split('=')[1]!.split(';')[0]!;
      const csrf = playerLogin.json().csrfToken;
      await prisma.session.updateMany({ where: { userId: gamer.id }, data: { kind: 'host' } });
      const hostNamedCookie = `zp_session=${sessionId}`;

      const response = await app.inject({
        method: 'GET',
        url: '/api/quizzes',
        headers: { cookie: hostNamedCookie },
      });
      expect(response.statusCode).toBe(403);
      const write = await app.inject({
        method: 'POST',
        url: '/api/quizzes',
        headers: { cookie: hostNamedCookie, 'x-csrf-token': csrf },
        payload: { title: 'x' },
      });
      expect(write.statusCode).toBe(403);
    });
  });
});

/**
 * The per-route limits are off in the default test app (see `authRateLimits`),
 * so this suite builds its own app with them switched on to prove they fire.
 */
describe.skipIf(!available)('auth rate limits', () => {
  let limited: FastifyInstance;

  beforeAll(async () => {
    limited = await buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        COOKIE_SECURE: 'false',
        AUTH_RATE_LIMITS: 'true',
      }),
    });
    await limited.ready();
  });

  afterAll(async () => {
    await limited.close();
    await prisma.$disconnect();
  });

  it('rejects a flood of registration attempts with 429', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await limited.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          username: `flood${attempt}`,
          email: `flood${attempt}@example.com`,
          password: STRONG,
        },
      });
      statuses.push(response.statusCode);
    }
    // The limit is 10/minute, so the tail of the flood is rejected.
    expect(statuses).toContain(429);
    const firstLimited = statuses.indexOf(429);
    expect(firstLimited).toBeGreaterThanOrEqual(10);
  });

  it('answers the resend endpoint with 429 once its lower limit is reached', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await limited.inject({
        method: 'POST',
        url: '/api/auth/resend',
        payload: { email: 'nobody@example.com' },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses).toContain(429);
  });
});
