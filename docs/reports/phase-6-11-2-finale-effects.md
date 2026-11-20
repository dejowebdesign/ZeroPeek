# Phase 6.11.2 – Finale show effects on the winner podium

**Status:** implemented on `feat/phase-6-11-2-finale-effects`, awaiting owner approval.
**Branch base:** `main` at `f884c08` (merge of PR #58).
**Scope:** one new host-only module, one new stylesheet block, host-page wiring, tests, assets.

---

## 1. What the owner asked for

When the winner podium appears on the host/beamer screen, play a short game-show
finale: a rocket climbs, an explosion at exactly 1.5 s, then applause with
confetti, then a graceful fade. Two supplied sounds only, host screen only, no
effect at all on player devices, and no change to the game logic or the scoring.

---

## 2. Inventory taken before any code was written

| Question                                         | Finding                                                                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where is the podium drawn?                       | `packages/frontend/src/pages/host.ts` → `showPodium()`, reached when `hostScreen(state)` is `end` and via the `host:ended` event.                              |
| What event marks the real finale?                | The authoritative phase becoming `end`. The same function also draws the `outro` scene, so a trigger inside it would fire twice without a guard.               |
| Is there an existing canvas animation to follow? | Yes — `starfield.ts` (CSS particles) and the design-system motion rules. The finale follows the same conventions rather than adding a library.                 |
| Is there existing audio architecture?            | Yes — `hostMusic.ts` (`HostMusic`), one media element, phase-driven, with the host's mute/volume in `localStorage`. The finale is a second, independent owner. |
| How is host/player separation enforced today?    | Structurally: `pages/player.ts` never imports `hostMusic`, and `design-system.test.ts` asserts it. The finale reuses that guard pattern.                       |
| Is `prefers-reduced-motion` handled anywhere?    | Yes — `starfield.ts`, `tokens.css`, `backdrop.css`, and a test that reads the **last** reduced-motion block in `tokens.css`.                                   |
| What is the z-index scale?                       | `-2` ambient, `40` (new), `50` toast, `70` dialog. The canvas sits at `40` and the board at `41`, so it never covers a dialog or a toast.                      |

Nothing in the game engine, the scoring, the database, the socket protocol or the
API was touched. The feature is additive decoration over an existing screen.

---

## 3. The supplied audio, measured

Both files were analysed with a sample-level envelope before they were used, because
the brief ties the visuals to the sound.

| File                         | Channels | Rate  | Duration   | Peak position               |
| ---------------------------- | -------- | ----- | ---------- | --------------------------- |
| `sfxmint-fireworks-02.wav`   | 2        | 44.1k | **3.16 s** | **0.02 s** (amplitude 0.89) |
| `sfxmint-crowd-chant-15.wav` | 2        | 44.1k | **5.17 s** | 1.50 s (amplitude 0.89)     |

Durations match the brief exactly (3.16 s / 5.17 s).

### The one conflict, stated plainly

The brief says the explosion must be timed to the **climax of the fireworks sound**
and also that the explosion happens at **exactly 1.5 s**. In the supplied file those
are two different moments:

```
0.00 s  ██████████████████████████  0.887   launch report (the loudest point)
0.05 s  ███████                     0.239
0.60 s  ███                         0.122
1.42 s  ███                         0.128   main burst
2.41 s  ███                         0.121   late crackle
```

The file is a rocket launch: a sharp report at the start, then the burst at 1.42 s.
The true peak is at 0.02 s, and the secondary burst at 1.42 s is **7× quieter**.

**Decision taken:** the 1.5 s figure is the hard requirement (it is stated twice and
appears in the test list), so the explosion fires at **1500 ms**. The audio plays from
0.0 s, so its 1.42 s burst lands **80 ms before** the visual flash — close enough to
read as one moment, and it keeps the audio and the visuals on the same beat.

**What I did not do:** I did not trim, delay or re-encode the sound to move its peak,
and I did not move the explosion to 1.42 s. Both would have been guesses about the
owner's intent. If the intended pairing was "flash exactly on the burst", the fix is
one constant (`EXPLOSION_MS = 1420`) — say the word and it is a one-line change.

---

## 4. How the animation is built

New module: `packages/frontend/src/finaleEffects.ts`. Pure logic plus one canvas.
No dependency was added; the particles are drawn with the plain 2D context.

### Timeline

| t (ms) | Stage         | What happens                                                        |
| ------ | ------------- | ------------------------------------------------------------------- |
| 0      | `rocket`      | Rocket leaves the bottom edge, golden trail; fireworks sound starts |
| 1500   | `explosion`   | Three-layer radial burst in the upper third + glitter               |
| 2100   | `celebration` | Applause starts, confetti begins to fall                            |
| 5800   | `fade`        | Confetti thins out, sparks die                                      |
| 7000   | `done`        | Canvas removed, audio paused and rewound                            |

The constants are exported and asserted, so the timeline cannot drift silently.

### Why the rocket arrives exactly on time

The rocket's position is **derived from the elapsed time**, not integrated from a
velocity. Whatever the frame rate — a fast desktop or a struggling projector — at
1500 ms it is at the explosion point, so the flash cannot lag behind the audio.

The particle _motion_ uses a fixed 1/60 s step. Decoration does not need sub-frame
accuracy, and a fixed step makes the look identical at 30 and 60 fps.

### Colour and legibility

The palette is the existing token ladder: `--rarity-legendary` gold, `--accent-2`
cyan, `--accent` violet, plus white sparks. The explosion is anchored at 26 % of the
viewport height, above the podium card, so names and placements are never covered.
The canvas is at `z-index: 40` with `pointer-events: none`; the board is `41`.

### Budget

| Limit               | Value  | Why                                                   |
| ------------------- | ------ | ----------------------------------------------------- |
| Max particles       | 420    | Bounded, so the count cannot grow with the frame rate |
| Explosion per layer | 42     | Three layers, one per brand colour                    |
| Glitter             | 36     |                                                       |
| Secondary bursts    | 3 × 18 | Spaced through the celebration                        |
| Confetti            | 90     | Deliberately low density                              |
| Device pixel ratio  | ≤ 2    | A 3× display does not quadruple the pixel count       |

---

## 5. Idempotency — the part that matters most

The trigger is `finale.start(gameId)` in `showPodium()`. Three separate guards:

1. **`this.key === key`** — the same game is already running: return `false`.
2. **`this.playedKey === key`** — the sequence already ran for this game, even
   though it has since finished and cleaned up: return `false`.
3. **`stop()` on every non-`end` phase** in `renderHostState`, plus `stop()` in
   `showHome()`.

Guard 2 exists because the sequence ends itself at 7 s. Without it, a reconnect at
8 s would replay the whole finale — the exact "no second playback through re-renders"
requirement. `playedKey` survives `stop()`; only a **different** game id starts a new
sequence.

The podium → outro step passes the same game id, so it does not replay.

---

## 6. Host / player separation

Three layers, all verifiable:

1. **Module boundary.** `pages/player.ts`, `playerView.ts`, `showView.ts`,
   `showScenes.ts` and `index.html` never import `finaleEffects.ts`. Enforced by a
   test that reads the source.
2. **Bundle boundary.** A production build was inspected: `finale-fireworks` and
   `finale-crowd` appear in `dist/assets/host-*.js` **only**. `index-*.js` (the player
   entry) has zero references. The same check runs in CI against `dist` when present.
3. **Runtime.** The effects are started from the host page alone. There is no socket
   event, no flag and no server change.

No new socket events were added: the existing authoritative `end` phase was enough.

---

## 7. Audio handling

- Both files were converted to OGG Vorbis (44.1 kHz, stereo, unchanged duration) with
  `libsndfile`. The originals were **not** trimmed, normalised or otherwise altered.
- Effects volume is a separate constant (`SFX_VOLUME = 0.6`), independent of the music
  level, so muting the music does not silence the finale.
- Autoplay refusal is caught and ignored: a browser that blocks the sound must never
  break the podium. The host has clicked to reach the end screen, so a refusal is rare.
- `stop()` pauses **and rewinds** both effects; `dispose()` also drops the `src`.
- The music rule is untouched. It still stops at the `end` phase, exactly as Phase
  6.11 defines. The finale adds its own two sounds and never re-cues the bed.

### Assets added

| Path                                                      | Source                       | sha256 (public = dist)                                             |
| --------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------ |
| `packages/frontend/public/audio/sfx/finale-fireworks.ogg` | `sfxmint-fireworks-02.wav`   | `133903aec35c88667c925b0f5325f54cb6068f3834c38e3e6e12704b7391dae5` |
| `packages/frontend/public/audio/sfx/finale-crowd.ogg`     | `sfxmint-crowd-chant-15.wav` | `aaf3737848b51d594bdd6f80f1ae2c5f88179989360ee202084982119c6bc929` |

The two source `.wav` files were left in the repository root untouched and were
**not** committed (they are the owner's drops; the OGG conversions are what ships).

---

## 8. Reduced motion

`prefers-reduced-motion: reduce` (and the stored calm preference) takes a separate
path: **no canvas is created at all**, but the fireworks sound still plays and the
applause is queued on a timer at 2100 ms. The win is still marked; nothing moves.
Leaving the show before the timer fires cancels it.

---

## 9. Cleanup

`stop()` cancels the frame, drops the canvas, clears the particle array and pauses and
rewinds both audio elements. It runs on: the 7 s end, any non-`end` phase, and going
home. A test asserts that no `canvas.finale` remains after each of those paths.

---

## 10. Tests

New file `finaleEffects.test.ts` (17 tests) and five integration tests in
`hostPage.test.ts`, plus six guards in `design-system.test.ts`.

| #   | Requirement                                | Covered by                                                          |
| --- | ------------------------------------------ | ------------------------------------------------------------------- |
| 1   | Podium appears → rocket starts immediately | `mounts the canvas and plays the fireworks the moment it starts`    |
| 2   | Explosion at exactly 1.5 s                 | `only fires the explosion from exactly 1.5 s` (1499 vs 1500)        |
| 3   | Applause only after the fireworks climax   | `starts the applause only after the explosion`                      |
| 4   | Sounds and animation fire once             | `triggers only once per game`                                       |
| 5   | A repaint adds nothing                     | `does not replay the finale when the podium is repainted`           |
| 6   | A reconnect adds nothing                   | `does not replay after the sequence has finished (reconnect case)`  |
| 7   | Leaving stops sound and animation          | `stops the sounds and removes the canvas when the show is left`     |
| 8   | Players load nothing and animate nothing   | `design-system.test.ts` → finale guards (source + `dist` bundles)   |
| 9   | Winner names and placements stay readable  | `keeps the winner names and placements readable above the canvas`   |
| 10  | Music and audio control unaffected         | `leaves the music rule untouched and plays only the finale effects` |

### Negative probe

Replacing the trigger with a wrong constant (`EXPLOSION_MS = 800`) made **2 tests
fail**; restoring it made them pass. The timing assertions genuinely bite.

### Results

| Check                  | Result                                     |
| ---------------------- | ------------------------------------------ |
| `npm run typecheck`    | 0 errors (shared, backend, frontend)       |
| `npm run format:check` | clean                                      |
| Frontend tests         | **646 passed** (was 616; +30)              |
| Backend tests          | **98 passed** (343 skipped, no DB here)    |
| Shared tests           | **199 passed**                             |
| `npm run build`        | success                                    |
| Bundle isolation       | effects only in `host-*.js`; player 0 hits |
| Audio in `dist`        | byte-identical to `public/`                |

---

## 11. Files

**Added**

- `packages/frontend/src/finaleEffects.ts` — the timeline, canvas and audio.
- `packages/frontend/src/finaleEffects.test.ts` — 17 tests.
- `packages/frontend/public/audio/sfx/finale-fireworks.ogg`
- `packages/frontend/public/audio/sfx/finale-crowd.ogg`
- `docs/reports/phase-6-11-2-finale-effects.md` (this file)

**Changed**

- `packages/frontend/src/pages/host.ts` — import, `finale` instance, `start()` in
  `showPodium()`, `stop()` on leaving.
- `packages/frontend/src/styles/tokens.css` — `.finale` canvas layer and the board's
  stacking context.
- `packages/frontend/src/hostPage.test.ts` — canvas stub + 5 integration tests.
- `packages/frontend/src/design-system.test.ts` — 6 isolation guards.
- `docs/phases.md`, `docs/roadmap/technical-roadmap.md`, `docs/assets/ASSET-BRIEFING.md`.

---

## 12. Open points for the owner

1. **The 1.5 s vs 1.42 s burst** (section 3). Confirm the 1.5 s is the intended beat;
   otherwise it is a one-constant change.
2. **Music at the podium.** The music stops when the game ends (Phase 6.11). If the
   finale should play _over_ a music bed, that is a change to the 6.11 rule and needs
   its own decision — I did not make it.
3. **Remaining audio assets.** Blocks F and G of the asset briefing are still
   incomplete; this phase delivered only the two finale effects.
4. **No visual check was performed** (DOM assertions only, per the standing rule).
   The particle look and the perceived sync deserve one look on a real projector.
