# ADR 0003 – Backend: Fastify + Socket.IO

- **Status:** Accepted
- **Date:** 2026-11-02
- **Phase:** 0

## Context

The backend must serve a REST API (auth, quiz CRUD, reports, imports/exports) **and** an
authoritative realtime layer (lobby, questions, answers, leaderboards). Realtime correctness is the
highest priority: the server decides state, timing and scoring.

## Decision

- **HTTP framework: Fastify 5.** First-class TypeScript types, JSON-schema validation built in,
  fast, and a mature plugin ecosystem (cookies, CORS, rate-limit, static, helmet-style headers).
- **Realtime: Socket.IO 4.** Provides rooms, namespaces, automatic reconnection with buffering,
  acknowledgements (ACK callbacks), and a transport upgrade path (polling → WebSocket) that survives
  strict proxies and mobile networks. Namespaces cleanly separate **player** (`/`) from **host**
  (`/host`) connections.
- **Same Node process** hosts both the REST API and the Socket.IO server in Phase 0 (single
  service). The Socket.IO layer attaches to the Fastify HTTP server.

## Alternatives considered

- **Express + `ws`.** Express is older and lacks built-in schema validation; raw `ws` means
  reimplementing reconnection, ACK, rooms and heartbeats that Socket.IO already provides.
- **Native WebSockets only.** Lower overhead, but we would rebuild the reconnect/ACK/room logic and
  lose the proxy-friendly polling fallback. Revisit only if profiling shows Socket.IO overhead is a
  real bottleneck.
- **tRPC / GraphQL.** Unnecessary: the realtime channel is event-based, and the REST surface is small.

## Consequences

- ACK-based, server-authoritative events: every client message is validated and answered with
  `{ ok }` or `{ error }`.
- Reconnect and session resumption come from the framework plus our own session tokens.
- Horizontal scaling later requires the **Redis adapter** for Socket.IO (sticky sessions or a shared
  adapter). Redis is therefore already provisioned in `docker-compose.yml` as optional.
- All socket payloads are typed via `@zeropeek/shared` (event maps), keeping client and server in
  lockstep.
