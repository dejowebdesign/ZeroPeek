# Documentation audit after Phase 6.9.5

- **Branch:** `docs/update-phase-status-after-6-9-5` (from `origin/main` = `18e271f`)
- **Scope:** documentation only. No application code, no schema, no API or socket contract, no
  production configuration, no assets.
- **Status:** complete on the branch — draft pull request open, **no merge, no deploy**.

## 0. Result in one sentence

`docs/phases.md` and `docs/roadmap/technical-roadmap.md` now state the merged reality for phases
6.8.6 and 6.9.1–6.9.5 (with PR numbers and merge commits), the reports keep their historical text
plus a short merge note, and Phases 6.10 and 6.11 are explicitly marked as **planned, not started**.

## 1. Audited `main` commit

| Item         | Value                                                                         |
| ------------ | ----------------------------------------------------------------------------- |
| Branch       | `main`                                                                        |
| Commit       | `18e271fa8849eb949a3da055015f8b2e504588d1` (`18e271f`)                        |
| Commit title | `Merge pull request #52 from dejowebdesign/fix/host-next-and-answer-deadline` |
| Audit branch | `docs/update-phase-status-after-6-9-5`, created from that commit              |

The prompt named `18e271f` as the expected state; it matched exactly, so no newer `main` had to be
taken into account.

## 2. Audited pull requests

Every status was read from the GitHub API (`state`, `merged`, `merge_commit_sha`, `merged_at`), not
taken from the prompt.

| PR  | Title                                                         | State  | Merged | Merge commit | Merged at            |
| --- | ------------------------------------------------------------- | ------ | ------ | ------------ | -------------------- |
| #46 | Phase 6.8.6 – CSS, Contract und Dokumentationsbereinigung     | closed | yes    | `177b63c`    | 2026-11-16T12:37:40Z |
| #47 | Phase 6.9.1 – Server show states and event contracts          | closed | yes    | `31a7783`    | 2026-11-16T18:03:51Z |
| #48 | Phase 6.9.2 – Game-Show skeleton & scene control              | closed | yes    | `9d9cde2`    | 2026-11-17T04:32:20Z |
| #49 | Phase 6.9.2 – show flow fixes (auto scene flow, progression)  | closed | yes    | `e3bf47d`    | 2026-11-17T17:50:37Z |
| #50 | Phase 6.9.3 – host-controlled AUTO gameplay                   | closed | yes    | `30e286e`    | 2026-11-18T06:34:58Z |
| #51 | Host Next / Skip confirmation fix                             | closed | yes    | `0d9b8f9`    | 2026-11-18T12:08:53Z |
| #52 | Phase 6.9.5 – answer acceptance aligned with visible deadline | closed | yes    | `18e271f`    | 2026-11-18T20:44:14Z |

`git merge-base --is-ancestor` confirmed that the merge commits of #46 and #52 are ancestors of
`origin/main`.

Note on numbering: the prompt lists PR #51 and #52 without a phase number. The existing
documentation already assigns them: #51 is **Phase 6.9.4** (row `6.9.4` in `docs/phases.md`, roadmap
§9.7) and #52 is **Phase 6.9.5** (row `6.9.5`, roadmap §9.8). No new mapping was invented.

## 3. Documentation errors found before the change

1. **`docs/phases.md`** marked six finished phases as `Awaiting review`: 6.8.6, 6.9.2, 6.9.3, 6.9.4
   and 6.9.5 (6.9.1 already said "Done" but carried no merge commit).
2. **`docs/phases.md`** described 6.9.2 as "(13 scenes, presentation mode)". Phase 6.9.3 **removed**
   the presentation mode and the scene bar, so the row advertised a feature that no longer exists.
3. **`docs/phases.md`** had no statement that Phase 6.9 as a whole is finished, and no statement that
   6.10/6.11 are still open.
4. **`docs/roadmap/technical-roadmap.md` §10 (Phase 6.9)** had no status line at all, so a reader
   could not tell implemented work from planned work.
5. **`docs/roadmap/technical-roadmap.md` §9.5** still described the scene bar and the presentation
   mode as part of the delivered behaviour without noting that 6.9.3 removed them.
6. **`docs/roadmap/technical-roadmap.md` §9.4–§9.8** ended with only a report link — no merge status.
7. **`docs/roadmap/technical-roadmap.md` §8 (Phase 6.7)** said "Status: umgesetzt (PR nach Freigabe)",
   which reads as "a PR still to come"; #38 and #39 were merged long ago.
8. **`docs/roadmap/technical-roadmap.md` §1 dependency table** claimed the character assets were
   entirely missing; Ethan and Maya were delivered and are in use.
9. **`docs/roadmap/technical-roadmap.md` §11/§12** did not state that Phases 6.10 and 6.11 are
   unstarted, so the planned tables could be mistaken for delivered work.
10. The six completion reports each still said "awaiting owner approval / no pull request, no merge",
    which is now wrong for every one of them.

## 4. Changed files

| File                                                        | Change                                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `docs/phases.md`                                            | 6.8.6/6.9.1–6.9.5 statuses, PR + merge commits, 6.9 summary block                                              |
| `docs/roadmap/technical-roadmap.md`                         | §1 dependency row, §8 status, §9.4–§9.8 status lines, §9.5 supersede note, §10 status, §11/§12 planned markers |
| `docs/reports/phase-6-8-6-css-contract-docs.md`             | appended status note (PR #46)                                                                                  |
| `docs/reports/phase-6-9-1-server-show-state.md`             | appended status note (PR #47)                                                                                  |
| `docs/reports/phase-6-9-2-game-show-skeleton.md`            | appended status note (PR #48)                                                                                  |
| `docs/reports/phase-6-9-3-host-auto-control.md`             | appended status note (PR #50)                                                                                  |
| `docs/reports/host-next-and-confirmation-fix.md`            | appended status note (PR #51)                                                                                  |
| `docs/reports/phase-6-9-5-answer-deadline-and-host-next.md` | appended status note (PR #52)                                                                                  |
| `docs/reports/documentation-audit-after-phase-6-9-5.md`     | this report (new)                                                                                              |

The reports keep their original text. Only a short, clearly marked blockquote was appended, naming
the PR and the merge commit. Nothing was deleted and no historical statement was rewritten.

## 5. Corrected phase statuses

| Phase | Was                                  | Now                                                                                   |
| ----- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| 6.8.6 | Awaiting review                      | Done (merged, PR #46, merge `177b63c`)                                                |
| 6.9.1 | Done, no merge commit                | Done (merged, PR #47, merge `31a7783`)                                                |
| 6.9.2 | Awaiting review, "presentation mode" | Done (merged, PR #48 `9d9cde2`; flow fixes PR #49 `e3bf47d`), single host/beamer view |
| 6.9.3 | Awaiting review                      | Done (merged, PR #50, merge `30e286e`)                                                |
| 6.9.4 | Awaiting review                      | Done (merged, PR #51, merge `0d9b8f9`)                                                |
| 6.9.5 | Awaiting review                      | Done (merged, PR #52, merge `18e271f`)                                                |
| 6.7   | "PR nach Freigabe"                   | umgesetzt und gemergt (PR #38 `887efc1`, PR #39 `befe52d`)                            |
| 6.10  | (no status)                          | geplant – nicht begonnen                                                              |
| 6.11  | (no status)                          | geplant – nicht begonnen                                                              |

## 6. Confirmed completed functionality

Each point was verified in the code at `18e271f`, not inferred from a report.

| Claim                                                               | Evidence in the code                                                                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| One host/beamer view, no separate presentation mode                 | `showScenes.ts` has 13 scenes; `design-system.test.ts:390` asserts no `.show__scene-bar` / presentation chrome remain   |
| AUTO optional, default **off**                                      | `engine.ts` initialises `auto: false` (lines 305, 354)                                                                  |
| AUTO off ⇒ host resolves and advances                               | `armQuestionClock` and `armBoardAdvance` both `if (!game.auto) return` (1427, 1459)                                     |
| AUTO on ⇒ server resolves and advances                              | same two helpers; `submitAnswer` early-resolves only when `game.auto` (1117)                                            |
| Fixed reveal window 4 s                                             | `REVEAL_MS = 4000` (134); `armRevealWindow` is armed in both modes                                                      |
| Leaderboard advance 5 s                                             | `BOARD_MS = 5000` (135); armed only in the `board` phase                                                                |
| Answer clock independent of AUTO                                    | the clock is `openedAt + limitMs()`; AUTO gates the timer only                                                          |
| One timer slot, phase-guarded                                       | `clearTimer()` before every arm; `armBoardAdvance` returns unless `phase === 'board'`                                   |
| Recovery after restart                                              | `recoverCurrentQuestion()` (392) re-arms from persisted timestamps                                                      |
| `Next` only when a further question exists                          | `hasNextQuestion()` (554) → `board` event and `HostState`; `hostActions()` omits `next` when false                      |
| No misleading Next on the last leaderboard                          | same gating; `host:board` carries `hasNext`                                                                             |
| Skip and End require confirmation; opening the dialog sends nothing | `hostButton()` uses `confirm` so the dialog is the button's **only** click action; the command is sent from `onConfirm` |
| Visible clock equals the enforced deadline                          | `limitMs()` = `timeLimit * 1000`; guard `elapsedMs >= limitMs()` (1056)                                                 |
| No hidden 1.5 s grace                                               | `ANSWER_GRACE_MS` no longer exists in `engine.ts`                                                                       |
| Late answers refused server-side                                    | the `>=` guard throws `conflict('Too late – the question is closed.')`                                                  |
| Player surface closes its answer control at the deadline            | `answerDeadlineRemainingMs()` (`playerView.ts:53`) + `questionTimer` (`pages/player.ts:145`)                            |
| Scoring unchanged                                                   | `shared/scoring.ts` uses `elapsedMs` vs `question.timeLimit`, never `limitMs()`                                         |

## 7. Roadmap points still open

- **Phase 6.10 – background images:** not started. Needs the owner's image files, the format/size
  check, the per-round random pick fixed before the game starts, and the same background on host and
  players. No stock images, no AI substitutes, no placeholders as a final solution.
- **Phase 6.11 – sound and music:** not started. Needs the owner's audio files and the existing asset
  briefing. No invented, imported or swapped tracks.
- **Phase 6.12 – extensions:** planned. Statistics, global leaderboards, further modes — still gated
  on the open decisions (modes, Redis, aggregation).
- **Avatar layers:** the delivered Ethan/Maya images are not aligned on a shared canvas, so the
  catalogue keeps `alignment: 'not_aligned'` and shows items as separate thumbnails. Real stacking
  waits for aligned layers. `pixel`, `bee`, `dr-obscura` and `o-bot` remain `awaiting_assets`.
- **Open decision #5 (Redis adapter vs. a single instance)** still blocks 6.12 and operations.
- **Open decision #10 (IP storage)** remains open; no IP is stored today.

## 8. Missing prerequisites for 6.10 and 6.11

| Phase | Prerequisite                                                                  | State                                |
| ----- | ----------------------------------------------------------------------------- | ------------------------------------ |
| 6.10  | Owner-supplied background images (dark, futuristic, wireframe, cyan/violet)   | missing                              |
| 6.10  | Confirmed per-round selection rule (random once per round, all clients equal) | decided in Phase 5c, not implemented |
| 6.11  | Owner-supplied audio assets (UI, game, music)                                 | missing                              |
| 6.11  | Confirmed audio briefing (separate buses, host-only show audio)               | decided in Phase 5c, not implemented |

Neither phase may begin before the assets arrive and the owner approves. This audit did **not**
start either phase.

## 9. Documentation checks run

| Check                                         | Command                                     | Result                          |
| --------------------------------------------- | ------------------------------------------- | ------------------------------- |
| Markdown formatting                           | `npx prettier --check` on all touched files | pass                            |
| Repository-wide format                        | `npm run format:check`                      | pass                            |
| Only documentation touched                    | `git status --porcelain`                    | 8 modified + 1 new, all `docs/` |
| No code, schema, API, socket or config change | `git diff --stat`                           | no `packages/**` entries        |
| Report links exist                            | manual check of every referenced path       | all present                     |
| PR references match the GitHub API            | table in §2                                 | all match                       |
| Merge commits are ancestors of `origin/main`  | `git merge-base --is-ancestor`              | confirmed for #46 and #52       |

No application tests were run, because no application file changed.

## 10. Commit and branch

- **Branch:** `docs/update-phase-status-after-6-9-5` (from `origin/main` = `18e271f`)
- **Commit:** `docs: synchronize phase status after 6.9.5`
- **Pull request:** draft against `main`; documentation only.

No merge, no deployment, no change to any production system.
