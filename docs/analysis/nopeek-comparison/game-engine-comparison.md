# Game engine comparison — NoPeek vs. ZeroPeek

Technical comparison of the game engine: phases, events, timing, scoring and
recovery. This is the reference for the implementation roadmap.

Sources:

- NoPeek: served client assets (`player.js`, `host.js`, `clock.js`,
  `quizschema.js`, `common.js`, `app-config.js`) and `nopeek-audit.md`.
- ZeroPeek: `packages/backend/src/services/engine.ts`,
  `packages/backend/src/socket.ts`, `packages/shared/src/{scoring,events,questions}.ts`,
  `packages/frontend/src/{pages/player.ts,pages/host.ts,questionView.ts}`.

---

## 1. Architecture at a glance

| Aspect                  | NoPeek                                                    | ZeroPeek                                                             |
| ----------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| Transport               | Socket.IO, default `/` for players, `/host` for hosts     | Socket.IO, `/` for players, `/host` for hosts                        |
| Server state            | In-memory game state + server-side JSON persistence       | In-memory fast path **plus** write-through to PostgreSQL (Prisma)    |
| Phase machine           | Implicit (lobby → lead → question → reveal → board → end) | Explicit `GAME_PHASES` = `lobby, lead, question, reveal, board, end` |
| Authoritative decisions | Server (grade, timer, rank)                               | Server (grade, timer, rank)                                          |
| Client contract         | Untyped JS objects                                        | Typed `Ack<T>` envelopes in `shared/events.ts`                       |
| Multi-instance          | Not evident                                               | Redis adapter **intended** (`REDIS_URL`) but not yet wired           |

ZeroPeek's phase list already includes `lead`, matching NoPeek's read-aloud
lead-in phase, but the engine never enters `lead` and the frontend has no lead
screen — see §3.

## 2. Event surface

### NoPeek (observed)

| Direction     | Event                                                                                                 | Payload                              |
| ------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Player→server | `join`                                                                                                | `{ pin, nick, token, avatar, pid? }` |
| Player→server | `answer`                                                                                              | `{ index, choice }` (via ACK)        |
| Player→server | `clock`                                                                                               | `{ rtt? }` → server time (ACK)       |
| Player→server | `avatar`                                                                                              | avatar ids (ACK `{ ok, av }`)        |
| Player→server | `qa:ask`, `qa:vote`                                                                                   | audience Q&A                         |
| Server→player | `lead`, `question`, `result`, `board`, `end`, `lobby`, `qa`, `kicked`, `replaced`, `build`, `rtt`     | —                                    |
| Host→server   | `create`, `attach`, `lock`, `kick`, `close`, `next`, `board`, `review`, `review-end`, `end`, `qa:mod` | —                                    |
| Server→host   | `lobby`, `lead`, `question`, `reveal`, `board`, `answered`, `review`, `review-end`, `end`, `qa`       | —                                    |

### ZeroPeek (implemented)

| Direction     | Event                                                                                                       | Payload                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Player→server | `player:join`                                                                                               | `{ pin, nickname, avatar? }` → `{ playerId, gameId, token }` |
| Player→server | `player:answer`                                                                                             | `{ questionId, answer }` → `{ accepted }`                    |
| Player→server | `player:rejoin`                                                                                             | `{ gameId, playerId, token }` → `{ ok }`                     |
| Server→player | `game:joined`, `game:state`, `game:question`, `game:reveal`, `game:board`, `game:ended`, `game:error`       | typed                                                        |
| Host→server   | `host:create`, `host:join`, `host:start`, `host:next`, `host:reveal`, `host:board`, `host:end`, `host:kick` | typed ACK `{ phase }` / `{ ok }`                             |
| Server→host   | `host:lobby`, `host:question`, `host:answers`, `host:reveal`, `host:board`, `host:ended`, `host:error`      | typed                                                        |

**Gaps in the event surface (functional):**

| NoPeek event            | Purpose                                      | ZeroPeek equivalent                                      |
| ----------------------- | -------------------------------------------- | -------------------------------------------------------- |
| `lock`                  | Lock the lobby against late joins            | **missing**                                              |
| `close`                 | Manually close the current question          | `host:reveal` (reveals immediately; no separate "close") |
| `review` / `review-end` | Re-show a finished question (frozen)         | **missing**                                              |
| `clock`                 | Clock-offset sync for a shared start instant | **missing** (server `openedAt` only)                     |
| `avatar`                | Server-validated avatar ids                  | **missing** (avatar is a free string)                    |
| `qa:*`                  | Audience Q&A                                 | **missing**                                              |
| `build`                 | Client build-hash reload guard               | **missing**                                              |

## 3. Phase flow

### NoPeek

```
lobby ──(host: next)──► lead (leadMs, answers locked)
      ──► question (answersAt absolute; server timer)
      ──► (close | all answered | timeout) reveal (+ board payload)
      ──► board ──(host: next)──► lead/question … ──► end (podium + report)
```

### ZeroPeek

```
lobby ──(host:start)──► question (openedAt; server timer = timeLimit + 1.5 s)
      ──► (host:reveal | all answered | timeout) reveal (6 s)
      ──► board (6 s) ──(host:next | auto)──► question … ──► end
```

**Differences:**

1. **Lead-in phase missing.** ZeroPeek declares `lead` in `GAME_PHASES` but
   `engine.next()` jumps straight to `question`. NoPeek's "read aloud" mode
   (`leadMs`, `answersAt`) is a core UX feature that ZeroPeek only has as a
   constant. Implementing it is **P2** (see roadmap) because it touches the
   engine, both frontends and the timer contract.
2. **Auto-advance.** ZeroPeek advances reveal→board→next automatically after
   fixed delays (`REVEAL_MS`, `BOARD_MS`). NoPeek waits for the host for
   `next`, which gives the presenter full control. ZeroPeek's host can also
   advance manually, so this is a superset, not a gap — but the fixed delays
   may surprise a presenter.
3. **No manual "close".** In NoPeek the host can close answers without
   revealing; in ZeroPeek `host:reveal` does both. Low priority.

## 4. Timing and synchronisation

| Concern              | NoPeek                                                                                                                       | ZeroPeek                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Shared start instant | Server sends absolute `at`; clients estimate clock offset via `clock` ping/pong (best-of-N, re-sync after WebSocket upgrade) | Server sends `openedAt`; client computes `remaining = timeLimit − (Date.now() − openedAt)` |
| Timer authority      | Server                                                                                                                       | Server (`setTimeout` → auto reveal)                                                        |
| Late-answer window   | Server-side check against `answersAt`                                                                                        | `timeLimit × 1000 + ANSWER_GRACE_MS (1500)`                                                |
| Elapsed time source  | Server clock                                                                                                                 | Server clock (`Date.now() − openedAt`)                                                     |

ZeroPeek's approach is simpler and adequate when all clients share the host's
clock roughly, but it **does not compensate for client clock skew**. On a phone
whose clock is minutes off, the displayed countdown drifts even though scoring
stays correct (scoring uses the server timestamp). NoPeek's clock-offset sync
removes that visible drift. This is a **P2** improvement (UX), not a
correctness issue.

## 5. Scoring — detailed comparison

> **Rule respected:** no scoring formula was copied. The reference formula is
> documented, ZeroPeek's configurable default is documented, and differences are
> listed. ZeroPeek's open questions (Q1/Q2/Q6) are **not** silently changed.

### 5.1 NoPeek (reference, as far as the client reveals)

- Points exist only for scored types (`sc`, `tf`, `multi`, `type`, `slider`,
  `order`); `poll`, `open`, `text`, `scale`, `nps`, `slide`, `ideas` are
  unscored.
- A correct answer yields a base score **plus a speed component** — the classic
  Kahoot model: the faster the correct answer, the more points, up to a maximum
  at time 0 and a floor at the time limit.
- **Double points** (`points: 'double'`) and **no points** (`points: 'none'`) are
  per-question options.
- Wrong answers: no points (and the client shows `✗`).
- The exact base value and curve are computed **server-side** and are not
  readable from the client; the client only displays the resulting points.
- Ties and team totals are computed server-side; the client renders whatever
  ordering it receives.

**Conclusion:** NoPeek's exact numeric formula is a server black box. It must
not be assumed. ZeroPeek therefore keeps its own documented, configurable
formula and treats Q1 as still open.

### 5.2 ZeroPeek (implemented, configurable)

`packages/shared/src/scoring.ts`:

```
speed            = 1 − elapsed / limit            (clamped 0..1; linear or quadratic)
bonus            = speedBonusRatio × speed        (default ratio 0.5)
points(correct)  = basePoints × (1 + bonus) × multiplier
                   multiplier = 2 for `double`, else 1
                   (doublePointsAppliesTo: 'total' | 'base')
partial credit   = points × correctness           (only when partialCredit = true)
rounding         = round to roundingStep          (default 1)
wrong answer     = wrongAnswerPoints              (default 0)
```

Defaults (`DEFAULT_SCORING`): base 1000, ratio 0.5, linear, no partial credit,
wrong 0, double applies to total.

`correctnessOf` per type:

| Type           | Correctness                                             |
| -------------- | ------------------------------------------------------- |
| `single`       | 1 if index matches, else 0                              |
| `trueFalse`    | 1 if boolean matches, else 0                            |
| `multiple`     | **any wrong pick ⇒ 0**; otherwise hits / expected count |
| `text`         | 1 if a normalised accepted answer matches, else 0       |
| `slider`       | 1 within tolerance; else linear falloff × 0.5           |
| `order`        | hits / item count (position-wise)                       |
| unscored types | 1 if answered, else 0 (no points)                       |

Ranking (`rankPlayers`): score desc, then `DEFAULT_TIE_BREAK` =
`['correctCount', 'totalTime', 'joinedAt']`; ties share a rank (1, 1, 3).

### 5.3 Differences and open points

| Topic          | NoPeek                         | ZeroPeek                         | Action                 |
| -------------- | ------------------------------ | -------------------------------- | ---------------------- |
| Base points    | unknown (server)               | 1000 (configurable)              | keep; Q1 decides       |
| Speed curve    | unknown (likely linear Kahoot) | linear/quadratic option          | keep; Q1 decides       |
| Double points  | yes                            | yes (base vs total configurable) | keep; Q1 sub-question  |
| Wrong answers  | 0                              | 0 (configurable)                 | keep                   |
| Partial credit | unknown                        | off by default                   | keep; Q1 decides       |
| Time limits    | 5–240 s list                   | 5–240 s list                     | equivalent             |
| Ties           | server-defined                 | configurable tie-break           | keep; Q6 decides       |
| Team scoring   | yes (teams)                    | not implemented                  | roadmap P3; Q4 decides |

**No formula was adopted from NoPeek.** The two formulas cannot be numerically
compared without the reference server, and ZeroPeek's Q1/Q2/Q6 remain the
deciding authority.

## 6. Anti-cheat and validation inside the engine

| Check                              | NoPeek        | ZeroPeek                                      | Notes                            |
| ---------------------------------- | ------------- | --------------------------------------------- | -------------------------------- |
| Solution never sent before reveal  | ✅            | ✅                                            | `questionDisplay` allow-list     |
| Answer only in `question` phase    | ✅            | ✅                                            | `engine.submitAnswer`            |
| Question id must match current     | ✅            | ✅                                            | `engine.submitAnswer`            |
| One answer per player per question | ✅            | ✅                                            | `answeredQuestionId` + DB unique |
| Late answer rejected               | ✅            | ✅                                            | grace 1.5 s                      |
| Answer type validated              | ✅ (per type) | ✅ (`correctnessOf` + per-type shape)         |                                  |
| "Too fast" flag                    | ✅            | 🟡 implemented, `minimumReactionMs = 0` (off) | Q2 decides                       |
| Replay / duplicate nickname        | ✅            | ✅ (accent-insensitive)                       |                                  |
| Host authorisation                 | ✅ (session)  | ✅ (`assertHost` + admin)                     |                                  |

## 7. Recovery and persistence

| Concern                       | NoPeek                                                             | ZeroPeek                                                                |
| ----------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Player reconnect              | token in `localStorage`, auto rejoin, `replaced` for second device | token in `sessionStorage`, explicit rejoin on boot                      |
| Rejoin after server restart   | Server-side store; not observable                                  | `engine.get()` reloads phase/index/players from PostgreSQL              |
| Durable results               | Server JSON store                                                  | Every answer + score written through to PostgreSQL                      |
| In-flight question on restart | unknown                                                            | In-memory timer lost; recorded results safe (documented in `engine.ts`) |
| Resume a running game         | `attach` by PIN                                                    | `host:join` by game id                                                  |

ZeroPeek's write-through model is **stronger** than the reference for durable
reports; the trade-off is that the in-memory timer is not persisted, which the
engine documents explicitly.

## 8. Module map (ZeroPeek)

| Concern                                | File                                           |
| -------------------------------------- | ---------------------------------------------- |
| Phase machine, timer, scoring, answers | `packages/backend/src/services/engine.ts`      |
| Game rows, PIN, join, reconnect        | `packages/backend/src/services/gameService.ts` |
| Namespaces, auth, rooms, event fan-out | `packages/backend/src/socket.ts`               |
| Scoring + ranking (pure)               | `packages/shared/src/scoring.ts`               |
| Event contracts                        | `packages/shared/src/events.ts`                |
| Question model + solution-free display | `packages/shared/src/questions.ts`             |
| Validation                             | `packages/shared/src/validation.ts`            |
| Player surface                         | `packages/frontend/src/pages/player.ts`        |
| Host surface                           | `packages/frontend/src/pages/host.ts`          |
| Answer/reveal rendering                | `packages/frontend/src/questionView.ts`        |
| Persistence                            | `packages/backend/prisma/schema.prisma`        |
