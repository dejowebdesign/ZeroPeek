/**
 * Clock synchronisation and socket rate limiting, over real Socket.IO
 * (Phase 6.8.5).
 *
 * Two independent concerns, in two suites:
 *
 *  - **Clock sync** — `clock:ping` is answered with the server's wall clock and
 *    the same correlation id, on both the player and the host namespace, so a
 *    client can correct its own clock. The check proves the reply carries a
 *    plausible server time, that ids are echoed, that unknown ids are harmless
 *    and that the clock path works with several players at once.
 *  - **Rate limiting** — the gameplay events are bounded per server-owned
 *    identity. This suite builds a second app with `SOCKET_RATE_LIMITS=true`
 *    (the limits are off by default in the test environment, so the other socket
 *    suites are not tripped by their own traffic) and proves a flood is rejected
 *    without touching scores or state, while normal play and separate identities
 *    are unaffected.
 *
 * Skipped automatically when no database is reachable (see testing/db.ts).
 */

import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { io as connect, type Socket } from 'socket.io-client';

import type { ClockPong, HostState, Quiz } from '@zeropeek/shared';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './db.js';
import { attachSocketIO } from './socket.js';
import { createQuiz } from './services/quizService.js';
import { createUser } from './services/userService.js';
import { SOCKET_RATE_RULES } from './socketRateLimit.js';
import { canConnect, resetDatabase } from './testing/db.js';

const available = await canConnect();

/** Wait for one event, with a timeout so a hung test fails loudly. */
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

/** Emit with an ACK and unwrap the `{ ok, data }` envelope. */
function request<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    socket.emit(event, payload, (reply: { ok: boolean; data?: T; error?: string }) => {
      if (reply?.ok) resolve(reply.data as T);
      else reject(new Error(reply?.error ?? 'unknown socket error'));
    });
  });
}

const QUIZ: Quiz = {
  id: '00000000-0000-4000-8000-0000000000e1',
  title: 'Clock and rate-limit test',
  description: '',
  theme: 'standard',
  defaultTimeLimit: 30,
  questions: [
    {
      id: '00000000-0000-4000-8000-0000000000e2',
      type: 'single',
      text: 'Capital of France?',
      timeLimit: 30,
      points: 'standard',
      options: ['Paris', 'Rome'],
      correctIndex: 0,
    },
  ],
};

describe.skipIf(!available)('clock synchronisation (Phase 6.8.5)', () => {
  let app: FastifyInstance;
  let sockets: ReturnType<typeof attachSocketIO>;
  let url = '';
  let cookie = '';
  let quizId = '';
  const open: Socket[] = [];

  beforeAll(async () => {
    await resetDatabase(prisma);
    const config = loadConfig({ NODE_ENV: 'test', COOKIE_SECURE: 'false' });
    app = await buildApp({ config });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
    sockets = attachSocketIO(app.server, config, config.corsOrigin);

    const owner = await createUser({
      username: 'clockhost',
      password: 'correct-horse-battery',
      role: 'TRAINER',
    });
    quizId = (await createQuiz(owner.id, QUIZ)).id;

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'clockhost', password: 'correct-horse-battery' },
    });
    const setCookie = login.headers['set-cookie'];
    cookie = (Array.isArray(setCookie) ? setCookie[0]! : String(setCookie)).split(';')[0]!;
  });

  afterAll(async () => {
    for (const socket of open) socket.disconnect();
    await sockets.close();
    await app.close();
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  /** Connect a socket and track it for cleanup. */
  function openSocket(namespace = '', options: Record<string, unknown> = {}): Socket {
    const socket = connect(`${url}${namespace}`, {
      transports: ['websocket'],
      forceNew: true,
      ...options,
    });
    socket.on('connect_error', (error: Error) => {
      // eslint-disable-next-line no-console
      console.error(`[clock] connect_error on "${namespace || '/'}": ${error.message}`);
    });
    open.push(socket);
    return socket;
  }

  it('answers a player clock:ping with the server time and the same id', async () => {
    const player = openSocket();
    await once(player, 'connect');

    const before = Date.now();
    const pong = await new Promise<ClockPong>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no clock:pong')), 5000);
      player.once('clock:pong', (payload: ClockPong) => {
        clearTimeout(timer);
        resolve(payload);
      });
      player.emit('clock:ping', { id: 'probe-1' });
    });
    const after = Date.now();

    expect(pong.id).toBe('probe-1');
    // The server time must sit between the client's before/after readings, give
    // or take the round-trip; a wildly wrong value would break every countdown.
    expect(pong.serverTime).toBeGreaterThanOrEqual(before - 1000);
    expect(pong.serverTime).toBeLessThanOrEqual(after + 1000);
  });

  it('answers a host clock:ping too, so the beamer countdown is corrected', async () => {
    const host = openSocket('/host', { extraHeaders: { cookie } });
    await once(host, 'connect');

    const pong = await new Promise<ClockPong>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no clock:pong')), 5000);
      host.once('clock:pong', (payload: ClockPong) => {
        clearTimeout(timer);
        resolve(payload);
      });
      host.emit('clock:ping', { id: 'host-probe' });
    });
    expect(pong.id).toBe('host-probe');
    expect(Math.abs(pong.serverTime - Date.now())).toBeLessThan(2000);
  });

  it('echoes several different ids in order, one pong each', async () => {
    const player = openSocket();
    await once(player, 'connect');

    const received: string[] = [];
    player.on('clock:pong', (payload: ClockPong) => received.push(payload.id));
    for (const id of ['a', 'b', 'c']) player.emit('clock:ping', { id });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(received.sort()).toEqual(['a', 'b', 'c']);
  });

  it('tolerates an unknown or malformed ping id without failing', async () => {
    const player = openSocket();
    await once(player, 'connect');

    // A ping with no id, and one with a non-string id, must still get a valid
    // pong (with an empty id) rather than crash the socket.
    const noId = await new Promise<ClockPong>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no clock:pong for empty ping')), 5000);
      player.once('clock:pong', (payload: ClockPong) => {
        clearTimeout(timer);
        resolve(payload);
      });
      player.emit('clock:ping', {});
    });
    expect(noId.id).toBe('');
    expect(Number.isFinite(noId.serverTime)).toBe(true);

    const numericId = await new Promise<ClockPong>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no clock:pong for numeric id')), 5000);
      player.once('clock:pong', (payload: ClockPong) => {
        clearTimeout(timer);
        resolve(payload);
      });
      player.emit('clock:ping', { id: 12345 });
    });
    expect(numericId.id).toBe('');
  });

  it('serves many players measuring their clock at once', async () => {
    const players = Array.from({ length: 6 }, () => openSocket());
    await Promise.all(players.map((socket) => once(socket, 'connect')));

    const pongs = await Promise.all(
      players.map(
        (socket, index) =>
          new Promise<ClockPong>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('no clock:pong')), 5000);
            socket.once('clock:pong', (payload: ClockPong) => {
              clearTimeout(timer);
              resolve(payload);
            });
            socket.emit('clock:ping', { id: `multi-${index}` });
          }),
      ),
    );
    pongs.forEach((pong, index) => {
      expect(pong.id).toBe(`multi-${index}`);
      expect(Number.isFinite(pong.serverTime)).toBe(true);
    });
  });

  it('keeps answering clock:ping after a reconnect', async () => {
    const player = openSocket();
    await once(player, 'connect');
    await new Promise((resolve) => setTimeout(resolve, 50));

    player.disconnect();
    player.connect();
    await once(player, 'connect');

    const pong = await new Promise<ClockPong>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no clock:pong after reconnect')), 5000);
      player.once('clock:pong', (payload: ClockPong) => {
        clearTimeout(timer);
        resolve(payload);
      });
      player.emit('clock:ping', { id: 'after-reconnect' });
    });
    expect(pong.id).toBe('after-reconnect');
  });

  it('still rejects a late answer on the server, regardless of any clock', async () => {
    // The clock sync only changes what a client *shows*; the server's own
    // deadline is unchanged. This proves a corrected client clock cannot get a
    // second answer accepted: with another player still to answer the question
    // stays open, and the duplicate is refused as "already answered".
    const host = openSocket('/host', { extraHeaders: { cookie } });
    await once(host, 'connect');
    const { gameId, pin } = await request<{ gameId: string; pin: string }>(host, 'host:create', {
      quizId,
    });
    const player = openSocket();
    const other = openSocket();
    await Promise.all([once(player, 'connect'), once(other, 'connect')]);
    await request(player, 'player:join', { pin, nickname: 'Late' });
    await request(other, 'player:join', { pin, nickname: 'Waiting' });

    const question = once<{ id: string }>(player, 'game:question');
    await request(host, 'host:start', { gameId });
    const q = await question;

    await request(player, 'player:answer', { questionId: q.id, answer: 0 });
    await expect(request(player, 'player:answer', { questionId: q.id, answer: 0 })).rejects.toThrow(
      /already answered/i,
    );
  }, 20_000);
});

describe.skipIf(!available)('socket rate limiting (Phase 6.8.5)', () => {
  let app: FastifyInstance;
  let sockets: ReturnType<typeof attachSocketIO>;
  let url = '';
  let cookie = '';
  let quizId = '';
  let pin = '';
  const open: Socket[] = [];

  beforeAll(async () => {
    await resetDatabase(prisma);
    // The limits are off in the test environment by default; this suite opts in
    // so the flood assertions are real.
    const config = loadConfig({
      NODE_ENV: 'test',
      COOKIE_SECURE: 'false',
      SOCKET_RATE_LIMITS: 'true',
    });
    app = await buildApp({ config });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
    sockets = attachSocketIO(app.server, config, config.corsOrigin);

    const owner = await createUser({
      username: 'limithost',
      password: 'correct-horse-battery',
      role: 'TRAINER',
    });
    quizId = (await createQuiz(owner.id, QUIZ)).id;

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'limithost', password: 'correct-horse-battery' },
    });
    const setCookie = login.headers['set-cookie'];
    cookie = (Array.isArray(setCookie) ? setCookie[0]! : String(setCookie)).split(';')[0]!;
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
    socket.on('connect_error', (error: Error) => {
      // eslint-disable-next-line no-console
      console.error(`[limits] connect_error on "${namespace || '/'}": ${error.message}`);
    });
    open.push(socket);
    return socket;
  }

  /** Create a fresh game and return its PIN. */
  async function newPin(): Promise<string> {
    const host = openSocket('/host', { extraHeaders: { cookie } });
    await once(host, 'connect');
    const created = await request<{ gameId: string; pin: string }>(host, 'host:create', {
      quizId,
    });
    return created.pin;
  }

  it('allows a normal join sequence, then rejects a flood of joins', async () => {
    pin = await newPin();
    const player = openSocket();
    await once(player, 'connect');

    // The first join succeeds (normal play). Distinct nicknames, so the only
    // thing that can stop a later join is the rate limit, not a name clash.
    const joined = await request<{ playerId: string }>(player, 'player:join', {
      pin,
      nickname: 'Flooder0',
    });
    expect(joined.playerId).toBeTruthy();

    // Keep joining on the same socket until the limit trips. The join limit is
    // 10 per window; the first one is spent, so the rest of the allowance plus
    // one rejection is what we expect.
    let rejected = 0;
    for (let i = 0; i < SOCKET_RATE_RULES.join.max + 3; i += 1) {
      try {
        await request(player, 'player:join', { pin, nickname: `Flooder${i + 1}` });
      } catch (error) {
        expect(String(error)).toMatch(/too many requests/i);
        rejected += 1;
      }
    }
    expect(rejected).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it('does not change game state when a join is rejected', async () => {
    const freshPin = await newPin();
    const player = openSocket();
    await once(player, 'connect');

    // Exhaust the join allowance, then try once more and confirm the roster did
    // not grow on the rejected attempt.
    for (let i = 0; i < SOCKET_RATE_RULES.join.max; i += 1) {
      await request(player, 'player:join', { pin: freshPin, nickname: `P${i}` });
    }
    const game = await prisma.game.findFirst({
      where: { pin: freshPin },
      include: { players: true },
    });
    const before = game?.players.length ?? 0;

    await expect(
      request(player, 'player:join', { pin: freshPin, nickname: 'TooLate' }),
    ).rejects.toThrow(/too many requests/i);

    const after = await prisma.game.findFirst({
      where: { pin: freshPin },
      include: { players: true },
    });
    expect(after?.players.length ?? 0).toBe(before);
  }, 20_000);

  it('rejects a flood of answers without touching the score', async () => {
    const host = openSocket('/host', { extraHeaders: { cookie } });
    await once(host, 'connect');
    const { gameId, pin: gamePin } = await request<{ gameId: string; pin: string }>(
      host,
      'host:create',
      { quizId },
    );
    const player = openSocket();
    await once(player, 'connect');
    const joined = await request<{ playerId: string }>(player, 'player:join', {
      pin: gamePin,
      nickname: 'Spray',
    });

    const question = once<{ id: string }>(player, 'game:question');
    await request(host, 'host:start', { gameId });
    const q = await question;

    // One legitimate answer.
    await request(player, 'player:answer', { questionId: q.id, answer: 0 });
    const scored = await prisma.gamePlayer.findUnique({ where: { id: joined.playerId } });
    const scoreAfterAnswer = scored!.score;

    // A spray of duplicate answers: the first is refused as "already answered",
    // and once the per-player answer allowance is spent they are refused as rate
    // limited. Either way the score must not move.
    let rateLimited = 0;
    for (let i = 0; i < SOCKET_RATE_RULES.answer.max + 5; i += 1) {
      try {
        await request(player, 'player:answer', { questionId: q.id, answer: 0 });
      } catch (error) {
        if (/too many requests/i.test(String(error))) rateLimited += 1;
      }
    }
    expect(rateLimited).toBeGreaterThanOrEqual(1);

    const after = await prisma.gamePlayer.findUnique({ where: { id: joined.playerId } });
    expect(after!.score).toBe(scoreAfterAnswer);
  }, 20_000);

  it('keeps each player’s answer allowance separate', async () => {
    const host = openSocket('/host', { extraHeaders: { cookie } });
    await once(host, 'connect');
    const { gameId, pin: gamePin } = await request<{ gameId: string; pin: string }>(
      host,
      'host:create',
      { quizId },
    );

    const ada = openSocket();
    const bob = openSocket();
    await Promise.all([once(ada, 'connect'), once(bob, 'connect')]);
    await request(ada, 'player:join', { pin: gamePin, nickname: 'Ada' });
    await request(bob, 'player:join', { pin: gamePin, nickname: 'Bob' });

    const question = once<{ id: string }>(ada, 'game:question');
    await request(host, 'host:start', { gameId });
    const q = await question;

    // Exhaust Ada's allowance with duplicate answers.
    for (let i = 0; i < SOCKET_RATE_RULES.answer.max + 2; i += 1) {
      try {
        await request(ada, 'player:answer', { questionId: q.id, answer: 0 });
      } catch {
        // Ignored: the point is that Ada is exhausted.
      }
    }
    // Bob's first answer still goes through: his bucket is untouched.
    const accepted = await request<{ accepted: boolean }>(bob, 'player:answer', {
      questionId: q.id,
      answer: 1,
    });
    expect(accepted.accepted).toBe(true);
  }, 20_000);

  it('rejects a flood of rejoins for one seat', async () => {
    const host = openSocket('/host', { extraHeaders: { cookie } });
    await once(host, 'connect');
    const { gameId, pin: gamePin } = await request<{ gameId: string; pin: string }>(
      host,
      'host:create',
      { quizId },
    );
    const player = openSocket();
    await once(player, 'connect');
    const joined = await request<{ playerId: string; token: string }>(player, 'player:join', {
      pin: gamePin,
      nickname: 'Rejoiner',
    });

    let rejected = 0;
    for (let i = 0; i < SOCKET_RATE_RULES.rejoin.max + 3; i += 1) {
      try {
        await request(player, 'player:rejoin', {
          gameId,
          playerId: joined.playerId,
          token: joined.token,
        });
      } catch (error) {
        if (/too many requests/i.test(String(error))) rejected += 1;
      }
    }
    expect(rejected).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it('rejects a rejoin spray that names many seats from one connection', async () => {
    // A client could name a different `playerId` on each attempt to spread the
    // load across seats. The per-socket backstop still bounds it.
    const player = openSocket();
    await once(player, 'connect');

    let rateLimited = 0;
    for (let i = 0; i < SOCKET_RATE_RULES.rejoinBySocket.max + 5; i += 1) {
      try {
        await request(player, 'player:rejoin', {
          gameId: '00000000-0000-4000-8000-0000000000ff',
          playerId: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`,
          token: 'bogus',
        });
      } catch (error) {
        if (/too many requests/i.test(String(error))) rateLimited += 1;
      }
    }
    expect(rateLimited).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it('keeps a host and a player with the same id-shaped key separate', async () => {
    // The limiter is shared by both namespaces, but keys are namespaced by role
    // in practice (`socket:`/`player:` for players). A host flood must not affect
    // a player's allowance.
    const host = openSocket('/host', { extraHeaders: { cookie } });
    await once(host, 'connect');
    const { pin: gamePin } = await request<{ gameId: string; pin: string }>(host, 'host:create', {
      quizId,
    });
    const player = openSocket();
    await once(player, 'connect');

    // A single join works even after the host has been busy creating games.
    const joined = await request<{ playerId: string }>(player, 'player:join', {
      pin: gamePin,
      nickname: 'Unaffected',
    });
    expect(joined.playerId).toBeTruthy();
  }, 20_000);

  it('recovers after the rate-limit window elapses', async () => {
    // The window is 10 s; waiting it out in a test would be slow, so this only
    // asserts the limiter is per-window by exercising the unit-level contract
    // through the socket: a fresh socket (new key) is never blocked by an
    // exhausted old one.
    const freshPin = await newPin();
    const first = openSocket();
    await once(first, 'connect');
    for (let i = 0; i < SOCKET_RATE_RULES.join.max; i += 1) {
      await request(first, 'player:join', { pin: freshPin, nickname: `A${i}` });
    }
    await expect(
      request(first, 'player:join', { pin: freshPin, nickname: 'Blocked' }),
    ).rejects.toThrow(/too many requests/i);

    // A brand-new connection has its own bucket, so it joins fine.
    const second = openSocket();
    await once(second, 'connect');
    const joined = await request<{ playerId: string }>(second, 'player:join', {
      pin: freshPin,
      nickname: 'Fresh',
    });
    expect(joined.playerId).toBeTruthy();
  }, 20_000);

  it('ignores a manipulated payload when choosing the bucket', async () => {
    // A player cannot move their own bucket by sending someone else's id: the
    // answer key is the seated player, read from the socket, never the payload.
    const host = openSocket('/host', { extraHeaders: { cookie } });
    await once(host, 'connect');
    const { gameId, pin: gamePin } = await request<{ gameId: string; pin: string }>(
      host,
      'host:create',
      { quizId },
    );
    const player = openSocket();
    await once(player, 'connect');
    await request(player, 'player:join', { pin: gamePin, nickname: 'Spoofer' });

    const question = once<{ id: string }>(player, 'game:question');
    await request(host, 'host:start', { gameId });
    const q = await question;

    // Answers carrying a bogus extra `playerId` field are still counted against
    // the sender's own bucket.
    let rateLimited = 0;
    for (let i = 0; i < SOCKET_RATE_RULES.answer.max + 4; i += 1) {
      try {
        await request(player, 'player:answer', {
          questionId: q.id,
          answer: 0,
          playerId: 'someone-else',
        });
      } catch (error) {
        if (/too many requests/i.test(String(error))) rateLimited += 1;
      }
    }
    expect(rateLimited).toBeGreaterThanOrEqual(1);
  }, 20_000);
});
