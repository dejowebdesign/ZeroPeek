/**
 * ZeroPeek shared domain – the single source of truth for question types,
 * validation and scoring. This module is imported by both the backend and the
 * frontend, so it must stay runtime-agnostic: no `node:` imports, no DOM APIs.
 *
 * Phase 0 exposes the domain vocabulary (the 13 question types) and small pure
 * helpers. Full validation and the scoring formula are implemented in later
 * phases (see docs/phases.md and docs/architecture/README.md).
 */

export * from './constants.js';
export * from './questions.js';
