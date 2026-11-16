# Phase 6.8.5 – Clock Synchronisation & Socket Rate Limiting

- **Branch:** `feat/phase-6-8-5-socket-security-clock-sync` (from `main` = `c3ffb70`)
- **Scope:** two independent hardening items left over after 6.8.4 —
  (1) a reliable **server↔client clock sync** so every countdown shows the same
  number, and (2) **rate limiting** on the gameplay Socket.IO events that bypass
  the HTTP limiter.
- **Status:** work complete on the branch, **awaiting owner approval** — no push,
  no pull request, no merge, no deploy yet.

> **Note (added in Phase 6.8.6):** the status above is a historical snapshot from when this
> report was written. The work has since been merged into `main` (PR #45) and deployed. This
> report's contents and test results are left unchanged.

## 0. Result in one sentence

A client can now measure the server's clock and render the countdown against it,
so a phone set a few minutes fast no longer shows a different number than the
beamer; and the three gameplay socket events (`player:join`, `player:rejoin`,
`player:answer`) are bounded per server-owned identity, so a flood is rejected
without touching any score or state.

## 1. Starting point (verified in the code, not assumed)

Before this phase:

- **The countdown was drawn from `Date.now()` on the client.** The host
  (`pages/host.ts`, `startTimer`) computed `Date.now() − openedAt`; `openedAt` is
  a **server** timestamp (the engine's `openedAt`). Comparing a server timestamp
  to a client clock only works when the two clocks agree. A client whose clock is
  off shows a wrong number (possibly a countdown that starts below its full value
  or never reaches zero). There was **no** clock sync anywhere in the codebase.
- **Socket.IO events were not rate-limited.** Fastify rate-limits HTTP
  (`@fastify/rate-limit`, plus the per-route `authRateLimits` in `config.ts`), but
  `player:join`, `player:rejoin` and `player:answer` never pass through the HTTP
  router. `docs/architecture/0006-security-model.md` listed "Rate limiting on hot
  paths (join, answer, chat-like events)" as a goal, and it was not yet built.

The countdown decision (the server stays authoritative; the client only _shows_ a
number) matches the existing `reconnect`/`host-sync` design and the open question
Q2 ("too fast" rule) in `docs/architecture/README.md`, which is untouched.

## 2. Binding decisions applied

| Decision           | Value                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------ |
| Clock model        | NTP-style offset from a ping/pong round (RFC 5905), inverted for our direction             |
| Probe count        | 5 per round (`CLOCK_SAMPLE_COUNT`), best (smallest round-trip) sample wins                 |
| Usable sample      | Round-trip ≤ 2000 ms (`CLOCK_MAX_ROUND_TRIP_MS`); others ignored, never clamped            |
| No measurement yet | `serverNow()` falls back to `Date.now()`, i.e. the exact pre-6.8.5 behaviour               |
| Authority          | The clock only changes what a client **shows**; the server still decides every deadline    |
| Limiter identity   | Server-owned only: socket id before a seat, seated `playerId` after — never a client field |
| Limiter shape      | In-memory token bucket per `(rule, key)`; no Redis dependency added                        |
| Enforcement toggle | `SOCKET_RATE_LIMITS` (default on; off in tests unless a suite opts in)                     |

Limits (`SOCKET_RATE_RULES` in `packages/backend/src/socketRateLimit.ts`):

| Rule             | Max / window | Why                                                            |
| ---------------- | ------------ | -------------------------------------------------------------- |
| `join`           | 10 / 10 s    | A player joins once; a reload and a mistyped PIN still fit     |
| `joinByAddress`  | 60 / 10 s    | Loose per-address backstop so fresh socket ids cannot reset it |
| `answer`         | 20 / 10 s    | One answer per question; covers fast rounds, blocks a spray    |
| `rejoin`         | 15 / 10 s    | Reconnect storms are legitimate; a little roomier than join    |
| `rejoinBySocket` | 20 / 10 s    | Per-connection backstop for a spray that names many seats      |

## 3. Changes

### 3.1 Shared (`@zeropeek/shared`)

| File            | Change                                                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/clock.ts`  | **New.** Pure offset maths: `ClockSample`, `ClockOffset`, `CLOCK_SAMPLE_COUNT`, `CLOCK_MAX_ROUND_TRIP_MS`, `offsetOfSample`, `bestOffset`. No `node:` imports, no DOM, no timers. |
| `src/events.ts` | New `ClockPing`/`ClockPong` payload types and the `clock:ping` (client→server) / `clock:pong` (server→client) events on **both** the player (`/`) and host (`/host`) event maps.  |
| `src/index.ts`  | Re-exports `./clock.js`.                                                                                                                                                          |

### 3.2 Backend

| File                     | Change                                                                                                                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/socketRateLimit.ts` | **New.** `SocketRateLimiter` (token bucket, injectable clock, `enabled` flag, `consume`/`check`/`reset`) and the central `SOCKET_RATE_RULES`.                                                                                                   |
| `src/socket.ts`          | `answerClockPing` helper + `clock:ping` handlers on both namespaces; one shared `SocketRateLimiter` (`enabled: config.socketRateLimits`) with `check` calls on `player:join`, `player:rejoin` and `player:answer`, before any state is touched. |
| `src/config.ts`          | New `socketRateLimits: boolean` field, read from `SOCKET_RATE_LIMITS` (default: on outside `test`, off in `test` unless set) — the same rule as `authRateLimits`.                                                                               |

### 3.3 Frontend

| File                | Change                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/clockSync.ts`  | **New.** `ClockSync` client: sends `samples` probes sequentially, correlates each pong by id, keeps the best offset, exposes `serverNow()`. Uses `performance.now()` for the measurement. |
| `src/pages/host.ts` | Creates one `ClockSync` per host socket, re-syncs on every (re)connect; `startTimer` and the `resumed` handler read `clock.serverNow()` instead of `Date.now()`.                          |

### 3.4 Deployment & config

| File                             | Change                                             |
| -------------------------------- | -------------------------------------------------- |
| `docker-compose.yml`             | `SOCKET_RATE_LIMITS: ${SOCKET_RATE_LIMITS:-true}`. |
| `docker-compose.portainer.yml`   | Same.                                              |
| `.env.portainer.example`         | Documented (commented) `SOCKET_RATE_LIMITS`.       |
| `docs/deployment/PORTAINER.md`   | Row in the variable table.                         |
| `docs/deployment/ENVIRONMENT.md` | Row in the variable table.                         |

## 4. Design points worth stating explicitly

- **The clock is measurement, not authority.** `ClockSync` only changes the number
  a countdown draws. The engine's own deadline is unchanged, and the integration
  test proves a corrected client clock cannot get a second answer accepted. This
  keeps the Phase 6.5/6.8 rule "the server is the single source of truth" intact.
- **Monotonic time for measurement, wall time for output.** The round-trip is
  measured with `performance.now()`, so a wall-clock change or a resume from
  sleep cannot corrupt a sample; only the final `serverNow()` is in wall-clock
  units, because that is the unit `openedAt` uses.
- **A bad sample is dropped, not clamped.** A round-trip over 2 s, a negative
  round-trip or a non-finite reading yields no offset, so one unlucky packet
  cannot drag the estimate. Before the first good sample the client behaves
  exactly as before (local clock).
- **The bucket key is never a client field.** A join is keyed by the socket id
  (the only server identity before a seat exists), an answer/rejoin by the seated
  `playerId` the server assigned. A manipulated payload (an extra `playerId`, a
  different `questionId`) cannot move a bucket; the integration test asserts this.
- **A rejection is inert.** `limiter.check` runs before the handler body, so a
  rejected call changes no seat, score, phase or state; the socket stays
  connected and gets an error ACK (`AppError` 429, `rate_limited`).
- **Two backstops, not two identities.** The address key (join) and the socket
  key (rejoin) are deliberately _looser_ than the primary key. They exist only so
  that cycling reconnects to obtain fresh socket ids cannot reset the primary
  allowance; they are not an identity of their own.
- **No Redis added.** The limiter is a per-process in-memory map. That is correct
  for the current single-instance deployment and matches the existing in-memory
  engine. Multi-instance scaling is a separate, already-tracked concern
  (`docs/architecture/0006-security-model.md`).
- **The limiter is disabled in the test environment** (unless a suite opts in
  with `SOCKET_RATE_LIMITS=true`), so the many existing socket suites are not
  tripped by their own traffic — the same pattern already used for
  `authRateLimits`.

## 5. Tests

All suites green with a real PostgreSQL reachable (`TEST_DATABASE_URL` /
`DATABASE_URL`), no skips:

| Package  | Before 6.8.5 | After 6.8.5 | New tests                                                                                                          |
| -------- | ------------ | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| shared   | 165          | 179         | `clock.test.ts` (+14)                                                                                              |
| frontend | 458          | 469         | `clockSync.test.ts` (+11)                                                                                          |
| backend  | 350          | 385         | `socketRateLimit.test.ts` (+13), `clock-ratelimit.integration.test.ts` (+16), config (+2), deployment compose (+4) |

(The backend baseline of 350 is the full total; the DB-backed suites report as
skipped without a database, so with one reachable every one of the 385 runs.)

New coverage, in outline:

- **Shared clock maths** — exact offset recovery, negative offsets, magnitude
  independence, unusable samples (long/negative/non-finite), best-of-N selection,
  tie-breaking, outlier rejection.
- **Backend limiter (unit)** — allow-then-reject, window reopen, per-key and
  per-rule independence, no window extension on a rejected call, `retryAfterMs`,
  `AppError` 429, disabled no-op, `reset`.
- **Backend clock + limits (integration, real Socket.IO + DB)** — a pong carries
  a plausible server time and echoes the id on both namespaces; unknown/malformed
  ids are tolerated; many concurrent players; a ping still works after a
  reconnect; a late answer is still refused; a join/answer/rejoin flood is
  rejected; a rejected join changes no roster; a rejected answer changes no
  score; each player's answer allowance is separate; a spray naming many seats is
  bounded by the per-socket backstop; a fresh connection has its own bucket.
- **Frontend `ClockSync`** — offset recovery, `serverNow()` on the server clock,
  local fallback before a measurement, probe count, stray/duplicate pong ignored,
  mismatched id unusable, an unanswered probe times out without hanging,
  overlapping callers share one round, a reconnect re-measures, `dispose()` stops
  listening.

Verification commands (all pass):

```
npm run typecheck            # shared + backend + frontend
npm run lint                 # no findings
npm run format:check         # Prettier clean
npm run build                # full monorepo build
npx vitest run --root packages/shared
npx vitest run --root packages/frontend
DATABASE_URL=… npx vitest run --root packages/backend   # 385 tests, 0 skipped
```

## 6. What this phase deliberately does **not** do

- It does not add a separate beamer surface, a show token, or any UI — the
  combined host/beamer view is unchanged (roadmap §10).
- It does not change the scoring formula, the "too fast" rule or the level curve
  (open questions Q1/Q2, roadmap §9.1).
- It does not add Redis or any new runtime dependency.
- It does not touch the database schema; there is **no migration** in this phase.

## 7. Risks and follow-ups

| Item                                   | Note                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Limiter is per-process                 | Correct for one instance; a multi-instance deployment needs a shared store (Redis) — already tracked.   |
| Limiter has no metrics                 | Rejections are not yet counted; a small counter would help tuning later (not required now).             |
| Countdown correction is client-visible | A player could ignore the correction; it only affects their own display, never the server's decision.   |
| Sample count / max round-trip          | Fixed constants; if a future network profile needs tuning, they live in one place in `shared/clock.ts`. |

## 8. Files touched

**New:** `packages/shared/src/clock.ts`, `packages/shared/src/clock.test.ts`,
`packages/backend/src/socketRateLimit.ts`, `packages/backend/src/socketRateLimit.test.ts`,
`packages/backend/src/clock-ratelimit.integration.test.ts`,
`packages/frontend/src/clockSync.ts`, `packages/frontend/src/clockSync.test.ts`.

**Changed:** `packages/shared/src/events.ts`, `packages/shared/src/index.ts`,
`packages/backend/src/socket.ts`, `packages/backend/src/config.ts`,
`packages/backend/src/config.test.ts`, `packages/backend/src/deployment.compose.test.ts`,
`packages/frontend/src/pages/host.ts`, `docker-compose.yml`,
`docker-compose.portainer.yml`, `.env.portainer.example`,
`docs/deployment/PORTAINER.md`, `docs/deployment/ENVIRONMENT.md`.
