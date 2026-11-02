# ADR 0005 – Shared domain package as single source of truth

- **Status:** Accepted
- **Date:** 2026-11-02
- **Phase:** 0

## Context

Scoring, question validation and the wire format must be **identical** on the client and the server.
If they diverge, players could be shown results the server does not agree with, or the editor could
accept a quiz the engine rejects.

## Decision

Create **`@zeropeek/shared`**, a runtime-agnostic TypeScript package containing:

- domain **types** (question types, quiz, game state, results, socket event maps),
- the **question schema** (the 13 types and their per-type fields),
- **validation** (`validate`, `coerce`, `playable`-style normalisation),
- **scoring** (the documented points formula),
- **constants** (limits, time options, themes, team names — all ZeroPeek's own).

It is imported by both the backend and the frontend. It must not import `node:` built-ins or use
DOM-only APIs, so it can be bundled for the browser and imported in Node.

## Alternatives considered

- **Duplicate the logic on both sides.** Rejected: guarantees eventual divergence and doubles test
  effort.
- **Server-only logic, client trusts the server.** Partly true for scoring (the server is the
  authority), but the **editor** still needs the schema and validation to give immediate feedback.
  Sharing the package keeps one definition.
- **Publish to a registry.** Unnecessary inside a workspace; adds release overhead.

## Consequences

- One place to change the scoring formula or add a question type; both sides follow.
- The package is the contract for the JSONB `payload` column and for socket payloads.
- Scoring is a **pure function** so it can be unit-tested exhaustively in Phase 5.
