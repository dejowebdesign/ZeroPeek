# Phase 6.5.3 – Extended host control (report)

- **Branch:** `feat/phase-6-5-3-extended-host-controls`
- **Base:** `main` after PR #30 (`2fa0c6b`)
- **Scope:** the host console (roadmap §6.2) — pause/resume a running question, skip a
  question, remove a player from the lobby, and show players whether the host is reachable
- **Status:** implemented, awaiting review
- **Decisions (chrisB, 2026-11-07):** (A) a skip **neutralises** the question — already-awarded
  points are refunded; (B) a skipped reveal carries **no solution** on the wire; (C) a slide
  **cannot** be paused. See §7.

This phase answers the three open questions from the 6.5.2 report. The host gains the two
controls a live show actually needs mid-question (**pause/resume**, **skip**) plus the
**kick** control the lobby was missing, and the players finally get a signal when the host
drops out.

It adds no dependency, no table and no column. The paused/skipped state is persisted as rows
in the **existing** `GameEvent` log, so there is no migration. No user account, role,
permission, question, answer, API route or engine rule is removed or rewritten.

## 1. What changed

```
host:pause ──► engine.pause ──┬─► clearTimer, freeze remainingMs (server-side)
                              ├─► logEvent('paused')  ── survives a restart
                              └─► emit 'paused' ──► host:paused + game:paused
host:resume ─► engine.resume ─┬─► shift openedAt by the pause, re-arm timer once
                              └─► emit 'resumed' ─► host:resumed + game:resumed
host:skip ───► engine.skip ───► revealInternal(skipped: true)
                                 ├─► skippedQuestionId set (never scored)
                                 ├─► refundQuestion: points/correct/time zeroed, atomically
                                 ├─► logEvent('reveal') + logEvent('skipped')
                                 └─► reveal event carries `skipped` (no solution, no distribution)
host:kick ───► lobby only ────► delete row, emit 'game:kicked', re-emit the lobby
```

### Before / after

| Concern              | Before                                                     | After                                                             |
| -------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Mid-question control | only **Reveal**                                            | **Pause**, **Reveal**, **Skip** (paused: **Resume**, **Skip**)    |
| Interruption         | the host had to end the game to stop the clock             | the clock freezes and resumes with exactly the time that was left |
| A bad question       | no way past it but to reveal the solution                  | **Skip** neutralises it: no solution on the wire, points refunded |
| Lobby roster         | listed names only, `host:kick` existed but was unreachable | each name has a **Remove** button with a confirmation dialog      |
| Host drop-out        | invisible to players                                       | a "Host reconnecting…" chip appears wherever the player is        |
| Paused answer        | (n/a)                                                      | the engine refuses it and the player's control is disabled        |
| Slide                | (n/a)                                                      | a slide carries no clock, so it **cannot** be paused              |

## 2. Backend

### 2.1 Shared contract (`packages/shared/src/events.ts`)

| Type             | Change                                                                                |
| ---------------- | ------------------------------------------------------------------------------------- |
| `PublicQuestion` | `+ paused: boolean`, `+ remainingMs: number \| null`                                  |
| `HostState`      | `+ paused`, `+ skipped`, `reveal` becomes `HostReveal \| null`                        |
| `HostReveal`     | **new** union: a skipped reveal carries only `{ id, type, text }` — no solution field |
| `PlayerSync`     | `+ paused`, `+ skipped`                                                               |
| `OwnResult`      | `outcome` gains `'skipped'`                                                           |
| Events           | `+ game:paused`, `+ game:resumed`, `+ host:paused`, `+ host:resumed`, `+ game:kicked` |
| Host actions     | `HostActionId` gains `'pause' \| 'resume' \| 'skip'`                                  |

`HostReveal` is the type-level guarantee for decision B: the skipped variant has no field
that could hold the solution, the correct option or the distribution, so a leak is impossible
**by construction** rather than by remembering to strip fields.

`remainingMs` is **null** whenever the clock is running, and the frozen value while paused.
The client never derives the clock from a local timer alone; it uses the server's value.

### 2.2 `engine.ts`

- `limitMs(question)` centralises the "visible limit + grace" arithmetic. The timer, the
  late-answer guard and the pause/resume maths all use it, so a resume can never drift.
- `pause(gameId)` — a live `question` only, never a `slide` (a slide has no clock). Clears
  the timer, freezes `remainingMs` and writes a `paused` row with `{ questionId, remainingMs,
openedAt }`.
- `resume(gameId)` — shifts `openedAt` forward by the pause duration and re-arms the timer
  **once** for the frozen remainder. Elapsed-time scoring therefore continues as if the pause
  never happened.
- `skip(gameId)` — reuses `revealInternal(…, { skipped: true })`, so it cannot produce a
  second question or a duplicate phase change. Works on a live **or** paused question.
- `refundQuestion(game, questionId)` — the neutralisation for decision A. In **one
  transaction** it zeroes every answer row for the question (points, correctness, flagged; the
  raw answer and its timing are kept for the report) and decrements each scorer's `score`,
  `correctCount` and `totalTimeMs` by exactly what that row granted. Idempotent by
  construction: once the rows read 0 a second call refunds nothing, so a re-entrant skip (or a
  skip racing an end) cannot double-refund. The refund runs **before** the phase moves, so the
  emitted reveal already reflects the new totals.
- `revealInternal` refuses to run while paused unless it is a skip, so a stray timer or a
  racing host click cannot un-pause the game.
- `submitAnswer` refuses while paused, so the closed window cannot be reopened.
- `recoverCurrentQuestion` restores a paused game **paused** (no timer armed), and re-derives
  the skipped flag and the pause state from the event log. It reads the log in **one query** and
  matches by `questionId` rather than ordering by `createdAt`: that column has only millisecond
  precision, so two events written in the same tick (`reveal` + `skipped`, `paused` + `resumed`)
  have no defined order and a "latest event" lookup would be a coin flip. Pause vs. resume is
  decided by counting (`pauses > resumes`) and the frozen remainder is the smallest of the pauses
  (successive pauses never increase the remainder) — both order-free. A restart therefore cannot
  make a paused game run on or auto-end, and cannot lose a skip.
- `playerSync` now reports `outcome: 'skipped'` (not `null`) during a skipped reveal, so a
  reconnecting player sees the same screen the live event showed.

### 2.3 `socket.ts`

- `host:pause`, `host:resume`, `host:skip` are new commands behind the same `assertHost`
  guard as the existing host commands.
- `host:kick` gained a **lobby-only** check and a "not in this game" check. Removing a player
  mid-game would silently rewrite a live ranking, so it is refused.
- A kicked player is told first (`game:kicked`), then removed from the player rooms, then the
  lobby is re-broadcast — so the roster the remaining players see never lists someone who has
  already been told to leave.
- **Host presence** (new): the `/host` room size decides `connected` / `reconnecting`. A
  change is debounced (`PRESENCE_DEBOUNCE_MS`) so a reload does not flash at the players, and
  the first value for a game is sent without waiting. Only the host's reachability leaves the
  server here — never a phase, a session or any host data.
- `sendPlayerResults` emits `outcome: 'skipped'` for a skipped question instead of a
  correct/wrong verdict. The reveal handler forwards the `HostReveal` the engine built, so the
  skipped variant (question identity + text only) is what reaches the host.

### 2.4 Reports (`services/reportService.ts`)

A skipped question is neutralised, so every report marks it rather than presenting it as an
ordinary question:

- `gameReport` sets `skipped: true` on a skipped question's entry.
- `exportAnswersCsv` gains a `skipped` column, set to `true` for that question's rows.
- `quizStatistics` gains `skippedGames` per question (how many finished games skipped it), so
  a low `answered`/`correct` count is explained instead of read as a hard question.
- A shared `skippedQuestionIds` helper reads the `skipped` rows from the existing `GameEvent`
  log — no new column.

## 3. Frontend

- `hostView.ts`: `hostActions(phase, paused, type?)` is the single source of truth for the
  control bar. A paused question offers only **Resume** and **Skip** (the engine refuses a
  plain reveal while paused, so **Reveal** would be a dead button). A `slide` offers no
  **Pause** (the engine refuses it). `attachHostHandlers` now registers 8 listeners,
  including `host:paused`/`host:resumed`. `revealBody(reveal)` is the single pure builder for
  the reveal screen: the skipped branch renders the question text plus a "Question skipped"
  chip and nothing else, and the regular branch renders the solution and the distribution.
- `pages/host.ts`: `controlsFor(phase, isPaused, type?)`; **Skip** keeps a confirmation
  dialog (it ends the question early). The reveal screen renders `revealBody(reveal)`. The
  open question and its answer count are held in module state, so a pause/resume re-renders
  the screen in place — the answer count is kept in step by the `answers` handler, so a
  re-render never shows a stale number.
- `pages/player.ts`: handles `game:paused`/`game:resumed` (re-renders in place, freezes the
  answer control) and `game:kicked` (clears the session, returns to the join form). A skipped
  question shows "Question skipped" instead of a verdict.
- `playerView.ts`: `hostPresenceStatus` and `hostStatusChip`. The chip renders **only** while
  the host is away — a permanent "Host connected" badge would be noise — and carries the
  meaning in its text, not in its colour alone.
- `styles/tokens.css`: additive only (`.player-host-status`, `.show__paused`, `.show__skipped`,
  and the `inline-flex` roster row so the kick button sits beside the name).

## 4. Tests

| Layer    | File                                                                          | Result               |
| -------- | ----------------------------------------------------------------------------- | -------------------- |
| Backend  | `src/engine.integration.test.ts` (new "pause / resume / skip" block + slides) | 201 total (12 files) |
| Backend  | `src/host-sync.integration.test.ts` (new J, K, K2, K3, L)                     |                      |
| Backend  | `src/snapshot.integration.test.ts` (skipped report/CSV/statistics)            |                      |
| Frontend | `src/hostView.test.ts`, `src/playerView.test.ts`                              | 318 total (12 files) |
| Shared   | unchanged                                                                     | 89 total (4 files)   |

The new integration cases run against **real Socket.IO and a real PostgreSQL**:

| Case | What it proves                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| —    | pause freezes the clock, persists it, and refuses an answer while paused                                   |
| —    | resume continues with the remaining time and refuses a double resume                                       |
| —    | a paused question never auto-reveals on its own                                                            |
| —    | skip neutralises the question: points refunded, correct answer zeroed, earlier points preserved            |
| —    | a skip and an end in the same tick never produce a partial refund                                          |
| —    | skip works from a paused question                                                                          |
| —    | a slide cannot be paused or resumed, but can still be skipped                                              |
| —    | pause/resume/skip are refused outside a running question                                                   |
| —    | a paused clock and a skipped flag both survive a cold reload                                               |
| —    | a reconnecting player is told the question was skipped, not handed a verdict                               |
| J    | pause reaches both host and player, survives a host reconnect, and blocks an answer                        |
| K    | skip reaches the host with `skipped: true` and the player with `outcome: 'skipped'`                        |
| K2   | a skipped reveal carries no solution and no distribution (decision B)                                      |
| K3   | a regular reveal still carries the solution and the distribution                                           |
| L    | a kick removes the player, tells them, and is refused once the game has started, and for an unknown player |
| —    | a skipped question is marked as skipped in the report, the CSV export and the statistics                   |

## 5. Bestandsschutz evidence

- **No migration.** `prisma migrate status` reports "Database schema is up to date!". The new
  state is stored as rows in the existing `GameEvent` table.
- **No new dependency.** No `package.json` change in any package.
- **Additive CSS.** One block is appended to `tokens.css`; nothing above it changes.
- **API preserved.** No route changes. `host:kick` keeps its name, payload and guard; only a
  lobby check and a notification were added. Existing host commands (`start`, `next`,
  `reveal`, `board`, `end`) keep their payloads.
- **Behaviour preserved.** Questions, answers, accounts, roles and permissions are untouched.
  A skipped question is stored, not deleted; its answers are kept but zeroed, and the points
  it awarded are refunded so the ranking is as if it was never asked. Earlier questions are
  never touched.
- **Server stays the authority.** Disabled controls and hidden buttons are a convenience; the
  engine re-checks the phase and the pause on every command, under the existing phase lock.

## 6. Gate

Build, typecheck, `npm run lint` and `prettier --check .` are clean; the full suite is green
(201 + 318 + 89 = **608** tests). No deployment and no Portainer change.

## 7. Decisions taken (chrisB, 2026-11-07)

The three questions below were open in the first draft of this report; the project owner has
since answered them, and the implementation follows the answers.

1. **Does a skip void the question, or only end it early?** — **It neutralises it (void).** The
   question is never scored: the points it awarded are refunded, its correct answer is
   neutralised and its answers are kept (zeroed) for the record. See `refundQuestion`.
2. **Does the host need the solution on a skipped question?** — **No.** The skipped reveal is
   the `HostReveal` skipped variant, which carries only the question's identity and text; the
   solution and the distribution never leave the server.
3. **Should the host be able to pause a slide?** — **No.** A slide carries no clock, so pause
   and resume are refused for it; the host console offers no Pause button.
