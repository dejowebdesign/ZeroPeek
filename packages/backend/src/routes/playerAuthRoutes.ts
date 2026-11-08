/**
 * Player authentication routes (Phase 6.6.3).
 *
 * A **separate** context from the host/staff login: these routes issue and clear
 * only `zp_player_session`, so a player can be signed in alongside a host in the
 * same browser without either overwriting the other.
 *
 * Only the `PLAYER` role may use this surface. A staff account (ADMIN/TRAINER)
 * is refused here, so a host is never silently given a player identity; staff
 * keep using `POST /api/auth/login` unchanged.
 */

import type { FastifyInstance } from 'fastify';

import { AppError, badRequest, forbidden, unauthorized } from '../errors.js';
import { verifyCredentials } from '../services/userService.js';
import {
  currentPlayer,
  endPlayerSession,
  requirePlayerAuth,
  startPlayerSession,
} from '../sessions.js';
import type { AppConfig } from '../config.js';

interface LoginBody {
  username?: string;
  password?: string;
}

export function registerPlayerAuthRoutes(app: FastifyInstance, config: AppConfig): void {
  /**
   * The same stricter ceiling the staff auth endpoints use, so the player login
   * cannot be used to brute-force a password any faster.
   */
  const limit = (max: number) => ({
    config: {
      rateLimit: {
        max: config.authRateLimits ? max : 10_000,
        timeWindow: '1 minute',
      },
    },
  });

  app.post<{ Body: LoginBody }>('/api/player-auth/login', limit(30), async (request, reply) => {
    const { username, password } = request.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      throw badRequest('A username and password are required.');
    }

    const result = await verifyCredentials(username, password);
    if (result.status === 'invalid') {
      request.log.warn({ username }, 'failed player login');
      throw unauthorized('Invalid username or password.');
    }
    if (result.status === 'unverified') {
      throw new AppError(403, 'email_unverified', 'Please confirm your e-mail address first.');
    }
    // Only a player account may hold a player session. A staff account is told
    // to use the staff login instead, and is never given a player identity here.
    if (result.user.role !== 'PLAYER') {
      throw forbidden('This account is a host account. Sign in as a host instead.');
    }

    const csrfToken = await startPlayerSession(reply, config, result.user.id);
    request.log.info({ userId: result.user.id }, 'player login');
    return { user: result.user, csrfToken };
  });

  app.post('/api/player-auth/logout', async (request, reply) => {
    await endPlayerSession(request, reply, config);
    return { ok: true };
  });

  app.get('/api/player-auth/me', { preHandler: requirePlayerAuth(config) }, async (request) => {
    const user = currentPlayer(request);
    return { user, csrfToken: request.playerAuth?.csrfToken ?? '' };
  });
}
