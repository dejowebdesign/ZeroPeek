/**
 * Guest-round claim routes (Phase 6.8.2).
 *
 * Both routes are for the **signed-in player account itself**: the user id comes
 * from the player session, never the request, so one account can never claim
 * another's round. The guard reads only `zp_player_session` and enforces the CSRF
 * token on the redeem.
 *
 * A guest holds three opaque values locally after a round ends (`gameId`,
 * `playerId`, `token`, delivered by the `game:claimable` socket event). The
 * status route lets the client check, after registering, whether the round is
 * still claimable; the redeem route links the seat once and grants the round's XP.
 */

import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config.js';
import { currentPlayer, requirePlayerAuth } from '../sessions.js';
import { claimGuestRound, claimStatus } from '../services/claimService.js';

export function registerClaimRoutes(app: FastifyInstance, config: AppConfig): void {
  const guard = { preHandler: requirePlayerAuth(config) };

  /**
   * Whether the given claim is still redeemable by this account, so the client
   * can offer the redeem only when it will succeed. Returns `{ claimable: false }`
   * for anything not redeemable (used, expired, unknown, or already this account's).
   */
  app.post('/api/guest-claim/status', guard, async (request) => {
    const user = currentPlayer(request);
    return claimStatus(user.id, request.body);
  });

  /**
   * Redeem the claim: link the guest seat to this account and grant the round's
   * XP once. The token is verified server-side; a used, expired or foreign claim
   * is refused.
   */
  app.post('/api/guest-claim', guard, async (request) => {
    const user = currentPlayer(request);
    return claimGuestRound(user.id, request.body);
  });
}
