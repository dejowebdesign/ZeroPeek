/**
 * Player profiles (Phase 6.6).
 *
 * A profile is durable and belongs to exactly one registered account. It stores
 * only what the account itself owns — the chosen character id. Every statistic is
 * computed **on each request** from the persisted game data, so a number can
 * never drift from the games it summarises and the client never supplies one.
 *
 * Scope boundaries that matter:
 *   - **No IP address** is read, stored or used (product decision Q5).
 *   - **No quiz history** leaves this module: no question, no answer, no other
 *     player's result. The history stays admin-only (`reportService`).
 *   - XP, level and inventory belong to Phase 6.8 and are deliberately absent.
 */

import type { TieBreak } from '@zeropeek/shared';
import {
  DEFAULT_TIE_BREAK,
  defaultAvatarConfig,
  findCharacterAssets,
  rankGameSeats,
  summariseSeats,
  validateAvatarConfig,
  validateProfileUpdate,
  type AvatarConfig,
  type ProfileGameSeat,
  type ProfileStats,
  type ProfileView,
} from '@zeropeek/shared';

import { prisma } from '../db.js';
import { invalid, notFound } from '../errors.js';
import { Prisma } from '@prisma/client';

/**
 * Convert a validated avatar configuration (or `null`) to the value Prisma
 * stores in the nullable JSONB column. Prisma distinguishes a SQL `NULL`
 * (`Prisma.DbNull`) from a JSON `null`, so "nothing configured" must be `DbNull`.
 */
function toStoredAvatar(config: AvatarConfig | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return config === null ? Prisma.DbNull : (config as unknown as Prisma.InputJsonValue);
}

/**
 * A profile row is created lazily on the first read. Doing it here — rather than
 * in a registration hook — means an account that existed before Phase 6.6 gets
 * its profile the first time it is opened, with no backfill migration.
 */
export async function ensureProfile(userId: string) {
  const existing = await prisma.playerProfile.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.playerProfile.create({ data: { userId } });
}

/** The scoring tie-breakers a game was played with, or the shared default. */
export function gameTieBreak(settings: unknown): TieBreak[] {
  if (settings && typeof settings === 'object' && 'tieBreak' in settings) {
    const value = (settings as { tieBreak?: unknown }).tieBreak;
    if (Array.isArray(value) && value.length > 0) return value as TieBreak[];
  }
  return DEFAULT_TIE_BREAK;
}

/**
 * Read the authenticated account's own profile.
 *
 * The `userId` comes from the session, never from the request, so a caller can
 * only ever read their own profile. The statistics are derived from the account's
 * finished games:
 *   - a game counts only when its phase is `end` (an abandoned game is not a
 *     participation);
 *   - only this account's seats (`GamePlayer.userId`) are considered, so a guest
 *     seat without a `userId` is never attributed to anyone;
 *   - the whole roster of each finished game is loaded so the rank is recomputed
 *     with that game's own tie-breakers, matching the live leaderboard;
 *   - a question the host skipped was neutralised, so its answer rows are
 *     excluded from the accuracy numerator and denominator.
 */
export async function getProfile(userId: string): Promise<ProfileView> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('User not found.');

  const profile = await ensureProfile(userId);
  const stats = await computeProfileStats(userId);

  return {
    user: { id: user.id, username: user.username, role: user.role },
    profile: {
      selectedCharacterId: profile.selectedCharacterId,
      avatarConfig: readAvatarConfig(profile.avatarConfig),
    },
    stats,
  };
}

/**
 * Read the stored avatar configuration, defensively.
 *
 * The column is JSONB and the server is its only writer, so in practice it holds
 * a configuration this module produced. It is still re-validated on read: a value
 * written by an older build, or edited out of band, is returned only if it is a
 * complete, self-consistent configuration; otherwise it is reported as `null`
 * (nothing configured) rather than shown in a half-broken state.
 */
function readAvatarConfig(raw: unknown): AvatarConfig | null {
  if (raw === null || raw === undefined) return null;
  const { config } = validateAvatarConfig(raw);
  return config ?? null;
}

/**
 * Compute the personal statistics from the account's finished games.
 *
 * Exported (Phase 6.8) so the progression service evaluates achievements against
 * **exactly** the same tallies the profile shows, rather than a second query that
 * could drift.
 */
export async function computeProfileStats(userId: string): Promise<ProfileStats> {
  const mySeats = await prisma.gamePlayer.findMany({
    where: { userId, game: { phase: 'end' } },
    select: { id: true, gameId: true },
  });
  const gameIds = [...new Set(mySeats.map((seat) => seat.gameId))];
  if (gameIds.length === 0) return summariseSeats([]);

  const mySeatIds = new Set(mySeats.map((seat) => seat.id));

  // The full roster of every finished game the account played, so each game can
  // be ranked exactly as it was live. One query, keyed by game.
  const rosters = await prisma.gamePlayer.findMany({
    where: { gameId: { in: gameIds } },
    select: {
      id: true,
      gameId: true,
      score: true,
      correctCount: true,
      totalTimeMs: true,
      joinedAt: true,
    },
  });

  // The skipped questions per game, so a neutralised answer never counts as
  // answered or as correct. The `skipped` event is the append-only record.
  const skipEvents = await prisma.gameEvent.findMany({
    where: { gameId: { in: gameIds }, type: 'skipped' },
    select: { gameId: true, data: true },
  });
  const skippedByGame = new Map<string, Set<string>>();
  for (const event of skipEvents) {
    const questionId = (event.data as { questionId?: string } | null)?.questionId;
    if (typeof questionId !== 'string') continue;
    const set = skippedByGame.get(event.gameId) ?? new Set<string>();
    set.add(questionId);
    skippedByGame.set(event.gameId, set);
  }

  // This account's answer rows in those games, grouped per seat, with skipped
  // questions removed before counting.
  const answers = await prisma.playerAnswer.findMany({
    where: { playerId: { in: [...mySeatIds] } },
    select: { playerId: true, gameId: true, questionId: true, correctness: true },
  });
  const answeredBySeat = new Map<string, { answered: number; correct: number }>();
  for (const row of answers) {
    if (skippedByGame.get(row.gameId)?.has(row.questionId)) continue;
    const entry = answeredBySeat.get(row.playerId) ?? { answered: 0, correct: 0 };
    entry.answered += 1;
    if (row.correctness >= 1) entry.correct += 1;
    answeredBySeat.set(row.playerId, entry);
  }

  const games = await prisma.game.findMany({
    where: { id: { in: gameIds } },
    select: { id: true, settings: true },
  });
  const settingsByGame = new Map(games.map((game) => [game.id, game.settings]));

  const rosterByGame = new Map<string, ProfileGameSeat[]>();
  for (const seat of rosters) {
    const counts = answeredBySeat.get(seat.id) ?? { answered: 0, correct: 0 };
    const list = rosterByGame.get(seat.gameId) ?? [];
    list.push({
      gameId: seat.gameId,
      playerId: seat.id,
      score: seat.score,
      correctCount: counts.correct,
      answeredCount: counts.answered,
      totalTimeMs: seat.totalTimeMs,
      joinedAt: seat.joinedAt.getTime(),
    });
    rosterByGame.set(seat.gameId, list);
  }

  // Rank each game with its own tie-breakers, then keep only this account's
  // seats. The other seats are used solely to compute the rank.
  const mine = [...rosterByGame.entries()].flatMap(([gameId, roster]) =>
    rankGameSeats(roster, gameTieBreak(settingsByGame.get(gameId))).filter((seat) =>
      mySeatIds.has(seat.playerId),
    ),
  );

  return summariseSeats(mine);
}

/**
 * Update the authenticated account's profile.
 *
 * Only the fields Phase 6.6 owns may change; anything else is rejected by the
 * shared validator. A statistic, an XP value or a `userId` can never be written
 * here. An omitted field leaves the current value untouched.
 *
 * **Phase 6.7 interaction:** changing `selectedCharacterId` also resets the
 * avatar configuration to the new character's **default equipment**. That is the
 * binding rule (phase brief §6/§9): a character change activates the new
 * character's defaults and never carries the previous character's items over. A
 * character without artwork clears the configuration to `null` (nothing to wear
 * yet); nothing is invented for it.
 */
export async function updateProfile(
  userId: string,
  body: unknown,
): Promise<{ selectedCharacterId: string | null; avatarConfig: AvatarConfig | null }> {
  const issues = validateProfileUpdate(body);
  if (issues.length > 0) throw invalid('The profile update is invalid.', issues);

  await ensureProfile(userId);

  const record = body as { selectedCharacterId?: string | null };
  const data: {
    selectedCharacterId?: string | null;
    avatarConfig?: Prisma.InputJsonValue | typeof Prisma.DbNull;
  } = {};
  if ('selectedCharacterId' in record) {
    const value = record.selectedCharacterId;
    const chosen = typeof value === 'string' ? value.trim() : null;
    data.selectedCharacterId = chosen;
    // Keep the avatar configuration consistent with the new character. A change
    // to a character with artwork adopts its default kit; anything else (a
    // character without artwork, or clearing the choice) stores no configuration.
    data.avatarConfig =
      chosen !== null && findCharacterAssets(chosen)
        ? toStoredAvatar(defaultAvatarConfig(chosen))
        : Prisma.DbNull;
  }

  const updated = await prisma.playerProfile.update({ where: { userId }, data });
  return {
    selectedCharacterId: updated.selectedCharacterId,
    avatarConfig: readAvatarConfig(updated.avatarConfig),
  };
}

/**
 * Update the authenticated account's avatar configuration (Phase 6.7).
 *
 * The `userId` comes from the session, never the request, so a caller can only
 * change their own avatar. The configuration is validated against the
 * character-exclusive catalogue by `validateAvatarConfig` (shared, so it is the
 * tested rule): an unknown character, an unknown item, a wrong slot or **another
 * character's item** is rejected with a 422. The server is the only writer.
 *
 * A valid configuration also updates `selectedCharacterId`, so the picker and
 * the avatar editor can never disagree.
 */
export async function updateAvatar(userId: string, body: unknown): Promise<AvatarConfig> {
  const { config, issues } = validateAvatarConfig(body);
  if (!config) throw invalid('The avatar configuration is invalid.', issues);

  await ensureProfile(userId);

  const updated = await prisma.playerProfile.update({
    where: { userId },
    data: {
      selectedCharacterId: config.characterId,
      avatarConfig: toStoredAvatar(config),
    },
  });
  // The value was just validated and written, so it reads back verbatim.
  return readAvatarConfig(updated.avatarConfig) ?? config;
}
