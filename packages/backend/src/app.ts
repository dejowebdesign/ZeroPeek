/**
 * Application factory.
 *
 * Builds a Fastify instance with security headers, cookie support, CORS, rate
 * limiting, the REST routes and a single JSON error handler. Database, auth and
 * Socket.IO are wired in later phases; the factory is kept pure so it can be
 * reused by tests (no listener is opened here – `server.ts` does that).
 */

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import { QUESTION_TYPE_IDS } from '@zeropeek/shared';

import { AppError } from './errors.js';
import { registerAdminRoutes } from './routes/adminRoutes.js';
import { registerAuthRoutes } from './routes/authRoutes.js';
import { registerQuizRoutes } from './routes/quizRoutes.js';
import { registerReportRoutes } from './routes/reportRoutes.js';
import type { AppConfig } from './config.js';

/** Strict Content-Security-Policy matching the frontend's CSP-compliant design. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export interface BuildAppOptions {
  config: AppConfig;
}

export async function buildApp({ config }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.nodeEnv === 'test' ? false : { level: config.logLevel, transport: undefined },
    trustProxy: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
    },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  });

  // `sessionSecret` is validated in production by `loadConfig`; the placeholder
  // only ever applies to development/test.
  await app.register(cookie, { secret: config.sessionSecret });

  // Browser requests come from the frontend origin; the proxy makes them
  // same-origin in production, so credentials are allowed for that one origin.
  await app.register(cors, { origin: config.corsOrigin, credentials: true });

  // A global ceiling; the socket layer adds stricter limits on hot paths.
  await app.register(rateLimit, {
    max: config.nodeEnv === 'test' ? 10_000 : 300,
    timeWindow: '1 minute',
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
  });

  /**
   * Single JSON error handler. `AppError` becomes its documented status and
   * code; a Fastify validation error becomes 400; anything else is a 500 whose
   * details stay in the log.
   */
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.issues ? { issues: error.issues } : {}),
        },
      });
    }
    if (error.statusCode === 429) {
      return reply
        .status(429)
        .send({ error: { code: 'rate_limited', message: 'Too many requests.' } });
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply
        .status(error.statusCode)
        .send({ error: { code: 'bad_request', message: error.message } });
    }
    request.log.error({ error }, 'unhandled error');
    return reply
      .status(500)
      .send({ error: { code: 'internal', message: 'An unexpected error occurred.' } });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } });
  });

  /**
   * Liveness/readiness probe. Reports service identity and the number of
   * question types loaded from the shared domain, which proves the workspace
   * link between backend and shared is working.
   */
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'zeropeek-backend',
    version: '0.0.0',
    questionTypes: QUESTION_TYPE_IDS.length,
  }));

  registerAuthRoutes(app, config);
  registerQuizRoutes(app, config);
  registerReportRoutes(app, config);
  registerAdminRoutes(app, config);

  return app;
}
