/**
 * Host state synchronisation over real Socket.IO (Phase 6.5.2).
 *
 * Covers the phase brief's tests A–E, H and I: the host must recover the
 * authoritative phase on (re)connect, must never appear as a participant, must
 * not leak the solution before the reveal, and must not weaken the phase lock
 * that PR #29 introduced.
 *
 * Skipped automatically when no database is reachable (see testing/db.ts).
 */

import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { io as connect, type Socket } from 'socket.io-client';

import type { HostState, Quiz } from '@zeropeek/shared';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './db.js';
import { attachSocketIO } from './socket.js';
import { createQuiz } from './services/quizService.js';
import { createUser } from './services/userService.js';
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
  title: 'Host sync test',
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
    {
      id: '00000000-0000-4000-8000-0000000000e3',
      type: 'single',
      text: 'Capital of Italy?',
      timeLimit: 30,
      points: 'standard',
      options: ['Paris', 'Rome'],
      correctIndex: 1,
    },
  ],
};

describe.skipIf(!available)('host state synchronisation', () => {
  let app: FastifyInstance;
  let sockets: ReturnType<typeof attachSocketIO>;
  let url = '';
  let cookie = '';
  let otherCookie = '';
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
      username: 'hostsync',
      password: 'correct-horse-battery',
      role: 'TRAINER',
    });
    quizId = (await createQuiz(owner.id, QUIZ)).id;

    // A second host, to prove a game belongs to its owner.
    await createUser({
      username: 'otherhost',
      password: 'correct-horse-battery',
      role: 'TRAINER',
    });

    cookie = await loginCookie('hostsync');
    otherCookie = await loginCookie('otherhost');
  });

  afterAll(async () => {
    for (const socket of open) socket.disconnect();
    // Let the `disconnect` handlers finish before the tables are truncated, so
    // the teardown does not race a `setPlayerConnected` against a deleted row.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await sockets.close();
    await app.close();
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  /** Log in over HTTP and return the session cookie header value. */
  async function loginCookie(username: string): Promise<string> {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: 'correct-horse-battery' },
    });
    const setCookie = login.headers['set-cookie'];
    return (Array.isArray(setCookie) ? setCookie[0]! : String(setCookie)).split(';')[0]!;
  }

  /** Connect a socket and track it for cleanup. */
  function openSocket(namespace = '', options: Record<string, unknown> = {}): Socket {
    const socket = connect(`${url}${namespace}`, {
      transports: ['websocket'],
      forceNew: true,
      ...options,
    });
    open.push(socket);
    return socket;
  }

  /** A fresh, authenticated host socket. */
  async function hostSocket(session = cookie): Promise<Socket> {
    const socket = openSocket('/host', { extraHeaders: { cookie: session } });
    await once(socket, 'connect');
    return socket;
  }

  /** Create a game and return its id, PIN and the owning socket. */
  async function createGame(session = cookie): Promise<{
    host: Socket;
    gameId: string;
    pin: string;
  }> {
    const host = await hostSocket(session);
    const state = await request<HostState>(host, 'host:create', { quizId });
    return { host, gameId: state.gameId, pin: state.pin };
  }

  /** Join one player by PIN and return their reconnect credentials. */
  async function joinPlayer(pin: string, nickname: string) {
    const socket = openSocket();
    await once(socket, 'connect');
    const joined = await request<{ playerId: string; token: string }>(socket, 'player:join', {
      pin,
      nickname,
    });
    return { socket, ...joined };
  }

  it('A – restores PIN and roster when the host reconnects in the lobby', async () => {
    const { host, gameId, pin } = await createGame();
    await joinPlayer(pin, 'Ada');
    await joinPlayer(pin, 'Bob');

    // A second host socket, as a browser reload would create.
    const reloaded = await hostSocket();
    const state = await request<HostState>(reloaded, 'host:join', { gameId });

    expect(state.phase).toBe('lobby');
    expect(state.pin).toBe(pin);
    expect(state.gameId).toBe(gameId);
    expect(state.players?.map((player) => player.nickname).sort()).toEqual(['Ada', 'Bob']);
    // Start is available, and nothing else.
    expect(state.question).toBeNull();
    expect(state.reveal).toBeNull();
    expect(state.podium).toBeNull();

    host.disconnect();
    reloaded.disconnect();
  }, 20_000);

  it('B – restores the open question without restarting the countdown', async () => {
    const { host, gameId, pin } = await createGame();
    await joinPlayer(pin, 'Ada');

    await request(host, 'host:start', { gameId });
    const before = await request<HostState>(host, 'host:join', { gameId });
    expect(before.phase).toBe('question');
    expect(before.question?.id).toBe(QUIZ.questions[0]!.id);

    // The reconnect happens a moment later; `openedAt` must be the original, so
    // the remaining time keeps running down instead of resetting to the limit.
    await new Promise((resolve) => setTimeout(resolve, 60));
    const reloaded = await hostSocket();
    const after = await request<HostState>(reloaded, 'host:join', { gameId });

    expect(after.phase).toBe('question');
    expect(after.question?.openedAt).toBe(before.question?.openedAt);
    expect(after.question?.openedAt).toBeLessThanOrEqual(Date.now());
    // The solution is never present while the question is open.
    expect(JSON.stringify(after)).not.toContain('correctIndex');
    expect(after.answers).toEqual({ answered: 0, total: 1 });

    host.disconnect();
    reloaded.disconnect();
  }, 20_000);

  it('C – restores the reveal with its solution and distribution', async () => {
    const { host, gameId, pin } = await createGame();
    const ada = await joinPlayer(pin, 'Ada');

    await request(host, 'host:start', { gameId });
    const question = await request<HostState>(host, 'host:join', { gameId });
    await request(ada.socket, 'player:answer', {
      questionId: question.question!.id,
      answer: 0,
    });
    await request(host, 'host:reveal', { gameId });

    const reloaded = await hostSocket();
    const state = await request<HostState>(reloaded, 'host:join', { gameId });

    expect(state.phase).toBe('reveal');
    expect(state.reveal?.question.id).toBe(QUIZ.questions[0]!.id);
    // The host may see the solution — but only now.
    expect(state.reveal?.question.correctIndex).toBe(0);
    expect(state.reveal?.distribution).toEqual({ '0': 1 });
    expect(state.answers).toEqual({ answered: 1, total: 1 });

    host.disconnect();
    reloaded.disconnect();
    ada.socket.disconnect();
  }, 20_000);

  it('D – restores the leaderboard in the board phase', async () => {
    const { host, gameId, pin } = await createGame();
    const ada = await joinPlayer(pin, 'Ada');
    const bob = await joinPlayer(pin, 'Bob');

    await request(host, 'host:start', { gameId });
    const question = await request<HostState>(host, 'host:join', { gameId });
    await request(ada.socket, 'player:answer', { questionId: question.question!.id, answer: 0 });
    await request(bob.socket, 'player:answer', { questionId: question.question!.id, answer: 1 });
    await request(host, 'host:reveal', { gameId });
    await request(host, 'host:board', { gameId });

    const reloaded = await hostSocket();
    const state = await request<HostState>(reloaded, 'host:join', { gameId });

    expect(state.phase).toBe('board');
    expect(state.players?.map((player) => player.nickname)).toEqual(['Ada', 'Bob']);
    expect(state.players![0]!.score).toBeGreaterThan(0);

    host.disconnect();
    reloaded.disconnect();
    ada.socket.disconnect();
    bob.socket.disconnect();
  }, 20_000);

  it('E – restores the final ranking after the game has ended', async () => {
    const { host, gameId, pin } = await createGame();
    const ada = await joinPlayer(pin, 'Ada');

    await request(host, 'host:start', { gameId });
    await request(host, 'host:end', { gameId });

    const reloaded = await hostSocket();
    const state = await request<HostState>(reloaded, 'host:join', { gameId });

    expect(state.phase).toBe('end');
    expect(state.players?.map((player) => player.nickname)).toEqual(['Ada']);
    expect(state.podium?.map((player) => player.nickname)).toEqual(['Ada']);
    // No game transition is available after the end.
    expect(state.question).toBeNull();
    expect(state.reveal).toBeNull();

    host.disconnect();
    reloaded.disconnect();
    ada.socket.disconnect();
  }, 20_000);

  it('H – refuses the host state to a socket without a session', async () => {
    const anonymous = openSocket('/host');
    const error = await once<Error>(anonymous, 'connect_error');
    expect(error.message).toContain('unauthorized');
  }, 15_000);

  it('H – refuses the host state to a different host', async () => {
    const { host, gameId } = await createGame();
    const intruder = await hostSocket(otherCookie);

    await expect(request(intruder, 'host:join', { gameId })).rejects.toThrow(/another host/i);

    host.disconnect();
    intruder.disconnect();
  }, 20_000);

  it('H – never lists the host as a player', async () => {
    const { host, gameId, pin } = await createGame();
    await joinPlayer(pin, 'Ada');

    const state = await request<HostState>(host, 'host:join', { gameId });
    expect(state.players).toHaveLength(1);
    expect(state.players![0]!.nickname).toBe('Ada');

    // The host account never appears in the stored player rows either.
    const rows = await prisma.gamePlayer.findMany({ where: { gameId } });
    expect(rows).toHaveLength(1);

    host.disconnect();
  }, 20_000);

  it('H – rejects a manipulated game id', async () => {
    const host = await hostSocket();
    await expect(
      request(host, 'host:join', { gameId: '00000000-0000-4000-8000-00000000dead' }),
    ).rejects.toThrow(/not found/i);
    host.disconnect();
  }, 15_000);

  it('I – keeps the phase lock: a finished game stays finished under a racing reveal', async () => {
    // Regression guard for PR #29: the fire-and-forget auto-reveal must never
    // overwrite an `end`. Run it repeatedly, because a single pass can win by luck.
    for (let round = 0; round < 40; round += 1) {
      const { host, gameId, pin } = await createGame();
      const ada = await joinPlayer(pin, 'Ada');

      await request(host, 'host:start', { gameId });
      const question = await request<HostState>(host, 'host:join', { gameId });

      // Answer and end in the same tick: the answer triggers the auto-reveal.
      await Promise.all([
        request(ada.socket, 'player:answer', { questionId: question.question!.id, answer: 0 }),
        request(host, 'host:end', { gameId }),
      ]);

      const row = await prisma.game.findUnique({ where: { id: gameId } });
      expect(row!.phase).toBe('end');
      expect(row!.endedAt).not.toBeNull();

      host.disconnect();
      ada.socket.disconnect();
    }
  }, 60_000);
});
