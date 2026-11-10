/**
 * Test helpers for the database-backed integration suites.
 *
 * Those suites need a real PostgreSQL. They are skipped automatically when no
 * database is reachable, so `npm test` still works on a machine without one;
 * CI provides a service container and sets `DATABASE_URL`.
 *
 * Usage in a test file (top-level await is available in ESM):
 *
 *   const available = await canConnect();
 *   describe.skipIf(!available)('...', () => { ... });
 *
 * Each suite calls `resetDatabase(prisma)` in `beforeEach`, which truncates
 * every table. That only ever runs against the database named by
 * `TEST_DATABASE_URL`/`DATABASE_URL`, never a production one.
 */

import { PrismaClient } from '@prisma/client';

/** The connection string the tests use. */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

/** Whether a database is reachable right now. */
export async function canConnect(): Promise<boolean> {
  if (!testDatabaseUrl) return false;
  const probe = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
  try {
    await probe.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.$disconnect();
  }
}

/** Remove every row, in foreign-key-safe order. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.playerAnswer.deleteMany();
  await prisma.gameEvent.deleteMany();
  await prisma.gamePlayer.deleteMany();
  // Snapshots reference both a game (cascade) and a quiz (set null); deleting
  // them first keeps the order explicit and independent of the cascade rules.
  await prisma.gameSnapshot.deleteMany();
  await prisma.game.deleteMany();
  await prisma.question.deleteMany();
  await prisma.quiz.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
  await prisma.session.deleteMany();
  // Phase 6.8 progression rows reference the user (cascade); delete them before
  // the user so the order is explicit and independent of the cascade rules.
  await prisma.xpLedger.deleteMany();
  await prisma.playerInventory.deleteMany();
  await prisma.playerAchievement.deleteMany();
  await prisma.playerProfile.deleteMany();
  await prisma.user.deleteMany();
}
