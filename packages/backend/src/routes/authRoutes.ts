/**
 * Authentication routes.
 *
 * `POST /api/auth/login` verifies credentials and starts a session.
 * `POST /api/auth/logout` ends it. `GET /api/auth/me` reports the current
 * session, including the CSRF token the client must echo on writes.
 */

import type { FastifyInstance } from 'fastify';

import { badRequest, unauthorized } from '../errors.js';
import { authenticate } from '../services/userService.js';
import { currentUser, endSession, requireAuth, startSession } from '../sessions.js';
import type { AppConfig } from '../config.js';

interface LoginBody {
  username?: string;
  password?: string;
}

export function registerAuthRoutes(app: FastifyInstance, config: AppConfig): void {
  app.post<{ Body: LoginBody }>('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      throw badRequest('A username and password are required.');
    }

    const user = await authenticate(username, password);
    if (!user) {
      request.log.warn({ username }, 'failed login');
      throw unauthorized('Invalid username or password.');
    }

    const csrfToken = await startSession(reply, config, user.id);
    request.log.info({ userId: user.id }, 'login');
    return { user, csrfToken };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await endSession(request, reply, config);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth(config) }, async (request) => {
    const user = currentUser(request);
    return { user, csrfToken: request.auth?.csrfToken ?? '' };
  });
}
