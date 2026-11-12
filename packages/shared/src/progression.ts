/**
 * Player progression: the level curve, the XP grant and the achievement rules
 * (Phase 6.8.4).
 *
 * **Binding product decisions:**
 *   - **XP equal the game points** a player scored for their answers. There is
 *     deliberately **no second XP formula** — the existing scoring stays the
 *     authority and this module never recomputes a point.
 *   - **Placement bonus**, granted once, *after* the final placement is known and
 *     **not** folded back into the game score: 1st +1500, 2nd +1000, 3rd +500.
 *     A **tie** gives every tied player the **same** bonus (the rank comes from
 *     the existing `rankPlayers`, which already assigns shared ranks).
 *   - **Level curve (Phase 6.8.4, binding):**
 *     `requiredXp(level) = 100000 + (level - 1) * 10000`, where `level` is the
 *     **current** level and `requiredXp` the XP still needed to climb to the
 *     next one. Level 1 starts at 0 XP, so the climb 1 → 2 costs 100,000,
 *     2 → 3 costs 110,000, 3 → 4 costs 120,000, and so on.
 *
 * Everything here is pure and total, so the same rules run in a unit test and on
 * the server. The server is the only place that grants XP; nothing here is ever
 * trusted from the client.
 *
 * **XP is never destroyed by a curve change.** The curve only reinterprets an
 * account's stored XP total: `PlayerProfile.xp` is the truth and the level is
 * derived from it on every read. Replacing the curve can therefore *lower* the
 * level an existing account displays (the new climbs are far more expensive) —
 * that is a re-interpretation, never a deletion or a duplication of XP.
 */

import type { Achievement } from './achievements.js';
import type { CosmeticItem } from './cosmetics.js';

/**
 * The XP needed to climb **from** `level` to `level + 1`
 * (`game-design-concept.md` §5.4, Phase 6.8.4):
 *
 * `requiredXp(level) = 100000 + (level - 1) * 10000`.
 */
export function requiredXp(level: number): number {
  // Levels below 1 do not exist; treat them as the first climb for safety.
  const current = Math.max(1, Math.floor(level));
  return 100_000 + (current - 1) * 10_000;
}

/**
 * The total XP required to **reach** a level. Level 1 requires 0.
 *
 * `xpForLevel(1) === 0`, `xpForLevel(2) === 100_000`, `xpForLevel(3) === 210_000`,
 * `xpForLevel(4) === 330_000`, … matching the binding table in
 * `game-design-concept.md` §5.4.
 */
export function xpForLevel(level: number): number {
  const target = Math.max(1, Math.floor(level));
  let total = 0;
  for (let step = 2; step <= target; step += 1) {
    total += requiredXp(step - 1);
  }
  return total;
}

/**
 * The level a total XP amount reaches.
 *
 * A single grant may cross **several** level boundaries; this returns the highest
 * level whose threshold is met, so a large grant is never under-counted.
 */
export function levelForXp(xp: number): number {
  const total = Math.max(0, Math.floor(xp));
  let level = 1;
  // Bounded: the loop stops as soon as the next threshold is out of reach.
  while (xpForLevel(level + 1) <= total) level += 1;
  return level;
}

/** A player's progress within their current level. */
export interface LevelProgress {
  /** The current level (>= 1). */
  level: number;
  /** XP accumulated inside the current level. */
  xpIntoLevel: number;
  /** XP needed to leave the current level (the current level's full span). */
  xpForThisLevel: number;
  /** XP still missing to reach the next level. */
  xpToNextLevel: number;
  /** The next level (always `level + 1`). */
  nextLevel: number;
  /** Fraction of the way to the next level, in `[0, 1)`. */
  ratio: number;
}

/**
 * Break a total XP amount down for display: current level, progress inside it,
 * and what is still needed for the next level. Pure; never mutates anything.
 */
export function levelProgress(xp: number): LevelProgress {
  const total = Math.max(0, Math.floor(xp));
  const level = levelForXp(total);
  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  const span = ceiling - floor;
  const into = total - floor;
  return {
    level,
    xpIntoLevel: into,
    xpForThisLevel: span,
    xpToNextLevel: ceiling - total,
    nextLevel: level + 1,
    ratio: span <= 0 ? 0 : into / span,
  };
}

/**
 * The one-time placement bonus for a rank, in XP.
 *
 * Ranks 1/2/3 give 1500/1000/500; every other rank gives 0. A shared rank (a tie
 * from `rankPlayers`, e.g. `1, 1, 3`) passes the same rank for every tied player,
 * so they all receive the same bonus — the fairness rule from
 * `game-design-concept.md` §5.3.
 */
export function placementBonus(rank: number): number {
  if (rank === 1) return 1_500;
  if (rank === 2) return 1_000;
  if (rank === 3) return 500;
  return 0;
}

/** The XP breakdown for one finished game. */
export interface XpGrant {
  /** The player's game points, granted verbatim as XP. */
  base: number;
  /** The placement bonus (0 when the rank is 4 or lower). */
  placementBonus: number;
  /** `base + placementBonus`. */
  total: number;
}

/**
 * The XP a player earns from one finished game.
 *
 * `score` is the persisted `GamePlayer.score` (already computed by the engine) and
 * `rank` the placement from `rankPlayers`. This function **never** recomputes a
 * point: it adds the documented placement bonus on top.
 */
export function xpGrantForGame(score: number, rank: number): XpGrant {
  const base = Math.max(0, Math.floor(score));
  const bonus = placementBonus(rank);
  return { base, placementBonus: bonus, total: base + bonus };
}

/**
 * The reason string stored on an `XpLedger` row for a game's question points.
 * Together with `userId` and `gameId` it forms the unique idempotency key.
 */
export const XP_REASON_GAME = 'game';

/** The reason string stored for a game's placement bonus. */
export const XP_REASON_PLACEMENT = 'placement';

// ---------------------------------------------------------------------------
// API view types (Phase 6.8)
//
// The shapes the progression endpoints return. Declared in `shared` so the
// backend produces them and the frontend consumes them with one definition.
// ---------------------------------------------------------------------------

/** `GET /api/progress` — the account's XP, level and progress to the next level. */
export interface ProgressView {
  xp: number;
  level: number;
  progress: LevelProgress;
  /** The next level that grants a reward, or `null` when the matrix defines none. */
  nextRewardLevel: number | null;
  /** How many achievements are unlocked, for a quick profile summary. */
  achievementsUnlocked: number;
  /** How many items the account owns. */
  itemsOwned: number;
}

/** One item in the inventory, with its ownership and equipment state. */
export interface InventoryItemView {
  item: CosmeticItem;
  /** Whether the account owns (may equip) it. */
  owned: boolean;
  /** How it was obtained (`default`/`level`/`achievement`/`grant`), or `null`. */
  source: string | null;
  /** Whether it is currently equipped on the active character. */
  equipped: boolean;
  /**
   * The level at which this item is unlocked, or `null` when it is owned or the
   * reward matrix defines no level for it. Phase 6.8.4: a locked item states the
   * level it unlocks at, so the condition is concrete rather than a placeholder.
   */
  unlockLevel: number | null;
  /**
   * A plain-language unlock hint for a locked item, or `null` for an owned one.
   * Never an invented requirement: it names the unlock level when the matrix
   * defines one, and otherwise states honestly that the condition is undefined.
   */
  unlockHint: string | null;
}

/** `GET /api/inventory` — the active character's items with ownership. */
export interface InventoryView {
  /** The account's currently chosen character, or `null`. */
  characterId: string | null;
  items: InventoryItemView[];
}

/** One achievement with its unlock state and progress. */
export interface AchievementView {
  achievement: Achievement;
  earned: boolean;
  /** ISO timestamp of the unlock, or `null`. */
  unlockedAt: string | null;
  current: number;
  threshold: number;
  ratio: number;
}

/** `GET /api/achievements` — every achievement with progress. */
export interface AchievementsView {
  achievements: AchievementView[];
}
