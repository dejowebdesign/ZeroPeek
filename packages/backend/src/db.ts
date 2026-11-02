/**
 * Prisma client singleton.
 *
 * The client is created lazily and cached on `globalThis` so `tsx watch` does
 * not open a new connection pool on every reload. The connection itself is
 * established on first query, so importing this module never requires a
 * reachable database (important for the health endpoint and for unit tests).
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === 'true' ? ['query', 'warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/** Close the pool; used by graceful shutdown and by tests. */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
