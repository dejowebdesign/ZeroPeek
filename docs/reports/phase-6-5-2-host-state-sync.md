# Phase 6.5.2 – Host control and phase display (report)

- **Branch:** `feat/phase-6-5-2-host-state-sync`
- **Base:** `main` after PR #29 (`42ca494`)
- **Scope:** the host surface (roadmap §6, "Admin und Host") — authoritative host state,
  phase-derived controls, a connection indicator, and reconnect re-sync
- **Status:** implemented, awaiting review

This phase makes the host console a **server-driven** surface. Before it, the host page kept
its own idea of which phase the game was in, and a browser reload dropped the host back to
the lobby no matter how far the game had progressed. Now the server is the only source of
truth: `host:create` and `host:join` both return a full, phase-aware `HostState`, the control
bar is derived from the phase that state reports, and a reconnect re-requests that state.

It adds no dependency, no table and no column. No user account, role, permission, question,
answer, API route or engine rule is removed or rewritten.

## 1. What changed

```
host:create / host:join
        │
        └─► engine.hostState(game)  ──► HostState { gameId, pin, phase,
                                                     question, reveal, players,
                                                     podium, answers }
                    │
                    ▼
        renderHostState(input)          ← the single entry point for every screen
                    │
        hostScreen(state) ──► 'lobby' | 'question' | 'reveal' | 'board' | 'end'
                    │
        controlsFor(phase) ──► hostActions(phase) ──► the allowed controls

socket 'disconnect' ──► setConnection('reconnecting') ──► controls disabled
socket 'connect'    ──► resync() ──► host:join ──► renderHostState({ kind: 'sync' })
```

### Before / after

| Concern           | Before                                                        | After                                                     |
| ----------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| Host phase source | client state (`HostGame`, per-screen globals)                 | the server's `HostState.phase`                            |
| Reload mid-game   | dropped to the lobby, "Start game" then 409s                  | resumes the live screen (question/reveal/board/podium)    |
| Listeners         | `showLobby` registered **5 listeners on every call**          | registered **once** per socket; re-render swaps behaviour |
| Controls          | hardcoded per screen, could offer an action the phase forbids | derived from `hostActions(phase)`                         |
| Connection state  | invisible                                                     | a banner + disabled controls while the socket is down     |

## 2. Backend – the authoritative host state

### 2.1 `HostState` (shared contract)

`packages/shared/src/events.ts` gains `HostState`, deliberately **separate** from
`PlayerSync`. A host is the game master, never a participant: the two contracts must not be
interchangeable. Every field maps 1:1 onto an existing host event payload, so a reconnect
renders through the same code as the live events.

| Field      | Live event it mirrors       | When it is populated                               |
| ---------- | --------------------------- | -------------------------------------------------- |
| `question` | `host:question`             | `question` (solution-free `PublicQuestion`)        |
| `reveal`   | `host:reveal`               | `reveal` only — the full `Question` + distribution |
| `players`  | `host:lobby` / `host:board` | `lobby`, `board`, `end`                            |
| `podium`   | `host:ended`                | `end` only                                         |
| `answers`  | `host:answers`              | `question` and `reveal`                            |

### 2.2 `engine.hostState(game)`

The builder lives in the engine, not the socket layer, so it is unit-testable and stays next
to the runtime state it reads. It **never** includes an answer slot, and the roster is the
same `PublicPlayer[]` the leaderboard already uses, so a host can never appear in it. It
exposes the solution **only** from the reveal onwards, mirroring exactly when `host:reveal`
fires — a reconnect cannot leak the answer early.

### 2.3 Socket wiring

`host:create` and `host:join` now both ACK with `engine.hostState(game)` instead of a partial
object. `host:join` also joins the host room, so a reloaded host keeps receiving live events.
The now-unused local `toPublic` helper in `socket.ts` was removed in favour of the engine's
`publicPlayer`.

**No new route, no new event name, no permission change.** `assertHost` (owner, or any admin)
still guards every host command.

## 3. Frontend

### 3.1 `hostView.ts` — the pure rules (new)

A DOM-free, socket-free module, unit-tested like `playerView.ts`:

- `hostScreen(state)` — phase → screen, with safe fallbacks when phase data is missing;
- `hostActions(phase)` — the allowed controls per phase (the single source of truth for the
  control bar);
- `connectionStatus(status)` / `canAct(status)` / `nextStatus(current, event)` — the
  connection rules;
- `attachHostHandlers(socket, handlers)` / `detachHostHandlers(socket)` — **idempotent**
  listener registration;
- `rememberGame` / `forgetGame` / `rememberedGame` — best-effort `sessionStorage` for
  auto-resume, guarded so a browser that blocks storage never throws.

### 3.2 `pages/host.ts` — one entry point

- `renderHostState(input)` is now the only way a host screen is drawn, whether the input came
  from a live event or from a reconnect (`kind: 'sync'`). Nothing decides the phase locally.
- `ensureSocket()` wires the listeners **once**; `attachHostHandlers` guarantees a single
  registration, which fixes the listener-accumulation bug in the old `showLobby`.
- `setConnection(status)` repaints the banner and disables every `button[data-host-action]`
  while the socket is down. The disabled control is a courtesy — the server still validates.
- On a **reconnect** (not the first connect) the host re-requests its state via `resync()`.
- A reload resumes the remembered game before the home screen is drawn; leaving via "Home"
  clears it, so a deliberate exit is not undone by the next reload.
- `controlsFor(phase)` builds the control bar from `hostActions`, so the host can never be
  offered an action the current phase forbids. Only "End game" is destructive and keeps its
  confirmation dialog.
- The answer counter is seeded from `HostState.answers` on a reconnect, so the count is
  correct immediately instead of reading "0 answers" until the next answer arrives.

## 4. Tests

| Layer    | File                                          | Result               |
| -------- | --------------------------------------------- | -------------------- |
| Backend  | `src/host-sync.integration.test.ts` (new, 10) | 175 total (12 files) |
| Frontend | `src/hostView.test.ts` (new, 20)              | 305 total (12 files) |
| Shared   | unchanged                                     | 89 total (4 files)   |

`hostView.test.ts` covers the phase → screen and phase → action mappings, the connection
rules, the storage helpers, and — most importantly — that `attachHostHandlers` registers each
listener **exactly once** however often it is called, and that a re-registration swaps the
handler without double-firing.

`host-sync.integration.test.ts` drives **real Socket.IO** against a real PostgreSQL and
covers the phase brief's cases:

| Case | What it proves                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| A    | a reconnect in the lobby restores the PIN and the roster                                                      |
| B    | a reconnect mid-question restores the question and keeps `openedAt` (no countdown restart); no solution leaks |
| C    | a reconnect in the reveal restores the solution and the distribution                                          |
| D    | a reconnect in the board restores the ranking                                                                 |
| E    | a reconnect after the end restores the final ranking and podium                                               |
| H    | no session → `connect_error`; another host → refused; the host is never a player; a bad game id → "not found" |
| I    | **regression guard for PR #29:** a racing `host:end` + auto-reveal always leaves the game `end`, run 40×      |

### Verified red without the fix

Reverting `socket.ts` to the old partial ACK makes **6 of the 10** new tests fail (the 4 that
still pass are the authorization cases, which do not depend on the state shape). The suite is
therefore a real guard, not a tautology.

## 5. Bestandsschutz evidence

- **No migration.** `prisma migrate status` reports "Database schema is up to date!".
- **No new dependency.** The page uses `@zeropeek/shared` types and the existing UI kit.
- **Additive CSS.** One block is appended to `tokens.css` (`.host-connection*`); nothing above
  it changes.
- **API preserved.** No route changes; the only contract change is the host socket ACK, which
  is server → host and was widened, never narrowed.
- **Behaviour preserved.** `host:start`, `host:next`, `host:reveal`, `host:board`, `host:end`
  and `host:kick` keep their payloads and their owner/admin guard.
- **Server stays the authority.** Disabled controls are a convenience; the engine still
  validates every transition, and the phase lock from PR #29 is asserted by test I.

## 6. Gate

Build, typecheck and `prettier --check .` are clean; the full suite is green
(175 + 305 + 89 = **569** tests). The new integration suite was run four times back to back
to confirm it is not flaky. No deployment and no Portainer change.

## 7. Open questions for the project owner

1. Should a host be able to **pause/resume** and **skip a question**? That is roadmap 6.5.3
   and needs a separate approval; it would add two engine commands and a pause flag.
2. Should the host's connection state also be pushed to the players, or is a silent reconnect
   (as now) enough?
3. The lobby currently offers no **kick** control even though `host:kick` exists. Should the
   roster gain one in 6.5.3?
