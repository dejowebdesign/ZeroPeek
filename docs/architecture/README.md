# Architecture Decisions

This directory holds the Architecture Decision Records (ADRs) for ZeroPeek. Each record states
the context, the decision, the alternatives considered, and the consequences.

| #                                         | Title                                             | Status   |
| ----------------------------------------- | ------------------------------------------------- | -------- |
| [0001](0001-monorepo-npm-workspaces.md)   | Monorepo with npm workspaces                      | Accepted |
| [0002](0002-frontend-vanilla-ts-vite.md)  | Frontend: Vanilla TypeScript + Vite (not Angular) | Accepted |
| [0003](0003-backend-fastify-socketio.md)  | Backend: Fastify + Socket.IO                      | Accepted |
| [0004](0004-database-postgres-prisma.md)  | Database: PostgreSQL + Prisma ORM                 | Accepted |
| [0005](0005-shared-domain-package.md)     | Shared domain package as single source of truth   | Accepted |
| [0006](0006-security-model.md)            | Security model: sessions, CSRF, headers           | Accepted |
| [0007](0007-deployment-docker-compose.md) | Deployment: Docker Compose + Caddy                | Accepted |

## Open questions (awaiting product decision)

These are recorded deliberately instead of being decided unilaterally. They do not block Phase 0
but must be answered before the affected phase.

| #   | Question                                                                                                                 | Needed before |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Q1  | Exact scoring formula: base points, time-bonus curve, rounding, and whether "double points" multiplies base or total.    | Phase 5       |
| Q2  | Threshold and policy for the "too fast" rule (answers faster than humanly possible).                                     | Phase 5       |
| Q3  | Which signals feed the anomaly / "cheat report" (IP reuse, duplicate names, timing patterns) and their retention period. | Phase 5 / 7   |
| Q4  | Team assignment algorithm (automatic balance vs. host-assigned) and team scoring rules.                                  | Phase 5       |
| Q5  | Whether participant IP addresses may be stored at all, and for how long (data minimisation).                             | Phase 5 / 7   |
| Q6  | Tie-breaking rules on the leaderboard.                                                                                   | Phase 5       |
| Q7  | Whether a self-paced/homework mode is in scope (present in the reference app, not listed in Modules A–F).                | Phase 7       |
