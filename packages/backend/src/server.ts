/**
 * Backend entry point.
 *
 * Boots the Fastify app, attaches Socket.IO to the same HTTP server, optionally
 * creates the first administrator, and handles graceful shutdown.
 */

import { createConnection } from 'node:net';

import { buildApp } from './app.js';
import { type AppConfig, ConfigError, loadConfig } from './config.js';
import { disconnectPrisma } from './db.js';
import { ensureBootstrapAdmin } from './services/userService.js';
import { attachSocketIO } from './socket.js';

/** The subset of the logger used here, so the probe stays easy to test. */
interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

/**
 * Probe Redis with a minimal RESP `PING`.
 *
 * Redis is optional – it is only used for Socket.IO scaling and rate limiting –
 * so an unreachable cache logs a warning and the backend still starts. The
 * credentials are never logged; only `host:port` appears in the message.
 */
async function probeRedis(redisUrl: string, log: Logger): Promise<void> {
  let target: URL;
  try {
    target = new URL(redisUrl);
  } catch {
    log.warn('REDIS_URL is not a valid URL; Redis is unavailable. This is not fatal.');
    return;
  }
  const host = target.hostname;
  const port = Number.parseInt(target.port || '6379', 10);
  const password = decodeURIComponent(target.password || '');

  await new Promise<void>((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (ok: boolean, detail: string): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (ok) {
        log.info(`Redis is reachable at ${host}:${port}.`);
      } else {
        log.warn(
          `Redis is not reachable at ${host}:${port} (${detail}). The backend continues without it – Socket.IO scaling and rate limiting degrade gracefully.`,
        );
      }
      resolve();
    };

    socket.setTimeout(3000);
    socket.on('timeout', () => finish(false, 'connection timed out'));
    socket.on('error', (error) => {
      finish(false, (error as NodeJS.ErrnoException).code ?? 'connection error');
    });
    socket.on('connect', () => {
      const command = password
        ? `*2\r\n$4\r\nAUTH\r\n$${Buffer.byteLength(password)}\r\n${password}\r\n*1\r\n$4\r\nPING\r\n`
        : '*1\r\n$4\r\nPING\r\n';
      socket.write(command);
    });
    socket.on('data', (data) => {
      const text = data.toString();
      if (text.includes('PONG')) finish(true, 'PONG');
      else if (text.includes('-')) finish(false, text.replace(/\r\n/g, ' ').trim());
    });
  });
}

async function main(): Promise<void> {
  // Validate the environment first. A misconfigured stack fails here with a
  // readable message instead of starting a container that can never serve.
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const app = await buildApp({ config });

  // Non-fatal observations (e.g. a localhost APP_BASE_URL). They do not stop the
  // backend, but the operator should see them.
  for (const warning of config.warnings) {
    app.log.warn(warning);
  }

  // Redis is optional, so a failure here is a warning, never a crash.
  await probeRedis(config.redisUrl, app.log);

  // Create the first admin from the environment when none exists yet. This is
  // the only way in on a fresh deployment; it is a no-op afterwards.
  const hasBootstrapUser = Boolean(config.bootstrapAdminUser);
  const hasBootstrapPassword = Boolean(config.bootstrapAdminPassword);
  if (hasBootstrapUser !== hasBootstrapPassword) {
    app.log.warn(
      'BOOTSTRAP_ADMIN_USER and BOOTSTRAP_ADMIN_PASSWORD must both be set to create the first administrator; only one is set, so none was created.',
    );
  } else if (hasBootstrapUser && hasBootstrapPassword) {
    try {
      const created = await ensureBootstrapAdmin(
        config.bootstrapAdminUser,
        config.bootstrapAdminPassword,
      );
      if (created) app.log.info('bootstrap administrator created');
    } catch (error) {
      app.log.error({ error }, 'could not create the bootstrap administrator');
    }
  }

  const sockets = attachSocketIO(app.server, config, config.corsOrigin);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await sockets.close();
      await app.close();
      await disconnectPrisma();
      process.exit(0);
    } catch (error) {
      app.log.error({ error }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error) {
    app.log.error({ error }, 'failed to start server');
    process.exit(1);
  }
}

void main();
