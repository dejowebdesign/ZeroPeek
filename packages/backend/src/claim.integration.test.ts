/**
 * Phase 6.8.2 — guest-round claim.
 *
 * Drives the real claim service against a real PostgreSQL, with a game built in
 * the `end` phase. Proves the binding security rules from roadmap §9.2:
 *
 *   - a guest's finished round can be claimed **once**, by the account that holds
 *     the proof;
 *   - the round's points, placement bonus and XP carry over to the account;
 *   - a **second** redeem is refused (single use);
 *   - a **foreign** account cannot claim another guest's seat;
 *   - a **wrong token** is refused;
 *   - an **expired** proof is refused;
 *   - an **already-registered** player's seat is never claimable;
 *   - the XP is paid exactly once even though registered players were paid at
 *     `end` (the idempotent ledger).
 *
 * Skipped automatically when no database is reachable (see `testing/db.ts`).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from './db.js';
import { createUser } from './services/userService.js';
import { claimGuestRound, claimStatus, issueGuestClaims } from './services/claimService.js';
import { canConnect, resetDatabase } from './testing/db.js';

const available = await canConnect();

describe.skipIf(!available)('Phase 6.8.2 — guest-round claim', () => {
  let hostId = '';

  beforeAll(async () => {
    await resetDatabase(prisma);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    hostId = (
      await createUser({ username: 'claimhost', password: 'password-1234', role: 'TRAINER' })
    ).id;
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  async function player(username: string): Promise<string> {
    return (await createUser({ username, password: 'password-1234', role: 'PLAYER' })).id;
  }

  /** A finished game with one guest seat (score 4,000) and one registered seat. */
  async function finishedGameWithGuest(): Promise<{
    gameId: string;
    guestSeatId: string;
    registeredId: string;
  }> {
    const registeredId = await player('registered');
    const game = await prisma.game.create({
      data: {
        pin: '777777',
        hostId,
        phase: 'end',
        currentIndex: 3,
        endedAt: new Date(),
        settings: {},
      },
    });
    const guest = await prisma.gamePlayer.create({
      data: {
        gameId: game.id,
        nickname: 'Guest',
        token: `g-${game.id}`,
        score: 4_000,
        totalTimeMs: 1_000,
      },
    });
    await prisma.gamePlayer.create({
      data: {
        gameId: game.id,
        userId: registeredId,
        nickname: 'Reg',
        token: `r-${game.id}`,
        score: 6_000,
        totalTimeMs: 1_000,
      },
    });
    return { gameId: game.id, guestSeatId: guest.id, registeredId };
  }

  it('issues a claim proof only to the guest seat', async () => {
    const { gameId, guestSeatId } = await finishedGameWithGuest();
    const tokens = await issueGuestClaims(gameId);
    expect([...tokens.keys()]).toEqual([guestSeatId]);

    // The raw token is not stored; only its hash is.
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    const stored = (game?.guestClaim as { claims: Record<string, { tokenHash: string }> }).claims;
    expect(stored[guestSeatId]!.tokenHash).not.toBe(tokens.get(guestSeatId));
  });

  it('claims the round once, carrying the score, bonus and XP to the account', async () => {
    const { gameId, guestSeatId } = await finishedGameWithGuest();
    const tokens = await issueGuestClaims(gameId);
    const token = tokens.get(guestSeatId)!;
    const newcomer = await player('newcomer');

    const result = await claimGuestRound(newcomer, { gameId, playerId: guestSeatId, token });
    expect(result.claimed).toBe(true);
    // Guest was rank 2: 4,000 points + 1,000 bonus = 5,000 XP.
    expect(result.grantedXp).toBe(5_000);

    const seat = await prisma.gamePlayer.findUnique({ where: { id: guestSeatId } });
    expect(seat?.userId).toBe(newcomer);
    const profile = await prisma.playerProfile.findUnique({ where: { userId: newcomer } });
    expect(profile?.xp).toBe(5_000);
    expect(profile?.level).toBe(1);
  });

  it('refuses a second redeem of the same round', async () => {
    const { gameId, guestSeatId } = await finishedGameWithGuest();
    const token = (await issueGuestClaims(gameId)).get(guestSeatId)!;
    const newcomer = await player('newcomer');

    await claimGuestRound(newcomer, { gameId, playerId: guestSeatId, token });
    await expect(
      claimGuestRound(newcomer, { gameId, playerId: guestSeatId, token }),
    ).rejects.toThrow(/already/i);

    const profile = await prisma.playerProfile.findUnique({ where: { userId: newcomer } });
    expect(profile?.xp).toBe(5_000);
  });

  it('refuses a foreign account claiming another guest seat', async () => {
    const { gameId, guestSeatId } = await finishedGameWithGuest();
    const token = (await issueGuestClaims(gameId)).get(guestSeatId)!;
    const first = await player('first');
    await claimGuestRound(first, { gameId, playerId: guestSeatId, token });

    const second = await player('second');
    await expect(claimGuestRound(second, { gameId, playerId: guestSeatId, token })).rejects.toThrow(
      /already/i,
    );
    const seat = await prisma.gamePlayer.findUnique({ where: { id: guestSeatId } });
    expect(seat?.userId).toBe(first);
  });

  it('refuses a wrong token', async () => {
    const { gameId, guestSeatId } = await finishedGameWithGuest();
    await issueGuestClaims(gameId);
    const newcomer = await player('newcomer');
    await expect(
      claimGuestRound(newcomer, { gameId, playerId: guestSeatId, token: 'not-the-token' }),
    ).rejects.toThrow(/verified/i);
  });

  it('refuses an expired proof', async () => {
    const { gameId, guestSeatId } = await finishedGameWithGuest();
    const token = (await issueGuestClaims(gameId)).get(guestSeatId)!;
    // Expire the proof directly.
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    const store = game!.guestClaim as { claims: Record<string, { expiresAt: string }> };
    store.claims[guestSeatId]!.expiresAt = new Date(Date.now() - 1000).toISOString();
    await prisma.game.update({ where: { id: gameId }, data: { guestClaim: store } });

    const newcomer = await player('newcomer');
    await expect(
      claimGuestRound(newcomer, { gameId, playerId: guestSeatId, token }),
    ).rejects.toThrow(/expired/i);
  });

  it('refuses to claim a seat that is already registered', async () => {
    const { gameId, registeredId } = await finishedGameWithGuest();
    // Force a proof onto the registered seat to prove the seat-state guard wins.
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    const store = (game!.guestClaim as { claims?: Record<string, unknown> }) ?? { claims: {} };
    const registeredSeat = await prisma.gamePlayer.findFirst({
      where: { gameId, userId: registeredId },
    });
    const token = 'forced-token';
    const { hashVerificationToken } = await import('./auth.js');
    store.claims = {
      ...(store.claims ?? {}),
      [registeredSeat!.id]: {
        tokenHash: hashVerificationToken(token),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        usedAt: null,
      },
    };
    await prisma.game.update({ where: { id: gameId }, data: { guestClaim: store } });

    const other = await player('other');
    await expect(
      claimGuestRound(other, { gameId, playerId: registeredSeat!.id, token }),
    ).rejects.toThrow(/belongs/i);
  });

  it('reports claimability honestly without revealing a wrong token', async () => {
    const { gameId, guestSeatId } = await finishedGameWithGuest();
    const token = (await issueGuestClaims(gameId)).get(guestSeatId)!;
    const newcomer = await player('newcomer');

    expect(await claimStatus(newcomer, { gameId, playerId: guestSeatId, token })).toEqual({
      claimable: true,
    });
    // A wrong token is a plain "not claimable", never an error that reveals more.
    expect(await claimStatus(newcomer, { gameId, playerId: guestSeatId, token: 'nope' })).toEqual({
      claimable: false,
      reason: 'unverified',
    });
  });

  it('refuses to claim a round that has not finished', async () => {
    const game = await prisma.game.create({
      data: { pin: '666666', hostId, phase: 'question', currentIndex: 0 },
    });
    const seat = await prisma.gamePlayer.create({
      data: { gameId: game.id, nickname: 'Guest', token: `g-${game.id}`, score: 0 },
    });
    const newcomer = await player('newcomer');
    await expect(
      claimGuestRound(newcomer, { gameId: game.id, playerId: seat.id, token: 'x' }),
    ).rejects.toThrow(/finished/i);
  });

  it('pays the round XP exactly once across registered and claimed players', async () => {
    const { gameId, guestSeatId, registeredId } = await finishedGameWithGuest();
    // The registered player was granted at `end` (simulated by granting now).
    const { grantProgressForGame } = await import('./services/progressionService.js');
    await grantProgressForGame(gameId);
    const regBefore = await prisma.playerProfile.findUnique({ where: { userId: registeredId } });
    // Registered seat: 6,000 + 1,500 = 7,500.
    expect(regBefore?.xp).toBe(7_500);

    const token = (await issueGuestClaims(gameId)).get(guestSeatId)!;
    const newcomer = await player('newcomer');
    await claimGuestRound(newcomer, { gameId, playerId: guestSeatId, token });

    // The registered player was not paid again by the claim.
    const regAfter = await prisma.playerProfile.findUnique({ where: { userId: registeredId } });
    expect(regAfter?.xp).toBe(7_500);
    // The guest seat's XP landed on the newcomer exactly once.
    const ledger = await prisma.xpLedger.count({ where: { userId: newcomer } });
    expect(ledger).toBe(2);
  });
});
