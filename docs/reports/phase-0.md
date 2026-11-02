# Phase 0 Report – Project Foundation

**Project:** ZeroPeek
**Phase:** 0 – Project foundation
**Branch:** `phase-0/project-foundation`
**Date:** 2026-11-02
**Status:** Complete, awaiting approval before Phase 1

---

## 1. Objective

Create the technical and organisational foundation for ZeroPeek: repository structure,
architecture decisions, TypeScript configuration, Docker environment, PostgreSQL preparation,
CI and a working test harness – without implementing product features yet.

## 2. What was built

### Repository structure

```
zeropeek/
├─ packages/
│  ├─ shared/     @zeropeek/shared    – domain types, 13 question types, validation, scoring
│  ├─ backend/    @zeropeek/backend   – Fastify 5 + Prisma (PostgreSQL) + Socket.IO 4
│  └─ frontend/   @zeropeek/frontend  – multi-page Vanilla-TS + Vite (player, host, editor)
├─ docs/          architecture (ADRs), phases, contributing, reports
├─ docker/        backend.Dockerfile, frontend.Dockerfile, Caddyfiles
├─ docker-compose.yml
└─ .github/workflows/ci.yml
```

### Key files created

| File                                                                                  | Purpose                                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `package.json`, `tsconfig.base.json`                                                  | npm workspaces, strict TypeScript base config           |
| `.gitignore`, `.dockerignore`, `.editorconfig`, `.prettierrc.json`, `.prettierignore` | Hygiene                                                 |
| `.env.example`                                                                        | Documented environment template (no secrets)            |
| `docs/architecture/0001…0007-*.md`                                                    | Seven Architecture Decision Records                     |
| `docs/architecture/README.md`                                                         | ADR index + open product questions (Q1–Q7)              |
| `docs/phases.md`                                                                      | Phase plan and Phase 0 definition of done               |
| `docs/contributing.md`                                                                | Branching, commits, PR requirements                     |
| `packages/shared/src/{constants,questions,index}.ts`                                  | Domain vocabulary for all 13 question types             |
| `packages/backend/src/{config,app,server}.ts`                                         | Fastify app factory, health endpoint, hardening headers |
| `packages/backend/prisma/schema.prisma`                                               | Prisma datasource + `User` model skeleton               |
| `packages/frontend/src/{dom.ts,pages/*,styles/tokens.css}`                            | DOM builder, three entry pages, design tokens           |
| `docker/*`, `docker-compose.yml`                                                      | 5-service stack (db, cache, backend, frontend, proxy)   |
| `.github/workflows/ci.yml`                                                            | Install → typecheck → test → build → format             |

## 3. Verification evidence

All commands were run in the development environment (Node 24, npm 11, Docker 29).

| Check             | Command                                              | Result                                                |
| ----------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Install           | `npm install`                                        | 235 packages, exit 0                                  |
| Build             | `npm run build`                                      | shared → backend → frontend, exit 0                   |
| Typecheck         | `npm run typecheck`                                  | 3 workspaces clean, exit 0                            |
| Unit tests        | `npm test`                                           | **19 tests passed** (9 shared, 5 backend, 5 frontend) |
| Formatting        | `npm run format:check`                               | All files conform                                     |
| Prisma schema     | `prisma validate`                                    | "The schema is valid"                                 |
| Compose syntax    | `docker compose config`                              | Valid                                                 |
| Backend image     | `docker build -f docker/backend.Dockerfile`          | Builds                                                |
| Frontend image    | `docker build -f docker/frontend.Dockerfile`         | Builds                                                |
| Full stack        | `docker compose up -d --build`                       | All 5 services healthy                                |
| Proxy → API       | `curl localhost:8080/api/health`                     | `{"status":"ok",...,"questionTypes":13}`              |
| Proxy → pages     | `curl localhost:8080/`, `/editor.html`, `/host.html` | 200, correct titles                                   |
| Hardening headers | `curl -i` on health                                  | CSP, HSTS, nosniff, DENY, no-referrer present         |

### Defect found and fixed during verification

The first Docker build failed with `TS2307: Cannot find module '@zeropeek/shared'`. **Root cause:**
local `*.tsbuildinfo` files were copied into the image, so `tsc` considered the shared package
already built and emitted no output. **Fix:** added `**/*.tsbuildinfo` to `.dockerignore`. Rebuild
then succeeded and the running container returned the expected health payload with
`questionTypes: 13`, proving the workspace link between backend and shared works inside the image.

## 4. Decisions taken

Documented in full as ADRs:

1. Monorepo with npm workspaces.
2. Frontend: Vanilla TypeScript + Vite (not Angular) – justified in ADR 0002.
3. Backend: Fastify 5 + Socket.IO 4.
4. Database: PostgreSQL 16 + Prisma ORM (hybrid columns + JSONB payload).
5. Shared domain package as the single source of truth.
6. Security model (Argon2id, server-side sessions, CSRF, strict CSP, roles).
7. Deployment: Docker Compose + Caddy.

## 5. Deliberately not decided

Product rules that require your input are listed as **Q1–Q7** in
`docs/architecture/README.md` (scoring formula, "too fast" threshold, cheat-report signals, team
assignment, IP storage/retention, tie-breaking, self-paced mode). These do not block Phase 0 but
must be answered before Phase 5.

## 6. Known limitations of this phase

- The backend has no database connection yet; `/api/health` is a static probe. Prisma is wired in
  Phase 2.
- No Socket.IO server is attached yet; `/socket.io/*` is correctly routed by the proxy but returns
  404 until Phase 4.
- Frontend pages are placeholders that demonstrate the design system and the shared domain only.
- No authentication, no persistence, no game logic – by design.

## 7. Definition of done – checklist

- [x] Repository structure created and documented
- [x] Architecture decisions recorded as ADRs
- [x] TypeScript configured (strict) for all packages
- [x] All packages build successfully
- [x] Docker and Compose files present and valid, images build and run
- [x] PostgreSQL prepared (Compose service + Prisma skeleton)
- [x] CI workflow defined
- [x] Unit test harness works (19 passing tests)
- [x] README and documentation updated

## 8. Recommendation

Phase 0 is complete and verified. **Proceed to Phase 1 (Quiz domain)** on approval: implement the
full shared model for the 13 question types with validation and an exhaustive unit-test suite.
Please also confirm or correct the open questions Q1–Q7 when convenient.
