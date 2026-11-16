/**
 * Client-side clock synchronisation (Phase 6.8.5).
 *
 * The countdown is drawn from the server's `openedAt`, but a browser can only
 * compare that to its own clock, and client clocks drift. This module runs a
 * short ping/pong round against the server, keeps the best offset (see the
 * shared `clock.ts`) and exposes `serverNow()`, a reading on the **server's**
 * clock. The countdown then ticks against that, so every device shows the same
 * number even when their wall clocks disagree.
 *
 * The server stays authoritative: a corrected reading only changes what the
 * countdown *shows*. Whether an answer was in time is decided by the server.
 *
 * Timing uses `performance.now()` (monotonic), never `Date.now()`, so a wall
 * clock change or a system resume cannot corrupt a measurement. Only the final
 * `serverNow()` is in wall-clock units, because that is what `openedAt` uses.
 */

import {
  bestOffset,
  CLOCK_SAMPLE_COUNT,
  type ClockOffset,
  type ClockSample,
} from '@zeropeek/shared';

/**
 * The small slice of a Socket.IO socket this module needs. Declared structurally
 * so a player socket and a host socket both fit without dragging in their event
 * maps, and so the unit test can pass a plain stub.
 */
export interface ClockSocket {
  emit: (event: 'clock:ping', payload: { id: string }) => unknown;
  on: (event: 'clock:pong', handler: (payload: ClockPongPayload) => void) => unknown;
  off: (event: 'clock:pong', handler: (payload: ClockPongPayload) => void) => unknown;
}

export interface ClockSyncOptions {
  /** How many probes one `sync()` round sends. Defaults to `CLOCK_SAMPLE_COUNT`. */
  samples?: number;
  /** The monotonic clock, in ms. Defaults to `performance.now()`. */
  now?: () => number;
  /** How long to wait for a single pong before dropping that probe. */
  pingTimeoutMs?: number;
}

/** The pong payload, structurally typed so the client need not import the event map. */
interface ClockPongPayload {
  id: string;
  serverTime: number;
}

/**
 * Measures and holds the offset between this client's clock and the server's.
 *
 * One instance lives per socket. `sync()` may be called again at any time (after
 * a reconnect, or to refresh a stale estimate); a call in progress is reused, so
 * overlapping callers share one round rather than stacking probes.
 */
export class ClockSync {
  private readonly socket: ClockSocket;
  private readonly samples: number;
  private readonly now: () => number;
  private readonly pingTimeoutMs: number;
  private offset: ClockOffset | null = null;
  private pending: Promise<ClockOffset | null> | null = null;
  private counter = 0;
  private readonly onPong: (payload: ClockPongPayload) => void;
  /** Probes in flight, keyed by their correlation id, with their send time. */
  private readonly waiting = new Map<
    string,
    { sentAt: number; resolve: (s: ClockSample | null) => void }
  >();

  constructor(socket: ClockSocket, options: ClockSyncOptions = {}) {
    this.socket = socket;
    this.samples = Math.max(1, options.samples ?? CLOCK_SAMPLE_COUNT);
    this.now =
      options.now ??
      (typeof performance !== 'undefined' ? () => performance.now() : () => Date.now());
    this.pingTimeoutMs = options.pingTimeoutMs ?? 2000;
    this.onPong = (payload) => this.resolvePong(payload);
    this.socket.on('clock:pong', this.onPong);
  }

  /** Stop listening. The socket itself is owned by the caller. */
  dispose(): void {
    this.socket.off('clock:pong', this.onPong);
  }

  /** The current best offset, or `null` before the first usable measurement. */
  get current(): ClockOffset | null {
    return this.offset;
  }

  /**
   * A reading on the server's clock, in ms since the Unix epoch.
   *
   * With no measurement yet this falls back to the local wall clock, which is
   * exactly the pre-6.8.5 behaviour — so a countdown is never worse than before,
   * only corrected once a sample lands.
   */
  serverNow(): number {
    if (!this.offset) return Date.now();
    return this.now() + this.offset.offsetMs;
  }

  /**
   * Run one measurement round: `samples` probes, then keep the best offset.
   *
   * The round is sequential so a burst does not swamp a slow link, and each
   * probe has its own timeout, so one lost pong costs one sample, not the round.
   * A round that yields no usable sample leaves the previous offset in place.
   */
  sync(): Promise<ClockOffset | null> {
    if (this.pending) return this.pending;
    this.pending = this.runRound().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async runRound(): Promise<ClockOffset | null> {
    const collected: ClockSample[] = [];
    for (let i = 0; i < this.samples; i += 1) {
      const sample = await this.probe();
      if (sample) collected.push(sample);
    }
    const best = bestOffset(collected);
    if (best) this.offset = best;
    return this.offset;
  }

  /** Send one probe and wait for its matching pong (or a timeout). */
  private probe(): Promise<ClockSample | null> {
    const id = `c${(this.counter += 1)}`;
    const sentAt = this.now();
    return new Promise<ClockSample | null>((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        resolve(null);
      }, this.pingTimeoutMs);
      this.waiting.set(id, {
        sentAt,
        resolve: (sample) => {
          clearTimeout(timer);
          resolve(sample);
        },
      });
      this.socket.emit('clock:ping', { id });
    });
  }

  /**
   * Pair a pong with its probe.
   *
   * A pong whose id is unknown (a late reply whose timeout already fired, or a
   * duplicate) is ignored, so it can never produce a bogus sample. The received
   * time is read here, when the reply arrives, which is what the round-trip
   * measurement needs; the send time comes from the stored probe, so a late
   * reply cannot borrow a newer probe's start.
   */
  private resolvePong(payload: ClockPongPayload): void {
    const entry = this.waiting.get(payload.id);
    if (!entry) return;
    this.waiting.delete(payload.id);
    entry.resolve({
      sentAt: entry.sentAt,
      receivedAt: this.now(),
      serverTime: payload.serverTime,
    });
  }
}
