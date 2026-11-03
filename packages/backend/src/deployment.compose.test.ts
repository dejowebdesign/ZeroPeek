/**
 * Guards the Portainer deployment contract.
 *
 * `docker-compose.portainer.yml` fails the whole deployment with
 * `required variable <NAME> is missing a value` when a variable guarded with
 * Compose's `:?` operator is not set. That error appears one variable at a time,
 * so a variable added to the compose file but forgotten in the Portainer
 * documentation only surfaces as a failed deployment.
 *
 * These tests read the real repository files and assert that:
 *   1. every `:?`-guarded variable is documented in PORTAINER.md, ENVIRONMENT.md
 *      and the Portainer environment template, so users can set them in one pass;
 *   2. the variables that have a working default are NOT guarded, so a missing
 *      entry cannot stop the deployment again.
 *
 * They are pure file checks: no container, no database and no secret is touched.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isPlaceholderSecret } from './config.js';

const repoRoot = new URL('../../../', import.meta.url);

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

const compose = read('docker-compose.portainer.yml');
const devCompose = read('docker-compose.yml');
const portainerDoc = read('docs/deployment/PORTAINER.md');
const environmentDoc = read('docs/deployment/ENVIRONMENT.md');
const envTemplate = read('.env.portainer.example');

/** Names of every variable guarded with Compose's `:?` operator. */
function requiredVariables(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/\$\{([A-Z0-9_]+):\?/g)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names].sort();
}

/** Names of every variable that has a default (`:-`) in the compose file. */
function defaultedVariables(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/\$\{([A-Z0-9_]+):-/g)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names].sort();
}

const required = requiredVariables(compose);
const defaulted = defaultedVariables(compose);

describe('docker-compose.portainer.yml required variables', () => {
  it('requires exactly the four documented secrets', () => {
    expect(required).toEqual([
      'POSTGRES_DB',
      'POSTGRES_PASSWORD',
      'POSTGRES_USER',
      'SESSION_SECRET',
    ]);
  });

  it('documents every required variable in PORTAINER.md', () => {
    for (const name of required) {
      expect(portainerDoc, `${name} is missing from PORTAINER.md`).toContain(`\`${name}\``);
    }
  });

  it('documents every required variable in ENVIRONMENT.md', () => {
    for (const name of required) {
      expect(environmentDoc, `${name} is missing from ENVIRONMENT.md`).toContain(`\`${name}\``);
    }
  });

  it('lists every required variable in the Portainer environment template', () => {
    for (const name of required) {
      expect(envTemplate, `${name} is missing from .env.portainer.example`).toContain(`${name}=`);
    }
  });

  it('does not guard variables that have a working default', () => {
    // A `:?` guard on any of these would make the stack fail again on a value
    // the compose file already knows (APP_BASE_URL) or can derive
    // (DATABASE_URL from POSTGRES_*, REDIS_URL from the `cache` service).
    for (const name of [
      'APP_BASE_URL',
      'DATABASE_URL',
      'REDIS_URL',
      'CORS_ORIGIN',
      'COOKIE_SECURE',
    ]) {
      expect(required, `${name} must not be a required (:?) variable`).not.toContain(name);
      expect(defaulted, `${name} should have a default`).toContain(name);
    }
  });
});

describe('docker-compose.portainer.yml proxy ports', () => {
  it('publishes container port 80 for the ACME challenge and redirect', () => {
    // TLS mode listens on 443, but the ACME HTTP-01 challenge and the HTTP->HTTPS
    // redirect always need container port 80 published. The host side is
    // ZP_HTTP_CHALLENGE_PORT (default HTTP_PORT, so plain HTTP mode is unchanged).
    const challengePort = compose
      .split('\n')
      .find((line) => line.includes('ZP_HTTP_CHALLENGE_PORT') && line.includes(':80'));
    expect(challengePort, 'proxy must publish container port 80').toBeDefined();
  });
});

describe('backend entrypoint diagnostics', () => {
  const entrypoint = read('docker/backend-entrypoint.sh');

  it('names the resolved database target (host/port/db) so failures are unambiguous', () => {
    expect(entrypoint).toContain('ZP_DATABASE_TARGET');
    expect(entrypoint).toMatch(/database target:/);
  });

  it('explains that an explicit DATABASE_URL takes precedence over POSTGRES_*', () => {
    expect(entrypoint).toMatch(/clear DATABASE_URL/);
  });

  it('reports the number of attempts and leaves the volume untouched', () => {
    expect(entrypoint).toMatch(/database is not reachable after/);
    expect(entrypoint).toMatch(/volume was left untouched/);
  });

  it('never echoes the resolved connection string (which contains the password)', () => {
    // The resolved URL is assigned to DATABASE_URL and exported; it must never be
    // printed. Only the password-free target is echoed.
    expect(entrypoint).not.toMatch(/echo[^\n]*\$\{?DATABASE_URL\b/);
    expect(entrypoint).not.toMatch(/echo[^\n]*\$DATABASE_URL\b/);
  });
});

describe('docker-compose.yml (local development)', () => {
  it('does not guard any variable with `:?`, so a fresh clone needs no secrets', () => {
    // `docker compose up --build` must work on a clean checkout. A `:?` guard
    // here would abort the local stack on a variable the developer has not set.
    expect(requiredVariables(devCompose)).toEqual([]);
  });

  it('defaults NODE_ENV to development, not production', () => {
    // The strict production validation (placeholder secrets, real APP_BASE_URL,
    // postgresql:// DATABASE_URL) must not apply to the local stack. Defaulting
    // to `production` while the other defaults are placeholders stopped the
    // backend on start; `development` keeps the local flow working.
    expect(devCompose).toMatch(/NODE_ENV:\s*\$\{NODE_ENV:-development\}/);
    expect(devCompose).not.toMatch(/NODE_ENV:\s*\$\{NODE_ENV:-production\}/);
  });
});

describe('portainer stack vs local stack', () => {
  it('keeps the production stack the only one that requires secrets', () => {
    expect(required).toEqual([
      'POSTGRES_DB',
      'POSTGRES_PASSWORD',
      'POSTGRES_USER',
      'SESSION_SECRET',
    ]);
    expect(requiredVariables(devCompose)).toEqual([]);
  });

  it('documents the GHCR package-visibility caveat for a private repository', () => {
    // Changing the repository to private does NOT change the visibility of the
    // packages already published under ghcr.io; they must be checked separately
    // or Portainer pulls fail with `unauthorized`.
    expect(portainerDoc).toMatch(/package(s)?[^\n]*visib|visib[^\n]*package/i);
    expect(portainerDoc).toMatch(/private/i);
  });
});

describe('preliminary deployment values (PORTAINER.md section 5.4)', () => {
  // The documented "get it running once" values must actually pass the backend
  // validation, or the copy-paste instructions start a backend that refuses to
  // boot. They are deliberately obvious placeholders, not secrets.
  const preliminarySecret = 'preliminary-session-secret-replace-before-production-01';
  const preliminaryPassword = 'zeropeek-preliminary-password';

  it('documents the preliminary values in the Portainer guide', () => {
    expect(portainerDoc).toContain(preliminarySecret);
    expect(portainerDoc).toContain(preliminaryPassword);
  });

  it('uses a SESSION_SECRET that is long enough and not a rejected placeholder', () => {
    expect(preliminarySecret.length).toBeGreaterThanOrEqual(32);
    expect(isPlaceholderSecret(preliminarySecret)).toBe(false);
  });

  it('does not mistake the template placeholders for the preliminary values', () => {
    // The template keeps its own `change-me-*` values, which the backend DOES
    // reject – that is the signal to replace them.
    expect(isPlaceholderSecret('change-me-session-secret')).toBe(true);
    expect(envTemplate).toContain('SESSION_SECRET=change-me-session-secret');
  });
});
