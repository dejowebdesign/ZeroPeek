/**
 * User accounts and roles.
 *
 * Passwords are hashed with Argon2id before they are stored; the plain value
 * never leaves this module. Usernames are stored lower-cased so a login is
 * case-insensitive without a second index.
 */

import type { UserRole } from '@prisma/client';

import { normalizeEmail } from '@zeropeek/shared';

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
  /** When the e-mail was confirmed; `null` means not yet confirmed. */
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

function toPublic(user: {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  disabled: boolean;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    disabled: user.disabled,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
  };
}

/** Normalise a username for storage and lookup. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * Create a user. Throws 409 when the username or e-mail is taken.
 *
 * `emailVerifiedAt` defaults to now, so accounts created by an administrator
 * (or the bootstrap admin) are treated as confirmed. Player self-registration
 * passes `null` explicitly so the account stays unconfirmed until the e-mail
 * link is followed.
 */
export async function createUser(input: {
  username: string;
  password: string;
  email?: string | null;
  role?: UserRole;
  emailVerifiedAt?: Date | null;
}): Promise<PublicUser> {
  const username = normalizeUsername(input.username);
  if (username.length < 3) throw badRequest('The username must be at least 3 characters.');
  if (!isAcceptablePassword(input.password)) {
    throw badRequest(`The password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }

  const email = input.email ? normalizeEmail(input.email) : null;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) throw conflict('That username is already taken.', 'username_taken');

  if (email) {
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) throw conflict('That e-mail address is already registered.', 'email_taken');
  }

  const user = await prisma.user.create({
    data: {
      username,
      email,
      passwordHash: await hashPassword(input.password),
      // Least privilege: an omitted role means PLAYER. Staff accounts are only
      // ever created by an administrator, who passes the role explicitly.
      role: input.role ?? 'PLAYER',
      emailVerifiedAt: input.emailVerifiedAt === undefined ? new Date() : input.emailVerifiedAt,
    },
  });
  return toPublic(user);
}

/** Verify credentials. Returns the public user, or `null` when they are wrong. */
export async function authenticate(username: string, password: string): Promise<PublicUser | null> {
  const result = await verifyCredentials(username, password);
  return result.status === 'ok' ? result.user : null;
}

/**
 * The outcome of a credential check. `invalid` covers an unknown username or a
 * wrong password (they are deliberately indistinguishable); `unverified` is a
 * correct password for an account whose e-mail is not confirmed yet.
 */
export type CredentialResult =
  | { status: 'ok'; user: PublicUser }
  | { status: 'invalid' }
  | { status: 'unverified'; user: PublicUser };

/**
 * Check a username and password and report *why* it failed, so the login route
 * can tell a correct-but-unconfirmed account apart from a wrong password.
 * Disabled accounts are reported as `invalid` so the state is not disclosed.
 */
export async function verifyCredentials(
  username: string,
  password: string,
): Promise<CredentialResult> {
  const user = await prisma.user.findUnique({ where: { username: normalizeUsername(username) } });
  if (!user || user.disabled) return { status: 'invalid' };
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) return { status: 'invalid' };
  // Only self-registered players are unconfirmed; staff accounts are created
  // confirmed, so this only ever affects the voluntary player registration.
  if (user.role === 'PLAYER' && user.emailVerifiedAt === null) {
    return { status: 'unverified', user: toPublic(user) };
  }
  return { status: 'ok', user: toPublic(user) };
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

/**
 * Mark a single account's e-mail as confirmed (admin action). Sets
 * `emailVerifiedAt` to now, or back to `null` when `verified` is false.
 *
 * Only this one column of this one row is written: the role, password,
 * sessions, progression and game history are untouched, and no other account is
 * affected. An already-confirmed account keeps its original timestamp
 * (idempotent) so a repeated click never rewrites the recorded moment.
 */
export async function setEmailVerified(id: string, verified: boolean): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound('User not found.');
  if (!verified) {
    return toPublic(await prisma.user.update({ where: { id }, data: { emailVerifiedAt: null } }));
  }
  // Idempotent: keep the first confirmation time if one is already recorded.
  if (user.emailVerifiedAt) return toPublic(user);
  return toPublic(
    await prisma.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } }),
  );
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
