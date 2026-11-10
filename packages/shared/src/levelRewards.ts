/**
 * Level-reward catalogue (Phase 6.8).
 *
 * **Binding rule:** every level-up unlocks **one cosmetic item** of the player's
 * currently chosen character (`game-design-concept.md` §6.2/§6.2a). Items are
 * character-exclusive, deterministic (no randomness, no loot box) and purely
 * cosmetic — never an advantage.
 *
 * **This catalogue is deliberately empty and provisional.** The mapping
 * level → item is an **open product decision** (`§6.2a`/`§16.2`) and no reward
 * artwork exists yet beyond each character's default kit (which every player
 * already owns). Inventing items or artwork is forbidden, so until the owner
 * approves the reward matrix a level-up grants **no** item and the progression
 * service records the level-up honestly.
 *
 * When the matrix is approved it is filled in here — one place, no code change in
 * the service. Each entry names a real `CosmeticItem` id from `cosmetics.ts`.
 */

import { findCosmetic, type CosmeticItem } from './cosmetics.js';

/** One level-reward entry: reaching `level` unlocks `itemId`. */
export interface LevelReward {
  level: number;
  /** A real cosmetic item id from the character-exclusive catalogue. */
  itemId: string;
}

/**
 * The provisional reward matrix. **Empty until approved.**
 *
 * Every item in `cosmetics.ts` today is a character default, already owned, so
 * there is nothing correct to grant yet. A level-up with no entry grants nothing.
 */
export const LEVEL_REWARDS: readonly LevelReward[] = [];

/**
 * The item a level-up unlocks, or `undefined` when the matrix has no entry.
 *
 * A returned item is always resolved against the live catalogue, so a stale or
 * mistyped id can never grant a non-existent item.
 */
export function levelRewardItem(level: number): CosmeticItem | undefined {
  const entry = LEVEL_REWARDS.find((reward) => reward.level === level);
  if (!entry) return undefined;
  return findCosmetic(entry.itemId);
}

/** Every level that has a reward entry (used to show "next reward" progress). */
export function levelsWithRewards(): number[] {
  return LEVEL_REWARDS.map((reward) => reward.level).sort((a, b) => a - b);
}

/** The next level (>= `level`) that has a reward, or `undefined`. */
export function nextRewardLevel(level: number): number | undefined {
  return levelsWithRewards().find((candidate) => candidate >= level);
}
