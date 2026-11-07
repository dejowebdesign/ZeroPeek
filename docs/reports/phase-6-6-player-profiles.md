# Phase 6.6 – Player profiles (report)

- **Branch:** `feat/phase-6-6-player-profiles`
- **Base:** `main` after PR #32 (`9f643cb`)
- **Scope:** the durable player profile (roadmap §7) — one `PlayerProfile` per registered
  account, its own **personal statistics** computed server-side, and a **secure link** between
  an account and the games it actually played
- **Status:** implemented, awaiting review
- **Decisions (chrisB, Phase 5c):** the personal statistic is **separate** from the quiz history;
  the history (old questions/answers, other players' results) stays **admin-only**, so there is
  **no** `/api/profile/history`. **No IP address is stored** (open question Q5, assigned to 6.6).

Phase 6.6 turns the "coming with Phase 6.6" placeholder into a real page. A signed-in account
gets a profile with its own won games, podiums and accuracy. The hard part is not the page — it
is **attribution**: a statistic may only count a game the account actually played, and every
number must be computed by the server, never accepted from the browser.

The phase adds **one table and one nullable column**, both additive. No user account, role,
permission, question, answer, API route or engine rule is removed or rewritten, and no existing
row changes. Existing guest seats keep `user_id = NULL` and stay exactly as they were.

## 1. What changed

```
player:join (socket) ──► resolveSession(cookie) ─┬─ session? ─► engine.join(…, userId)
                                                 └─ none     ─► engine.join(…, undefined)
                                                                      │
                                                                      ▼
                                                       GamePlayer.userId = account id | null

GET /api/profile  ──► profileService.getProfile(session.userId)
                         ├─ ensure PlayerProfile (created lazily)
                         ├─ finished games where the account has a seat
                         ├─ rank each game's full roster (that game's tie-breakers)
                         ├─ keep only the account's seats
                         └─ summariseSeats(...) ─► { gamesPlayed, wins, podiums, accuracy, … }

PUT /api/profile  ──► validateProfileUpdate(body) ──► only selectedCharacterId may change
```

### Before / after

| Concern        | Before                                                      | After                                                                  |
| -------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Profile page   | a placeholder reading "kommt mit Phase 6.6", no data        | `profile.html`: name, role, character and six statistics               |
| Account ↔ game | a seat had no owner; a guest round was attributed to no one | `GamePlayer.userId` links a seat to the account, set from the session  |
| Personal stats | none                                                        | won games, podiums, accuracy — computed on every request               |
| Manipulation   | (n/a)                                                       | the client may write **only** `selectedCharacterId`; anything else 422 |
| Quiz history   | admin-only                                                  | admin-only (unchanged) — no player-visible history endpoint            |
| IP data        | not stored                                                  | not stored (Q5)                                                        |

## 2. Data model

### 2.1 `PlayerProfile` (new, `packages/backend/prisma/schema.prisma`)

One row per account (`user_id` unique), created **lazily** on the first profile read, so an
account that predates 6.6 gets its profile with no backfill. It stores only the chosen
character id; the statistics are derived, so they can never drift from the games.

`avatarConfig` (JSONB) and the XP/level/inventory columns are **deliberately absent** — they
belong to Phase 6.7 and 6.8. A column that nothing writes is a schema change with no benefit.

### 2.2 `GamePlayer.userId` (new, nullable)

A nullable FK to `users`, `ON DELETE SET NULL`. `NULL` means a guest seat, so **every existing
row is already valid** and no historical guest round is attributed to anyone. Deleting an
account keeps the game history and merely clears the link.

### 2.3 Migration

`packages/backend/prisma/migrations/20261109120000_phase_6_6_player_profiles/migration.sql` —
additive only: one `CREATE TABLE`, one `ADD COLUMN`, two indexes and two FKs. Applied and
verified against a real PostgreSQL: `prisma migrate deploy` succeeds and
`prisma migrate diff --exit-code` reports **no drift**.

## 3. Backend

### 3.1 Shared domain (`packages/shared/src/profile.ts`, new)

| Export                                    | Responsibility                                                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rankGameSeats(seats, tieBreak)`          | Rank one game's seats with the **shared** `rankPlayers`, so the profile agrees with the live leaderboard (shared rank on a tie: 1, 1, 3).                                              |
| `summariseSeats(seats)`                   | Fold ranked seats into `ProfileStats`: one participation per distinct game, a win for rank 1, a podium for rank ≤ 3, accuracy = correct / answered (`null` when nothing was answered). |
| `validateProfileUpdate`                   | Accept only `selectedCharacterId` (a bounded, trimmed string or `null`); reject every other field.                                                                                     |
| `EMPTY_PROFILE_STATS`, `CHARACTER_ID_MAX` | Shared constants.                                                                                                                                                                      |

The same functions run in the backend, so the tested arithmetic is the server's arithmetic.

### 3.2 Service (`packages/backend/src/services/profileService.ts`, new)

`getProfile(userId)` takes the id from the **session**, never the request. It loads the
account's finished games (`phase: 'end'`), then each game's **full roster**, ranks each game
with **that game's own tie-breakers** (`Game.settings.tieBreak`, defaulting to the shared
default) and keeps only the account's seats. Two subtleties are handled explicitly:

- **Skipped questions.** A host skip neutralises a question and refunds its points; the answer
  rows remain. They are excluded from the accuracy numerator and denominator using the
  append-only `skipped` `GameEvent`.
- **Guest seats.** A seat with `user_id = NULL` is loaded only to compute the rank; it is never
  counted as anyone's participation.

`updateProfile(userId, body)` runs `validateProfileUpdate` first and writes only
`selectedCharacterId`. A statistic, an XP value or a `userId` can never be written here.

### 3.3 Routes (`packages/backend/src/routes/profileRoutes.ts`, new)

| Method | Path           | Guard                               | Returns                         |
| ------ | -------------- | ----------------------------------- | ------------------------------- |
| `GET`  | `/api/profile` | `requireAuth` (session)             | the account's own `ProfileView` |
| `PUT`  | `/api/profile` | `requireAuth` (+ CSRF on the write) | `{ selectedCharacterId }`       |

There is **no** history route: `/api/profile/history`, `/games`, `/results` all 404.

### 3.4 The account link on join

`engine.join` → `gameService.joinGame` gained an optional `userId`, written to
`GamePlayer.userId`. `socket.ts` resolves the session cookie on `player:join` and passes
`session?.user.id`. A failed lookup is treated as a guest, so joining never breaks on a stale
cookie. The id is **never** read from the payload.

## 4. Frontend

- **New entry point.** `src/profile.html` (Vite input `profile`) renders `src/pages/profile.ts`,
  reusing the existing shell (`appShell`) and the design system (`card`, `chip`, `statTile`,
  `emptyState`, `notice`, `skeleton`). No new tokens.
- **Navigation.** The `profile` entry now links to `./profile.html` (was `./#profile`).
- **Placeholder removed.** `playerView.profilePlaceholder()` and the `#profile` route in
  `pages/player.ts` are gone; the page owns the surface.
- **Honesty rule.** With no finished games the page shows an empty state, and accuracy shows an
  em dash — never a fabricated `0` or a placeholder number.
- **Styling.** A small, additive Phase 6.6 block in `tokens.css` arranges the identity header and
  the statistics grid (two columns on a phone). Nothing above it changes.

## 5. Tests

| Suite                                                                            | What it proves                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/src/profile.test.ts` (13)                                                | Ranking parity, tie handling, one participation per game, podiums, accuracy, `null` accuracy, and that the validator rejects every foreign field.                                                                                                                                                                                                                                                                 |
| `backend/src/profile.integration.test.ts` (18)                                   | Real PostgreSQL: unauthenticated read/write refused; CSRF enforced; a client can only read its own profile; `userId` in the query is ignored; no history endpoint; write accepts a character and `null`; a statistic/XP/`userId` body is 422 and writes nothing; wins, shared wins, podiums, unfinished games, guest seats and skipped questions all handled; accuracy across games; no IP field in the response. |
| `backend/src/realtime.integration.test.ts` (+1)                                  | Over real Socket.IO: a signed-in player's seat is linked to the account, a guest's stays `NULL`.                                                                                                                                                                                                                                                                                                                  |
| `frontend/src/profile.test.ts` (5)                                               | The real page boots in jsdom: renders the statistics, shows an honest empty state, invites a signed-out visitor without calling the API, shows an error notice, and renders inside the player shell.                                                                                                                                                                                                              |
| `frontend/src/design-system.test.ts`, `navigation.test.ts`, `playerView.test.ts` | Updated for the sixth entry point, the new classes and the new profile link; the removed placeholder's test is gone.                                                                                                                                                                                                                                                                                              |

**Gate (all green):** `npm run typecheck`, `npm test` (shared 102, frontend 332, backend 235),
`npm run format:check`, `npm run build`. The backend suites ran against a real PostgreSQL.

## 6. Bestandsschutz (what is deliberately untouched)

- No question, answer, quiz, game or existing player row is modified; the migration is additive
  and existing seats keep `user_id = NULL`.
- No user account, role or permission changes; `requireAuth` and CSRF are reused, not replaced.
- No change to scoring, the timer, the answer path, the phase machine or the leaderboard; the
  profile only **reads** finished games.
- The quiz history stays admin-only; the player gets a summary, not a history.
- No XP, level or inventory yet (Phase 6.8) and no character catalogue yet (Phase 6.7) — the
  character id is a bounded opaque string until 6.7 validates it against the real assets.

## 7. Decisions and open items

1. **No IP storage (Q5) — resolved for 6.6.** Nothing reads, stores or exposes an address; a
   test asserts the response contains no `ip`/`address` field. This is the proposal; if chrisB
   wants IP-based abuse protection it is a separate, later decision.
2. **Character id is opaque until 6.7.** Validated only for length here. When the catalogue
   lands, `PUT /api/profile` should reject an id outside it.
3. **Statistics are derived, not stored.** Cheap for realistic volumes and impossible to drift.
   If a global leaderboard (6.12) makes per-request aggregation too slow, a cache or a
   materialised counter is the next step — not a schema change now.
4. **Guest → account claim** (a guest round later attached to an account) is Phase 6.8, as the
   roadmap states; 6.6 only links a seat at join time when a session is already present.

## 8. How to verify

```bash
npm run typecheck
npm test                     # with DATABASE_URL pointed at a test database
npm run format:check
npm run build
```

The integration suites skip themselves without a reachable PostgreSQL, so point
`TEST_DATABASE_URL`/`DATABASE_URL` at one to run them.
