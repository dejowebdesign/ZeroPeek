/**
 * End-to-end realtime test: host + two players over real Socket.IO.
 *
 * Skipped automatically when no database is reachable (see testing/db.ts).
 * This is the test that proves the whole realtime path works together: host
 * authentication from the session cookie, PIN join, lobby broadcast, the
 * question/reveal/board/end sequence, per-player private results and
 * server-computed scores.
 */

import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { io as connect, type Socket } from 'socket.io-client';

import type { Quiz } from '@zeropeek/shared';

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
  id: '00000000-0000-4000-8000-0000000000f1',
  title: 'Realtime test',
  description: '',
  theme: 'standard',
  defaultTimeLimit: 20,
  questions: [
    {
      id: '00000000-0000-4000-8000-0000000000f2',
      type: 'single',
      text: 'Capital of France?',
      timeLimit: 20,
      points: 'standard',
      options: ['Paris', 'Rome'],
      correctIndex: 0,
    },
  ],
};

describe.skipIf(!available)('realtime end-to-end', () => {
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
      username: 'realtimehost',
      password: 'correct-horse-battery',
      role: 'TRAINER',
    });
    quizId = (await createQuiz(owner.id, QUIZ)).id;

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'realtimehost', password: 'correct-horse-battery' },
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
    // Keep a record of connection errors so `await once(socket, 'connect')`
    // fails with the real reason instead of a bare timeout.
    socket.on('connect_error', (error: Error) => {
      // eslint-disable-next-line no-console
      console.error(`[realtime] connect_error on "${namespace || '/'}": ${error.message}`);
    });
    open.push(socket);
    return socket;
  }

  it('runs a full game from the lobby to the final ranking', async () => {
    // Host authenticates from the session cookie.
    const host = openSocket('/host', { extraHeaders: { cookie } });
    await once(host, 'connect');

    const { gameId, pin } = await request<{ gameId: string; pin: string }>(host, 'host:create', {
      quizId,
    });
    expect(pin).toMatch(/^[234679ACDEFGHJKMNPQRTUVWXYZ]{6}$/);

    // Two players join by PIN.
    const ada = openSocket();
    const bob = openSocket();
    await Promise.all([once(ada, 'connect'), once(bob, 'connect')]);

    const adaJoin = await request<{ playerId: string; token: string }>(ada, 'player:join', {
      pin,
      nickname: 'Ada',
    });
    // The lobby is broadcast on every join, so listen only for Bob's, which is
    // the one that contains both players.
    const lobbySeen = once<{ players: unknown[] }>(host, 'host:lobby');
    await request(bob, 'player:join', { pin, nickname: 'Bob' });
    const lobby = await lobbySeen;
    expect(lobby.players).toHaveLength(2);

    // The host starts the game; both players receive the public question.
    const adaQuestion = once<{ id: string }>(ada, 'game:question');
    const bobQuestion = once<{ id: string }>(bob, 'game:question');
    await request(host, 'host:start', { gameId });
    const question = await adaQuestion;
    await bobQuestion;
    expect(question.id).toBe(QUIZ.questions[0]!.id);
    // The solution must never reach a player.
    expect(JSON.stringify(question)).not.toContain('correctIndex');

    const adaResult = once<{ result: { outcome: string; points: number } }>(ada, 'game:reveal');
    const bobResult = once<{ result: { outcome: string; points: number } }>(bob, 'game:reveal');

    // Ada answers correctly. With Bob still to answer the question stays open,
    // so a duplicate from Ada is rejected as such.
    await request(ada, 'player:answer', { questionId: question.id, answer: 0 });
    await expect(
      request(ada, 'player:answer', { questionId: question.id, answer: 0 }),
    ).rejects.toThrow(/already answered/i);

    // Bob answers wrongly; that is the last outstanding answer, so the engine
    // reveals automatically and both players receive their private result.
    await request(bob, 'player:answer', { questionId: question.id, answer: 1 });
    expect((await adaResult).result.outcome).toBe('correct');
    expect((await adaResult).result.points).toBeGreaterThan(0);
    expect((await bobResult).result.outcome).toBe('wrong');

    // A host-triggered reveal is idempotent after the automatic one.
    await request(host, 'host:reveal', { gameId });

    // Scores are computed and stored on the server.
    const storedAda = await prisma.gamePlayer.findUnique({ where: { id: adaJoin.playerId } });
    expect(storedAda!.score).toBeGreaterThan(0);

    // The board ranks Ada above Bob.
    const board = once<{ players: Array<{ nickname: string }> }>(host, 'host:board');
    await request(host, 'host:board', { gameId });
    expect((await board).players[0]!.nickname).toBe('Ada');

    // Reconnecting with the stored token reclaims the same player slot and now
    // returns the authoritative state for the phase the game is actually in.
    const rejoined = await request<{ phase: string; board: unknown[] | null }>(
      ada,
      'player:rejoin',
      {
        gameId,
        playerId: adaJoin.playerId,
        token: adaJoin.token,
      },
    );
    expect(rejoined.phase).toBe('board');
    expect(Array.isArray(rejoined.board)).toBe(true);

    // The game ends.
    const ended = once<{ players: Array<{ nickname: string }> }>(host, 'host:ended');
    await request(host, 'host:end', { gameId });
    expect((await ended).players[0]!.nickname).toBe('Ada');
    expect((await prisma.game.findUnique({ where: { id: gameId } }))!.phase).toBe('end');
  }, 30_000);

  it('rejects a host socket without a session', async () => {
    const anonymous = openSocket('/host');
    const error = await once<Error>(anonymous, 'connect_error');
    expect(error.message).toContain('unauthorized');
  }, 15_000);

  it('rejects joining an unknown PIN', async () => {
    const player = openSocket();
    await once(player, 'connect');
    await expect(
      request(player, 'player:join', { pin: 'ZZZZZZ', nickname: 'Ghost' }),
    ).rejects.toThrow(/no game/i);
  }, 15_000);

  it('lets a guest join with a nickname only, no account or e-mail', async () => {
    // Registration (Phase 6.3) is entirely optional: joining a game must still
    // work with nothing but a nickname, and must not ask for an e-mail.
    const host = openSocket('/host', { extraHeaders: { cookie } });
    await once(host, 'connect');
    const { pin } = await request<{ gameId: string; pin: string }>(host, 'host:create', { quizId });

    const guest = openSocket();
    await once(guest, 'connect');
    const joined = await request<{ playerId: string; token: string }>(guest, 'player:join', {
      pin,
      nickname: 'Guest',
    });
    expect(joined.playerId).toBeTruthy();
    expect(joined.token).toBeTruthy();
  }, 15_000);
});
