/**
 * Backend entry point.
 *
 * Boots the Fastify app, attaches Socket.IO to the same HTTP server, optionally
 * creates the first administrator, and handles graceful shutdown.
 */

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { disconnectPrisma } from './db.js';
import { ensureBootstrapAdmin } from './services/userService.js';
import { attachSocketIO } from './socket.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config });

  // Create the first admin from the environment when none exists yet. This is
  // the only way in on a fresh deployment; it is a no-op afterwards.
  try {
    const created = await ensureBootstrapAdmin(
      config.bootstrapAdminUser,
      config.bootstrapAdminPassword,
    );
    if (created) app.log.info('bootstrap administrator created');
  } catch (error) {
    app.log.error({ error }, 'could not create the bootstrap administrator');
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
