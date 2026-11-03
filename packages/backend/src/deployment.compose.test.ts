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

const repoRoot = new URL('../../../', import.meta.url);

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

const compose = read('docker-compose.portainer.yml');
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
