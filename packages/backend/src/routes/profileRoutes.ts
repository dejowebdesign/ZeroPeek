/**
 * Player profile routes (Phase 6.6, player context Phase 6.6.3).
 *
 * Both routes are for the **signed-in player account itself**: the user id comes
 * from the player session (`currentPlayer`), never from the request, so one
 * account can never read or change another's profile. The write is guarded by
 * `requirePlayerAuth`, which also enforces the CSRF token on `PUT`.
 *
 * Phase 6.6.3: the guard reads only `zp_player_session`. A host session
 * (`zp_session`) is deliberately **not** accepted here, so an ADMIN signed in as
 * a host is treated as a signed-out player on this surface — the profile never
 * shows a host identity.
 *
 * There is deliberately **no** `/api/profile/history`: the quiz history stays
 * admin-only (product decision, Phase 5c). This module exposes only the account's
 * own summary.
 */

import type { FastifyInstance } from 'fastify';

import { levelForXp } from '@zeropeek/shared';

import type { AppConfig } from '../config.js';
import { currentPlayer, requirePlayerAuth } from '../sessions.js';
import {
  ensureProfile,
  getProfile,
  updateAvatar,
  updateProfile,
} from '../services/profileService.js';
import { reconcileLevelRewards } from '../services/progressionService.js';

export function registerProfileRoutes(app: FastifyInstance, config: AppConfig): void {
  const guard = { preHandler: requirePlayerAuth(config) };

  /** The authenticated player account's own profile and personal statistics. */
  app.get('/api/profile', guard, async (request) => {
    const user = currentPlayer(request);
    return getProfile(user.id);
  });

  /**
   * Change the fields Phase 6.6 owns. A body carrying anything else — a
   * statistic, an XP value, a `userId` — is rejected, so the client can never
   * write a server-computed value.
   *
   * When a character is chosen, the new character's already-earned level rewards
   * are granted (idempotent; Phase 6.8.4). An item is never transferred between
   * characters — only the *right* to own the new character's items is granted.
   */
  app.put('/api/profile', guard, async (request) => {
    const user = currentPlayer(request);
    const result = await updateProfile(user.id, request.body);
    if (result.selectedCharacterId) {
      const profile = await ensureProfile(user.id);
      await reconcileLevelRewards(user.id, levelForXp(profile.xp), result.selectedCharacterId);
    }
    return result;
  });

  /**
   * Save the avatar configuration (Phase 6.7): the chosen character plus the
   * item equipped in each slot. Validated server-side against the
   * character-exclusive catalogue, so another character's item is rejected.
   */
  app.put('/api/profile/avatar', guard, async (request) => {
    const user = currentPlayer(request);
    return updateAvatar(user.id, request.body);
  });
}
