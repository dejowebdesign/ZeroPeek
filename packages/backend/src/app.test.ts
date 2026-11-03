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
    expect(config.appBaseUrl).toBe('http://localhost:8080');
    expect(config.corsOrigin).toBe('http://localhost:8080');
  });

  it('reads provided values', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      BACKEND_PORT: '4321',
      COOKIE_SECURE: 'true',
      COOKIE_NAME: 'zp_test',
      APP_BASE_URL: 'https://quiz.example.com',
      CORS_ORIGIN: 'https://other.example.com',
      SESSION_SECRET: 'a-very-long-random-secret',
      DATABASE_URL: 'postgresql://zeropeek:secret@db:5432/zeropeek?schema=public',
      REDIS_URL: 'redis://cache:6379',
    });
    expect(config.nodeEnv).toBe('production');
    expect(config.port).toBe(4321);
    expect(config.cookieSecure).toBe(true);
    expect(config.sessionCookieName).toBe('zp_test');
    expect(config.appBaseUrl).toBe('https://quiz.example.com');
    expect(config.corsOrigin).toBe('https://other.example.com');
    expect(config.databaseUrl).toBe('postgresql://zeropeek:secret@db:5432/zeropeek?schema=public');
  });

  it('falls back to the legacy PUBLIC_BASE_URL / SESSION_COOKIE_NAME names', () => {
    const config = loadConfig({
      PUBLIC_BASE_URL: 'https://legacy.example.com',
      SESSION_COOKIE_NAME: 'legacy_cookie',
    });
    expect(config.appBaseUrl).toBe('https://legacy.example.com');
    expect(config.corsOrigin).toBe('https://legacy.example.com');
    expect(config.sessionCookieName).toBe('legacy_cookie');
  });

  it('prefers APP_BASE_URL over the legacy name', () => {
    const config = loadConfig({
      APP_BASE_URL: 'https://new.example.com',
      PUBLIC_BASE_URL: 'https://legacy.example.com',
    });
    expect(config.appBaseUrl).toBe('https://new.example.com');
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
