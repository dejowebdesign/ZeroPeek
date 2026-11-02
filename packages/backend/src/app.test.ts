import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';

describe('config', () => {
  it('applies defaults in development', () => {
    const config = loadConfig({});
    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.cookieSecure).toBe(false);
  });

  it('reads provided values', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      BACKEND_PORT: '4321',
      COOKIE_SECURE: 'true',
      SESSION_COOKIE_NAME: 'zp_test',
    });
    expect(config.nodeEnv).toBe('production');
    expect(config.port).toBe(4321);
    expect(config.cookieSecure).toBe(true);
    expect(config.sessionCookieName).toBe('zp_test');
  });

  it('ignores an invalid port', () => {
    expect(loadConfig({ BACKEND_PORT: 'not-a-number' }).port).toBe(3000);
    expect(loadConfig({ BACKEND_PORT: '99999' }).port).toBe(3000);
  });
});

describe('health endpoint', () => {
  it('reports ok and the shared question type count', async () => {
    const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test' }) });
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('zeropeek-backend');
    expect(body.questionTypes).toBe(13);

    await app.close();
  });

  it('sets hardening headers', async () => {
    const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test' }) });
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(String(response.headers['content-security-policy'])).toContain("default-src 'self'");

    await app.close();
  });
});
