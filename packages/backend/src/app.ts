/**
 * Application factory.
 *
 * Builds a Fastify instance with the security headers, cookie support and a
 * minimal health endpoint. Database, auth and Socket.IO are wired in later
 * phases; the factory is kept pure so it can be reused by tests.
 */

import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';

import { QUESTION_TYPE_IDS } from '@zeropeek/shared';

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

  await app.register(cookie, { secret: process.env.SESSION_SECRET ?? 'phase-0-placeholder' });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
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

  return app;
}
