# ZeroPeek Design System (Phase 6.1)

This is the working reference for the design system that Phase 6.1 implements. It records what was
actually built, where it lives, and which rules apply. It is the implementation counterpart to
[`../concept/design-concept.md`](../concept/design-concept.md): the concept explains the intent, this
document explains the code.

**Style direction:** _Dark Retro-Futuristic Wireframe & Glassmorphism_. Depth comes from lines and
perspective (a receding floor grid, a horizon) plus a small number of frosted-glass surfaces — not
from rendered 3D rooms and not from images.

## 1. Scope and bestandsschutz

Phase 6.1 changes **presentation only**. It touches:

| File                                      | Change                                                              |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `src/styles/tokens.css`                   | Existing tokens kept; new tokens and component rules **appended**   |
| `src/styles/backdrop.css`                 | New file: the wireframe backdrop and the login starfield layer      |
| `src/ui.ts`                               | New reusable components; `button()` extended (backwards compatible) |
| `src/pages/{player,host,editor,admin}.ts` | Applied the components; no game, API or data logic changed          |
| `src/*.html`                              | Added one `<link>` to `backdrop.css`                                |

Nothing else moved. The Phase 0 tokens (`--bg`, `--text`, `--accent`, `--surface`, …) keep their
exact values; the new tokens sit beside them. `src/design-system.test.ts` freezes the Phase 0 values
and checks that every class the components emit is defined, so a future change cannot silently shift
an existing surface.

## 2. Colour

### 2.1 Base palette (unchanged, from Phase 0)

| Role              | Token             | Value                    |
| ----------------- | ----------------- | ------------------------ |
| Page background   | `--bg`            | `#08080f`                |
| Raised background | `--bg-2`          | `#0e0e1a`                |
| Card glass        | `--surface`       | `rgba(255,255,255,.045)` |
| Raised glass      | `--surface-2`     | `rgba(255,255,255,.075)` |
| Hairline          | `--border`        | `rgba(255,255,255,.09)`  |
| Control border    | `--border-strong` | `rgba(255,255,255,.16)`  |
| Text              | `--text`          | `#f5f5fb`                |
| Muted text        | `--muted`         | `#9c9cb5`                |
| Faint text        | `--faint`         | `#616180`                |
| Accent violet     | `--accent`        | `#7c5cff`                |
| Accent cyan       | `--accent-2`      | `#22d3ee`                |
| Success           | `--ok`            | `#22c55e`                |
| Error             | `--bad`           | `#f43f5e`                |
| Warning           | `--warn`          | `#f59e0b`                |

### 2.2 New tokens (Phase 6.1)

- **Brand ladder** (measured from the supplied logo): `--brand-cyan #15dbee`,
  `--brand-violet #7c3aed`, `--brand-magenta #de4ef1`, `--brand-indigo #5815bf`,
  `--brand-silver #e2e8f0`.
- **Rarity** (reserved for later inventory/achievement phases): `--rarity-rare #7c5cff`,
  `--rarity-epic #c084fc`, `--rarity-legendary #fbbf24`, `--rarity-exclusive #22d3ee`.
- **Neutral**: `--bg-3 #14142a` for cards inside cards and alternating rows.

### 2.3 Colour is never the only signal

Every status uses colour **and** a second channel. `chip(label, tone, dot)` pairs its tone with a
leading dot, and callers pass text (`"Correct"`, `"Wrong"`, `"No answer"`). This is the concept's
§3.3 rule and it is what makes the interface readable for colour-blind players.

## 3. Glass tiers

Glass is a **paired** fill and blur. A tier is never used without its partner. Six tiers exist:

| Tier    | Fill token        | Blur token       | Used for                                  |
| ------- | ----------------- | ---------------- | ----------------------------------------- |
| card    | `--glass-card`    | `--blur-card`    | Standard cards                            |
| raised  | `--glass-raised`  | `--blur-raised`  | Inputs, hover, controls, `--card--raised` |
| dialog  | `--glass-dialog`  | `--blur-dialog`  | Dialog panels, toasts                     |
| nav     | `--glass-nav`     | `--blur-nav`     | Navigation surfaces (Phase 6.2)           |
| input   | `--glass-input`   | `--blur-input`   | Field and track fills                     |
| overlay | `--glass-overlay` | `--blur-overlay` | The scrim behind a dialog                 |

Rules:

- **Budget:** at most three glass surfaces visible at once (concept §11.2). The pages keep to this:
  a dialog adds one overlay plus one panel.
- **Fallback:** `--glass-fallback #12121f` replaces the fill wherever blur is unavailable
  (`@supports not (backdrop-filter: blur(1px))`) or unwanted
  (`@media (prefers-reduced-transparency: reduce)`).
- **Readability first:** text sits on glass with `--text` at ≥ 7:1 and `--muted` at ≥ 4.5:1.

## 4. Typography

One system font stack (`--font`). Type roles are tokens, and they are applied to the existing
classes so there is a single source of truth:

| Role          | Token                  | Applied to                        |
| ------------- | ---------------------- | --------------------------------- |
| Page title    | `--type-page`          | `.page-title`                     |
| Section title | `--type-section`       | `.section-title`                  |
| Card title    | `--type-card`          | `.dialog__title`                  |
| Body          | `--type-body`          | `.btn`, `.dialog__body`           |
| Label         | `--type-label`         | `.field`, `.stat__label`, `.chip` |
| Help          | `--type-help`          | `.field__hint`, `.field__error`   |
| Number        | `--type-number`        | `.stat__value`                    |
| Countdown     | `--type-countdown`     | `.countdown__value`               |
| Show question | `--type-show-question` | `.show .question__prompt`         |
| Show answer   | `--type-show-answer`   | `.show .option`                   |

Weights: `--weight-page 750`, `--weight-section 700`, `--weight-card 650`, `--weight-number 750`,
`--weight-score 800`. Line heights: `--leading-tight 1.15`, `--leading-body 1.5`.

## 5. Components (`src/ui.ts`)

All components build DOM through `el`/`render` and set text with `textContent`. None of them uses
`innerHTML`, so they stay compatible with the backend's `script-src 'self'` CSP (a guard test
enforces this).

| Component                                         | Produces                                 | Notes                                                                               |
| ------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `button(label, options)`                          | `.btn` + variant/size/animation class    | Variants: `primary`, `secondary`, `ghost`, `danger`; `small`, `animate`, `disabled` |
| `setBusy(button, busy)`                           | `.btn--loading`, `disabled`, `aria-busy` | Shows the shared spinner; pair with `try/finally`                                   |
| `chip(label, tone, dot)`                          | `.chip` + tone                           | Tones: `default`, `accent`, `cyan`, `ok`, `warn`, `bad`, `muted`                    |
| `progress(value, max, opts)`                      | `.progress`                              | `role="progressbar"` with `aria-valuenow/max`; clamps and never divides by zero     |
| `statTile(value, label)`                          | `.stat`                                  | One figure with a caption                                                           |
| `dialog(options)`                                 | `.dialog` + panel                        | Modal: `aria-modal`, focus trap, closes on `Esc`/backdrop, restores focus           |
| `confirmDialog(options)`                          | `dialog` with Cancel + destructive       | For irreversible actions                                                            |
| `skeleton(variant)`                               | `.skeleton`                              | `text` or `card`; `aria-hidden`                                                     |
| `countdown(seconds, ratio)`                       | `.countdown`                             | Wireframe ring; `--progress` drives the conic gradient                              |
| `emptyState(title, hint, action)`                 | `.empty`                                 | Consistent "nothing here yet" state                                                 |
| `notice`, `toast`, `field`, `pageHeader`, `brand` | unchanged                                | Still exported                                                                      |

The existing `button()` signature is a strict extension: `variant` gained `secondary` and `ghost`,
and `small`/`animate` are new optional flags. Existing call sites keep working unchanged.

## 6. Wireframe backdrop (`src/styles/backdrop.css`)

Two fixed, non-interactive pseudo-elements, painted behind the content:

- `html::before` — a horizon line at 62% height plus faint ceiling scan lines, faded with a mask.
- `body::after` — a perspective floor grid (`perspective(520px) rotateX(64deg)`) that dissolves
  toward the horizon.

Everything is a CSS gradient. There are no images, no canvas and no permanent animation, so the
backdrop costs nothing to download and nothing per frame. Tokens: `--wire-cell` (64px, 80px ≥1440px,
48px ≤767px), `--wire-line`, `--wire-line-2`, `--wire-horizon`, `--wire-opacity`.

The `.centered` surface (login/join) gets a starfield layer: three tiled star fields of different
sizes and colours with a very slow drift (`star-drift`, 90s). This is the foundation the concept
reserves for the login experience (Phase 6.3); it is bounded by tile size, not by viewport, and it
stops entirely under `prefers-reduced-motion`.

## 7. Motion

A closed library (concept §7.2). Only `transform` and `opacity` animate, except the progress bar
width (deliberately small and rare).

| Utility          | Effect                         | Duration / curve   |
| ---------------- | ------------------------------ | ------------------ |
| `anim-fade-in`   | Opacity in                     | `--dur` / `--ease` |
| `anim-slide-up`  | 8px rise + fade                | 220ms / `--ease`   |
| `anim-pop`       | 0.92 scale + fade              | 200ms / `--spring` |
| `anim-shake`     | ±4px horizontal (wrong answer) | 300ms / linear     |
| `skeleton-sheen` | Placeholder shimmer            | 1.4s / `--ease`    |
| `star-drift`     | Starfield background drift     | 90s / linear       |

New animation durations live in tokens (`--dur-slow 400ms`, `--dur-show 600ms`). Under
`prefers-reduced-motion: reduce` all of these are disabled and state changes become instant; hover
lifts and button presses no longer translate.

## 8. Responsive

Breakpoints follow the concept §9: compact ≤480, mobile 481–767, tablet 768–1023, desktop 1024–1439,
wide ≥1440, beamer ≥1600.

- **Mobile (≤767px):** page gutters tighten, `grid--2`/`grid--3` collapse to one column, list rows
  stack, and report tables become stacked cards. The header row is visually hidden and each cell
  shows its own label from `data-label`; there is never a horizontal scrollbar.
- **Wide (≥1440px):** the content measure widens to 1320px.
- **Beamer (`.show`):** the host presentation surface uses a dedicated `vmin`-based scale instead of
  the normal breakpoints, so the question, answers and timer stay readable from a distance and on
  4:3 projectors.

Verified in a headless browser at 390×844, 1024×768 and 1920×1080: no horizontal overflow at any
size, the table transforms only below 768px, and the show surface scales with the viewport.

## 9. Accessibility

- **Focus:** one shared focus ring
  (`:where(a, button, input, select, textarea, [tabindex]):focus-visible`), defined once so it cannot
  be styled away locally.
- **Dialogs:** `aria-modal`, labelled by their title, focus trapped, `Esc` closes, focus returns to
  the trigger.
- **Progress and timers:** `role="progressbar"` with `aria-valuenow/max`; the countdown uses
  `role="timer"`.
- **Status:** colour is always paired with a dot and text (see §2.3).
- **Preferences:** `prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast:
more` are all handled.

## 10. What Phase 6.1 does not do

- No navigation restructure, no sidebar, no bottom bar — that is Phase 6.2.
- No animated login screen beyond the reusable starfield layer — Phase 6.3.
- No new images or sounds. The wireframe is CSS; any real background art comes from the owner's
  asset briefing and is integrated in Phase 6.10.
- No character, avatar, XP or inventory UI — Phases 6.6–6.8.
- No change to game logic, the API, the database or any test fixture.

## 11. How to extend it

1. Need a colour, radius, duration or type size? Add a token in `tokens.css` under the Phase 6.1
   block and reference it. Do not hard-code a value in a component.
2. Need a new component? Add it to `ui.ts`, style it in `tokens.css`, add a unit test in
   `ui.test.ts`, and add its class to the list in `design-system.test.ts`.
3. Need a new animation? Either reuse one from §7 or add it to the token block with a reason.
4. Never use `innerHTML`; the CSP forbids inline scripts and styles.
