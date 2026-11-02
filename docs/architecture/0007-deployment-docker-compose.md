# ADR 0007 – Deployment: Docker Compose + Caddy

- **Status:** Accepted
- **Date:** 2026-11-02
- **Phase:** 0

## Context

ZeroPeek needs a reproducible local stack and a path to production with TLS, security headers and a
realtime-friendly reverse proxy.

## Decision

- **Docker** images for backend and frontend (multi-stage builds), **Docker Compose** to orchestrate:
  - `db` – PostgreSQL 16
  - `cache` – Redis 7 (optional, used from Phase 4+ for Socket.IO scaling / rate limiting)
  - `backend` – Fastify + Socket.IO
  - `frontend` – static build served by a small web server
  - `proxy` – **Caddy**, providing TLS and a single public entry point, routing `/api` and
    `/socket.io` to the backend and everything else to the frontend.

- The frontend static build is produced by Vite; the backend serves only API and sockets.
- Configuration via environment variables (`.env`), never baked into images.

## Alternatives considered

- **nginx.** Fully capable; Caddy was chosen for automatic TLS and a much smaller, readable config
  (a few lines) which suits a small team.
- **Kubernetes.** Overkill for the current scale; Compose can be lifted to k8s later.
- **Single container (static files served by the backend).** Possible, but separating the frontend
  keeps the backend focused and lets each scale/update independently.

## Consequences

- Local parity with production via the same Compose file.
- WebSocket support must be enabled in the proxy (Caddy handles upgrades automatically).
- Scaling the backend beyond one instance requires sticky sessions or the Socket.IO Redis adapter;
  the `cache` service is already present to make that switch small.
