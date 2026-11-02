# ADR 0001 – Monorepo with npm workspaces

- **Status:** Accepted
- **Date:** 2026-11-02
- **Phase:** 0

## Context

ZeroPeek consists of three closely related code bases that share a domain model:

- a **backend** (Fastify + Socket.IO),
- a **frontend** (player, host, editor),
- and a **shared domain** (question schema, validation, scoring) that must behave **identically**
  on both sides.

The scoring and validation rules must not diverge between client and server, because the server is
the authority and the client only mirrors its decisions.

## Decision

Use a **single repository with npm workspaces**:

```
packages/shared    @zeropeek/shared
packages/backend   @zeropeek/backend
packages/frontend  @zeropeek/frontend
```

The shared package is consumed by the other two as a workspace dependency. A single `npm install`
at the root installs everything and hoists common dependencies.

## Alternatives considered

- **Polyrepo (three repositories).** Rejected: the shared domain would need publishing/versioning
  for every change, which is heavy for a small team and slows down the tight client/server loop.
- **pnpm / Turborepo / Nx.** Rejected for Phase 0: npm workspaces are built in, require no extra
  tooling, and are sufficient for three packages. Turborepo can be added later without moving code.
- **Single package with folders.** Rejected: it would blur the boundary between server and browser
  code and make it easy to import Node-only modules into the frontend.

## Consequences

- One lockfile, one `npm install`, consistent TypeScript version across packages.
- `@zeropeek/shared` must remain **runtime-agnostic** (no `node:` imports, no DOM-only APIs) so it
  can be bundled for the browser and imported by Node.
- Build order matters: `shared` → `backend` / `frontend`. Encoded in the root `build` script.
