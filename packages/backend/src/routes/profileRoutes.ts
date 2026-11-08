/**
 * Player profile routes (Phase 6.6).
 *
 * Both routes are for the **signed-in account itself**: the user id comes from
 * the session (`currentUser`), never from the request, so one account can never
 * read or change another's profile. The write is guarded by `requireAuth`, which
 * also enforces the CSRF token on `PUT`.
 *
 * There is deliberately **no** `/api/profile/history`: the quiz history stays
 * admin-only (product decision, Phase 5c). This module exposes only the account's
 * own summary.
 */

import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config.js';
import { currentUser, requireAuth } from '../sessions.js';
import { getProfile, updateProfile } from '../services/profileService.js';

export function registerProfileRoutes(app: FastifyInstance, config: AppConfig): void {
  const guard = { preHandler: requireAuth(config) };

  /** The authenticated account's own profile and personal statistics. */
  app.get('/api/profile', guard, async (request) => {
    const user = currentUser(request);
    return getProfile(user.id);
  });

  /**
   * Change the fields Phase 6.6 owns. A body carrying anything else — a
   * statistic, an XP value, a `userId` — is rejected, so the client can never
   * write a server-computed value.
   */
  app.put('/api/profile', guard, async (request) => {
    const user = currentUser(request);
    return updateProfile(user.id, request.body);
  });
}
