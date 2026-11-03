# Security comparison — NoPeek vs. ZeroPeek

Side-by-side comparison of the protection mechanisms, the known weak points and
what ZeroPeek still needs. No insecure implementation is adopted; every
recommendation keeps ZeroPeek's existing model (ADR 0006).

Sources:

- NoPeek: served client assets, `app-config.js`, `nopeek-audit.md`.
- ZeroPeek: `app.ts`, `sessions.ts`, `auth.ts`, `socket.ts`, `engine.ts`,
  `config.ts`, `docs/architecture/0006-security-model.md`.

---

## 1. Comparison table

| #   | NoPeek protection                                                       | Known weak point                       | ZeroPeek counterpart                                                                                                                            | Still required                                                              |
| --- | ----------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Solutions never sent before the reveal (client grades only after close) | —                                      | `questionDisplay()` allow-list strips `correctIndex`/`correct`/`correctIndices`/`accepted`/`answer`; order items are deterministically shuffled | none (equivalent or stronger)                                               |
| 2   | Server-side grading                                                     | —                                      | `correctnessOf` runs only on the server                                                                                                         | none                                                                        |
| 3   | Server-side timing                                                      | —                                      | `elapsedMs = Date.now() − openedAt`, server clock only                                                                                          | none                                                                        |
| 4   | Double-submit guard (one answer per question)                           | In-memory only                         | `answeredQuestionId` (memory) **and** `PlayerAnswer @@unique([playerId, questionId])` (DB)                                                      | none                                                                        |
| 5   | Payload validation on every message                                     | Client-side schema only for the editor | `asString()` guards, typed `Ack<T>`, engine phase checks, `guard()` wraps every handler                                                         | none                                                                        |
| 6   | Host actions require a session                                          | —                                      | `/host` namespace authenticates from the session cookie in a middleware; `assertHost` checks ownership; admins may override                     | none                                                                        |
| 7   | CSRF token on state-changing requests                                   | —                                      | Double-submit `X-CSRF-Token` compared constant-time against the DB token                                                                        | none                                                                        |
| 8   | Session cookies HttpOnly                                                | —                                      | HttpOnly, SameSite=Lax, `Secure` follows the deployment scheme                                                                                  | none                                                                        |
| 9   | Rate limiting                                                           | Not clearly present                    | `@fastify/rate-limit` (300/min prod)                                                                                                            | add stricter per-socket limits on `player:answer` / `player:join` (P2)      |
| 10  | "Too fast" flag                                                         | —                                      | Implemented (`isSuspiciouslyFast`) but `minimumReactionMs = 0` disables it                                                                      | **Q2** must set the threshold; then surface it (P1/P2)                      |
| 11  | Cheat report (IP, flags, min/avg time)                                  | IP storage is a privacy question       | `flagged` recorded per answer; not surfaced in the UI                                                                                           | Surface flagged answers in the report (P2); IP storage is **blocked by Q5** |
| 12  | Password hashing                                                        | —                                      | Argon2id, OWASP baseline (19 MiB, t=2, p=1)                                                                                                     | none                                                                        |
| 13  | Account hardening                                                       | —                                      | Roles, disabled flag, last-admin guard, bootstrap admin                                                                                         | optional email 2FA (P3)                                                     |
| 14  | Content-Security-Policy                                                 | —                                      | Strict CSP + Helmet, `frame-ancestors 'none'`, `no-referrer`, `nosniff`                                                                         | none                                                                        |
| 15  | Audience Q&A moderation                                                 | Any approved text is public            | Not implemented                                                                                                                                 | If added, moderate + length-limit + rate-limit (P3)                         |
| 16  | Error messages never leak internals                                     | —                                      | `AppError` → safe JSON; unexpected errors → generic 500, details only in the log                                                                | none                                                                        |
| 17  | Legal/privacy surfaces (imprint, privacy, consent)                      | —                                      | Not implemented                                                                                                                                 | Needed before public use (P2/P3)                                            |

## 2. Mechanisms ZeroPeek has that NoPeek's client does not expose

| Mechanism                        | ZeroPeek                                 | Why it matters                                                                         |
| -------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| Typed event contract             | `shared/events.ts`                       | Client and server cannot drift; an untyped field is a compile error                    |
| Persistent, queryable data model | PostgreSQL + Prisma                      | Reports are derived from durable rows, not a JSON blob                                 |
| Server-side session table        | `Session` model with expiry + revocation | A stolen cookie can be revoked; expiry is enforced on every request                    |
| Last-admin guard                 | `adminRoutes.ts`                         | An installation cannot lock itself out                                                 |
| Strict config validation         | `config.ts`                              | A misconfigured production stack fails fast with a readable message instead of looping |
| Password policy                  | `PASSWORD_MIN_LENGTH = 10`               | Enforced on create and change                                                          |

## 3. Weak points to watch in ZeroPeek (honest list)

These are real, verifiable gaps — not hypothetical:

1. **"Too fast" rule is off.** `DEFAULT_SPEED_POLICY.minimumReactionMs = 0`, so
   `isSuspiciouslyFast` always returns `false`. The mechanism exists and is
   tested, but until Q2 is answered no answer is ever flagged. _Roadmap: P1
   (decision) + P2 (surfacing)._
2. **Flagged answers are invisible.** Even when a flag is written to
   `PlayerAnswer.flagged`, neither the report nor the host screen shows it. The
   reference shows flags and min/avg times. _Roadmap: P2._
3. **No per-socket rate limit.** The global REST limit exists, but a player can
   still flood `player:join` / `player:answer`. The engine rejects invalid
   answers, so the impact is resource use, not correctness. _Roadmap: P2._
4. **`avatar` is an unvalidated free string.** NoPeek validates avatar ids
   against a server allow-list and renders SVG from ids only. ZeroPeek stores
   whatever string arrives. Because the frontend renders it with `textContent`
   (never `innerHTML`), this is not an XSS vector today, but it is unvalidated
   input. _Roadmap: P3 (or drop the field)._
5. **No IP capture.** Deliberate: Q5 (data minimisation) is open, and the
   reference itself discloses IP storage to players. ZeroPeek must **not**
   silently start storing IPs. _Roadmap: blocked by Q5._
6. **`SESSION_SECRET` fallback.** In development/test an empty value falls back
   to a placeholder; production refuses to start without it (correct). Ensure no
   environment sets `NODE_ENV` incorrectly. _No change needed; documented._

## 4. Rules applied

- **No insecure implementation was adopted.** NoPeek's client-only validation
  and its JSON store were not copied; ZeroPeek keeps server-side validation and
  PostgreSQL.
- **No privacy decision was taken unilaterally.** IP storage stays unimplemented
  because Q5 is open.
- **No anti-cheat decision was taken unilaterally.** The "too fast" threshold
  stays configurable and off because Q2 is open.

## 5. Recommended security work (summary)

| Priority | Item                                                                | Depends on       |
| -------- | ------------------------------------------------------------------- | ---------------- |
| P1       | Answer Q2 (too-fast threshold/policy) and enable the rule           | product decision |
| P2       | Surface flagged answers + timing stats in the report                | Q2               |
| P2       | Per-socket rate limiting on join/answer                             | —                |
| P2       | Legal/privacy surfaces before any public use                        | —                |
| P3       | Validate `avatar` against a server allow-list (or remove the field) | —                |
| P3       | Optional email 2FA for hosts                                        | —                |
| Blocked  | IP-based cheat signals                                              | Q5               |
