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

### 8.1 Application shell and navigation (Phase 6.2.1, implemented – merged in PR #21)

`src/navigation.ts` exports `appShell(options)`, a single node that a page renders into `<main>`. It
is **additive**: the four existing surfaces (player, host, editor, admin) keep their own entry point
and URL, and their screens are unchanged — the shell only adds a brand bar, a navigation region and a
single `<h1>`. No new route and no new HTML entry point.

Navigation is **display only**. It decides what a role sees; every server route and socket event
still authorises on its own.

| Viewport          | Layout                                              | Navigation                                                                 |
| ----------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| desktop ≥1024px   | `grid-template-columns: var(--sidebar-w) …`         | fixed left sidebar, icons **and** labels                                   |
| tablet 768–1023px | `grid-template-columns: var(--sidebar-w-compact) …` | icon rail; labels hidden visually, kept as `aria-label` on the active link |
| phone ≤767px      | one column, `padding-bottom: var(--bottom-bar-h)`   | fixed bottom bar, at most five entries plus "More"                         |

Tokens: `--sidebar-w 248px`, `--sidebar-w-compact 72px`, `--bottom-bar-h 60px`, `--shell-top-h 64px`.

Role sets:

- **player** — Lobby, Questions, Inventory, Profile, Settings. No sign-out: a guest has no account.
- **host** — Overview, Game control, Quizzes, Backgrounds, Players, Inventory & avatars, Reports.
- **admin** — the host set **plus** `ADMIN_ITEM`, appended only when `isAdmin` is set. The server
  still enforces admin-only access; the UI only mirrors it.

An entry whose page does not exist yet is rendered as a non-clickable `span.nav__item--soon` (with a
"Soon" tag on desktop, `aria-disabled="true"`), never as a dead link. The bottom bar shows
`MOBILE_PRIMARY_LIMIT = 5` entries and folds the rest into a `<details>` "More" list, so no
destination is lost on a phone.

**Player content measure (briefing §4).** One token drives the lobby, the question and the result, so
the three share a width and a centre line: `--player-measure` is `100%` on a phone (inside
`--player-gutter: var(--space-4)`, leaving `viewport − 32px`), `90%` at ≥768px, `78%` at ≥1024px and
a hard `1000px` cap at ≥1440px. It is applied to the centred content (`> *`), not to the card, so a
wide screen cannot stretch a single card across the whole width.

**Beamer.** The presentation surface (`.centered.show`) is never wrapped in the shell and keeps its
own `vmin`-based scale; the shell adds no navigation to it.

### 8.2 Player lobby and profile placeholder (Phase 6.2.2)

Scope is fixed in `../roadmap/technical-roadmap.md` §3.1 and analysed in
`../analysis/phase-6-2-2-player-lobby-profile.md`. This phase is **not yet implemented**.

- **Player lobby.** Show the players the server already sends in `game:state`
  (`PublicPlayer[]` — `nickname`, `avatar`, `score`, `connected`), show the connection state the
  system already provides, and improve the status and feedback messages. Styling follows the tokens
  above; the lobby keeps the server-authoritative flow through `game:state` unchanged. Where the
  server does not send a datum, it is not invented.
- **Profile area.** Phase 6.2.2 left a clearly marked placeholder here. That placeholder is now
  **replaced** by the real profile page in Phase 6.6 (see §8.4); the `emptyState` wording
  **“Dein Spielerprofil kommt mit Phase 6.6.”** no longer exists in the code.
- **Out of scope.** Player registration/login (6.3), a `PLAYER` role, profile model/API, XP/level,
  inventory/avatars, database or Prisma changes, game-flow/timer/answer/scoring changes, socket
  permission changes, host/beamer changes. Guests keep the standard figure with no avatar choice.
- **Allowed, behaviour-neutral fixes.** B-2 (type-only correction of the shared `player:join` ack so
  it carries the `token` the server already returns), B-3 (CSS rule for `.join__feedback`), B-4 (CSS
  rule for `.question`). **Not** touched: B-5 (`pageHeader`), B-6 (unemitted events), B-7/R-5
  (reconnect restores no question).

### 8.3 Auth surface and starfield (Phase 6.3, implemented)

Scope is fixed in `../roadmap/technical-roadmap.md` §4. This phase is **implemented on the
`feat/phase-6-3-auth-registration` branch** and is additive; it does not change the existing host
login, the join flow or any server route that already existed.

- **New entry point.** `src/auth.html` (Vite input `auth`) renders `src/pages/auth.ts`: a single glass
  card over the starfield, offering sign in, registration and the confirmation result. It is a
  _separate_ page, so the host/player entry points keep their own URLs and markup.
- **Starfield.** `src/starfield.ts` builds the layer; the stars are pure CSS in `backdrop.css`
  (tiled `radial-gradient`s, no image). Two fields at different speeds give depth, and a few meteors
  add motion. It is `aria-hidden`, non-interactive and cheap: the particle count is bounded by the
  tile, not the viewport. `.centered::before` (Phase 6.1) is kept unchanged so the join screens do
  not shift.
- **Motion and preference.** `prefers-reduced-motion: reduce` stops the drift and hides the meteors.
  A user switch ("Calm the star effects") does the same independently of the OS setting and is
  stored in `localStorage`; the field is swapped in place so typed form input is preserved.
- **Glass.** The card reuses `--glass-raised` with `--blur-dialog` and the opaque `--glass-fallback`
  under `@supports not (backdrop-filter: …)`, so it is legible without blur.
- **Registration offer.** `playerView.ts` exports `registerOffer()`, a quiet, optional invitation
  shown after a game; it links to `./auth.html#register`. It never gates joining a game.

### 8.4 Player profile (Phase 6.6, implemented)

Scope is fixed in `../roadmap/technical-roadmap.md` §7 and the behaviour is documented in
`../reports/phase-6-6-player-profiles.md`. The phase is additive; it changes no existing route,
no game rule and no token value.

- **New entry point.** `src/profile.html` (Vite input `profile`) renders `src/pages/profile.ts`.
  It is a **separate** page, so the player/host/editor/admin entry points keep their own URLs.
  The `profile` navigation entry links to `./profile.html`; the old `./#profile` placeholder
  route on the player page is removed.
- **Composition.** The page reuses the existing primitives — `appShell` (player role, `profile`
  active), `card`, `chip`, `statTile`, `emptyState`, `notice`, `skeleton`. No new colour, blur or
  radius token is introduced; only layout rules (`.profile*`) were added to the Phase 6.6 block in
  `tokens.css`, and they sit below everything else.
- **Data honesty.** Every figure is computed by the server; the client only renders it. With no
  finished games the page shows an `emptyState` and accuracy shows an em dash — never a
  fabricated number. There is no quiz-history view here (admin-only, Phase 5c).
- **Responsive.** The identity header wraps; the statistics grid is three columns on desktop and
  two on a phone (≤767px), matching the shell's existing breakpoints.
- **Session.** A signed-out visitor sees a single "Sign in" card; a failed profile request shows
  an error notice. The page never calls `/api/profile` without a session.

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
- No animated login screen beyond the reusable starfield layer — Phase 6.3 (see §8.3).
- No new images or sounds. The wireframe is CSS; any real background art comes from the owner's
  asset briefing and is integrated in Phase 6.10.
- No character, avatar, XP or inventory UI — Phases 6.6–6.8.

## 10.1 Phase 6.7 addition (avatar surface)

Phase 6.7 adds one **self-contained** block at the end of `tokens.css` (`.profile__portrait`,
`.avatar__*`). It defines **no** new colour, blur or radius: it composes the existing tokens
(`--glass-card`, `--radius`, `--tap`, `--surface-2`, `--accent-2`, `--muted`, `--hairline`). The
figure is a single supplied `<img>`; the loadout is a labelled list of item thumbnails. The preview
does **not** absolutely position equipment over the figure — the supplied layers are not aligned, so
no coordinates are invented (see `docs/assets/CHARACTER-CATALOGUE.md` §4). A guard test in
`design-system.test.ts` locks this in.

## 11. How to extend it

1. Need a colour, radius, duration or type size? Add a token in `tokens.css` under the Phase 6.1
   block and reference it. Do not hard-code a value in a component.
2. Need a new component? Add it to `ui.ts`, style it in `tokens.css`, add a unit test in
   `ui.test.ts`, and add its class to the list in `design-system.test.ts`.
3. Need a new animation? Either reuse one from §7 or add it to the token block with a reason.
4. Never use `innerHTML`; the CSP forbids inline scripts and styles.
