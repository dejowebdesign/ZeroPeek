/**
 * Player reconnect / state-sync tests.
 *
 * These drive the real Socket.IO layer against a real PostgreSQL: a player
 * disconnects and rejoins, and the ACK must describe the phase the game is
 * actually in. Skipped automatically when no database is reachable (see
 * testing/db.ts). No visual or browser check is used; every assertion is on the
 * payload the server sends.
 */

import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { io as connect, type Socket } from 'socket.io-client';

import type { PlayerSync, Quiz } from '@zeropeek/shared';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './db.js';
import { attachSocketIO } from './socket.js';
import { engine } from './services/engine.js';
import { createQuiz } from './services/quizService.js';
import { createUser } from './services/userService.js';
import { canConnect, resetDatabase } from './testing/db.js';

const available = await canConnect();

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
  id: '00000000-0000-4000-8000-0000000000a1',
  title: 'Reconnect test',
  description: '',
  theme: 'standard',
  defaultTimeLimit: 30,
  questions: [
    {
      id: '00000000-0000-4000-8000-0000000000a2',
      type: 'single',
      text: 'Capital of France?',
      timeLimit: 30,
      points: 'standard',
      options: ['Paris', 'Rome', 'Madrid'],
      correctIndex: 0,
    },
    {
      id: '00000000-0000-4000-8000-0000000000a3',
      type: 'trueFalse',
      text: 'The sky is green.',
      timeLimit: 30,
      points: 'standard',
      correct: false,
    },
  ],
};

describe.skipIf(!available)('player reconnect state sync', () => {
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
      username: 'reconnecthost',
      password: 'correct-horse-battery',
      role: 'TRAINER',
    });
    quizId = (await createQuiz(owner.id, QUIZ)).id;

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'reconnecthost', password: 'correct-horse-battery' },
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
    open.push(socket);
    return socket;
  }

  /** A connected host socket that can create and drive games. */
  async function openHost(): Promise<Socket> {
    const host = openSocket('/host', { extraHeaders: { cookie } });
    await once(host, 'connect');
    return host;
  }

  interface Joined {
    socket: Socket;
    playerId: string;
    token: string;
  }

  /** Create a fresh game with the given players already in the lobby. */
  async function newGame(
    nicknames: string[],
  ): Promise<{ gameId: string; pin: string; host: Socket; players: Joined[] }> {
    const host = await openHost();
    const { gameId, pin } = await request<{ gameId: string; pin: string }>(host, 'host:create', {
      quizId,
    });
    const players: Joined[] = [];
    for (const nickname of nicknames) {
      const socket = openSocket();
      await once(socket, 'connect');
      const joined = await request<{ playerId: string; token: string }>(socket, 'player:join', {
        pin,
        nickname,
      });
      players.push({ socket, playerId: joined.playerId, token: joined.token });
    }
    return { gameId, pin, host, players };
  }

  /** Rejoin over a fresh socket, as a reload would. */
  async function rejoin(joined: Joined, gameId: string): Promise<PlayerSync> {
    const socket = openSocket();
    await once(socket, 'connect');
    joined.socket = socket;
    return request<PlayerSync>(socket, 'player:rejoin', {
      gameId,
      playerId: joined.playerId,
      token: joined.token,
    });
  }

  it('A – restores the lobby, never a running screen', async () => {
    const { gameId, players } = await newGame(['Ada', 'Bob']);
    const sync = await rejoin(players[0]!, gameId);
    expect(sync.phase).toBe('lobby');
    expect(sync.question).toBeNull();
    expect(sync.answer).toBeNull();
    // The roster is the public lobby view, and it lists both players.
    expect(sync.board?.map((entry) => entry.nickname).sort()).toEqual(['Ada', 'Bob']);
  }, 30_000);

  it('B – restores an open question without its solution, and still accepts an answer', async () => {
    const { gameId, players, host } = await newGame(['Ada', 'Bob']);
    const questionSeen = once<{ id: string }>(players[0]!.socket, 'game:question');
    await request(host, 'host:start', { gameId });
    const liveQuestion = await questionSeen;

    const sync = await rejoin(players[0]!, gameId);
    expect(sync.phase).toBe('question');
    expect(sync.question?.id).toBe(liveQuestion.id);
    expect(sync.answer?.answered).toBe(false);
    expect(sync.answer?.result).toBeNull();
    // No solution may travel before the reveal.
    expect(JSON.stringify(sync)).not.toContain('correctIndex');
    expect(JSON.stringify(sync)).not.toContain('correct');

    // The reconnecting player can still answer normally.
    const accepted = await request<{ accepted: boolean }>(players[0]!.socket, 'player:answer', {
      questionId: sync.question!.id,
      answer: 0,
    });
    expect(accepted.accepted).toBe(true);
  }, 30_000);

  it('C – after answering, reconnect shows the answer and refuses a second one', async () => {
    const { gameId, players, host } = await newGame(['Ada', 'Bob']);
    const questionSeen = once<{ id: string }>(players[0]!.socket, 'game:question');
    await request(host, 'host:start', { gameId });
    const question = await questionSeen;

    await request(players[0]!.socket, 'player:answer', { questionId: question.id, answer: 0 });
    const before = await prisma.gamePlayer.findUnique({ where: { id: players[0]!.playerId } });

    const sync = await rejoin(players[0]!, gameId);
    expect(sync.phase).toBe('question');
    expect(sync.question?.id).toBe(question.id);
    expect(sync.answer?.answered).toBe(true);
    expect(sync.answer?.answer).toBe(0);
    // The result is not revealed yet.
    expect(sync.answer?.result).toBeNull();

    // A second answer is rejected, and neither score nor time moved.
    await expect(
      request(players[0]!.socket, 'player:answer', { questionId: question.id, answer: 1 }),
    ).rejects.toThrow(/already answered/i);
    const after = await prisma.gamePlayer.findUnique({ where: { id: players[0]!.playerId } });
    expect(after!.score).toBe(before!.score);
    expect(after!.totalTimeMs).toBe(before!.totalTimeMs);
  }, 30_000);

  it('D – during reveal sends only this player’s own result', async () => {
    const { gameId, players, host } = await newGame(['Ada', 'Bob']);
    const questionSeen = once<{ id: string }>(players[0]!.socket, 'game:question');
    await request(host, 'host:start', { gameId });
    const question = await questionSeen;

    // Ada answers correctly, Bob does not answer at all.
    await request(players[0]!.socket, 'player:answer', { questionId: question.id, answer: 0 });
    await request(host, 'host:reveal', { gameId });

    const sync = await rejoin(players[0]!, gameId);
    expect(sync.phase).toBe('reveal');
    expect(sync.answer?.result?.outcome).toBe('correct');
    expect(sync.answer?.result?.points).toBeGreaterThan(0);
    expect(sync.answer?.result?.rank).toBe(1);

    // Bob's own view reports his own outcome, never Ada's answer.
    const bobSync = await rejoin(players[1]!, gameId);
    expect(bobSync.phase).toBe('reveal');
    expect(bobSync.answer?.answered).toBe(false);
    expect(bobSync.answer?.result?.outcome).toBe('unanswered');
    // No other player's answer content leaks into either payload.
    expect(JSON.stringify(bobSync)).not.toContain('"answer":0');
    expect(JSON.stringify(sync)).not.toContain('correctIndex');
  }, 30_000);

  it('E – during board returns the leaderboard, not the lobby', async () => {
    const { gameId, players, host } = await newGame(['Ada', 'Bob']);
    const questionSeen = once<{ id: string }>(players[0]!.socket, 'game:question');
    await request(host, 'host:start', { gameId });
    const question = await questionSeen;

    await request(players[0]!.socket, 'player:answer', { questionId: question.id, answer: 0 });
    await request(host, 'host:reveal', { gameId });
    await request(host, 'host:board', { gameId });

    const sync = await rejoin(players[0]!, gameId);
    expect(sync.phase).toBe('board');
    expect(sync.board?.length).toBe(2);
    expect(sync.board?.[0]?.nickname).toBe('Ada');
  }, 30_000);

  it('F – after the game ends returns the placement, not the lobby', async () => {
    const { gameId, players, host } = await newGame(['Ada', 'Bob']);
    const questionSeen = once<{ id: string }>(players[0]!.socket, 'game:question');
    await request(host, 'host:start', { gameId });
    const question = await questionSeen;

    await request(players[0]!.socket, 'player:answer', { questionId: question.id, answer: 0 });
    await request(host, 'host:end', { gameId });

    const sync = await rejoin(players[0]!, gameId);
    expect(sync.phase).toBe('end');
    expect(sync.placement?.rank).toBe(1);
    expect(sync.placement?.score).toBeGreaterThan(0);
    expect(sync.podium?.[0]?.nickname).toBe('Ada');
    expect(sync.question).toBeNull();
  }, 30_000);

  it('G – refuses a foreign slot, a wrong token and a mismatched game', async () => {
    const { gameId, players } = await newGame(['Ada', 'Bob']);
    const stranger = openSocket();
    await once(stranger, 'connect');

    // Ada's player id with Bob's token.
    await expect(
      request(stranger, 'player:rejoin', {
        gameId,
        playerId: players[0]!.playerId,
        token: players[1]!.token,
      }),
    ).rejects.toThrow(/could not be found/i);

    // A valid player id and token but a different game id.
    const other = await newGame(['Cy']);
    await expect(
      request(stranger, 'player:rejoin', {
        gameId: other.gameId,
        playerId: players[0]!.playerId,
        token: players[0]!.token,
      }),
    ).rejects.toThrow(/could not be found/i);
  }, 30_000);

  it('H – repeated reconnects add no duplicate answers or points', async () => {
    const { gameId, players, host } = await newGame(['Ada', 'Bob']);
    const questionSeen = once<{ id: string }>(players[0]!.socket, 'game:question');
    await request(host, 'host:start', { gameId });
    const question = await questionSeen;

    // Reconnect three times in a row, then answer once.
    await rejoin(players[0]!, gameId);
    await rejoin(players[0]!, gameId);
    const sync = await rejoin(players[0]!, gameId);
    expect(sync.answer?.answered).toBe(false);

    await request(players[0]!.socket, 'player:answer', { questionId: question.id, answer: 0 });
    // The stale socket from an earlier reconnect must not answer again.
    await expect(
      request(players[0]!.socket, 'player:answer', { questionId: question.id, answer: 0 }),
    ).rejects.toThrow(/already answered/i);

    const rows = await prisma.playerAnswer.findMany({
      where: { gameId, playerId: players[0]!.playerId },
    });
    expect(rows).toHaveLength(1);
    const stored = await prisma.gamePlayer.findUnique({ where: { id: players[0]!.playerId } });
    expect(stored!.score).toBe(rows[0]!.points);
  }, 30_000);

  it('I – after a restart rebuilds only what the rows support, without restarting the clock', async () => {
    const { gameId, players, host } = await newGame(['Ada', 'Bob']);
    const questionSeen = once<{ id: string; openedAt: number }>(
      players[0]!.socket,
      'game:question',
    );
    await request(host, 'host:start', { gameId });
    const question = await questionSeen;

    await request(players[0]!.socket, 'player:answer', { questionId: question.id, answer: 0 });

    // Simulate a process restart: drop the in-memory game and reload from rows.
    engine.evict(gameId);

    const sync = await rejoin(players[0]!, gameId);
    expect(sync.phase).toBe('question');
    expect(sync.question?.id).toBe(question.id);
    // The already-answered state is reconstructed from PlayerAnswer.
    expect(sync.answer?.answered).toBe(true);
    expect(sync.answer?.answer).toBe(0);
    // The clock is the original one, not a fresh Date.now(). It is recovered from
    // the persisted `question` event, so it is the same instant up to the few
    // milliseconds between arming the timer and writing the event.
    expect(Math.abs(sync.question!.openedAt - question.openedAt)).toBeLessThan(2000);
    expect(sync.question!.openedAt).toBeLessThanOrEqual(Date.now());

    // Bob, who never answered, is still able to answer after the restart.
    const bobSync = await rejoin(players[1]!, gameId);
    expect(bobSync.answer?.answered).toBe(false);
    const accepted = await request<{ accepted: boolean }>(players[1]!.socket, 'player:answer', {
      questionId: question.id,
      answer: 1,
    });
    expect(accepted.accepted).toBe(true);
  }, 30_000);

  it('J – a question whose time ran out during a restart reveals itself, not hangs', async () => {
    const { gameId, players, host } = await newGame(['Ada', 'Bob']);
    const questionSeen = once<{ id: string }>(players[0]!.socket, 'game:question');
    await request(host, 'host:start', { gameId });
    await questionSeen;

    // Backdate the open question past its limit, then simulate a restart.
    await prisma.gameEvent.updateMany({
      where: { gameId, type: 'question' },
      data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    engine.evict(gameId);

    // Force the reload; the recovery must not leave a dead, untimed question.
    await engine.get(gameId);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const row = await prisma.game.findUnique({ where: { id: gameId } });
    expect(row!.phase).toBe('reveal');
  }, 30_000);
});
