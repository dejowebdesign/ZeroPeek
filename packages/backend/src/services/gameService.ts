/**
 * Game lifecycle: creating a game, joining, and the persisted state.
 *
 * The in-memory engine (`engine.ts`) drives the fast path; this service owns
 * everything that must survive a restart: the game row, the PIN, the players
 * and the recorded answers. The engine writes through to this service.
 */

import type { Prisma } from '@prisma/client';

import {
  DEFAULT_SCORING_SETTINGS,
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

/**
 * Add a player to a lobby game. Rejects duplicate nicknames (case- and
 * accent-insensitively) and games that have already started.
 */
export async function joinGame(pin: string, nickname: string, avatar = '') {
  const trimmed = nickname.trim();
  if (trimmed.length === 0 || trimmed.length > NICKNAME_MAX) {
    throw badRequest(`The nickname must be 1–${NICKNAME_MAX} characters.`);
  }

  const game = await findGameByPin(pin);
  if (game.phase !== 'lobby') throw conflict('This game has already started.');

  const existing = await prisma.gamePlayer.findMany({ where: { gameId: game.id } });
  const wanted = normalizeText(trimmed);
  if (existing.some((player) => normalizeText(player.nickname) === wanted)) {
    throw conflict('That nickname is already taken in this game.', 'nickname_taken');
  }

  const player = await prisma.gamePlayer.create({
    data: { gameId: game.id, nickname: trimmed, avatar, token: newPlayerToken() },
  });
  return { game, player };
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

/** Mark a player's connected flag. */
export async function setPlayerConnected(playerId: string, connected: boolean): Promise<void> {
  await prisma.gamePlayer.update({ where: { id: playerId }, data: { connected } });
}
