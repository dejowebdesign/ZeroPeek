# Development Phases

ZeroPeek is built strictly phase by phase. Each phase ends with a report and a pull request, and
work pauses for explicit approval before the next phase begins.

| Phase | Scope              | Deliverable                                                                  |
| ----- | ------------------ | ---------------------------------------------------------------------------- |
| 0     | Project foundation | Repo structure, architecture docs, TypeScript config, Docker, CI, test setup |
| 1     | Quiz domain        | Shared model for all 13 question types, validation, unit tests               |
| 2     | Backend & database | Fastify app, Prisma schema, PostgreSQL, sessions, error handling             |
| 3     | Quiz editor        | CRUD, question editor, drag-and-drop, preview, import/export                 |
| 4     | Socket.IO & lobby  | Namespaces, PIN system, lobby, reconnect, event documentation                |
| 5     | Game engine        | Server-authoritative state machine, scoring, ranking, anti-cheat             |
| 6     | Frontend           | Player, combined host/beamer surface, design system, animations              |
| 7     | Users & reports    | Roles, sessions, reports, statistics, CSV/Excel export                       |
| 8     | Tests & deployment | Unit/integration/socket/E2E/load tests, security audit, production prep      |

## Concept and planning phases (current status)

The concept work runs alongside the delivery phases above and is **not** an implementation phase.
Nothing is implemented until the project owner approves it.

| Phase | Scope                                                                          | Status                                                                                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Technical inventory                                                            | Done – `docs/analysis/phase-1-technical-inventory.md`                                                                                                                                                                                                              |
| 2     | Product and design concept                                                     | Done – `docs/concept/design-concept.md`, `docs/concept/game-design-concept.md`                                                                                                                                                                                     |
| 3     | Technical roadmap                                                              | Done – `docs/roadmap/technical-roadmap.md`                                                                                                                                                                                                                         |
| 4     | Asset briefing                                                                 | Done – `docs/assets/ASSET-BRIEFING.md`                                                                                                                                                                                                                             |
| 5     | Concept report (approval)                                                      | Done – `docs/reports/phase-5-concept-report.md`                                                                                                                                                                                                                    |
| 5b    | Revision and first works                                                       | Done (merged, PR #16) – `docs/reports/phase-5b-revision-and-first-works.md`                                                                                                                                                                                        |
| 5c    | Binding product decisions                                                      | Done (PR #17) – `docs/reports/phase-5c-product-decisions.md`                                                                                                                                                                                                       |
| 6.1   | Design system                                                                  | Done (PR #18) – `docs/design/design-system.md`                                                                                                                                                                                                                     |
| 6.2.1 | Navigation and shell                                                           | Done (merged, PR #21) – `docs/design/design-system.md` §8.1                                                                                                                                                                                                        |
| 6.2.2 | Player lobby and profile placeholder                                           | Done (merged, PR #23) – `docs/roadmap/technical-roadmap.md` §3.1; analysis `docs/analysis/phase-6-2-2-player-lobby-profile.md`                                                                                                                                     |
| 6.2   | Navigation and responsive layout                                               | **Complete** (6.2.1 + 6.2.2 merged)                                                                                                                                                                                                                                |
| 6.3   | Login, registration, starfield                                                 | Done (merged, PR #25) – `docs/reports/phase-6-3-*`                                                                                                                                                                                                                 |
| 6.4   | Quiz management, editor, snapshot                                              | Done (merged, PR #26) – `docs/reports/phase-6-4-quiz-editor-snapshot.md`                                                                                                                                                                                           |
| 6.5.1 | Admin modernisation                                                            | Done (merged, PR #27) – `docs/reports/phase-6-5-1-admin.md`                                                                                                                                                                                                        |
| 6.5.2 | Host control and phase display                                                 | Done (merged, PR #30) – `docs/reports/phase-6-5-2-host-state-sync.md`; roadmap §6.1                                                                                                                                                                                |
| 6.5.3 | Extended host control (pause/skip/kick)                                        | Done (merged, PR #31) – `docs/reports/phase-6-5-3-extended-host-controls.md`; roadmap §6.2                                                                                                                                                                         |
| 6.6   | Player profiles                                                                | **Complete** – backend 6.6.1 (`docs/reports/phase-6-6-1-player-profile-backend.md`), UI 6.6.2 (`docs/reports/phase-6-6-2-player-profile-ui.md`), host/player identity separation 6.6.3 (`docs/reports/phase-6-6-3-host-player-identity-separation.md`); roadmap §7 |
| 6.7   | Blockwelt character and avatar system                                          | Done (merged, PR #38/#39) – `docs/reports/phase-6-7-character-avatar-system.md`; roadmap §8                                                                                                                                                                        |
| 6.8   | Player progression (XP, levels, achievements, inventory, guest-round claim)    | Done (merged, PR #41) – `docs/reports/phase-6-8-player-progression.md`; roadmap §9                                                                                                                                                                                 |
| 6.8.3 | Player surface fixes                                                           | Done (merged, PR #43) – `docs/reports/phase-6-8-3-player-surface-fixes.md`                                                                                                                                                                                         |
| 6.8.4 | Progression curve, reward matrix, inventory management, in-game presentation   | Done (merged, PR #44) – `docs/reports/phase-6-8-4-progression-inventory-podium.md`; roadmap §9.1; concept §5.4/§6.2b/§6.6                                                                                                                                          |
| 6.8.5 | Clock synchronisation and socket rate limiting                                 | Done (merged, PR #45) – `docs/reports/phase-6-8-5-clock-sync-and-socket-rate-limit.md`; roadmap §9.3                                                                                                                                                               |
| 6.8.6 | CSS, contract and documentation cleanup                                        | Done (merged, PR #46, merge `177b63c`) – `docs/reports/phase-6-8-6-css-contract-docs.md`                                                                                                                                                                           |
| 6.9.1 | Server show states and event contracts (`lead` phase, question labels, deltas) | Done (merged, PR #47, merge `31a7783`) – `docs/reports/phase-6-9-1-server-show-state.md`; roadmap §9.4                                                                                                                                                             |
| 6.9.2 | Game-show skeleton and scene control (13 scenes, single host/beamer view)      | Done (merged, PR #48 merge `9d9cde2`; flow fixes PR #49 merge `e3bf47d`) – `docs/reports/phase-6-9-2-game-show-skeleton.md` (§8: display-only scene, auto-advance fix); roadmap §9.5                                                                               |
| 6.9.3 | Host-control correction and optional AUTO operation (no presentation mode)     | Done (merged, PR #50, merge `30e286e`) – `docs/reports/phase-6-9-3-host-auto-control.md`; roadmap §9.6                                                                                                                                                             |
| 6.9.4 | Host-control fix: Skip/End confirmation and leaderboard Next button            | Done (merged, PR #51, merge `0d9b8f9`) – `docs/reports/host-next-and-confirmation-fix.md`; roadmap §9.7                                                                                                                                                            |
| 6.9.5 | Answer-deadline alignment (no hidden grace) and host Next verification         | Done (merged, PR #52, merge `18e271f`) – `docs/reports/phase-6-9-5-answer-deadline-and-host-next.md`; roadmap §9.8                                                                                                                                                 |
| 6.10  | Background library (ten supplied WebP files, server-authoritative choice)      | Done (merged, PR #54, merge `ad935fa`) – `docs/reports/phase-6-10-background-library.md`; roadmap §11.                                                                                                                                                             |
| 6.11  | Host background music (one supplied track, question phase only)                | Work complete on `feat/phase-6-11-host-music`, **awaiting owner approval** – `docs/reports/phase-6-11-host-music.md`; roadmap §11.                                                                                                                                 |

**Phase 6.9 is complete.** All five sub-phases (6.9.1–6.9.5) are merged into `main`; the state after
PR #52 is `18e271f`. There is **one** host/beamer view, **no** separate presentation mode, AUTO is
optional and off by default, the reveal window is 4 s, the leaderboard advance is 5 s, and the
visible answer clock is the deadline the server enforces.

**Phase 6.10 (background images) is merged** (PR #54, merge `ad935fa`). The ten supplied WebP
files are integrated byte-identically, and the round's background is chosen once and held by the
server, so host, beamer and players agree and a reconnect or restart restores it.

**Phase 6.11 (host background music) is implemented, awaiting approval.** The project owner supplied
one track (`mastered_vorbis_96.ogg`). It plays on the host/beamer page during the `question` phase
only, with host mute and volume, and is never loaded on a player device. The remaining audio assets
(Blocks F and G of the asset briefing: lobby/final/victory music and the sound effects) are still
missing and would complete the phase.

See `docs/concept/README.md` for the reading order.

## Phase 0 – definition of done

- Repository structure created and documented.
- Architecture decisions recorded as ADRs.
- TypeScript configured (strict) for all packages.
- Backend, frontend and shared packages build successfully.
- Docker and Docker Compose files present and valid (`docker compose config`).
- PostgreSQL configuration prepared (compose service + Prisma skeleton).
- CI workflow runs install, typecheck, test and build.
- Unit test harness works (one real test passing per package with logic).
- README and documentation updated.
- Phase 0 report written and pull request opened.
