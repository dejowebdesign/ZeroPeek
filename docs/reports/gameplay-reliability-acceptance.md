# Complete gameplay reliability – fix and acceptance report

- **Branch:** `fix/complete-gameplay-reliability`
- **Base:** `main` after PR #33 (`1b23498`, merge of the Phase 6.6 player profiles)
- **Scope:** reliability of the full gameplay loop — host control, restart recovery, question types, time limits, races and reconnects
- **Status:** implemented and verified; awaiting review and merge

No schema, dependency, API-contract, admin, quiz-editor or snapshot behaviour is
changed. The engine keeps its existing events and payload shapes.

## 1. Defects fixed

Three defects in the live gameplay loop were found by driving the real server
process and the real browser UI, and fixed here.

### 1.1 Host page received no game events at all

`attachHostHandlers` (`packages/frontend/src/hostView.ts`) registered listeners
by extracting the method:

```ts
const register = socket.on as (event: string, listener: RawListener) => unknown;
```

`socket.on` is a prototype method. Calling it detached runs with `this ===
undefined`, so Socket.IO's emitter threw internally and **registered no
listener**. The host page therefore never rendered a lobby, a question, a
reveal or a leaderboard: the host was blind for the whole game.

The unit tests did not catch it because the fake socket was an object literal
whose `on` does not use `this`. The regression test now uses a class with real
prototype methods, so the bug cannot come back.

Fix: bind to the socket (`socket.on.bind(socket)`), the same for `socket.off`.

### 1.2 Restart recovery only handled the open question

`GameEngine.recover` (`packages/backend/src/services/engine.ts`) re-armed the
timer only for the `question` phase. A process that died during `reveal` or
`board` came back with no timer, so the game was stuck on that screen forever:
the leaderboard never advanced to the next question, and a reveal never reached
its leaderboard.

Fix: re-arm the auto-advance for `reveal` (`REVEAL_MS`) and `board` (`BOARD_MS`)
on recovery. The question timer keeps its real, once-only semantics — it is
re-armed for the _remaining_ time and reveals at once if already expired.

### 1.3 A stale timer could skip a whole question

`next` accepted any phase, and `board` accepted a jump from an open question. A
board timer armed before a manual advance could therefore fire afterwards and
move the game forward by one extra question — silently skipping a question the
players were still answering.

Fix: `next` is legal only from `board`; `board` only from `reveal`. The phase
guard lives in `nextInternal`, and `startInternal` reuses the new `advance`
helper to open the first question from the lobby without pretending to be on a
leaderboard.

## 2. Verification

Verification is **programmatic only** — no screenshots, no visual checks. Two
independent layers were used.

### 2.1 Repository test suites (in-repo, CI)

| Suite                                    | Result        |
| ---------------------------------------- | ------------- |
| Backend (`packages/backend`, 15 files)   | **243 / 243** |
| Frontend (`packages/frontend`, 13 files) | **333 / 333** |
| Shared (`packages/shared`, 5 files)      | **102 / 102** |
| `npm run typecheck` (all workspaces)     | pass          |
| `npm run build` (all workspaces)         | pass          |
| `npm run lint`                           | pass          |
| `prettier --check .`                     | pass          |

The new backend suite `packages/backend/src/gameplay-reliability.integration.test.ts`
covers the phase guard (1.3) and per-phase restart recovery (1.2). The frontend
suite `packages/frontend/src/hostView.test.ts` covers the listener binding (1.1).

### 2.2 Out-of-tree acceptance harness

A harness outside the repository drives the **real backend process** (started,
SIGKILLed and restarted as a process group) and the **real browser player UI**
(Chromium via `puppeteer-core`, assertions on DOM text and server payloads
only). It is deliberately not committed; it is a verification tool, not product
code.

| Section                      | What it proves                                                                                                                                                                  | Checks  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| A – restart recovery         | A SIGKILL + restart during `question`, `reveal`, `board`, a pause, a skip and after a phase change restores the exact phase, re-arms the right timer, and never double-advances | 34 / 34 |
| B – question types (correct) | All 13 types render and submit through the real player DOM; a correct answer is graded and scored                                                                               | 72 / 72 |
| B – question types (wrong)   | A wrong answer is graded wrong and scores nothing                                                                                                                               | 65 / 65 |
| B – question types (none)    | A non-responder is reported unanswered and scores nothing                                                                                                                       | 78 / 78 |
| B2 – time limits             | An answer inside the limit is accepted, past it is refused, and the question auto-reveals when the limit elapses                                                                | 7 / 7   |
| C – races                    | Duplicate `next`/`reveal`/`end`, auto-reveal vs manual reveal, pause vs expiry, skip vs reveal, concurrent and duplicate answers leave one coherent transition each             | 25 / 25 |
| D – reconnect                | Host and player rejoin in the lobby, question, reveal, board, pause and end phases and get the real server state; a bad token is refused                                        | 38 / 38 |

The race section is repeated to show it is not flaky. Section A is a genuine
process restart: the harness kills the whole process group and asserts the port
is free before restarting, so a "restart" can never silently talk to the old
process.

## 3. Notes for review

- The engine's `REVEAL_MS` and `BOARD_MS` are both 6000 ms by design: the game
  auto-advances without a host click. This is existing behaviour, unchanged.
- With a single player the question auto-reveals the instant they answer, so the
  host's `Reveal` button never appears. Any host-flow test needs two players.
- The frontend now re-runs the stored rejoin on every **socket** reconnect, not
  only on page load, so an automatic reconnect (dropped Wi-Fi, sleeping tab)
  rebuilds the player screen from the server instead of silently going deaf.
- The host marks the connection `reconnecting` until the resync snapshot is on
  screen, and drops a snapshot that is older than a live event already rendered,
  so a click during a reconnect cannot act on a phase the server has left.
