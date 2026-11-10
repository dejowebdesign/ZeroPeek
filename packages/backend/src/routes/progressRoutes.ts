/**
 * Player progression routes (Phase 6.8): XP/level, inventory and achievements.
 *
 * Every route is for the **signed-in player account itself**: the user id comes
 * from the player session (`currentPlayer`), never from the request, so one
 * account can never read or change another's progression. The guard reads only
 * `zp_player_session` (Phase 6.6.3) and enforces the CSRF token on the write.
 *
 * There is deliberately **no** endpoint that accepts an XP value, a level or an
 * unlock: the client can only read progression and equip an item it already
 * owns. XP, level, inventory and achievements are written solely by
 * `progressionService` at game end.
 */

import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config.js';
import { currentPlayer, requirePlayerAuth } from '../sessions.js';
import {
  equipItem,
  getAchievementsView,
  getInventoryView,
  getProgressView,
} from '../services/progressionService.js';

export function registerProgressRoutes(app: FastifyInstance, config: AppConfig): void {
  const guard = { preHandler: requirePlayerAuth(config) };

  /** The account's XP, level and progress toward the next level. */
  app.get('/api/progress', guard, async (request) => {
    const user = currentPlayer(request);
    return getProgressView(user.id);
  });

  /** The active character's items, with ownership and equipment state. */
  app.get('/api/inventory', guard, async (request) => {
    const user = currentPlayer(request);
    return getInventoryView(user.id);
  });

  /** Every achievement, with unlock state and progress. */
  app.get('/api/achievements', guard, async (request) => {
    const user = currentPlayer(request);
    return getAchievementsView(user.id);
  });

  /**
   * Equip an owned item of the active character. Validated server-side against
   * the character-exclusive catalogue and the account's ownership, so another
   * character's item or an unowned item is rejected.
   */
  app.post('/api/inventory/equip', guard, async (request) => {
    const user = currentPlayer(request);
    return equipItem(user.id, request.body);
  });
}
