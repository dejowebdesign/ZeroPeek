# Phase 6.9.2 – Game-Show Skeleton & Scene Control

- **Branch:** `feat/phase-6-9-2-game-show-skeleton` (from `origin/main` = `31a7783`, PR #47 merged)
- **Scope:** the technical and visual **base structure** for the 13 game-show scenes and their
  control, inside the existing **combined** host/beamer surface. No new route, no second engine,
  no background image, no sound.
- **Status:** work complete on the branch, **awaiting owner approval** — no push, no pull request,
  no merge, no deploy yet.

## 0. Result in one sentence

The host/beamer page now derives its show scene from the authoritative server state through a
single, pure scene controller — the scene is **display-only** and always follows the game — and can
hide its own controls for a clean beamer stage; all additive, with no new dependency, no schema
change and no change to any existing event or game rule.

> **Correction (2026-11-17):** two defects were found in the show flow after the first draft of this
> report — the scene bar offered a manual scene step, and an idempotent phase command could cancel
> the server's auto-advance timer and stall the game. Both are fixed; see **§8**.

## 1. Starting point (verified in the code, not assumed)

From the Phase 6.9 analysis (`docs/analysis/phase-6-9-game-show-analysis.md`, §2, §7, §10) and the
Phase 6.9.1 report:

1. The show is the **combined** host/beamer page `packages/frontend/src/pages/host.ts` — there is no
   separate beamer route and no show token.
2. The screens were chosen by `hostScreen(state)` (from `hostView.ts`), a pure phase → screen map,
   and drawn by `renderHostState`.
3. `showView.ts` held the pure beamer builders; `hostView.ts` held the phase rules; `host.ts` wired
   the socket events to the screens.
4. Phase 6.9.1 had already added the real `lead` phase, the `category`/`difficulty` labels and the
   `points`/`ranks` deltas, so the data the later scenes need exists.

This phase adds the **scene layer** on top of those screens. It changes no server code, no contract
and no stylesheet token.

## 2. Design decisions applied

| Decision           | Value                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Show architecture  | Combined host/beamer view stays; the show is the presentation half of it — **no** second surface        |
| Scene authority    | A scene is **derived** from the authoritative state; the client never invents a phase                   |
| Phase → scene      | Read through the existing `hostScreen` selector, so show and console can never disagree                 |
| Scene control      | The scene is **display-only**: re-derived from the authoritative phase on every render — no manual step |
| Client-only scenes | None. Even `welcome` is drawn inside a live lobby, so the show has no state the server lacks            |
| Presentation mode  | A toggle that **hides** the host chrome (never removes it); in-memory only                              |
| Contracts / schema | **Unchanged.** No new event, no new field, no migration                                                 |
| Assets             | **No** image, **no** placeholder, **no** AI-generated graphic — the existing CSS backdrop is reused     |

## 3. Changes

### 3.1 New: `packages/frontend/src/showScenes.ts` (pure, no DOM)

- `SHOW_SCENES` / `SCENE_DEFINITIONS` — the 13 scenes with their `order`, `phase`, `mode`,
  `requires` and allowed `transitions`.
- `ENTRY_SCENE` — the scene each phase opens with (lobby → `join`, lead → `start`, …).
- `sceneDefinition`, `sceneBelongsTo`, `samePhaseScenes`, `entryScene` — the model accessors (the
  `samePhaseScenes` / `sceneBelongsTo` grouping is kept as the description of which scenes share a
  phase; it no longer drives any client navigation).
- `sceneInputOf(state)` / `sceneForInput` / `sceneForState` — the authoritative state → scene map,
  routed through `hostScreen` so its fallbacks (a `lead`/`question` without a payload falls back to
  the lobby; a `reveal` without a reveal falls back to the question) apply to the show too.
- `ShowController` — folds a descriptor into the current scene (`sync`) and ignores a **stale**
  descriptor (an older `at`), so a late event or an overtaken resync can never pull the show
  backwards. The scene is re-derived from the phase on every `sync` (the phase's entry scene), so
  the show always follows the game. It exposes **no** method that scores, answers, changes a phase
  or moves the scene by hand.

### 3.2 `packages/frontend/src/hostView.ts`

- `HostScreen` gains `welcome`; `hostScreen(null)` returns `welcome` (the no-game landing). This is
  the only behaviour change to the selector, and it is exercised by a new test.

### 3.3 `packages/frontend/src/showView.ts`

- `participantCard(player)` — one participant tile (large head crop + name) for the participants
  overview (scene 3). Reuses the existing `playerAvatar` artwork and the letter-badge fallback; no
  image is generated.

### 3.4 `packages/frontend/src/pages/host.ts`

- `renderHostState` folds every render into `show.sync(descriptorOf(input))`, so the scene is always
  derived from the same authoritative descriptor — live event or reconnect snapshot.
- `sceneBar()` — the scene name and the presentation-mode toggle. The scene is display-only, so the
  bar has no manual navigation. It renders for every scene of a live game and never hides the host
  controls.
- `presentationToggle()` / `presentationClass()` — presentation mode hides `.show__controls` and the
  connection banner on the board, so the beamer shows a clean stage.
- The lobby is now three scenes of one card: `welcome` (intro), `join` (PIN + kick list — the exact
  markup the console always showed) and `participants` (character grid).
- The question board emphasises a different part per scene (`question` full, `answers` options
  without the ring, `countdown` ring without the options) — same data, same game.
- The reveal board adds a "Points awarded" heading for the `points` scene; the board adds a "Final
  round" heading for the `final` scene; the podium adds a closing line for the `outro` scene.

### 3.5 `packages/frontend/src/styles/tokens.css`

- A new, **additive** "game-show skeleton" section: `.show__scene-bar`, `.show__scene-label`,
  `.show__present`, the lobby-scene wrappers, the `.participants` grid and `.participant` tile, and
  the `show-scene-fade` transition. Every value comes from existing tokens; the fade animates
  **opacity only** and is disabled under `prefers-reduced-motion`.

## 4. Tests

- **New `showScenes.test.ts`:** the 13-scene model and order, the phase → entry map, the state →
  scene map including the `hostScreen` fallbacks, and the controller — lobby → lead → question →
  reveal → board → end, reconnect (same scene), stale snapshot (ignored), same-phase re-render
  (scene unchanged), release (back to `welcome`), and a guard that the controller exposes only the
  derivation surface (`current`, `currentPhase`, `sync`).
- **New `hostPage.test.ts`:** drives the **real** host page in jsdom with a fake socket and asserts
  there is **no** manual scene navigation in any phase, that the scene follows the authoritative
  phase from lobby to podium, and that no scene bar is drawn while no game is under control.
- **`showView.test.ts`:** `participantCard` structure, head crop and letter-badge fallback.
- **`hostView.test.ts`:** `hostScreen(null) === 'welcome'`.
- **`design-system.test.ts`:** the new classes are defined; the scene bar never hides the controls;
  presentation mode hides the chrome; the fade is opacity-only and reduced-motion-safe.
- **`gameplay-reliability.integration.test.ts` (backend, +3):** a duplicate `board`/`reveal` and a
  duplicate `board` racing the reveal timer must not clear the auto-advance and strand the game
  (see §8).

### Verification (all green)

| Check                  | Result                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `npm run typecheck`    | pass                                                                                |
| Backend tests          | 23 files, **402 passed** (PostgreSQL present) / 98 passed / 301 skipped without one |
| Frontend tests         | 18 files, **511 passed**                                                            |
| Shared tests           | 9 files, **179 passed**                                                             |
| `npm run build`        | pass                                                                                |
| `npm run format:check` | pass                                                                                |

## 5. Risks and their handling

| Risk                                      | Handling                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Host ↔ beamer contradiction               | One scene controller from **one** descriptor; the phase comes from `hostScreen`, never from local state — R3 |
| A manual step reaching the engine         | There is **no** manual step: the scene is re-derived from the authoritative phase on every render            |
| A late event pulling the show backwards   | A stale descriptor (older `at`) is ignored — the R3 mitigation from the analysis                             |
| Presentation mode hiding the way back out | The toggle is never hidden by the mode; the controls are hidden, not removed — R10                           |
| Performance of the scene transition       | Opacity-only keyframe, no layout, disabled under `prefers-reduced-motion` — R4                               |
| New CSS diverging from the design system  | Only existing tokens are used; the classes are added to the `design-system.test.ts` contract                 |
| Missing background/character assets       | No image is introduced; the existing CSS backdrop and the letter-badge fallback carry the scenes — R6/R7     |

## 6. Out of scope (unchanged, as agreed)

- **No** background image, **no** placeholder, **no** AI-generated graphic (Block D remains the
  owner's).
- **No** sound or music (Phase 6.11).
- **No** server change, **no** contract change, **no** schema change, **no** migration.
- **No** final-round engine state (scene 11 is a display-only board view until the owner decides).
- **No** report fetch for the outro (the report stays on the console).
- **No** change to any existing game rule, scoring, event or payload.

## 7. Open product decisions still untouched

Carried over from the analysis (§12), none of which this phase resolves:

1. Final round (scene 11): display-only (current) or its own engine state?
2. Points/rank deltas: the 6.9.1 contracts (`host:reveal.points`, `host:board.ranks`) are used
   as-is; a dedicated `host:points`/`host:ranks` event was not added.
3. Show palette: this phase stays on the existing tokens (violet primary, cyan secondary).
4. Outro statistics: socket subset vs. HTTP report (currently neither — a closing line only).
5. Start-countdown length and whether the host may skip it (already `host:skipLead` from 6.9.1).
6. QR code: confirmed out of scope.

## 8. Correction pass (2026-11-17) — two show-flow defects

Two defects were found in the show flow after the first draft of this report. Both are corrected on
the same branch; no other phase behaviour changed.

### 8.1 Problem A — the scene bar offered a manual scene step

The scene bar rendered a `‹`/`›`/named-button strip that let the host park the show on any scene of
the current phase (`ShowController.step` / `cycle`). That contradicts the concept: the scene must
follow the authoritative phase, and a host-visible scene the server is not in is exactly the
host ↔ beamer contradiction the concept forbids (§10.1).

**Fix.** The scene is now strictly display-only. `sceneBar()` renders the scene name and the
presentation toggle only; `ShowController` lost `step`/`cycle`/`steppable` and `sync` always
re-derives the phase's entry scene. The `.show__scene-steps` CSS and its contract entries were
removed. `samePhaseScenes` / `sceneBelongsTo` remain as the model's description of which scenes
share a phase. Guarded by `hostPage.test.ts` (no step buttons in any phase) and the updated
`showScenes.test.ts`.

### 8.2 Problem B — an idempotent phase command cancelled the auto-advance timer

`engine.revealInternal` and `engine.boardInternal` called `clearTimer(game)` **before** their
idempotency guards. A second `reveal`/`board` — a host double-click, or the auto-advance timer
racing a manual click — was a silent no-op for the phase, but it still cleared the timer. Since
that timer is the only thing that moves the game on from the reveal/board screen, the game stalled
there permanently. Reproduced end-to-end (host double-click on "Leaderboard" → stuck on the board)
and fixed by moving `clearTimer` **after** the guards, so only a real transition clears it. Guarded
by three new backend tests in `gameplay-reliability.integration.test.ts` (they fail without the
fix).
