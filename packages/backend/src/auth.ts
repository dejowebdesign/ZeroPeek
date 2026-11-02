/**
 * Authentication primitives: password hashing, session tokens and CSRF.
 *
 * Passwords use Argon2id (ADR 0006). Session ids and CSRF tokens are random
 * 32-byte values; only their hashes would need to be secret, but we store them
 * directly because they are already high-entropy and the database is trusted.
 *
 * Nothing in this module logs or returns a password or a raw secret.
 */

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

/**
 * Argon2id parameters. OWASP-recommended baseline (19 MiB, t=2, p=1).
 *
 * The algorithm is left at the library default, which is Argon2id; naming it
 * explicitly would require the ambient const enum `Algorithm`, which
 * `verbatimModuleSyntax` forbids importing as a value.
 */
const ARGON_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hash a password for storage. */
export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTIONS);
}

/** Verify a password against a stored hash. Never throws on a malformed hash. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password, ARGON_OPTIONS);
  } catch {
    return false;
  }
}

/** A new opaque session id (the value stored in the cookie). */
export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/** A new CSRF token (double-submit). */
export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/** A new per-player reconnect token. */
export function newPlayerToken(): string {
  return randomUUID();
}

/** Constant-time string comparison that never throws on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Minimum password length enforced on registration and password change. */
export const PASSWORD_MIN_LENGTH = 10;

/** Whether a password meets the minimum policy. */
export function isAcceptablePassword(password: string): boolean {
  return typeof password === 'string' && password.length >= PASSWORD_MIN_LENGTH;
}
