# Phase 6.8.3 – Player surfaces: signed-in join, avatar display, profile/inventory separation

- **Branch:** `feat/phase-6-8-3-player-surface-fixes` (from `main` = `b76e5bc`)
- **Scope:** four findings from practical testing of Phase 6.6–6.8, all on the **player**
  side: joining as a signed-in player, showing the chosen avatar during the game, the
  end-of-round offer, and the profile/inventory overlap.
- **Status:** draft pull request, awaiting review (no merge, no deploy)

## 0. Result in one sentence

A signed-in player now joins a round under their own account name and avatar, is
recognised by that avatar on every surface (own screen, host lobby, leaderboard,
beamer podium), is told their round was saved instead of being offered a registration
they already have, and finds their progress and their items on two distinct pages
instead of two copies of the same cards.

## 1. Findings fixed

Practical testing reported four problems. Each is listed with the root cause that was
confirmed in the code — not assumed.

1. **A signed-in player was treated like a guest on join.** The join form always asked
   for a name, and the server always required one: `player:join` called
   `asString(payload.nickname)` unconditionally, and the client always sent the typed
   value. A logged-in player had to re-type a name they already had.
2. **The chosen character was never shown during the game.** The seat's `avatar` column
   was written from the client payload (a guest sends `''`), never from the account's
   `selectedCharacterId`, and no player surface rendered it. So even a registered player
   appeared as a bare name in the lobby, on the leaderboard and on the podium.
3. **A signed-in player was offered a registration they already had.** The end screen
   always rendered `registerOffer()` ("Create a free account"), regardless of whether the
   player was signed in — even though their round had already been granted to their
   account by `grantProgressForGame`.
4. **Profile and inventory duplicated each other.** Both pages rendered the same
   level/XP/achievement figures and the same item list, so neither had a clear purpose.

## 2. Changes

### 2.1 Backend

| File                                           | Change                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/backend/src/socket.ts`               | `player:join` resolves the player session first, then seats a **signed-in** player under `account.username` with `resolveSeatAvatar(account.id)`; a guest keeps the typed nickname and a sanitised avatar. The ACK now echoes the seated `nickname` and `avatar`, never the client's typed values. |
| `packages/backend/src/services/gameService.ts` | `joinGame` returns a typed `JoinedSeat` (now including `joinedAt`); a signed-in player who is already seated in the lobby gets their **existing** seat back (refreshed to the account name/avatar) instead of a second one. New `resolveSeatAvatar(userId)` and `sanitizeGuestAvatar(avatar)`.     |
| `packages/backend/src/services/engine.ts`      | `addPlayer` is idempotent for an existing seat: it refreshes `nickname`/`avatar` and re-emits the lobby, but never resets a live score or connection state.                                                                                                                                        |
| `packages/shared/src/events.ts`                | `player:join`'s documented contract updated: a signed-in player's `nickname` is ignored (the account name always wins).                                                                                                                                                                            |

Design points worth stating explicitly:

- **`resolveSeatAvatar` returns `''` for a character with no artwork.** Only Ethan and
  Maya have supplied artwork today; `pixel`, `bee`, `o-bot` do not. Rather than point at
  a file that does not exist, the seat stays blank and every surface falls back to a
  clean initial badge. This honours the phase brief's rule against invented image paths.
- **A signed-in player's `nickname` is ignored, not merely optional.** The player surface
  hides the name field for a signed-in account, so honouring a stray value would let the
  in-game name diverge from the account for no visible reason. If a per-round display
  name is wanted later, that is a product decision for the owner — see §6.
- **One seat per account.** Because a join reuses the account's existing seat, a single
  account can never appear twice in a lobby and can never be paid the round twice. A
  guest, having no account, keeps the previous behaviour and always gets a fresh seat;
  the duplicate-nickname rejection between two different guests is unchanged.

### 2.2 Frontend

| File                                       | Change                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/frontend/src/avatar.ts`          | New `playerAvatar(nickname, avatarId, {size})` badge: the real figure when the id names a character with artwork, a letter badge otherwise; decorative (`aria-hidden`), lazy-loaded.                                                                                              |
| `packages/frontend/src/playerView.ts`      | `lobbyRoster` shows each player's avatar; new `joinIdentityHint(username)`; new `endProgressActions(signedIn)` — the saved-progress confirmation for a signed-in player, the optional invitation for a guest.                                                                     |
| `packages/frontend/src/showView.ts`        | `leaderboardRow`/`podiumPlace` render the player's avatar.                                                                                                                                                                                                                        |
| `packages/frontend/src/pages/player.ts`    | Resolves `/api/player-auth/me` once at boot (best-effort → guest on any failure); join form hides the name field and shows the identity hint for a signed-in player; the stored session keeps the seated avatar; waiting/question/board/end screens show the player's own avatar. |
| `packages/frontend/src/pages/host.ts`      | The lobby roster shows each player's avatar.                                                                                                                                                                                                                                      |
| `packages/frontend/src/pages/profile.ts`   | Removed the duplicated Items tile; the profile owns progress, statistics and the character choice.                                                                                                                                                                                |
| `packages/frontend/src/pages/inventory.ts` | Removed the duplicated level/XP and achievement cards; the inventory owns the items, the worn equipment ("Equipped on …") and the equip management.                                                                                                                               |
| `packages/frontend/src/styles/tokens.css`  | Additive rules only: `.player-avatar*`, `.leaderboard__who`, `.question__who*`, `.lobby__me`, `.end-saved*`. No new colour, blur or radius value.                                                                                                                                 |

### 2.3 Docs

| File        | Change                                  |
| ----------- | --------------------------------------- |
| this report | Phase 6.8.3 findings, changes and tests |

## 3. Data and migration

**None.** No schema change, no migration, no new column and no new dependency. Every
value used here already existed: `GamePlayer.avatar`, `PlayerProfile.selectedCharacterId`,
the `PublicPlayer.avatar` contract and the `game:claimable` claim flow (Phase 6.8.2). The
change is behaviour and rendering only, so it is safe to apply to a populated database.

## 4. Test results

| Check                               | Result         |
| ----------------------------------- | -------------- |
| Shared tests                        | 161/161 passed |
| Backend tests (incl. PostgreSQL)    | 348/348 passed |
| Frontend tests                      | 445/445 passed |
| TypeScript typecheck (all packages) | clean          |
| Build (shared + backend + frontend) | clean          |
| Prettier (`format:check .`)         | clean          |

New coverage:

- `packages/backend/src/player-integration.integration.test.ts` (**new**, 9 tests) — drives
  the real Socket.IO layer against a real PostgreSQL: a signed-in join is seated under the
  account name and selected character, the avatar reaches the host roster and the player's
  own sync, a character without artwork stays blank, a guest stays anonymous, a stray
  nickname from a signed-in player is ignored, a second join reuses the seat (roster count
  stays 1), and two guests with the same nickname are still refused.
- `packages/frontend/src/avatar.test.ts`, `playerView.test.ts`, `showView.test.ts`,
  `profile.test.ts`, `inventory.test.ts` — the badge fallbacks, the roster/leaderboard/
  podium avatars, the saved-progress action and the profile/inventory separation.
- `packages/frontend/src/design-system.test.ts` — the new classes are registered and
  defined.

## 5. Bestandsschutz (regression check)

- No existing quiz, question, answer, account, role, permission or game record is touched.
- No API contract was removed: `player:join` gained fields in its ACK (`nickname`,
  `avatar`); the request shape is unchanged and still accepts `nickname`/`avatar`.
- The duplicate-nickname rule, the lobby-phase rule and the guest claim flow are unchanged
  and are covered by their existing suites (all still green).
- A signed-in player's round is still granted exactly once — the idempotent seat and the
  idempotent `grantProgressForGame` both guarantee it.

## 6. Open product decisions (for the owner, not decided here)

1. **Per-round display name.** Today a signed-in player always appears as their account
   name. If a custom per-round name is wanted, it needs an explicit product decision; the
   current default is deliberately "account name wins".
2. **Avatar artwork for the other characters.** Pixel, the bee and the O-Bots have no
   artwork, so they render as letter badges. The badge is the honest fallback, not a
   final design — see the asset briefing.
3. **Where the profile ends and the inventory begins.** This phase splits them as
   "progress/statistics" vs "items/equipment". If the intended split differs, it is a
   design decision to confirm before the surfaces are considered final.
