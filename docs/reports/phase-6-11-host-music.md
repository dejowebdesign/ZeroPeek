# Phase 6.11 – Host background music

- **Branches:** `feat/phase-6-11-host-music` (initial, PR #57) and
  `feat/phase-6-11-continuous-music` (this adjustment, based on the first).
- **Scope:** play the **one** track the project owner supplied as the bed of the **whole running
  game** — from the first question through every reveal, leaderboard and inter-round pause until the
  game ends — under host control (mute + volume), **never** on a player device. No schema change, no
  migration, no new dependency, no change to any scoring value, question, answer, account or
  permission.
- **Status:** work complete on the branch, **awaiting owner approval** — no push, no pull request,
  no merge, no deploy.

## 0. Result in one sentence

The supplied track plays continuously on the host/beamer page for the entire running game, from the
first question through answer reveal, leaderboard and inter-round transitions, and stops only when
the game actually ends. The host can mute it and set its volume, the setting survives a repaint and
a reload, and the player page never loads it.

## 1. Rules this phase had to respect

| Rule (briefing)                 | How it is met                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| §29–31: no substitute audio     | The **owner-supplied** file is used as delivered, byte-identical. Nothing is generated or downloaded. |
| §33/§34: separate music control | Mute and volume are separate controls; the level is kept while muted.                                 |
| §34: autoplay limits            | Playback is only ever started by a host interaction or a host-driven phase change, never on a timer.  |
| §34: no overlapping effects     | One module-level player: a phase change can never stack a second instance.                            |
| §4: preserve existing behaviour | Every change is additive. No existing CSS rule, handler or render path was rewritten.                 |
| §43: no client-side authority   | The mix is host-local and sends **no** command; it cannot affect score, phase or any other client.    |
| §44: performance                | One decoded stream, no per-frame work, no animation. The file is served as a static asset.            |

## 2. The supplied file

| Field      | Value                                                              |
| ---------- | ------------------------------------------------------------------ |
| Source     | `mastered_vorbis_96.ogg`, supplied by the project owner            |
| Target     | `packages/frontend/public/audio/music/question-background.ogg`     |
| Bytes      | 1 740 831                                                          |
| Format     | Ogg Vorbis                                                         |
| SHA-256    | `228fd35d62a6885f89ca4cc86ef23fd888f7f6b431f5ffaf0ea4ea84f7a3f585` |
| Processing | **none** — copied, not re-encoded, not trimmed, not normalised     |

The target folder follows the asset briefing (§Block G), which already reserves
`packages/frontend/public/audio/music/` for music. The build output was compared against the source
and is **byte-identical**, so no build step alters the file.

The briefing lists four tracks (`music-lobby`, `music-question`, `music-final`, `music-victory`).
**One** was supplied, so **one** is wired up. Lobby, final and victory music stay open (see §7).

## 3. Phase rule

The track is the **round's bed**, not a question cue. It starts with the first question and runs
unbroken until the game actually ends.

| Phase      | Decision             | Why                                                           |
| ---------- | -------------------- | ------------------------------------------------------------- |
| `lobby`    | silent               | Players are still joining; the show has not begun.            |
| `lead`     | silent               | The pre-game countdown. A countdown never _starts_ the track. |
| `question` | play                 | The first question begins the bed.                            |
| `reveal`   | continue             | The answer resolves over the same bed — no pause, no restart. |
| `board`    | continue             | The leaderboard beat runs on the same bed.                    |
| `lead`     | continue, if running | An inter-round countdown belongs to the running round.        |
| `end`      | stop and rewind      | The game is over.                                             |
| `null`     | stop and rewind      | No game on screen (home / picker).                            |

### How `lead` is disambiguated without guessing

`lead` is the only ambiguous phase: it runs before the first question _and_ — should the server ever
introduce one — between rounds. The module never counts questions and never keeps its own game
history. The decision is made from two server-authoritative facts:

1. **`question`, `reveal` and `board` only exist after a question was opened.** A reveal resolves a
   question, a board ranks one, so any of them proves the round is under way. A host that reloads
   straight onto the leaderboard resumes the music at exactly the right moment.
2. **`lead` never starts the track; it only lets a running track continue.** Before the first
   question nothing is running, so the pre-game countdown is silent. During a running round the bed
   is already up, so an inter-round countdown keeps it going.

The module's own `playing` flag is the latch, and it is only ever written from the server phase — so
no local assumption about the game's progress is involved.

### No re-cueing between phases

`sync` compares the intended state with the current one and returns early when they agree. Moving
`question → reveal → board → lead → question` therefore issues **no** `play()` and **no** `pause()`
call at all: one `play()` per round, and a single `pause()` only when the game ends.

> **Note on the current server:** `enterLead()` is called only from `start()`, and `next()` goes
> `board → question` directly. A `lead` between questions therefore does not exist today. The rule
> above already handles it correctly should it be introduced — the tests cover it explicitly.

## 4. Host control

A compact bar (`.music`) sits in the flow of every live host screen — lobby, lead, question,
reveal, board and end — right after the existing AUTO toggle. It is **in-flow, not an overlay**, so
it can never cover a question, an answer or a countdown.

| Control | Behaviour                                                                     |
| ------- | ----------------------------------------------------------------------------- |
| Mute    | Toggles the mute flag. The slider keeps its position, so unmute restores it.  |
| Volume  | Range input, 0–100 %, applied live. Junk input is clamped, never trusted raw. |
| Level   | Read-out of the effective level, e.g. `50%`.                                  |

Both controls carry stable hooks (`[data-music-mute]`, `[data-music-volume]`) so the tests drive the
real page rather than a copy of it.

## 5. Persistence

The setting is stored under `zeropeek.host.music` in `localStorage`, best-effort:

- unreadable, malformed or out-of-range stored data falls back to the default (50 %, unmuted);
- a storage that throws (private mode, quota) is caught, so a broken store never breaks the show;
- an explicit `null` storage means "no storage at all", which is what the unit tests use.

## 6. Host and player stay separate

The track is a **show** feature. It must not cost a participant any data or battery, so the
separation is structural, not a runtime `if`:

- `pages/host.ts` is the only module that imports `hostMusic.ts`;
- `pages/player.ts`, `playerView.ts` and `index.html` contain neither the module name nor the
  `/audio/` path;
- in the built bundle the track path appears **only** in the host chunk
  (`dist/assets/host-*.js`), and the player entry chunk has **zero** audio references.

Three tests in `design-system.test.ts` enforce this, and the guard was verified by temporarily
adding an import to `player.ts`: the test failed, as intended.

## 7. What is deliberately **not** in this phase

| Not done                      | Reason                                                                  |
| ----------------------------- | ----------------------------------------------------------------------- |
| Lobby / final / victory music | Not supplied. Nothing is substituted.                                   |
| Sound effects (Block F)       | Not supplied; they are the other half of Phase 6.11.                    |
| Player-side audio             | Out of scope by design: the track is host-only.                         |
| Cross-device volume sync      | The mix is per device by intent; a host does not dictate player volume. |
| Fade-in / fade-out            | Not requested; would add per-frame work for no functional gain.         |

## 8. Verification

| Check                       | Result                                                          |
| --------------------------- | --------------------------------------------------------------- |
| `npm run typecheck`         | clean (shared, backend, frontend)                               |
| `prettier --check .`        | clean                                                           |
| Frontend tests              | **616 passed** (552 before 6.11; 607 after the first cut)       |
| Backend tests               | **98 passed**, 19 files skipped (no database in this sandbox)   |
| Shared tests                | **199 passed**                                                  |
| `npm run build`             | succeeded; audio file in `dist/audio/music/`, SHA-256 identical |
| Bundle isolation            | track path only in `host-*.js`; player entry has 0 references   |
| `docker/Caddyfile.frontend` | unchanged and still valid (see §9)                              |

`hostMusic.test.ts` (47 tests) covers the phase rules, the `lead` disambiguation, a full-round run
with no extra `play()`/`pause()`, volume clamping and junk input, mute as a flag, the storage
round-trip and malformed stored data, and the DOM/class contract.
`hostPage.test.ts` (+6 tests) drives the **real** host page and covers: the bar is absent on the
picker, present in lobby/lead/question, the slider follows input, mute keeps the level, the level
survives a phase change, and a mix change sends **no** socket command.

## 9. Content type for `.ogg` (investigated, no change needed)

`.ogg` is not in Go's built-in MIME table, so it was worth checking whether the frontend image would
serve the track with a usable `Content-Type`. It does:

- Caddy 2.8.4 was downloaded and used to serve the actual file from a throwaway directory on a
  spare port; the response was `Content-Type: audio/ogg` with the correct `Content-Length`;
- `strings caddy` contains `audio/ogg`, so the type comes from Caddy's built-in table and does **not**
  depend on `/etc/mime.types` being present in the image.

A `mime { … }` block was tried first and **rejected**: `caddy validate` reports
`unrecognized directive: mime` on 2.8.4. The Caddyfile was therefore left untouched — the change was
reverted and the file re-validated as `Valid configuration`. No Caddyfile edit is part of this
branch.

## 10. Files

| File                                                           | Change                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------- |
| `packages/frontend/public/audio/music/question-background.ogg` | new — supplied track, byte-identical                    |
| `packages/frontend/src/hostMusic.ts`                           | new — phase rules, volume maths, persistence            |
| `packages/frontend/src/hostMusic.test.ts`                      | new — 47 unit tests                                     |
| `packages/frontend/src/pages/host.ts`                          | +137 lines, additive only (instance, bar, sync)         |
| `packages/frontend/src/styles/tokens.css`                      | +71 lines, additive only (`.music*` on existing tokens) |
| `packages/frontend/src/hostPage.test.ts`                       | +117 lines (DOM tests for the real page)                |
| `packages/frontend/src/design-system.test.ts`                  | +34 lines (class coverage + player-isolation guard)     |

`git diff --numstat` for `host.ts` and `tokens.css` shows **0 deletions**. On the continuous-music
branch the only source changes are inside `hostMusic.ts` and its two test files — `host.ts` and
`tokens.css` are untouched, because the page already passes the phase to `sync()`.

## 11. Open points for the owner

1. **Remaining audio assets.** Blocks F and G of the asset briefing are still missing. The supplied
   track now covers the whole running round. Lobby, final and victory music plus the sound effects
   would complete Phase 6.11.
2. **Volume default.** 50 % is a conservative choice; say the word if a different default is wanted.
3. **Should the bed also run in the lobby?** Still no — the owner confirmed that no lobby music is
   wanted, and reusing the round bed there would weaken the question moment.
