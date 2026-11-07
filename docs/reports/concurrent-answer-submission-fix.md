# Concurrent answer submission – fix report

- **Branch:** `fix/concurrent-answer-submission`
- **Base:** `main` after PR #27 (`202b143c3ea80a580faeab649f922e722e10af93`)
- **Scope:** server-side integrity of answer submission in the game engine
- **Status:** implemented, awaiting review

This is a targeted bugfix. It changes no schema, no dependency, no API contract, no
frontend, no admin, no quiz-editor and no snapshot behaviour.

## 1. Cause of the defect

`GameEngine.submitAnswer` (`packages/backend/src/services/engine.ts`) was a
check-then-act sequence with two `await` points and no mutual exclusion:

```
submitAnswer
  ├─ await this.get(gameId)                  ← suspension point 1
  ├─ if (player.answeredQuestionId === qid) throw conflict   ← the only duplicate guard
  ├─ player.answeredQuestionId = qid         ← runtime mutated BEFORE the write
  ├─ player.score += points
  ├─ player.totalTimeMs += elapsedMs
  ├─ player.correctCount += 1
  ├─ game.distribution.set(...)
  ├─ await prisma.playerAnswer.create(...)   ← suspension point 2
  └─ await prisma.gamePlayer.update(...)
```

Two answers for the same player and question that overlap in time both pass the
guard, because neither has set `answeredQuestionId` when the other checks it. Both
then add points, time and a correct-count, and both inflate the distribution.

The database has `@@unique([playerId, questionId])` on `PlayerAnswer`, so exactly one
insert wins and the second raises Prisma `P2002`. That did **not** save the runtime:

- the losing call had already changed the in-memory score, time, correct count and
  distribution, so the runtime drifted above the database;
- the `P2002` is not an `AppError`, so the socket `guard` turned it into a generic
  `Unexpected error.` (500) instead of the established `409 "You have already
answered."`.

### A second, more reachable race

`get(gameId)` builds the runtime object when the game is not in memory:

```
get ── cache miss ──► await prisma.game.findUnique ──► build runtime ──► games.set
```

Several sockets asking for the same not-yet-loaded game (the normal situation right
after a restart, or the first burst of answers to question 1) each ran that path
concurrently. Each built its **own** `RuntimeGame`; the last `games.set` won and the
others kept mutating an orphaned copy. An answer written through an orphan is
invisible to every other caller and to the socket broadcasts, so scores and the
"answered" tally diverge.

### What is _not_ a race here

For a game that is already in memory, Node's run-to-completion makes the
`if (answeredQuestionId === qid)` check and the runtime mutation a single synchronous
block. A duplicate therefore only collides across a real suspension point — i.e. the
cold-load path above, or a second process. The fix below closes both, and the tests
are written against the reachable path so they fail on the unfixed code.

## 2. The fix

Two changes, both in `packages/backend/src/services/engine.ts`.

### 2.1 Commit first, then mirror into the runtime

The two writes now run in one `prisma.$transaction`, and the runtime is advanced only
after that transaction resolves. A failed or duplicate write therefore cannot leave a
half-updated runtime.

```diff
-    player.answeredQuestionId = questionId;
-    player.score += points;
-    player.totalTimeMs += elapsedMs;
-    if (result.outcome === 'correct') player.correctCount += 1;
-    game.distribution.set(key, (game.distribution.get(key) ?? 0) + 1);
-    await prisma.playerAnswer.create({ ... });
-    await prisma.gamePlayer.update({ ... });
+    const score = player.score + points;
+    const totalTimeMs = player.totalTimeMs + elapsedMs;
+    const correctCount = player.correctCount + (result.outcome === 'correct' ? 1 : 0);
+    try {
+      await prisma.$transaction([
+        prisma.playerAnswer.create({ ... }),
+        prisma.gamePlayer.update({ data: { score, correctCount, totalTimeMs } }),
+      ]);
+    } catch (error) {
+      if (isUniqueViolation(error)) throw conflict('You have already answered.');
+      throw error;
+    }
+    player.answeredQuestionId = questionId;
+    player.score = score;
+    player.totalTimeMs = totalTimeMs;
+    player.correctCount = correctCount;
+    game.distribution.set(key, (game.distribution.get(key) ?? 0) + 1);
```

The `P2002` mapping keeps the duplicate-answer semantics and the `409` contract
unchanged for a duplicate that reaches the database (a second process, or a retry
after a lost acknowledgement).

### 2.2 Serialise per player and question, and share the game load

```diff
+  private readonly loading = new Map<string, Promise<RuntimeGame>>();
+  private readonly answerLocks = new Map<string, Promise<void>>();
+
+  private withAnswerLock<T>(key: string, task: () => Promise<T>): Promise<T> { ... }
+
   async submitAnswer(gameId, playerId, questionId, answer) {
     const game = await this.get(gameId);
+    return this.withAnswerLock(`${playerId}:${questionId}`, () =>
+      this.acceptAnswer(game, playerId, questionId, answer),
+    );
+  }
```

- The key is `playerId:questionId`, so **different players and different questions keep
  running in parallel**; only two submissions for the same player and question queue.
- The lock body re-validates the phase, the open question and `answeredQuestionId`, so
  the second queued call sees the first's committed result and is rejected as a
  duplicate.
- A key is deleted once its last task settles, so the map cannot grow.
- `get` now shares one in-flight load per game, so concurrent cold requests all get the
  same `RuntimeGame` instead of orphaning copies.

### Why not the alternatives

- **Unique constraint alone** — explicitly insufficient: the runtime was mutated before
  the insert, and the failure surfaced as a 500. It is now the cross-process backstop
  instead.
- **`INSERT … ON CONFLICT DO NOTHING` + row count** — would work in SQL but bypasses the
  typed Prisma model; the transaction plus `P2002` mapping is the idiomatic fit here and
  preserves the existing error contract.
- **One global lock / in-flight set** — would block unrelated players and questions,
  which the requirements forbid.

## 3. Automatic reveal

`reveal` is already idempotent (it returns early in `reveal`, `board` and `end`), and
the "everyone answered" branch is only reached through a committed answer. With the
last players answering together, the count reaches `players.size` once and the reveal
fires once. No change was needed beyond the lock making that decision race-free.

## 4. Tests

Added to `packages/backend/src/engine.integration.test.ts` (real engine, real
PostgreSQL; only `fetch`/`$transaction` are ever stubbed, and only for the failure
case). Six new tests, 9 → 15 in the file.

| Test | Scenario                                                    | Assertion                                                                                                                                                      |
| ---- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | 5 identical answers in one burst, on an evicted (cold) game | exactly 1 accepted, 4 rejected with `409`; 1 `PlayerAnswer` row; score, time and `correctCount` advanced once; distribution `[1]`; runtime equals the database |
| B    | two different answers from one player at once               | exactly 1 accepted; 1 row; score and `correctCount` agree with the stored verdict                                                                              |
| C    | two different players answer at once                        | both accepted; 2 rows; no global blocking                                                                                                                      |
| D    | `prisma.$transaction` fails once                            | submission rejects; **no** row, score 0, `answeredQuestionId` still null; a later retry succeeds                                                               |
| E    | all three players answer the last question at once          | `reveal` emitted exactly once; phase `reveal`; all 3 answers stored                                                                                            |
| F    | a cold game loaded concurrently                             | both `get` calls return the **same** runtime object, and an answer through it is visible everywhere                                                            |

### These are genuine regression tests

Against the unmodified engine, tests A, D and F fail (3 failed | 12 passed):

```
× accepts exactly one of several simultaneous answers to the same question
× leaves no trace when the write fails, and a later retry still works
× shares one runtime when a cold game is loaded concurrently
```

Tests B, C and E pass on the old code too, because for a warm game Node's
run-to-completion already made that specific check atomic; they are kept as guards
that the new locking does not change the observable behaviour for the cases the
requirements name.

> Note on Test D: the Prisma client is a `Proxy`, so `vi.spyOn(prisma, '$transaction')`
> leaves the property cleared after `mockRestore()`. The test reassigns the original
> method in its `finally` block; the comment in the test records why.

## 5. Verification

| Check          | Command                          | Result                                |
| -------------- | -------------------------------- | ------------------------------------- |
| Backend tests  | `npm test -w @zeropeek/backend`  | 154 passed (was 148; +6)              |
| Frontend tests | `npm test -w @zeropeek/frontend` | 285 passed (unchanged)                |
| Shared tests   | `npm test -w @zeropeek/shared`   | 89 passed (unchanged)                 |
| Typecheck      | `npm run typecheck`              | clean                                 |
| Lint           | `npm run lint`                   | clean                                 |
| Build          | `npm run build`                  | clean                                 |
| Format         | `npm run format:check`           | clean                                 |
| Migrations     | `prisma migrate status`          | up to date (no migration in this fix) |

## 6. Files changed

| File                                               | Change                                                                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `packages/backend/src/services/engine.ts`          | shared game load; per-(player, question) answer lock; transactional commit before the runtime mirror; `P2002` → `409` mapping |
| `packages/backend/src/engine.integration.test.ts`  | 6 new tests (A–F)                                                                                                             |
| `docs/reports/concurrent-answer-submission-fix.md` | this report                                                                                                                   |
| `docs/phases.md`                                   | 6.5.1 status corrected to merged (PR #27)                                                                                     |

## 7. Remaining limitations

- The engine is one process with in-memory state, so the lock is process-local. The
  unique index and the commit-before-runtime order are the guarantees that also hold
  across processes; the deployment runs a single backend replica, so this is not a
  current exposure.
- The fix does not change the "too fast" policy or any scoring value; only when the
  runtime is updated and how duplicates are reported.
- No load test was added; the concurrency is asserted at the engine level with real
  parallel promises against a real database, which is the layer the defect lived in.

## 8. Open questions for the project owner

1. Should a duplicate answer return the existing outcome (idempotent success) instead
   of a `409`? The current behaviour is kept deliberately, as the task asked to
   preserve the duplicate-answer semantics.
2. If a second backend replica is ever planned, the reveal and phase transitions would
   need a shared store (e.g. a Redis lock or DB-level state check) — out of scope here.
