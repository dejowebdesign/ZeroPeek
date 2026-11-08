/**
 * Host / player identity separation (Phase 6.6.3) — the acceptance suite.
 *
 * Before 6.6.3 a single cookie (`zp_session`, `path=/`) was read by every
 * surface, so a host signed in on a browser was also the identity of the player
 * surface in another tab of that same browser: the profile showed the host and a
 * "guest" join was attributed to the host's account.
 *
 * This suite drives the real Fastify app and the real Socket.IO layer against a
 * real PostgreSQL, and proves the two contexts are now independent:
 *
 *   - the host context (`zp_session`) and the player context
 *     (`zp_player_session`) are separate cookies, separate session rows
 *     (`Session.kind`) and separate guards;
 *   - a host session is never accepted as a player identity, and the reverse;
 *   - a join links a seat to an account only through the player context;
 *   - logging out of one context leaves the other untouched.
 *
 * Skipped automatically when no database is reachable (see `testing/db.ts`).
 * Every assertion is on a payload or a status code — no browser, no screenshot.
 */

import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { io as connect, type Socket } from 'socket.io-client';

import type { PlayerSync, Quiz } from '@zeropeek/shared';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './db.js';
import { attachSocketIO } from './socket.js';
import { createQuiz } from './services/quizService.js';
import { createUser } from './services/userService.js';
import { canConnect, resetDatabase } from './testing/db.js';

const available = await canConnect();
const PASSWORD = 'correct-horse-battery';

function once<T = unknown>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function request<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    socket.emit(event, payload, (reply: { ok: boolean; data?: T; error?: string }) => {
      if (reply?.ok) resolve(reply.data as T);
      else reject(new Error(reply?.error ?? 'unknown socket error'));
    });
  });
}

const QUIZ: Quiz = {
  id: '00000000-0000-4000-8000-0000000000c1',
  title: 'Identity separation',
  description: '',
  theme: 'standard',
  defaultTimeLimit: 30,
  questions: [
    {
      id: '00000000-0000-4000-8000-0000000000c2',
      type: 'single',
      text: 'Capital of France?',
      timeLimit: 30,
      points: 'standard',
      options: ['Paris', 'Rome'],
      correctIndex: 0,
    },
  ],
};

describe.skipIf(!available)('host / player identity separation', () => {
  let app: FastifyInstance;
  let sockets: ReturnType<typeof attachSocketIO>;
  let url = '';
  let quizId = '';
  const open: Socket[] = [];

  beforeAll(async () => {
    const config = loadConfig({ NODE_ENV: 'test', COOKIE_SECURE: 'false' });
    app = await buildApp({ config });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
    sockets = attachSocketIO(app.server, config, config.corsOrigin);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const owner = await createUser({ username: 'hostowner', password: PASSWORD, role: 'TRAINER' });
    quizId = (await createQuiz(owner.id, QUIZ)).id;
  });

  afterAll(async () => {
    for (const socket of open) socket.disconnect();
    await sockets.close();
    await app.close();
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  function openSocket(namespace = '', options: Record<string, unknown> = {}): Socket {
    const socket = connect(`${url}${namespace}`, {
      transports: ['websocket'],
      forceNew: true,
      ...options,
    });
    open.push(socket);
    return socket;
  }

  /** The first `Set-Cookie` pair (`name=value`) from a login response. */
  function cookiePair(response: { headers: Record<string, unknown> }): string {
    const setCookie = response.headers['set-cookie'];
    return (Array.isArray(setCookie) ? setCookie[0]! : String(setCookie)).split(';')[0]!;
  }

  /** The cookie **names** set by a response, in order (a login sets exactly one). */
  function setCookieNames(response: { headers: Record<string, unknown> }): string[] {
    const setCookie = response.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [String(setCookie)] : [];
    return list.map((pair) => pair.split('=')[0]!);
  }

  /** Create an account and sign it in **as a host** (`zp_session`). */
  async function hostLogin(
    role: 'ADMIN' | 'TRAINER' = 'TRAINER',
    username = `host-${role.toLowerCase()}`,
  ): Promise<{ cookie: string; csrf: string; id: string }> {
    const user = await createUser({ username, password: PASSWORD, role });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    return { cookie: cookiePair(login), csrf: login.json().csrfToken, id: user.id };
  }

  /** Create a PLAYER account and sign it in **as a player** (`zp_player_session`). */
  async function playerLogin(
    username: string,
  ): Promise<{ cookie: string; csrf: string; id: string }> {
    const user = await createUser({ username, password: PASSWORD, role: 'PLAYER' });
    const login = await app.inject({
      method: 'POST',
      url: '/api/player-auth/login',
      payload: { username, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    return { cookie: cookiePair(login), csrf: login.json().csrfToken, id: user.id };
  }

  /** An authenticated host socket. */
  async function openHost(cookie: string): Promise<Socket> {
    const host = openSocket('/host', { extraHeaders: { cookie } });
    await once(host, 'connect');
    return host;
  }

  /** A host creates a lobby game; returns the id and pin. */
  async function createGame(
    cookie: string,
  ): Promise<{ host: Socket; gameId: string; pin: string }> {
    const host = await openHost(cookie);
    const { gameId, pin } = await request<{ gameId: string; pin: string }>(host, 'host:create', {
      quizId,
    });
    return { host, gameId, pin };
  }

  /** A player joins over a fresh socket, optionally presenting a cookie. */
  async function join(
    pin: string,
    nickname: string,
    cookie?: string,
  ): Promise<{ socket: Socket; playerId: string; token: string }> {
    const socket = openSocket('', cookie ? { extraHeaders: { cookie } } : {});
    await once(socket, 'connect');
    const joined = await request<{ playerId: string; token: string }>(socket, 'player:join', {
      pin,
      nickname,
    });
    return { socket, ...joined };
  }

  // -------------------------------------------------------------------------
  // T01 / T02 / T14 — a host cookie never becomes a player identity.
  // -------------------------------------------------------------------------

  it('T01 — host and guest run independently in the same browser', async () => {
    const host = await hostLogin();
    const { host: hostSocket, gameId, pin } = await createGame(host.cookie);

    // Same browser = the guest socket also sends the host cookie. It must still
    // be a guest: a seat is linked only through the player context.
    const guest = await join(pin, 'Guest', host.cookie);
    const row = await prisma.gamePlayer.findUnique({ where: { id: guest.playerId } });
    expect(row?.userId).toBeNull();

    // The host socket drives the game; the guest socket receives its events.
    const questionSeen = once<{ id: string }>(guest.socket, 'game:question');
    await request(hostSocket, 'host:start', { gameId });
    expect((await questionSeen).id).toBeTruthy();
  }, 30_000);

  it('T02 — a guest join stays a guest while a host is signed in', async () => {
    const host = await hostLogin();
    const { pin } = await createGame(host.cookie);

    const guest = await join(pin, 'Guest');
    const row = await prisma.gamePlayer.findUnique({ where: { id: guest.playerId } });
    expect(row?.userId).toBeNull();
  }, 20_000);

  it('T14 — a host cookie on a guest join causes no automatic account link', async () => {
    const host = await hostLogin('ADMIN');
    const { pin } = await createGame(host.cookie);

    const guest = await join(pin, 'Guest', host.cookie);
    const row = await prisma.gamePlayer.findUnique({ where: { id: guest.playerId } });
    // The host's own account id must not appear on the seat.
    expect(row?.userId).not.toBe(host.id);
    expect(row?.userId).toBeNull();
  }, 20_000);

  it('links a seat only when the join carries a player session', async () => {
    const host = await hostLogin();
    const { pin } = await createGame(host.cookie);
    const player = await playerLogin('linked');

    const signedIn = await join(pin, 'Linked', player.cookie);
    const row = await prisma.gamePlayer.findUnique({ where: { id: signedIn.playerId } });
    expect(row?.userId).toBe(player.id);
  }, 20_000);

  // -------------------------------------------------------------------------
  // T03 / T13 — the player profile uses only the player context.
  // -------------------------------------------------------------------------

  it('T03 — a host-only browser sees no player profile', async () => {
    const host = await hostLogin('ADMIN');

    const me = await app.inject({
      method: 'GET',
      url: '/api/player-auth/me',
      headers: { cookie: host.cookie },
    });
    expect(me.statusCode).toBe(401);

    const profile = await app.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { cookie: host.cookie },
    });
    expect(profile.statusCode).toBe(401);
  });

  it('T13 — a player only ever sees their own profile', async () => {
    const alice = await playerLogin('alice');
    const bob = await playerLogin('bob');

    const read = await app.inject({
      method: 'GET',
      url: '/api/profile?userId=' + bob.id,
      headers: { cookie: alice.cookie },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().user.id).toBe(alice.id);
  });

  // -------------------------------------------------------------------------
  // T04 / T12 / T15 / T17 — the two contexts coexist without cross-talk.
  // -------------------------------------------------------------------------

  it('T04 / T17 — host and player sessions stay active side by side', async () => {
    const host = await hostLogin('ADMIN');
    const player = await playerLogin('gamer');

    // Each cookie authenticates only its own context.
    const hostMe = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: host.cookie },
    });
    const playerMe = await app.inject({
      method: 'GET',
      url: '/api/player-auth/me',
      headers: { cookie: player.cookie },
    });
    expect(hostMe.statusCode).toBe(200);
    expect(hostMe.json().user.username).toBe('host-admin');
    expect(playerMe.statusCode).toBe(200);
    expect(playerMe.json().user.username).toBe('gamer');

    // Presenting both cookies to either endpoint must not swap identities.
    const both = `${host.cookie}; ${player.cookie}`;
    const hostWithBoth = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: both },
    });
    const playerWithBoth = await app.inject({
      method: 'GET',
      url: '/api/player-auth/me',
      headers: { cookie: both },
    });
    expect(hostWithBoth.json().user.username).toBe('host-admin');
    expect(playerWithBoth.json().user.username).toBe('gamer');

    // Both session rows exist and are tagged with their context.
    expect(await prisma.session.count({ where: { userId: host.id, kind: 'host' } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: player.id, kind: 'player' } })).toBe(1);
  });

  it('T12 — the same origin and IP do not cause an identity takeover', async () => {
    // Every request here comes from the same test process and IP. The host cookie
    // must not authenticate the player surface and the reverse must not either.
    const host = await hostLogin('ADMIN');
    const player = await playerLogin('gamer');

    const asPlayer = await app.inject({
      method: 'GET',
      url: '/api/player-auth/me',
      headers: { cookie: host.cookie },
    });
    const asHost = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: player.cookie },
    });
    expect(asPlayer.statusCode).toBe(401);
    expect(asHost.statusCode).toBe(401);
  });

  it('T15 — simultaneous host and player sockets do not mix roles', async () => {
    const host = await hostLogin();
    const { host: hostSocket, gameId, pin } = await createGame(host.cookie);
    const player = await playerLogin('gamer');

    const signedIn = await join(pin, 'Gamer', player.cookie);
    // The player socket lives on the `/` namespace and only receives events; it
    // has no host commands, so the host socket remains the only one that drives.
    const questionSeen = once<{ id: string }>(signedIn.socket, 'game:question');
    await request(hostSocket, 'host:start', { gameId });
    expect((await questionSeen).id).toBeTruthy();
    // The seat is linked to the player account, and only that account.
    const row = await prisma.gamePlayer.findUnique({ where: { id: signedIn.playerId } });
    expect(row?.userId).toBe(player.id);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T06 / T07 — a non-host cannot act as a host.
  // -------------------------------------------------------------------------

  it('T06 — an anonymous socket cannot open the host namespace', async () => {
    const anonymous = openSocket('/host');
    const error = await once<Error>(anonymous, 'connect_error');
    expect(error.message).toContain('unauthorized');
  }, 15_000);

  it('T07 — a PLAYER cannot reach the admin API', async () => {
    const player = await playerLogin('gamer');
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie: player.cookie },
    });
    // No host session: the host guard answers 401 before the role is even read.
    expect(response.statusCode).toBe(401);
  });

  // -------------------------------------------------------------------------
  // T08 / T09 — existing host control and reconnect are unchanged.
  // -------------------------------------------------------------------------

  it('T08 — the host can still drive a full game', async () => {
    const host = await hostLogin();
    const { host: hostSocket, gameId, pin } = await createGame(host.cookie);
    const player = await join(pin, 'Ada');

    const questionSeen = once<{ id: string }>(player.socket, 'game:question');
    await request(hostSocket, 'host:start', { gameId });
    const question = await questionSeen;
    expect(question.id).toBeTruthy();

    const ended = once<{ players: Array<{ nickname: string }> }>(hostSocket, 'host:ended');
    await request(hostSocket, 'host:end', { gameId });
    expect((await ended).players[0]!.nickname).toBe('Ada');
  }, 30_000);

  it('T09 — a player reconnects with the same token', async () => {
    const host = await hostLogin();
    const { gameId, pin } = await createGame(host.cookie);
    const player = await join(pin, 'Ada');

    const fresh = openSocket();
    await once(fresh, 'connect');
    const sync = await request<PlayerSync>(fresh, 'player:rejoin', {
      gameId,
      playerId: player.playerId,
      token: player.token,
    });
    expect(sync.phase).toBe('lobby');
  }, 30_000);

  // -------------------------------------------------------------------------
  // T05 — a guest needs no account.
  // -------------------------------------------------------------------------

  it('T05 — a guest joins with a nickname only', async () => {
    const host = await hostLogin();
    const { pin } = await createGame(host.cookie);

    const guest = await join(pin, 'Nickname');
    expect(guest.playerId).toBeTruthy();
    expect(guest.token).toBeTruthy();
    const row = await prisma.gamePlayer.findUnique({ where: { id: guest.playerId } });
    expect(row?.userId).toBeNull();
  }, 20_000);

  // -------------------------------------------------------------------------
  // T10 / T11 / T19 / T20 — logging out of one context never ends the other.
  // -------------------------------------------------------------------------

  it('T10 / T19 — a player logout does not disturb a running host', async () => {
    const host = await hostLogin();
    const player = await playerLogin('gamer');

    const logout = await app.inject({
      method: 'POST',
      url: '/api/player-auth/logout',
      headers: { cookie: player.cookie, 'x-csrf-token': player.csrf },
    });
    expect(logout.statusCode).toBe(200);

    // The player is gone…
    const playerMe = await app.inject({
      method: 'GET',
      url: '/api/player-auth/me',
      headers: { cookie: player.cookie },
    });
    expect(playerMe.statusCode).toBe(401);
    // …but the host session is untouched and still drives a game.
    const hostMe = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: host.cookie },
    });
    expect(hostMe.statusCode).toBe(200);
    const { host: hostSocket, gameId, pin } = await createGame(host.cookie);
    const questionSeen = once<{ id: string }>((await join(pin, 'x')).socket, 'game:question');
    await request(hostSocket, 'host:start', { gameId });
    expect((await questionSeen).id).toBeTruthy();
  }, 30_000);

  it('T11 / T20 — a host logout does not disturb a signed-in player', async () => {
    const host = await hostLogin();
    const player = await playerLogin('gamer');

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    });
    expect(logout.statusCode).toBe(200);

    // The host is gone…
    const hostMe = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: host.cookie },
    });
    expect(hostMe.statusCode).toBe(401);
    // …but the player session is untouched and the profile still loads.
    const playerMe = await app.inject({
      method: 'GET',
      url: '/api/player-auth/me',
      headers: { cookie: player.cookie },
    });
    expect(playerMe.statusCode).toBe(200);
    const profile = await app.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { cookie: player.cookie },
    });
    expect(profile.statusCode).toBe(200);
  });

  // -------------------------------------------------------------------------
  // T16 — an expired session is refused.
  // -------------------------------------------------------------------------

  it('T16 — an expired player session is refused', async () => {
    const player = await playerLogin('gamer');
    const id = player.cookie.split('=')[1]!;
    await prisma.session.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/player-auth/me',
      headers: { cookie: player.cookie },
    });
    expect(response.statusCode).toBe(401);
  });

  it('T16b — an expired host session is refused', async () => {
    const host = await hostLogin();
    const id = host.cookie.split('=')[1]!;
    await prisma.session.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: host.cookie },
    });
    expect(response.statusCode).toBe(401);
  });

  // -------------------------------------------------------------------------
  // T18 — a CSRF token from the wrong context is rejected.
  // -------------------------------------------------------------------------

  it('T18 — a host CSRF token is rejected on a player write', async () => {
    const host = await hostLogin();
    const player = await playerLogin('gamer');

    const response = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { cookie: player.cookie, 'x-csrf-token': host.csrf },
      payload: { selectedCharacterId: 'ethan' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('T18b — a player CSRF token is rejected on a host write', async () => {
    const host = await hostLogin();
    const player = await playerLogin('gamer');

    const created = await app.inject({
      method: 'POST',
      url: '/api/quizzes',
      headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
      payload: {
        title: 'Host quiz',
        theme: 'standard',
        defaultTimeLimit: 20,
        questions: [
          {
            id: 'q1',
            type: 'single',
            text: 'Capital of France?',
            timeLimit: 20,
            points: 'standard',
            options: ['Paris', 'Rome'],
            correctIndex: 0,
          },
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    const quiz = created.json().id;

    const response = await app.inject({
      method: 'PUT',
      url: `/api/quizzes/${quiz}`,
      headers: { cookie: host.cookie, 'x-csrf-token': player.csrf },
      payload: { title: 'Changed' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('a player signing in on the general login gets the player context, never a host one', async () => {
    // Finding 1 (Phase 6.6.3 follow-up): `auth.html` is the general sign-in. A
    // PLAYER must land in the player context — the session cookie decides the
    // context, and it must be the player one. The role is read from the verified
    // credentials on the server, never from the request.
    const gamer = await createUser({ username: 'gamer', password: PASSWORD, role: 'PLAYER' });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'gamer', password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    // Only the player cookie is set; no host cookie is created.
    expect(setCookieNames(login)).toEqual(['zp_player_session']);
    const cookie = cookiePair(login);

    // The player surface accepts it and reaches the profile.
    const playerMe = await app.inject({
      method: 'GET',
      url: '/api/player-auth/me',
      headers: { cookie },
    });
    expect(playerMe.statusCode).toBe(200);
    expect(playerMe.json().user.id).toBe(gamer.id);
    const profile = await app.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { cookie },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().user.id).toBe(gamer.id);

    // The host surface does not accept the player cookie.
    const hostMe = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(hostMe.statusCode).toBe(401);
    // The session row is a player session; no host session exists for the account.
    expect(await prisma.session.count({ where: { userId: gamer.id, kind: 'player' } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: gamer.id, kind: 'host' } })).toBe(0);
  });

  it('a staff login on the general login still gets the host context, never a player one', async () => {
    // ADMIN and TRAINER keep the host cookie; the general login never hands them
    // a player identity (Finding 1).
    for (const role of ['ADMIN', 'TRAINER'] as const) {
      const username = `staff-${role.toLowerCase()}`;
      const user = await createUser({ username, password: PASSWORD, role });
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username, password: PASSWORD },
      });
      expect(login.statusCode).toBe(200);
      expect(setCookieNames(login)).toEqual(['zp_session']);
      const cookie = cookiePair(login);

      const hostMe = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie },
      });
      expect(hostMe.statusCode).toBe(200);
      expect(hostMe.json().user.role).toBe(role);

      // No player session is created for the staff account, and the player
      // surface refuses the host cookie.
      expect(await prisma.session.count({ where: { userId: user.id, kind: 'player' } })).toBe(0);
      const playerMe = await app.inject({
        method: 'GET',
        url: '/api/player-auth/me',
        headers: { cookie },
      });
      expect(playerMe.statusCode).toBe(401);
    }
  });

  it('a general-login player is linked to their seat, exactly like the profile login', async () => {
    // Test 12: the explicit account link must survive the new sign-in path.
    const host = await hostLogin();
    const { host: hostSocket, gameId, pin } = await createGame(host.cookie);

    const user = await createUser({ username: 'gamer2', password: PASSWORD, role: 'PLAYER' });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'gamer2', password: PASSWORD },
    });
    const cookie = cookiePair(login);

    const { playerId } = await join(pin, 'GamerTwo', cookie);
    const seat = await prisma.gamePlayer.findUnique({ where: { id: playerId } });
    expect(seat?.userId).toBe(user.id);

    // Test 11: a guest without any cookie still joins with no account.
    const guest = await join(pin, 'JustAGuest');
    const guestSeat = await prisma.gamePlayer.findUnique({ where: { id: guest.playerId } });
    expect(guestSeat?.userId).toBeNull();

    hostSocket.disconnect();
    expect(gameId).toBeTruthy();
  });

  it('a host account cannot sign in through the player login', async () => {
    await createUser({ username: 'coach', password: PASSWORD, role: 'TRAINER' });
    const login = await app.inject({
      method: 'POST',
      url: '/api/player-auth/login',
      payload: { username: 'coach', password: PASSWORD },
    });
    expect(login.statusCode).toBe(403);
    // No session was created for the staff account.
    expect(await prisma.session.count({ where: { kind: 'player' } })).toBe(0);
  });
});
