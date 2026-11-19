# Phase 6.9.1 – Server States & Event Contracts

- **Branch:** `feat/phase-6-9-1-server-show-state` (from `origin/main` = `177b63c`)
- **Scope:** the **foundation** for the game-show mode — the real `lead` phase, the
  `category`/`difficulty` labels on the public question, and the per-player **points** and
  **rank** deltas the show scenes need. No scene is built here; this phase only establishes the
  server-owned states and the additive event contracts that 6.9.4/6.9.5 will render.
- **Status:** work complete on the branch, **awaiting owner approval** — no push, no pull request,
  no merge, no deploy yet.

## 0. Result in one sentence

`start` now opens a real, server-owned `lead` countdown that every surface renders against the
clock sync before the first question opens, and the host's `reveal`/`board` events now carry the
per-player score and rank changes — all additive, with no schema change, no new dependency and no
change to any existing event name or payload field.

## 1. Starting point (verified in the code, not assumed)

The Phase 6.9 analysis (`docs/analysis/phase-6-9-game-show-analysis.md`, §5) established, against the
actual code:

1. **`lead` was declared but never entered.** `GAME_PHASES` (`packages/shared/src/constants.ts:113`)
   listed `lead`, but nothing set it. `engine.startInternal` froze the quiz and jumped straight to
   the first question (`advance`).
2. **`PublicQuestion` carried no `category`.** The data existed in the question model
   (`packages/shared/src/questions.ts`) and in the snapshot, but `engine.publicQuestion` did not
   forward it.
3. **No points delta reached the host.** `reveal` sent the host only the distribution; the per-player
   points were sent **privately** to each player as `OwnResult.points`.
4. **No rank movement.** `board` sent the absolute ordering only; the pre-question position was not
   available to the show.

This phase closes exactly those four gaps. Everything else in §5 (the final round, the outro
statistics) remains an open product decision and is **not** touched.

## 2. Binding decisions applied

| Decision               | Value                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `lead` window          | Fixed, server-owned: **5 s** (`LEAD_SECONDS` / `LEAD_MS`)                                    |
| Countdown authority    | The server owns the window and the transition; the client only renders                       |
| Countdown clock        | Rendered against the existing Phase 6.8.5 `ClockSync` — **no** second clock                  |
| Skipping the countdown | One host command, `host:skipLead`, legal **only** in `lead`; a duplicate is a no-op          |
| Deltas                 | Derived from the persisted `playerAnswer` rows — presentation only, never a source of points |
| Contracts              | **Additive only.** No existing event name or payload field changed                           |
| Schema                 | **Unchanged.** No migration                                                                  |

## 3. Changes

### 3.1 Shared (`@zeropeek/shared`)

| Contract             | Change                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `PublicQuestion`     | `category?: string`, `difficulty?: string` — optional display labels, never solution fields               |
| `LeadState`          | **New**: `{ startedAt, endsAt, durationSeconds, skippable }`                                              |
| `PointsDelta`        | **New**: `{ playerId, previousScore, delta, score }`, self-consistent (`previousScore + delta === score`) |
| `RankDelta`          | **New**: `{ playerId, previousRank, rank, score }`                                                        |
| `PlayerSync`         | `lead: LeadState \| null` — a reconnect during the countdown is restored                                  |
| `HostState`          | `lead`, `points`, `ranks` (each nullable) — restore a reconnect mid-countdown / on the reveal             |
| `PlayerServerEvents` | `game:lead`                                                                                               |
| `HostServerEvents`   | `host:lead`; `host:reveal` gains `points`; `host:board` gains `ranks`                                     |
| `HostClientEvents`   | `host:skipLead`                                                                                           |

All new fields are optional or nullable, so an older client and the existing contracts keep working.

### 3.2 Backend

| File                     | Change                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/engine.ts` | `lead` phase + `LEAD_MS`; `start` enters `lead` (`enterLead`) instead of the question; `advanceFromLead` / `skipLead` (idempotent under the phase lock); recovery re-arms the countdown for the **remaining** time; `leadState()`; `pointsDeltas()` / `rankDeltas()` read from the persisted rows; `hostState` became `async` and returns `lead`/`points`/`ranks`; `publicQuestion` forwards `category`/`difficulty` |
| `src/socket.ts`          | `host:skipLead` command; `engine.on('lead')` fan-out to `host:lead`/`game:lead`; `host:reveal`/`host:board` now carry `points`/`ranks`                                                                                                                                                                                                                                                                               |

Design points worth stating explicitly:

- **One timer, no second infrastructure.** The countdown uses the same single `game.timer` the rest
  of the engine uses.
- **Recovery rebuilds the remaining window, never restarts it.** The `lead` window is reconstructed
  from the persisted event's `endsAt`; if it already expired the engine advances at once. This is the
  R11 mitigation from the analysis (a reconnect must not hang in the countdown).
- **The transition is entered exactly once.** `advanceFromLead` and `skipLead` both run under
  `withPhaseLock` and both only act while the phase is still `lead`, so a timer callback racing a
  skip (or a duplicate skip) cannot open two questions.
- **The deltas are read, not recomputed.** `pointsDeltas` sums the persisted `playerAnswer.points`
  rows and derives `previousScore = score − delta`; it never mutates the authoritative total, so
  re-emitting a reveal cannot double anything. `rankDeltas` is a pure function of the current scores
  and those deltas, so it is identical live and after a restart.

### 3.3 Frontend

| File                  | Change                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/hostView.ts`     | `HostScreen`/`HostActionId` gain `lead`/`skipLead`; `hostActions('lead')` offers only "Skip countdown"; `HostEventHandlers` gains `lead`, and `reveal`/`board` gain the new fields; `host:lead` listener registered |
| `src/pages/host.ts`   | `startLeadTimer()` (server-clock countdown); `showLead()` screen reusing the existing board + `countdown()` ring; `lead` case in the render union and in `renderHostState`; `host:lead` handler                     |
| `src/playerView.ts`   | `PlayerScreen` gains `lead`; `screenForSync` maps `lead` (falls back to the lobby when no window)                                                                                                                   |
| `src/pages/player.ts` | Reuses `ClockSync`; `showLead()` + `stopLeadTimer()`; `lead` case in `renderSync`; `game:lead` handler; re-syncs the clock on every `connect`                                                                       |

The countdown reuses the existing `countdown()` component and the existing show layout — **no new
CSS**. Both the host and the player compute the displayed number from the server's `endsAt` against
`clock.serverNow()`, so all surfaces show the same count.

## 4. Tests

New coverage added on top of the updated existing suites:

- **`engine.integration.test.ts`** — a `start countdown / lead phase` block (enters `lead`, opens the
  question only after the skip, carries the countdown in host + player sync, refuses a second skip,
  re-arms after a cold reload without restarting, advances via the timer) and a
  `points and rank deltas` block (deltas from the persisted rows, rank movement, restart-safe
  rebuild), plus the `category`/`difficulty` label test.
- **`host-sync.integration.test.ts`** — M (start opens a countdown both surfaces receive; a host
  reconnect restores the remaining time), N (skip opens the first question exactly once), O (the
  reveal carries point deltas and the board carries rank movements).
- **`hostView.test.ts` / `playerView.test.ts`** — `lead` screen mapping, the `lead` fallback, the
  `skipLead` action, and the `lead` sync mapping.

Existing suites that assumed `start → question` were updated to skip the countdown explicitly
(`engine.skipLead` / `host:skipLead`); the phase-machine assertion in `engine.integration.test.ts`
now reads `['lead', 'question', 'reveal', 'board']`-equivalent expectations. No behaviour outside the
new phase changed.

### Verification (all green)

| Check                  | Result                                                      |
| ---------------------- | ----------------------------------------------------------- |
| `npm run typecheck`    | pass                                                        |
| Backend tests          | 23 files, **399 passed** (with PostgreSQL)                  |
| Frontend tests         | 16 files, **469 passed**                                    |
| Shared tests           | 9 files, **179 passed**                                     |
| `npm run build`        | pass                                                        |
| `npm run format:check` | pass (the analysis doc is formatted as part of this branch) |

## 5. Risks and their handling

| Risk                                        | Handling                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lead` touches the state machine + recovery | Targeted engine tests (order, reconnect, recovery) — R1                                                                                                                                     |
| Double points / rank deltas                 | Computed once per question, idempotent from the DB rows — R2                                                                                                                                |
| Host ↔ beamer contradiction                 | Both render the same server state; no client phase — R3                                                                                                                                     |
| Reconnect during `lead` hangs               | `HostState.lead` + remaining-window recovery timer — R11                                                                                                                                    |
| New events bypass the rate limit            | `host:skipLead` is a **host** command (session-guarded, like `host:skip`); the new player event `game:lead` is server→client only, so no new client-reachable gameplay event was added — R9 |

## 6. What this phase deliberately does **not** do

- No show scene, no background image, no new CSS (those are 6.9.2+).
- No final round, no outro statistics (open product decisions, §5.5/§5.6 of the analysis).
- No schema change and no migration.
- The support note ("Mit Unterstützung von …") is **not** added.

---

> **Status note (documentation audit, after Phase 6.9.5):** this report was written while the
> work was still awaiting approval. It has since been merged into `main` via **PR #47**
> (merge commit `31a7783`). The content above is the historical completion report and is
> unchanged; only this note was added.
