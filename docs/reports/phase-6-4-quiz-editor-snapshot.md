# Phase 6.4 – Quiz management/editor + immutable game snapshot (report)

- **Branch:** `feat/phase-6-4-quiz-editor-snapshots`
- **Base:** `main` after PR #25 (`0b281e1`)
- **Scope:** (a) the editor metadata and usability work from roadmap §5, and (b) the
  binding **`GameSnapshot`** that decouples game history from the live quiz (risk **R-3**)
- **Status:** implemented, awaiting review

This phase adds fields and a new table. No question, answer, account, role, permission,
authentication or running game behaviour was removed or rewritten.

## 1. Why the snapshot is in this phase

Roadmap §5 makes the snapshot a **precondition** of the editor work, not a nice-to-have:
autosave, drag-and-drop reordering and metadata edits all change a quiz in place, and
before Phase 6.4 a started game read its questions straight from that quiz — so an edit
rewrote the questions of a round that had already been played. **R-3 (history loss)** was
open. The snapshot closes it, and only then is the editor free to change a quiz.

## 2. The snapshot in one screen

```
create game ──► lobby ──► start ──┬─► snapshot frozen (one row, one transaction)
                                  │
quiz edit / delete ───────────────┘   has no effect on the started game

started game ──► engine.get / report / export / statistics ──► read the snapshot
```

- One JSONB envelope per game (`game_snapshots`, unique `game_id`) holding the quiz title,
  metadata and the full question list — options, correct solutions, types, order.
- Written **before** the game leaves the lobby, in the same transaction as `startedAt`, so
  a game is never running without a valid snapshot. If it cannot be written, the game
  stays in the lobby.
- Idempotent: a repeated start (host double-click) returns the existing snapshot. The
  unique index is the backstop against a race.
- `game_snapshots.quiz_id` is `ON DELETE SET NULL`; `games.quiz_id` is now nullable with
  `ON DELETE SET NULL`; `player_answers.question_id` no longer has a foreign key. Deleting
  a quiz can therefore no longer cascade a game or its answers away.
- A legacy game (started before 6.4, no snapshot) self-heals: the first report read freezes
  the live quiz, so old rounds become immutable too rather than being lost.

## 3. What was delivered

| Area            | Deliverable                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared domain   | `Quiz.category?`/`difficulty?`, `Question.category?`/`difficulty?`, `LABEL_MAX`, `SNAPSHOT_VERSION`, snapshot envelope + parse/guard + `snapshotToQuiz`                                                                         |
| Validation      | `validateLabel()`; quiz- and question-level label checks                                                                                                                                                                        |
| Database        | Migration `20261108090000_phase_6_4_quiz_editor_game_snapshot`; `GameSnapshot`; `Quiz`/`Question` label columns; two FK changes                                                                                                 |
| Backend         | `services/snapshotService.ts`; engine freezes on `start` and reads via the snapshot; `quizService` persists labels; `reportService` reports from the snapshot                                                                   |
| Frontend editor | Quiz management screen (search, sort, metadata chips, relative time); editor with metadata autosave, drag-and-drop **and** ↑/↓ buttons, per-question labels, local pre-validation with per-card issue markers, question preview |
| Host            | `?quiz=<id>` deep link honoured by the editor's Start action                                                                                                                                                                    |
| Documentation   | This report; `docs/phases.md`; roadmap R-3 marked resolved                                                                                                                                                                      |

## 4. Bestandsschutz evidence

- **Additive migration only.** The `prisma migrate diff` output was reordered and
  hand-documented; no column or row is dropped. The only behaviour changes are the two
  foreign-key actions above, both of which **preserve** data (they widen what survives a
  quiz delete rather than narrowing it).
- Verified on a populated database: seeded legacy users, quizzes, questions, games and
  answers, applied the migration, and confirmed every count was preserved and that a
  history row survived a quiz delete.
- Existing questions and answers are untouched: the label columns are nullable and absent
  means "not set"; `mappers.ts` keeps `null` out of the domain type.
- Import/export round-trips unchanged (labels ride along as optional fields).
- The engine integration suite and the realtime end-to-end suite pass unchanged, so the
  phase machine, scoring, ranking and reconnect behaviour still work as before.

## 5. Verification

| Check                     | Result                                                  |
| ------------------------- | ------------------------------------------------------- |
| `npm run typecheck`       | pass (shared + backend + frontend)                      |
| `npm run lint`            | pass                                                    |
| `npm run format:check`    | pass                                                    |
| `npm test` (DB reachable) | pass — backend **143**, frontend **276**, shared **89** |
| `npm run build`           | pass                                                    |

New tests:

- `packages/backend/src/snapshot.integration.test.ts` (6) — freeze on start; idempotent
  start; a running game keeps its questions after an edit; a report shows the questions as
  asked after an edit; the game, its answers, its report, its list row and its CSV export
  all survive deleting the quiz; statistics count against the snapshot.
- `packages/shared/src/validation.test.ts` — label validation, snapshot round-trip, deep
  copy, frozen title, corrupt-input guard, legacy payload tolerance.
- `packages/frontend/src/questionForm.test.ts` — labels are edited, merged and pre-filled.

## 6. Risks and open points

- **R-3** is technically closed by the snapshot. It stays listed as "resolved" rather than
  deleted, so the traceability remains.
- **`category` / `difficulty` are free text.** No fixed taxonomy was approved, so the fields
  accept any short string and suggest nothing. Turning them into a controlled vocabulary
  (selects, filter facets) is a later, owner-approved decision.
- **Snapshot size.** A snapshot duplicates the question list once per game. That is
  deliberate — it is what makes history immutable — and is bounded by the quiz size.
- **Drag-and-drop** is an addition, not a replacement: the ↑/↓ buttons remain the keyboard
  path, so reordering stays reachable without a pointer.

## 7. `player_answers.question_id`: why no foreign key (owner review, 2026-11-04)

The owner asked whether `question_id` could be made nullable and keep a foreign key with
`ON DELETE SET NULL`, so the database still rejects dangling ids. I tested all three designs
on a real PostgreSQL database before answering. The answer is **no, not without losing
history**, and the evidence is below.

### What was tested

| Variant | Schema                            | Quiz deleted → `question_id`    | Report / statistics / CSV                          |
| ------- | --------------------------------- | ------------------------------- | -------------------------------------------------- |
| **A**   | no FK (implemented)               | keeps the historical id (`qq1`) | correct: `answered = [1, 0]`, CSV has the question |
| **B**   | nullable + `ON DELETE SET NULL`   | set to `NULL`                   | **throws** on read                                 |
| **C**   | `NOT NULL` + `ON DELETE SET NULL` | delete itself **fails**         | n/a                                                |

Variant **B** was applied to a populated database and the quiz deleted. The id became `NULL`,
and `gameReport()` then failed with:

```
Error converting field "questionId" of expected non-nullable type "String", found incompatible value of "null".
```

Variant **C** shows the other half of the bind: PostgreSQL cannot set a `NOT NULL` column to
`NULL`, so the quiz delete itself fails with
`null value in column "question_id" ... violates not-null constraint`.

### Why this is inherent, not a Prisma detail

`question_id` is the **only** link from an answer to the question it answered. `reportService`
attributes each answer by matching `answer.questionId` against the snapshot's question ids
(`row.questionId === question.id`). That comparison is what makes "how many answered / how many
were correct / what was the mean" possible after the fact. A `NULL` id is exactly the "no valid
reference" the owner wanted to avoid, and it silently breaks the report instead.

The second reason is worse. `updateQuiz` deletes every question row and recreates it on **any**
editor save. Under `ON DELETE SET NULL`, a trainer merely renaming a quiz would set
`question_id = NULL` on the answers of games already played — history lost without a quiz ever
being deleted. Verified: after an ordinary editor save with questions, `question_id` was `NULL`.

### Why the current design is still safe

- The value is not dangling in practice: for a started game it equals the id of a question in
  that game's `GameSnapshot`, which is the immutable record of what was asked.
- The referential guarantee is the snapshot, not the live `questions` table. A foreign key to
  the live table cannot protect a value that must outlive that table.
- A database-level regression guard now asserts both constraints
  (`snapshot.integration.test.ts` → "holds the database guarantees that protect history"): no
  `player_answers_question_id_fkey`, and `games_quiz_id_fkey` is `SET NULL`. A future migration
  that reintroduces the cascade fails the suite.

### Alternative, if a hard database guarantee is wanted anyway

Add a `game_snapshots.questions` helper table (or a `game_snapshot_questions` table) holding the
frozen question ids per game, and point `player_answers.question_id` at **that** table with
`ON DELETE CASCADE` — i.e. reference the immutable copy, not the live quiz. Then a dangling id is
impossible, deleting a quiz is harmless, and the report keeps its attribution. The cost is one
extra table, a write on game start, and a migration of existing answers. This is a reasonable
follow-up, but it is a schema decision beyond the Phase 6.4 scope, so I did **not** implement it.

### Residual limitation: a legacy game whose quiz was deleted before it was ever read

Verified on a real pre-6.4 database that was migrated to 6.4 and then had its quiz deleted: the
game, its players and its answers all survived, and the game's `quiz_id` became `NULL` — but a
report on that game now throws `409 This game has no snapshot and its quiz no longer exists.`

That is not a regression and not avoidable: the game was started **before** 6.4, so no snapshot
was ever written, and once the quiz is deleted the questions exist nowhere. The service reports
the situation explicitly instead of inventing questions or returning a silently empty report.
The window is narrow and self-closing: any game started **under 6.4 or later** gets its snapshot
in the same transaction as the start, and any legacy game that is read once (a report, a
statistics call, a resume) is frozen on the spot and is safe from then on.

If this edge matters, the mitigation is a one-off backfill: before deleting a quiz, freeze a
snapshot for every game that references it and has none. I have not added it — it is a product
decision, and the window closes as soon as no pre-6.4 games remain.
