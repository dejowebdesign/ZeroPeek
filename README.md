# ZeroPeek

**ZeroPeek** is an independent, real-time interactive quiz platform: a host drives a quiz on a
big screen or projector while participants join from their phones with a PIN, answer in real
time, and see points and rankings computed live.

> ZeroPeek is an independent development by **Dejo Webdesign**. It uses its own branding, texts,
> graphics, avatars and technical implementation. No protected source code or assets from other
> projects are used.

## Status

| Phase | Scope                                                        | State          |
| ----- | ------------------------------------------------------------ | -------------- |
| 0     | Project foundation (repo, architecture, tooling, Docker, CI) | ✅ this branch |
| 1     | Quiz domain (13 question types, validation, tests)           | ⏳ pending     |
| 2     | Backend & database (Fastify, PostgreSQL, Prisma, sessions)   | ⏳ pending     |
| 3     | Quiz editor                                                  | ⏳ pending     |
| 4     | Socket.IO & lobby                                            | ⏳ pending     |
| 5     | Game engine (scoring, ranking, anti-cheat)                   | ⏳ pending     |
| 6     | Frontend (player, host, beamer)                              | ⏳ pending     |
| 7     | User management & reports                                    | ⏳ pending     |
| 8     | Tests & deployment                                           | ⏳ pending     |

## Tech stack

| Area            | Choice                                                       |
| --------------- | ------------------------------------------------------------ |
| Language        | TypeScript (strict)                                          |
| Backend         | Node.js, Fastify 5, Socket.IO 4                              |
| Database        | PostgreSQL 16 via Prisma ORM                                 |
| Cache / scaling | Redis (optional, later phases)                               |
| Frontend        | Vanilla TypeScript + Vite, multi-page, CSS Custom Properties |
| Tests           | Vitest (unit), Playwright (E2E, later)                       |
| Infra           | Docker, Docker Compose, Caddy reverse proxy (TLS)            |

The rationale for every choice is documented in [`docs/architecture/`](docs/architecture/).

## Repository layout

```
zeropeek/
├─ packages/
│  ├─ shared/    # domain types, question schema, validation, scoring (client + server)
│  ├─ backend/   # Fastify API + Socket.IO server
│  └─ frontend/  # multi-page Vanilla-TS client (player, host, editor)
├─ docs/         # architecture decisions, schema, conventions
├─ docker/       # Dockerfiles and reverse-proxy config
├─ docker-compose.yml
└─ .github/workflows/ci.yml
```

## Getting started

### Prerequisites

- Node.js ≥ 20.11 (developed on Node 24)
- npm ≥ 10 (workspaces)
- Docker + Docker Compose (for the full stack)

### Local development

```bash
npm install            # install all workspaces
cp .env.example .env   # then edit values
npm run build          # build shared → backend → frontend
npm test               # run all unit tests
```

### Full stack with Docker

```bash
docker compose up --build
# Frontend:  http://localhost:8080
# Backend:   http://localhost:3000/api/health
```

## Scripts

| Command             | Description                              |
| ------------------- | ---------------------------------------- |
| `npm run build`     | Build all packages                       |
| `npm test`          | Run unit tests in all packages           |
| `npm run typecheck` | Type-check all packages without emitting |
| `npm run dev`       | Start the backend in watch mode          |
| `npm run format`    | Format with Prettier                     |

## Documentation

- [Architecture decisions](docs/architecture/)
- [Development phases](docs/phases.md)
- [Contributing](docs/contributing.md)

## License

Proprietary – © Dejo Webdesign. All rights reserved.
