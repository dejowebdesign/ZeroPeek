/**
 * Environment configuration.
 *
 * Reads `process.env` once, validates the essentials and exposes a typed
 * object. `loadConfig` is strict in production: a missing or invalid value
 * raises a `ConfigError` whose message names the variable, explains why it is
 * wrong and shows how to fix it – so a misconfigured stack fails immediately
 * with a readable log line instead of a restart loop. In development and test
 * the previous lenient defaults are kept so the app boots without a full
 * environment.
 *
 * `DATABASE_URL` may be derived from the PostgreSQL parts
 * (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, optional
 * `POSTGRES_HOST`/`POSTGRES_PORT`). That keeps the credentials in one place and
 * guarantees the connection string matches the database container, even when
 * the password contains URL-significant characters, which are percent-encoded
 * automatically.
 */

export type NodeEnv = 'development' | 'test' | 'production';

/** Raised when a required configuration value is missing or invalid. */
export class ConfigError extends Error {
  /** Names of the offending environment variables. */
  readonly variables: string[];

  constructor(variables: string[], message: string) {
    super(message);
    this.name = 'ConfigError';
    this.variables = variables;
  }
}

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
  /** Session lifetime in milliseconds (`SESSION_TTL_HOURS`, default 72h). */
  sessionTtlMs: number;
  /** Redis connection string, used for the Socket.IO adapter. */
  redisUrl: string;
  /** Secret used to sign cookies. Required in production. */
  sessionSecret: string;
  /** PostgreSQL connection string consumed by Prisma. */
  databaseUrl: string;
  /** Bootstrap admin credentials; when both are set and no admin exists yet,
   * the account is created on boot. Never logged. */
  bootstrapAdminUser?: string;
  bootstrapAdminPassword?: string;
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

/** Read a positive hour count, falling back to the default (72 hours). */
function readSessionTtlMs(value: string | undefined): number {
  const hours = Number.parseInt(value ?? '', 10);
  if (Number.isInteger(hours) && hours > 0) return hours * 60 * 60 * 1000;
  return 72 * 60 * 60 * 1000;
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Percent-encode a value for use inside a URL component (userinfo or path).
 * `encodeURIComponent` leaves `!'()*` untouched, but those are not allowed
 * unencoded in the userinfo, so they are encoded explicitly. This is what makes
 * a password containing `@`, `:`, `/`, `#`, `?`, `%` or a space safe to embed.
 */
function encodeUrlComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => {
    return `%${char.charCodeAt(0).toString(16).toUpperCase()}`;
  });
}

/**
 * Resolve the PostgreSQL connection string.
 *
 * `DATABASE_URL` wins when set. Otherwise it is derived from the individual
 * `POSTGRES_*` values with the password encoded safely. Returns `undefined`
 * when neither is available.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  if (isNonEmpty(env.DATABASE_URL)) return env.DATABASE_URL;

  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = env;
  if (!isNonEmpty(POSTGRES_USER) || !isNonEmpty(POSTGRES_PASSWORD) || !isNonEmpty(POSTGRES_DB)) {
    return undefined;
  }

  const host = isNonEmpty(env.POSTGRES_HOST) ? env.POSTGRES_HOST : 'db';
  const port = isNonEmpty(env.POSTGRES_PORT) ? env.POSTGRES_PORT : '5432';
  const user = encodeUrlComponent(POSTGRES_USER);
  const password = encodeUrlComponent(POSTGRES_PASSWORD);
  const database = encodeUrlComponent(POSTGRES_DB);
  return `postgresql://${user}:${password}@${host}:${port}/${database}?schema=public`;
}

/** Whether a value parses as an absolute http(s) URL. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** A localhost origin, used to flag plain-HTTP public URLs in production. */
function isLoopbackUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = readNodeEnv(env.NODE_ENV);

  // Every string value treats "set but empty" as unset: an empty value would
  // otherwise be used verbatim (e.g. an empty CORS origin makes `@fastify/cors`
  // throw, and an empty cookie name is invalid). `APP_BASE_URL` is the
  // documented name; `PUBLIC_BASE_URL` is kept as a fallback so older
  // deployments keep working.
  const appBaseUrl = isNonEmpty(env.APP_BASE_URL)
    ? env.APP_BASE_URL
    : isNonEmpty(env.PUBLIC_BASE_URL)
      ? env.PUBLIC_BASE_URL
      : 'http://localhost:8080';
  const corsOrigin = isNonEmpty(env.CORS_ORIGIN) ? env.CORS_ORIGIN : appBaseUrl;
  const sessionSecret = isNonEmpty(env.SESSION_SECRET) ? env.SESSION_SECRET : 'phase-0-placeholder';
  const redisUrl = isNonEmpty(env.REDIS_URL) ? env.REDIS_URL : 'redis://cache:6379';
  const databaseUrl = resolveDatabaseUrl(env) ?? '';

  if (nodeEnv === 'production') {
    const problems: string[] = [];

    if (!isNonEmpty(env.SESSION_SECRET)) {
      problems.push(
        'SESSION_SECRET is missing or empty. Set a long random value, e.g. `openssl rand -hex 32`.',
      );
    }

    if (!isNonEmpty(databaseUrl)) {
      problems.push(
        'DATABASE_URL is missing or empty and cannot be derived. Set DATABASE_URL, or set POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB so it can be built automatically.',
      );
    }

    if (!isNonEmpty(env.REDIS_URL)) {
      problems.push(
        'REDIS_URL is missing or empty. Set it to the cache service, e.g. `redis://cache:6379`.',
      );
    }

    if (!isNonEmpty(env.APP_BASE_URL) && !isNonEmpty(env.PUBLIC_BASE_URL)) {
      problems.push(
        'APP_BASE_URL is missing or empty. Set the public origin, e.g. `https://quiz.example.com`.',
      );
    } else if (!isHttpUrl(appBaseUrl)) {
      problems.push(`APP_BASE_URL must be an absolute http(s) URL, got "${appBaseUrl}".`);
    } else if (isLoopbackUrl(appBaseUrl)) {
      problems.push(
        `APP_BASE_URL points at localhost ("${appBaseUrl}"). Set the public origin users reach, e.g. \`https://quiz.example.com\`.`,
      );
    }

    if (isNonEmpty(env.CORS_ORIGIN) && !isHttpUrl(corsOrigin)) {
      problems.push(`CORS_ORIGIN must be an absolute http(s) URL, got "${corsOrigin}".`);
    }

    if (problems.length > 0) {
      throw new ConfigError(
        ['SESSION_SECRET', 'DATABASE_URL', 'REDIS_URL', 'APP_BASE_URL', 'CORS_ORIGIN'],
        [
          'ZeroPeek backend cannot start: the configuration is incomplete or invalid.',
          '',
          ...problems.map((problem) => `  - ${problem}`),
          '',
          'Fix the values in the Portainer stack environment (see docs/deployment/PORTAINER.md) and redeploy.',
        ].join('\n'),
      );
    }
  }

  return {
    nodeEnv,
    port: readPort(env.BACKEND_PORT, 3000),
    host: env.BACKEND_HOST ?? '0.0.0.0',
    appBaseUrl,
    corsOrigin,
    logLevel: env.LOG_LEVEL ?? 'info',
    cookieSecure: env.COOKIE_SECURE === 'true',
    sessionCookieName: isNonEmpty(env.COOKIE_NAME)
      ? env.COOKIE_NAME
      : isNonEmpty(env.SESSION_COOKIE_NAME)
        ? env.SESSION_COOKIE_NAME
        : 'zp_session',
    sessionTtlMs: readSessionTtlMs(env.SESSION_TTL_HOURS),
    redisUrl,
    sessionSecret,
    databaseUrl,
    ...(env.BOOTSTRAP_ADMIN_USER ? { bootstrapAdminUser: env.BOOTSTRAP_ADMIN_USER } : {}),
    ...(env.BOOTSTRAP_ADMIN_PASSWORD
      ? { bootstrapAdminPassword: env.BOOTSTRAP_ADMIN_PASSWORD }
      : {}),
  };
}
