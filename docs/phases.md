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
