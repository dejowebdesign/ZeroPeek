/**
 * Guest-round claim (Phase 6.8.2).
 *
 * A guest who finishes a round and only then creates an account must not lose
 * that round. At the final `end` the server issues each guest seat a **short-lived,
 * single-use claim proof**; the guest keeps it locally and, after registering,
 * redeems it once. Redeeming links the guest seat to the new account, so the
 * round's points, placement, XP, correct answers and statistics all carry over.
 *
 * Security (roadmap §9.2, binding):
 *   - **bound to the round and the session** — the proof is stored per guest seat
 *     (`GamePlayer.id`) on the game, and the raw token is only ever delivered to
 *     that guest's own socket; redeeming requires the seat id *and* the token;
 *   - **single use** — `usedAt` is stamped in the same transaction that links the
 *     seat, and a second redeem is refused;
 *   - **short-lived** — the proof expires (`expiresAt`); an expired proof is
 *     refused;
 *   - **no cross-guest claim** — the seat must still be a guest (`userId` null);
 *     a seat already linked to another account is refused;
 *   - **no double credit** — XP is granted through the idempotent
 *     `grantProgressForGame`, so the round's XP is paid exactly once even though
 *     the registered players were already paid at `end`.
 *
 * Only the **just-finished** round is claimable: an `end`-phase game with an
 * unexpired, unused proof. There is deliberately no way to claim an arbitrary
 * older guest round (product decision, `game-design-concept.md` §4.4).
 */

import { prisma } from '../db.js';
import { conflict, invalid, notFound } from '../errors.js';
import { hashVerificationToken, newVerificationToken } from '../auth.js';
import { grantProgressForGame } from './progressionService.js';

/** How long a guest-round claim stays valid. Short by design (roadmap §9.2). */
export const CLAIM_TTL_MS = 30 * 60 * 1000;

/** One guest seat's claim proof, as stored on `Game.guestClaim`. */
interface GuestClaimRecord {
  /** SHA-256 hex of the raw token; the raw token is never stored. */
  tokenHash: string;
  /** ISO expiry. */
  expiresAt: string;
  /** ISO timestamp of the single successful redeem, or `null`. */
  usedAt: string | null;
}

/** The `Game.guestClaim` envelope: a proof per guest seat id. */
interface GuestClaimStore {
  claims: Record<string, GuestClaimRecord>;
}

/** Read the stored claim envelope defensively. */
function readStore(raw: unknown): GuestClaimStore {
  if (raw && typeof raw === 'object' && 'claims' in raw) {
    const claims = (raw as { claims?: unknown }).claims;
    if (claims && typeof claims === 'object' && !Array.isArray(claims)) {
      return { claims: claims as Record<string, GuestClaimRecord> };
    }
  }
  return { claims: {} };
}

/**
 * Issue a fresh claim proof to every **guest** seat of a finished game.
 *
 * Returns a map of seat id → raw token. The caller (the socket layer) delivers
 * each token to that guest's own socket; the raw token is never persisted and
 * never leaves the server except to its owner. A game that is not finished, or
 * has no guest seats, yields an empty map.
 */
export async function issueGuestClaims(gameId: string): Promise<Map<string, string>> {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game || game.phase !== 'end') return new Map();

  const guests = await prisma.gamePlayer.findMany({
    where: { gameId, userId: null },
    select: { id: true },
  });
  if (guests.length === 0) return new Map();

  const store = readStore(game.guestClaim);
  const tokens = new Map<string, string>();
  const expiresAt = new Date(Date.now() + CLAIM_TTL_MS).toISOString();

  for (const guest of guests) {
    const token = newVerificationToken();
    store.claims[guest.id] = {
      tokenHash: hashVerificationToken(token),
      expiresAt,
      usedAt: null,
    };
    tokens.set(guest.id, token);
  }

  await prisma.game.update({
    where: { id: gameId },
    data: { guestClaim: store as unknown as object },
  });
  return tokens;
}

/** The outcome of a redeem attempt. */
export interface ClaimResult {
  /** Whether the round was linked to the account by this call. */
  claimed: boolean;
  gameId: string;
  playerId: string;
  /** XP granted for the round (0 when it was already granted). */
  grantedXp: number;
}

/** The three fields a redeem carries, all held by the guest locally. */
interface ClaimBody {
  gameId: string;
  playerId: string;
  token: string;
}

/** Validate and normalise a redeem body, or throw a 422. */
function parseBody(body: unknown): ClaimBody {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('A JSON object is required.', [
      { path: '', message: 'A JSON object is required.' },
    ]);
  }
  const record = body as Record<string, unknown>;
  const issues: Array<{ path: string; message: string }> = [];
  for (const key of Object.keys(record)) {
    if (key !== 'gameId' && key !== 'playerId' && key !== 'token') {
      issues.push({ path: key, message: 'This field cannot be changed.' });
    }
  }
  const read = (key: keyof ClaimBody): string => {
    const value = record[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      issues.push({ path: key, message: 'A non-empty string is required.' });
      return '';
    }
    return value;
  };
  const parsed: ClaimBody = {
    gameId: read('gameId'),
    playerId: read('playerId'),
    token: read('token'),
  };
  if (issues.length > 0) throw invalid('The claim request is invalid.', issues);
  return parsed;
}

/** The status of a claim, from the perspective of one account. */
export interface ClaimStatus {
  claimable: boolean;
  /** A short reason when not claimable, safe to show. */
  reason?: string;
}

/**
 * Whether a claim is still redeemable by this account.
 *
 * Read-only and non-revealing: it returns `claimable: false` (never an error) for
 * a token mismatch, so it cannot be used to probe another guest's token. The
 * client calls it after registering to decide whether to offer the redeem.
 */
export async function claimStatus(userId: string, body: unknown): Promise<ClaimStatus> {
  let parsed: ClaimBody;
  try {
    parsed = parseBody(body);
  } catch {
    return { claimable: false, reason: 'invalid' };
  }
  const { gameId, playerId, token } = parsed;

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game || game.phase !== 'end') return { claimable: false, reason: 'not-finished' };

  const record = readStore(game.guestClaim).claims[playerId];
  if (!record) return { claimable: false, reason: 'unknown' };
  if (hashVerificationToken(token) !== record.tokenHash) {
    return { claimable: false, reason: 'unverified' };
  }
  if (record.usedAt !== null) return { claimable: false, reason: 'already-claimed' };
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    return { claimable: false, reason: 'expired' };
  }

  const seat = await prisma.gamePlayer.findUnique({ where: { id: playerId } });
  if (!seat || seat.gameId !== gameId) return { claimable: false, reason: 'unknown' };
  if (seat.userId !== null) {
    return seat.userId === userId
      ? { claimable: false, reason: 'already-yours' }
      : { claimable: false, reason: 'taken' };
  }
  return { claimable: true };
}

/**
 * Redeem a guest-round claim for the signed-in account.
 *
 * The account id comes from the player session, never the body, so one account
 * cannot claim on another's behalf. The seat is linked and the proof is stamped
 * used in **one transaction**; the XP is then granted idempotently, so a retried
 * redeem (or a race) pays nothing extra.
 */
export async function claimGuestRound(userId: string, body: unknown): Promise<ClaimResult> {
  const { gameId, playerId, token } = parseBody(body);

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw notFound('That round was not found.');
  if (game.phase !== 'end') throw conflict('Only a finished round can be claimed.');

  const store = readStore(game.guestClaim);
  const record = store.claims[playerId];
  if (!record) throw conflict('There is no claimable round for this player.');
  if (record.usedAt !== null) throw conflict('This round has already been claimed.');
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    throw conflict('This claim has expired.');
  }
  if (hashVerificationToken(token) !== record.tokenHash) {
    throw conflict('This claim could not be verified.');
  }

  const seat = await prisma.gamePlayer.findUnique({ where: { id: playerId } });
  if (!seat || seat.gameId !== gameId) throw notFound('That seat was not found.');
  if (seat.userId !== null) {
    // Already linked. If it is the same account, treat as a completed claim;
    // otherwise the seat belongs to someone else and must not be taken.
    if (seat.userId === userId) {
      return { claimed: false, gameId, playerId, grantedXp: 0 };
    }
    throw conflict('This seat already belongs to an account.');
  }

  const usedAt = new Date().toISOString();
  await prisma.$transaction(async (tx) => {
    // Re-check under the transaction so two concurrent redeems cannot both win:
    // the update only succeeds while `userId` is still null.
    const linked = await tx.gamePlayer.updateMany({
      where: { id: playerId, gameId, userId: null },
      data: { userId },
    });
    if (linked.count === 0) throw conflict('This round has already been claimed.');

    const fresh = readStore(
      (await tx.game.findUnique({ where: { id: gameId }, select: { guestClaim: true } }))
        ?.guestClaim,
    );
    const current = fresh.claims[playerId];
    if (!current || current.usedAt !== null) {
      throw conflict('This round has already been claimed.');
    }
    fresh.claims[playerId] = { ...current, usedAt };
    await tx.game.update({
      where: { id: gameId },
      data: { guestClaim: fresh as unknown as object },
    });
  });

  // Grant the round's XP now that the seat is registered. Idempotent: the
  // players already paid at `end` are skipped, the newly linked seat is granted.
  const before = await prisma.playerProfile.findUnique({ where: { userId } });
  const result = await grantProgressForGame(gameId);
  const after = await prisma.playerProfile.findUnique({ where: { userId } });
  const grantedXp = (after?.xp ?? 0) - (before?.xp ?? 0);

  return {
    claimed: result.granted.includes(userId),
    gameId,
    playerId,
    grantedXp: grantedXp > 0 ? grantedXp : 0,
  };
}
