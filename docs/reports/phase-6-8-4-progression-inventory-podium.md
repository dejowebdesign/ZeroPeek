# Phase 6.8.4 – Progression, Inventory & Game Presentation

- **Branch:** `feat/phase-6-8-4-progression-inventory-podium` (from `main` = `7676880`)
- **Scope:** the three gaps left open at the end of 6.8.3 — the **level curve**, the
  **level-reward matrix**, and the **in-game player presentation** — plus the inventory
  equip/unequip management that the reward matrix makes necessary.
- **Status:** work complete on the branch, **awaiting owner approval** — no push, no pull request,
  no merge, no deploy yet.

## 0. Result in one sentence

The level curve, the slot-based reward matrix and the inventory equip/unequip management are
implemented and reconciled server-side, and the in-game / beamer surfaces now show the real
character head in the round and the full figure on the winner podium — all with no schema
change and no invented asset.

## 1. Starting point (verified in the code, not assumed)

Phase 6.8.3 shipped the server-authoritative XP ledger, the placement bonus, the inventory,
the achievements and the guest-round claim. Three items were left open and are the subject of
this phase:

1. **The level curve was the old Phase 5c table** (10,000 XP per level up to 10, then
   +1,000 per level). The owner has since fixed a different curve.
2. **The reward matrix was empty.** Every cosmetic item carried `unlockStatus: 'available'`
   and was treated as owned from the start; there was no level → item mapping, and a locked
   item had no concrete condition.
3. **The player was not shown with their character in the round**, and the equipment editor
   lived on the profile page while the inventory only listed items.

## 2. Binding decisions applied

| Decision                   | Value                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Level curve                | `requiredXp(level) = 100000 + (level − 1) × 10000`; level 1 = 0 XP                 |
| Level 1 equipment          | **None.** A fresh account owns nothing and wears nothing                           |
| Reward per level-up        | **Exactly one** item, for the **currently chosen** character                       |
| Reward matrix (slot-based) | L2 → outfit, L3 → backpack, L4 → neck accessory, L5 → visor, L6 → wrist accessory  |
| Levels 7+                  | **No entry** — grants nothing, never blocks the XP credit or the level computation |
| Character exclusivity      | An item is granted/equipped only for its own character; never transferred          |
| Placement bonus            | Unchanged: 1st 1500, 2nd 1000, 3rd 500, ties share the rank                        |

These are recorded in `docs/concept/game-design-concept.md` §5.4, §6.2b and §6.6 and in
`docs/roadmap/technical-roadmap.md` §9.1.

## 3. Changes

### 3.1 Shared (`@zeropeek/shared`)

| File                  | Change                                                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/progression.ts`  | `xpCostForLevel` replaced by `requiredXp(level)` with the new curve; `xpForLevel` sums the new curve; `ProgressView` gains `nextRewardLevel`, `achievementsUnlocked`, `itemsOwned`; `InventoryItemView` gains `unlockLevel`. |
| `src/levelRewards.ts` | New slot-based matrix `LEVEL_REWARDS` and the pure helpers `levelRewardEntry`, `rewardSlotForLevel`, `levelRewardItem`, `levelsWithRewards`, `nextRewardLevel`, `unlockLevelForItem`, `rewardItemsUpToLevel`.                |
| `src/characters.ts`   | `defaultAvatarConfig` now starts with **nothing equipped** (`EMPTY_EQUIPMENT`); the old "default kit" is gone.                                                                                                               |
| `src/cosmetics.ts`    | Removed the fabricated `unlockStatus` (and the never-used `locked` state) from the catalogue; ownership now comes only from the reward matrix and persisted inventory rows.                                                  |

The curve and the matrix are **pure** functions in one place, so a unit test and the server run
the identical rule. Nothing here is trusted from the client.

### 3.2 Backend

| File                                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/services/progressionService.ts` | `grantProgressForGame` grants one level-reward item per crossed level for the chosen character inside the same transaction as the XP; `reconcileLevelRewards` inserts the earned reward items idempotently (`skipDuplicates`); `getProgressView`/`getInventoryView` derive the level from the stored XP (repairing the `level` column) and reconcile before returning; `equipItem`/`unequipItem` validate against the character-exclusive catalogue and ownership. |
| `src/routes/progressRoutes.ts`       | New `POST /api/inventory/unequip`; the equip route unchanged in shape.                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/routes/profileRoutes.ts`        | `PUT /api/profile` reconciles the new character's earned rewards after a character change (idempotent).                                                                                                                                                                                                                                                                                                                                                            |

Design points worth stating explicitly:

- **XP is never destroyed by a curve change.** `PlayerProfile.xp` is the truth; the level is
  derived from it on every read and the stored `level` column is repaired to match. A more
  expensive curve can lower the _displayed_ level of an existing account — that is a
  re-interpretation, not a deletion or a duplication.
- **The reward matrix is slot-based, not item-based.** A level names a _slot_; the concrete
  item is the chosen character's own item in that slot. This keeps the matrix
  character-independent (Ethan and Maya share it) and extensible (level 7+ is one more entry),
  and it never invents an item.
- **Reconciliation is the single mechanism** that keeps three cases correct: an existing
  account that reached a level under the old curve still receives its items; a character
  change grants the new character's earned items (only the _right_ to own them — an item is
  never transferred); and a repeated call can never duplicate a row.

### 3.3 Frontend

| File                     | Change                                                                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/avatar.ts`          | `playerAvatar` gains a `crop: 'head' \| 'full'` option (CSS framing only, no image editing); new `playerBadge(nickname, avatarId, progress)` shows the head portrait, name and — for a signed-in player — the real level and XP. |
| `src/showView.ts`        | `leaderboardRow` uses the head crop; `podiumPlace` uses the full figure.                                                                                                                                                         |
| `src/pages/player.ts`    | Reads `/api/progress` once at boot (best-effort) and shows the player's own head + level in the round header.                                                                                                                    |
| `src/pages/profile.ts`   | Removed the equipment editor; the profile keeps the character choice and statistics and points to the inventory.                                                                                                                 |
| `src/pages/inventory.ts` | Owns the equipment: a loadout card with per-slot **Unequip**, and each item offers **Equip** (owned) or **Unequip** (worn). Locked items show the server's unlock level.                                                         |
| `src/styles/tokens.css`  | Additive rules only: `.player-avatar--head`, `.player-avatar--full`, `.player-avatar--art`, `.player-badge*`, `.avatar__loadout-*`. No new colour, blur or radius value.                                                         |

## 4. Data and migration

**None.** No schema change, no migration, no new column and no new dependency. `PlayerInventory`,
`PlayerAchievement`, `XpLedger` and `PlayerProfile` already existed from Phase 6.8. The change is
behaviour and rendering only, so it is safe to apply to a populated database.

## 5. Test results

| Check                               | Result         |
| ----------------------------------- | -------------- |
| Shared tests                        | 165/165 passed |
| Backend tests (incl. PostgreSQL)    | 350/350 passed |
| Frontend tests                      | 458/458 passed |
| TypeScript typecheck (all packages) | clean          |
| Lint (all packages)                 | clean          |
| Prettier (`format:check .`)         | clean          |

New / updated coverage:

- `packages/shared/src/progression.test.ts` — the new curve (`requiredXp` 100k/110k/120k,
  `xpForLevel` 0/100k/210k/330k), a multi-level credit, and the level from a stored XP total.
- `packages/shared/src/characters.test.ts` / `achievements.test.ts` — the empty start kit, the
  slot-based matrix, the next-reward level, an item's unlock level and `rewardItemsUpToLevel`.
- `packages/backend/src/progression.integration.test.ts` — the new curve against a real
  PostgreSQL: a single credit crossing several levels, XP preserved across a curve change, and
  the level reward granted once and idempotently.
- `packages/frontend/src/avatar.test.ts`, `showView.test.ts`, `inventory.test.ts`,
  `profile.test.ts`, `design-system.test.ts` — the head/full crop, the player badge, the
  equip/unequip calls with the CSRF token, and the profile/inventory split.

## 6. Bestandsschutz (regression check)

- No quiz, question, answer, account, role, permission or game record is touched.
- The XP ledger and its `@@unique([userId, gameId, reason])` idempotency key are unchanged, so a
  repeated game-end still pays exactly once.
- No API contract was removed: `POST /api/inventory/unequip` is new; the existing endpoints keep
  their request and response shapes.
- Existing avatar configurations are read defensively; a stored config with a now-empty default
  kit is still valid.
- The scoring engine is untouched — XP equals the game points, as before.

## 7. Open product decisions (for the owner, not decided here)

1. **Reward matrix for level 7 and above.** Not defined by the owner, so it grants nothing today.
   It is a single-place addition to `LEVEL_REWARDS`.
2. **Rewards for the characters without artwork** (Pixel, the bee, Dr. Obscura, O-Bot). They own
   no items yet, so a level-up for them defers the reward rather than inventing an asset.
3. **Achievement names and conditions.** Still the Phase 5c proposals; not changed here.
