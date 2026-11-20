# Phase 6.11 – Host background music

- **Branch:** `feat/phase-6-11-host-music` (from `origin/main` = `b85dab5`)
- **Scope:** play the **one** track the project owner supplied during the regular question phases,
  under host control (mute + volume), **never** on a player device. No schema change, no migration,
  no new dependency, no change to any scoring value, question, answer, account or permission.
- **Status:** work complete on the branch, **awaiting owner approval** — no push, no pull request,
  no merge, no deploy.

## 0. Result in one sentence

The supplied track plays on the host/beamer page during `question` only, the host can mute it and
set its volume, the setting survives a repaint and a reload, and the player page never loads it.

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
**One** was supplied, so **one** is wired up, and it plays in the phase it was supplied for: the
regular question phase. Lobby, final and victory music stay open (see §7).

## 3. Phase rule

`HostMusic` maps a phase to one of three decisions, and nothing else:

| Phase      | Decision | Why                                                     |
| ---------- | -------- | ------------------------------------------------------- |
| `question` | play     | The phase the supplied track was made for.              |
| `lead`     | pause    | The read-aloud lead-in stays quiet before the question. |
| `reveal`   | pause    | The answer is being resolved; the track would fight it. |
| `board`    | pause    | Leaderboard beat, no bed.                               |
| `end`      | pause    | Show is over.                                           |
| `lobby`    | pause    | Players are still joining.                              |
| `null`     | stop     | No game on screen (home / picker).                      |

Pausing rather than stopping keeps the stream buffered, so moving from one question to the next
does not re-download the file.

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
| Frontend tests              | **607 passed** (was 552 before this phase)                      |
| Backend tests               | **98 passed**, 19 files skipped (no database in this sandbox)   |
| Shared tests                | **199 passed**                                                  |
| `npm run build`             | succeeded; audio file in `dist/audio/music/`, SHA-256 identical |
| Bundle isolation            | track path only in `host-*.js`; player entry has 0 references   |
| `docker/Caddyfile.frontend` | unchanged and still valid (see §9)                              |

`hostMusic.test.ts` (39 tests) covers the phase rules, volume clamping and junk input, mute as a
flag, the storage round-trip and malformed stored data, and the DOM/class contract.
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
| `packages/frontend/src/hostMusic.test.ts`                      | new — 39 unit tests                                     |
| `packages/frontend/src/pages/host.ts`                          | +137 lines, additive only (instance, bar, sync)         |
| `packages/frontend/src/styles/tokens.css`                      | +71 lines, additive only (`.music*` on existing tokens) |
| `packages/frontend/src/hostPage.test.ts`                       | +117 lines (DOM tests for the real page)                |
| `packages/frontend/src/design-system.test.ts`                  | +34 lines (class coverage + player-isolation guard)     |

`git diff --numstat` for `host.ts`, `tokens.css` and `hostPage.test.ts` shows **0 deletions**.

## 11. Open points for the owner

1. **Remaining audio assets.** Blocks F and G of the asset briefing are still missing. The supplied
   track covers the question bed only. Lobby, final and victory music plus the sound effects would
   complete Phase 6.11.
2. **Volume default.** 50 % is a conservative choice; say the word if a different default is wanted.
3. **Should the bed also run in the lobby?** Currently not, because no lobby track was supplied and
   reusing the question track there would weaken the question moment.
