/**
 * Account validation shared by the backend and the frontend (Phase 6.3).
 *
 * The same code validates a registration in the browser (inline feedback) and
 * on the server (every write), so client and server can never disagree about
 * what a valid account is. Pure functions only – no `node:` imports, no DOM –
 * so the module stays usable from both sides (ADR 0005).
 *
 * Registration is optional: this module is only ever reached from the explicit
 * "create an account" flow, never from joining a game as a guest.
 */

import type { ValidationIssue } from './validation.js';

/** Account limits. Own values; kept in one place. */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 24;
/** Matches the backend policy (`PASSWORD_MIN_LENGTH`) – at least 10 characters. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;
export const EMAIL_MAX_LENGTH = 254;

/**
 * A pragmatic e-mail check: exactly one `@`, a non-empty local part, a dotted
 * domain with a plausible TLD, and no whitespace. Deliberately not RFC-5322 –
 * the address is confirmed by an actual e-mail, which is the real test.
 */
export function isValidEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) return false;
  if (/\s/.test(email)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email);
}

/** Normalise an e-mail for storage and lookup (trim + lower-case). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Validate a display name (username). */
export function validateUsername(value: unknown): ValidationIssue[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [{ path: 'username', message: 'A display name is required.' }];
  }
  const name = value.trim();
  if (name.length < USERNAME_MIN_LENGTH) {
    return [
      {
        path: 'username',
        message: `The display name must be at least ${USERNAME_MIN_LENGTH} characters.`,
      },
    ];
  }
  if (name.length > USERNAME_MAX_LENGTH) {
    return [
      {
        path: 'username',
        message: `The display name must not exceed ${USERNAME_MAX_LENGTH} characters.`,
      },
    ];
  }
  return [];
}

/** Validate an e-mail address. */
export function validateEmail(value: unknown): ValidationIssue[] {
  if (!isValidEmail(value)) {
    return [{ path: 'email', message: 'Enter a valid e-mail address.' }];
  }
  return [];
}

/**
 * Validate a password. Only a minimum length is enforced (the existing policy);
 * there is no composition rule, so a long passphrase is allowed.
 */
export function validatePassword(value: unknown): ValidationIssue[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [{ path: 'password', message: 'A password is required.' }];
  }
  if (value.length < PASSWORD_MIN_LENGTH) {
    return [
      {
        path: 'password',
        message: `The password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
      },
    ];
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return [
      {
        path: 'password',
        message: `The password must not exceed ${PASSWORD_MAX_LENGTH} characters.`,
      },
    ];
  }
  return [];
}

/** A coarse password-strength score (0–4), for the registration meter. */
export function passwordStrength(value: string): number {
  if (value.length === 0) return 0;
  let score = 0;
  if (value.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (value.length >= 16) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(4, score);
}

/** Validate a full registration payload. Returns every issue found. */
export function validateRegistration(input: {
  username?: unknown;
  email?: unknown;
  password?: unknown;
}): ValidationIssue[] {
  return [
    ...validateUsername(input.username),
    ...validateEmail(input.email),
    ...validatePassword(input.password),
  ];
}
