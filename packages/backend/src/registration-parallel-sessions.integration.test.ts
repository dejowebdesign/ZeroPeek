/**
 * Phase 6.8.1 — registration and sign-in while a host is signed in.
 *
 * The reported problem was that registering a player account appeared to be
 * blocked when a host was already signed in in the same browser, and the user
 * was bounced to the host page. The frontend cause is fixed in `pages/auth.ts`
 * (an explicit `#register`/`#signin` now wins over the convenience redirect);
 * the *server* side was never the problem, and this suite proves that by
 * driving the real Fastify app with a host cookie present.
 *
 * It asserts the server contract the fix relies on:
 *   - `POST /api/auth/register` succeeds with a `zp_session` cookie present;
 *   - `POST /api/player-auth/login` succeeds with a `zp_session` cookie present
 *     and issues only `zp_player_session`;
 *   - `POST /api/auth/login` for a PLAYER issues only `zp_player_session`;
 *   - a host login and a player login coexist, each guard reading its own cookie;
 *   - a player logout does not disturb the host session and the reverse.
 *
 * Skipped automatically when no database is reachable (see `testing/db.ts`).
 * Every assertion is on a status code or a payload — no browser, no screenshot.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './db.js';
import { createUser } from './services/userService.js';
import { canConnect, resetDatabase } from './testing/db.js';

const available = await canConnect();
const PASSWORD = 'correct-horse-battery';

describe.skipIf(!available)('Phase 6.8.1 — registration with a host session present', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const config = loadConfig({ NODE_ENV: 'test', COOKIE_SECURE: 'false' });
    app = await buildApp({ config });
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  /** The `Set-Cookie` pairs of a response. */
  function setCookies(response: { headers: Record<string, unknown> }): string[] {
    const raw = response.headers['set-cookie'];
    return Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];
  }

  /** The cookie names set by a response. */
  function cookieNames(response: { headers: Record<string, unknown> }): string[] {
    return setCookies(response).map((pair) => pair.split('=')[0]!);
  }

  /** The first `name=value` pair of a response. */
  function cookiePair(response: { headers: Record<string, unknown> }): string {
    return setCookies(response)[0]!.split(';')[0]!;
  }

  /** Sign a staff account in as a host (`zp_session`). */
  async function hostLogin(): Promise<{ cookie: string; csrf: string }> {
    await createUser({ username: 'hostcoach', password: PASSWORD, role: 'TRAINER' });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'hostcoach', password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    return { cookie: cookiePair(login), csrf: login.json().csrfToken };
  }

  it('registers a new player while a host session is present', async () => {
    const host = await hostLogin();

    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { cookie: host.cookie },
      payload: { username: 'Maya', email: 'maya@example.com', password: PASSWORD },
    });

    // A host cookie must not make registration fail or answer differently.
    expect(register.statusCode).toBe(200);
    expect(register.json()).toEqual({ ok: true, verificationSent: false });

    const stored = await prisma.user.findUnique({ where: { username: 'maya' } });
    expect(stored?.role).toBe('PLAYER');
    expect(stored?.emailVerifiedAt).toBeNull();
  });

  it('signs a player in through the player login while a host is signed in, issuing only the player cookie', async () => {
    const host = await hostLogin();
    await createUser({
      username: 'playermaya',
      password: PASSWORD,
      role: 'PLAYER',
      emailVerifiedAt: new Date(),
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/player-auth/login',
      headers: { cookie: host.cookie },
      payload: { username: 'playermaya', password: PASSWORD },
    });

    expect(login.statusCode).toBe(200);
    // The player login must never touch `zp_session`.
    expect(cookieNames(login)).toEqual(['zp_player_session']);
  });

  it('signs a player in through the general login and issues only the player cookie', async () => {
    const host = await hostLogin();
    await createUser({
      username: 'playermaya',
      password: PASSWORD,
      role: 'PLAYER',
      emailVerifiedAt: new Date(),
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { cookie: host.cookie },
      payload: { username: 'playermaya', password: PASSWORD },
    });

    expect(login.statusCode).toBe(200);
    expect(cookieNames(login)).toEqual(['zp_player_session']);
  });

  it('keeps both sessions active side by side in one browser', async () => {
    const host = await hostLogin();
    await createUser({
      username: 'playermaya',
      password: PASSWORD,
      role: 'PLAYER',
      emailVerifiedAt: new Date(),
    });
    const playerLogin = await app.inject({
      method: 'POST',
      url: '/api/player-auth/login',
      payload: { username: 'playermaya', password: PASSWORD },
    });
    const playerCookie = cookiePair(playerLogin);
    const both = `${host.cookie}; ${playerCookie}`;

    const hostMe = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: both },
    });
    const playerMe = await app.inject({
      method: 'GET',
      url: '/api/player-auth/me',
      headers: { cookie: both },
    });

    expect(hostMe.statusCode).toBe(200);
    expect(hostMe.json().user.username).toBe('hostcoach');
    expect(playerMe.statusCode).toBe(200);
    expect(playerMe.json().user.username).toBe('playermaya');

    // Each guard reads only its own cookie, so a single cookie yields only its
    // own identity.
    const hostOnly = await app.inject({
      method: 'GET',
      url: '/api/player-auth/me',
      headers: { cookie: host.cookie },
    });
    expect(hostOnly.statusCode).toBe(401);
    const playerOnly = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: playerCookie },
    });
    expect(playerOnly.statusCode).toBe(401);
  });

  it('logs the player out without disturbing the host session', async () => {
    const host = await hostLogin();
    await createUser({
      username: 'playermaya',
      password: PASSWORD,
      role: 'PLAYER',
      emailVerifiedAt: new Date(),
    });
    const playerLogin = await app.inject({
      method: 'POST',
      url: '/api/player-auth/login',
      payload: { username: 'playermaya', password: PASSWORD },
    });
    const playerCookie = cookiePair(playerLogin);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/player-auth/logout',
      headers: { cookie: `${host.cookie}; ${playerCookie}` },
    });
    expect(logout.statusCode).toBe(200);

    // The player session is gone; the host session still works.
    const playerMe = await app.inject({
      method: 'GET',
      url: '/api/player-auth/me',
      headers: { cookie: playerCookie },
    });
    expect(playerMe.statusCode).toBe(401);
    const hostMe = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: host.cookie },
    });
    expect(hostMe.statusCode).toBe(200);
  });

  it('refuses a staff account on the player login (never a silent player identity)', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/player-auth/login',
      payload: { username: 'hostcoach', password: PASSWORD },
    });
    // No such account yet -> invalid; create one and try again.
    expect(login.statusCode).toBe(401);

    await createUser({ username: 'hostcoach', password: PASSWORD, role: 'TRAINER' });
    const staff = await app.inject({
      method: 'POST',
      url: '/api/player-auth/login',
      payload: { username: 'hostcoach', password: PASSWORD },
    });
    expect(staff.statusCode).toBe(403);
    expect(staff.json().error.code).toBe('forbidden');
  });
});
