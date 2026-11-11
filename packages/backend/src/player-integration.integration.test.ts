/**
 * Player integration fixes (Phase 6.8.3) — the acceptance suite.
 *
 * Practical testing of Phase 6.6–6.8 found that a **signed-in** player was
 * treated like a guest when they joined a game:
 *
 *   1. they had to re-type a name even though they were logged in;
 *   2. the avatar they had chosen was never shown during the game;
 *   3. they were offered a "create an account" button after the round, as if
 *      the round had not been saved to their account.
 *
 * This suite drives the real Socket.IO layer against a real PostgreSQL and
 * proves the corrected behaviour end to end:
 *
 *   - a signed-in join with no nickname is seated under the account's username;
 *   - the seat carries the account's selected character as its avatar, and that
 *     avatar reaches the host roster and the player's own sync;
 *   - a guest join still works and stays an anonymous seat with no avatar;
 *   - re-joining the same game reuses the account's existing seat instead of
 *     creating a second one (so an account can never appear twice in a lobby).
 *
 * Skipped automatically when no database is reachable (see `testing/db.ts`).
 * Every assertion is on a payload, a database row or a status code — no browser,
 * no screenshot.
 */

import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { io as connect, type Socket } from 'socket.io-client';

import type { HostState, PlayerSync, PublicPlayer, Quiz } from '@zeropeek/shared';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './db.js';
import { attachSocketIO } from './socket.js';
import { createQuiz } from './services/quizService.js';
import { createUser } from './services/userService.js';
import { canConnect, resetDatabase } from './testing/db.js';

const available = await canConnect();
const PASSWORD = 'correct-horse-battery';

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
  title: 'Player integration',
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

describe.skipIf(!available)('player integration (Phase 6.8.3)', () => {
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

  /** The first `Set-Cookie` pair (`name=value`) from a response. */
  function cookiePair(response: { headers: Record<string, unknown> }): string {
    const setCookie = response.headers['set-cookie'];
    return (Array.isArray(setCookie) ? setCookie[0]! : String(setCookie)).split(';')[0]!;
  }

  /** Create a PLAYER account with a chosen character and sign it in. */
  async function playerLogin(
    username: string,
    characterId: string | null = null,
  ): Promise<{ cookie: string; id: string }> {
    const user = await createUser({ username, password: PASSWORD, role: 'PLAYER' });
    if (characterId) {
      await prisma.playerProfile.create({
        data: { userId: user.id, selectedCharacterId: characterId },
      });
    }
    const login = await app.inject({
      method: 'POST',
      url: '/api/player-auth/login',
      payload: { username, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    return { cookie: cookiePair(login), id: user.id };
  }

  /** A host creates a lobby game; returns its socket, id and pin. */
  async function createGame(): Promise<{ host: Socket; gameId: string; pin: string }> {
    const owner = await createUser({
      username: `host-${Math.random().toString(36).slice(2, 8)}`,
      password: PASSWORD,
      role: 'TRAINER',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: owner.username, password: PASSWORD },
    });
    const host = openSocket('/host', { extraHeaders: { cookie: cookiePair(login) } });
    await once(host, 'connect');
    const state = await request<HostState>(host, 'host:create', { quizId });
    return { host, gameId: state.gameId, pin: state.pin };
  }

  /** A player joins over a fresh socket, optionally presenting a cookie. */
  async function join(
    pin: string,
    payload: { nickname?: string; avatar?: string },
    cookie?: string,
  ): Promise<{
    socket: Socket;
    playerId: string;
    gameId: string;
    token: string;
    nickname: string;
    avatar: string;
  }> {
    const socket = openSocket('', cookie ? { extraHeaders: { cookie } } : {});
    await once(socket, 'connect');
    const joined = await request<{
      playerId: string;
      gameId: string;
      token: string;
      nickname: string;
      avatar: string;
    }>(socket, 'player:join', { pin, ...payload });
    return { socket, ...joined };
  }

  it('seats a signed-in player under their account name when no nickname is sent', async () => {
    const { pin } = await createGame();
    const alice = await playerLogin('alice');

    const seat = await join(pin, {}, alice.cookie);
    expect(seat.nickname).toBe('alice');
    const row = await prisma.gamePlayer.findUnique({ where: { id: seat.playerId } });
    expect(row?.nickname).toBe('alice');
    expect(row?.userId).toBe(alice.id);
  }, 20_000);

  it('seats a signed-in player with their selected character as the avatar', async () => {
    const { pin } = await createGame();
    const alice = await playerLogin('alice', 'maya');

    const seat = await join(pin, {}, alice.cookie);
    // The ACK echoes the seated avatar, so the client shows what it joined as.
    expect(seat.avatar).toBe('maya');
    const row = await prisma.gamePlayer.findUnique({ where: { id: seat.playerId } });
    expect(row?.avatar).toBe('maya');
  }, 20_000);

  it('shows the signed-in player’s avatar on the host roster', async () => {
    const { host, pin } = await createGame();
    const alice = await playerLogin('alice', 'ethan');

    const lobbySeen = once<{ players: PublicPlayer[] }>(host, 'host:lobby');
    await join(pin, {}, alice.cookie);
    const lobby = await lobbySeen;
    const seated = lobby.players.find((player) => player.nickname === 'alice');
    expect(seated?.avatar).toBe('ethan');
  }, 20_000);

  it('sends the seated avatar back on the player’s own sync', async () => {
    const { pin } = await createGame();
    const alice = await playerLogin('alice', 'maya');

    const seat = await join(pin, {}, alice.cookie);
    const sync = await request<PlayerSync>(seat.socket, 'player:rejoin', {
      gameId: seat.gameId,
      playerId: seat.playerId,
      token: seat.token,
    });
    const me = sync.board?.find((player) => player.id === seat.playerId);
    expect(me?.avatar).toBe('maya');
  }, 20_000);

  it('leaves a character without artwork as an empty avatar (no invented path)', async () => {
    const { pin } = await createGame();
    // `pixel` has no supplied artwork, so the seat must stay blank and let the
    // surfaces fall back to a letter badge.
    const alice = await playerLogin('alice', 'pixel');

    const seat = await join(pin, {}, alice.cookie);
    expect(seat.avatar).toBe('');
  }, 20_000);

  it('keeps a guest join anonymous, with the typed name and no avatar', async () => {
    const { pin } = await createGame();

    const seat = await join(pin, { nickname: 'Guest' });
    expect(seat.nickname).toBe('Guest');
    expect(seat.avatar).toBe('');
    const row = await prisma.gamePlayer.findUnique({ where: { id: seat.playerId } });
    expect(row?.userId).toBeNull();
  }, 20_000);

  it('ignores a nickname a signed-in player tries to send (account name wins)', async () => {
    const { pin } = await createGame();
    const alice = await playerLogin('alice');

    const seat = await join(pin, { nickname: 'NotAlice' }, alice.cookie);
    expect(seat.nickname).toBe('alice');
  }, 20_000);

  it('reuses the account’s existing seat on a second join instead of adding one', async () => {
    const { host, gameId, pin } = await createGame();
    const alice = await playerLogin('alice', 'maya');

    const first = await join(pin, {}, alice.cookie);
    const second = await join(pin, {}, alice.cookie);

    expect(second.playerId).toBe(first.playerId);
    expect(await prisma.gamePlayer.count({ where: { gameId } })).toBe(1);
    const roster = (await request<HostState>(host, 'host:join', { gameId })).players ?? [];
    expect(roster.filter((player) => player.nickname === 'alice')).toHaveLength(1);
  }, 20_000);

  it('still rejects a duplicate nickname from two different guests', async () => {
    const { pin } = await createGame();
    await join(pin, { nickname: 'Twin' });
    await expect(join(pin, { nickname: 'twin' })).rejects.toThrow(/already taken/i);
  }, 20_000);
});
