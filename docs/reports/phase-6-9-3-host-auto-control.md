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
log) decides whether the **answer resolution** (question → reveal) and the **leaderboard advance**
(board → next question) run by themselves or wait for the host; the reveal window
(reveal → leaderboard, 4 s) and the start countdown always run.

> **Correction (this revision).** The first draft of 6.9.3 gated the **reveal → leaderboard** and
> **leaderboard → next** transitions on AUTO and left **question → reveal** automatic. That is the
> wrong half of the flow: with AUTO off the host must own the **answer resolution**, and the
> **reveal → leaderboard** step is a fixed 4-second window in **both** modes. The gating was
> therefore swapped. See §8 for the final, binding rule and the exact places changed.

> **Correction 2 (this revision).** A follow-up audit of the answer clock found a real defect:
> turning AUTO **on** during a live question armed a leaderboard advance on top of the answer timer,
> overwriting the single `game.timer` slot and orphaning the answer timer. The orphan then fired at
> the question's real deadline and revealed it **even after AUTO had been switched off again** —
> breaking "AUTO off ⇒ no automatic resolution". Fixed by giving `armBoardAdvance` a `board`-phase
> guard and making `armQuestionClock` clear before it arms. The answer clock itself is derived from
> `openedAt` and was **never** stopped, reset or shifted by `setAuto`; only the timer bookkeeping
> was wrong. See §3.2 (correction note) and §9.

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

| Decision         | Value                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| One view         | Presentation mode and the scene bar are **removed**; the host controls the game in one surface |
| Scene            | Stays **internal**, still derived from the authoritative phase; no scene navigation            |
| AUTO authority   | **Server** owns the mode; the client only asks for a value and mirrors what the server answers |
| AUTO default     | **Off** (manual) — the host resolves the answers and starts the next question by hand          |
| AUTO scope       | The **answer resolution** (question → reveal) and the **leaderboard advance** (board → next)   |
| Always automatic | The reveal window (reveal → leaderboard, `REVEAL_MS` = 4 s) and the start countdown            |
| Persistence      | Existing `GameEvent` log (`auto` event) — **no** column, **no** migration                      |
| Contracts        | **Additive**: `HostState.auto`, `host:auto` (command + event). No existing field changed       |

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
- Three explicit arm helpers replace the old coarse `armAutoAdvance`. **Clock vs timer:** the
  _answer clock_ is the server-side deadline derived from `openedAt` (`limitMs(question)`); it is
  the single source of truth and **always runs**, whatever the AUTO mode. The _timer_ is only the
  scheduled callback that would auto-resolve when that clock expires. AUTO gates the timer, never
  the clock.
  - `armQuestionClock(game, delayMs)` — **AUTO only**; schedules question → reveal for the full
    limit on a fresh question, the exact remainder on resume/recovery. It `clearTimer`s first and is
    a pure function of the remaining time, so it can never leave a second timer behind or shift the
    deadline.
  - `armRevealWindow(game)` — **always** armed; reveal → leaderboard after `REVEAL_MS`.
  - `armBoardAdvance(game)` — **AUTO only**, and only on the **board** phase; leaderboard → next
    question after `BOARD_MS`. The phase guard is what keeps a `setAuto(true)` during a live question
    from arming a board advance on top of the answer timer (see the correction note below).
- `advance` (fresh question) and `resumeInternal` arm the answer clock via `armQuestionClock`, so
  with AUTO off the clock still runs but nothing auto-reveals.
- `revealInternal` always calls `armRevealWindow` (reveal → board in both modes).
- `boardInternal` calls `armBoardAdvance` (board → next, AUTO only).
- `acceptAnswer`'s "everyone answered" early reveal is gated on `game.auto`: with AUTO off a full
  roster waits for the host.
- `setAuto(gameId, auto)` — server-authoritative, phase-locked. It is a **no-op** when the value is
  unchanged (no event, no timer churn). Switching **off** cancels only the pending _timer_ (the
  scheduled auto-resolution on a question, or the advance on a board) — it **never** stops, resets
  or restarts the answer clock, and never touches the always-on reveal window. Switching **on**
  catches up at once via `armQuestionAuto`: on a live question whose whole roster has answered, or
  whose clock has already expired, it resolves immediately; otherwise it schedules the timer for the
  exact remainder of the **original** deadline. Persists via `logEvent(gameId, 'auto', { auto })` and
  emits `auto`.
- Recovery (`load`): the `auto` value is restored from the game's own event log (the newest `auto`
  event wins — order-free). The **reveal window is always re-armed**; the **answer-clock timer and
  the board advance are gated on `auto`**, so a recovered game with AUTO off waits for the host
  instead of running on by itself (the recovered clock has already expired in that case, but nothing
  fires until the host acts or turns AUTO on).

> **Correction (this revision).** `armBoardAdvance` originally had no phase guard. Because
> `setAuto(true)` calls it unconditionally, turning AUTO on during a **live question** armed a
> 5-second board advance on top of the answer clock. Both wrote the single `game.timer` slot, so the
> board timer overwrote the reference to the answer timer and **orphaned** it — the orphan then fired
> at the real deadline and revealed the question even after AUTO had been switched off again, which
> broke the rule "AUTO off ⇒ no automatic resolution". Fixed by (a) restricting `armBoardAdvance` to
> the `board` phase and (b) making `armQuestionClock` clear any pending timer before it arms. The
> answer clock itself (`openedAt`) was never touched by the bug — only the timer bookkeeping was.

### 3.3 `packages/backend/src/socket.ts`

- `host:auto` command: validates `auto` is a real boolean, authorises with `assertHost`, returns the
  server's value.
- `engine.on('auto', …)` fan-out to the host room only (players never see the mode).

### 3.4 `packages/frontend/src/hostView.ts`

- `autoLabel(auto)` / `autoHint(auto)` — pure label helpers (`AUTO: On` / `AUTO: Off`); the hint now
  says the mode governs the **answer resolution** and the **next question**, not "the reveal".
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
  timer, duplicate `board`/`reveal`, restart recovery) enable AUTO explicitly, since the default is
  off. **§C – the AUTO mode** now encodes the corrected contract, in three parts:
  - **C1 – the answer clock is independent of AUTO:** `setAuto(false)` neither stops nor shifts the
    running clock (`openedAt` unchanged); `setAuto(true)` mid-question keeps the original deadline
    (not a fresh one); with AUTO off the clock expires but nothing resolves until the host acts, and
    the host can still reveal by hand; with AUTO on the expiry resolves by itself.
  - **C2 – switching AUTO mid-question (regression guard for the fix):** AUTO on→off during a
    question must **not** resolve at expiry; AUTO on→off→on resolves **exactly once**; `setAuto(true)`
    during the start countdown does not disturb the countdown.
  - the general contract: default off and echo; a repeated set is a no-op and arms nothing extra;
    with AUTO off a full roster does not resolve the question and a board does not advance, but a
    reveal still advances to the board after the fixed window; with AUTO on the board opens the next
    question; turning AUTO on after everyone answered / after the clock expired resolves at once,
    mid-clock resolves when it expires; turning it off during a question cancels the auto-resolution,
    during a board cancels the advance, during a reveal does not stop the fixed reveal window; the
    mode survives an `evict` restart.
  - A new `FAST_QUIZ` (the minimum legal 5 s limit; the clock is now exactly 5 s — the former
    1.5 s grace was removed in Phase 6.9.5) keeps the expiry cases quick without faking the timer.
- **`engine.integration.test.ts`:** the auto-reveal tests now enable AUTO, with new AUTO-off
  companions ("waits for the host when everyone has answered", "a paused question never
  auto-reveals"); the race tests (auto-reveal vs `end`) enable AUTO so the race is actually driven.
- **`reconnect.integration.test.ts`:** recovery test J enables AUTO (recovered, expired question
  reveals); new J2 proves that with AUTO off the same recovered question waits for the host.
- **`realtime.integration.test.ts`:** the end-to-end run enables AUTO for the early reveal, then
  turns it off again so the rest of the flow is host-driven.

### Verification (all green, re-run after the correction)

| Check                | Result                                        |
| -------------------- | --------------------------------------------- |
| `npm run typecheck`  | pass                                          |
| `npm run lint`       | pass                                          |
| `npm run build`      | pass                                          |
| `prettier --check .` | pass                                          |
| Backend tests        | 23 files, **426 passed** (PostgreSQL present) |
| Frontend tests       | 18 files, **513 passed**                      |
| Shared tests         | 9 files, **179 passed**                       |

## 5. Bestandsschutz

- No question, answer, account, role or permission is touched.
- No existing event or game rule changes; `HostState.auto`, `host:auto` and the `auto` engine event
  are purely **additive**.
- No schema change and no migration: the mode is stored in the existing `GameEvent` log.
- The player experience is unchanged: AUTO is a host-only concern and is never sent to players.
- With AUTO off (the default) the observable behaviour is exactly the requested manual game: the
  answer clock runs unchanged, the host resolves the answers, the reveal shows for 4 s and then the
  leaderboard appears, and the host starts the next question.

## 6. Risks and limits

1. **The reveal window is a fixed 4 s.** In both modes the reveal → leaderboard step is automatic.
   A host who wants to hold the reveal longer has no dedicated control for it (only the leaderboard
   step, which is manual with AUTO off). If chrisB wants a manual reveal hold, that is a separate
   decision and a separate change.
2. **The start countdown is not AUTO-gated.** It always runs, as the brief requires.
3. **`auto` is restored from the event log** like `paused`/`resumed`; the log is append-only, so the
   newest `auto` event is authoritative. No new column was added on purpose.
4. **One timer slot.** The runtime holds a single `game.timer`. Every arm helper now clears it first
   and only arms in the phase it belongs to, so there is never a second, orphaned timer. This is the
   invariant the correction restored; a future helper must keep it.

## 7. Open questions for chrisB

1. Are `REVEAL_MS = 4000` and `BOARD_MS = 5000` the right delays?
2. Should the reveal window also be host-controlled when AUTO is off (e.g. a "Leaderboard" button
   that also auto-fires after 4 s), or is the fixed 4 s window right?
3. Should the AUTO toggle also be offered in the lobby (to pre-select the mode before the start)?

## 8. Final binding rule (this revision)

AUTO is **off** by default. `AUTO` controls exactly two transitions: the **answer resolution**
(question → reveal) and the **leaderboard advance** (board → next question). Everything else runs
on its own.

### AUTO off

| Event                       | Behaviour                     |
| --------------------------- | ----------------------------- |
| Host starts the game        | host action                   |
| 5-second countdown          | runs automatically            |
| Question shown              | automatically                 |
| Answer time runs            | automatically                 |
| All players have answered   | **waits for the host**        |
| Answer time expired         | **waits for the host**        |
| Resolve the answers         | **host only** (`host:reveal`) |
| Reveal → leaderboard        | automatically, after 4 s      |
| Leaderboard → next question | **host only** (`host:next`)   |
| Last question done          | regular game end              |

### AUTO on

| Event               | Behaviour                     |
| ------------------- | ----------------------------- |
| Answer time runs    | automatically                 |
| All players done    | resolves automatically        |
| Answer time expired | resolves automatically        |
| Reveal shown        | ends after 4 s, automatically |
| Leaderboard shown   | next question after 5 s       |
| Last question done  | regular game end              |

### Switching mid-round

| Switch                         | Behaviour                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| AUTO off → on (clock running)  | the running question and clock are untouched; the clock resolves on expiry                                      |
| AUTO off → on (clock expired)  | resolves at once (that is the state handed over)                                                                |
| AUTO off → on (all answered)   | resolves at once                                                                                                |
| AUTO on → off (clock running)  | the running question and clock are untouched; the answer clock is cancelled, so the question waits for the host |
| AUTO on → off (clock expired)  | waits for the host                                                                                              |
| AUTO on → off (all answered)   | waits for the host                                                                                              |
| AUTO on → off (during reveal)  | the reveal window keeps running (it is not AUTO-controlled)                                                     |
| AUTO on → off (during board)   | the pending next-question advance is cancelled; the host starts the next question                               |
| repeated set of the same value | no-op — no event, no timer churn, no double transition                                                          |

Already-resolved rounds are never re-resolved, no question is skipped, and the target's own phase
guard still validates every transition.

## 9. The answer clock is independent of AUTO (this revision)

The **answer clock** is the server-side deadline of the running question. It is derived from
`openedAt` (the server timestamp the question opened) and `limitMs(question)`
(`timeLimit · 1000 + ANSWER_GRACE_MS`; since Phase 6.9.5 the grace was removed, so it is exactly
`timeLimit · 1000`), and it is exposed to clients as `PublicQuestion.openedAt`.
It is the single source of truth and it **always runs**, whatever the AUTO mode. AUTO never stops,
resets or restarts it, and never changes its end time.

AUTO controls only the **timer**: the scheduled callback that would auto-resolve the question when
that clock expires (`armQuestionClock`), and the scheduled advance from the leaderboard to the next
question (`armBoardAdvance`). With AUTO off both callbacks are simply absent; the clock keeps
running and, when it reaches zero, the question stays open (late answers are still refused by the
`limitMs` check in `acceptAnswer`) until the host resolves it with `host:reveal`.

Consequences, each covered by a test:

| Situation                              | Result                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| AUTO off while the question runs       | clock keeps its original end time; nothing auto-resolves                           |
| AUTO off after the clock expired       | question waits for the host                                                        |
| AUTO off with a full answer roster     | question waits for the host                                                        |
| AUTO on while the question runs        | clock keeps its original end time; resolves at expiry (or at once if full/expired) |
| AUTO on → off while the question runs  | clock keeps its original end time; auto-resolution is prevented                    |
| AUTO on → off during the reveal window | the fixed 4 s reveal window still finishes                                         |
| AUTO on → off during the leaderboard   | the pending advance to the next question is cancelled                              |

The audit also confirmed that `setAuto(false)` never called `clearTimer` on the clock in a way that
could stop it, and that the clock's anchor (`openedAt`) is untouched by any AUTO change. The only
defect found was the orphaned-timer bookkeeping described in §3.2.

---

> **Status note (documentation audit, after Phase 6.9.5):** this report was written while the
> work was still awaiting approval. It has since been merged into `main` via **PR #50**
> (merge commit `30e286e`). The content above is the historical completion report and is
> unchanged; only this note was added.
