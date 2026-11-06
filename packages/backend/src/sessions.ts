/**
 * Server-side sessions and CSRF.
 *
 * The browser holds only an opaque session id in an HttpOnly cookie (ADR 0006).
 * The session row carries the user, the expiry and the CSRF token, so a session
 * can be revoked server-side and a stolen cookie alone cannot perform a
 * state-changing request without the CSRF token.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

import { prisma } from './db.js';
import { forbidden, unauthorized } from './errors.js';
import { newCsrfToken, newSessionId, safeEqual } from './auth.js';
import type { AppConfig } from './config.js';

/** Methods that must carry a valid CSRF token. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth guard on protected routes. */
    auth?: AuthContext;
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

/** Create a session row and set the cookie. Returns the CSRF token. */
export async function startSession(
  reply: FastifyReply,
  config: AppConfig,
  userId: string,
): Promise<string> {
  const id = newSessionId();
  const csrfToken = newCsrfToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlMs);

  await prisma.session.create({ data: { id, userId, csrfToken, expiresAt } });
  reply.setCookie(config.sessionCookieName, id, cookieOptions(config));
  return csrfToken;
}

/** Delete the session row (if any) and clear the cookie. */
export async function endSession(
  request: FastifyRequest,
  reply: FastifyReply,
  config: AppConfig,
): Promise<void> {
  const id = request.cookies?.[config.sessionCookieName];
  if (id) {
    await prisma.session.deleteMany({ where: { id } });
  }
  reply.clearCookie(config.sessionCookieName, { path: '/' });
}

/**
 * Resolve the current session from the cookie. Returns `null` when there is no
 * cookie, the session is unknown, or it has expired.
 */
export async function resolveSession(
  request: FastifyRequest,
  config: AppConfig,
): Promise<AuthContext | null> {
  // `request.cookies` is only present when `@fastify/cookie` has decorated the
  // request; a raw socket upgrade request has none, hence the guard.
  const id = request.cookies?.[config.sessionCookieName];
  if (!id) return null;

  const session = await prisma.session.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.deleteMany({ where: { id } });
    return null;
  }
  if (session.user.disabled) return null;

  return {
    sessionId: session.id,
    csrfToken: session.csrfToken,
    user: {
      id: session.user.id,
      username: session.user.username,
      email: session.user.email,
      role: session.user.role,
    },
  };
}

/**
 * Fastify preHandler: require a session and, for unsafe methods, a matching
 * `X-CSRF-Token` header. On success `request.auth` is set.
 */
export function requireAuth(config: AppConfig) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const auth = await resolveSession(request, config);
    if (!auth) throw unauthorized();

    if (UNSAFE_METHODS.has(request.method)) {
      const header = request.headers['x-csrf-token'];
      const token = Array.isArray(header) ? header[0] : header;
      if (typeof token !== 'string' || !safeEqual(token, auth.csrfToken)) {
        throw forbidden('Invalid or missing CSRF token.');
      }
    }

    request.auth = auth;
  };
}

/** Fastify preHandler: require an authenticated ADMIN. */
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

/** The authenticated user, or a 401. Use after `requireAuth`. */
export function currentUser(request: FastifyRequest): SessionUser {
  if (!request.auth) throw unauthorized();
  return request.auth.user;
}
