/**
 * Phase 6.8.3 — XP, level, placement bonus, idempotency and achievements.
 *
 * Drives the real `progressionService` against a real PostgreSQL. The games are
 * built directly in the `end` phase (the engine's own end path is covered by the
 * socket suites), so each rule can be asserted in isolation:
 *
 *   - XP equal the game points, plus 1500/1000/500 for 1st/2nd/3rd, and nothing
 *     beyond;
 *   - a tie gives every tied player the same bonus;
 *   - a single credit can cross several levels, and every crossed level is seen;
 *   - the grant is idempotent: a second call pays nothing (the `XpLedger` key);
 *   - a guest (no `userId`) is never granted;
 *   - achievements unlock once and never revoke.
 *
 * Skipped automatically when no database is reachable (see `testing/db.ts`).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from './db.js';
import { createUser } from './services/userService.js';
import { grantProgressForGame, getProgressView } from './services/progressionService.js';
import { canConnect, resetDatabase } from './testing/db.js';

const available = await canConnect();

describe.skipIf(!available)('Phase 6.8.3 — progression service', () => {
  let hostId = '';

  beforeAll(async () => {
    await resetDatabase(prisma);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    hostId = (
      await createUser({ username: 'proghost', password: 'password-1234', role: 'TRAINER' })
    ).id;
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  /** A registered player account. */
  async function player(username: string): Promise<string> {
    return (await createUser({ username, password: 'password-1234', role: 'PLAYER' })).id;
  }

  /** Record one answered question for a seat (used by the streak/perfect tests). */
  async function answer(
    playerId: string,
    gameId: string,
    questionId: string,
    correct: boolean,
  ): Promise<void> {
    await prisma.playerAnswer.create({
      data: {
        gameId,
        playerId,
        questionId,
        correctness: correct ? 1 : 0,
        points: correct ? 100 : 0,
      },
    });
  }

  /**
   * A finished game with the given seats. `seats` are (userId|null, score,
   * correctCount) triples; the answers are added separately when a test needs
   * them.
   *
   * Every seat shares the same `totalTimeMs` and `joinedAt`, so two seats with an
   * equal score and correct count are a **true tie** (shared rank) — the tie test
   * relies on that, and a distinct-score test is unaffected because the score
   * dominates the ordering.
   */
  async function finishedGame(
    seats: Array<{ userId: string | null; nickname: string; score: number; correctCount?: number }>,
  ): Promise<{ gameId: string; playerIds: Map<string, string> }> {
    const game = await prisma.game.create({
      data: {
        pin: '999999',
        hostId,
        phase: 'end',
        currentIndex: 3,
        endedAt: new Date(),
        settings: {},
      },
    });
    const playerIds = new Map<string, string>();
    const joinedAt = new Date();
    for (const seat of seats) {
      const row = await prisma.gamePlayer.create({
        data: {
          gameId: game.id,
          nickname: seat.nickname,
          token: `token-${seat.nickname}-${game.id}`,
          score: seat.score,
          correctCount: seat.correctCount ?? 0,
          totalTimeMs: 1_000,
          joinedAt,
          ...(seat.userId ? { userId: seat.userId } : {}),
        },
      });
      playerIds.set(seat.nickname, row.id);
    }
    return { gameId: game.id, playerIds };
  }

  it('grants the score plus the placement bonus to the winner', async () => {
    const alice = await player('alice');
    const bob = await player('bob');
    const { gameId } = await finishedGame([
      { userId: alice, nickname: 'Alice', score: 8_500 },
      { userId: bob, nickname: 'Bob', score: 4_000 },
    ]);

    const result = await grantProgressForGame(gameId);
    // Every registered seat is granted; the winner just gets more.
    expect(result.granted).toEqual(expect.arrayContaining([alice, bob]));

    const profile = await prisma.playerProfile.findUnique({ where: { userId: alice } });
    // 8,500 points + 1,500 winner bonus = 10,000 -> level 2.
    expect(profile?.xp).toBe(10_000);
    expect(profile?.level).toBe(2);
    const progress = await getProgressView(alice);
    expect(progress.xp).toBe(10_000);
    expect(progress.level).toBe(2);
  });

  it('pays 1000/500 to second and third and nothing to fourth', async () => {
    const [a, b, c, d] = await Promise.all([
      player('rank-a'),
      player('rank-b'),
      player('rank-c'),
      player('rank-d'),
    ]);
    const { gameId } = await finishedGame([
      { userId: a, nickname: 'A', score: 5_000 },
      { userId: b, nickname: 'B', score: 4_000 },
      { userId: c, nickname: 'C', score: 3_000 },
      { userId: d, nickname: 'D', score: 2_000 },
    ]);
    await grantProgressForGame(gameId);

    const xp = async (userId: string) =>
      (await prisma.playerProfile.findUnique({ where: { userId } }))?.xp;
    expect(await xp(a)).toBe(5_000 + 1_500);
    expect(await xp(b)).toBe(4_000 + 1_000);
    expect(await xp(c)).toBe(3_000 + 500);
    expect(await xp(d)).toBe(2_000);
  });

  it('gives every tied player the same bonus', async () => {
    const [a, b] = await Promise.all([player('tie-a'), player('tie-b')]);
    // Identical score, correct count and time -> a shared rank 1 (rankPlayers).
    const { gameId } = await finishedGame([
      { userId: a, nickname: 'A', score: 6_000, correctCount: 5 },
      { userId: b, nickname: 'B', score: 6_000, correctCount: 5 },
    ]);
    await grantProgressForGame(gameId);

    const xp = async (userId: string) =>
      (await prisma.playerProfile.findUnique({ where: { userId } }))?.xp;
    // Both are rank 1 (shared), so both get the 1,500 bonus.
    expect(await xp(a)).toBe(7_500);
    expect(await xp(b)).toBe(7_500);
  });

  it('is idempotent: a second grant pays nothing', async () => {
    const alice = await player('idem');
    const { gameId } = await finishedGame([{ userId: alice, nickname: 'Alice', score: 3_000 }]);

    const first = await grantProgressForGame(gameId);
    const second = await grantProgressForGame(gameId);
    expect(first.granted).toEqual([alice]);
    expect(second.granted).toEqual([]);
    expect(second.skipped).toEqual([alice]);

    const profile = await prisma.playerProfile.findUnique({ where: { userId: alice } });
    expect(profile?.xp).toBe(3_000 + 1_500);
    const ledger = await prisma.xpLedger.count({ where: { userId: alice } });
    // One `game` row and one `placement` row; the repeat added none.
    expect(ledger).toBe(2);
  });

  it('never grants a guest (no user id)', async () => {
    const alice = await player('mixed');
    const { gameId } = await finishedGame([
      { userId: alice, nickname: 'Alice', score: 1_000 },
      { userId: null, nickname: 'Guest', score: 2_000 },
    ]);
    const result = await grantProgressForGame(gameId);
    expect(result.granted).toEqual([alice]);
    // The guest has no profile to grant to.
    const profiles = await prisma.playerProfile.count();
    expect(profiles).toBe(1);
  });

  it('counts several level-ups from one credit', async () => {
    const alice = await player('jumper');
    // 100,000 points + 1,500 bonus = 101,500 -> level 11.
    const { gameId } = await finishedGame([{ userId: alice, nickname: 'Alice', score: 100_000 }]);
    await grantProgressForGame(gameId);
    const profile = await prisma.playerProfile.findUnique({ where: { userId: alice } });
    expect(profile?.xp).toBe(101_500);
    expect(profile?.level).toBe(11);
  });

  it('adds to an existing balance and level', async () => {
    const alice = await player('accumulate');
    await prisma.playerProfile.create({ data: { userId: alice, xp: 9_000, level: 1 } });
    const { gameId } = await finishedGame([{ userId: alice, nickname: 'Alice', score: 500 }]);
    await grantProgressForGame(gameId);
    const profile = await prisma.playerProfile.findUnique({ where: { userId: alice } });
    // 9,000 + 500 + 1,500 = 11,000 -> level 2.
    expect(profile?.xp).toBe(11_000);
    expect(profile?.level).toBe(2);
  });

  it('unlocks the first-round and first-win achievements once', async () => {
    const alice = await player('achieve');
    const { gameId, playerIds } = await finishedGame([
      { userId: alice, nickname: 'Alice', score: 2_000, correctCount: 2 },
    ]);
    // A perfect round needs at least one answered question, all correct.
    await answer(playerIds.get('Alice')!, gameId, 'q1', true);
    await answer(playerIds.get('Alice')!, gameId, 'q2', true);
    await grantProgressForGame(gameId);

    const unlocked = await prisma.playerAchievement.findMany({ where: { userId: alice } });
    const ids = unlocked.map((row) => row.achievementId).sort();
    expect(ids).toEqual(['first-game', 'first-win', 'perfect-round']);

    // A repeat grant does not duplicate an unlock.
    await grantProgressForGame(gameId);
    const again = await prisma.playerAchievement.count({ where: { userId: alice } });
    expect(again).toBe(3);
  });

  it('does not unlock a win achievement for a non-winner', async () => {
    const alice = await player('loser');
    const bob = await player('winner');
    const { gameId } = await finishedGame([
      { userId: alice, nickname: 'Alice', score: 1_000 },
      { userId: bob, nickname: 'Bob', score: 9_000 },
    ]);
    await grantProgressForGame(gameId);

    const aliceIds = (await prisma.playerAchievement.findMany({ where: { userId: alice } })).map(
      (row) => row.achievementId,
    );
    expect(aliceIds).toContain('first-game');
    expect(aliceIds).not.toContain('first-win');
  });

  it('does not grant anything for a game that never left the lobby', async () => {
    const alice = await player('nolobby');
    const game = await prisma.game.create({
      data: { pin: '888888', hostId, phase: 'lobby', currentIndex: -1 },
    });
    await prisma.gamePlayer.create({
      data: {
        gameId: game.id,
        userId: alice,
        nickname: 'Alice',
        token: `t-${game.id}`,
        score: 5_000,
      },
    });
    const result = await grantProgressForGame(game.id);
    expect(result.granted).toEqual([]);
    expect(await prisma.xpLedger.count()).toBe(0);
  });

  it('reports progress toward the next level', async () => {
    const alice = await player('progress');
    const { gameId } = await finishedGame([{ userId: alice, nickname: 'Alice', score: 5_000 }]);
    await grantProgressForGame(gameId);
    const view = await getProgressView(alice);
    // 5,000 + 1,500 = 6,500 -> level 1, 3,500 to go.
    expect(view.level).toBe(1);
    expect(view.progress.xpIntoLevel).toBe(6_500);
    expect(view.progress.xpToNextLevel).toBe(3_500);
    expect(view.achievementsUnlocked).toBeGreaterThan(0);
  });
});
