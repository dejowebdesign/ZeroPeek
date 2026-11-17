# Phase 6.9.3 – Host-Control Correction & Optional AUTO Operation

- **Branch:** `feat/phase-6-9-2-host-auto-control` (from `origin/main` = `e3bf47d`, PR #49 merged)
- **Scope:** simplify game-show operation to **one** host/beamer view — remove the separate
  presentation mode and the scene bar — and add an optional **AUTO** switch (default **off**) that
  lets the server run the scheduled host transitions. No new dependency, no schema change, no
  migration, no change to any existing event or game rule.
- **Status:** work complete on the branch, **awaiting owner approval** — no push, no pull request,
  no merge, no deploy yet.

## 0. Result in one sentence

The host steers the whole game from a single view: the presentation toggle and the scene bar are
gone, and a new server-authoritative `AUTO` switch (default off, persisted in the existing event
log) can hand the two scheduled screen advances — reveal → leaderboard and leaderboard → next
question — to the server, while the answer clock and the start countdown keep running either way.

## 1. Starting point (verified in the code, not assumed)

1. The show is the **combined** host/beamer page `packages/frontend/src/pages/host.ts`; there is no
   separate beamer route and no show token (Phase 6.9 analysis §2, §7).
2. Phase 6.9.2 had added a display-only scene layer plus a **presentation mode** and a **scene bar**
   (`sceneBar()`, `presentationToggle()`, `presentationClass()`, `presentationMode`) and the CSS
   `.show-presentation`, `.show__present`, `.show__scene-bar`, `.show__scene-label`.
3. The engine (`packages/backend/src/services/engine.ts`) already ran the reveal → board and
   board → next transitions on its **own** timers (`REVEAL_MS`, `BOARD_MS`), unconditionally.
4. `Game` has no `auto` column; the append-only `GameEvent` log is the established place for
   runtime flags that must survive a restart (it already holds `paused`/`resumed`).

## 2. Design decisions applied

| Decision             | Value                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| One view             | Presentation mode and the scene bar are **removed**; the host controls the game in one surface |
| Scene                | Stays **internal**, still derived from the authoritative phase; no scene navigation            |
| AUTO authority       | **Server** owns the mode; the client only asks for a value and mirrors what the server answers |
| AUTO default         | **Off** (manual) — the host advances the reveal and the leaderboard by hand                    |
| AUTO scope           | Only the **scheduled** transitions (reveal → board, board → next); nothing else                |
| Not affected by AUTO | The answer clock and the start countdown always run                                            |
| Persistence          | Existing `GameEvent` log (`auto` event) — **no** column, **no** migration                      |
| Contracts            | **Additive**: `HostState.auto`, `host:auto` (command + event). No existing field changed       |

## 3. Changes

### 3.1 `packages/shared/src/events.ts`

- `HostState` gains `auto: boolean` (always present, so a fresh game and a resumed one look the
  same to the client).
- `HostClientEvents` gains `host:auto: ({ gameId, auto }) => Ack<{ auto: boolean }>`.
- `HostServerEvents` gains `host:auto: ({ auto }) => void` (host sockets only).

### 3.2 `packages/backend/src/services/engine.ts`

- `RuntimeGame` gains `auto: boolean` (default `false` at both construction sites, `create` and
  `load`).
- `EngineEvents` gains `auto: [{ gameId, auto }]`.
- `REVEAL_MS` 6000 → **4000**, `BOARD_MS` 6000 → **5000**.
- `armAutoAdvance(game)` — the single place the two scheduled transitions are armed; a no-op when
  AUTO is off, so with AUTO off neither `revealInternal` nor `boardInternal` arms a timer.
- `setAuto(gameId, auto)` — server-authoritative, phase-locked. It is a **no-op** when the value is
  unchanged (no event, no timer churn). Switching off cancels a pending auto-advance **only** on a
  screen AUTO owns (reveal/board) — never the question clock or the countdown. Switching on arms
  the current screen's transition if it has one. Persists via `logEvent(gameId, 'auto', { auto })`
  and emits `auto`.
- Recovery (`load`): the `auto` value is restored from the game's own event log (the newest `auto`
  event wins — order-free), and the reveal/board recovery timers are **gated on `auto`**. The
  question timer is always re-armed, because the answer time is not an AUTO transition.

### 3.3 `packages/backend/src/socket.ts`

- `host:auto` command: validates `auto` is a real boolean, authorises with `assertHost`, returns the
  server's value.
- `engine.on('auto', …)` fan-out to the host room only (players never see the mode).

### 3.4 `packages/frontend/src/hostView.ts`

- `autoLabel(auto)` / `autoHint(auto)` — pure label helpers (`AUTO: On` / `AUTO: Off`).
- `HostEventHandlers` gains `auto`; `attachHostHandlers` registers `host:auto` (so detach now
  unregisters **10** events).

### 3.5 `packages/frontend/src/pages/host.ts`

- **Removed:** `presentationMode`, `presentationClass()`, `presentationToggle()`, `sceneBar()` and
  the now-dead `rerender()`.
- **Added:** the `AUTO` toggle. It shows the server's mode, is hidden in the lobby and on the final
  screen, and on click sends `host:auto` with the flipped value — it never changes the mode locally.
  The `host:auto` broadcast and the `host:auto` ACK both repaint the toggle in place; the game and
  the screen never move.

### 3.6 `packages/frontend/src/styles/tokens.css`

- `.show__scene-bar` / `.show__scene-label` and the whole presentation-mode block
  (`.show__present`, `.show-presentation …`) are removed.
- `.show__auto` — the toggle's layout, drawn only from existing tokens.

## 4. Tests

- **`hostPage.test.ts` (rewritten):** no scene navigation, scene number or presentation toggle in
  any phase; the AUTO toggle is hidden in the lobby and on the final screen; it defaults to
  `AUTO: Off`; clicking sends `host:auto` with the flipped value and follows the server ACK; the
  `host:auto` broadcast repaints the toggle without moving the screen.
- **`hostView.test.ts`:** `autoLabel`/`autoHint`; `host:auto` routes to its handler; detach count
  9 → 10.
- **`design-system.test.ts`:** `.show__auto` is defined; the AUTO bar never hides the controls; and
  a guard that `.show__scene-bar` / `.show__present` / `.show-presentation` are **gone for good**.
- **`gameplay-reliability.integration.test.ts` (backend):** the timer-dependent tests (stale board
  timer, duplicate `board`/`reveal`, restart recovery) now enable AUTO explicitly, since the
  default is off. A new **§C – the AUTO mode** block covers: default off and echo; with AUTO off a
  reveal/board does not advance on its own; turning AUTO on mid-reveal arms the advance; turning it
  off cancels a pending advance; a repeated set is a no-op; the mode survives an `evict` restart.

### Verification (all green)

| Check                | Result                                        |
| -------------------- | --------------------------------------------- |
| `npm run typecheck`  | pass                                          |
| `npm run lint`       | pass                                          |
| `npm run build`      | pass                                          |
| `prettier --check .` | pass                                          |
| Backend tests        | 23 files, **409 passed** (PostgreSQL present) |
| Frontend tests       | 18 files, **513 passed**                      |

## 5. Bestandsschutz

- No question, answer, account, role or permission is touched.
- No existing event or game rule changes; `HostState.auto`, `host:auto` and the `auto` engine event
  are purely **additive**.
- No schema change and no migration: the mode is stored in the existing `GameEvent` log.
- The player experience is unchanged: AUTO is a host-only concern and is never sent to players.
- With AUTO off (the default) the observable behaviour is identical to a manually driven game,
  except that the two scheduled transitions no longer fire by themselves — which is the requested
  correction.

## 6. Risks and limits

1. **Question clock and countdown are not AUTO-gated.** They keep running on their own, as the
   brief requires ("the answer time is not an AUTO transition"). A host who wants a fully silent
   room still has `host:pause`. If chrisB wants the expiry to also wait for the host, that is a
   separate decision and a separate change.
2. **All-players-answered still auto-reveals.** That is a core, always-on mechanic and is left
   unchanged; only the two _scheduled_ screen advances are gated on AUTO.
3. **`auto` is restored from the event log** like `paused`/`resumed`; the log is append-only, so the
   newest `auto` event is authoritative. No new column was added on purpose.

## 7. Open questions for chrisB

1. Should the answer time (question expiry) also wait for the host when AUTO is off, or stay as it
   is (clock always runs, reveal is manual)?
2. Are `REVEAL_MS = 4000` and `BOARD_MS = 5000` the right AUTO delays?
3. Should the AUTO toggle also be offered in the lobby (to pre-select the mode before the start)?
