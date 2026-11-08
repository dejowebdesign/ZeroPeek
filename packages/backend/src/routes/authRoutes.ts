/**
 * Authentication routes.
 *
 * `POST /api/auth/login` verifies credentials and starts a session.
 * `POST /api/auth/logout` ends it. `GET /api/auth/me` reports the current
 * session, including the CSRF token the client must echo on writes.
 *
 * Phase 6.3 adds the *optional* player registration: `register`, `verify` and
 * `resend`. None of the existing routes changed behaviour, except that login
 * now refuses an unconfirmed player account with a clear code.
 *
 * Phase 6.6.3: `POST /api/auth/login` is the one sign-in surface, and it issues
 * the session that matches the **verified role** — a `PLAYER` gets the player
 * context (`zp_player_session`), staff keep the host context (`zp_session`). The
 * role comes from the credential check on the server, never from the request, so
 * a client cannot choose its own context. The two cookie names stay distinct, so
 * a host and a player can still be signed in at the same time in one browser.
 */

import type { FastifyInstance } from 'fastify';

import { AppError, badRequest, unauthorized } from '../errors.js';
import { verifyCredentials } from '../services/userService.js';
import { registerPlayer, resendVerification, verifyEmail } from '../services/registration.js';
import type { Mailer } from '../services/mailer.js';
import {
  currentUser,
  endSession,
  requireAuth,
  startPlayerSession,
  startSession,
} from '../sessions.js';
import { type AppConfig, isMailConfigured } from '../config.js';

interface LoginBody {
  username?: string;
  password?: string;
}

interface RegisterBody {
  username?: string;
  email?: string;
  password?: string;
}

interface VerifyBody {
  token?: string;
}

interface ResendBody {
  email?: string;
}

export function registerAuthRoutes(app: FastifyInstance, config: AppConfig, mailer: Mailer): void {
  /**
   * A stricter per-route limit for the unauthenticated auth endpoints. `resend`
   * and `register` send mail, so the global ceiling is far too generous for
   * them; `verify` is bounded to slow down token guessing.
   *
   * When `authRateLimits` is off (the default in tests) the ceiling is raised so
   * a suite can drive the flow; a test that wants to prove the limit fires
   * builds the app with `AUTH_RATE_LIMITS=true`.
   */
  const limit = (max: number) => ({
    config: {
      rateLimit: {
        max: config.authRateLimits ? max : 10_000,
        timeWindow: '1 minute',
      },
    },
  });

  app.post<{ Body: LoginBody }>('/api/auth/login', limit(30), async (request, reply) => {
    const { username, password } = request.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      throw badRequest('A username and password are required.');
    }

    const result = await verifyCredentials(username, password);
    if (result.status === 'invalid') {
      request.log.warn({ username }, 'failed login');
      throw unauthorized('Invalid username or password.');
    }
    if (result.status === 'unverified') {
      // Correct password, but the address is not confirmed yet. A distinct code
      // lets the UI offer to resend the link without disclosing it to a wrong
      // password.
      throw new AppError(403, 'email_unverified', 'Please confirm your e-mail address first.');
    }

    const csrfToken =
      result.user.role === 'PLAYER'
        ? await startPlayerSession(reply, config, result.user.id)
        : await startSession(reply, config, result.user.id);
    request.log.info({ userId: result.user.id, role: result.user.role }, 'login');
    return { user: result.user, csrfToken };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await endSession(request, reply, config);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth(config) }, async (request) => {
    const user = currentUser(request);
    return { user, csrfToken: request.auth?.csrfToken ?? '' };
  });

  /**
   * Register a new player. Optional and separate from joining a game. The
   * account starts unconfirmed; a verification e-mail is sent when mail is
   * configured.
   *
   * A taken e-mail address is answered exactly like a fresh registration, so the
   * endpoint cannot be used to find out which addresses have an account. A taken
   * *username* is still reported (a display name the user can simply change).
   */
  app.post<{ Body: RegisterBody }>('/api/auth/register', limit(10), async (request) => {
    const { username, email, password } = request.body ?? {};
    const outcome = await registerPlayer(
      {
        username: typeof username === 'string' ? username : '',
        email: typeof email === 'string' ? email : '',
        password: typeof password === 'string' ? password : '',
      },
      config,
      mailer,
      request.log,
    );
    if (outcome.status === 'created') {
      request.log.info({ userId: outcome.user.id }, 'player registered');
    }
    // The body is derived only from server configuration, never from whether
    // this particular attempt created an account, so it is byte-identical for a
    // new address and an already-registered one.
    return { ok: true, verificationSent: isMailConfigured(config) };
  });

  /** Confirm an address from the link in the verification e-mail. */
  app.post<{ Body: VerifyBody }>('/api/auth/verify', limit(30), async (request) => {
    const token = request.body?.token;
    const user = await verifyEmail(typeof token === 'string' ? token : '');
    request.log.info({ userId: user.id }, 'e-mail verified');
    return { user: { id: user.id, username: user.username }, verified: true };
  });

  /**
   * Re-send a verification link. Always answers the same way, so it cannot be
   * used to discover which addresses have an account.
   */
  app.post<{ Body: ResendBody }>('/api/auth/resend', limit(5), async (request) => {
    const email = request.body?.email;
    if (typeof email !== 'string' || email.trim().length === 0) {
      throw badRequest('An e-mail address is required.');
    }
    await resendVerification(email, config, mailer, request.log);
    return { ok: true };
  });
}
