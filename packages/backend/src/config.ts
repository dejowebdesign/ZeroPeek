/**
 * Environment configuration.
 *
 * Reads process.env once, validates the essentials and exposes a typed object.
 * Later phases extend this (session secret, SMTP, Redis). Phase 0 keeps it
 * minimal so the app boots without a database connection.
 */

export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  host: string;
  /** Public origin of the app (links, QR codes, cookie scope). */
  appBaseUrl: string;
  /** Allowed browser origin for CORS. */
  corsOrigin: string;
  logLevel: string;
  cookieSecure: boolean;
  sessionCookieName: string;
}

function readNodeEnv(value: string | undefined): NodeEnv {
  if (value === 'production' || value === 'test') return value;
  return 'development';
}

function readPort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) return parsed;
  return fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // `APP_BASE_URL` is the documented name; `PUBLIC_BASE_URL` is kept as a
  // fallback so older deployments keep working.
  const appBaseUrl = env.APP_BASE_URL ?? env.PUBLIC_BASE_URL ?? 'http://localhost:8080';

  return {
    nodeEnv: readNodeEnv(env.NODE_ENV),
    port: readPort(env.BACKEND_PORT, 3000),
    host: env.BACKEND_HOST ?? '0.0.0.0',
    appBaseUrl,
    corsOrigin: env.CORS_ORIGIN ?? appBaseUrl,
    logLevel: env.LOG_LEVEL ?? 'info',
    cookieSecure: env.COOKIE_SECURE === 'true',
    sessionCookieName: env.COOKIE_NAME ?? env.SESSION_COOKIE_NAME ?? 'zp_session',
  };
}
