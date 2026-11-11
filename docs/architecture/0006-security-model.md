# ADR 0006 – Security model

- **Status:** Accepted
- **Date:** 2026-11-02
- **Phase:** 0 (design), implemented across Phases 2–7

## Context

ZeroPeek handles trainer accounts, session cookies, participant data and realtime events. Security
must be designed in from the start, not bolted on. The reference architecture demonstrates a strict
posture (strict CSP, HttpOnly session cookie, CSRF token, HSTS, framing protection) which we adopt
in principle with our own implementation.

## Decision

**Transport & headers**

- HTTPS everywhere; HSTS in production. Reverse proxy (Caddy) terminates TLS.
- Security headers on every response: `Content-Security-Policy` (strict, `'self'` only),
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` / `frame-ancestors 'none'`,
  `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`,
  `Permissions-Policy` with camera/microphone/geolocation disabled.

**Authentication**

- Passwords hashed with **Argon2id**.
- **Server-side sessions** referenced by an opaque, random session id in an **HttpOnly, SameSite=Lax,
  Secure** cookie. No JWT in the browser (no token exfiltration surface).
- **Two identity contexts** (Phase 6.6.3). A session row carries a `kind` (`host` or `player`) and a
  context is only ever accepted by the guard that owns it:
  - **host** – cookie `zp_session` (`COOKIE_NAME`/`SESSION_COOKIE_NAME`); the staff surfaces and the
    `/host` socket namespace.
  - **player** – cookie `zp_player_session` (`PLAYER_COOKIE_NAME`); the player profile and the
    `player:join` account link.

  The host guard never reads the player cookie and the player guard never reads the host cookie, so a
  host and a player can be signed in at the same time in one browser without either taking the
  other's identity. Logging out of one context deletes only that context's session and cookie.

  **The sign-in context follows the verified role.** `POST /api/auth/login` (the general sign-in)
  issues the session that matches the server-side credential check: a `PLAYER` gets the player
  context, `ADMIN`/`TRAINER` the host context. The role is never taken from the request, so a client
  cannot choose its own context. `POST /api/player-auth/login` is the role-bound player endpoint and
  refuses staff (403).

- Optional **TOTP/e-mail 2FA** (Phase 7).

**CSRF**

- Double-submit token: a per-session CSRF token is returned by the API and required in an
  `X-CSRF-Token` header on state-changing requests. Same-origin requests only.
- The token is **context-bound**: a host CSRF token is rejected on a player route and a player token
  on a host route, because each guard compares against its own session's token.

**Authorization**

- Roles (`ADMIN`, `TRAINER`, `PLAYER`) enforced **server-side** on every route and every socket event.
  The client never decides permissions. `PLAYER` is authenticated but not staff, so it cannot reach
  the trainer or admin surfaces.
- **Least-privilege default.** A user created without an explicit role is a `PLAYER`, never staff
  (schema default and `createUser`/admin-create fallback). Staff accounts are only ever created with
  an explicit `ADMIN`/`TRAINER` role, so a missing role can never silently grant host access.
- **Manual e-mail confirmation.** `POST /api/admin/users/:id/verified` (ADMIN only, CSRF-protected)
  lets an administrator confirm a single account's address when the confirmation mail could not be
  delivered. It writes only `emailVerifiedAt` on that one account and is idempotent; it is not a
  global bypass of e-mail verification.

**Realtime**

- Socket connections are authenticated (host session cookie for the `/host` namespace; join token for
  players on `/`). A guest joins by PIN and nickname only; a `player:join` links the seat to a
  **player** account solely through `zp_player_session` — a host cookie never links a seat.
- **Every** incoming socket payload is schema-validated; invalid payloads are rejected with an error
  ACK. Rate limiting on hot paths (join, answer, chat-like events).

**Input & data**

- All inputs validated (JSON Schema at the API, shared validators in the domain).
- File uploads (logo, imports) size- and type-restricted, stored outside the web root.
- Data minimisation: store personal data only with a purpose; support export and deletion
  (Phase 7). Retention windows configurable.

**Logging**

- Security-relevant events (login, failed login, role changes, deletions) logged without secrets.

## Consequences

- A strict CSP forbids inline styles/scripts, so the frontend styles dynamically via the CSSOM
  (see ADR 0002).
- Session storage requires a session table and cleanup job (Phase 2).
- Rate limiting requires Redis or an in-memory store; Redis is provisioned for later scaling.
