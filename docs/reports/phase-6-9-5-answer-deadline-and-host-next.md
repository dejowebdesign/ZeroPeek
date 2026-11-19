# Phase 6.9.5 – Answer-deadline alignment and host "Next" verification

- **Branch:** `fix/host-next-and-answer-deadline` (from `main` = `0d9b8f9`, PR #51 merged)
- **Scope:** two gameplay defects reported from practical testing — a **hidden answer grace
  period** (the server accepted answers after the visible clock showed `0s`) and a suspected
  missing **Next question** button on the leaderboard. No schema change, no migration, no new
  dependency, no change to any scoring value or game rule.
- **Status:** work complete on the branch, **awaiting owner approval** — no push, no pull request,
  no merge, no deploy yet.

## 0. Result in one sentence

The deadline a player **sees** is now the deadline the server **enforces** — the hidden 1.5 s
grace was removed from `limitMs()`, so an answer is refused the instant the visible clock reaches
`0s` — and the player's answer control closes at that same instant; the reported missing **Next
question** button is **not** a defect in the current code (it was already fixed by PR #51 and the
running deployment was verified to contain that fix).

## 1. Findings (each confirmed in the code, not assumed)

### 1.1 Defect B – hidden answer grace period (real, fixed)

`limitMs(question)` in `packages/backend/src/services/engine.ts` returned

```
question.timeLimit * 1000 + ANSWER_GRACE_MS      // ANSWER_GRACE_MS = 1500
```

and `submitAnswer` rejected a late answer only when `elapsedMs > limitMs(question)`. The server
therefore kept accepting answers for **1.5 s past the limit**, while every client (player, host and
beamer) renders exactly `timeLimit` seconds from the same `openedAt`. The visible clock reached
`0s` and the question was still open on the server.

Reproduced twice against the real code (temporary probes, since removed):

- through the engine API — an answer sent **5.2 s into a 5 s question** returned `accepted: true`
  and was **persisted** (one `PlayerAnswer` row);
- through a real Socket.IO player socket — the same 5.2 s answer was accepted and stored.

So the defect was reachable by any player, not a theoretical race.

### 1.2 Defect A – missing host "Next question" button (not reproduced)

The report was that the leaderboard offered no **Next question** control. This is **already fixed
on `main`** and the fix is **live**:

- `hasNext` was introduced by commit `09ad746` (PR #51, merged 2026-11-18T12:08:53Z, merge commit
  `0d9b8f9`). `engine.hasNextQuestion()` derives it from the quiz length; the `board` event and
  `HostState` carry it; `hostActions()` omits `next` only when it is `false`; `host:board` forwards
  it through `packages/backend/src/socket.ts`.
- The production frontend was verified byte-for-byte: the live `host.html` references
  `/assets/host-BJOV_daG.js`, and that file is **identical** to a fresh local build of `main`
  (`diff` empty). The deployed bundle contains the `hasNext`-gated control.
- An end-to-end socket probe (temporary, since removed) drove a two-question game to the board,
  confirmed `hasNext: true` on the event and in the reconnect `HostState`, then sent `host:next`
  and saw the **second** question open (phase `question`, index `1`).

Conclusion: on the current code and deployment the button works. The most likely explanation of
the report is a **stale browser cache** at the time of testing: the frontend `Caddyfile`
(`docker/Caddyfile.frontend`) sets no `Cache-Control`, so `host.html` is served with only a
weak `ETag` and browsers may heuristically cache it. No code change is warranted for A; the
caching observation is recorded in §7.

## 2. The fix

### 2.1 Server – align the enforced deadline with the visible one (`engine.ts`)

```diff
-/** Grace period in ms added to the limit before a late answer is rejected. */
-const ANSWER_GRACE_MS = 1500;
-
 function limitMs(question: Question): number {
-  return question.timeLimit * 1000 + ANSWER_GRACE_MS;
+  return question.timeLimit * 1000;
 }

-    if (elapsedMs > limitMs(question)) {
+    if (elapsedMs >= limitMs(question)) {
       throw conflict('Too late – the question is closed.');
     }
```

`limitMs()` is the single value the answer clock (`armQuestionClock`), the late-answer guard, the
pause/resume arithmetic and the restart recovery all share, so removing the grace from that one
place aligns the timer **and** the guard at once. The comparison is now `>=`, so exactly at the
limit the question is closed — matching the `0s` the client shows.

### 2.2 Player – close the answer control at the deadline (`player.ts`, `playerView.ts`)

The player screen showed no clock, so its buttons stayed clickable against a closed question and a
late click returned a server error. A single timeout now disables the control at the same instant
the server stops accepting:

- `answerDeadlineRemainingMs(question, serverNow)` (new, pure, unit-tested in `playerView.ts`)
  returns the ms left against `openedAt + timeLimit * 1000`, measured on the corrected server
  clock (`ClockSync.serverNow()`), `0` once elapsed, and `null` for a paused question or a slide.
- `showQuestion()` arms `questionTimer` with that remainder (or closes immediately when `0`) and,
  if the player has not answered, shows **"Time is up."** The timer is cleared on every screen
  change (`showJoin`, `showWaiting`, `showLead`, `showResult`, `showBoard`, `showEnd`) and on
  `game:resumed`.
- On `game:resumed` the question's `openedAt` is rebased on the resumed remainder, so the close
  timer waits the time that was actually left rather than firing against the pre-pause deadline.

This is presentation only: the server remains the sole authority on whether an answer was in time
(§2.1). The guard exists so the client's feedback matches the server's decision.

## 3. Tests

- `packages/backend/src/engine.integration.test.ts` — two new tests: an answer **1 s past** the
  visible limit is rejected (`/late/`), and an answer **just inside** the limit is accepted. The
  first fails against the unfixed `limitMs()`; the second guards against over-tightening.
- `packages/frontend/src/playerView.test.ts` — a new `answerDeadlineRemainingMs` block: the
  remainder counts down against the visible limit, reaches exactly `0` at the deadline and stays
  `0` past it (no hidden grace), and returns `null` for a paused question and a slide.
- Temporary probes (`tmp-probe.test.ts`, `tmp-probe-socket.test.ts`) proved the original defect and
  the end-to-end Next path; both were **deleted** and are not part of the change.

## 4. Bestandsschutz (regression check)

- No quiz, question, answer, account, role, permission or game record is touched.
- No event or contract changed: the `board`/`HostState` shape is untouched, and the request shapes
  are unchanged.
- No scoring value changed. The speed bonus uses `elapsedMs` against `question.timeLimit`
  (`packages/shared/src/scoring.ts`), never `limitMs()`, so removing the grace does not shift any
  awarded points. Answers that arrive a fraction inside the limit score exactly as before.
- The phase guards, the AUTO gating (6.9.3) and the snapshot/restart behaviour are unchanged.

## 5. Verification

| Check          | Command                                       | Result                   |
| -------------- | --------------------------------------------- | ------------------------ |
| Backend tests  | `npm test -w @zeropeek/backend` (real DB)     | 431 passed (was 429; +2) |
| Frontend tests | `npm test -w @zeropeek/frontend`              | 523 passed (was 519; +4) |
| Typecheck      | `npm run typecheck`                           | clean                    |
| Format         | `prettier --check` on the changed files       | clean                    |
| Deploy check   | `diff` live `host-BJOV_daG.js` vs local build | identical                |

## 6. Files changed

| File                                                        | Change                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/backend/src/services/engine.ts`                   | `limitMs()` = visible limit; `ANSWER_GRACE_MS` removed; late guard is `>=` |
| `packages/frontend/src/playerView.ts`                       | new pure `answerDeadlineRemainingMs()`                                     |
| `packages/frontend/src/pages/player.ts`                     | question close-timer wired to the deadline; resume rebases `openedAt`      |
| `packages/backend/src/engine.integration.test.ts`           | two deadline tests                                                         |
| `packages/frontend/src/playerView.test.ts`                  | `answerDeadlineRemainingMs` tests                                          |
| `docs/reports/phase-6-9-5-answer-deadline-and-host-next.md` | this report                                                                |

## 7. Open questions for the project owner

1. **Answer deadline policy.** The visible limit is now the hard deadline, with no tolerance for
   network latency. If a short, **explicitly shown** tolerance is wanted later, it must be part of
   the displayed clock so client and server still agree — not a hidden constant. That is a product
   decision, not taken here.
2. **Static-asset caching.** `docker/Caddyfile.frontend` sets no `Cache-Control`, so `host.html`
   (and the other HTML entries) can be heuristically cached by a browser and briefly serve a stale
   bundle after a deploy — the likely cause of the "Next missing" report. Adding a no-cache policy
   for `*.html` (hashed `/assets/*` may stay long-lived) is a small, self-contained follow-up; it
   touches the frontend image's Caddyfile, so it is left for a separate, approved change.

---

> **Status note (documentation audit, after Phase 6.9.5):** this report was written while the
> work was still awaiting approval. It has since been merged into `main` via **PR #52**
> (merge commit `18e271f`). The content above is the historical completion report and is
> unchanged; only this note was added.
