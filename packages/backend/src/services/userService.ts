/**
 * User accounts and roles.
 *
 * Passwords are hashed with Argon2id before they are stored; the plain value
 * never leaves this module. Usernames are stored lower-cased so a login is
 * case-insensitive without a second index.
 */

import type { UserRole } from '@prisma/client';

import {
  hashPassword,
  isAcceptablePassword,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from '../auth.js';
import { prisma } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';

/** The public view of a user – never includes the password hash. */
export interface PublicUser {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  disabled: boolean;
  createdAt: Date;
}

function toPublic(user: {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  disabled: boolean;
  createdAt: Date;
}): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    disabled: user.disabled,
    createdAt: user.createdAt,
  };
}

/** Normalise a username for storage and lookup. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Create a user. Throws 409 when the username or e-mail is taken. */
export async function createUser(input: {
  username: string;
  password: string;
  email?: string | null;
  role?: UserRole;
}): Promise<PublicUser> {
  const username = normalizeUsername(input.username);
  if (username.length < 3) throw badRequest('The username must be at least 3 characters.');
  if (!isAcceptablePassword(input.password)) {
    throw badRequest(`The password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) throw conflict('That username is already taken.', 'username_taken');

  const user = await prisma.user.create({
    data: {
      username,
      email: input.email ?? null,
      passwordHash: await hashPassword(input.password),
      role: input.role ?? 'TRAINER',
    },
  });
  return toPublic(user);
}

/** Verify credentials. Returns the public user, or `null` when they are wrong. */
export async function authenticate(username: string, password: string): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({ where: { username: normalizeUsername(username) } });
  if (!user || user.disabled) return null;
  const ok = await verifyPassword(user.passwordHash, password);
  return ok ? toPublic(user) : null;
}

/** List every user (admin only). */
export async function listUsers(): Promise<PublicUser[]> {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  return users.map(toPublic);
}

/** Load one user by id, or throw 404. */
export async function getUser(id: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound('User not found.');
  return toPublic(user);
}

/** Change a user's password. */
export async function setPassword(id: string, password: string): Promise<void> {
  if (!isAcceptablePassword(password)) {
    throw badRequest(`The password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound('User not found.');
  await prisma.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(password) },
  });
  // Any existing session for this user is invalidated by the password change.
  await prisma.session.deleteMany({ where: { userId: id } });
}

/** Enable or disable an account, and revoke sessions when disabling. */
export async function setDisabled(id: string, disabled: boolean): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound('User not found.');
  const updated = await prisma.user.update({ where: { id }, data: { disabled } });
  if (disabled) await prisma.session.deleteMany({ where: { userId: id } });
  return toPublic(updated);
}

/** Change a user's role. */
export async function setRole(id: string, role: UserRole): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound('User not found.');
  return toPublic(await prisma.user.update({ where: { id }, data: { role } }));
}

/** Count the admins, so the last one cannot be demoted or disabled. */
export async function countAdmins(): Promise<number> {
  return prisma.user.count({ where: { role: 'ADMIN', disabled: false } });
}

/**
 * Ensure at least one admin exists. Called on boot so a fresh deployment has a
 * way in. Credentials come from the environment; if unset, nothing happens and
 * the operator must create the first admin another way.
 */
export async function ensureBootstrapAdmin(
  username: string | undefined,
  password: string | undefined,
): Promise<boolean> {
  if (!username || !password) return false;
  if ((await countAdmins()) > 0) return false;
  await createUser({ username, password, role: 'ADMIN' });
  return true;
}
