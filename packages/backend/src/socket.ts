/**
 * Socket.IO layer: two namespaces, `/` for players and `/host` for hosts.
 *
 * The host namespace authenticates from the session cookie (ADR 0006); the
 * player namespace is anonymous but every join returns a per-player token used
 * for reconnect. Every inbound payload is validated, every handler is wrapped
 * so a thrown `AppError` becomes an error ACK rather than a crash, and the
 * engine's state changes are fanned out to the right rooms.
 */

import type { Server as HttpServer } from 'node:http';

import { Server, type Socket } from 'socket.io';

import type { PublicPlayer, Question } from '@zeropeek/shared';

import type { AppConfig } from './config.js';
import { AppError, badRequest, forbidden, notFound } from './errors.js';
import { prisma } from './db.js';
import { engine } from './services/engine.js';
import { findGameById, joinGame, rejoinGame, setPlayerConnected } from './services/gameService.js';
import { resolveSession } from './sessions.js';

/** Room helpers. Each player also gets a personal room for private results. */
const playerRoom = (gameId: string): string => `game:${gameId}:players`;
const hostRoom = (gameId: string): string => `game:${gameId}:hosts`;
const personalRoom = (playerId: string): string => `player:${playerId}`;

type AckFn<T> = (result: { ok: true; data: T } | { ok: false; error: string }) => void;

/**
 * Parse a `Cookie` header.
 *
 * The socket upgrade request bypasses Fastify's router, so `@fastify/cookie`
 * never decorates it with `request.cookies`. The host middleware therefore
 * parses the header itself.
 */
function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

/** Turn a thrown value into a safe ACK error string (never a stack trace). */
function errorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return 'Unexpected error.';
}

/** Run a handler and answer the ACK exactly once, success or failure. */
function guard<T>(ack: unknown, handler: () => Promise<T>): void {
  if (typeof ack !== 'function') return;
  const answer = ack as AckFn<T>;
  handler()
    .then((data) => answer({ ok: true, data }))
    .catch((error: unknown) => answer({ ok: false, error: errorMessage(error) }));
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`\`${field}\` is required.`);
  }
  return value;
}

export interface SocketLayer {
  io: Server;
  close: () => Promise<void>;
}

/** Attach Socket.IO to the Fastify HTTP server and wire the engine events. */
export function attachSocketIO(
  httpServer: HttpServer,
  config: AppConfig,
  corsOrigin: string,
): SocketLayer {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
    serveClient: false,
  });

  const players = io.of('/');
  const hosts = io.of('/host');

  // ---------------------------------------------------------------------------
  // Host namespace: authenticated from the session cookie.
  // ---------------------------------------------------------------------------
  hosts.use(async (socket, next) => {
    try {
      const raw = socket.request;
      // Rebuild the small part of a Fastify request that `resolveSession` reads.
      const request = {
        cookies: parseCookieHeader(raw.headers.cookie),
        method: 'GET',
      } as unknown as Parameters<typeof resolveSession>[0];
      const auth = await resolveSession(request, config);
      if (!auth) {
        next(new Error('unauthorized'));
        return;
      }
      // A player account (Phase 6.3) is authenticated but is not staff, so it
      // cannot host. ADMIN and TRAINER are unchanged.
      if (auth.user.role !== 'ADMIN' && auth.user.role !== 'TRAINER') {
        next(new Error('forbidden'));
        return;
      }
      socket.data.user = auth.user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  hosts.on('connection', (socket: Socket) => {
    const user = socket.data.user as { id: string; username: string; role: string };

    /** Reject unless the host owns the game (admins may control any game). */
    const assertHost = async (gameId: string): Promise<void> => {
      const row = await prisma.game.findUnique({ where: { id: gameId } });
      if (!row) throw notFound('Game not found.');
      if (row.hostId && row.hostId !== user.id && user.role !== 'ADMIN') {
        throw forbidden('This game belongs to another host.');
      }
    };

    socket.on('host:create', (payload: { quizId?: string }, ack) => {
      guard(ack, async () => {
        const quizId = asString(payload?.quizId, 'quizId');
        const game = await engine.create(quizId, user.id);
        await socket.join(hostRoom(game.id));
        socket.data.gameId = game.id;
        return engine.hostState(game);
      });
    });

    socket.on('host:join', (payload: { gameId?: string }, ack) => {
      guard(ack, async () => {
        const gameId = asString(payload?.gameId, 'gameId');
        await assertHost(gameId);
        const game = await engine.get(gameId);
        await socket.join(hostRoom(gameId));
        socket.data.gameId = gameId;
        // The full, phase-aware state, so a host that reloads mid-game resumes
        // the live screen instead of dropping back to the lobby.
        return engine.hostState(game);
      });
    });

    const command =
      (run: (gameId: string) => Promise<string>) =>
      (payload: { gameId?: string }, ack?: unknown) => {
        guard(ack, async () => {
          const gameId = asString(payload?.gameId, 'gameId');
          await assertHost(gameId);
          return { phase: await run(gameId) };
        });
      };

    socket.on(
      'host:start',
      command((id) => engine.start(id)),
    );
    socket.on(
      'host:next',
      command((id) => engine.next(id)),
    );
    socket.on(
      'host:reveal',
      command((id) => engine.reveal(id)),
    );
    socket.on(
      'host:board',
      command((id) => engine.board(id)),
    );
    socket.on(
      'host:end',
      command((id) => engine.end(id)),
    );

    socket.on('host:kick', (payload: { gameId?: string; playerId?: string }, ack) => {
      guard(ack, async () => {
        const gameId = asString(payload?.gameId, 'gameId');
        const playerId = asString(payload?.playerId, 'playerId');
        await assertHost(gameId);
        const game = await engine.get(gameId);
        game.players.delete(playerId);
        await prisma.gamePlayer.deleteMany({ where: { id: playerId, gameId } });
        return { ok: true };
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Player namespace.
  // ---------------------------------------------------------------------------
  players.on('connection', (socket: Socket) => {
    socket.on(
      'player:join',
      (payload: { pin?: string; nickname?: string; avatar?: string }, ack) => {
        guard(ack, async () => {
          const pin = asString(payload?.pin, 'pin');
          const nickname = asString(payload?.nickname, 'nickname');
          const avatar = typeof payload?.avatar === 'string' ? payload.avatar : '';

          const { game, player } = await joinGame(pin, nickname, avatar);
          await socket.join(playerRoom(game.id));
          await socket.join(personalRoom(player.id));
          socket.data.playerId = player.id;
          socket.data.gameId = game.id;
          await engine.addPlayer(game.id, {
            id: player.id,
            nickname: player.nickname,
            avatar: player.avatar,
            joinedAt: player.joinedAt,
          });
          return { playerId: player.id, gameId: game.id, token: player.token };
        });
      },
    );

    socket.on(
      'player:rejoin',
      (payload: { gameId?: string; playerId?: string; token?: string }, ack) => {
        guard(ack, async () => {
          const gameId = asString(payload?.gameId, 'gameId');
          const playerId = asString(payload?.playerId, 'playerId');
          const token = asString(payload?.token, 'token');
          const player = await rejoinGame(gameId, playerId, token);
          await socket.join(playerRoom(gameId));
          await socket.join(personalRoom(player.id));
          socket.data.playerId = player.id;
          socket.data.gameId = gameId;
          await setPlayerConnected(player.id, true);
          await engine.markConnected(gameId, player.id, true);
          // Hand back the real current state, so a reconnect during a running
          // game renders the live phase instead of dropping into the lobby.
          const game = await engine.get(gameId);
          return engine.playerSync(game, player.id);
        });
      },
    );

    socket.on('player:answer', (payload: { questionId?: string; answer?: unknown }, ack) => {
      guard(ack, async () => {
        const gameId = socket.data.gameId as string | undefined;
        const playerId = socket.data.playerId as string | undefined;
        if (!gameId || !playerId) throw badRequest('Join a game first.');
        const questionId = asString(payload?.questionId, 'questionId');
        return engine.submitAnswer(gameId, playerId, questionId, payload?.answer);
      });
    });

    socket.on('disconnect', () => {
      const gameId = socket.data.gameId as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      if (gameId && playerId) {
        void setPlayerConnected(playerId, false)
          .then(() => engine.markConnected(gameId, playerId, false))
          .catch(() => undefined);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Engine events → rooms.
  // ---------------------------------------------------------------------------
  engine.on('lobby', ({ gameId, pin, players: list }) => {
    hosts.to(hostRoom(gameId)).emit('host:lobby', { pin, players: list });
    players.to(playerRoom(gameId)).emit('game:state', { phase: 'lobby', players: list });
  });

  engine.on('question', ({ gameId, question }) => {
    hosts.to(hostRoom(gameId)).emit('host:question', question);
    players.to(playerRoom(gameId)).emit('game:question', question);
  });

  engine.on('answers', (payload) => {
    hosts.to(hostRoom(payload.gameId)).emit('host:answers', payload);
  });

  engine.on('reveal', ({ gameId, question, distribution }) => {
    hosts.to(hostRoom(gameId)).emit('host:reveal', { question, distribution });
    void sendPlayerResults(io, gameId, question).catch(() => undefined);
  });

  engine.on('board', ({ gameId, players: list }) => {
    hosts.to(hostRoom(gameId)).emit('host:board', { players: list });
    players.to(playerRoom(gameId)).emit('game:board', { players: list });
  });

  engine.on('ended', ({ gameId, players: list }) => {
    hosts.to(hostRoom(gameId)).emit('host:ended', { players: list });
    void sendPlayerEnd(io, gameId, list).catch(() => undefined);
  });

  return {
    io,
    close: () =>
      new Promise<void>((resolve) => {
        io.close(() => resolve());
      }),
  };
}

/** Send each player their own private result for the revealed question. */
async function sendPlayerResults(io: Server, gameId: string, question: Question): Promise<void> {
  const rows = await prisma.playerAnswer.findMany({
    where: { gameId, questionId: question.id },
    select: { playerId: true, correctness: true, points: true },
  });
  const byPlayer = new Map(rows.map((row) => [row.playerId, row]));

  const game = await engine.get(gameId);
  const leaderboard = engine.leaderboard(game);

  for (const player of game.players.values()) {
    const row = byPlayer.get(player.id);
    const rank = leaderboard.findIndex((entry) => entry.id === player.id) + 1;
    io.to(personalRoom(player.id)).emit('game:reveal', {
      questionId: question.id,
      result: {
        outcome: row ? (row.correctness >= 1 ? 'correct' : 'wrong') : 'unanswered',
        points: row?.points ?? 0,
        score: player.score,
        rank: rank === 0 ? leaderboard.length : rank,
      },
    });
  }
}

/** Send each player their final placement. */
async function sendPlayerEnd(io: Server, gameId: string, podium: PublicPlayer[]): Promise<void> {
  const game = await engine.get(gameId);
  const ranked = engine.leaderboard(game);
  ranked.forEach((player, index) => {
    io.to(personalRoom(player.id)).emit('game:ended', {
      rank: index + 1,
      score: player.score,
      podium: podium.slice(0, 3),
    });
  });
}
