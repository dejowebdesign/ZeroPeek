# Phase 6.8.6 – CSS, Contract and Documentation Cleanup

- **Branch:** `maintenance/phase-6-8-6-css-contract-docs` (from `main` = `da36e76`)
- **Scope:** a maintenance pass over the **frontend stylesheet**, the **design-system
  class contract** and the **project documentation** — remove CSS that no component
  emits any more, retire the custom properties nothing references, and bring the
  docs back in line with the merged state. No behaviour change, no schema change.
- **Status:** work complete on the branch, **awaiting owner approval** — no push, no pull
  request, no merge, no deploy yet.

## 0. Result in one sentence

The stylesheet, the class contract and the docs now describe only what actually
ships: 16 dead rule blocks are removed and two duplicated groups merged (19 fewer
blocks in total), 3 unused custom properties are gone, the class contract no longer
asserts a class nothing emits, and the phase/report/roadmap docs no longer contradict
the merged history — with the whole suite still green and no change to any rendered
surface.

## 1. Starting point (verified in the code, not assumed)

Before editing, every candidate was checked against the real source, not a list:

- **Dead selectors** were confirmed by searching the frontend `src` (excluding
  `styles/`, `*.test.ts` and `dist/`) for the class name. `question__timer`,
  `overlay`/`overlay__panel`/`overlay__actions`, `avatar__form`, the `avatar__slot-*`
  family, `auth__hint` and `input--invalid` are emitted nowhere. The avatar editor was
  removed from the profile in Phase 6.8.4 (equipping lives in the inventory), so its CSS
  became dead while the CSS stayed behind.
- **Used, keep.** `card--raised`, `card--interactive` and `anim-shake` are not emitted
  by a component today, but they are **documented design-system utilities**
  (`docs/design/design-system.md` §3/§7, `docs/concept/design-concept.md` §… card
  variants) and are the fallback in the blur/transparency fallback groups. They are
  retained, and their contract entries are retained too.
- **Unused custom properties** were found by diffing the declared `--*` properties
  against every `var(...)` reference in `tokens.css` + `backdrop.css`. Of the 18 the
  scan reports, 15 are intentional (frozen Phase-0 values, the documented brand/rarity
  ramp, the wireframe backdrop pair, `--dur-show`, `--type-score`, `--blur-input`) —
  many are asserted by `design-system.test.ts` itself. Only three had no reference
  anywhere: `--ease-in`, `--ease-out`, `--shadow-nav`.
- **Duplicates:** `.editor__question` was defined twice (the second only added
  `cursor: grab`), and `@media (min-width: 1440px) { :root { … } }` appeared twice
  (`--content-max` and `--player-measure`).

## 2. Changes

### 2.1 Stylesheet (`packages/frontend/src/styles/tokens.css`)

Removed 19 dead blocks:

| Removed                                                                                                            | Why it was dead                                                    |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `.overlay`, `.overlay__panel`, `.overlay__actions`                                                                 | superseded by `.dialog`/`.dialog__panel`                           |
| `.overlay__panel` in the blur and reduced-transparency groups                                                      | the class no longer exists                                         |
| `.question__timer`                                                                                                 | no timer element; `.countdown__value` carries the value            |
| `.avatar__form`                                                                                                    | editor moved to the inventory (Phase 6.8.4)                        |
| `.avatar__slots`, `-title`, `-options`, `-option`, `:hover`, `:has(…)`, `--selected` + reduced-motion + phone rule | the slot editor no longer renders                                  |
| `.auth__hint`                                                                                                      | no element carries it                                              |
| `.input--invalid`                                                                                                  | the class is never set; the `[aria-invalid='true']` selector stays |

Merged two duplicate groups:

- `.editor__question` — folded `cursor: grab` into the first block (the comment above
  the drag states is kept, since it explains the affordance).
- The 1440px `:root` step — `--content-max: 1320px` and `--player-measure: 1000px` now
  live in **one** block. Order matters: at ≥1440px all three `min-width` steps match, so
  the widest `--player-measure` must stay last, which it does.

Removed three unused custom properties: `--ease-in`, `--ease-out`, `--shadow-nav`
(no `var()` reference anywhere in the stylesheet set).

### 2.2 Class contract (`packages/frontend/src/design-system.test.ts`)

- Dropped the single dead entry `auth__hint` from the class list. `input--invalid` and
  `question__timer` were never in the list.
- The "slot options tap-sized" assertion became "keeps the removed slot editor out of
  the stylesheet": it now asserts the `avatar__form`/`avatar__slot-*` rules are absent,
  matching the DOM-side assertion already in `profile.test.ts`.
- The player-measure assertion now checks the merged 1440px block contains **both**
  `--content-max: 1320px` and `--player-measure: 1000px`.

### 2.3 Documentation

- `docs/phases.md` — the 6.8/6.8.4/6.8.5 rows said "Awaiting review"; they are merged
  (PR #41/#44/#45). Corrected, and the missing 6.8.3 row (PR #43) added.
- `docs/roadmap/technical-roadmap.md` — the cross-cutting table and the open-decisions
  table still listed the clock sync (R-7) and socket rate limit (R-6) as future work for
  6.9; both shipped in 6.8.5, so they are marked done and the blocking row is struck
  through (the file's existing convention).
- Historical reports (`phase-6-8*`, `fix-player-role-email-verification`,
  `phase-6-8-inventory`) — each got a dated note saying its "awaiting approval" status is
  a snapshot and the work has since merged. The bodies and test results are unchanged.

## 3. What this phase deliberately does **not** do

- No behaviour change: no component, event, API, socket or scoring logic is touched.
- No database change — there is **no migration** in this phase.
- No new dependency.
- It does not remove the nine other unreferenced custom properties: they are frozen
  Phase-0 values, the documented brand/rarity ramp, or the wireframe-backdrop set, and
  some are asserted by `design-system.test.ts`. Removing them would break that contract
  for no benefit.
- It does not restyle or re-lay-out anything; every change is deletion or de-duplication.

## 4. Tests

All suites green; the backend suites run against a real PostgreSQL
(`TEST_DATABASE_URL` / `DATABASE_URL`), no skips:

| Package  | Before 6.8.6 | After 6.8.6 | Note                                                             |
| -------- | ------------ | ----------- | ---------------------------------------------------------------- |
| frontend | 469          | 468         | one contract entry (`auth__hint`) removed; its `it` goes with it |
| shared   | 179          | 179         | untouched                                                        |
| backend  | 385          | 385         | untouched (no backend source or doc it reads was changed)        |

Verification commands (all pass):

```
npm run typecheck            # shared + backend + frontend
npm run format:check         # Prettier clean
npm run build                # full monorepo build
npx vitest run --root packages/shared
npx vitest run --root packages/frontend
DATABASE_URL=… npx vitest run --root packages/backend   # 385 tests, 0 skipped
```

## 5. Risks and follow-ups

| Item                                   | Note                                                                                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A removed class could be re-introduced | The contract test only covers classes a component emits; if a future phase re-adds `.overlay`-style markup it must add the rule and the contract entry together (documented in `design-system.md` §11).                                    |
| `.centered` lives in two files         | Noted during analysis: `.centered` is defined in both `tokens.css` and `backdrop.css`. Left as-is — the two rules are complementary (layout vs. the starfield overlay) and merging them is a larger, riskier change than this pass allows. |
| Remaining unused properties            | Nine remain, all intentional (frozen/documented). A future token audit should re-run the same declared-vs-referenced diff.                                                                                                                 |

## 6. Files touched

**Changed:** `packages/frontend/src/styles/tokens.css`,
`packages/frontend/src/design-system.test.ts`, `docs/phases.md`,
`docs/roadmap/technical-roadmap.md`, `docs/reports/phase-6-8-player-progression.md`,
`docs/reports/phase-6-8-3-player-surface-fixes.md`,
`docs/reports/phase-6-8-4-progression-inventory-podium.md`,
`docs/reports/phase-6-8-5-clock-sync-and-socket-rate-limit.md`,
`docs/reports/fix-player-role-email-verification.md`,
`docs/analysis/phase-6-8-inventory.md`.

**New:** `docs/reports/phase-6-8-6-css-contract-docs.md`.

---

> **Status note (documentation audit, after Phase 6.9.5):** this report was written while the
> work was still awaiting approval. It has since been merged into `main` via **PR #46**
> (merge commit `177b63c`). The content above is the historical completion report and is
> unchanged; only this note was added.
