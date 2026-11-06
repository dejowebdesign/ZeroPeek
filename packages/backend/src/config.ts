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

/** Where the effective `DATABASE_URL` came from. */
export type DatabaseUrlSource = 'explicit' | 'derived' | 'none';

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
  /** Where `databaseUrl` came from: an explicit value, derived, or none. */
  databaseUrlSource: DatabaseUrlSource;
  /**
   * `host:port/database` (as user) of `databaseUrl`, with **no password** – safe
   * to log, so a failure names the target that was actually used instead of
   * leaving the operator to guess. `null` when it cannot be parsed.
   */
  databaseTarget: string | null;
  /**
   * Non-fatal configuration observations (e.g. a localhost public URL). They are
   * logged on start but do not stop the backend, so a working deployment is
   * never blocked by a value that only degrades quality.
   */
  warnings: string[];
  /** Bootstrap admin credentials; when both are set and no admin exists yet,
   * the account is created on boot. Never logged. */
  bootstrapAdminUser?: string;
  bootstrapAdminPassword?: string;
  /**
   * Outgoing mail (Phase 6.3). `smtpUrl` is a Nodemailer connection URL
   * (`smtp://user:pass@host:port` or `smtps://…`); when empty, mail sending is
   * disabled and registration still works (the verification link is logged in
   * development only – never the token in production). `mailFrom` is the
   * verified sender address, `mailFromName` its display name.
   */
  smtpUrl: string;
  mailFrom: string;
  mailFromName: string;
  /** How long a verification link stays valid (`MAIL_VERIFY_TTL_HOURS`, default 24). */
  emailVerifyTtlMs: number;
  /**
   * Whether the stricter per-route limits on the auth endpoints are enforced.
   * On everywhere except the test environment (where a suite would trip them),
   * unless `AUTH_RATE_LIMITS` says otherwise – which lets a test switch them on
   * to prove they actually reject a flood.
   */
  authRateLimits: boolean;
}

/** Whether outgoing mail is configured (an SMTP URL and a sender are both set). */
export function isMailConfigured(config: Pick<AppConfig, 'smtpUrl' | 'mailFrom'>): boolean {
  return config.smtpUrl.trim().length > 0 && config.mailFrom.trim().length > 0;
}

/** Read a positive hour count for the verification-link lifetime (default 24h). */
function readVerifyTtlMs(value: string | undefined): number {
  const hours = Number.parseInt(value ?? '', 10);
  if (Number.isInteger(hours) && hours > 0) return hours * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

/** Whether the auth rate limits are enforced: on unless explicitly disabled. */
function readAuthRateLimits(value: string | undefined): boolean {
  return !['0', 'false', 'off', 'no'].includes((value ?? '').trim().toLowerCase());
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

/**
 * A short, password-free description of a connection string: `user@host:port/db`.
 *
 * It is safe to log and is what turns a bare "the database is not reachable"
 * into a message that names the host, port, database and user that were actually
 * used. The password is never part of the result. Returns `null` for a value that
 * is not a parseable URL.
 */
export function describeDatabaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const user = decodeURIComponent(url.username || '');
    const database = url.pathname.replace(/^\//, '');
    const auth = user ? `${user}@` : '';
    return `${auth}${url.hostname}:${url.port || '5432'}/${database}`;
  } catch {
    return null;
  }
}

/** Whether a connection string uses the `postgresql:`/`postgres:` scheme. */
export function isPostgresUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'postgresql:' || protocol === 'postgres:';
  } catch {
    return false;
  }
}

/** Obvious "replace me" values shipped in the example files. */
const PLACEHOLDER_SECRETS = [
  'change-me-session-secret',
  'please-generate-a-32-byte-hex-secret',
  'phase-0-placeholder',
];

/**
 * Whether a session secret still looks like a placeholder or is trivially short.
 *
 * A secret that was copied from an example file, or that is shorter than the
 * 32 characters `openssl rand -hex 32` produces, does not protect a production
 * deployment and is almost always an oversight, so it is treated as an error in
 * production.
 */
export function isPlaceholderSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 32) return true;
  return PLACEHOLDER_SECRETS.some((placeholder) => normalized.includes(placeholder));
}

/**
 * Compare the host, port, database and user of two connection strings, ignoring
 * the password. Used to warn when an explicit `DATABASE_URL` silently points
 * somewhere other than the `POSTGRES_*` values next to it.
 */
function sameDatabaseTarget(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return (
      left.hostname === right.hostname &&
      (left.port || '5432') === (right.port || '5432') &&
      left.pathname === right.pathname &&
      left.username === right.username
    );
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
  // Redis is optional (Socket.IO scaling / rate limiting). The compose service
  // is named `cache`, so this default is always correct for the bundled stack;
  // the backend additionally probes the connection at start and logs a warning
  // instead of failing, because a cache outage must not take the app down.
  const redisUrl = isNonEmpty(env.REDIS_URL) ? env.REDIS_URL : 'redis://cache:6379';
  const databaseUrl = resolveDatabaseUrl(env) ?? '';
  const databaseUrlSource: DatabaseUrlSource = isNonEmpty(env.DATABASE_URL)
    ? 'explicit'
    : databaseUrl
      ? 'derived'
      : 'none';
  const databaseTarget = databaseUrl ? describeDatabaseUrl(databaseUrl) : null;

  // `COOKIE_SECURE` is derived from the scheme of `APP_BASE_URL` unless it is
  // set explicitly. A cookie marked `Secure` is dropped by the browser over
  // plain HTTP, which silently breaks login, so the default must follow the
  // deployment rather than assume HTTPS.
  const cookieSecure = isNonEmpty(env.COOKIE_SECURE)
    ? env.COOKIE_SECURE === 'true'
    : appBaseUrl.startsWith('https://');

  const warnings: string[] = [];

  if (nodeEnv === 'production') {
    const problems: string[] = [];

    if (!isNonEmpty(env.SESSION_SECRET)) {
      problems.push(
        'SESSION_SECRET is missing or empty. Set a long random value, e.g. `openssl rand -hex 32`.',
      );
    } else if (isPlaceholderSecret(sessionSecret)) {
      // A secret copied from an example file, or shorter than the 32 characters
      // `openssl rand -hex 32` produces, does not protect a production
      // deployment and is almost always an oversight.
      problems.push(
        'SESSION_SECRET still looks like a placeholder or is too short. Replace it with a long random value, e.g. `openssl rand -hex 32`.',
      );
    }

    if (!isNonEmpty(databaseUrl)) {
      problems.push(
        'DATABASE_URL is missing or empty and cannot be derived. Set DATABASE_URL, or set POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB so it can be built automatically.',
      );
    } else if (!isPostgresUrl(databaseUrl)) {
      problems.push(
        `DATABASE_URL must be a PostgreSQL connection string (postgresql://…), got "${databaseTarget ?? databaseUrl}".`,
      );
    } else if (databaseUrlSource === 'explicit' && isNonEmpty(env.POSTGRES_USER)) {
      // An explicit DATABASE_URL wins over the POSTGRES_* values. When it names a
      // different host/port/database/user than those values, it is almost always
      // a leftover placeholder (e.g. the one from .env.example) and is the reason
      // a deployment that looks correctly configured still cannot reach the
      // database. Warn loudly instead of failing, because an external database is
      // a legitimate setup.
      const derived = resolveDatabaseUrl({ ...env, DATABASE_URL: undefined });
      if (derived && !sameDatabaseTarget(databaseUrl, derived)) {
        warnings.push(
          `DATABASE_URL is set explicitly and points at "${databaseTarget}", but the POSTGRES_* values describe "${describeDatabaseUrl(derived)}". The explicit DATABASE_URL wins. If the database is the bundled \`db\` service, clear DATABASE_URL so it is derived from POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB.`,
        );
      }
    }

    // REDIS_URL is intentionally not required: it defaults to the bundled
    // `cache` service and the app degrades gracefully without Redis.

    if (!isNonEmpty(env.APP_BASE_URL) && !isNonEmpty(env.PUBLIC_BASE_URL)) {
      problems.push(
        'APP_BASE_URL is missing or empty. Set the public origin, e.g. `https://quiz.example.com`.',
      );
    } else if (!isHttpUrl(appBaseUrl)) {
      problems.push(`APP_BASE_URL must be an absolute http(s) URL, got "${appBaseUrl}".`);
    } else if (isLoopbackUrl(appBaseUrl)) {
      // A localhost public URL is a real deployment mistake, but it is only
      // reachable on the host itself – for an internal/plain-HTTP deployment it
      // is intentional. Warn instead of blocking, so the stack still deploys.
      warnings.push(
        `APP_BASE_URL points at localhost ("${appBaseUrl}"). Links, QR codes and cookie scope will not work for other devices. Set the origin users actually reach, e.g. \`https://quiz.example.com\`.`,
      );
    }

    if (isNonEmpty(env.CORS_ORIGIN) && !isHttpUrl(corsOrigin)) {
      problems.push(`CORS_ORIGIN must be an absolute http(s) URL, got "${corsOrigin}".`);
    }

    // Registration is optional, so a missing mail configuration is a warning,
    // not a blocker: the backend starts, but the verification e-mail cannot be
    // sent until SMTP_URL and MAIL_FROM are set.
    if (!isNonEmpty(env.SMTP_URL) || !isNonEmpty(env.MAIL_FROM)) {
      warnings.push(
        'SMTP_URL and/or MAIL_FROM are not set, so verification e-mails cannot be sent. Player registration still works, but new players cannot confirm their address until both are configured (see docs/deployment/ENVIRONMENT.md).',
      );
    }

    if (problems.length > 0) {
      throw new ConfigError(
        ['SESSION_SECRET', 'DATABASE_URL', 'APP_BASE_URL', 'CORS_ORIGIN'],
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
    cookieSecure,
    sessionCookieName: isNonEmpty(env.COOKIE_NAME)
      ? env.COOKIE_NAME
      : isNonEmpty(env.SESSION_COOKIE_NAME)
        ? env.SESSION_COOKIE_NAME
        : 'zp_session',
    sessionTtlMs: readSessionTtlMs(env.SESSION_TTL_HOURS),
    redisUrl,
    sessionSecret,
    databaseUrl,
    databaseUrlSource,
    databaseTarget,
    warnings,
    ...(env.BOOTSTRAP_ADMIN_USER ? { bootstrapAdminUser: env.BOOTSTRAP_ADMIN_USER } : {}),
    ...(env.BOOTSTRAP_ADMIN_PASSWORD
      ? { bootstrapAdminPassword: env.BOOTSTRAP_ADMIN_PASSWORD }
      : {}),
    smtpUrl: isNonEmpty(env.SMTP_URL) ? env.SMTP_URL : '',
    mailFrom: isNonEmpty(env.MAIL_FROM) ? env.MAIL_FROM : '',
    mailFromName: isNonEmpty(env.MAIL_FROM_NAME) ? env.MAIL_FROM_NAME : 'ZeroPeek',
    emailVerifyTtlMs: readVerifyTtlMs(env.MAIL_VERIFY_TTL_HOURS),
    // Disabled in tests by default (a suite makes many requests); an explicit
    // AUTH_RATE_LIMITS value always wins, so a test can turn them back on.
    authRateLimits:
      env.AUTH_RATE_LIMITS === undefined
        ? nodeEnv !== 'test'
        : readAuthRateLimits(env.AUTH_RATE_LIMITS),
  };
}
