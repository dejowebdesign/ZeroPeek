# Phase 6.1 – Design system (report)

- **Branch:** `feat/phase-6-1-design-system`
- **Base:** `main` after PR #17 (merge commit `8446ffc`)
- **Scope:** implement the central design system — _Dark Retro-Futuristic Wireframe &
  Glassmorphism_ — and apply it to the existing surfaces
- **Status:** implemented, awaiting review

This is the first Phase 6 implementation step. It changes **presentation only**. No game logic, API,
database schema, question, answer, account, role or permission was touched.

## 1. What was delivered

| Area             | Deliverable                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens           | `src/styles/tokens.css` extended (Phase 0 values untouched)                                                                                   |
| Backdrop         | New `src/styles/backdrop.css`: wireframe floor grid + horizon, and the login starfield layer                                                  |
| Components       | `src/ui.ts`: `chip`, `progress`, `statTile`, `dialog`, `confirmDialog`, `skeleton`, `countdown`, `emptyState`, `setBusy`; `button()` extended |
| Applied surfaces | `pages/player.ts`, `pages/host.ts`, `pages/editor.ts`, `pages/admin.ts`                                                                       |
| Entry points     | `index/host/editor/admin.html` link `backdrop.css`                                                                                            |
| Tests            | `src/ui.test.ts` extended (22 tests); new `src/design-system.test.ts` (86 tests)                                                              |
| Documentation    | `docs/design/design-system.md`; updates to `docs/concept/README.md` and `docs/phases.md`                                                      |

## 2. The design system in one screen

- **Colour:** the Phase 0 palette is frozen. A brand ladder (measured from the logo) and rarity
  colours are added beside it. Colour is never the only signal — status always adds a dot and text.
- **Glass:** six paired tiers (card, raised, dialog, nav, input, overlay). Each is a fill plus a
  blur radius; at most three are visible at once. Without `backdrop-filter`, or under
  `prefers-reduced-transparency`, glass becomes opaque (`--glass-fallback`).
- **Typography:** role tokens (`--type-page`, `--type-section`, `--type-countdown`, …) applied to the
  existing classes.
- **Wireframe:** a perspective floor grid and a horizon line, drawn entirely with CSS gradients on two
  fixed pseudo-elements. No images, no canvas, no permanent animation.
- **Motion:** a closed library (`anim-fade-in`, `anim-slide-up`, `anim-pop`, `anim-shake`,
  `skeleton-sheen`, `star-drift`), `transform`/`opacity` only, all disabled under
  `prefers-reduced-motion`.

## 3. Bestandsschutz evidence

- The Phase 0 tokens are asserted **byte-for-byte** by `design-system.test.ts` (11 frozen values). A
  future edit that changes one fails the build.
- The `button()` API is a strict extension. Existing call sites (`questionView.ts`,
  `questionForm.ts`, the pages) are unchanged and still typecheck.
- `questionForm.test.ts` and `questionView.test.ts` — which query the real form and reveal markup —
  pass unchanged, so the editor and reveal surfaces still behave as before.
- No file outside the frontend was modified. `git status` confirms the change set.

## 4. Verification

| Check                                          | Result                                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                            | pass                                                                                                                                     |
| `npm test` (PostgreSQL reachable)              | pass — backend 94, frontend 127, shared 62                                                                                               |
| `npm run build`                                | pass — CSS 24.65 kB (5.70 kB gzip), first JS per page < 6 kB gzip                                                                        |
| `npm run format:check`                         | pass                                                                                                                                     |
| Headless render (390×844, 1024×768, 1920×1080) | no horizontal overflow; table→cards only < 768px; show scale adapts                                                                      |
| Computed-style probe                           | card glass `blur(16px)`, dialog `blur(24px)`, countdown conic ring, skeleton animation present, backdrop `matrix3d` (perspective) active |
| CSP                                            | no `innerHTML`/inline style/script in the UI layer (guard test)                                                                          |

The backend integration suites ran against a real PostgreSQL 16 container, so they were not silently
skipped.

## 5. Performance notes

- The backdrop is CSS-only: zero bytes of image, zero per-frame cost when idle.
- The countdown ring animates a single custom property (`--progress`); it does not touch layout.
- Glass surfaces are capped at three visible at once, per the concept's budget.
- CSS is 24.65 kB raw / 5.70 kB gzip. First-paint JS per page stays well under the 60 kB budget.

## 6. Risks and follow-ups

| Item                                | Note                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `color-mix()` in hover/focus styles | Baseline in all current evergreen browsers; the fallback fills are plain colours. |
| Navigation, sidebar, bottom bar     | Deliberately **not** in this phase — Phase 6.2.                                   |
| Animated login screen               | Only the reusable starfield layer is here — the full experience is Phase 6.3.     |
| Real background art                 | Not included. Comes from the owner's asset briefing; integrated in Phase 6.10.    |
| Character/avatar/XP/inventory UI    | Not started — Phases 6.6–6.8.                                                     |

## 7. Open questions for the owner

1. Is the wireframe intensity right, or should the grid be fainter/stronger?
2. Are the six glass tiers the right number, or should some be merged?
3. Should the host/beamer surface (`.show`) use an even larger type scale?

None of these block the phase; they are refinements for review.
