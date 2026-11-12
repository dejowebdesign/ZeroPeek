/**
 * Player progression (Phase 6.8, level rewards and reconciliation Phase 6.8.4):
 * XP, level, inventory and achievements.
 *
 * This is the **only** writer of XP, level, inventory and achievement rows, and
 * it runs **server-side** only. There is no endpoint that accepts an XP value, a
 * level or an unlock from the client, so none of them can be forged.
 *
 * Binding rules (`game-design-concept.md` §5, §6, §7):
 *   - XP are the game points, granted **once per (player, game)** at the final
 *     `end`, in **one transaction** together with the placement bonus, the level
 *     recomputation and any level-reward grant.
 *   - The `XpLedger` is the truth; `PlayerProfile.xp`/`level` are its
 *     materialisation. Both are written together, so they cannot disagree.
 *   - The idempotency lock is `@@unique([userId, gameId, reason])` on the ledger:
 *     re-processing the same game grants nothing a second time.
 *   - Placement bonus 1/2/3 = 1500/1000/500, **not** folded into the game score,
 *     and **every tied player gets the same bonus** (the rank comes from the
 *     shared `rankPlayers`, which already assigns shared ranks).
 *   - Achievements and level rewards are computed from persisted data; the
 *     catalogues are code in `@zeropeek/shared`.
 *
 * **Rewards are reconciled, not just granted at level-up (Phase 6.8.4).** The
 * inventory is derived: an item is owned when a `PlayerInventory` row exists for
 * it. `reconcileLevelRewards` (called on every read of the inventory or the
 * progress view) inserts exactly the reward items the account has *earned* by its
 * current level, for the currently chosen character, with `skipDuplicates`. This
 * makes three cases correct with one mechanism: an account that reached a level
 * under the old curve still receives its items; a character change grants the new
 * character's earned items (an unlocked item is never transferred, only the
 * *right* to earn it); and a repeated call can never duplicate a row. The account's
 * XP is never touched here.
 */

import {
  achievementsEarned,
  achievementProgress,
  ACHIEVEMENT_CATALOGUE,
  cosmeticsForCharacter,
  findCosmetic,
  isEquipmentSlot,
  levelForXp,
  levelProgress,
  levelRewardItem,
  nextRewardLevel,
  rankPlayers,
  rewardItemsUpToLevel,
  unlockLevelForItem,
  validateAvatarConfig,
  xpGrantForGame,
  XP_REASON_GAME,
  XP_REASON_PLACEMENT,
  type AchievementContext,
  type AchievementsView,
  type AvatarConfig,
  type EquipmentSlot,
  type InventoryItemView,
  type InventoryView,
  type ProgressView,
} from '@zeropeek/shared';
import { Prisma } from '@prisma/client';

import { prisma } from '../db.js';
import { invalid } from '../errors.js';
import { ensureProfile, gameTieBreak } from './profileService.js';

/** The Prisma surface shared by the client and a transaction client. */
type Db = Prisma.TransactionClient;

/** The aggregates the achievement rules and the profile both need. */
type Aggregates = Omit<AchievementContext, 'level'>;

/** The longest run of consecutive correct answers within one game's sequence. */
function longestStreak(sequence: boolean[]): number {
  let best = 0;
  let current = 0;
  for (const correct of sequence) {
    current = correct ? current + 1 : 0;
    if (current > best) best = current;
  }
  return best;
}

/**
 * Compute the achievement-relevant aggregates for an account from persisted data.
 *
 * Takes the Prisma client or a transaction client, so the same code runs on a
 * plain read (`getAchievementsView`) and inside the grant transaction — one
 * implementation, no chance of the two drifting.
 *
 * Rules, matching the profile exactly:
 *   - a game counts only when its phase is `end` and only this account's seats
 *     (`GamePlayer.userId`) are considered;
 *   - a question the host skipped was neutralised, so its answers are excluded
 *     from the counts, the streak and the perfect-round test;
 *   - wins and podiums use the game's own tie-breakers, so a tie counts for every
 *     tied leader (the same `rankPlayers` the live leaderboard used).
 */
async function aggregatesFor(db: Db, userId: string): Promise<Aggregates> {
  const empty: Aggregates = {
    gamesPlayed: 0,
    wins: 0,
    podiums: 0,
    correctAnswers: 0,
    answeredCount: 0,
    longestCorrectStreak: 0,
    perfectRounds: 0,
  };

  const mySeats = await db.gamePlayer.findMany({
    where: { userId, game: { phase: 'end' } },
    select: { id: true, gameId: true },
  });
  const seatIds = mySeats.map((seat) => seat.id);
  const gameIds = [...new Set(mySeats.map((seat) => seat.gameId))];
  if (gameIds.length === 0) return empty;
  const mySeatIds = new Set(seatIds);

  const skipEvents = await db.gameEvent.findMany({
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

  const answerRows = await db.playerAnswer.findMany({
    where: { playerId: { in: seatIds } },
    select: { gameId: true, questionId: true, correctness: true, answeredAt: true, id: true },
    orderBy: [{ answeredAt: 'asc' }, { id: 'asc' }],
  });
  const history = new Map<string, boolean[]>();
  let correctAnswers = 0;
  let answeredCount = 0;
  for (const row of answerRows) {
    if (skippedByGame.get(row.gameId)?.has(row.questionId)) continue;
    answeredCount += 1;
    if (row.correctness >= 1) correctAnswers += 1;
    const list = history.get(row.gameId) ?? [];
    list.push(row.correctness >= 1);
    history.set(row.gameId, list);
  }

  let perfectRounds = 0;
  let longestCorrectStreak = 0;
  for (const sequence of history.values()) {
    if (sequence.length > 0 && sequence.every(Boolean)) perfectRounds += 1;
    longestCorrectStreak = Math.max(longestCorrectStreak, longestStreak(sequence));
  }

  // Wins and podiums need the full roster of each game, ranked with its own
  // tie-breakers, exactly as the profile does.
  const rosters = await db.gamePlayer.findMany({
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
  const games = await db.game.findMany({
    where: { id: { in: gameIds } },
    select: { id: true, settings: true },
  });
  const settingsByGame = new Map(games.map((game) => [game.id, game.settings]));

  const rosterByGame = new Map<string, typeof rosters>();
  for (const seat of rosters) {
    const list = rosterByGame.get(seat.gameId) ?? [];
    list.push(seat);
    rosterByGame.set(seat.gameId, list);
  }

  let wins = 0;
  let podiums = 0;
  for (const [gameId, roster] of rosterByGame) {
    const ranked = rankPlayers(
      roster.map((seat) => ({
        id: seat.id,
        score: seat.score,
        correctCount: seat.correctCount,
        totalTimeMs: seat.totalTimeMs,
        joinedAt: seat.joinedAt.getTime(),
      })),
      gameTieBreak(settingsByGame.get(gameId)),
    );
    const mine = ranked.filter((entry) => mySeatIds.has(entry.id));
    if (mine.some((entry) => entry.rank === 1)) wins += 1;
    if (mine.some((entry) => entry.rank <= 3)) podiums += 1;
  }

  return {
    gamesPlayed: gameIds.length,
    wins,
    podiums,
    correctAnswers,
    answeredCount,
    longestCorrectStreak,
    perfectRounds,
  };
}

/**
 * Build the full achievement context for an account (aggregates plus its level).
 *
 * All aggregates come from `aggregatesFor`, the same code the grant transaction
 * runs, so an achievement threshold and the profile number a player sees can
 * never disagree.
 */
export async function achievementContextForUser(userId: string): Promise<AchievementContext> {
  const [aggregates, profile] = await Promise.all([
    aggregatesFor(prisma, userId),
    ensureProfile(userId),
  ]);
  return { ...aggregates, level: levelForXp(profile.xp) };
}

/** One registered player's best seat in a game, with its placement. */
interface RankedRegistration {
  userId: string;
  score: number;
  rank: number;
}

/**
 * Rank a game's seats and keep the **best** seat per registered account.
 *
 * "Best" is the lowest rank, then the higher score, then the smaller player id —
 * fully deterministic, so a duplicate seat (two tabs) never counts a game twice
 * or inflates a bonus.
 */
function bestRegisteredSeats(
  seats: Array<{
    id: string;
    userId: string | null;
    score: number;
    correctCount: number;
    totalTimeMs: number;
    joinedAt: Date;
  }>,
  tieBreak: Parameters<typeof rankPlayers>[1],
): RankedRegistration[] {
  const ranked = rankPlayers(
    seats.map((seat) => ({
      id: seat.id,
      score: seat.score,
      correctCount: seat.correctCount,
      totalTimeMs: seat.totalTimeMs,
      joinedAt: seat.joinedAt.getTime(),
    })),
    tieBreak,
  );
  const byId = new Map(seats.map((seat) => [seat.id, seat]));
  const best = new Map<string, RankedRegistration>();
  for (const entry of ranked) {
    const seat = byId.get(entry.id)!;
    if (!seat.userId) continue;
    const candidate: RankedRegistration = {
      userId: seat.userId,
      score: seat.score,
      rank: entry.rank,
    };
    const current = best.get(seat.userId);
    if (
      !current ||
      candidate.rank < current.rank ||
      (candidate.rank === current.rank && candidate.score > current.score)
    ) {
      best.set(seat.userId, candidate);
    }
  }
  return [...best.values()];
}

/** The result of granting XP for one game. */
export interface GameGrantResult {
  /** Accounts that received a grant in this call (empty when already granted). */
  granted: string[];
  /** Accounts that already had a grant and were skipped (idempotency). */
  skipped: string[];
}

/**
 * Grant the XP, level-ups and level rewards for one finished game.
 *
 * Idempotent: the `XpLedger` unique key makes a second call a no-op, so a
 * retried `end`, a reconnect or a duplicate event can never pay twice. Every
 * write for one account happens in a single transaction, so a partial grant can
 * never be observed.
 *
 * Only **registered** players (`GamePlayer.userId`) are granted; guests are
 * skipped (their progress is only claimable through the Phase 6.8.2 flow).
 */
export async function grantProgressForGame(gameId: string): Promise<GameGrantResult> {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game || game.phase !== 'end') return { granted: [], skipped: [] };
  // A game in which no question was ever opened has nothing to grant: the score
  // would be 0 and the bonus 0. Skipping keeps the ledger free of empty rows.
  if (game.currentIndex < 0) return { granted: [], skipped: [] };

  const seats = await prisma.gamePlayer.findMany({
    where: { gameId },
    select: {
      id: true,
      userId: true,
      score: true,
      correctCount: true,
      totalTimeMs: true,
      joinedAt: true,
    },
  });
  const registrations = bestRegisteredSeats(seats, gameTieBreak(game.settings));
  if (registrations.length === 0) return { granted: [], skipped: [] };

  const granted: string[] = [];
  const skipped: string[] = [];

  for (const registration of registrations) {
    const wrote = await grantForRegistration(gameId, registration);
    if (wrote) granted.push(registration.userId);
    else skipped.push(registration.userId);
  }

  return { granted, skipped };
}

/**
 * Grant one account's XP for one game, in a single transaction.
 *
 * Returns `true` when a grant was written, `false` when the ledger already held
 * the `game` row (already processed). A unique-key collision from a concurrent
 * call is treated the same as "already granted".
 */
async function grantForRegistration(
  gameId: string,
  registration: RankedRegistration,
): Promise<boolean> {
  const { base, placementBonus } = xpGrantForGame(registration.score, registration.rank);

  try {
    return await prisma.$transaction(async (tx) => {
      const already = await tx.xpLedger.findUnique({
        where: {
          userId_gameId_reason: {
            userId: registration.userId,
            gameId,
            reason: XP_REASON_GAME,
          },
        },
        select: { id: true },
      });
      if (already) return false;

      const profile = await tx.playerProfile.upsert({
        where: { userId: registration.userId },
        create: { userId: registration.userId },
        update: {},
      });

      const levelBefore = profile.level;
      const xpBefore = profile.xp;

      // The two ledger rows of one game. `game` is always written (even for 0),
      // so it is the idempotency anchor; `placement` only when a bonus is due.
      await tx.xpLedger.create({
        data: {
          userId: registration.userId,
          amount: base,
          reason: XP_REASON_GAME,
          gameId,
          levelBefore,
          levelAfter: levelBefore,
        },
      });

      let totalXp = xpBefore + base;
      if (placementBonus > 0) {
        await tx.xpLedger.create({
          data: {
            userId: registration.userId,
            amount: placementBonus,
            reason: XP_REASON_PLACEMENT,
            gameId,
            levelBefore,
            levelAfter: levelBefore,
          },
        });
        totalXp += placementBonus;
      }

      const levelAfter = levelForXp(totalXp);

      await tx.playerProfile.update({
        where: { userId: registration.userId },
        data: { xp: totalXp, level: levelAfter },
      });

      // Grant the reward of every level this credit reached, for the account's
      // currently chosen character. `levelBefore` is the **recomputed** level of
      // the stored XP total (never the stored `level` column), so the reward is
      // correct even when the level curve changed and the stored value is stale:
      // a grant can then cross levels the old curve never recognised.
      const chosenCharacter = profile.selectedCharacterId;
      const effectiveBefore = levelForXp(xpBefore);
      const unlockedItemIds: string[] = [];
      for (let level = effectiveBefore + 1; level <= levelAfter; level += 1) {
        const item = levelRewardItem(level, chosenCharacter);
        if (item) unlockedItemIds.push(item.id);
      }
      if (unlockedItemIds.length > 0) {
        await tx.playerInventory.createMany({
          data: unlockedItemIds.map((itemId) => ({
            userId: registration.userId,
            itemId,
            source: 'level',
          })),
          skipDuplicates: true,
        });
      }

      await unlockAchievements(tx, registration.userId, levelAfter);
      return true;
    });
  } catch (error) {
    // A concurrent grant for the same (user, game) collides on the unique key;
    // that is exactly "already granted", so it is not an error.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return false;
    }
    throw error;
  }
}

/**
 * Unlock every achievement the account now meets, and grant its reward item.
 *
 * `createMany` with `skipDuplicates` plus the `@@unique` key make this
 * idempotent. The context is computed inside the transaction from the rows just
 * written, so a level reached by this very credit is reflected immediately.
 */
async function unlockAchievements(tx: Db, userId: string, level: number): Promise<void> {
  const aggregates = await aggregatesFor(tx, userId);
  const context: AchievementContext = { ...aggregates, level };

  const earned = achievementsEarned(context);
  if (earned.length === 0) return;

  const existing = await tx.playerAchievement.findMany({
    where: { userId },
    select: { achievementId: true },
  });
  const have = new Set(existing.map((row) => row.achievementId));
  const fresh = earned.filter((id) => !have.has(id));
  if (fresh.length === 0) return;

  await tx.playerAchievement.createMany({
    data: fresh.map((achievementId) => ({ userId, achievementId })),
    skipDuplicates: true,
  });

  const rewardItemIds = fresh
    .map((id) => ACHIEVEMENT_CATALOGUE.find((entry) => entry.id === id)?.rewardItemId ?? null)
    .filter((id): id is string => id !== null);
  if (rewardItemIds.length > 0) {
    await tx.playerInventory.createMany({
      data: rewardItemIds.map((itemId) => ({ userId, itemId, source: 'achievement' })),
      skipDuplicates: true,
    });
  }
}

/** The equipped item ids of an avatar configuration. */
function equippedItemIds(config: AvatarConfig | null): Set<string> {
  if (!config) return new Set();
  return new Set(
    Object.values(config.equipment).filter((value): value is string => typeof value === 'string'),
  );
}

/** Read a stored avatar configuration defensively (mirrors `profileService`). */
function readStoredAvatar(raw: unknown): AvatarConfig | null {
  if (raw === null || raw === undefined) return null;
  const { config } = validateAvatarConfig(raw);
  return config ?? null;
}

/**
 * Reconcile an account's level-reward inventory with its current level and
 * character (Phase 6.8.4).
 *
 * Inserts exactly the reward items the account has **earned** for the currently
 * chosen character — the items of levels 2..`level` — using `skipDuplicates`, so
 * a repeated call writes nothing. Returns the number of rows actually inserted.
 *
 * This is the one mechanism that keeps an existing account correct across a curve
 * change (an account that reached a level under the old curve gets its items) and
 * across a character change (the new character's earned items are granted, and an
 * item is never transferred between characters). It never touches XP.
 */
export async function reconcileLevelRewards(
  userId: string,
  level: number,
  characterId: string | null,
): Promise<number> {
  if (!characterId) return 0;
  const earned = rewardItemsUpToLevel(level, characterId);
  if (earned.length === 0) return 0;
  const result = await prisma.playerInventory.createMany({
    data: earned.map((item) => ({ userId, itemId: item.id, source: 'level' })),
    skipDuplicates: true,
  });
  return result.count;
}

/** The account's XP, level and progress to the next level. */
export async function getProgressView(userId: string): Promise<ProgressView> {
  const profile = await ensureProfile(userId);
  // The stored `level` column can be stale after a curve change; the level the
  // player sees is always derived from the stored XP total, and the materialised
  // column is repaired to match on read (idempotent, XP untouched).
  const level = levelForXp(profile.xp);
  if (level !== profile.level) {
    await prisma.playerProfile.update({ where: { userId }, data: { level } });
  }
  await reconcileLevelRewards(userId, level, profile.selectedCharacterId);
  const [achievementsUnlocked, itemsOwned] = await Promise.all([
    prisma.playerAchievement.count({ where: { userId } }),
    prisma.playerInventory.count({ where: { userId } }),
  ]);
  return {
    xp: profile.xp,
    level,
    progress: levelProgress(profile.xp),
    nextRewardLevel: nextRewardLevel(level) ?? null,
    achievementsUnlocked,
    itemsOwned,
  };
}

/**
 * The account's inventory for its **active** character.
 *
 * Only the active character's items are listed (Phase 5c §3.2: items are
 * character-exclusive). An item is owned when a `PlayerInventory` row exists for
 * it; the level-reward rows are reconciled first, so an account that has earned a
 * level always sees (and can equip) its reward. A locked item is shown with its
 * unlock level when the matrix defines one, and an honest "to be defined"
 * otherwise — never an invented condition.
 */
export async function getInventoryView(userId: string): Promise<InventoryView> {
  const profile = await ensureProfile(userId);
  const characterId = profile.selectedCharacterId;
  if (!characterId) return { characterId: null, items: [] };

  const level = levelForXp(profile.xp);
  await reconcileLevelRewards(userId, level, characterId);

  const items = cosmeticsForCharacter(characterId);
  const rows = await prisma.playerInventory.findMany({ where: { userId } });
  const sources = new Map(rows.map((row) => [row.itemId, row.source]));
  const equipped = equippedItemIds(readStoredAvatar(profile.avatarConfig));

  const view: InventoryItemView[] = items.map((item) => {
    const owned = sources.has(item.id);
    const unlockLevel = owned ? null : (unlockLevelForItem(item) ?? null);
    return {
      item,
      owned,
      source: sources.get(item.id) ?? null,
      equipped: equipped.has(item.id),
      unlockLevel,
      unlockHint: owned
        ? null
        : unlockLevel !== null
          ? `Unlocks at level ${unlockLevel}.`
          : 'Unlock condition to be defined.',
    };
  });
  return { characterId, items: view };
}

/** The account's achievements with progress. */
export async function getAchievementsView(userId: string): Promise<AchievementsView> {
  const context = await achievementContextForUser(userId);
  const rows = await prisma.playerAchievement.findMany({ where: { userId } });
  const byId = new Map(rows.map((row) => [row.achievementId, row.unlockedAt]));
  return {
    achievements: ACHIEVEMENT_CATALOGUE.map((achievement) => {
      const unlockedAt = byId.get(achievement.id) ?? null;
      const progress = achievementProgress(context, achievement, unlockedAt !== null);
      return {
        achievement,
        earned: unlockedAt !== null,
        unlockedAt: unlockedAt ? unlockedAt.toISOString() : null,
        current: progress.current,
        threshold: progress.threshold,
        ratio: progress.ratio,
      };
    }),
  };
}

/** The empty avatar configuration for a character (nothing equipped). */
function emptyEquipment(): AvatarConfig['equipment'] {
  return {
    visor: null,
    outfit: null,
    backpack: null,
    neckAccessory: null,
    wristAccessory: null,
  };
}

/** Whether the account owns an item of its active character. */
async function ownsItem(userId: string, itemId: string): Promise<boolean> {
  const row = await prisma.playerInventory.findUnique({
    where: { userId_itemId: { userId, itemId } },
    select: { id: true },
  });
  return row !== null;
}

/** Write a validated avatar configuration as the account's stored equipment. */
async function writeAvatar(userId: string, config: AvatarConfig): Promise<AvatarConfig> {
  await prisma.playerProfile.update({
    where: { userId },
    data: {
      selectedCharacterId: config.characterId,
      avatarConfig: config as unknown as Prisma.InputJsonValue,
    },
  });
  return config;
}

/**
 * Equip an owned item of the account's active character.
 *
 * The item must exist, belong to the **active** character and be owned. The
 * resulting configuration is validated by the shared rule before it is stored, so
 * a manipulated request can never equip another character's item or an item the
 * account does not own. The server is the only writer.
 */
export async function equipItem(userId: string, body: unknown): Promise<AvatarConfig> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('A JSON object is required.', [
      { path: '', message: 'A JSON object is required.' },
    ]);
  }
  const record = body as Record<string, unknown>;
  const issues: Array<{ path: string; message: string }> = [];
  for (const key of Object.keys(record)) {
    if (key !== 'itemId') issues.push({ path: key, message: 'This field cannot be changed.' });
  }
  const itemId = record.itemId;
  if (typeof itemId !== 'string' || itemId.trim().length === 0) {
    issues.push({ path: 'itemId', message: 'An item id is required.' });
  }
  if (issues.length > 0) throw invalid('The equip request is invalid.', issues);

  const item = findCosmetic(itemId as string);
  if (!item) {
    throw invalid('The equip request is invalid.', [
      { path: 'itemId', message: `Unknown item "${itemId}".` },
    ]);
  }

  const profile = await ensureProfile(userId);
  const characterId = profile.selectedCharacterId;
  if (!characterId || item.characterId !== characterId) {
    throw invalid('The equip request is invalid.', [
      { path: 'itemId', message: 'The item does not belong to your active character.' },
    ]);
  }

  // Make sure any earned reward is owned before the ownership test, so a player
  // who just reached the level can equip the item immediately.
  await reconcileLevelRewards(userId, levelForXp(profile.xp), characterId);

  if (!(await ownsItem(userId, item.id))) {
    throw invalid('The equip request is invalid.', [
      { path: 'itemId', message: 'You do not own this item yet.' },
    ]);
  }

  const current = readStoredAvatar(profile.avatarConfig) ?? {
    characterId,
    equipment: emptyEquipment(),
  };
  const next: AvatarConfig = {
    characterId,
    equipment: { ...current.equipment, [item.slot]: item.id },
  };
  const { config, issues: configIssues } = validateAvatarConfig(next);
  if (!config) throw invalid('The equip request is invalid.', configIssues);

  return writeAvatar(userId, config);
}

/**
 * Unequip the item in one slot of the account's active character.
 *
 * Clears exactly one slot; the other slots are untouched. A slot that is already
 * empty is a no-op. The server is the only writer, so the client can never clear
 * a slot of a character it does not own — the character comes from the session's
 * own profile.
 */
export async function unequipItem(userId: string, body: unknown): Promise<AvatarConfig> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('A JSON object is required.', [
      { path: '', message: 'A JSON object is required.' },
    ]);
  }
  const record = body as Record<string, unknown>;
  const issues: Array<{ path: string; message: string }> = [];
  for (const key of Object.keys(record)) {
    if (key !== 'slot') issues.push({ path: key, message: 'This field cannot be changed.' });
  }
  const slot = record.slot;
  if (!isEquipmentSlot(slot)) {
    issues.push({ path: 'slot', message: 'A valid equipment slot is required.' });
  }
  if (issues.length > 0) throw invalid('The unequip request is invalid.', issues);
  const equipmentSlot = slot as EquipmentSlot;

  const profile = await ensureProfile(userId);
  const characterId = profile.selectedCharacterId;
  if (!characterId) {
    throw invalid('The unequip request is invalid.', [
      { path: 'slot', message: 'You have not chosen a character yet.' },
    ]);
  }

  const current = readStoredAvatar(profile.avatarConfig) ?? {
    characterId,
    equipment: emptyEquipment(),
  };
  const next: AvatarConfig = {
    characterId,
    equipment: { ...current.equipment, [equipmentSlot]: null },
  };
  const { config, issues: configIssues } = validateAvatarConfig(next);
  if (!config) throw invalid('The unequip request is invalid.', configIssues);

  return writeAvatar(userId, config);
}
