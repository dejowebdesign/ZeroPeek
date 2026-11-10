/**
 * Player progression: the level curve, the XP grant and the achievement rules
 * (Phase 6.8.3).
 *
 * **Binding product decisions (Phase 5c, `game-design-concept.md` §5):**
 *   - **XP equal the game points** a player scored for their answers. There is
 *     deliberately **no second XP formula** — the existing scoring stays the
 *     authority and this module never recomputes a point.
 *   - **Placement bonus**, granted once, *after* the final placement is known and
 *     **not** folded back into the game score: 1st +1500, 2nd +1000, 3rd +500.
 *     A **tie** gives every tied player the **same** bonus (the rank comes from
 *     the existing `rankPlayers`, which already assigns shared ranks).
 *   - **Level curve:** level 1 starts at 0 XP; the climbs from level 1 to 10 cost
 *     10,000 XP each; from level 10 to 11 the cost is 11,000, and every further
 *     climb costs 1,000 more than the previous one.
 *
 * Everything here is pure and total, so the same rules run in a unit test and on
 * the server. The server is the only place that grants XP; nothing here is ever
 * trusted from the client.
 */

import type { Achievement } from './achievements.js';
import type { CosmeticItem } from './cosmetics.js';

/** The XP cost to climb **from** `level` to `level + 1`. */
export function xpCostForLevel(level: number): number {
  // Levels below 1 do not exist; treat them as the first climb for safety.
  const target = Math.max(1, Math.floor(level)) + 1;
  // Climbs into levels 2..10 cost 10,000 each.
  if (target <= 10) return 10_000;
  // From level 11 on the cost is 11,000 for the climb into 11, then +1,000 each:
  // 11,000 · 12,000 · 13,000 … which is exactly `1,000 × target`.
  return 1_000 * target;
}

/**
 * The total XP required to **reach** a level. Level 1 requires 0.
 *
 * `xpForLevel(1) === 0`, `xpForLevel(2) === 10_000`, …, `xpForLevel(11) === 101_000`,
 * `xpForLevel(12) === 113_000` — matching the binding table in
 * `game-design-concept.md` §5.4.
 */
export function xpForLevel(level: number): number {
  const target = Math.max(1, Math.floor(level));
  let total = 0;
  for (let step = 2; step <= target; step += 1) {
    total += xpCostForLevel(step - 1);
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
  /** The next level that grants a reward, or `null` while the matrix is empty. */
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
   * A plain-language unlock hint for a locked item, or `null` for an owned one.
   * Never an invented requirement: while the reward matrix is unapproved this
   * states honestly that the unlock condition is not yet defined.
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
