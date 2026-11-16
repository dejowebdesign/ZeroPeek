/**
 * Socket.IO rate limiting (Phase 6.8.5).
 *
 * Fastify already rate-limits HTTP, but the Socket.IO events that matter for
 * gameplay (`player:join`, `player:answer`, `player:rejoin`) bypass the HTTP
 * router entirely. This module adds a small, central token-bucket limiter for
 * those events.
 *
 * Design decisions, all deliberate:
 *
 *  - **Server-side only.** The bucket lives in the server process; a client
 *    cannot see or influence it except by sending events. Client-side checks are
 *    not a security mechanism.
 *  - **Keyed by a stable, server-owned identity**, never by anything the client
 *    sends. A join is keyed by the socket id (the only thing known before a seat
 *    exists), an answer and a rejoin by the seated `playerId`, which the server
 *    itself assigned. A manipulated payload can therefore never move the bucket
 *    to another player's key, and one player's flood cannot touch another's.
 *  - **No address as an identity.** A client address is shared by a whole NAT and
 *    is client-controlled behind a proxy, so it is never the primary key. It is
 *    used only as a coarse, looser backstop for joins, so that reconnecting to
 *    get a fresh socket id cannot bypass the per-connection limit.
 *  - **A rejection is inert.** The handler is not run, so no points, phase or
 *    state can change; the caller answers with an error ACK and the socket stays
 *    connected.
 *
 * The limiter is a plain object with an injectable clock, so the tests drive it
 * with a fake time instead of sleeping.
 */

import { tooManyRequests } from './errors.js';

/** One rule: how many calls are allowed per rolling window. */
export interface RateLimitRule {
  /** The maximum number of calls allowed inside `windowMs`. */
  max: number;
  /** The length of the rolling window, in ms. */
  windowMs: number;
}

/**
 * Every limit, defined once.
 *
 * The numbers are chosen so normal play never trips them, while a flood is
 * stopped:
 *
 *  - `join` – 10 per 10 s. A player joins once; a reload, a couple of mistyped
 *    PINs and a quick retry all fit, while a hammering loop is cut off.
 *  - `joinByAddress` – 60 per 10 s. A looser backstop per client address, so
 *    cycling reconnects to get fresh socket ids does not reset the per-connection
 *    bucket. It is deliberately generous: several players can share one NAT.
 *  - `answer` – 20 per 10 s. One answer per question is expected; the allowance
 *    covers a burst of rapid correct answers across short questions (and a few
 *    rejected duplicates) without letting a script spray answers.
 *  - `rejoin` – 15 per 10 s. A reconnect storm (a flaky network) is legitimate,
 *    so the allowance is a little higher than join.
 *  - `rejoinBySocket` – 20 per 10 s. A per-connection backstop. The seat key
 *    above is the client's `playerId`, which a client could name to spend
 *    another seat's allowance; this bounds how fast any one connection can try,
 *    so such a spray is cut off by the sender's own bucket.
 */
export const SOCKET_RATE_RULES = {
  join: { max: 10, windowMs: 10_000 },
  joinByAddress: { max: 60, windowMs: 10_000 },
  answer: { max: 20, windowMs: 10_000 },
  rejoin: { max: 15, windowMs: 10_000 },
  rejoinBySocket: { max: 20, windowMs: 10_000 },
} as const satisfies Record<string, RateLimitRule>;

/** The name of one rule in `SOCKET_RATE_RULES`. */
export type SocketRateRule = keyof typeof SOCKET_RATE_RULES;

interface Bucket {
  /** Calls still allowed in the current window. */
  remaining: number;
  /** When the current window started, in the limiter's clock units. */
  startedAt: number;
}

/** The outcome of one `consume` call. */
export interface RateLimitDecision {
  allowed: boolean;
  /** Calls still allowed in the current window, after this call. */
  remaining: number;
  /** When the window resets, in ms from now (0 when allowed). */
  retryAfterMs: number;
}

/**
 * A central token-bucket limiter, keyed by `rule` + `key`.
 *
 * Each `(rule, key)` pair gets its own rolling window: the first call opens a
 * window with `max` tokens, every call spends one, and once the window elapses
 * the next call opens a fresh one. Buckets are pruned lazily on access, so an
 * idle key costs nothing after its window passes.
 */
export class SocketRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;
  private readonly enabled: boolean;

  /**
   * @param options.now A monotonic clock in ms. Injectable so tests advance time
   *   deterministically instead of sleeping.
   * @param options.enabled When false, every `check` is a no-op. The socket
   *   suites run with this off so their own traffic is not counted; production
   *   and the dedicated rate-limit suite run with it on.
   */
  constructor(options: { now?: () => number; enabled?: boolean } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.enabled = options.enabled ?? true;
  }

  /** The bucket key for a rule and an identity. */
  private static keyOf(rule: SocketRateRule, key: string): string {
    return `${rule}\u0000${key}`;
  }

  /**
   * Spend one token for `rule` on behalf of `key`.
   *
   * Returns whether the call is allowed. A disallowed call does not spend a
   * token and does not extend the window, so a flooder cannot keep pushing the
   * reset further away; it simply waits out the window that is already open.
   */
  consume(rule: SocketRateRule, key: string): RateLimitDecision {
    const limit: RateLimitRule = SOCKET_RATE_RULES[rule];
    if (!this.enabled) return { allowed: true, remaining: limit.max, retryAfterMs: 0 };
    const now = this.now();
    const bucketKey = SocketRateLimiter.keyOf(rule, key);
    let bucket = this.buckets.get(bucketKey);

    if (!bucket || now - bucket.startedAt >= limit.windowMs) {
      bucket = { remaining: limit.max, startedAt: now };
      this.buckets.set(bucketKey, bucket);
    }

    const resetAt = bucket.startedAt + limit.windowMs;
    if (bucket.remaining <= 0) {
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, resetAt - now) };
    }

    bucket.remaining -= 1;
    return { allowed: true, remaining: bucket.remaining, retryAfterMs: 0 };
  }

  /**
   * Throw when `rule` for `key` has exhausted its window. A thin wrapper over
   * `consume`, so the socket layer reads as "guard then run" and the error is
   * the same `AppError` shape every other handler raises.
   */
  check(rule: SocketRateRule, key: string): void {
    const decision = this.consume(rule, key);
    if (!decision.allowed) {
      const seconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
      throw tooManyRequests(`Too many requests. Try again in about ${seconds}s.`);
    }
  }

  /** Drop every bucket. Used by tests to start from a clean slate. */
  reset(): void {
    this.buckets.clear();
  }
}
