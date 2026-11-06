/**
 * Voluntary player registration and e-mail confirmation (Phase 6.3).
 *
 * This is strictly additive: it creates `PLAYER` accounts and never touches the
 * existing ADMIN/TRAINER accounts, sessions or login. Registration is optional –
 * joining a game as a guest does not go through here at all.
 *
 * Security:
 *  - the password is validated with the shared rules and hashed with the
 *    existing Argon2id implementation (never stored or logged in clear text);
 *  - only the SHA-256 hash of a verification token is stored, so a database
 *    leak does not hand out usable links;
 *  - a token is single-use and time-limited, and requesting a new one replaces
 *    the old one;
 *  - a new account stays unconfirmed and cannot sign in until the link is
 *    followed.
 */

import { type AppConfig, isMailConfigured } from '../config.js';
import { prisma } from '../db.js';
import { AppError, conflict, invalid } from '../errors.js';
import { hashPassword, hashVerificationToken, newVerificationToken } from '../auth.js';
import { normalizeEmail, validateRegistration } from '@zeropeek/shared';
import { createUser, normalizeUsername, type PublicUser } from './userService.js';
import { type Mailer, verificationEmail } from './mailer.js';

/** The subset of a logger used here. */
interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

/**
 * The outcome of a registration attempt. `already-registered` means the address
 * is already on file; the caller must answer exactly as it does for `created`,
 * so the endpoint cannot be used to discover which addresses have an account.
 */
export type RegisterOutcome =
  { status: 'created'; user: PublicUser; mailSent: boolean } | { status: 'already-registered' };

/** Build the absolute verification link the e-mail points at. */
function buildVerifyUrl(config: AppConfig, token: string): string {
  const base = config.appBaseUrl.replace(/\/+$/, '');
  return `${base}/auth.html#verify=${encodeURIComponent(token)}`;
}

/**
 * Create a new player account and send the confirmation e-mail.
 *
 * Throws a 422 with per-field issues when the input is invalid, and a 409 when
 * the *username* is already taken (a display name the user must be able to
 * change). A taken **e-mail** is deliberately not reported: it returns
 * `already-registered` and no account is created, so the response is identical
 * to a fresh registration and no address can be enumerated. The account is
 * created unconfirmed.
 */
export async function registerPlayer(
  input: RegisterInput,
  config: AppConfig,
  mailer: Mailer,
  log: Logger,
): Promise<RegisterOutcome> {
  const issues = validateRegistration(input);
  if (issues.length > 0) throw invalid('Please correct the highlighted fields.', issues);

  const email = normalizeEmail(input.email);
  const username = normalizeUsername(input.username);

  const usernameTaken = await prisma.user.findUnique({ where: { username } });
  if (usernameTaken) throw conflict('That username is already taken.', 'username_taken');

  const emailTaken = await prisma.user.findUnique({ where: { email } });
  if (emailTaken) {
    await equalizeTiming(input.password);
    return { status: 'already-registered' };
  }

  let user: PublicUser;
  try {
    user = await createUser({
      username: input.username,
      password: input.password,
      email,
      role: 'PLAYER',
      emailVerifiedAt: null,
    });
  } catch (error) {
    // A concurrent request can still lose the race. A duplicate e-mail is
    // answered the same generic way; a duplicate username stays visible.
    if (error instanceof AppError && error.code === 'email_taken') {
      await equalizeTiming(input.password);
      return { status: 'already-registered' };
    }
    throw error;
  }

  const mailSent = await issueVerification(user, config, mailer, log);
  return { status: 'created', user, mailSent };
}

/**
 * Spend roughly the same time as a real registration hashing a password. The
 * `created` path hashes with Argon2id; without this the `already-registered`
 * path would answer noticeably faster and leak account existence by timing.
 */
async function equalizeTiming(password: string): Promise<void> {
  await hashPassword(password);
}

/**
 * Create (or replace) the verification token for a user and send the e-mail.
 * Any previous token for the user is removed first, so only the newest link
 * works. Returns whether the e-mail was handed to a transport.
 */
export async function issueVerification(
  user: Pick<PublicUser, 'id' | 'username' | 'email'>,
  config: AppConfig,
  mailer: Mailer,
  log: Logger,
): Promise<boolean> {
  if (!user.email) return false;

  const token = newVerificationToken();
  const expiresAt = new Date(Date.now() + config.emailVerifyTtlMs);

  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } }),
    prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash: hashVerificationToken(token), expiresAt },
    }),
  ]);

  const verifyUrl = buildVerifyUrl(config, token);

  if (!mailer.enabled || !isMailConfigured(config)) {
    // No transport configured. The verification link is never logged, in any
    // environment: a token in a log is a credential in a log. The link can be
    // re-issued from the UI once mail is configured.
    log.warn('verification e-mail not sent: SMTP_URL and/or MAIL_FROM are not configured.');
    return false;
  }

  try {
    const message = verificationEmail({
      username: user.username,
      verifyUrl,
      ttlHours: Math.round(config.emailVerifyTtlMs / 3_600_000),
    });
    const sent = await mailer.send({ to: user.email, ...message });
    if (sent) log.info(`verification e-mail sent for user ${user.id}`);
    return sent;
  } catch (error) {
    // A mail failure must not fail the registration itself; the account exists
    // and the link can be re-requested.
    log.error(`could not send verification e-mail for user ${user.id}`);
    return false;
  }
}

/**
 * Consume a verification token. On success the account is marked confirmed and
 * every token for that user is deleted. Throws a 400 when the token is unknown
 * or expired, so the UI can offer to resend.
 */
export async function verifyEmail(token: string): Promise<PublicUser> {
  if (typeof token !== 'string' || token.length === 0) {
    throw invalid('The confirmation link is invalid.', [
      { path: 'token', message: 'A confirmation token is required.' },
    ]);
  }

  const row = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashVerificationToken(token) },
    include: { user: true },
  });
  if (!row) {
    throw invalid('This confirmation link is invalid or has already been used.', [
      { path: 'token', message: 'Unknown or already-used confirmation token.' },
    ]);
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.emailVerificationToken.deleteMany({ where: { userId: row.userId } });
    throw invalid('This confirmation link has expired. Request a new one.', [
      { path: 'token', message: 'Expired confirmation token.' },
    ]);
  }

  const [updated] = await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: { emailVerifiedAt: row.user.emailVerifiedAt ?? new Date() },
    }),
    prisma.emailVerificationToken.deleteMany({ where: { userId: row.userId } }),
  ]);

  return {
    id: updated.id,
    username: updated.username,
    email: updated.email,
    role: updated.role,
    disabled: updated.disabled,
    emailVerifiedAt: updated.emailVerifiedAt,
    createdAt: updated.createdAt,
  };
}

/**
 * Re-send a verification link for an unconfirmed account. Deliberately returns
 * the same shape whether or not the address exists, so it cannot be used to
 * enumerate accounts.
 */
export async function resendVerification(
  email: string,
  config: AppConfig,
  mailer: Mailer,
  log: Logger,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user || user.disabled || user.role !== 'PLAYER' || user.emailVerifiedAt !== null) return;
  await issueVerification(
    { id: user.id, username: user.username, email: user.email },
    config,
    mailer,
    log,
  );
}
