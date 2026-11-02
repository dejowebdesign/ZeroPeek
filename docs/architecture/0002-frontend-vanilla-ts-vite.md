# ADR 0002 – Frontend: Vanilla TypeScript + Vite (not Angular)

- **Status:** Accepted
- **Date:** 2026-11-02
- **Phase:** 0

## Context

The brief asks for a justified decision between **Vanilla TypeScript** and a framework such as
**Angular** for the frontend, preferring a lean architecture as long as it stays maintainable.

ZeroPeek's frontend has a specific shape:

- **Three distinct surfaces** with little shared UI: a mobile **player**, a large-screen **host /
  beamer**, and a desktop **editor**.
- **Highly dynamic, screen-based UI**: the host view is replaced wholesale as the game advances
  (lobby → question → reveal → leaderboard → podium). This is a screen machine, not a
  form-and-route application.
- **Realtime-first**: state arrives via Socket.IO events and is rendered immediately; there is very
  little deep local state to manage.
- **Strict security posture**: the reference architecture uses a strict CSP that forbids inline
  styles and scripts, so dynamic styling must go through the CSSOM. A framework that injects inline
  `<style>` tags or inline handlers would fight the CSP.
- **Small team, one shared domain package** already covers the complex part (question schema,
  validation, scoring).

## Decision

Use **Vanilla TypeScript with Vite** as the build tool, organised as a **multi-page application**
(one HTML entry per surface: `player`, `host`, `editor`, plus static legal pages).

- A tiny, typed component helper builds DOM nodes with `textContent` (no `innerHTML` for user data).
- Shared UI primitives live in a small internal module; the design system is plain CSS with Custom
  Properties.
- Vite provides fast HMR in development and a multi-page build in production.

## Alternatives considered

- **Angular.** Strong choice for large teams and form-heavy enterprise SPAs (DI, guards, RxJS). It
  would, however, add a router, a change-detection model and a much larger dependency surface for an
  application that is fundamentally a screen machine with a socket. Angular's component styles are
  also emitted as `<style>` blocks, which complicates a strict `style-src 'self'` CSP.
- **React.** Same trade-off as Angular, smaller footprint. Rejected for the same reason: no
  framework-level benefit that offsets the added complexity for this UI shape.
- **Svelte / Solid.** Attractive compile-time approach, but a new runtime for the team to maintain.

## Consequences

- Minimal dependencies and a very small attack/build surface; the CSP stays strict.
- No framework router/DI to learn; the team owns a small amount of glue code.
- Discipline required: the component helper and screen conventions must stay consistent. This is
  mitigated by the shared design system and a documented component pattern (Phase 6).
- If the project later grows into many routed admin screens, a framework can be introduced for the
  editor/admin surface only, without rewriting the player/host.
