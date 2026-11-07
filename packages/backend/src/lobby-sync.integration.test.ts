/**
 * Lobby synchronisation and game start, over real Socket.IO (bugfix).
 *
 * Covers the phase brief's scenarios 1–15: a player join must be visible to the
 * host immediately, must never be lost to a concurrent join, and must never race
 * the host's `start` into leaving the host on a stale lobby whose "Start game"
 * the engine then rejects with "The game has already started."
 *
 * Skipped automatically when no database is reachable (see testing/db.ts).
 */

import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { io as connect, type Socket } from 'socket.io-client';

import type { HostState, PublicPlayer, Quiz } from '@zeropeek/shared';

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

/** Give the event loop a moment for the last broadcasts to arrive. */
const settle = (ms = 80): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const QUIZ: Quiz = {
  id: '00000000-0000-4000-8000-0000000000c1',
  title: 'Lobby sync test',
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
    {
      id: '00000000-0000-4000-8000-0000000000c3',
      type: 'single',
      text: 'Capital of Italy?',
      timeLimit: 30,
      points: 'standard',
      options: ['Paris', 'Rome'],
      correctIndex: 1,
    },
  ],
};

describe.skipIf(!available)('lobby synchronisation and game start', () => {
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
      username: 'lobbysync',
      password: 'correct-horse-battery',
      role: 'TRAINER',
    });
    quizId = (await createQuiz(owner.id, QUIZ)).id;

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'lobbysync', password: 'correct-horse-battery' },
    });
    const setCookie = login.headers['set-cookie'];
    cookie = (Array.isArray(setCookie) ? setCookie[0]! : String(setCookie)).split(';')[0]!;
  });

  afterAll(async () => {
    for (const socket of open) socket.disconnect();
    await settle(50);
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
      console.error(`[lobby] connect_error on "${namespace || '/'}": ${error.message}`);
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
  async function createGame(): Promise<{ host: Socket; gameId: string; pin: string }> {
    const host = await hostSocket();
    const state = await request<HostState>(host, 'host:create', { quizId });
    return { host, gameId: state.gameId, pin: state.pin };
  }

  /** Connect an anonymous player socket. */
  async function playerSocket(): Promise<Socket> {
    const socket = openSocket();
    await once(socket, 'connect');
    return socket;
  }

  /** Join one player by PIN and return their reconnect credentials. */
  async function joinPlayer(pin: string, nickname: string) {
    const socket = await playerSocket();
    const joined = await request<{ playerId: string; gameId: string; token: string }>(
      socket,
      'player:join',
      { pin, nickname },
    );
    return { socket, ...joined };
  }

  /** Record every payload of an event on a socket, in arrival order. */
  function collect<T>(socket: Socket, event: string): T[] {
    const seen: T[] = [];
    socket.on(event, (payload: T) => seen.push(payload));
    return seen;
  }

  /** The host's authoritative roster for a game. */
  async function roster(host: Socket, gameId: string): Promise<PublicPlayer[]> {
    const state = await request<HostState>(host, 'host:join', { gameId });
    return state.players ?? [];
  }

  it('1 – the host creates a lobby in the lobby phase', async () => {
    const { host, gameId, pin } = await createGame();
    const state = await request<HostState>(host, 'host:join', { gameId });
    expect(state.phase).toBe('lobby');
    expect(state.pin).toBe(pin);
    expect(state.players).toEqual([]);
    host.disconnect();
  }, 20_000);

  it('2 – one player joins and appears in the host roster', async () => {
    const { host, gameId, pin } = await createGame();
    const lobbySeen = once<{ players: PublicPlayer[] }>(host, 'host:lobby');
    await joinPlayer(pin, 'Ada');

    const lobby = await lobbySeen;
    expect(lobby.players.map((player) => player.nickname)).toEqual(['Ada']);
    expect((await roster(host, gameId)).map((player) => player.nickname)).toEqual(['Ada']);
    host.disconnect();
  }, 20_000);

  it('3 – several players joining one after another are all shown', async () => {
    const { host, gameId, pin } = await createGame();
    for (const name of ['Ada', 'Bob', 'Cleo']) await joinPlayer(pin, name);
    await settle();

    const names = (await roster(host, gameId)).map((player) => player.nickname).sort();
    expect(names).toEqual(['Ada', 'Bob', 'Cleo']);
    host.disconnect();
  }, 20_000);

  it('4 – several players joining at the same time lose nobody', async () => {
    const { host, gameId, pin } = await createGame();
    const names = ['Ada', 'Bob', 'Cleo', 'Dana', 'Eve', 'Finn'];
    const players = await Promise.all(names.map(() => playerSocket()));
    await Promise.all(
      players.map((socket, index) =>
        request(socket, 'player:join', { pin, nickname: names[index] }),
      ),
    );
    await settle();

    const got = (await roster(host, gameId)).map((player) => player.nickname).sort();
    expect(got).toEqual([...names].sort());
    host.disconnect();
  }, 20_000);

  it('5 – the host can start the game after a player has joined', async () => {
    const { host, gameId, pin } = await createGame();
    const ada = await joinPlayer(pin, 'Ada');

    const questionSeen = once<{ id: string }>(ada.socket, 'game:question');
    const started = await request<{ phase: string }>(host, 'host:start', { gameId });
    expect(started.phase).toBe('question');
    expect((await questionSeen).id).toBe(QUIZ.questions[0]!.id);

    const state = await request<HostState>(host, 'host:join', { gameId });
    expect(state.phase).toBe('question');
    expect(state.question?.id).toBe(QUIZ.questions[0]!.id);
    host.disconnect();
  }, 20_000);

  it('6 – a join that races the start leaves a consistent state', async () => {
    const { host, gameId, pin } = await createGame();
    await joinPlayer(pin, 'Ada');

    const events = collect<unknown>(host, 'host:question');
    const late = await playerSocket();
    const results = await Promise.allSettled([
      request(host, 'host:start', { gameId }),
      request(late, 'player:join', { pin, nickname: 'Bob' }),
    ]);
    await settle();

    // The game must have started, exactly once.
    const state = await request<HostState>(host, 'host:join', { gameId });
    expect(state.phase).toBe('question');
    expect(events).toHaveLength(1);

    // Either Bob got in before the start (and is in the roster) or he was
    // rejected as too late — never a half-join. And a rejected join must not
    // leave a phantom row behind.
    const bobRow = await prisma.gamePlayer.findFirst({ where: { gameId, nickname: 'Bob' } });
    const bobInRoster = (state.players ?? []).some((player) => player.nickname === 'Bob');
    expect(bobInRoster).toBe(results[1]!.status === 'fulfilled');
    expect(Boolean(bobRow)).toBe(bobInRoster);
    host.disconnect();
  }, 20_000);

  it('7 – a host refresh restores the roster', async () => {
    const { host, gameId, pin } = await createGame();
    await joinPlayer(pin, 'Ada');
    await joinPlayer(pin, 'Bob');

    const reloaded = await hostSocket();
    const names = (await roster(reloaded, gameId)).map((player) => player.nickname).sort();
    expect(names).toEqual(['Ada', 'Bob']);
    host.disconnect();
    reloaded.disconnect();
  }, 20_000);

  it('8 – a host reconnect receives the full state', async () => {
    const { host, gameId, pin } = await createGame();
    await joinPlayer(pin, 'Ada');
    host.disconnect();

    const reconnected = await hostSocket();
    const state = await request<HostState>(reconnected, 'host:join', { gameId });
    expect(state.phase).toBe('lobby');
    expect(state.pin).toBe(pin);
    expect(state.players?.map((player) => player.nickname)).toEqual(['Ada']);
    reconnected.disconnect();
  }, 20_000);

  it('9 – a player refresh does not create a duplicate participant', async () => {
    const { host, gameId, pin } = await createGame();
    const ada = await joinPlayer(pin, 'Ada');

    // A reload reclaims the same slot with the stored credentials.
    const reloaded = await playerSocket();
    const sync = await request<{ phase: string }>(reloaded, 'player:rejoin', {
      gameId,
      playerId: ada.playerId,
      token: ada.token,
    });
    expect(sync.phase).toBe('lobby');

    const rows = await prisma.gamePlayer.findMany({ where: { gameId, nickname: 'Ada' } });
    expect(rows).toHaveLength(1);
    expect((await roster(host, gameId)).map((player) => player.nickname)).toEqual(['Ada']);
    host.disconnect();
  }, 20_000);

  it('10 – a player reconnect restores the correct state', async () => {
    const { host, gameId, pin } = await createGame();
    const ada = await joinPlayer(pin, 'Ada');
    await request(host, 'host:start', { gameId });

    const reconnected = await playerSocket();
    const sync = await request<{ phase: string; question: { id: string } | null }>(
      reconnected,
      'player:rejoin',
      { gameId, playerId: ada.playerId, token: ada.token },
    );
    expect(sync.phase).toBe('question');
    expect(sync.question?.id).toBe(QUIZ.questions[0]!.id);
    host.disconnect();
  }, 20_000);

  it('11 – an already started game syncs the running phase, not the lobby', async () => {
    const { host, gameId, pin } = await createGame();
    await joinPlayer(pin, 'Ada');
    await request(host, 'host:start', { gameId });

    const reloaded = await hostSocket();
    const state = await request<HostState>(reloaded, 'host:join', { gameId });
    expect(state.phase).toBe('question');
    expect(state.question?.id).toBe(QUIZ.questions[0]!.id);
    // The solution must never be present while the question is open.
    expect(JSON.stringify(state)).not.toContain('correctIndex');
    host.disconnect();
    reloaded.disconnect();
  }, 20_000);

  it('12 – a double start does not initialise the game twice', async () => {
    const { host, gameId, pin } = await createGame();
    const ada = await joinPlayer(pin, 'Ada');
    const questions = collect<unknown>(ada.socket, 'game:question');

    const first = await request<{ phase: string }>(host, 'host:start', { gameId });
    expect(first.phase).toBe('question');
    await expect(request(host, 'host:start', { gameId })).rejects.toThrow(/already started/i);
    await settle();

    expect(questions).toHaveLength(1);
    expect(await prisma.gameSnapshot.count({ where: { gameId } })).toBe(1);
    host.disconnect();
  }, 20_000);

  it('13 – no lobby event reaches the host after the game has started', async () => {
    const { host, gameId, pin } = await createGame();
    const timeline: string[] = [];
    host.on('host:lobby', () => timeline.push('lobby'));
    host.on('host:question', () => timeline.push('question'));

    await joinPlayer(pin, 'Ada');
    await request(host, 'host:start', { gameId });
    // A player joining a started game is refused, and must not produce a lobby.
    const late = await playerSocket();
    await expect(request(late, 'player:join', { pin, nickname: 'Bob' })).rejects.toThrow(
      /already started/i,
    );
    await settle();

    const firstQuestion = timeline.indexOf('question');
    expect(firstQuestion).toBeGreaterThanOrEqual(0);
    // Nothing after the first question may be a lobby broadcast.
    expect(timeline.slice(firstQuestion)).not.toContain('lobby');
    host.disconnect();
  }, 20_000);

  it('14 – an unknown game id is rejected', async () => {
    const host = await hostSocket();
    await expect(
      request(host, 'host:join', { gameId: '00000000-0000-4000-8000-0000000000ff' }),
    ).rejects.toThrow(/not found/i);
    host.disconnect();
  }, 20_000);

  it('15 – host and several players stay consistent', async () => {
    const { host, gameId, pin } = await createGame();
    const ada = await joinPlayer(pin, 'Ada');
    const bob = await joinPlayer(pin, 'Bob');

    const adaQuestion = once<{ id: string }>(ada.socket, 'game:question');
    const bobQuestion = once<{ id: string }>(bob.socket, 'game:question');
    await request(host, 'host:start', { gameId });
    expect((await adaQuestion).id).toBe(QUIZ.questions[0]!.id);
    expect((await bobQuestion).id).toBe(QUIZ.questions[0]!.id);

    // Both players and the host agree on the phase and the roster size.
    const hostState = await request<HostState>(host, 'host:join', { gameId });
    const adaSync = await request<{ phase: string; board: PublicPlayer[] | null }>(
      ada.socket,
      'player:rejoin',
      { gameId, playerId: ada.playerId, token: ada.token },
    );
    const bobSync = await request<{ phase: string }>(bob.socket, 'player:rejoin', {
      gameId,
      playerId: bob.playerId,
      token: bob.token,
    });
    expect(hostState.phase).toBe('question');
    expect(adaSync.phase).toBe('question');
    expect(bobSync.phase).toBe('question');
    expect(hostState.answers).toEqual({ answered: 0, total: 2 });
    host.disconnect();
  }, 20_000);
});
