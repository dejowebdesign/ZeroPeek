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

## 3. Screenshots

Rendered from the **actual bundled modules** (esbuild bundle of `src/`, linked against the built
`dist/assets/ui-*.css`), headless Chromium, `--hide-scrollbars`. Full set in
[`assets/phase-6-1-beamer/`](assets/phase-6-1-beamer/).

### Question screen (prompt + answer board + countdown)

![Question at 1920×1080](assets/phase-6-1-beamer/question-1920x1080.jpg)
![Question at 1280×720](assets/phase-6-1-beamer/question-1280x720.jpg)
![Question at 1024×768](assets/phase-6-1-beamer/question-1024x768.jpg)

### Answer board with long option text (worst case)

![Answers at 1920×1080](assets/phase-6-1-beamer/answers-1920x1080.jpg)
![Answers at 1280×720](assets/phase-6-1-beamer/answers-1280x720.jpg)
![Answers at 1024×768](assets/phase-6-1-beamer/answers-1024x768.jpg)

### Countdown (arc at ~40 % remaining)

![Countdown at 1920×1080](assets/phase-6-1-beamer/countdown-1920x1080.jpg)
![Countdown at 1280×720](assets/phase-6-1-beamer/countdown-1280x720.jpg)
![Countdown at 1024×768](assets/phase-6-1-beamer/countdown-1024x768.jpg)

### Reveal / distribution

![Reveal at 1920×1080](assets/phase-6-1-beamer/reveal-1920x1080.jpg)
![Reveal at 1280×720](assets/phase-6-1-beamer/reveal-1280x720.jpg)
![Reveal at 1024×768](assets/phase-6-1-beamer/reveal-1024x768.jpg)

### Leaderboard (8 players)

![Leaderboard at 1920×1080](assets/phase-6-1-beamer/board-1920x1080.jpg)
![Leaderboard at 1280×720](assets/phase-6-1-beamer/board-1280x720.jpg)
![Leaderboard at 1024×768](assets/phase-6-1-beamer/board-1024x768.jpg)

### Podium

![Podium at 1920×1080](assets/phase-6-1-beamer/podium-1920x1080.jpg)
![Podium at 1280×720](assets/phase-6-1-beamer/podium-1280x720.jpg)
![Podium at 1024×768](assets/phase-6-1-beamer/podium-1024x768.jpg)

## 4. Bestandsschutz evidence

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

### 4.2 Tokens

- **Phase 0 tokens are unchanged.** The freeze test (`design-system – bestandsschutz`, 10 assertions
  over `bg`, `bg-2`, `text`, `muted`, `accent`, `accent-2`, `surface`, `surface-2`, `border`,
  `border-strong`) passes.
- The only tokens touched are Phase 6.1 presentation tokens, exactly as intended:
  `--type-show-{question,answer,meta,score,rank,name}`, `--type-countdown`, `--show-gap`,
  `--show-pad`, and the new `--podium-bronze`. `--show-scale` (unused after this change) was
  removed.
- Every CSS rule in the diff is either a `.show*` / `.podium*` / `.leaderboard--show` rule or the
  countdown block. No base component (`.card`, `.btn`, `.option`, `.leaderboard` bare, `.input`,
  `.chip`, …) changed, so the player, editor and admin surfaces are unaffected. The base
  `.question__timer` rule is untouched.
- `design-system.test.ts` gained a token/class contract test that fails if a `--type-show-*` token
  is dropped or a beamer class loses its rule.

### 4.3 `dist/` is clean

- `dist/` is git-ignored (`.gitignore:5`), and `git ls-files packages/*/dist` is empty — no
  generated build output is tracked.
- The temporary verification pages (`_verify.*`, `_podium.*`) were written into
  `packages/frontend/dist/` during measurement and **deleted afterwards**; `dist/` now contains
  only the build output (`index/host/editor/admin.html`, `assets/`, `favicon.png`, `logo.png`).
- `git status` shows no file under any `dist/`.

## 5. Measurements (no overflow, all screens)

Rendered geometry from the real modules; `docH` is `documentElement.scrollHeight`, `vp` the layout
viewport height.

| Screen            | 1920×1080         | 1280×720          | 1024×768          |
| ----------------- | ----------------- | ----------------- | ----------------- |
| question          | docH 993 / vp 993 | docH 633 / vp 633 | docH 681 / vp 681 |
| answers (long)    | docH 993 / vp 993 | docH 633 / vp 633 | docH 681 / vp 681 |
| countdown         | docH 993 / vp 993 | docH 633 / vp 633 | docH 681 / vp 681 |
| reveal            | docH 993 / vp 993 | docH 633 / vp 633 | docH 681 / vp 681 |
| board (8 players) | docH 993 / vp 993 | docH 633 / vp 633 | docH 681 / vp 681 |
| podium            | docH 993 / vp 993 | docH 633 / vp 633 | docH 681 / vp 681 |

No horizontal or vertical overflow in any cell. Podium structure at 1920×1080, read from computed
style: rank 2 (silver `rgb(226,232,240)`) left, rank 1 (gold `rgb(251,191,36)`) centre and tallest,
rank 3 (bronze `rgb(201,139,94)`) right — all with a 3px top border.

## 6. Verification

| Check                   | Result                                                                    |
| ----------------------- | ------------------------------------------------------------------------- |
| `npm run typecheck`     | pass                                                                      |
| `npm test` (PostgreSQL) | pass — 308 passed, 0 skipped (shared 62, frontend 152, backend 94)        |
| `npm run format:check`  | pass                                                                      |
| `npm run build`         | pass                                                                      |
| Layout probe            | no overflow at 1920×1080, 1366×768, 1280×720, 1024×768, 768×1024, 390×844 |
| Phase 0 token freeze    | pass (10 assertions)                                                      |

## 7. Risks and follow-ups

| Item                            | Note                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Shared `.show` surface          | Used by the host page as the beamer; the change is presentation-only and covered by measurements |
| `--show-scale` removal          | Token was unused after this change; grep confirms no remaining references                        |
| Answer board 2 columns          | Fixed 2-up is deliberate; if a quiz ever needs 5–6 options per question, revisit the grid        |
| Full animated login / nav / art | Out of scope — Phases 6.2, 6.3, 6.10                                                             |

## 8. Open questions for the owner

1. Is the 2-column answer board the right call for 5–6 option questions, or should it fall back to
   a single column above four options?
2. Should the countdown ring be larger on the beamer, or is the current size right for a projector?
3. Should the podium show avatars once the character system exists (Phase 6.7)?

None of these block the phase.
