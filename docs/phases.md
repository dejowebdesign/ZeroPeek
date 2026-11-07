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

| Phase | Scope                                   | Status                                                                                                                         |
| ----- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Technical inventory                     | Done – `docs/analysis/phase-1-technical-inventory.md`                                                                          |
| 2     | Product and design concept              | Done – `docs/concept/design-concept.md`, `docs/concept/game-design-concept.md`                                                 |
| 3     | Technical roadmap                       | Done – `docs/roadmap/technical-roadmap.md`                                                                                     |
| 4     | Asset briefing                          | Done – `docs/assets/ASSET-BRIEFING.md`                                                                                         |
| 5     | Concept report (approval)               | Done – `docs/reports/phase-5-concept-report.md`                                                                                |
| 5b    | Revision and first works                | Done (merged, PR #16) – `docs/reports/phase-5b-revision-and-first-works.md`                                                    |
| 5c    | Binding product decisions               | Done (PR #17) – `docs/reports/phase-5c-product-decisions.md`                                                                   |
| 6.1   | Design system                           | Done (PR #18) – `docs/design/design-system.md`                                                                                 |
| 6.2.1 | Navigation and shell                    | Done (merged, PR #21) – `docs/design/design-system.md` §8.1                                                                    |
| 6.2.2 | Player lobby and profile placeholder    | Done (merged, PR #23) – `docs/roadmap/technical-roadmap.md` §3.1; analysis `docs/analysis/phase-6-2-2-player-lobby-profile.md` |
| 6.2   | Navigation and responsive layout        | **Complete** (6.2.1 + 6.2.2 merged)                                                                                            |
| 6.3   | Login, registration, starfield          | Done (merged, PR #25) – `docs/reports/phase-6-3-*`                                                                             |
| 6.4   | Quiz management, editor, snapshot       | Done (merged, PR #26) – `docs/reports/phase-6-4-quiz-editor-snapshot.md`                                                       |
| 6.5.1 | Admin modernisation                     | Done (merged, PR #27) – `docs/reports/phase-6-5-1-admin.md`                                                                    |
| 6.5.2 | Host control and phase display          | Done (merged, PR #30) – `docs/reports/phase-6-5-2-host-state-sync.md`; roadmap §6.1                                            |
| 6.5.3 | Extended host control (pause/skip/kick) | In review – `docs/reports/phase-6-5-3-extended-host-controls.md`; roadmap §6.2                                                 |

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
