/**
 * ZeroPeek shared domain – the single source of truth for question types,
 * validation and scoring. This module is imported by both the backend and the
 * frontend, so it must stay runtime-agnostic: no `node:` imports, no DOM APIs.
 *
 * Phase 1 completes the domain: the 13 question types plus validation,
 * configurable scoring/ranking, PIN generation and the Socket.IO event
 * contracts. Product decisions Q1/Q2/Q6 are exposed as configurable options
 * (see `scoring.ts`) rather than hard-coded.
 */

export * from './constants.js';
export * from './questions.js';
export * from './validation.js';
export * from './account.js';
export * from './scoring.js';
export * from './pin.js';
export * from './events.js';
export * from './profile.js';
export * from './cosmetics.js';
export * from './characters.js';
