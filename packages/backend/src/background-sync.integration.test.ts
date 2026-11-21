/**
 * Round background synchronisation (Phase 6.10).
 *
 * The brief's requirements for this phase are all about agreement: the host picks
 * a background, the server owns it, and the host, the beamer and every player see
 * the same one — including after a reconnect. These tests drive the real engine
 * over real Socket.IO, so they prove the behaviour rather than a mock of it.
 *
 * Skipped automatically when no database is reachable (see testing/db.ts).
 */

import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { io as connect, type Socket } from 'socket.io-client';

import {
  BACKGROUND_CATALOGUE,
  BACKGROUND_IDS,
  DEFAULT_BACKGROUND_ID,
  RANDOM_BACKGROUND,
  type HostState,
  type PlayerSync,
  type Quiz,
} from '@zeropeek/shared';

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

/** Emit and expect the ACK to be an error, returning its message. */
function requestError(socket: Socket, event: string, payload: unknown): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    socket.emit(event, payload, (reply: { ok: boolean; error?: string }) => {
      if (reply?.ok) reject(new Error(`expected "${event}" to fail, but it succeeded`));
      else resolve(reply?.error ?? '');
    });
  });
}

const settle = (ms = 80): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const QUIZ: Quiz = {
  id: '00000000-0000-4000-8000-0000000001a1',
  title: 'Background test',
  description: '',
  theme: 'standard',
  defaultTimeLimit: 30,
  questions: [
    {
      id: '00000000-0000-4000-8000-0000000001a2',
      type: 'single',
      text: 'Capital of France?',
      timeLimit: 30,
      points: 'standard',
      options: ['Paris', 'Rome'],
      correctIndex: 0,
    },
  ],
};

describe.skipIf(!available)('round background synchronisation', () => {
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
      username: 'bgowner',
      password: 'correct-horse-battery',
      role: 'TRAINER',
    });
    quizId = (await createQuiz(owner.id, QUIZ)).id;

    // A second host, to prove only the owning host may change the background.
    await createUser({
      username: 'bgother',
      password: 'correct-horse-battery',
      role: 'TRAINER',
    });

    cookie = await loginCookie('bgowner');
    otherCookie = await loginCookie('bgother');
  });

  afterAll(async () => {
    for (const socket of open) socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await sockets.close();
    await app.close();
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  async function loginCookie(username: string): Promise<string> {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: 'correct-horse-battery' },
    });
    const setCookie = login.headers['set-cookie'];
    return (Array.isArray(setCookie) ? setCookie[0]! : String(setCookie)).split(';')[0]!;
  }

  function openSocket(namespace = '', options: Record<string, unknown> = {}): Socket {
    const socket = connect(`${url}${namespace}`, {
      transports: ['websocket'],
      forceNew: true,
      ...options,
    });
    open.push(socket);
    return socket;
  }

  async function hostSocket(session = cookie): Promise<Socket> {
    const socket = openSocket('/host', { extraHeaders: { cookie: session } });
    await once(socket, 'connect');
    return socket;
  }

  async function createGame(session = cookie): Promise<{
    host: Socket;
    gameId: string;
    pin: string;
    state: HostState;
  }> {
    const host = await hostSocket(session);
    const state = await request<HostState>(host, 'host:create', { quizId });
    return { host, gameId: state.gameId, pin: state.pin, state };
  }

  async function joinPlayer(pin: string, nickname: string) {
    const socket = openSocket();
    await once(socket, 'connect');
    const joined = await request<{ playerId: string; token: string }>(socket, 'player:join', {
      pin,
      nickname,
    });
    return { socket, ...joined };
  }

  it('1 – a new game starts on a background from the supplied catalogue', async () => {
    const { host, state } = await createGame();
    expect(BACKGROUND_IDS).toContain(state.background);
    // The picture is concrete, but the carousel starts on the Random position
    // (Phase 6.14) — the two values are deliberately different.
    expect(state.backgroundChoice).toBe(RANDOM_BACKGROUND);
    host.disconnect();
  }, 20_000);

  it('2 – the host can select any supplied background, and the ACK echoes it', async () => {
    const { host, gameId } = await createGame();

    // Every supplied background must be selectable, not just a subset.
    for (const id of BACKGROUND_IDS) {
      const ack = await request<{ background: string; choice: string }>(host, 'host:background', {
        gameId,
        background: id,
      });
      expect(ack.background).toBe(id);
      // A concrete pick moves the carousel onto that entry.
      expect(ack.choice).toBe(id);
    }

    const state = await request<HostState>(host, 'host:join', { gameId });
    expect(state.background).toBe(BACKGROUND_IDS.at(-1));

    host.disconnect();
  }, 20_000);

  it('3 – a random choice resolves to exactly one catalogue id and is then fixed', async () => {
    const { host, gameId } = await createGame();

    const first = await request<{ background: string; choice: string }>(host, 'host:background', {
      gameId,
      background: RANDOM_BACKGROUND,
    });
    // The sentinel must never be stored as the image: the host receives a
    // concrete id, while the carousel position stays Random.
    expect(BACKGROUND_IDS).toContain(first.background);
    expect(first.choice).toBe(RANDOM_BACKGROUND);

    // Re-selecting the *image* is a no-op: the random pick happened once, so
    // nothing re-rolls behind the host's back.
    const again = await request<{ background: string; choice: string }>(host, 'host:background', {
      gameId,
      background: first.background,
    });
    expect(again.background).toBe(first.background);

    // The position follows the *choice* the host sent: re-selecting the image
    // puts the carousel on that entry, which is what the host now sees.
    const state = await request<HostState>(host, 'host:join', { gameId });
    expect(state.background).toBe(first.background);
    expect(state.backgroundChoice).toBe(first.background);

    host.disconnect();
  }, 20_000);

  it('4 – every client receives the same background, including on the live event', async () => {
    const { host, gameId, pin, state: created } = await createGame();
    const ada = await joinPlayer(pin, 'Ada');
    const bob = await joinPlayer(pin, 'Bob');

    // Two player sockets plus the host all observe the change.
    const adaEvent = once<{ background: string; choice: string }>(ada.socket, 'game:background');
    const bobEvent = once<{ background: string; choice: string }>(bob.socket, 'game:background');
    const hostEvent = once<{ background: string; choice: string }>(host, 'host:background');

    const target = BACKGROUND_IDS.find((id) => id !== created.background)!;
    await request(host, 'host:background', { gameId, background: target });

    expect((await hostEvent).background).toBe(target);
    expect((await adaEvent).background).toBe(target);
    expect((await bobEvent).background).toBe(target);
    // The carousel position rides along, so every screen labels it the same way.
    expect((await adaEvent).choice).toBe(target);

    // And the authoritative snapshots agree with the broadcast.
    const hostState = await request<HostState>(host, 'host:join', { gameId });
    const adaSync = await request<PlayerSync>(ada.socket, 'player:rejoin', {
      gameId,
      playerId: ada.playerId,
      token: ada.token,
    });
    expect(hostState.background).toBe(target);
    expect(adaSync.background).toBe(target);

    host.disconnect();
  }, 20_000);

  it('5 – a reconnecting client is restored to the current background', async () => {
    const { host, gameId, pin } = await createGame();
    const ada = await joinPlayer(pin, 'Ada');

    const target = 'synthwave_wueste';
    await request(host, 'host:background', { gameId, background: target });
    await settle();

    // A fresh host socket (a browser reload) and a fresh player socket.
    const reloaded = await hostSocket();
    const reloadedState = await request<HostState>(reloaded, 'host:join', { gameId });
    expect(reloadedState.background).toBe(target);

    const freshPlayer = openSocket();
    await once(freshPlayer, 'connect');
    const sync = await request<PlayerSync>(freshPlayer, 'player:rejoin', {
      gameId,
      playerId: ada.playerId,
      token: ada.token,
    });
    expect(sync.background).toBe(target);

    host.disconnect();
    reloaded.disconnect();
  }, 20_000);

  it('6 – the choice survives an engine restart, because it is in the event log', async () => {
    const { host, gameId } = await createGame();
    const target = 'synthwave_megacity_detail';
    await request(host, 'host:background', { gameId, background: target });

    // Drop the in-memory runtime, so the next read rebuilds it from the database
    // exactly as a fresh process after a restart would.
    engine.evict(gameId);

    const reloaded = await hostSocket();
    const state = await request<HostState>(reloaded, 'host:join', { gameId });
    expect(state.background).toBe(target);
    // The carousel position is in the same event, so the picker comes back on the
    // entry the host chose rather than on Random (Phase 6.14).
    expect(state.backgroundChoice).toBe(target);

    host.disconnect();
    reloaded.disconnect();
  }, 20_000);

  it('7 – the background does not change on a join, a start or a question change', async () => {
    const { host, gameId, pin } = await createGame();
    const target = 'synthwave_skyline';
    await request(host, 'host:background', { gameId, background: target });

    // A join, the start countdown and the first question must all leave it alone:
    // the concept forbids a new background per join or per question.
    await joinPlayer(pin, 'Ada');
    await request(host, 'host:start', { gameId });
    const inLead = await request<HostState>(host, 'host:join', { gameId });
    expect(inLead.background).toBe(target);

    await request(host, 'host:skipLead', { gameId });
    const inQuestion = await request<HostState>(host, 'host:join', { gameId });
    expect(inQuestion.phase).toBe('question');
    expect(inQuestion.background).toBe(target);

    host.disconnect();
  }, 20_000);

  it('8 – an unknown background id is rejected and the value is left alone', async () => {
    const { host, gameId, state: created } = await createGame();

    const message = await requestError(host, 'host:background', {
      gameId,
      background: 'zeropeek_not_supplied',
    });
    expect(message).toMatch(/background/i);

    // A rejected value must not have been stored.
    const state = await request<HostState>(host, 'host:join', { gameId });
    expect(state.background).toBe(created.background);

    host.disconnect();
  }, 20_000);

  it('9 – a non-host may not change the background', async () => {
    const { host, gameId } = await createGame();

    // Another signed-in host owns no game, so the engine refuses the command.
    const other = await hostSocket(otherCookie);
    await expect(
      request(other, 'host:background', { gameId, background: 'synthwave_skyline' }),
    ).rejects.toThrow();

    const state = await request<HostState>(host, 'host:join', { gameId });
    expect(BACKGROUND_IDS).toContain(state.background);

    host.disconnect();
    other.disconnect();
  }, 20_000);

  it('10 – every catalogue entry exposes a public WebP path', async () => {
    // The public path is what the browser requests. This asserts the contract the
    // frontend layer relies on, for all ten supplied files. That the files really
    // exist and carry a WebP header is asserted in `shared/src/backgrounds.test.ts`.
    for (const entry of BACKGROUND_CATALOGUE) {
      expect(entry.path.startsWith('/backgrounds/')).toBe(true);
      expect(entry.path.endsWith('.webp')).toBe(true);
    }
    expect(BACKGROUND_CATALOGUE).toHaveLength(10);
    expect(DEFAULT_BACKGROUND_ID).toBe(BACKGROUND_IDS[0]);
  });
});
