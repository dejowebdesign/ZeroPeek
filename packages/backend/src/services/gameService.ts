/**
 * Game lifecycle: creating a game, joining, and the persisted state.
 *
 * The in-memory engine (`engine.ts`) drives the fast path; this service owns
 * everything that must survive a restart: the game row, the PIN, the players
 * and the recorded answers. The engine writes through to this service.
 */

import type { Prisma } from '@prisma/client';

import {
  CHARACTER_ID_MAX,
  DEFAULT_SCORING_SETTINGS,
  findCharacterAssets,
  generatePin,
  isValidPin,
  normalizePin,
  normalizeText,
  NICKNAME_MAX,
  type ScoringSettings,
} from '@zeropeek/shared';

import { newPlayerToken } from '../auth.js';
import { prisma } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { getQuiz } from './quizService.js';

/** How many times to retry a PIN collision before giving up. */
const PIN_ATTEMPTS = 12;

/** Create a game in the `lobby` phase for a quiz. */
export async function createGame(quizId: string, hostId: string) {
  const quiz = await getQuiz(quizId);
  if (quiz.questions.length === 0) {
    throw badRequest('A game needs a quiz with at least one question.');
  }

  let pin = '';
  for (let attempt = 0; attempt < PIN_ATTEMPTS; attempt += 1) {
    const candidate = generatePin();
    const clash = await prisma.game.findUnique({ where: { pin: candidate } });
    if (!clash) {
      pin = candidate;
      break;
    }
  }
  if (!pin) throw conflict('Could not allocate a free PIN, please try again.');

  return prisma.game.create({
    data: {
      pin,
      quizId,
      hostId,
      phase: 'lobby',
      currentIndex: -1,
      settings: DEFAULT_SCORING_SETTINGS as unknown as Prisma.InputJsonValue,
    },
  });
}

/** Look up a game by its PIN, for the player join flow. */
export async function findGameByPin(pin: string) {
  if (!isValidPin(pin)) throw notFound('No game with that PIN.');
  const game = await prisma.game.findUnique({ where: { pin: normalizePin(pin) } });
  if (!game) throw notFound('No game with that PIN.');
  return game;
}

/** Look up a game by id, or throw 404. */
export async function findGameById(id: string) {
  const game = await prisma.game.findUnique({ where: { id } });
  if (!game) throw notFound('Game not found.');
  return game;
}

/** The scoring settings snapshot of a game. */
export function gameSettings(game: { settings: Prisma.JsonValue }): ScoringSettings {
  const value = game.settings;
  if (value && typeof value === 'object' && 'scoring' in value) {
    return value as unknown as ScoringSettings;
  }
  return DEFAULT_SCORING_SETTINGS;
}

/** The seat fields the join flow needs back. */
type JoinedSeat = {
  id: string;
  gameId: string;
  nickname: string;
  avatar: string;
  token: string;
  joinedAt: Date;
};

/** Whether an already-joined seat belongs to this account. */
function seatBelongsTo(seat: { userId: string | null }, userId?: string): boolean {
  return userId !== undefined && seat.userId === userId;
}

/**
 * Add a player to a lobby game. Rejects duplicate nicknames (case- and
 * accent-insensitively) and games that have already started.
 *
 * `userId` links the seat to a registered account when the join carries a
 * **player** session (Phase 6.6.3); it stays `null` for a guest. The link is
 * only ever set from the player session — never from a client-supplied id, and
 * never from a host session — and it is what lets the profile count the
 * account's own finished games.
 *
 * **One seat per account (Phase 6.8.3).** A signed-in player who joins again —
 * a reload, a second tab, a double click — is given their **existing** seat back
 * instead of a second one, so a single account can never appear twice in a
 * lobby (and can never be paid the round twice). The seat is refreshed to the
 * account's current name and avatar. A guest, having no account, keeps the
 * previous behaviour and always gets a fresh seat.
 */
export async function joinGame(
  pin: string,
  nickname: string,
  avatar = '',
  userId?: string,
): Promise<{ game: Awaited<ReturnType<typeof findGameByPin>>; player: JoinedSeat }> {
  const trimmed = nickname.trim();
  if (trimmed.length === 0 || trimmed.length > NICKNAME_MAX) {
    throw badRequest(`The nickname must be 1–${NICKNAME_MAX} characters.`);
  }

  const game = await findGameByPin(pin);
  if (game.phase !== 'lobby') throw conflict('This game has already started.');

  const existing = await prisma.gamePlayer.findMany({ where: { gameId: game.id } });

  // A signed-in player who is already seated in this lobby rejoins that seat.
  if (userId) {
    const mine = existing.find((seat) => seatBelongsTo(seat, userId));
    if (mine) {
      const player = await prisma.gamePlayer.update({
        where: { id: mine.id },
        data: { nickname: trimmed, avatar },
        select: {
          id: true,
          gameId: true,
          nickname: true,
          avatar: true,
          token: true,
          joinedAt: true,
        },
      });
      return { game, player };
    }
  }

  const wanted = normalizeText(trimmed);
  if (existing.some((player) => normalizeText(player.nickname) === wanted)) {
    throw conflict('That nickname is already taken in this game.', 'nickname_taken');
  }

  const player = await prisma.gamePlayer.create({
    data: {
      gameId: game.id,
      nickname: trimmed,
      avatar,
      token: newPlayerToken(),
      ...(userId ? { userId } : {}),
    },
    select: { id: true, gameId: true, nickname: true, avatar: true, token: true, joinedAt: true },
  });
  return { game, player };
}

/**
 * The avatar id to seat a player with: the account's chosen character, but only
 * when that character has supplied artwork.
 *
 * A character without artwork (`pixel`, `bee`, …) resolves to `''`, so the
 * surfaces fall back to a clean initial badge rather than pointing at a file
 * that does not exist (phase brief §2: no invented image paths, no empty
 * placeholders). A guest passes no account and therefore always gets `''`.
 */
export async function resolveSeatAvatar(userId: string | undefined): Promise<string> {
  if (!userId) return '';
  const profile = await prisma.playerProfile.findUnique({
    where: { userId },
    select: { selectedCharacterId: true },
  });
  const characterId = profile?.selectedCharacterId ?? null;
  return characterId && findCharacterAssets(characterId) ? characterId : '';
}

/** Sanitise a client-supplied guest avatar: a bounded string, never a path. */
export function sanitizeGuestAvatar(avatar: unknown): string {
  if (typeof avatar !== 'string') return '';
  const trimmed = avatar.trim();
  return trimmed.length > CHARACTER_ID_MAX ? '' : trimmed;
}

/** Reclaim an existing player slot after a reconnect. */
export async function rejoinGame(gameId: string, playerId: string, token: string) {
  const player = await prisma.gamePlayer.findUnique({ where: { id: playerId } });
  if (!player || player.gameId !== gameId || player.token !== token) {
    throw notFound('That player slot could not be found.');
  }
  return player;
}

/** Persist a phase transition. */
export async function setPhase(
  gameId: string,
  phase: string,
  currentIndex?: number,
  extra: Prisma.GameUpdateInput = {},
) {
  return prisma.game.update({
    where: { id: gameId },
    data: { phase, ...(currentIndex === undefined ? {} : { currentIndex }), ...extra },
  });
}

/** Record a game event in the append-only log. */
export async function logEvent(
  gameId: string,
  type: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  await prisma.gameEvent.create({
    data: { gameId, type, data: data as Prisma.InputJsonValue },
  });
}

/** List players of a game, ordered by join time. */
export async function listPlayers(gameId: string) {
  return prisma.gamePlayer.findMany({ where: { gameId }, orderBy: { joinedAt: 'asc' } });
}

/** Mark a player's connected flag. A no-op if the row is gone (e.g. kicked). */
export async function setPlayerConnected(playerId: string, connected: boolean): Promise<void> {
  await prisma.gamePlayer.updateMany({ where: { id: playerId }, data: { connected } });
}
