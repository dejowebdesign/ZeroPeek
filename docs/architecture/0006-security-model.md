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
- Optional **TOTP/e-mail 2FA** (Phase 7).

**CSRF**

- Double-submit token: a per-session CSRF token is returned by the API and required in an
  `X-CSRF-Token` header on state-changing requests. Same-origin requests only.

**Authorization**

- Roles (`ADMIN`, `TRAINER`) enforced **server-side** on every route and every socket event. The
  client never decides permissions.

**Realtime**

- Socket connections are authenticated (session cookie for host; join token for players).
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
