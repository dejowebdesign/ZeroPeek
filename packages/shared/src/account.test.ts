/**
 * Account validation (Phase 6.3).
 *
 * The same rules run in the browser and on the server, so these tests are the
 * contract for both: a password is at least ten characters, an e-mail needs a
 * plausible shape, and a display name is bounded.
 */

import { describe, expect, it } from 'vitest';

import {
  isValidEmail,
  normalizeEmail,
  PASSWORD_MIN_LENGTH,
  passwordStrength,
  validateEmail,
  validatePassword,
  validateRegistration,
  validateUsername,
} from './account.js';

describe('password policy', () => {
  it('is at least ten characters', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
  });

  it('rejects a password that is too short', () => {
    expect(validatePassword('short')).toHaveLength(1);
    expect(validatePassword('123456789')).toHaveLength(1);
  });

  it('accepts a long passphrase', () => {
    expect(validatePassword('correct horse battery staple')).toHaveLength(0);
  });

  it('rejects a non-string', () => {
    expect(validatePassword(undefined)).toHaveLength(1);
    expect(validatePassword(12345678901)).toHaveLength(1);
  });
});

describe('e-mail validation', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidEmail('player@example.com')).toBe(true);
    expect(isValidEmail('a.b+tag@sub.example.co.uk')).toBe(true);
  });

  it('rejects malformed addresses', () => {
    for (const value of ['', 'no-at', 'a@b', 'a@@b.com', 'a b@c.com', 'a@b.']) {
      expect(isValidEmail(value), value).toBe(false);
    }
  });

  it('normalises by trimming and lower-casing', () => {
    expect(normalizeEmail('  Player@Example.COM ')).toBe('player@example.com');
  });

  it('reports one issue for a bad address', () => {
    expect(validateEmail('nope')).toHaveLength(1);
    expect(validateEmail('ok@example.com')).toHaveLength(0);
  });
});

describe('username validation', () => {
  it('requires at least three characters', () => {
    expect(validateUsername('ab')).toHaveLength(1);
    expect(validateUsername('abc')).toHaveLength(0);
  });

  it('bounds the length', () => {
    expect(validateUsername('x'.repeat(25))).toHaveLength(1);
    expect(validateUsername('x'.repeat(24))).toHaveLength(0);
  });

  it('rejects a blank name', () => {
    expect(validateUsername('   ')).toHaveLength(1);
  });
});

describe('validateRegistration', () => {
  it('accepts a complete payload', () => {
    expect(
      validateRegistration({
        username: 'Maya',
        email: 'maya@example.com',
        password: 'a-long-enough-password',
      }),
    ).toHaveLength(0);
  });

  it('collects every problem at once', () => {
    const issues = validateRegistration({ username: 'a', email: 'bad', password: 'short' });
    expect(issues.map((issue) => issue.path).sort()).toEqual(['email', 'password', 'username']);
  });
});

describe('passwordStrength', () => {
  it('is zero for an empty password', () => {
    expect(passwordStrength('')).toBe(0);
  });

  it('rises with length and variety', () => {
    expect(passwordStrength('short')).toBe(0);
    expect(passwordStrength('longenough1!')).toBeGreaterThan(1);
    expect(passwordStrength('LongEnoughPassphrase1!')).toBe(4);
  });
});
