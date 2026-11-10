/**
 * Socket.IO layer: two namespaces, `/` for players and `/host` for hosts.
 *
 * The host namespace authenticates from the **host** session cookie (`zp_session`,
 * ADR 0006); the player namespace is anonymous but a join may link the seat to a
 * **player** account when `zp_player_session` is present (Phase 6.6.3). A host
 * session is never read as a player identity, so a host and a guest can run in
 * the same browser without either taking the other's identity. Every inbound
 * payload is validated, every handler is wrapped so a thrown `AppError` becomes
 * an error ACK rather than a crash, and the engine's state changes are fanned out
 * to the right rooms.
 */

import type { Server as HttpServer } from 'node:http';

import { Server, type Socket } from 'socket.io';

import type { PublicPlayer, Question, HostPresence } from '@zeropeek/shared';

import type { AppConfig } from './config.js';
import { AppError, badRequest, conflict, forbidden, notFound } from './errors.js';
import { prisma } from './db.js';
import { engine } from './services/engine.js';
import { rejoinGame, setPlayerConnected } from './services/gameService.js';
import { resolvePlayerSession, resolveSession } from './sessions.js';
import { grantProgressForGame } from './services/progressionService.js';

/** Room helpers. Each player also gets a personal room for private results. */
const playerRoom = (gameId: string): string => `game:${gameId}:players`;
const hostRoom = (gameId: string): string => `game:${gameId}:hosts`;
const personalRoom = (playerId: string): string => `player:${playerId}`;

type AckFn<T> = (result: { ok: true; data: T } | { ok: false; error: string }) => void;

/**
 * How long a host presence change must hold before it is announced to players
 * (Phase 6.5.3). A host socket that reconnects within this window is never shown
 * as gone, so a brief network hiccup does not make the status flicker.
 */
const PRESENCE_DEBOUNCE_MS = 1500;

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

  /**
   * The last host-presence value announced per game, and the debounce timers.
   *
   * A host dropping for a moment (a phone switching networks, a reload) must not
   * flash "reconnecting" at the players, so a change is only announced once it
   * has settled for `PRESENCE_DEBOUNCE_MS`. The very first `connected` for a game
   * is sent without waiting, so players joining a live game are not told the host
   * is away while the check runs.
   */
  const presenceByGame = new Map<string, HostPresence>();
  const presenceTimers = new Map<string, NodeJS.Timeout>();

  const currentPresence = (gameId: string): HostPresence =>
    hosts.adapter.rooms.get(hostRoom(gameId))?.size ? 'connected' : 'reconnecting';

  const publishPresence = (gameId: string): void => {
    const status = currentPresence(gameId);
    if (presenceByGame.get(gameId) === status) return;
    presenceByGame.set(gameId, status);
    // Only the host's reachability leaves the server here — never a phase, a
    // session or any host data (Phase 6.5.3).
    players.to(playerRoom(gameId)).emit('game:host', { status });
  };

  const announceHostPresence = (socket: Socket, gameId: string): void => {
    const existing = presenceTimers.get(gameId);
    if (existing) clearTimeout(existing);
    if (presenceByGame.get(gameId) === undefined) {
      publishPresence(gameId);
      return;
    }
    const timer = setTimeout(() => {
      presenceTimers.delete(gameId);
      publishPresence(gameId);
    }, PRESENCE_DEBOUNCE_MS);
    presenceTimers.set(gameId, timer);
  };

  /** The presence a newly joined player should be told right away. */
  const presenceFor = (gameId: string): HostPresence =>
    presenceByGame.get(gameId) ?? currentPresence(gameId);

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
        announceHostPresence(socket, game.id);
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
        announceHostPresence(socket, gameId);
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
    socket.on(
      'host:pause',
      command((id) => engine.pause(id)),
    );
    socket.on(
      'host:resume',
      command((id) => engine.resume(id)),
    );
    socket.on(
      'host:skip',
      command((id) => engine.skip(id)),
    );

    socket.on('host:kick', (payload: { gameId?: string; playerId?: string }, ack) => {
      guard(ack, async () => {
        const gameId = asString(payload?.gameId, 'gameId');
        const playerId = asString(payload?.playerId, 'playerId');
        await assertHost(gameId);
        const game = await engine.get(gameId);
        // Kick is a lobby action only (Phase 6.5.3): removing a player mid-game
        // would silently rewrite a live ranking.
        if (game.phase !== 'lobby') throw conflict('Players can only be removed in the lobby.');
        if (!game.players.has(playerId)) throw notFound('That player is not in this game.');
        game.players.delete(playerId);
        await prisma.gamePlayer.deleteMany({ where: { id: playerId, gameId } });
        // Tell the removed player first, then everyone else, so the roster the
        // remaining players see never includes someone who has been told to go.
        io.of('/').to(personalRoom(playerId)).emit('game:kicked', { reason: 'kicked' });
        io.of('/').in(personalRoom(playerId)).socketsLeave(personalRoom(playerId));
        io.of('/').in(personalRoom(playerId)).socketsLeave(playerRoom(gameId));
        engine.emitLobby(game);
        return { ok: true };
      });
    });

    socket.on('disconnect', () => {
      const gameId = socket.data.gameId as string | undefined;
      if (gameId) announceHostPresence(socket, gameId);
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

          // A registered player may be signed in on this browser through the
          // **player** context; the seat is then linked to that account (Phase
          // 6.6) so the profile can count the round. Only `zp_player_session` is
          // read here — a host session (`zp_session`) is deliberately ignored, so
          // an ADMIN signed in as a host does not become the identity of a guest
          // join (Phase 6.6.3). The id comes from the player session only, never
          // from the payload, and a lookup that fails is treated as a guest, so
          // joining never breaks on a stale cookie.
          const request = {
            cookies: parseCookieHeader(socket.request.headers.cookie),
            method: 'GET',
          } as unknown as Parameters<typeof resolvePlayerSession>[0];
          const session = await resolvePlayerSession(request, config).catch(() => null);

          // The engine owns the join, because it must be serialised against the
          // host's `start` under the same per-game phase lock (bugfix: a join
          // that raced the start could otherwise leave the host on a stale
          // lobby whose "Start game" the engine then rejects).
          const { game, player } = await engine.join(pin, nickname, avatar, session?.user.id);
          await socket.join(playerRoom(game.id));
          await socket.join(personalRoom(player.id));
          socket.data.playerId = player.id;
          socket.data.gameId = game.id;
          // Tell this player whether the host is reachable, so the status is
          // correct from the first screen rather than after the next change.
          socket.emit('game:host', { status: presenceFor(game.id) });
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
          socket.emit('game:host', { status: presenceFor(gameId) });
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

  engine.on('reveal', ({ gameId, reveal }) => {
    hosts.to(hostRoom(gameId)).emit('host:reveal', reveal);
    // A skipped reveal carries no solution, so `sendPlayerResults` only needs the
    // question id and the fact that the question was neutralised.
    void sendPlayerResults(io, gameId, reveal.question.id, reveal.skipped).catch(() => undefined);
  });

  engine.on('paused', ({ gameId, questionId, remainingMs }) => {
    hosts.to(hostRoom(gameId)).emit('host:paused', { questionId, remainingMs });
    players.to(playerRoom(gameId)).emit('game:paused', { questionId, remainingMs });
  });

  engine.on('resumed', ({ gameId, questionId, remainingMs }) => {
    hosts.to(hostRoom(gameId)).emit('host:resumed', { questionId, remainingMs });
    players.to(playerRoom(gameId)).emit('game:resumed', { questionId, remainingMs });
  });

  engine.on('board', ({ gameId, players: list }) => {
    hosts.to(hostRoom(gameId)).emit('host:board', { players: list });
    players.to(playerRoom(gameId)).emit('game:board', { players: list });
  });

  engine.on('ended', ({ gameId, players: list }) => {
    hosts.to(hostRoom(gameId)).emit('host:ended', { players: list });
    void sendPlayerEnd(io, gameId, list).catch(() => undefined);
    // Phase 6.8: grant the registered players their XP, level-ups and rewards
    // for this finished game. Fire-and-forget (like the fan-out above) so a slow
    // grant never delays the socket event; the grant is idempotent, so a retried
    // `end` or a duplicate event pays nothing a second time.
    void grantProgressForGame(gameId).catch(() => undefined);
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
async function sendPlayerResults(
  io: Server,
  gameId: string,
  questionId: string,
  skipped = false,
): Promise<void> {
  const rows = await prisma.playerAnswer.findMany({
    where: { gameId, questionId },
    select: { playerId: true, correctness: true, points: true },
  });
  const byPlayer = new Map(rows.map((row) => [row.playerId, row]));

  const game = await engine.get(gameId);
  const leaderboard = engine.leaderboard(game);

  for (const player of game.players.values()) {
    const row = byPlayer.get(player.id);
    const rank = leaderboard.findIndex((entry) => entry.id === player.id) + 1;
    // A skipped question is never scored: the player is told it was skipped, not
    // handed a correct/wrong verdict for a question nobody was graded on.
    if (skipped) {
      io.to(personalRoom(player.id)).emit('game:reveal', {
        questionId,
        skipped: true,
        result: {
          outcome: 'skipped',
          points: 0,
          score: player.score,
          rank: rank === 0 ? leaderboard.length : rank,
        },
      });
      continue;
    }
    io.to(personalRoom(player.id)).emit('game:reveal', {
      questionId,
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
