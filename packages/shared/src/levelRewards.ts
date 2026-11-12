/**
 * Level-reward matrix (Phase 6.8.4).
 *
 * **Binding rule:** reaching a level unlocks **one cosmetic item** of the
 * player's currently chosen character (`game-design-concept.md` §6.2/§6.2a).
 * Items are character-exclusive, deterministic (no randomness, no loot box) and
 * purely cosmetic — never an advantage.
 *
 * **The matrix is slot-based, not item-based.** The phase brief fixes the reward
 * order as a *slot* per level (level 2 → outfit, level 3 → backpack, level 4 →
 * neck accessory, level 5 → visor, level 6 → wrist accessory) and states that the
 * concrete item is the **character's own** item for that slot. Resolving the
 * character at grant time keeps the reward character-exclusive without a
 * per-character table here, and lets a new character inherit the matrix
 * unchanged.
 *
 * **Levels 7 and above have no reward yet** and are deliberately absent: the
 * owner has not defined them, and no item may be invented. A level with no entry
 * grants nothing and never blocks the XP credit or the level computation — the
 * climb still happens, the reward is simply deferred until the owner fills the
 * matrix in one place (`LEVEL_REWARDS`).
 *
 * The catalogue is **code**, so the server resolves a reward against the live
 * catalogue and a client can never invent one.
 */

import { cosmeticsForSlot, type CosmeticItem, type EquipmentSlot } from './cosmetics.js';

/** One level-reward entry: reaching `level` unlocks the character's item for `slot`. */
export interface LevelReward {
  level: number;
  /** The equipment slot whose character item is unlocked at this level. */
  slot: EquipmentSlot;
}

/**
 * The binding reward matrix (phase brief §3).
 *
 * Level 1 is the starting level with **no** unlockable equipment, so it has no
 * entry. Levels 2–6 map to the five equipment slots in the brief's order. Levels
 * 7+ are intentionally absent (not yet defined by the owner).
 */
export const LEVEL_REWARDS: readonly LevelReward[] = [
  { level: 2, slot: 'outfit' },
  { level: 3, slot: 'backpack' },
  { level: 4, slot: 'neckAccessory' },
  { level: 5, slot: 'visor' },
  { level: 6, slot: 'wristAccessory' },
];

/** The reward entry for a level, or `undefined` when the matrix has no entry. */
export function levelRewardEntry(level: number): LevelReward | undefined {
  return LEVEL_REWARDS.find((reward) => reward.level === level);
}

/** The slot unlocked at a level, or `undefined` when there is no entry. */
export function rewardSlotForLevel(level: number): EquipmentSlot | undefined {
  return levelRewardEntry(level)?.slot;
}

/**
 * The item a level-up unlocks **for one character**, or `undefined`.
 *
 * Returns `undefined` when the matrix has no entry for the level, when the
 * character has no artwork (a name-only figure owns nothing yet) or when the
 * character has no item in the reward's slot. A resolved item is always taken
 * from the live catalogue, so a character without an item in that slot defers its
 * reward rather than granting a wrong or non-existent item.
 */
export function levelRewardItem(
  level: number,
  characterId: string | null | undefined,
): CosmeticItem | undefined {
  if (!characterId) return undefined;
  const slot = rewardSlotForLevel(level);
  if (!slot) return undefined;
  return cosmeticsForSlot(characterId, slot)[0];
}

/** Every level that has a reward entry, ascending. */
export function levelsWithRewards(): number[] {
  return LEVEL_REWARDS.map((reward) => reward.level).sort((a, b) => a - b);
}

/**
 * The next level **after** `level` that has a reward, or `undefined`.
 *
 * Strictly greater than the current level, so a player who has already reached a
 * reward level is shown the *next* one, never the level they are standing on.
 */
export function nextRewardLevel(level: number): number | undefined {
  return levelsWithRewards().find((candidate) => candidate > level);
}

/**
 * The level at which an item is granted, or `undefined` when it is not a level
 * reward.
 *
 * Because the matrix is slot-based and every character has at most one item per
 * slot, an item's unlock level is simply the matrix level for its slot. Used by
 * the inventory to show a locked item's unlock condition.
 */
export function unlockLevelForItem(item: Pick<CosmeticItem, 'slot'>): number | undefined {
  return LEVEL_REWARDS.find((reward) => reward.slot === item.slot)?.level;
}

/**
 * Every reward item a character has earned by reaching `level`.
 *
 * Used to reconcile an account (an existing account, or one whose character
 * changed) with the matrix: the set of items it must own for the character's
 * levels 2..`level`. Deterministic and idempotent — the caller inserts them with
 * `skipDuplicates`, so a repeated call never duplicates an item.
 */
export function rewardItemsUpToLevel(
  level: number,
  characterId: string | null | undefined,
): CosmeticItem[] {
  if (!characterId) return [];
  const items: CosmeticItem[] = [];
  for (const entry of LEVEL_REWARDS) {
    if (entry.level > level) continue;
    const item = cosmeticsForSlot(characterId, entry.slot)[0];
    if (item) items.push(item);
  }
  return items;
}
