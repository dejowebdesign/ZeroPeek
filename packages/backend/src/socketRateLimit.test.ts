import { describe, expect, it } from 'vitest';

import { AppError } from './errors.js';
import { SOCKET_RATE_RULES, SocketRateLimiter } from './socketRateLimit.js';

/** A controllable clock so the tests advance time instead of sleeping. */
function fakeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return { now: () => current, advance: (ms) => (current += ms) };
}

describe('SocketRateLimiter', () => {
  it('allows up to the limit, then rejects', () => {
    const clock = fakeClock();
    const limiter = new SocketRateLimiter({ now: clock.now });
    const { max } = SOCKET_RATE_RULES.join;

    for (let i = 0; i < max; i += 1) {
      expect(limiter.consume('join', 'socket:1').allowed).toBe(true);
    }
    const rejected = limiter.consume('join', 'socket:1');
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
    expect(rejected.retryAfterMs).toBe(SOCKET_RATE_RULES.join.windowMs);
  });

  it('reopens the window after it elapses', () => {
    const clock = fakeClock();
    const limiter = new SocketRateLimiter({ now: clock.now });
    const { max, windowMs } = SOCKET_RATE_RULES.join;

    for (let i = 0; i < max; i += 1) limiter.consume('join', 'k');
    expect(limiter.consume('join', 'k').allowed).toBe(false);

    clock.advance(windowMs);
    expect(limiter.consume('join', 'k').allowed).toBe(true);
  });

  it('keeps windows of different keys independent', () => {
    const limiter = new SocketRateLimiter({ now: fakeClock().now });
    const { max } = SOCKET_RATE_RULES.answer;

    for (let i = 0; i < max; i += 1) limiter.consume('answer', 'player:a');
    expect(limiter.consume('answer', 'player:a').allowed).toBe(false);
    // A different player is untouched by the first player's exhaustion.
    expect(limiter.consume('answer', 'player:b').allowed).toBe(true);
  });

  it('keeps windows of different rules independent for the same key', () => {
    const limiter = new SocketRateLimiter({ now: fakeClock().now });
    const { max } = SOCKET_RATE_RULES.join;
    for (let i = 0; i < max; i += 1) limiter.consume('join', 'same');
    expect(limiter.consume('join', 'same').allowed).toBe(false);
    // The same identity still has its full answer allowance.
    expect(limiter.consume('answer', 'same').allowed).toBe(true);
  });

  it('does not extend the window when a rejected call arrives', () => {
    const clock = fakeClock();
    const limiter = new SocketRateLimiter({ now: clock.now });
    const { max, windowMs } = SOCKET_RATE_RULES.join;

    for (let i = 0; i < max; i += 1) limiter.consume('join', 'k');
    // Spend most of the window, then hammer it: the reset must stay fixed.
    clock.advance(windowMs - 100);
    expect(limiter.consume('join', 'k').allowed).toBe(false);
    clock.advance(100);
    expect(limiter.consume('join', 'k').allowed).toBe(true);
  });

  it('reports the remaining time until reset', () => {
    const clock = fakeClock();
    const limiter = new SocketRateLimiter({ now: clock.now });
    const { max, windowMs } = SOCKET_RATE_RULES.rejoin;
    for (let i = 0; i < max; i += 1) limiter.consume('rejoin', 'k');
    clock.advance(4000);
    const rejected = limiter.consume('rejoin', 'k');
    expect(rejected.retryAfterMs).toBe(windowMs - 4000);
  });

  it('throws an AppError (429) from check when the limit is exhausted', () => {
    const limiter = new SocketRateLimiter({ now: fakeClock().now });
    const { max } = SOCKET_RATE_RULES.join;
    for (let i = 0; i < max; i += 1) limiter.check('join', 'k');
    try {
      limiter.check('join', 'k');
      throw new Error('expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(429);
      expect((error as AppError).code).toBe('rate_limited');
    }
  });

  it('is a no-op when disabled, so the socket suites are not tripped', () => {
    const clock = fakeClock();
    const limiter = new SocketRateLimiter({ now: clock.now, enabled: false });
    for (let i = 0; i < SOCKET_RATE_RULES.join.max + 50; i += 1) {
      expect(limiter.consume('join', 'k').allowed).toBe(true);
    }
  });

  it('reset() clears every bucket', () => {
    const limiter = new SocketRateLimiter({ now: fakeClock().now });
    const { max } = SOCKET_RATE_RULES.join;
    for (let i = 0; i < max; i += 1) limiter.consume('join', 'k');
    expect(limiter.consume('join', 'k').allowed).toBe(false);
    limiter.reset();
    expect(limiter.consume('join', 'k').allowed).toBe(true);
  });
});

describe('socket rate limit rules', () => {
  it('allows a normal, fast player to answer without tripping the limit', () => {
    // A fast player answers every few seconds; 20 answers in 10 s is far above
    // anything a human round can produce, so the limit never bites normal play.
    expect(SOCKET_RATE_RULES.answer.max).toBeGreaterThanOrEqual(10);
    expect(SOCKET_RATE_RULES.answer.windowMs).toBeGreaterThanOrEqual(10_000);
  });

  it('gives rejoin a little more room than join, for reconnect storms', () => {
    expect(SOCKET_RATE_RULES.rejoin.max).toBeGreaterThan(SOCKET_RATE_RULES.join.max);
  });

  it('gives the per-address join backstop a looser limit than the per-socket one', () => {
    expect(SOCKET_RATE_RULES.joinByAddress.max).toBeGreaterThan(SOCKET_RATE_RULES.join.max);
  });

  it('gives the per-socket rejoin backstop a looser limit than the per-seat one', () => {
    expect(SOCKET_RATE_RULES.rejoinBySocket.max).toBeGreaterThan(SOCKET_RATE_RULES.rejoin.max);
  });
});
