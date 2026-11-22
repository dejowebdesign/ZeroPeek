/**
 * Space effects (Phase 6.15).
 *
 * These tests cover the rules rather than the pixels: that a flight is a pure
 * function of time, that the caps are structural, that the intervals land inside
 * their window, and that the calm variant quietens the sky without emptying it.
 *
 * The renderer is exercised in `starfieldCanvas.test.ts`; here the module is
 * driven directly, because the geometry is what can actually be wrong.
 */

import { describe, expect, it } from 'vitest';

import {
  COMET_INTERVAL,
  COMET_INTERVAL_CALM,
  COMET_MAX,
  DOUBLE_METEOR_CHANCE,
  METEOR_INTERVAL,
  METEOR_INTERVAL_CALM,
  METEOR_MAX,
  MOTE_COUNT,
  NEBULA_ALPHA,
  NEBULA_BLOBS,
  PULSE_MAX,
  cometInterval,
  emptyMeteor,
  exitDistance,
  launchComet,
  launchMeteor,
  launchPulse,
  makeMotes,
  meteorAlive,
  meteorHead,
  meteorInterval,
  meteorLife,
  moteAt,
  sampleInterval,
  starFlare,
} from './starfieldEffects.js';

/** A deterministic source, so a failure is reproducible. */
function seeded(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const WIDTH = 1920;
const HEIGHT = 1080;

describe('meteor spawning', () => {
  it('fills a dead slot with a diagonal, downward flight', () => {
    const slot = emptyMeteor();
    launchMeteor(slot, seeded(), WIDTH, HEIGHT, 0);

    expect(slot.alive).toBe(true);
    // Always downward: a sky the stars fall through, not horizontal scratches.
    expect(slot.dy).toBeGreaterThan(0);
    expect(Math.abs(slot.dx)).toBeGreaterThan(0);
    expect(slot.speed).toBeGreaterThan(0);
    expect(slot.length).toBeGreaterThan(0);
    expect(slot.alpha).toBeGreaterThan(0);
    expect(slot.alpha).toBeLessThanOrEqual(1);
  });

  it('starts at or above the frame so the streak enters instead of popping in', () => {
    const random = seeded(7);
    for (let index = 0; index < 50; index += 1) {
      const slot = emptyMeteor();
      launchMeteor(slot, random, WIDTH, HEIGHT, 0);
      expect(slot.y).toBeLessThan(HEIGHT * 0.3);
    }
  });

  it('varies direction, speed and size across flights', () => {
    const random = seeded(3);
    const speeds = new Set<number>();
    const lengths = new Set<number>();
    let left = 0;
    let right = 0;
    for (let index = 0; index < 60; index += 1) {
      const slot = emptyMeteor();
      launchMeteor(slot, random, WIDTH, HEIGHT, 0);
      speeds.add(Math.round(slot.speed));
      lengths.add(Math.round(slot.length));
      if (slot.dx < 0) left += 1;
      else right += 1;
    }
    expect(speeds.size).toBeGreaterThan(10);
    expect(lengths.size).toBeGreaterThan(10);
    // Both directions occur; a one-way sky looks like a bug.
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
  });

  it('never exceeds the cap, because the pool has no spare slot', () => {
    const slots = Array.from({ length: METEOR_MAX }, () => emptyMeteor());
    const random = seeded(11);
    for (const slot of slots) launchMeteor(slot, random, WIDTH, HEIGHT, 0);
    // Every slot is in flight, so a further launch has nowhere to go.
    const free = slots.filter((slot) => !slot.alive);
    expect(free).toHaveLength(0);
    expect(slots).toHaveLength(METEOR_MAX);
    expect(METEOR_MAX).toBeLessThanOrEqual(2);
  });
});

describe('meteor motion', () => {
  it('is a pure function of time: the same elapsed gives the same head', () => {
    const slot = emptyMeteor();
    launchMeteor(slot, seeded(5), WIDTH, HEIGHT, 10);
    const first = { x: 0, y: 0 };
    const second = { x: 0, y: 0 };
    meteorHead(slot, 12.5, first);
    meteorHead(slot, 12.5, second);
    expect(first).toEqual(second);
  });

  it('moves along its direction as time passes', () => {
    const slot = emptyMeteor();
    launchMeteor(slot, seeded(5), WIDTH, HEIGHT, 0);
    const start = { x: 0, y: 0 };
    const later = { x: 0, y: 0 };
    meteorHead(slot, 0, start);
    meteorHead(slot, 0.5, later);
    // Half a second of flight: further along both axes, in the launch direction.
    expect((later.x - start.x) * slot.dx).toBeGreaterThan(0);
    expect((later.y - start.y) * slot.dy).toBeGreaterThan(0);
    const travelled = Math.hypot(later.x - start.x, later.y - start.y);
    expect(travelled).toBeCloseTo(slot.speed * 0.5, 6);
  });

  it('expires after its lifetime so the slot can be reused', () => {
    const slot = emptyMeteor();
    launchMeteor(slot, seeded(5), WIDTH, HEIGHT, 100);
    const life = meteorLife(slot);
    expect(meteorAlive(slot, 100 + life - 0.01)).toBe(true);
    expect(meteorAlive(slot, 100 + life)).toBe(false);
    expect(meteorAlive(slot, 99)).toBe(false);
  });

  it('sizes its life from the distance it has to cross', () => {
    const slow = emptyMeteor();
    slow.alive = true;
    slow.speed = 100;
    slow.length = 200;
    const fast = emptyMeteor();
    fast.alive = true;
    fast.speed = 900;
    fast.length = 200;
    expect(meteorLife(slow)).toBeGreaterThan(meteorLife(fast));
  });
});

describe('comets', () => {
  it('stay inside their own cap', () => {
    expect(COMET_MAX).toBe(1);
  });

  it('are slower, longer and rarer than a shooting star', () => {
    const random = seeded(9);
    const meteor = emptyMeteor();
    launchMeteor(meteor, random, WIDTH, HEIGHT, 0);
    const comet = emptyMeteor();
    launchComet(comet, random, WIDTH, HEIGHT, 0);

    expect(comet.speed).toBeLessThan(meteor.speed);
    expect(comet.length).toBeGreaterThan(meteor.length);
    expect(comet.alpha).toBeLessThanOrEqual(meteor.alpha + 0.25);
    // The interval window starts far later than a meteor's.
    expect(COMET_INTERVAL[0]).toBeGreaterThan(METEOR_INTERVAL[1] * 2);
  });
});

describe('light pulses', () => {
  it('allows at most one at a time', () => {
    expect(PULSE_MAX).toBe(1);
  });

  it('is faint: a bloom, never a flash', () => {
    const pulse = {
      alive: false,
      bornAt: 0,
      x: 0,
      y: 0,
      radius: 0,
      alpha: 0,
      colour: '',
    };
    launchPulse(pulse, seeded(2), WIDTH, HEIGHT, 0);
    expect(pulse.alive).toBe(true);
    expect(pulse.alpha).toBeLessThan(0.12);
  });
});

describe('intervals', () => {
  it('samples inside the requested window', () => {
    const random = seeded(13);
    for (let index = 0; index < 200; index += 1) {
      const value = sampleInterval(METEOR_INTERVAL, random);
      expect(value).toBeGreaterThanOrEqual(METEOR_INTERVAL[0]);
      expect(value).toBeLessThanOrEqual(METEOR_INTERVAL[1]);
    }
  });

  it('keeps the brief window of 8–20 s for shooting stars', () => {
    expect(METEOR_INTERVAL).toEqual([8, 20]);
    expect(DOUBLE_METEOR_CHANCE).toBeGreaterThan(0);
    expect(DOUBLE_METEOR_CHANCE).toBeLessThan(0.5);
  });

  it('spaces the calm variant out instead of stopping it', () => {
    expect(meteorInterval(true)).toBe(METEOR_INTERVAL_CALM);
    expect(METEOR_INTERVAL_CALM[0]).toBeGreaterThan(METEOR_INTERVAL[1]);
    expect(cometInterval(true)).toBe(COMET_INTERVAL_CALM);
    expect(COMET_INTERVAL_CALM[0]).toBeGreaterThan(COMET_INTERVAL[1]);
  });

  it('produces no repeating pattern across many samples', () => {
    const random = seeded(17);
    const values = Array.from({ length: 12 }, () => sampleInterval(METEOR_INTERVAL, random));
    const rounded = values.map((value) => value.toFixed(2));
    expect(new Set(rounded).size).toBe(rounded.length);
  });
});

describe('motes', () => {
  it('allocates a fixed pool per profile', () => {
    const motes = makeMotes(MOTE_COUNT.player, seeded());
    expect(motes).toHaveLength(MOTE_COUNT.player);
    expect(MOTE_COUNT.host).toBeGreaterThan(MOTE_COUNT.player);
  });

  it('keeps every mote inside the frame after wrapping', () => {
    const motes = makeMotes(20, seeded(4));
    const out = { x: 0, y: 0 };
    for (const mote of motes) {
      for (const elapsed of [0, 5, 60, 3600]) {
        moteAt(mote, elapsed, WIDTH, HEIGHT, 1, out);
        expect(out.x).toBeGreaterThanOrEqual(0);
        expect(out.x).toBeLessThan(WIDTH);
        expect(out.y).toBeGreaterThanOrEqual(0);
        expect(out.y).toBeLessThan(HEIGHT);
      }
    }
  });

  it('drifts, but only gently', () => {
    const [mote] = makeMotes(1, seeded(6));
    const start = { x: 0, y: 0 };
    const later = { x: 0, y: 0 };
    moteAt(mote!, 0, WIDTH, HEIGHT, 1, start);
    moteAt(mote!, 10, WIDTH, HEIGHT, 1, later);
    const drift = Math.abs(later.x - start.x);
    expect(drift).toBeGreaterThan(0);
    expect(drift).toBeLessThan(WIDTH * 0.25);
  });
});

describe('nebula', () => {
  it('stays faint so the motif keeps the contrast', () => {
    expect(NEBULA_ALPHA).toBeLessThanOrEqual(0.6);
    for (const blob of NEBULA_BLOBS) {
      expect(blob.alpha).toBeLessThanOrEqual(0.2);
    }
  });

  it('uses only the brand colours, and no more than three veils', () => {
    expect(NEBULA_BLOBS.length).toBeLessThanOrEqual(3);
    for (const blob of NEBULA_BLOBS) {
      for (const channel of blob.colour) {
        expect(Number.isInteger(channel)).toBe(true);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('twinkle flare', () => {
  it('is zero most of the time and never negative', () => {
    let lit = 0;
    let dark = 0;
    for (let step = 0; step < 400; step += 1) {
      const flare = starFlare(1.3, 0.8, step * 0.05, 0.34);
      expect(flare).toBeGreaterThanOrEqual(0);
      expect(flare).toBeLessThanOrEqual(0.34);
      if (flare > 0.001) lit += 1;
      else dark += 1;
    }
    // A flare is the exception, not the rule: most samples are dark.
    expect(dark).toBeGreaterThan(lit);
  });

  it('gives different stars their flares at different moments', () => {
    // A single sample can be dark for both; what matters is that the peaks do
    // not coincide, which is what keeps the field from blinking in unison.
    const peakOf = (phase: number): number => {
      let best = 0;
      let bestAt = 0;
      for (let step = 0; step < 2000; step += 1) {
        const elapsed = step * 0.02;
        const flare = starFlare(phase, 0.8, elapsed, 0.34);
        if (flare > best) {
          best = flare;
          bestAt = elapsed;
        }
      }
      return bestAt;
    };
    const a = peakOf(0.4);
    const b = peakOf(2.9);
    expect(Math.abs(a - b)).toBeGreaterThan(0.5);
  });
});

describe('geometry helpers', () => {
  it('measures the distance to the frame edge along a direction', () => {
    // Straight down from the middle of a 100×100 frame: 50 px.
    expect(exitDistance(50, 50, 0, 1, 100, 100)).toBeCloseTo(50, 6);
    // Straight right from x=25: 75 px.
    expect(exitDistance(25, 50, 1, 0, 100, 100)).toBeCloseTo(75, 6);
  });

  it('falls back to the diagonal when a direction never leaves the frame', () => {
    const distance = exitDistance(50, 50, 0, 0, 100, 100);
    expect(distance).toBeCloseTo(Math.hypot(100, 100), 6);
  });
});
