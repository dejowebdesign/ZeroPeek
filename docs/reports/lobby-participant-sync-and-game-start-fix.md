# Lobby participant sync and game start – bugfix (report)

- **Branch:** `fix/lobby-participant-sync-and-game-start`
- **Base:** `main` (`f3156f5`, after PR #31)
- **Scope:** the lobby → game-start synchronisation only (bug report §9). No new feature, no
  design change, no migration, no dependency.
- **Status:** implemented, awaiting review
- **Verdict:** the three reported symptoms are **one** root cause — a join that races the
  host's start is not serialised against it.

## 1. Symptom (as reported)

A player joined by PIN, the player page showed "You're in, dpg! … Waiting for the host…",
but the host's lobby stayed empty and its "Start game" then failed with
_"The game has already started."_ Three visible problems, investigated together:

1. joined players missing from the host roster;
2. host and player on different / stale game states;
3. the start button visible but the start refused.

## 2. Root cause (confirmed, not a guess)

The backend is the source of truth and, on the happy path, is correct: I reproduced a clean
join + start over real Socket.IO and it worked end to end. The defect is a **race** between a
player join and the host's start, and it has two halves that produce exactly the three
symptoms.

### 2.1 A join is not serialised against the start

`player:join` did two separate things with no lock between them:

```ts
// socket.ts (before)
const { game, player } = await joinGame(pin, nickname, avatar); // DB row written, phase checked
await socket.join(playerRoom(game.id));
await engine.addPlayer(game.id, { … });                         // runtime updated, lobby emitted
```

`engine.start` is guarded by the per-game **phase lock** (`withPhaseLock`, PR #29), but the
join was not. So this interleaving is possible:

```
joinGame()  ── phase == 'lobby' ✓, INSERT game_players row committed
start()     ── phase = 'question', freeze snapshot, open Q1, emit 'question'
addPlayer() ── runtime updated, emit 'lobby'      ← a lobby AFTER the question opened
```

The last line is the bug: a **stale `host:lobby` broadcast arrives after `host:question`**.
`pages/host.ts` renders whatever the last event carried (`renderHostState`), so the host is
dragged back to the lobby screen — with a roster that does not include the player, because
that player was only added to the runtime after the roster had already been frozen — while
the engine sits in `question`. The "Start game" button the lobby shows is then rejected with
_"The game has already started."_ That is all three symptoms from one race.

I confirmed the ordering with a temporary probe: the emitted sequence was
`["lobby:Ada", "question", "lobby:Ada,Bob"]` — a lobby after the question.

### 2.2 A join accepted before the start can be lost to it

Because the phase check (`game.phase !== 'lobby'`) and the runtime update (`addPlayer`) are
separate, a join can pass the check, have its row committed, and then be **overwritten** by
the start's snapshot of the roster. The player has a valid row and a valid token, and the
player page confirms the join, but the host never sees them. This is the "player appears to
join but never shows up" report, and it is the same missing lock.

### 2.3 Why this surfaced now

Phase 6.5.2 made the host fully server-driven: it renders the _last_ payload it receives and
never keeps its own phase. That is the right design, but it means a late lobby event now
visibly drags the host back — before, the host kept its own screen and the late event was
harmless. Phase 6.5.2/6.5.3 did not introduce the race; they made an existing one visible.
The lock itself (PR #29) covers only host transitions, never the join.

## 3. The fix

Two changes, both in the backend. No frontend masking, no suppression of the error.

### 3.1 `engine.join` — the join runs under the same phase lock as `start`

`packages/backend/src/services/engine.ts`

```ts
async join(pin: string, nickname: string, avatar = '') {
  const found = await findGameByPin(pin);          // read-only, resolves the lock key
  return this.withPhaseLock(found.id, async () => {
    const { game, player } = await joinGameRow(pin, nickname, avatar); // re-checks the phase
    await this.addPlayer(game.id, { … });
    return { game, player };
  });
}
```

The phase check, the row write and the runtime update now happen **atomically with respect to
`start`**, because both take `withPhaseLock(gameId)`. The interleaving in §2.1 is impossible:
either the join completes first and the player is in the roster the start freezes, or the
start completes first and the join's phase check (now run under the lock, after the start)
rejects it with _"This game has already started."_ — a clean, honest error instead of a
half-join.

### 3.2 `emitLobby` never broadcasts outside the lobby

`packages/backend/src/services/engine.ts`

```ts
emitLobby(game: RuntimeGame): void {
  if (game.phase !== 'lobby') return;   // a roster after the question opened is the bug
  this.emit('lobby', { … });
}
```

Defence in depth: even if some future path updates the roster late, a `lobby` event can never
reach a host (or a player) once the game has left the lobby. The game's own state transitions
already guard this; the broadcast now does too.

### 3.3 `socket.ts` uses the engine's join

`packages/backend/src/socket.ts` calls `engine.join(...)` instead of the two-step
`joinGame` + `addPlayer`. The socket layer still owns the room joins and the host-presence
ping, which are per-connection concerns the engine has no business knowing about.

## 4. Affected components and files

| File                                                  | Change                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/backend/src/services/engine.ts`             | `emitLobby` phase guard; new lock-serialised `engine.join`            |
| `packages/backend/src/socket.ts`                      | `player:join` routes through `engine.join`; unused imports dropped    |
| `packages/backend/src/lobby-sync.integration.test.ts` | new – the 15 scenarios from the brief, over real Socket.IO + Postgres |

Nothing else. No route, no contract, no schema, no frontend file, no `package.json`.

## 5. Tests (brief §6, scenarios 1–15)

New suite `lobby-sync.integration.test.ts`, real Socket.IO against real PostgreSQL, one test
per scenario:

| #   | Scenario                            | Assertion                                                            |
| --- | ----------------------------------- | -------------------------------------------------------------------- |
| 1   | Host creates a lobby                | phase `lobby`, PIN returned, empty roster                            |
| 2   | One player joins                    | player in the `host:lobby` payload **and** in the `host:join` roster |
| 3   | Several join in sequence            | all three present                                                    |
| 4   | Several join at once                | all six present, none lost                                           |
| 5   | Host starts after a join            | phase `question`, player receives `game:question`                    |
| 6   | Join races the start                | started exactly once; no half-join; row ⟺ roster                     |
| 7   | Host refresh                        | roster restored                                                      |
| 8   | Host reconnect                      | full state restored                                                  |
| 9   | Player refresh                      | one row, no duplicate                                                |
| 10  | Player reconnect mid-game           | phase `question`, correct question                                   |
| 11  | Already-started game syncs          | running phase, no solution leaked                                    |
| 12  | Double start                        | one `game:question`, one snapshot, second start rejected             |
| 13  | Late lobby event after start        | no `host:lobby` after the first `host:question`                      |
| 14  | Unknown game id                     | rejected                                                             |
| 15  | Host + several players concurrently | same phase everywhere, `answers.total` = roster size                 |

### It is a real guard (red-test)

Reverting only §3.1/§3.3 (back to the two-step join) makes **scenario 6 fail** with
`expected false to be true` (the player's row exists but is absent from the roster); the other
14 still pass. Restoring the fix turns it green. The test genuinely detects the race.

## 6. Results

| Check                            | Result                   |
| -------------------------------- | ------------------------ |
| Backend suite (incl. the new 15) | **216 passed**           |
| Frontend suite                   | **318 passed**           |
| Shared suite                     | **89 passed**            |
| **Total**                        | **623 passed**           |
| `npm run typecheck`              | 0 errors                 |
| `npm run lint`                   | clean                    |
| `prettier --check .`             | clean                    |
| `npm run build`                  | OK                       |
| Realtime suites (3× repeat)      | 45/45 each run, no flake |
| Database migration               | none required            |

## 7. Remaining risks / open points

- **Multi-instance deployment.** The phase lock is **in-process**. The current Portainer stack
  runs a single backend replica and no Redis adapter is configured for Socket.IO, so this is
  correct today. If the backend is ever scaled to more than one replica, the lock must move to
  a shared primitive (Redis) together with the Socket.IO adapter — otherwise the same race can
  return across processes. Documented here; no change made, since it is out of this scope.
- **`host:join` vs. a live event.** A host's initial `host:join` snapshot and a concurrent live
  `host:lobby` are not ordered relative to each other. This is benign: the snapshot and the
  event are built from the same server roster, and `emitLobby` now never fires outside the
  lobby, so the two can only agree. I did not add a sequence number, as that would be a larger
  change than this bugfix warrants; flagging it as a known, non-reproducible-under-current-
  design edge.
- **Client-side ordering.** The host trusts the order in which socket events arrive. The server
  now only ever emits a `lobby` while genuinely in the lobby, so a stale lobby can no longer be
  produced; the client needs no change.

## 8. What was explicitly not done

No new feature, no Phase 6.6, no profile/inventory/XP/level work, no design or layout change,
no animation, no screenshot or visual browser check, no AI image generation, no architecture
change beyond the one lock, no deployment, no Portainer action, no production data touched.
