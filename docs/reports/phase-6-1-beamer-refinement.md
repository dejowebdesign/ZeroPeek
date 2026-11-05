# Phase 6.1 – Beamer / show surface refinement (report)

- **Branch:** `feat/phase-6-1-beamer-refinement`
- **Base:** `main` at `0dc5f02` (PR #18 merge — the Phase 6.1 design system)
- **Scope:** fine-tune the presentation surface (`.show`: question, answer board, countdown,
  reveal, leaderboard, podium) so it scales cleanly to a projector at several resolutions
  without overflow or clipping
- **Status:** implemented, awaiting review

This is a **presentation-only** change. No game logic, API, database schema, question, answer,
account, role or permission was touched.

## 1. What changed

| Area         | Change                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type scale   | `--type-show-*` now mix `vw + vh` instead of `vw` alone, so a short projector shrinks the board rather than scrolling it                                    |
| Spacing      | `--show-gap`, `--show-pad` follow the same `vw + vh` rule; new `--show-measure` caps the surface                                                            |
| Countdown    | Ring rebuilt in CSS: a conic-gradient progress arc, a faint tick ring, and the number on a glass disc. No image, no per-frame layout work                   |
| Answer board | `.show__options` is a fixed **2-column grid** (stacks below 640px). The previous `auto-fit` produced a lopsided 3+1 layout for four answers                 |
| Podium       | Real three-step podium (gold/silver/bronze) plus the remaining ranking below, instead of a flat list                                                        |
| Bug fix      | `answerCountNode` was declared and read but **never assigned**, so the live “n / m answers” count on the beamer never updated (see §4)                      |
| New module   | `src/showView.ts` — pure builders `questionDisplayOptions`, `leaderboardRow`, `podiumPlace`, extracted so they are unit-testable without booting the socket |
| New tokens   | `--podium-bronze: #c98b5e` (gold reuses `--rarity-legendary`, silver reuses `--brand-silver`)                                                               |

Files: `packages/frontend/src/styles/tokens.css`, `pages/host.ts`, new `src/showView.ts`,
`src/showView.test.ts`, `design-system.test.ts`.

## 2. Test numbers (definitive)

The earlier summary was ambiguous, so this is the corrected, reproducible result. Two separate
runs are reported, because the backend integration suites **only execute when a real PostgreSQL is
reachable** and are otherwise silently skipped.

Run with a real PostgreSQL 16 container (`zeropeek_test`, migrations applied via `prisma migrate
deploy`), `DATABASE_URL` and `TEST_DATABASE_URL` both set:

| Workspace            | Test files | Passed  | Skipped | Total   |
| -------------------- | ---------- | ------- | ------- | ------- |
| `@zeropeek/shared`   | 3          | 62      | 0       | 62      |
| `@zeropeek/frontend` | 6          | 152     | 0       | 152     |
| `@zeropeek/backend`  | 7          | 94      | 0       | 94      |
| **Total**            | **16**     | **308** | **0**   | **308** |

Without a database the backend reports `94` as `60 passed | 34 skipped`; the repo-wide total is then
`308` of which `274` actually ran. **All figures in this report are from the fully-provisioned run
(0 skipped).**

### Frontend delta — this resolves the “152 → 158” contradiction

The contradiction was between two different baselines. Measured directly by stashing the working
tree (`git stash -u`) and re-running:

| Frontend test file       | On `main` (baseline) | With this change | Delta   |
| ------------------------ | -------------------- | ---------------- | ------- |
| `design-system.test.ts`  | 86                   | 105              | **+19** |
| `showView.test.ts` (new) | 0                    | 6                | **+6**  |
| `ui.test.ts`             | 22                   | 22               | 0       |
| `questionView.test.ts`   | 12                   | 12               | 0       |
| `questionForm.test.ts`   | 2                    | 2                | 0       |
| `dom.test.ts`            | 5                    | 5                | 0       |
| **Frontend total**       | **127**              | **152**          | **+25** |

The frontend baseline on `main` is **127**, not 152. 152 is already the _post-change_ figure; the
“increase to 158” was an arithmetic slip in the earlier summary and is withdrawn. The correct
statement is: **frontend 127 → 152 (+25)**.

## 3. How the surface was measured (text only)

No images are produced or stored for this phase. Every result below is a number read back from the
rendered DOM, not a picture.

Method: the **real frontend modules** are bundled with esbuild (`--alias:@zp-frontend=./packages/frontend/src`)
into a scratch page under the built `dist/`, loaded in headless Chromium, and the geometry is read
from `getBoundingClientRect()` / `documentElement.scrollHeight` and written back as a `data-json`
attribute (read with `--dump-dom`). The scratch page is deleted afterwards. Reported quantities:

- `vp` — layout viewport in CSS pixels.
- `docH` — `documentElement.scrollHeight`.
- `ovH` / `ovV` — horizontal / vertical overflow flag (`scrollWidth > innerWidth`, `scrollHeight > innerHeight`).
- `boardH` — height of the `.show__board` card.
- `optFont` / `cdFont` — computed `font-size` of a `.show__option` and of `.countdown__value`.

The six required resolutions are 390×844, 768×1024, 1024×768, 1280×720, 1366×768 and 1920×1080.
The full result table is in §5.

## 4. Bestandsschutz evidence

### 4.0 Point 3 — game logic, checked line by line

Full diff of the branch against `main`, text-only. Changed files:

```
A  .openhands/memory/2026-11-05.md
M  .openhands/memory/MEMORY.md
A  docs/reports/phase-6-1-beamer-refinement.md
M  packages/frontend/src/design-system.test.ts
M  packages/frontend/src/pages/host.ts
A  packages/frontend/src/showView.test.ts
A  packages/frontend/src/showView.ts
M  packages/frontend/src/styles/tokens.css
```

`git diff --name-only origin/main -- packages/backend packages/shared` is **empty**, and
`git diff --stat origin/main -- packages/frontend/src/socket.ts packages/frontend/src/api.ts
packages/backend/src` is **empty** — the whole backend, `shared`, `socket.ts` and `api.ts` are
untouched.

| Claim                                          | Result | Evidence                                                                                                                                                                                                   |
| ---------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No change to the Socket.IO processing          | ✔      | `socket.ts` untouched; the `socket.on('host:answers', …)` handler does not appear in the diff at all                                                                                                       |
| No change to API endpoints                     | ✔      | `api.ts` untouched; no `request(` / `post(` / `get(` / `ApiError` line added or removed in `host.ts`                                                                                                       |
| No change to scoring or ranking                | ✔      | No `score` arithmetic added; `player.score` is only read into a string (`String(player.score)`)                                                                                                            |
| No change to timer / answer logic              | ✔      | All three `stopTimer()` calls and their positions are unchanged; `countdown()` calls unchanged                                                                                                             |
| No change to the game flow                     | ✔      | No `game:start` / `game:next` / `game:end` request touched; every `button(...)` call and its `onClick` body is unchanged — only the wrapping element's class changed (`lobby__actions` → `show__controls`) |
| `answerCountNode` fixes the display only       | ✔      | `answerCountNode` is only ever assigned, set to `null`, or written via `textContent` (see 4.1)                                                                                                             |
| The display seed does not influence game state | ✔      | `lobbyPlayerCount` is written once in the lobby `paint()` (`= list.length`) and read once to seed a label; it is never sent to the server                                                                  |

The added/removed lines matching `socket|emit|request(|gameId|answer(|score` are exactly three:
one explanatory comment and the two `String(player.score)` lines that moved into `showView.ts`.
The `answerCountNode` lines are `+ let lobbyPlayerCount = 0`, `+ lobbyPlayerCount = list.length`,
`+ answerCountNode = count`, `+ if (lobbyPlayerCount) count.textContent = …`, and three
`+ answerCountNode = null` (reveal / board / podium).

### 4.1 `answerCountNode` — display only

The only behavioural change in `pages/host.ts` is the answer-progress readout. Before, the node was
declared and read by the `host:answers` handler but never assigned, so the count never updated:

```ts
let answerCountNode: HTMLElement | null = null;
// ...
socket.on('host:answers', (payload) => {
  if (answerCountNode) {
    answerCountNode.textContent = `${payload.answered} / ${payload.total} answers`;
  }
});
```

Now `showQuestion` assigns it (and seeds the total from the lobby size), and every other screen
clears it. No socket event, `request(...)` call, API route, payload, score, timer, or state
transition was changed — verified by filtering the diff for logic/API/socket keywords, which
returns only the two removed `String(player.score)` display lines that moved into `showView.ts`:

```bash
git diff packages/frontend/src/pages/host.ts | grep -iE "socket|emit|request\(|gameId|answer\(|score"
```

The one new global, `lobbyPlayerCount`, is written in the lobby `paint()` and read only to seed
that label; it drives no logic.

### 4.2 Point 4 — design-system Bestandsschutz

**Frozen Phase 0 tokens, compared value by value between `main` and this branch** (extracted from
the first `:root` block of each revision):

| Token             | `main`                       | Branch                       | Status    |
| ----------------- | ---------------------------- | ---------------------------- | --------- |
| `--bg`            | `#08080f`                    | `#08080f`                    | identical |
| `--bg-2`          | `#0e0e1a`                    | `#0e0e1a`                    | identical |
| `--text`          | `#f5f5fb`                    | `#f5f5fb`                    | identical |
| `--muted`         | `#9c9cb5`                    | `#9c9cb5`                    | identical |
| `--accent`        | `#7c5cff`                    | `#7c5cff`                    | identical |
| `--accent-2`      | `#22d3ee`                    | `#22d3ee`                    | identical |
| `--surface`       | `rgba(255, 255, 255, 0.045)` | `rgba(255, 255, 255, 0.045)` | identical |
| `--surface-2`     | `rgba(255, 255, 255, 0.075)` | `rgba(255, 255, 255, 0.075)` | identical |
| `--border`        | `rgba(255, 255, 255, 0.09)`  | `rgba(255, 255, 255, 0.09)`  | identical |
| `--border-strong` | `rgba(255, 255, 255, 0.16)`  | `rgba(255, 255, 255, 0.16)`  | identical |

All ten are byte-identical, and the freeze test (`design-system – bestandsschutz`, **10 assertions**)
passes.

**Custom properties added / removed / changed across the whole file:**

- Added (8): `--podium-bronze` (`#c98b5e`), `--show-gap`, `--show-measure`, `--show-pad`,
  `--type-show-meta`, `--type-show-name`, `--type-show-rank`, `--type-show-score`.
- Removed (1): `--show-scale` (`clamp(1rem, 1.1vmin + 0.7rem, 1.5rem)`) — superseded by the
  per-element `vw + vh` scale; `grep` finds no remaining reference in the branch.
- Changed (3): `--type-countdown` (`clamp(2.5rem, 10vw, 6rem)` → `clamp(2.25rem, 7vmin, 4rem)`),
  `--type-show-answer`, `--type-show-question`. All three are presentation tokens for the beamer.

**Scope of the CSS rule changes.** Every added or removed rule head is one of:

- `.show*` (`.show__board`, `.show__options`, `.show__option`, `.show__option-label`,
  `.show__answers`, `.show__controls`, `.show__title`, `.show__winner`) and the `.show`-scoped
  descendants (`.show .question__meta`, `.show .question__result`, `.show .question__solution`,
  `.show .option__key`, `.show .bar__head`, `.show .bar__track`);
- `.podium*` (`.podium`, `.podium__place`, `.podium__place--1/2/3`, `.podium__rank`,
  `.podium__name`, `.podium__score`);
- `.leaderboard--show` and its descendants;
- `.centered.show`, the `.countdown::before` / `.countdown::after` ring, and one
  `@media (max-width: 640px)` block.

Three `.show`-scoped rules were **removed**, all superseded, not lost:

| Removed rule               | Was                                  | Now                                                              |
| -------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `.show .option`            | `font-size: var(--type-show-answer)` | `.show__option` carries that size plus the glass card treatment  |
| `.show .question__timer`   | `font-size: var(--type-countdown)`   | `.countdown__value` carries `var(--type-countdown)`              |
| `.countdown::before` (old) | flat `border` ring                   | replaced by the conic-gradient arc + the new `::after` tick ring |

The `.show` container is rendered **only by `pages/host.ts`** (`grep -n 'centered show'` finds four
sites, all in `host.ts`; `player.ts`, `editor.ts` and `admin.ts` contain none). `.show .option` was
therefore already dead — the reveal draws `.question__result` bars, not `.option` rows. `.show
.question__timer` was dead in the same way: `question__timer` appears nowhere in the frontend
source. So no live surface loses a rule.

**Base components are untouched.** No `.card`, `.btn`, `.option` (bare), `.leaderboard` (bare),
`.input` or `.chip` rule was added or removed — the player, editor and admin surfaces keep their
existing styling. `design-system.test.ts` gained a token/class contract test that fails if a
`--type-show-*` token is dropped or a beamer class loses its rule.

### 4.3 Point 5 — Git and build hygiene

- `dist/` is git-ignored (`.gitignore:5`), and `git ls-files packages/*/dist` is **empty** — no
  generated build output is tracked.
- The temporary verification pages (`_verify.*`, `_podium.*`) were written into
  `packages/frontend/dist/` during measurement and **deleted afterwards**; `dist/` now contains
  only the build output (`index/host/editor/admin.html`, `assets/`, `favicon.png`, `logo.png`).
- No temporary test files remain anywhere: `find packages -name '_*.js' -o -name '_*.html'`
  (excluding `node_modules`) returns nothing.
- The working tree is clean (`git status --short` empty) after the cleanup commit.
- The branch is based on `main` at `0dc5f02`: `git merge-base --is-ancestor 0dc5f02 HEAD` succeeds
  and `git log --oneline origin/main..HEAD` lists only this phase's commits.
- No image file is present anywhere in the branch (the 18 JPEGs from the earlier draft were
  removed and the empty `docs/reports/assets/` directory deleted).

## 5. Measurements (all six resolutions, no overflow)

Geometry read back from the rendered DOM. `vp` is the layout viewport (Chromium reserves the
window chrome, so `vp.h` is smaller than the window height), `docH` is `scrollHeight`. `ovH`/`ovV`
are the overflow flags.

### Question screen (prompt + answer board + countdown)

| Resolution | vp       | docH | ovH   | ovV   | boardH | optFont | cdFont  |
| ---------- | -------- | ---- | ----- | ----- | ------ | ------- | ------- |
| 390×844    | 500×757  | 757  | false | false | 588    | 16.80px | 36.00px |
| 768×1024   | 768×937  | 937  | false | false | 510    | 16.80px | 53.76px |
| 1024×768   | 1024×681 | 681  | false | false | 484    | 16.80px | 47.67px |
| 1280×720   | 1280×633 | 633  | false | false | 515    | 19.14px | 44.31px |
| 1366×768   | 1366×681 | 681  | false | false | 545    | 20.47px | 47.67px |
| 1920×1080  | 1920×993 | 993  | false | false | 757    | 29.06px | 64.00px |

### Answer board with long option text (worst case)

| Resolution | vp       | docH | ovH   | ovV   | boardH | optFont |
| ---------- | -------- | ---- | ----- | ----- | ------ | ------- |
| 390×844    | 500×757  | 757  | false | false | 492    | 16.80px |
| 768×1024   | 768×937  | 937  | false | false | 425    | 16.80px |
| 1024×768   | 1024×681 | 681  | false | false | 366    | 16.80px |
| 1280×720   | 1280×633 | 633  | false | false | 404    | 19.14px |
| 1366×768   | 1366×681 | 681  | false | false | 424    | 20.47px |
| 1920×1080  | 1920×993 | 993  | false | false | 644    | 29.06px |

### Countdown

| Resolution | vp       | docH | ovH   | ovV   | boardH | cdFont  |
| ---------- | -------- | ---- | ----- | ----- | ------ | ------- |
| 390×844    | 500×757  | 757  | false | false | 264    | 36.00px |
| 768×1024   | 768×937  | 937  | false | false | 295    | 53.76px |
| 1024×768   | 1024×681 | 681  | false | false | 285    | 47.67px |
| 1280×720   | 1280×633 | 633  | false | false | 297    | 44.31px |
| 1366×768   | 1366×681 | 681  | false | false | 316    | 47.67px |
| 1920×1080  | 1920×993 | 993  | false | false | 436    | 64.00px |

### Reveal / distribution

| Resolution | vp       | docH | ovH   | ovV   | boardH |
| ---------- | -------- | ---- | ----- | ----- | ------ |
| 390×844    | 500×757  | 757  | false | false | 377    |
| 768×1024   | 768×937  | 937  | false | false | 369    |
| 1024×768   | 1024×681 | 681  | false | false | 376    |
| 1280×720   | 1280×633 | 633  | false | false | 410    |
| 1366×768   | 1366×681 | 681  | false | false | 425    |
| 1920×1080  | 1920×993 | 993  | false | false | 530    |

### Leaderboard (8 players)

| Resolution | vp       | docH | ovH   | ovV   | boardH |
| ---------- | -------- | ---- | ----- | ----- | ------ |
| 390×844    | 500×757  | 757  | false | false | 489    |
| 768×1024   | 768×937  | 937  | false | false | 537    |
| 1024×768   | 1024×681 | 681  | false | false | 536    |
| 1280×720   | 1280×633 | 633  | false | false | 579    |
| 1366×768   | 1366×681 | 681  | false | false | 611    |
| 1920×1080  | 1920×993 | 993  | false | false | 809    |

### Podium

| Resolution | vp       | docH | ovH   | ovV   | boardH |
| ---------- | -------- | ---- | ----- | ----- | ------ |
| 390×844    | 500×757  | 757  | false | false | 677    |
| 768×1024   | 768×937  | 937  | false | false | 504    |
| 1024×768   | 1024×681 | 681  | false | false | 508    |
| 1280×720   | 1280×633 | 633  | false | false | 558    |
| 1366×768   | 1366×681 | 681  | false | false | 591    |
| 1920×1080  | 1920×993 | 993  | false | false | 800    |

**No horizontal or vertical overflow in any of the 36 combinations.**

### Podium structure (computed style, text)

`rank` = modifier class, `left` = `getBoundingClientRect().left`, `h` = height, `border-top` =
computed `border-top-color`.

| Resolution | rank 2 (silver)                    | rank 1 (gold)                      | rank 3 (bronze)                    |
| ---------- | ---------------------------------- | ---------------------------------- | ---------------------------------- |
| 1920×1080  | left 41, h 157, `rgb(226,232,240)` | left 430, h 184, `rgb(251,191,36)` | left 819, h 157, `rgb(201,139,94)` |
| 1024×768   | left 30, h 99, `rgb(226,232,240)`  | left 334, h 106, `rgb(251,191,36)` | left 639, h 99, `rgb(201,139,94)`  |
| 390×844    | left 21, h 98, `rgb(226,232,240)`  | left 21, h 98, `rgb(251,191,36)`   | left 21, h 98, `rgb(201,139,94)`   |

At 1920×1080 and 1024×768 the podium is three columns ordered silver-left / gold-centre-tallest /
bronze-right, gold always the tallest. At 390×844 the columns stack (`left` is the same for all
three) — expected for a phone-width viewport.

### Countdown implementation (text)

The ring is pure CSS; the only dynamic input is the `--progress` custom property.

```css
.countdown::before {
  background: conic-gradient(
    from -90deg,
    var(--accent-2) calc(var(--progress) * 360deg),
    rgba(34, 211, 238, 0.12) 0
  );
  mask: radial-gradient(closest-side, transparent 87%, #000 88%);
}
.countdown::after {
  background: repeating-conic-gradient(
    from 0deg,
    rgba(255, 255, 255, 0.16) 0deg 0.6deg,
    transparent 0.6deg 30deg
  );
}
```

`grep -c 'url('` over the `.countdown` block is **0** — no image is referenced. `design-system.test.ts`
asserts the block contains `conic-gradient` and `var(--progress)` and does **not** contain `url(`.

## 6. Verification

Run against a reachable PostgreSQL 16 test database (`zeropeek_test`, migrations applied with
`prisma migrate deploy`), `DATABASE_URL` and `TEST_DATABASE_URL` both set:

| Check                    | Result                                                             |
| ------------------------ | ------------------------------------------------------------------ |
| `npm run typecheck`      | pass                                                               |
| `npm test` (PostgreSQL)  | pass — 308 passed, 0 skipped (shared 62, frontend 152, backend 94) |
| `npm run format:check`   | pass                                                               |
| `npm run build`          | pass                                                               |
| DOM/CSS geometry probe   | no overflow in any of the 36 screen × resolution combinations (§5) |
| Countdown ring           | CSS-only, `url(` count 0 (§5)                                      |
| Phase 0 token freeze     | pass (10 assertions, values byte-identical to `main` — §4.2)       |
| Point 3 game-logic audit | all seven claims ✔ (§4.0)                                          |
| Point 5 git/build audit  | all six checks ✔ (§4.3)                                            |

## 7. Changed files

| File                                          | Change                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/frontend/src/styles/tokens.css`     | beamer type/spacing tokens, 2-column answer board, podium, countdown ring                  |
| `packages/frontend/src/pages/host.ts`         | beamer markup, `answerCountNode` fix, `show__*` classes                                    |
| `packages/frontend/src/showView.ts`           | **new** — pure beamer builders (`questionDisplayOptions`, `leaderboardRow`, `podiumPlace`) |
| `packages/frontend/src/showView.test.ts`      | **new** — 6 tests for the builders                                                         |
| `packages/frontend/src/design-system.test.ts` | +19 token/class contract tests                                                             |
| `docs/reports/phase-6-1-beamer-refinement.md` | **new** — this report                                                                      |
| `.openhands/memory/MEMORY.md`                 | memory: show/beamer sizing rule + verification method                                      |
| `.openhands/memory/2026-11-05.md`             | **new** — daily log                                                                        |

No file under `packages/backend`, `packages/shared`, `docs/design`, `docs/deployment` or the
repository root was changed.

## 8. Known limitations

1. **Answer board is a fixed 2-column grid** for every option count. Four options give a clean
   2×2; a question with 5–6 options will fill 2+2+1 / 2+2+2 rather than switching to a single
   column. This is a deliberate choice, flagged as an open question below.
2. **The podium stacks on phone-width viewports** (390×844) instead of showing three side-by-side
   steps. This is intended — the podium is a beamer surface — but it means the phone layout of the
   host page shows a list-like podium.
3. **No avatars on the podium or leaderboard yet.** The blocks are nickname + score only; the
   character layer arrives with Phase 6.7.
4. **The countdown size is tuned for 1280×720 and up.** On a very small viewport the ring uses
   `vmin`, so it stays legible but does not grow with the card.
5. **No visual regression baseline is stored** — this phase is verified by numeric geometry
   (the 36-combination probe), not by image diffing.
6. **`--show-scale` was removed**; any external stylesheet that referenced it would lose that
   value. Grep confirms nothing in the repository does.

## 9. Open questions for the owner

1. Is the 2-column answer board the right call for 5–6 option questions, or should it fall back to
   a single column above four options?
2. Should the countdown ring be larger on the beamer, or is the current size right for a projector?
3. Should the podium show avatars once the character system exists (Phase 6.7)?

None of these block the phase.
