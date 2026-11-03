# Implementation roadmap — prioritised

A concrete, additive plan derived from the feature matrix. **Nothing here is
implemented yet.** Every item lists the affected modules, the tests required and
its dependencies. Nothing changes ZeroPeek's architecture (Fastify, Prisma,
PostgreSQL, Redis, Socket.IO, Vanilla TS + Vite; Modules A–F preserved).

Priority key:

- **P1** — required for a complete, reliable live quiz.
- **P2** — sensible functional extension.
- **P3** — optional comfort / extra.

Effort key: **S** (< 1 day), **M** (1–3 days), **L** (> 3 days).

---

## P1 — required for a complete, reliable live quiz

### P1.1 Wire team mode end to end _(M)_

The database already has `game_players.team`, and `constants.ts` already defines
`MIN_TEAMS`, `MAX_TEAMS`, `TEAM_NAMES`. Nothing assigns teams or scores them.

- **Work:** assign teams on join (balanced round-robin or random) when the host
  enables team mode; add a team board to the host screen; expose team rank in
  `game:reveal` / `game:ended`; persist the assignment.
- **Files:** `services/gameService.ts`, `services/engine.ts`, `socket.ts`,
  `shared/events.ts`, `shared/scoring.ts` (team totals), `pages/host.ts`,
  `pages/player.ts`, `prisma/schema.prisma` (no change — column exists).
- **Tests:** unit test for the assignment algorithm; engine test for team
  totals; socket integration test for the team board payload.
- **Dependency:** **Q4** (assignment algorithm + team scoring rules) must be
  answered first. Until then the algorithm stays configurable.

### P1.2 Lead-in phase ("read aloud") _(M)_

`GAME_PHASES` already lists `lead`, but the engine never enters it.

- **Work:** add an optional `leadMs` per game; on `next`, emit `lead` (question
  text only, answers locked) then open the question; add a lead screen to the
  player and host surfaces; a lead time of 0 keeps today's behaviour.
- **Files:** `services/engine.ts`, `shared/events.ts`, `shared/constants.ts`,
  `pages/player.ts`, `pages/host.ts`, `questionView.ts`.
- **Tests:** engine test that `lead` precedes `question` and that answers are
  rejected during `lead`; frontend test for the lead screen.
- **Dependency:** none (additive, default off).

### P1.3 QR code for joining _(S)_

- **Work:** render a QR of `APP_BASE_URL + '/?pin=' + pin` on the lobby (and in
  the player join hint). Prefer a tiny dependency-free QR encoder or an existing
  vetted package; keep CSP `script-src 'self'` (render client-side, no CDN).
- **Files:** `pages/host.ts`, `styles/tokens.css`, `package.json` (if a package
  is used), `vite.config.ts` (only if a static asset is needed).
- **Tests:** a unit test that the QR payload equals the expected join URL.
- **Dependency:** none. `APP_BASE_URL` already exists.

### P1.4 Surface the "too fast" flag + timing stats in the report _(S/M)_

The flag is written to the database but never shown.

- **Work:** show `flagged`, mean and fastest reaction time per player in
  `gameReport` and on the host end screen; keep it read-only.
- **Files:** `services/reportService.ts`, `pages/host.ts`.
- **Tests:** report service test asserting the new fields.
- **Dependency:** **Q2** decides the threshold; the _display_ can ship before
  Q2 (it would simply show "no flags" until the rule is on).

---

## P2 — sensible functional extensions

### P2.1 Review previous questions _(M)_

Re-show a finished question with its distribution, read-only (NoPeek's
`review`/`review-end`).

- **Files:** `services/engine.ts` (frozen snapshot), `shared/events.ts`,
  `pages/host.ts`.
- **Tests:** engine test that review does not mutate scores or answers.
- **Dependency:** none.

### P2.2 Clock-offset synchronisation _(M)_

- **Work:** add a `clock` ping/pong event; clients estimate the offset and
  derive the countdown from the server instant, removing visible drift on
  skewed clocks. Scoring already uses the server clock, so this is UX-only.
- **Files:** `shared/events.ts`, `socket.ts`, `pages/player.ts`,
  `pages/host.ts`, new `frontend/src/clock.ts`.
- **Tests:** unit test for the offset estimator (best-of-N, transport upgrade
  reset).
- **Dependency:** none.

### P2.3 Animated, information-rich leaderboard + podium _(M)_

- **Work:** animate the transition from the previous to the new ranking, show
  the point gain, highlight the local player, add a podium for the top 3.
- **Files:** `pages/host.ts`, `pages/player.ts`, `styles/tokens.css`.
- **Tests:** frontend DOM tests for the rendered rows.
- **Dependency:** none.

### P2.4 Richer reveal views per question type _(M)_

- **Work:** word cloud for `wordCloud`/`open`, a slider band for `slider`, a
  text tally for `text`, an average for `scale`/`nps` (NoPeek shows all of
  these).
- **Files:** `questionView.ts`, `services/reportService.ts` (tallies).
- **Tests:** `questionView.test.ts` additions.
- **Dependency:** none.

### P2.5 Host keyboard/presenter shortcuts _(S)_

- **Work:** Space/Enter/arrows trigger the primary action (advance/reveal).
- **Files:** `pages/host.ts`.
- **Tests:** DOM test for the key handler.
- **Dependency:** none.

### P2.6 Per-socket rate limiting _(S)_

- **Work:** a token bucket on `player:join` and `player:answer`.
- **Files:** `socket.ts`.
- **Tests:** socket integration test that bursts are rejected.
- **Dependency:** none.

### P2.7 CSV **and** Excel export + print view _(M)_

- **Work:** add an `.xlsx` export and a print stylesheet; CSV already exists.
- **Files:** `services/reportService.ts`, `routes/reportRoutes.ts`,
  `pages/host.ts`, `package.json` (spreadsheet lib).
- **Tests:** export service test.
- **Dependency:** none.

### P2.8 Legal/privacy surfaces _(S)_

- **Work:** imprint, privacy note, and a short notice on the join screen (the
  reference discloses nickname/answers/times to the host).
- **Files:** new static pages under `packages/frontend/src/`, router entries.
- **Tests:** none (content).
- **Dependency:** none; required before any public deployment.

---

## P3 — optional comfort / extras

### P3.1 Avatar builder _(L)_

Validated, locally rendered SVG avatars (server allow-list; ids only on the
wire). Also fixes the unvalidated `avatar` string noted in
`security-comparison.md`.

- **Files:** new `frontend/src/avatars.ts`, `shared/` allow-list,
  `services/gameService.ts`, `socket.ts`.
- **Tests:** validation test; join test rejecting an unknown id.
- **Dependency:** none.

### P3.2 Themes actually applied _(M)_

`THEMES` exists; the frontend applies none.

- **Files:** `styles/tokens.css`, `pages/*.ts`.
- **Tests:** none (visual).

### P3.3 Audience Q&A _(L)_

Ask/vote/moderate flow. Must include moderation, length limits and rate limits.

- **Files:** `services/` (new), `socket.ts`, `shared/events.ts`,
  `pages/player.ts`, `pages/host.ts`, `prisma/schema.prisma` (new table).
- **Tests:** socket integration tests.
- **Dependency:** none, but needs the moderation design first.

### P3.4 Branding (custom logo/colours) _(M)_

- **Files:** new admin surface, `styles/tokens.css`, storage.
- **Dependency:** none.

### P3.5 Multi-language _(L)_

- **Dependency:** none.

### P3.6 Host email 2FA _(M)_

- **Files:** `services/userService.ts`, `auth.ts`, `sessions.ts`, mailer.
- **Dependency:** a mail transport.

### P3.7 Client build-freshness guard _(S)_

Server advertises a build hash; the client reloads once on mismatch (prevents
stale scripts after a deploy).

- **Files:** `socket.ts`, `app.ts`, `pages/*.ts`.
- **Dependency:** none.

---

## Deliberately **not** to be adopted

| NoPeek feature                           | Why not                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| JSON server-side store                   | ZeroPeek has a stronger, queryable PostgreSQL model (ADR 0004).                           |
| Client-only validation                   | ZeroPeek validates on the server; keeping this is non-negotiable.                         |
| IP address storage / cheat signals by IP | Blocked by **Q5** (data minimisation); a privacy decision must not be taken unilaterally. |
| Unvalidated avatar markup                | ZeroPeek renders text via `textContent`; any future avatar must be id-validated (P3.1).   |
| Fixed numeric scoring formula            | Q1 is open; ZeroPeek keeps a documented, configurable default.                            |
| Self-paced / homework mode               | **Q7** is open and it is outside Modules A–F.                                             |
| Email 2FA as a default requirement       | Optional only (P3.6); ZeroPeek's threat model does not require it.                        |
| Proprietary artwork / branding           | None may be copied; any avatar/branding is ZeroPeek's own.                                |

---

## Dependency map

```
Q2 ──► P1.4 (display flags) ──► cheat report parity
Q4 ──► P1.1 (team mode)
Q5 ──► (blocked) IP-based signals
Q1 ──► scoring formula finalisation (no code change; config only)
Q6 ──► tie-break finalisation (no code change; config only)
Q7 ──► self-paced mode (out of scope unless approved)

independent: P1.2 (lead), P1.3 (QR), P2.1–P2.8, P3.1–P3.7
```

## Suggested order

1. **P1.3 (QR)** and **P2.5 (shortcuts)** — small, immediate value.
2. **P1.4 (flag display)** — closes the anti-cheat visibility gap.
3. **P1.2 (lead phase)** — the biggest live-quiz UX gap.
4. **P1.1 (team mode)** once **Q4** is answered.
5. **P2.1–P2.4** (review, clock sync, board animation, reveal views).
6. **P3** as capacity allows.

Each item ends with its own report under `docs/reports/` and a pull request, per
`docs/phases.md`. No work starts before explicit approval.
