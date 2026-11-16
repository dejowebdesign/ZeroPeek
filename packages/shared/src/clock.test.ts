import { describe, expect, it } from 'vitest';

import {
  CLOCK_MAX_ROUND_TRIP_MS,
  CLOCK_SAMPLE_COUNT,
  bestOffset,
  offsetOfSample,
  type ClockSample,
} from './clock.js';

/** A sample with an explicit round-trip and a server clock behind/ahead by `skew`. */
function sample(options: {
  sentAt: number;
  roundTripMs: number;
  /** The true difference `serverClock − clientClock` this sample should reveal. */
  skewMs: number;
}): ClockSample {
  const { sentAt, roundTripMs, skewMs } = options;
  const receivedAt = sentAt + roundTripMs;
  // The server answers at the midpoint of the round in the ideal case, so the
  // server's reading there is the client's midpoint plus the true skew.
  const serverTime = sentAt + roundTripMs / 2 + skewMs;
  return { sentAt, receivedAt, serverTime };
}

describe('offsetOfSample', () => {
  it('recovers the exact skew from a symmetric round-trip', () => {
    const result = offsetOfSample(sample({ sentAt: 1000, roundTripMs: 80, skewMs: 5000 }));
    expect(result).not.toBeNull();
    expect(result!.offsetMs).toBeCloseTo(5000, 6);
    expect(result!.roundTripMs).toBe(80);
  });

  it('reports a negative offset when the client clock runs ahead', () => {
    const result = offsetOfSample(sample({ sentAt: 0, roundTripMs: 100, skewMs: -2500 }));
    expect(result!.offsetMs).toBeCloseTo(-2500, 6);
  });

  it('is unaffected by the absolute magnitude of the client clock', () => {
    const small = offsetOfSample(sample({ sentAt: 10, roundTripMs: 60, skewMs: 1234 }));
    const large = offsetOfSample(
      sample({ sentAt: 1_700_000_000_000, roundTripMs: 60, skewMs: 1234 }),
    );
    expect(small!.offsetMs).toBeCloseTo(large!.offsetMs, 6);
  });

  it('rejects a round-trip longer than the usable maximum', () => {
    expect(
      offsetOfSample(sample({ sentAt: 0, roundTripMs: CLOCK_MAX_ROUND_TRIP_MS + 1, skewMs: 0 })),
    ).toBeNull();
  });

  it('accepts a round-trip exactly at the maximum', () => {
    expect(
      offsetOfSample(sample({ sentAt: 0, roundTripMs: CLOCK_MAX_ROUND_TRIP_MS, skewMs: 0 })),
    ).not.toBeNull();
  });

  it('rejects a negative round-trip (readings out of order)', () => {
    expect(offsetOfSample({ sentAt: 500, receivedAt: 400, serverTime: 1000 })).toBeNull();
  });

  it('rejects non-finite inputs', () => {
    expect(offsetOfSample({ sentAt: 0, receivedAt: 10, serverTime: Number.NaN })).toBeNull();
    expect(
      offsetOfSample({ sentAt: Number.POSITIVE_INFINITY, receivedAt: 10, serverTime: 1 }),
    ).toBeNull();
    expect(offsetOfSample({ sentAt: 0, receivedAt: Number.NaN, serverTime: 1 })).toBeNull();
  });
});

describe('bestOffset', () => {
  it('returns null with no samples, so the caller knows there is no correction yet', () => {
    expect(bestOffset([])).toBeNull();
  });

  it('returns null when every sample is unusable', () => {
    const samples = [
      sample({ sentAt: 0, roundTripMs: CLOCK_MAX_ROUND_TRIP_MS + 100, skewMs: 0 }),
      sample({ sentAt: 0, roundTripMs: CLOCK_MAX_ROUND_TRIP_MS + 200, skewMs: 0 }),
    ];
    expect(bestOffset(samples)).toBeNull();
  });

  it('chooses the sample with the smallest round-trip', () => {
    const samples = [
      sample({ sentAt: 0, roundTripMs: 300, skewMs: 5000 }),
      sample({ sentAt: 0, roundTripMs: 40, skewMs: 5000 }),
      sample({ sentAt: 0, roundTripMs: 180, skewMs: 5000 }),
    ];
    const best = bestOffset(samples);
    expect(best!.roundTripMs).toBe(40);
    expect(best!.offsetMs).toBeCloseTo(5000, 6);
  });

  it('ignores an outlier slow sample that carries a skewed estimate', () => {
    // A slow reply carries a wrong offset (its midpoint is far off); the best
    // pick must not let it drag the estimate.
    const good = sample({ sentAt: 0, roundTripMs: 50, skewMs: 1000 });
    const slow: ClockSample = {
      sentAt: 0,
      receivedAt: 900,
      // Deliberately wrong: as if the server had answered long after the midpoint.
      serverTime: 5000,
    };
    const best = bestOffset([good, slow]);
    expect(best!.roundTripMs).toBe(50);
    expect(best!.offsetMs).toBeCloseTo(1000, 6);
  });

  it('breaks a tie in round-trip in favour of the later sample', () => {
    const older = sample({ sentAt: 0, roundTripMs: 60, skewMs: 1000 });
    const newer = sample({ sentAt: 10_000, roundTripMs: 60, skewMs: 1200 });
    const best = bestOffset([older, newer]);
    expect(best!.offsetMs).toBeCloseTo(1200, 6);
  });

  it('is stable across a realistic burst of samples', () => {
    const samples = Array.from({ length: CLOCK_SAMPLE_COUNT }, (_, index) =>
      sample({ sentAt: index * 250, roundTripMs: 40 + index * 5, skewMs: 750 }),
    );
    const best = bestOffset(samples);
    expect(best!.offsetMs).toBeCloseTo(750, 6);
    expect(best!.roundTripMs).toBe(40);
  });

  it('keeps a single delayed reply from corrupting a later run', () => {
    // A client measures a burst, one reply is late (and unusable), the rest are
    // fine: the offset must still come from a good sample.
    const burst = [
      sample({ sentAt: 0, roundTripMs: 45, skewMs: -300 }),
      { sentAt: 100, receivedAt: 4000, serverTime: 0 } as ClockSample,
      sample({ sentAt: 200, roundTripMs: 50, skewMs: -300 }),
    ];
    const best = bestOffset(burst);
    expect(best!.offsetMs).toBeCloseTo(-300, 6);
  });
});
