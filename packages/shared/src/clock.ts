/**
 * Clock synchronisation maths (Phase 6.8.5).
 *
 * The countdown is rendered from the server's `openedAt`, but a client can only
 * compare that to its own clock. Client clocks drift (a phone set a few minutes
 * fast, a laptop resuming from sleep), so the raw comparison shows a different
 * number on every device. The client therefore measures the offset between the
 * server's wall clock and its own monotonic clock with a short ping/pong round
 * and renders the countdown against the corrected time.
 *
 * Everything here is pure and runtime-agnostic: no `node:` imports, no DOM, no
 * timers. The caller owns the transport and the clock readings, which keeps the
 * estimate testable with synthetic latencies.
 *
 * The model, from RFC 5905 (NTP) with the offset inverted for our direction:
 *
 *   t1  the client's monotonic reading when it sent the probe
 *   t2  the server's wall clock when it replied (the pong's `serverTime`)
 *   t3  the client's monotonic reading when the reply arrived
 *
 *   roundTrip = t3 − t1                (assumed symmetric in both directions)
 *   offset    = t2 − (t1 + t3) / 2     (server clock − client clock at t3)
 *
 * `serverNow(clientNow) = clientNow + offset` then maps any later local reading
 * onto the server's clock. The server stays authoritative: a corrected reading
 * only changes what the countdown *shows*, never whether an answer was in time.
 */

/** One completed ping/pong measurement, in the client's own clock units. */
export interface ClockSample {
  /** The client's monotonic reading when the probe was sent. */
  sentAt: number;
  /** The client's monotonic reading when the reply arrived. */
  receivedAt: number;
  /** The server's wall clock from the reply, in ms since the Unix epoch. */
  serverTime: number;
}

/** The agreed correction, or `null` while the client has no usable sample. */
export interface ClockOffset {
  /** `serverClock − clientClock` in ms; add it to a local reading to get server time. */
  offsetMs: number;
  /** The round-trip of the sample this offset was taken from, in ms. */
  roundTripMs: number;
}

/**
 * How many samples the offset is chosen from. A short burst smooths out a single
 * unlucky packet without making the client wait for a long measurement.
 */
export const CLOCK_SAMPLE_COUNT = 5;

/**
 * The longest round-trip that still counts as a usable sample. A reply that took
 * longer than this carries too much one-way uncertainty for a countdown that
 * ticks once a second, so it is ignored rather than skewing the estimate.
 */
export const CLOCK_MAX_ROUND_TRIP_MS = 2000;

/**
 * The offset of one sample, or `null` when the sample is unusable.
 *
 * A sample is rejected when its round-trip is negative (a reading taken out of
 * order), implausibly large (see `CLOCK_MAX_ROUND_TRIP_MS`) or not finite, and
 * when the server time is not a finite number. Rejecting rather than clamping
 * keeps one bad reply from dragging the estimate.
 */
export function offsetOfSample(sample: ClockSample): ClockOffset | null {
  const { sentAt, receivedAt, serverTime } = sample;
  if (!Number.isFinite(sentAt) || !Number.isFinite(receivedAt) || !Number.isFinite(serverTime)) {
    return null;
  }
  const roundTripMs = receivedAt - sentAt;
  if (roundTripMs < 0 || roundTripMs > CLOCK_MAX_ROUND_TRIP_MS) return null;
  const midPoint = sentAt + roundTripMs / 2;
  return { offsetMs: serverTime - midPoint, roundTripMs };
}

/**
 * The best offset from a set of samples: the one with the smallest round-trip,
 * which is the sample with the tightest bound on its error (RFC 5905). Ties are
 * broken by the later sample, so a fresh measurement wins over an older one with
 * the same round-trip. Unusable samples are dropped, and an empty (or entirely
 * unusable) set yields `null`, which the caller reads as "no correction yet"
 * rather than as a zero offset.
 */
export function bestOffset(samples: readonly ClockSample[]): ClockOffset | null {
  let best: ClockOffset | null = null;
  for (const sample of samples) {
    const candidate = offsetOfSample(sample);
    if (!candidate) continue;
    // `<=` keeps the later of two equal-round-trip samples, so the newest wins.
    if (!best || candidate.roundTripMs <= best.roundTripMs) best = candidate;
  }
  return best;
}
