# NoPeek vs. ZeroPeek — functional and technical comparison

Analysis of the reference project **NoPeek** against **ZeroPeek**, with a focus on
the live-quiz game functions. **This is analysis only — no feature was
implemented.**

| Document                                                   | Contents                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| [`feature-matrix.md`](./feature-matrix.md)                 | Full A–I feature comparison with status per feature         |
| [`game-engine-comparison.md`](./game-engine-comparison.md) | Phases, events, timing, scoring, recovery                   |
| [`security-comparison.md`](./security-comparison.md)       | Protection mechanisms, weak points, remaining work          |
| [`implementation-roadmap.md`](./implementation-roadmap.md) | Prioritised plan (P1/P2/P3) with files, tests, dependencies |

## Method and a necessary caveat

- **NoPeek** was analysed from its served, unminified client assets
  (`player.js`, `host.js`, `editor.js`, `common.js`, `clock.js`,
  `quizschema.js`, `avatars.js`, `branding.js`, `app-config.js`) and its
  HTML/CSS — the same method as the existing `nopeek-audit.md`. Server internals
  are inferred from the client contract.
- **The ZIP archive named in the task was not present in this environment.**
  The live assets at `nopeek.projekt-chrisb.de` are the source the prior audit
  used, so the analysis is grounded in the same material. If a ZIP with newer
  content exists, re-running this analysis against it would only add detail, not
  change the conclusions.
- **ZeroPeek** was analysed from the actual implementation: `engine.ts`,
  `gameService.ts`, `socket.ts`, `reportService.ts`, `config.ts`, `auth.ts`,
  `sessions.ts`, all routes, `schema.prisma`, the shared package and all
  frontend pages. A feature is only marked implemented when the backend, the
  data model and the surface agree.

## 1. Scope analysed

|                       | NoPeek                     | ZeroPeek                         |
| --------------------- | -------------------------- | -------------------------------- |
| Client assets read    | 9 JS modules + 6 CSS       | 4 pages, 6 modules, 1 stylesheet |
| Server code read      | inferred (client contract) | 15 source files + schema         |
| Functions inventoried | ~70                        | ~70                              |
| Question types        | 13                         | 13 (own implementation)          |
| Socket events         | ~25                        | ~18                              |

## 2. Headline result

ZeroPeek already covers the **core** live-quiz loop end to end — lobby, PIN,
join, server-authoritative engine, 13 question types, scoring, ranking,
leaderboard, reveal, podium, persistent reports and CSV export — on a **stronger
technical foundation** than the reference (typed event contracts, PostgreSQL +
Prisma, server-side sessions and CSRF, strict config validation).

The reference is ahead in **presentation and live-show polish** (lead-in phase,
clock-synchronised start, animated board/podium, per-type reveal views, QR code,
team mode, audience Q&A, richer reports) and in **account/legal breadth**
(branding, multi-language, invite codes, email 2FA, legal pages).

**Nothing needs to be replaced.** Every gap can be closed additively.

## 3. Most important functional differences

1. **Team mode is data-only.** `game_players.team`, `MIN/MAX_TEAMS` and
   `TEAM_NAMES` exist, but no assignment, no team board, no team scoring.
2. **No lead-in ("read aloud") phase.** `GAME_PHASES` lists `lead`; the engine
   never enters it and no surface renders it.
3. **No QR code** for joining.
4. **No clock-offset sync.** The countdown is derived from the server
   `openedAt` on the local clock, so a skewed phone clock drifts visibly
   (scoring stays correct).
5. **Presentation is thin.** Text countdown, plain leaderboard, no podium
   animation, no per-type reveal views (word cloud, slider band, tallies).
6. **No host review of previous questions**, no keyboard/presenter shortcuts.
7. **Reports are correct but narrow.** No Excel/print export, no combined
   report, no per-participant progress, no flag/timing columns.
8. **No audience features** (Q&A, upvotes) and **no avatars**.

## 4. Most important security differences

ZeroPeek is **at least as strong** as the reference on every check the reference
exposes, and stronger on several (DB-enforced single answer, typed payloads,
session revocation, CSRF, rate limiting, CSP).

The genuine gaps are:

1. **The "too fast" rule is implemented but switched off** (`minimumReactionMs
= 0`) — pending **Q2**.
2. **Flags are recorded but never shown** — the report has no flag/timing
   columns yet.
3. **No per-socket rate limit** on join/answer.
4. **`avatar` is an unvalidated string** (rendered safely today, but should be
   id-validated if kept).
5. **No IP capture** — deliberate, blocked by **Q5** (data minimisation).

No insecure NoPeek implementation was adopted, and no open product decision
(Q1, Q2, Q4, Q5, Q6, Q7) was changed.

## 5. Scoring analysis (explicit)

- **NoPeek:** scored types get a base score plus a speed component (Kahoot-style
  time bonus); `double` and `none` are per-question options; wrong answers score 0. **The exact numbers and curve are computed server-side and are not readable
  from the client**, so they are treated as unknown and were **not copied**.
- **ZeroPeek:** a documented, **configurable** formula —
  `base × (1 + ratio × speed) × multiplier`, defaults base 1000, ratio 0.5,
  linear curve, wrong 0, double applies to total, no partial credit — with a
  configurable tie-break. Q1/Q2/Q6 remain the deciding authority; changing the
  numbers is a config change, never an engine rewrite.
- **Verdict:** the two formulas cannot be numerically compared without the
  reference server. ZeroPeek's approach is the safer one for an open product
  decision. No change proposed.

## 6. Prioritised roadmap (summary)

Full detail in [`implementation-roadmap.md`](./implementation-roadmap.md).

**P1 — required for a complete, reliable live quiz**

- Wire team mode end to end (depends on **Q4**).
- Add the lead-in ("read aloud") phase (default off, additive).
- Add a QR code to the lobby.
- Surface the "too fast" flag and timing stats in the report.

**P2 — sensible extensions**

- Review previous questions; clock-offset sync; animated board + podium;
  per-type reveal views; host keyboard shortcuts; per-socket rate limiting;
  Excel/print export; legal/privacy pages.

**P3 — optional**

- Avatar builder; themes; audience Q&A; branding; multi-language; email 2FA;
  client build-freshness guard.

## 7. Recommended next steps

1. **Decide the open questions** Q1, Q2, Q4, Q5, Q6 (Q7 for self-paced mode).
   They gate P1.1, P1.4 and the anti-cheat/report parity work.
2. **Start with the small, high-value P1 items** that need no decision:
   QR code (P1.3), host shortcuts (P2.5) and flag display (P1.4).
3. **Then the lead-in phase** (P1.2), the biggest live-quiz UX gap.
4. **Team mode (P1.1) once Q4 is answered.**
5. Keep the per-phase workflow from `docs/phases.md`: each item ends with a
   report and a pull request; work pauses for approval.

## 8. Repository rules respected

- Architecture preserved: Fastify, Prisma, PostgreSQL, Redis, Socket.IO,
  Vanilla TS + Vite; Modules A–F intact.
- No file deleted, renamed or moved; no existing document overwritten.
- No product logic changed; no feature implemented.
- No change to the running Portainer stack; no database change.
- Only new files added, under `docs/analysis/nopeek-comparison/`.
