/**
 * Tests for environment validation and DATABASE_URL derivation.
 *
 * These are pure unit tests: they exercise `loadConfig`/`resolveDatabaseUrl`
 * with plain objects and never touch a database or a real secret.
 */

import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig, resolveDatabaseUrl } from './config.js';

/** A complete, valid production environment. */
const VALID_PRODUCTION = {
  NODE_ENV: 'production',
  APP_BASE_URL: 'https://quiz.example.com',
  SESSION_SECRET: 'a-very-long-random-secret',
  DATABASE_URL: 'postgresql://zeropeek:secret@db:5432/zeropeek?schema=public',
  REDIS_URL: 'redis://cache:6379',
};

describe('resolveDatabaseUrl', () => {
  it('prefers an explicit DATABASE_URL', () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: 'postgresql://explicit@db:5432/zeropeek',
        POSTGRES_USER: 'ignored',
        POSTGRES_PASSWORD: 'ignored',
        POSTGRES_DB: 'ignored',
      }),
    ).toBe('postgresql://explicit@db:5432/zeropeek');
  });

  it('derives the URL from the POSTGRES_* values', () => {
    expect(
      resolveDatabaseUrl({
        POSTGRES_USER: 'zeropeek',
        POSTGRES_PASSWORD: 'secret',
        POSTGRES_DB: 'zeropeek',
      }),
    ).toBe('postgresql://zeropeek:secret@db:5432/zeropeek?schema=public');
  });

  it('honours a custom host and port', () => {
    expect(
      resolveDatabaseUrl({
        POSTGRES_USER: 'u',
        POSTGRES_PASSWORD: 'p',
        POSTGRES_DB: 'd',
        POSTGRES_HOST: 'database.internal',
        POSTGRES_PORT: '6543',
      }),
    ).toBe('postgresql://u:p@database.internal:6543/d?schema=public');
  });

  it('percent-encodes special characters in the password', () => {
    const url = resolveDatabaseUrl({
      POSTGRES_USER: 'zeropeek',
      POSTGRES_PASSWORD: 'p@ss:w/rd?#%!*',
      POSTGRES_DB: 'zeropeek',
    });
    expect(url).toBe(
      'postgresql://zeropeek:p%40ss%3Aw%2Frd%3F%23%25%21%2A@db:5432/zeropeek?schema=public',
    );
    // The resulting string must be parseable back to the original password.
    const parsed = new URL(url!);
    expect(decodeURIComponent(parsed.password)).toBe('p@ss:w/rd?#%!*');
  });

  it('returns undefined when the parts are incomplete', () => {
    expect(resolveDatabaseUrl({ POSTGRES_USER: 'u', POSTGRES_DB: 'd' })).toBeUndefined();
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });
});

describe('loadConfig in production', () => {
  it('accepts a complete environment', () => {
    const config = loadConfig(VALID_PRODUCTION);
    expect(config.nodeEnv).toBe('production');
    expect(config.databaseUrl).toBe(VALID_PRODUCTION.DATABASE_URL);
    expect(config.sessionSecret).toBe(VALID_PRODUCTION.SESSION_SECRET);
  });

  it('derives DATABASE_URL from POSTGRES_* when it is not set', () => {
    const config = loadConfig({
      ...VALID_PRODUCTION,
      DATABASE_URL: '',
      POSTGRES_USER: 'zeropeek',
      POSTGRES_PASSWORD: 's3cr3t',
      POSTGRES_DB: 'zeropeek',
    });
    expect(config.databaseUrl).toBe('postgresql://zeropeek:s3cr3t@db:5432/zeropeek?schema=public');
  });

  it('rejects an empty SESSION_SECRET', () => {
    expect(() => loadConfig({ ...VALID_PRODUCTION, SESSION_SECRET: '' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...VALID_PRODUCTION, SESSION_SECRET: '' })).toThrow(/SESSION_SECRET/);
  });

  it('rejects an empty REDIS_URL', () => {
    expect(() => loadConfig({ ...VALID_PRODUCTION, REDIS_URL: '' })).toThrow(/REDIS_URL/);
  });

  it('rejects a missing or unbuildable DATABASE_URL', () => {
    expect(() => loadConfig({ ...VALID_PRODUCTION, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('rejects a missing APP_BASE_URL', () => {
    expect(() => loadConfig({ ...VALID_PRODUCTION, APP_BASE_URL: '' })).toThrow(/APP_BASE_URL/);
  });

  it('rejects a non-http APP_BASE_URL', () => {
    expect(() => loadConfig({ ...VALID_PRODUCTION, APP_BASE_URL: 'quiz.example.com' })).toThrow(
      /absolute http\(s\) URL/,
    );
  });

  it('rejects a localhost APP_BASE_URL in production', () => {
    expect(() =>
      loadConfig({ ...VALID_PRODUCTION, APP_BASE_URL: 'http://localhost:8080' }),
    ).toThrow(/localhost/);
  });

  it('reports every problem in one message', () => {
    try {
      loadConfig({
        NODE_ENV: 'production',
        APP_BASE_URL: '',
        SESSION_SECRET: '',
        DATABASE_URL: '',
        REDIS_URL: '',
      });
      throw new Error('expected loadConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as ConfigError).message;
      for (const variable of ['SESSION_SECRET', 'DATABASE_URL', 'REDIS_URL', 'APP_BASE_URL']) {
        expect(message).toContain(variable);
      }
    }
  });
});

describe('loadConfig outside production', () => {
  it('keeps lenient defaults in development', () => {
    const config = loadConfig({});
    expect(config.nodeEnv).toBe('development');
    expect(config.sessionSecret).toBe('phase-0-placeholder');
    expect(config.databaseUrl).toBe('');
  });

  it('treats set-but-empty values as unset', () => {
    const config = loadConfig({
      APP_BASE_URL: '',
      CORS_ORIGIN: '',
      SESSION_SECRET: '',
      REDIS_URL: '',
    });
    expect(config.appBaseUrl).toBe('http://localhost:8080');
    expect(config.corsOrigin).toBe('http://localhost:8080');
    expect(config.sessionSecret).toBe('phase-0-placeholder');
    expect(config.redisUrl).toBe('redis://cache:6379');
  });

  it('does not require secrets in test mode', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('reads SESSION_TTL_HOURS and falls back to 72h', () => {
    expect(loadConfig({ SESSION_TTL_HOURS: '1' }).sessionTtlMs).toBe(60 * 60 * 1000);
    expect(loadConfig({ SESSION_TTL_HOURS: 'nope' }).sessionTtlMs).toBe(72 * 60 * 60 * 1000);
    expect(loadConfig({}).sessionTtlMs).toBe(72 * 60 * 60 * 1000);
  });
});
