# Phase 6.10 – Background library

- **Branch:** `feat/phase-6-10-background-library` (from `main` = `84275c0`)
- **Scope:** integrate the **ten background images** the project owner supplied in
  `ZeroPeek_Background.zip`, and implement the round's **server-authoritative background choice**.
  No schema change, no migration, no new dependency, no change to any scoring value, question,
  answer, account or permission.
- **Status:** work complete on the branch, **awaiting owner approval** — no push, no pull request,
  no merge, no deploy.

## 0. Result in one sentence

All ten supplied WebP files are integrated **byte-identically** and served from the frontend build;
the round's background is chosen **once**, **stored by the server** and broadcast to host, beamer
and every player, so all clients show the same image and a reconnect or a restart restores it.

## 1. Rules this phase had to respect

| Rule (briefing)                     | How it is met                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| §29–31: no AI/stock/placeholder art | The ten supplied files are used as delivered. Nothing is generated, and no fallback image is added. |
| §29–31: no image analysis           | Ids, names and paths are derived from the **filenames** only. No pixel data, no OCR, no vision.     |
| §31: wait for missing assets        | Nothing is missing: all ten files were supplied and every one is wired up.                          |
| §20/§43: no client-side authority   | The background id is stored and broadcast by the engine. A client cannot invent one.                |
| §22/§42: no contradictory state     | Host, players and beamer read the same server value from the same event and the same snapshot.      |
| §4: preserve existing behaviour     | The layer is additive CSS. No existing quiz, glass or card rule was re-declared or changed.         |

## 2. The supplied files

Ten files, extracted with Python's `zipfile` (`unzip` is not installed here) and verified
**byte-identical** to the archive by SHA-256. No file was renamed, resized, cropped, re-encoded or
re-compressed.

| File                                              | Bytes   | Format      |
| ------------------------------------------------- | ------- | ----------- |
| `zeropeek_palmen_tron_background.webp`            | 91 940  | RIFF / WEBP |
| `zeropeek_synthwave_bruecke_zwei_berge.webp`      | 115 468 | RIFF / WEBP |
| `zeropeek_synthwave_forschungsstation_muted.webp` | 114 124 | RIFF / WEBP |
| `zeropeek_synthwave_lagerhalle_minimal.webp`      | 108 582 | RIFF / WEBP |
| `zeropeek_synthwave_megacity_detail.webp`         | 144 060 | RIFF / WEBP |
| `zeropeek_synthwave_raumstation_ohne_boden.webp`  | 153 086 | RIFF / WEBP |
| `zeropeek_synthwave_skyline.webp`                 | 101 018 | RIFF / WEBP |
| `zeropeek_synthwave_unterwasser_v3.webp`          | 136 522 | RIFF / WEBP |
| `zeropeek_synthwave_weltraum.webp`                | 117 446 | RIFF / WEBP |
| `zeropeek_synthwave_wueste.webp`                  | 106 798 | RIFF / WEBP |

They live in `packages/frontend/public/backgrounds/`, which Vite copies verbatim into
`packages/frontend/dist/backgrounds/`; the frontend image serves that directory, so every file is
reachable at `/backgrounds/<name>.webp`. `backgrounds.test.ts` asserts the files exist and start
with a RIFF/WEBP header; the build was verified to contain all ten.

## 3. The catalogue (`packages/shared/src/backgrounds.ts`)

One module, shared by backend and frontend, is the single source of truth — the same pattern the
character catalogue already uses. It holds no pixel knowledge:

- `id` — the filename stem without the `zeropeek_` prefix and `.webp` suffix
  (`synthwave_skyline`);
- `name` — a readable rendering of that same stem, with the qualifier kept where the filename has
  one (`Synthwave – Forschungsstation (gedämpft)`), so the host can tell similar motifs apart
  without seeing them;
- `file` — the supplied filename, shown in the picker for traceability;
- `path` — `/backgrounds/<file>`.

Helpers: `findBackground(id)`, `backgroundPath(id)`, `backgroundName(id)`,
`resolveBackgroundChoice(choice)`, `pickRandomBackground()`, plus `RANDOM_BACKGROUND`
(`'random'`) and `DEFAULT_BACKGROUND_ID` (the first supplied file).

`resolveBackgroundChoice` is the security boundary: it returns a **concrete** catalogue id or
`undefined`, so a hand-made value can never be stored. An unknown id **read** from elsewhere falls
back to the default, so a broken value shows the default image instead of nothing.

## 4. Server authority

`RuntimeGame` gained one field, `background: string`.

- **Chosen once, at creation.** `engine.create` picks a random catalogue entry and immediately
  appends a `background` `GameEvent`. A join, a start, a question change or a render never
  re-rolls it, which is the briefing's binding rule (_"Standard Zufall einmalig je Runde"_).
- **Changed only by the host.** `engine.setBackground(gameId, choice)` runs under the existing
  `withPhaseLock`, validates the choice, and treats an unchanged value as a **no-op** — so a
  double click cannot swap the image under a running show and a `random` request cannot re-roll
  twice.
- **Persisted, not just in memory.** The `background` event is written to the event log, and
  `load()` restores the last valid `background` event, falling back to the default for a missing or
  unknown id. A restart therefore keeps the image the round was using.
- **Broadcast to everyone.** `engine.on('background')` → `host:background` to the host room and
  `game:background` to the player room. Both namespaces, one value.
- **Carried by every snapshot.** `HostState.background` and `PlayerSync.background` are filled from
  the runtime, so a reconnect (or the beamer, which reads the same host state) restores the image
  without waiting for an event.
- **Authorisation.** The command goes through the same `assertHost(gameId)` as every other host
  command; a signed-in host who does not own the game is refused.

No schema change and no migration: the choice lives in the existing `GameEvent` log.

## 5. Frontend

- `background.ts` owns the layer. It creates **one** inert `<div data-round-background>` as the
  first child of `<body>` and thereafter only rewrites its `--round-background` custom property, so
  a change never re-creates the DOM. `clearRoundBackground()` removes it when a surface leaves the
  show, so a previous game's image cannot linger.
- `styles/backdrop.css` gains the layer rules only: `cover`/`center` (no distortion, no re-encode),
  `pointer-events: none`, behind the content, with a **dark scrim** gradient over the image so quiz
  text and answer buttons keep their contrast on any motif. A phone dims further and drops the
  transition; `prefers-reduced-transparency: reduce` dims further still.
- Host page: a lobby-only **picker** listing every supplied background by display name and
  filename, plus a `Random` button, with the active row flagged from the server value. A click
  sends the id and the broadcast repaints — the picker never decides locally.
- Player page: `renderSync` paints `sync.background` on every snapshot and `game:background`
  repaints on the live event, so a reconnect and a live change end in the same image.
- The beamer is the host view (there is no separate surface), so it inherits the same layer and the
  same server value.

## 6. Verification

| Check                    | Result                                                                 |
| ------------------------ | ---------------------------------------------------------------------- |
| Shared tests             | **199 passed** (incl. 20 background-catalogue tests)                   |
| Backend tests            | **441 passed** (incl. 10 new background-sync integration tests)        |
| Frontend tests           | **552 passed** (incl. 10 layer, 7 picker, 7 host-page, 5 CSS-contract) |
| Typecheck (all packages) | clean                                                                  |
| Lint                     | clean                                                                  |
| `prettier --check .`     | clean                                                                  |
| Build                    | clean; `dist/backgrounds/` contains all ten WebP files                 |
| Assets byte-identical    | SHA-256 verified against the supplied archive                          |

Two defects were found **by the new tests** during this phase and fixed:

- the `host:background` listener was never registered in `attachHostHandlers`, so the live
  broadcast would not have reached the host page — only the command ACK worked;
- the picker was hidden on a reconnect, because a reload arrives as a `sync` snapshot rather
  than a `lobby` event. It now matches on the derived screen instead of the render kind.

The integration tests run against a real database and real Socket.IO. They prove: a new game starts
on a catalogue background; every supplied id is selectable; `random` resolves to exactly one
concrete id and then stays fixed; host, two players and both snapshots agree; a reconnecting host
and a reconnecting player are restored; the choice survives `engine.evict` (the restart path); a
join, a start and a question change leave it untouched; an unknown id is rejected and nothing is
stored; and a non-owning host is refused.

## 7. Deliberate non-goals

- **No separate beamer surface.** Phase 6.9.3 removed it deliberately; this phase reuses the host
  view instead of reintroducing one.
- **No per-question or per-join background.** The concept forbids it, and the tests pin it.
- **No login background.** The brief reserves the login surface for the starfield (Phase 6.3); no
  supplied file was assigned to it here.
- **No new dependency, no migration, no deploy.**

## 8. Open point for the owner

The catalogue assigns **no** image to a specific screen (lobby, final, podium). The brief lists
such motifs as desirable, but choosing which of the ten belongs to which scene is a product
decision. Until it is taken, one background covers the whole round, which is what the binding rule
in Phase 5c already required.
