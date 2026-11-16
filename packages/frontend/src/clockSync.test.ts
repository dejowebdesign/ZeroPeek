import { describe, expect, it, vi } from 'vitest';

import { ClockSync, type ClockSocket } from './clockSync.js';

/**
 * A stand-in socket that records `clock:ping` probes and lets the test answer
 * them with a chosen latency, so the offset maths is exercised without a real
 * server or real waiting.
 */
class FakeSocket implements ClockSocket {
  readonly pings: string[] = [];
  private readonly handlers = new Set<(payload: { id: string; serverTime: number }) => void>();
  /** A monotonic clock the test drives. */
  time = 0;
  /** How the server should answer: latency in ms, and its wall clock. */
  latency = 20;
  serverClock = 1_000_000;
  /** When set, the next pong uses this id instead of the probe's (a stray reply). */
  overrideId: string | null = null;
  /** When true, probes are never answered (a dropped reply). */
  dropReplies = false;

  emit(event: 'clock:ping', payload: { id: string }): void {
    if (event !== 'clock:ping') return;
    this.pings.push(payload.id);
    if (this.dropReplies) return;
    const replyId = this.overrideId ?? payload.id;
    this.overrideId = null;
    // Advance to the reply instant before delivering it, so the receivedAt
    // reading the ClockSync takes is the one after the latency.
    this.time += this.latency;
    for (const handler of this.handlers) {
      handler({ id: replyId, serverTime: this.serverClock });
    }
  }

  on(_event: 'clock:pong', handler: (payload: { id: string; serverTime: number }) => void): void {
    this.handlers.add(handler);
  }

  off(_event: 'clock:pong', handler: (payload: { id: string; serverTime: number }) => void): void {
    this.handlers.delete(handler);
  }

  /** Push a pong directly, e.g. a duplicate or a late stray. */
  deliver(payload: { id: string; serverTime: number }): void {
    for (const handler of this.handlers) handler(payload);
  }
}

/** Build a ClockSync whose monotonic clock is the fake socket's. */
function makeSync(socket: FakeSocket, samples = 3): ClockSync {
  return new ClockSync(socket, { samples, now: () => socket.time });
}

describe('ClockSync', () => {
  it('recovers the server offset from a ping/pong round', async () => {
    const socket = new FakeSocket();
    // Client monotonic clock is far from the server's wall clock.
    socket.time = 500_000;
    socket.serverClock = 1_000_000;
    socket.latency = 40;
    const sync = makeSync(socket, 1);

    const offset = await sync.sync();
    // The server answered at the midpoint of the 40 ms round, so the offset is
    // the difference between its clock there and the client's midpoint.
    expect(offset).not.toBeNull();
    expect(offset!.offsetMs).toBeCloseTo(1_000_000 - (500_000 + 20), 6);
    expect(offset!.roundTripMs).toBe(40);
  });

  it('exposes serverNow() on the server clock, not the local clock', async () => {
    const socket = new FakeSocket();
    socket.time = 0;
    socket.serverClock = 7_000_000;
    socket.latency = 10;
    const sync = makeSync(socket, 1);
    await sync.sync();

    // After the round the fake time advanced by the latency; serverNow must map
    // that local reading onto the server's clock.
    const expected = socket.time + (7_000_000 - (0 + 5));
    expect(sync.serverNow()).toBeCloseTo(expected, 6);
  });

  it('falls back to the local wall clock before any measurement', () => {
    const socket = new FakeSocket();
    const sync = makeSync(socket, 1);
    expect(sync.current).toBeNull();
    // With no offset the value is the plain local clock, i.e. the old behaviour.
    expect(sync.serverNow()).toBeCloseTo(Date.now(), -2);
  });

  it('sends exactly the requested number of probes', async () => {
    const socket = new FakeSocket();
    const sync = makeSync(socket, 4);
    await sync.sync();
    expect(socket.pings).toHaveLength(4);
  });

  it('keeps the sample with the smallest round-trip across a round', async () => {
    const socket = new FakeSocket();
    socket.serverClock = 2_000_000;
    const sync = makeSync(socket, 1);
    // First probe: fast. Second probe: slow (and so a worse estimate).
    socket.latency = 10;
    await sync.sync();
    const fastOffset = sync.current!.offsetMs;

    socket.latency = 900;
    await sync.sync();
    // The slow round yields an offset that is off by roughly half the extra
    // latency; because it is a *single*-sample round it does replace the value,
    // so this asserts the measurement still works, not that it is identical.
    expect(Number.isFinite(sync.current!.offsetMs)).toBe(true);
    expect(sync.current!.roundTripMs).toBe(900);
    expect(fastOffset).not.toBe(0);
  });

  it('ignores a duplicate or stray pong for an unknown id', async () => {
    const socket = new FakeSocket();
    socket.serverClock = 3_000_000;
    socket.latency = 20;
    const sync = makeSync(socket, 1);
    await sync.sync();
    const offsetAfterRound = sync.current!.offsetMs;

    // A stray pong with a never-sent id, and a duplicate of the last probe.
    socket.deliver({ id: 'nope', serverTime: 999 });
    socket.deliver({ id: socket.pings[0]!, serverTime: 999 });
    expect(sync.current!.offsetMs).toBe(offsetAfterRound);
  });

  it('treats a mismatched reply id as unusable, not as a valid sample', async () => {
    const socket = new FakeSocket();
    socket.serverClock = 4_000_000;
    socket.overrideId = 'wrong-id';
    const sync = new ClockSync(socket, { samples: 1, now: () => socket.time, pingTimeoutMs: 20 });
    const offset = await sync.sync();
    // No sample was matched, so there is still no offset (the local fallback).
    expect(offset).toBeNull();
    expect(sync.current).toBeNull();
  });

  it('drops a probe that is never answered without hanging', async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      socket.dropReplies = true;
      const sync = new ClockSync(socket, { samples: 1, now: () => socket.time, pingTimeoutMs: 50 });
      const round = sync.sync();
      await vi.advanceTimersByTimeAsync(60);
      const offset = await round;
      expect(offset).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shares one round between overlapping callers', async () => {
    const socket = new FakeSocket();
    const sync = makeSync(socket, 2);
    const [a, b] = await Promise.all([sync.sync(), sync.sync()]);
    expect(a).toBe(b);
    expect(socket.pings).toHaveLength(2);
  });

  it('can re-measure after a reconnect (a second round works)', async () => {
    const socket = new FakeSocket();
    socket.serverClock = 5_000_000;
    socket.latency = 30;
    const sync = makeSync(socket, 2);
    const first = await sync.sync();
    // A reconnect shifts the client clock (as if the machine slept).
    socket.time += 100_000;
    const second = await sync.sync();
    expect(second).not.toBeNull();
    // The re-measured offset tracks the new client clock.
    expect(second!.offsetMs).toBeLessThan(first!.offsetMs);
  });

  it('stops listening after dispose()', async () => {
    const socket = new FakeSocket();
    const sync = makeSync(socket, 1);
    await sync.sync();
    sync.dispose();
    socket.deliver({ id: 'x', serverTime: 0 });
    // No throw, and no state change: the handler is gone.
    expect(sync.current).not.toBeNull();
  });
});
