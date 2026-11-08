/**
 * Server-side sessions and CSRF, in **two separate identity contexts**.
 *
 * The browser holds only an opaque session id in an HttpOnly cookie (ADR 0006).
 * The session row carries the user, the expiry, the CSRF token **and its kind**,
 * so a session can be revoked server-side and a stolen cookie alone cannot
 * perform a state-changing request without the CSRF token.
 *
 * Phase 6.6.3 splits the single context into two, because one cookie shared by
 * every surface meant a host signed in on a browser was also the identity of the
 * player surface in another tab of that browser:
 *
 *   - **host**   – `zp_session` (`config.sessionCookieName`), the staff surfaces.
 *   - **player** – `zp_player_session` (`config.playerSessionCookieName`), the
 *                  player profile.
 *
 * A session is only ever accepted by the context it was created for: the row's
 * `kind` must match. A host guard never reads the player cookie and a player
 * guard never reads the host cookie, so an ADMIN signed in as a host is never
 * resolved as a player — even in the same browser. Logging out of one context
 * deletes only that context's session and cookie.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

import { prisma } from './db.js';
import { forbidden, unauthorized } from './errors.js';
import { newCsrfToken, newSessionId, safeEqual } from './auth.js';
import type { AppConfig } from './config.js';

/** Methods that must carry a valid CSRF token. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The identity context a session belongs to. */
export type SessionKind = 'host' | 'player';

export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
  role: 'ADMIN' | 'TRAINER' | 'PLAYER';
}

/** The authenticated context attached to a request. */
export interface AuthContext {
  user: SessionUser;
  sessionId: string;
  csrfToken: string;
  kind: SessionKind;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by a host auth guard on protected routes. */
    auth?: AuthContext;
    /** Set by the player auth guard on player-protected routes. */
    playerAuth?: AuthContext;
  }
}

/** Cookie options matching the deployment's TLS setting. */
function cookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.cookieSecure,
    path: '/',
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  };
}

/** The cookie name for a context. */
function cookieName(config: AppConfig, kind: SessionKind): string {
  return kind === 'player' ? config.playerSessionCookieName : config.sessionCookieName;
}

/** Create a session row and set the cookie. Returns the CSRF token. */
async function createSession(
  reply: FastifyReply,
  config: AppConfig,
  userId: string,
  kind: SessionKind,
): Promise<string> {
  const id = newSessionId();
  const csrfToken = newCsrfToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlMs);

  await prisma.session.create({ data: { id, userId, csrfToken, expiresAt, kind } });
  reply.setCookie(cookieName(config, kind), id, cookieOptions(config));
  return csrfToken;
}

/** Delete the session row (if any) for a context and clear its cookie. */
async function destroySession(
  request: FastifyRequest,
  reply: FastifyReply,
  config: AppConfig,
  kind: SessionKind,
): Promise<void> {
  const name = cookieName(config, kind);
  const id = request.cookies?.[name];
  if (id) {
    // Scoped by kind, so a cookie that somehow holds another context's id can
    // never delete that context's session.
    await prisma.session.deleteMany({ where: { id, kind } });
  }
  reply.clearCookie(name, { path: '/' });
}

/**
 * Resolve a session of a given context from its cookie. Returns `null` when
 * there is no cookie, the session is unknown, has expired, or belongs to the
 * other context.
 */
async function resolve(
  request: FastifyRequest,
  config: AppConfig,
  kind: SessionKind,
): Promise<AuthContext | null> {
  // `request.cookies` is only present when `@fastify/cookie` has decorated the
  // request; a raw socket upgrade request has none, hence the guard.
  const id = request.cookies?.[cookieName(config, kind)];
  if (!id) return null;

  const session = await prisma.session.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!session) return null;
  // A session is bound to the context that created it: a host id presented as a
  // player (or the reverse) is not a valid session here.
  if (session.kind !== kind) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.deleteMany({ where: { id } });
    return null;
  }
  if (session.user.disabled) return null;

  return {
    sessionId: session.id,
    csrfToken: session.csrfToken,
    kind,
    user: {
      id: session.user.id,
      username: session.user.username,
      email: session.user.email,
      role: session.user.role,
    },
  };
}

/** Shared CSRF check for unsafe methods. */
function assertCsrf(request: FastifyRequest, auth: AuthContext): void {
  if (!UNSAFE_METHODS.has(request.method)) return;
  const header = request.headers['x-csrf-token'];
  const token = Array.isArray(header) ? header[0] : header;
  if (typeof token !== 'string' || !safeEqual(token, auth.csrfToken)) {
    throw forbidden('Invalid or missing CSRF token.');
  }
}

// ---------------------------------------------------------------------------
// Host context (existing behaviour, unchanged).
// ---------------------------------------------------------------------------

/** Create a **host** session and set `zp_session`. Returns the CSRF token. */
export async function startSession(
  reply: FastifyReply,
  config: AppConfig,
  userId: string,
): Promise<string> {
  return createSession(reply, config, userId, 'host');
}

/** Delete the host session (if any) and clear `zp_session`. */
export async function endSession(
  request: FastifyRequest,
  reply: FastifyReply,
  config: AppConfig,
): Promise<void> {
  return destroySession(request, reply, config, 'host');
}

/** Resolve the host session from `zp_session`. */
export async function resolveSession(
  request: FastifyRequest,
  config: AppConfig,
): Promise<AuthContext | null> {
  return resolve(request, config, 'host');
}

// ---------------------------------------------------------------------------
// Player context (Phase 6.6.3).
// ---------------------------------------------------------------------------

/** Create a **player** session and set `zp_player_session`. Returns the CSRF token. */
export async function startPlayerSession(
  reply: FastifyReply,
  config: AppConfig,
  userId: string,
): Promise<string> {
  return createSession(reply, config, userId, 'player');
}

/** Delete the player session (if any) and clear `zp_player_session`. */
export async function endPlayerSession(
  request: FastifyRequest,
  reply: FastifyReply,
  config: AppConfig,
): Promise<void> {
  return destroySession(request, reply, config, 'player');
}

/** Resolve the player session from `zp_player_session`. */
export async function resolvePlayerSession(
  request: FastifyRequest,
  config: AppConfig,
): Promise<AuthContext | null> {
  return resolve(request, config, 'player');
}

// ---------------------------------------------------------------------------
// Guards.
// ---------------------------------------------------------------------------

/**
 * Fastify preHandler: require a **host** session and, for unsafe methods, a
 * matching `X-CSRF-Token` header. On success `request.auth` is set.
 */
export function requireAuth(config: AppConfig) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const auth = await resolveSession(request, config);
    if (!auth) throw unauthorized();
    assertCsrf(request, auth);
    request.auth = auth;
  };
}

/**
 * Fastify preHandler: require a **player** session and, for unsafe methods, a
 * matching `X-CSRF-Token` header. On success `request.playerAuth` is set.
 *
 * This guard reads only `zp_player_session`. A host session is not accepted as
 * a player session, so a signed-in host is treated as a signed-out player.
 */
export function requirePlayerAuth(config: AppConfig) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const auth = await resolvePlayerSession(request, config);
    if (!auth) throw unauthorized();
    assertCsrf(request, auth);
    request.playerAuth = auth;
  };
}

/** Fastify preHandler: require an authenticated ADMIN (host context). */
export function requireAdmin(config: AppConfig) {
  const authGuard = requireAuth(config);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authGuard(request, reply);
    if (request.auth?.user.role !== 'ADMIN') throw forbidden('Administrator role required.');
  };
}

/**
 * Fastify preHandler: require an ADMIN or TRAINER – a staff account.
 *
 * The trainer surfaces (quizzes, reports) and the host socket use this. A
 * `PLAYER` account, introduced in Phase 6.3, is authenticated but is not staff,
 * so it cannot reach them. ADMIN and TRAINER keep exactly the access they had
 * before, so no existing permission is removed.
 */
export function requireStaff(config: AppConfig) {
  const authGuard = requireAuth(config);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authGuard(request, reply);
    const role = request.auth?.user.role;
    if (role !== 'ADMIN' && role !== 'TRAINER') {
      throw forbidden('This area is for hosts and administrators.');
    }
  };
}

/** The authenticated host user, or a 401. Use after `requireAuth`. */
export function currentUser(request: FastifyRequest): SessionUser {
  if (!request.auth) throw unauthorized();
  return request.auth.user;
}

/** The authenticated player user, or a 401. Use after `requirePlayerAuth`. */
export function currentPlayer(request: FastifyRequest): SessionUser {
  if (!request.playerAuth) throw unauthorized();
  return request.playerAuth.user;
}
