/**
 * Guest-round claim client (Phase 6.8.2).
 *
 * A guest who finishes a round receives a short-lived claim proof over the
 * socket (`game:claimable`). It is kept **locally** (localStorage) so it survives
 * a page reload and the registration detour, and may be redeemed **once** after
 * registering. The proof is opaque: the client never derives or alters it, and
 * the server is the only authority on whether it is still valid.
 *
 * Only one claim is ever held: a new round replaces the previous one, so a guest
 * is never offered a stale round from a much earlier game.
 */

/** The stored claim proof. */
export interface StoredClaim {
  gameId: string;
  playerId: string;
  token: string;
  /** When the client received it, for a coarse expiry hint (the server decides). */
  receivedAt: number;
}

/** The single localStorage key. */
const CLAIM_KEY = 'zeropeek.guestClaim';

/** Read the stored claim, or `null` when there is none / it is unreadable. */
export function loadClaim(): StoredClaim | null {
  try {
    const raw = window.localStorage.getItem(CLAIM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredClaim>;
    if (
      typeof parsed.gameId === 'string' &&
      typeof parsed.playerId === 'string' &&
      typeof parsed.token === 'string'
    ) {
      return {
        gameId: parsed.gameId,
        playerId: parsed.playerId,
        token: parsed.token,
        receivedAt: typeof parsed.receivedAt === 'number' ? parsed.receivedAt : 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Store a claim proof, replacing any previous one. */
export function saveClaim(claim: StoredClaim): void {
  try {
    window.localStorage.setItem(CLAIM_KEY, JSON.stringify(claim));
  } catch {
    // Storage may be unavailable (private mode); the claim is then lost, which
    // only costs the guest the optional carry-over — never the round itself.
  }
}

/** Forget the stored claim (after a successful redeem, or when it is refused). */
export function clearClaim(): void {
  try {
    window.localStorage.removeItem(CLAIM_KEY);
  } catch {
    // Nothing to do.
  }
}
