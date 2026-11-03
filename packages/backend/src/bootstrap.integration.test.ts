/**
 * Integration tests for the first-administrator bootstrap against a real
 * PostgreSQL.
 *
 * Skipped automatically when no database is reachable (see testing/db.ts).
 * The contract these tests lock down:
 *   - a fresh deployment with both values set gets exactly one ADMIN user;
 *   - the password is stored as an Argon2id hash and can be verified;
 *   - a second start never overwrites, changes or duplicates an existing admin;
 *   - a password below the minimum policy is rejected without creating a user.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_MIN_LENGTH, verifyPassword } from './auth.js';
import { prisma } from './db.js';
import { countAdmins, ensureBootstrapAdmin, listUsers } from './services/userService.js';
import { canConnect, resetDatabase } from './testing/db.js';

const available = await canConnect();

describe.skipIf(!available)('bootstrap administrator', () => {
  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates exactly one admin on a fresh deployment', async () => {
    const created = await ensureBootstrapAdmin('admin', 'correct-horse-battery');

    expect(created).toBe(true);
    expect(await countAdmins()).toBe(1);

    const users = await listUsers();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ username: 'admin', role: 'ADMIN', disabled: false });
  });

  it('stores the password as an Argon2id hash that verifies', async () => {
    await ensureBootstrapAdmin('admin', 'correct-horse-battery');

    const row = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain('correct-horse-battery');
    expect(await verifyPassword(row.passwordHash, 'correct-horse-battery')).toBe(true);
    expect(await verifyPassword(row.passwordHash, 'wrong-password')).toBe(false);
  });

  it('is a no-op on a second start and never duplicates the admin', async () => {
    await ensureBootstrapAdmin('admin', 'correct-horse-battery');
    const first = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });

    const createdAgain = await ensureBootstrapAdmin('admin', 'a-different-password');
    expect(createdAgain).toBe(false);
    expect(await countAdmins()).toBe(1);
    expect(await prisma.user.count()).toBe(1);

    // The existing admin is untouched: same hash, so the original password still
    // works and the new one never took effect.
    const second = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    expect(second.passwordHash).toBe(first.passwordHash);
    expect(await verifyPassword(second.passwordHash, 'correct-horse-battery')).toBe(true);
    expect(await verifyPassword(second.passwordHash, 'a-different-password')).toBe(false);
  });

  it('does not touch a different admin created by hand', async () => {
    const existing = await prisma.user.create({
      data: {
        username: 'owner',
        passwordHash: '$argon2id$pre-existing',
        role: 'ADMIN',
      },
    });

    const created = await ensureBootstrapAdmin('admin', 'correct-horse-battery');
    expect(created).toBe(false);

    const users = await listUsers();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: existing.id, username: 'owner' });
  });

  it('does nothing when either value is missing', async () => {
    expect(await ensureBootstrapAdmin(undefined, 'correct-horse-battery')).toBe(false);
    expect(await ensureBootstrapAdmin('admin', undefined)).toBe(false);
    expect(await ensureBootstrapAdmin('', '')).toBe(false);
    expect(await prisma.user.count()).toBe(0);
  });

  it('rejects a password below the minimum policy without creating a user', async () => {
    const tooShort = 'a'.repeat(PASSWORD_MIN_LENGTH - 1);

    await expect(ensureBootstrapAdmin('admin', tooShort)).rejects.toThrow(/at least/);
    expect(await prisma.user.count()).toBe(0);
    expect(await countAdmins()).toBe(0);
  });
});
