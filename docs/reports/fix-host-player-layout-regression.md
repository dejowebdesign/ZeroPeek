# Fix: host/player layout regression (PR #19 follow-up)

**Branch:** `fix/host-player-layout-regression`
**Base:** `main` after PR #19 (`fd1f8cc`)
**Scope:** presentation centring (F1), player answer grid (F2), four-option ceiling (F3)
**Method:** text-only — source reads, `getBoundingClientRect` via headless Chromium, no screenshots

## 1. What broke and why

PR #19 added `max-width: var(--show-measure)` to `.show` and `justify-items: stretch`
to `.centered.show`. The section is a grid item of `<main>`; `justify-items` aligns the
section's *children*, not the section itself. With a `max-width` and no centring of the
section, the presentation surface collapsed to its content width and stayed anchored to
the left edge of `<main>`.

| Viewport | Board left (before) | Board right (before) | L/R margin |
| -------- | ------------------- | -------------------- | ---------- |
| 1920×1080 | 16 | 1216 | 16 / 704 |
| 1366×768 | 16 | 1216 | 16 / 150 |

The player answer buttons were never in a grid: `.question__input` had no CSS rule at
all, so the `.option` buttons stacked full-width, one per row.

## 2. F1 — centre the presentation surface

```css
.centered.show {
  justify-items: center; /* centres the children */
  margin-inline: auto; /* centres the section itself */
  padding: clamp(var(--space-2), 1.4vw, var(--space-4));
}
```

Both properties are required: `justify-items: center` alone leaves the section
left-anchored, `margin-inline: auto` alone leaves the children stretched. The
presentation width (`--show-measure`) and the board size are unchanged.

Measured board centre vs. viewport centre, after the fix:

| Viewport | Board centre | Viewport centre | Result |
| -------- | ------------ | --------------- | ------ |
| 390×844 | 196 | 195 | centred |
| 768×1024 | 384 | 384 | centred |
| 1024×768 | 512 | 512 | centred |
| 1280×720 | 640 | 640 | centred |
| 1366×768 | 683 | 683 | centred |
| 1920×1080 | 960 | 960 | centred |

## 3. F2 — player answer grid

```css
.question__input:has(> .option) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}
.question__input:has(> .option) > .option {
  margin-bottom: 0;
}
.question__input:has(> .option) > .btn {
  grid-column: 1 / -1;
}
@media (max-width: 640px) {
  .question__input:has(> .option) {
    grid-template-columns: 1fr;
  }
}
```

`:has()` scopes the grid to the option-based types (`single`, `poll`, `trueFalse`,
`multiple`). Text, slider, order, scale, word-cloud, open and idea inputs keep their
existing block layout, because their `.question__input` holds no direct `.option` child.
The `> .btn` rule lets a multiple-choice Submit span both columns. Where `:has()` is
unsupported the rule does not match and the buttons keep the previous stacked layout, so
nothing regresses.

Measured:

| Viewport | Grid | Overflow X | Overflow Y |
| -------- | ---- | ---------- | ---------- |
| 390×844 | 1×4 | no | no |
| 768×1024 | 2×2 | no | no |
| 1024×768 | 2×2 | no | no |
| 1280×720 | 2×2 | no | no |
| 1366×768 | 2×2 | no | no |
| 1920×1080 | 2×2 | no | no |

## 4. F3 — a question has at most four answers

`MAX_ANSWER_OPTIONS` in `packages/shared/src/constants.ts` changed from 6 to 4. The shared
validator `validateOptions` already reads this constant and runs on every write
(`quizService.assertValid` → `validateQuiz`), so the ceiling is enforced server-side for
create, update, duplicate and import without touching the routes. The editor's
`stringList` reads the same constant, so its "+ Add" button stops at four too.

**Existing data is never rewritten.** No migration, no deletion, no silent change to
stored questions. The audit query is read-only:

```sql
SELECT q.id, q.type, jsonb_array_length(q.payload->'options') AS option_count
FROM questions q
WHERE q.payload ? 'options'
  AND jsonb_typeof(q.payload->'options') = 'array'
  AND jsonb_array_length(q.payload->'options') > 4
ORDER BY option_count DESC;
```

Run against the test database, it returned **0 rows** — no stored question has more than
four options. Historical quiz data is therefore unaffected. If a legacy question with more
than four options is ever found, it is left in place: the engine snapshots a quiz into a
game when the game starts, so the game still plays, and the owner only sees the four-option
rule when that question is next saved.

## 5. Tests

- `packages/frontend/src/design-system.test.ts` — two guards: `.centered.show` carries
  `justify-items: center` **and** `margin-inline: auto`; `.question__input:has(> .option)`
  is a two-column grid with the 640 px single-column fallback.
- `packages/shared/src/validation.test.ts` — four options accepted, five rejected for
  `single`/`multiple`/`poll`, an imported quiz with five options rejected, and the message
  names the ceiling.
- `packages/backend/src/api.integration.test.ts` — the API rejects five options on create,
  update and import, and accepts exactly four.

## 6. Unchanged

No change to host authentication, Socket.IO permissions, scoring, ranking, the timer, XP,
characters or inventory. The host still cannot answer and the player still cannot control
the round. Deliberately out of scope: long-answer optimisation (F4), a host link on the
player surface (F5), moving the host controls out of the presentation card (F6), the clock
position, new navigation and a separate beamer route.
