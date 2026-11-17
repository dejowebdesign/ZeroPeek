# Phase 6.9.2 – Game-Show Skeleton & Scene Control

- **Branch:** `feat/phase-6-9-2-game-show-skeleton` (from `origin/main` = `31a7783`, PR #47 merged)
- **Scope:** the technical and visual **base structure** for the 13 game-show scenes and their
  control, inside the existing **combined** host/beamer surface. No new route, no second engine,
  no background image, no sound.
- **Status:** work complete on the branch, **awaiting owner approval** — no push, no pull request,
  no merge, no deploy yet.

## 0. Result in one sentence

The host/beamer page now derives its show scene from the authoritative server state through a
single, pure scene controller, can step between the scenes of the current phase (presentation
only), and can hide its own controls for a clean beamer stage — all additive, with no new
dependency, no schema change and no change to any existing event or game rule.

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

| Decision           | Value                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| Show architecture  | Combined host/beamer view stays; the show is the presentation half of it — **no** second surface    |
| Scene authority    | A scene is **derived** from the authoritative state; the client never invents a phase               |
| Phase → scene      | Read through the existing `hostScreen` selector, so show and console can never disagree             |
| Sub-scene control  | A step only ever moves between scenes of the **current** phase; it sends **no** game command        |
| Client-only scenes | None. Even `welcome` is drawn inside a live lobby, so the show has no state the server lacks        |
| Presentation mode  | A toggle that **hides** the host chrome (never removes it); in-memory only                          |
| Contracts / schema | **Unchanged.** No new event, no new field, no migration                                             |
| Assets             | **No** image, **no** placeholder, **no** AI-generated graphic — the existing CSS backdrop is reused |

## 3. Changes

### 3.1 New: `packages/frontend/src/showScenes.ts` (pure, no DOM)

- `SHOW_SCENES` / `SCENE_DEFINITIONS` — the 13 scenes with their `order`, `phase`, `mode`,
  `requires` and allowed `transitions`.
- `ENTRY_SCENE` — the scene each phase opens with (lobby → `join`, lead → `start`, …).
- `sceneDefinition`, `sceneBelongsTo`, `samePhaseScenes`, `entryScene` — the model accessors.
- `sceneInputOf(state)` / `sceneForInput` / `sceneForState` — the authoritative state → scene map,
  routed through `hostScreen` so its fallbacks (a `lead`/`question` without a payload falls back to
  the lobby; a `reveal` without a reveal falls back to the question) apply to the show too.
- `ShowController` — folds a descriptor into the current scene (`sync`), steps between the current
  phase's scenes (`step`, `cycle`), and ignores a **stale** descriptor (an older `at`), so a late
  event or an overtaken resync can never pull the show backwards. It exposes **no** method that
  scores, answers or changes a phase.

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
- `sceneBar()` — the scene name and the presentation-only steps for the current phase, plus the
  presentation-mode toggle. It renders for every scene of a live game and never hides the host
  controls.
- `presentationToggle()` / `presentationClass()` — presentation mode hides `.show__controls`,
  `.show__scene-steps` and the connection banner on the board, so the beamer shows a clean stage.
- The lobby is now three scenes of one card: `welcome` (intro), `join` (PIN + kick list — the exact
  markup the console always showed) and `participants` (character grid).
- The question board emphasises a different part per scene (`question` full, `answers` options
  without the ring, `countdown` ring without the options) — same data, same game.
- The reveal board adds a "Points awarded" heading for the `points` scene; the board adds a "Final
  round" heading for the `final` scene; the podium adds a closing line for the `outro` scene.

### 3.5 `packages/frontend/src/styles/tokens.css`

- A new, **additive** "game-show skeleton" section: `.show__scene-bar`, `.show__scene-label`,
  `.show__scene-steps`, `.show__present`, the lobby-scene wrappers, the `.participants` grid and
  `.participant` tile, and the `show-scene-fade` transition. Every value comes from existing tokens;
  the fade animates **opacity only** and is disabled under `prefers-reduced-motion`.

## 4. Tests

- **New `showScenes.test.ts` (23 tests):** the 13-scene model and order, the phase → entry map, the
  state → scene map including the `hostScreen` fallbacks, and the controller's transitions —
  lobby → lead → question, reconnect (same scene), stale snapshot (ignored), new question (reset),
  step within the phase only, refuse a step with no game, cycle + wrap, and a guard that the
  controller exposes only presentation methods.
- **`showView.test.ts`:** `participantCard` structure, head crop and letter-badge fallback.
- **`hostView.test.ts`:** `hostScreen(null) === 'welcome'`.
- **`design-system.test.ts`:** the new classes are defined; the scene bar never hides the controls;
  presentation mode hides the chrome; the fade is opacity-only and reduced-motion-safe.

### Verification (all green)

| Check                  | Result                                                                |
| ---------------------- | --------------------------------------------------------------------- |
| `npm run typecheck`    | pass                                                                  |
| Backend tests          | 23 files, **98 passed** / 301 skipped (no PostgreSQL in this sandbox) |
| Frontend tests         | 17 files, **512 passed**                                              |
| Shared tests           | 9 files, **179 passed**                                               |
| `npm run build`        | pass                                                                  |
| `npm run format:check` | pass                                                                  |

## 5. Risks and their handling

| Risk                                      | Handling                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Host ↔ beamer contradiction               | One scene controller from **one** descriptor; the phase comes from `hostScreen`, never from local state — R3 |
| A manual step reaching the engine         | `step`/`cycle` only change the drawn scene and send nothing; the controller has no command method            |
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
