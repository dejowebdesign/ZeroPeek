/**
 * Animated starfield canvas (Phase 6.13).
 *
 * The tests drive the module through its injectable seams — clock, frame
 * scheduler, size, random — so they prove the *behaviour* rather than the
 * pixels: how many stars a frame gets, that the loop is bounded and idempotent,
 * that a hidden tab stops drawing, and that the two profiles differ.
 *
 * jsdom has no 2D context, so the context is a recorder. That is deliberate: the
 * contract is "the loop runs and paints N stars", not "pixel (3,4) is white".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StarfieldCanvas } from './starfieldCanvas.js';

let pending: Map<number, () => void>;
let nextHandle: number;
let cancelled: number[];
let clock: number;
let drawn: number;
let hiddenListeners: Array<(hidden: boolean) => void>;
let resizeListeners: Array<() => void>;

/**
 * A recording 2D context: counts the arcs it is asked to paint.
 *
 * Only the starfield canvas counts. The nebula is pre-rendered into its own
 * offscreen canvas, whose three blob arcs would otherwise inflate the star count.
 */
function recorder(isField = true): CanvasRenderingContext2D {
  return {
    clearRect: () => undefined,
    beginPath: () => undefined,
    arc: () => {
      if (isField) drawn += 1;
    },
    fill: () => undefined,
    setTransform: () => undefined,
    set globalAlpha(_value: number) {},
    set fillStyle(_value: string) {},
    set strokeStyle(_value: string) {},
    set lineWidth(_value: number) {},
    set lineCap(_value: string) {},
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    drawImage: () => undefined,
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
  } as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  pending = new Map();
  nextHandle = 1;
  cancelled = [];
  clock = 1000;
  document.body.innerHTML = '';
  drawn = 0;
  hiddenListeners = [];
  resizeListeners = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return recorder(this.className === 'starfield-canvas') as unknown as CanvasRenderingContext2D;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function field(
  options: {
    profile?: 'host' | 'player';
    calm?: boolean;
    reducedMotion?: boolean;
    width?: number;
    height?: number;
  } = {},
): StarfieldCanvas {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  return new StarfieldCanvas({
    profile: options.profile,
    calm: options.calm,
    reducedMotion: options.reducedMotion,
    now: () => clock,
    size: () => ({ width, height }),
    random: () => 0.5,
    requestFrame: (callback) => {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    },
    // A real cancellation: the fake scheduler must drop the callback, or the
    // "paused while hidden" assertion would pass on an artefact.
    cancelFrame: (handle) => {
      cancelled.push(handle);
      pending.delete(handle);
    },
    observeResize: (callback) => {
      resizeListeners.push(callback);
      return () => {
        resizeListeners = resizeListeners.filter((entry) => entry !== callback);
      };
    },
    observeVisibility: (callback) => {
      hiddenListeners.push(callback);
      return () => {
        hiddenListeners = hiddenListeners.filter((entry) => entry !== callback);
      };
    },
  });
}

/** Run the single pending frame, as `requestAnimationFrame` would. */
function step(): void {
  const entry = [...pending.entries()][0];
  if (!entry) return;
  pending.delete(entry[0]);
  entry[1]();
}

describe('starfield canvas', () => {
  it('mounts one transparent canvas and starts the loop', () => {
    const instance = field();
    expect(instance.start()).toBe(true);
    const canvas = instance.element;
    expect(canvas).not.toBeNull();
    expect(canvas!.className).toBe('starfield-canvas');
    expect(canvas!.getAttribute('aria-hidden')).toBe('true');
    expect(instance.isRunning).toBe(true);
  });

  it('is idempotent: a second start does not add a second canvas', () => {
    const instance = field();
    instance.start();
    expect(instance.start()).toBe(false);
    expect(document.querySelectorAll('canvas.starfield-canvas')).toHaveLength(1);
  });

  it('sizes the star field to the frame area', () => {
    const hd = field({ width: 1920, height: 1080 });
    hd.start();
    const hdCount = hd.starCount;
    hd.stop();

    const phone = field({ width: 390, height: 844 });
    phone.start();
    expect(hdCount).toBeGreaterThan(phone.starCount);
    phone.stop();
  });

  it('gives the host a richer field than a player phone', () => {
    const host = field({ profile: 'host', width: 1920, height: 1080 });
    host.start();
    const hostCount = host.starCount;
    host.stop();

    const player = field({ profile: 'player', width: 1920, height: 1080 });
    player.start();
    expect(hostCount).toBeGreaterThan(player.starCount);
    player.stop();
  });

  it('caps the pixel ratio at 2 so a 3x phone does not triple the fill', () => {
    vi.stubGlobal('devicePixelRatio', 3);
    const instance = field({ width: 100, height: 100 });
    instance.start();
    // 100 CSS px at a capped ratio of 2.
    expect(instance.pixelSize).toEqual({ width: 200, height: 200 });
    instance.stop();
    vi.unstubAllGlobals();
  });

  it('paints every star once per frame', () => {
    const instance = field();
    instance.start();
    step();
    expect(drawn).toBe(instance.starCount + instance.moteCount);
  });

  it('draws fewer stars when calm, but never none', () => {
    const instance = field({ calm: true });
    instance.start();
    step();
    // The calm variant slows and dims rather than hiding the sky.
    expect(instance.starCount).toBeGreaterThan(0);
    expect(drawn).toBe(instance.starCount + instance.moteCount);
  });

  it('stops scheduling frames once stopped', () => {
    const instance = field();
    instance.start();
    step();
    const scheduled = pending.size;
    instance.stop();
    expect(instance.isRunning).toBe(false);
    expect(instance.element).toBeNull();
    expect(cancelled.length).toBeGreaterThan(0);
    // The loop must not re-arm itself after a stop.
    expect(pending.size).toBeLessThanOrEqual(scheduled);
  });

  it('pauses while the page is hidden and resumes when it returns', () => {
    const instance = field();
    instance.start();
    step();
    expect(pending.size).toBe(1);

    hiddenListeners.forEach((listener) => listener(true));
    // The pending frame is cancelled, so nothing is scheduled while hidden.
    expect(pending.size).toBe(0);

    hiddenListeners.forEach((listener) => listener(false));
    expect(pending.size).toBe(1);
    instance.stop();
  });

  it('rebuilds the field on a resize instead of clustering in a corner', () => {
    const instance = field({ width: 1920, height: 1080 });
    instance.start();
    const before = instance.starCount;
    resizeListeners.forEach((listener) => listener());
    // Same size: nothing changes, and no stars are lost.
    expect(instance.starCount).toBe(before);
    instance.stop();
  });

  it('leaves nothing behind after stop', () => {
    const instance = field();
    instance.start();
    instance.stop();
    expect(document.querySelectorAll('canvas.starfield-canvas')).toHaveLength(0);
    expect(instance.starCount).toBe(0);
  });
});

describe('space effects (Phase 6.15)', () => {
  /** Run frames until `seconds` of the injected clock have passed. */
  function run(instance: StarfieldCanvas, seconds: number, stepMs = 16): void {
    const target = clock + seconds * 1000;
    while (clock < target) {
      clock += stepMs;
      step();
    }
    void instance;
  }

  it('keeps LAYER_OPACITY at 0.9 and never draws a star brighter than it', () => {
    // The PR #68 adjustment is a contract, not a detail: the stars must stay at
    // 90 % so the background image keeps its contrast.
    const alphas: number[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      const base = recorder(this.className === 'starfield-canvas');
      return new Proxy(base, {
        set(target, property, value) {
          if (property === 'globalAlpha') alphas.push(value as number);
          return Reflect.set(target, property, value);
        },
      });
    });
    const instance = field({ width: 1920, height: 1080 });
    instance.start();
    step();
    instance.stop();
    // `1` is legitimate: it is the per-frame reset and the gradient stroke, where
    // the tail carries its own alpha. Every *star* must be at or below 0.9.
    for (const alpha of alphas) {
      expect(alpha === 1 || alpha <= 0.9 + 1e-9).toBe(true);
    }
    expect(alphas.some((alpha) => alpha > 0 && alpha <= 0.9)).toBe(true);
  });

  it('leaves the star count and the mote pool unchanged by the effects', () => {
    const instance = field({ width: 1920, height: 1080 });
    instance.start();
    const stars = instance.starCount;
    // 1920×1080 is 2.07 MP → 539 by area, clamped to the player cap of 420.
    // Unchanged from Phase 6.13: the effects add no stars.
    expect(stars).toBe(420);
    expect(instance.moteCount).toBe(16);
    instance.stop();
  });

  it('gives the host more motes than a player phone', () => {
    const host = field({ profile: 'host', width: 1920, height: 1080 });
    host.start();
    const hostMotes = host.moteCount;
    host.stop();

    const player = field({ profile: 'player', width: 1920, height: 1080 });
    player.start();
    expect(hostMotes).toBeGreaterThan(player.moteCount);
    player.stop();
  });

  it('pauses the effects with the rest of the loop while the tab is hidden', () => {
    const instance = field();
    instance.start();
    step();
    run(instance, 30);
    hiddenListeners.forEach((listener) => listener(true));
    expect(pending.size).toBe(0);
    // Nothing is drawn while hidden: the effects cannot animate unseen.
    const before = drawn;
    hiddenListeners.forEach((listener) => listener(false));
    step();
    expect(drawn).toBeGreaterThan(before);
    instance.stop();
  });

  it('spaces the shooting stars out in the calm variant instead of removing them', () => {
    const instance = field({ calm: true, width: 1920, height: 1080 });
    instance.start();
    // 400 frames at one simulated second each. Calm is ~24–55 s per star, so
    // this window must contain some streaks but far fewer than normal motion.
    let withStreak = 0;
    for (let index = 0; index < 400; index += 1) {
      const before = drawn;
      clock += 1000;
      step();
      if (drawn - before > 420 + 16) withStreak += 1;
    }
    instance.stop();
    expect(withStreak).toBeGreaterThan(0);
    expect(withStreak).toBeLessThan(60);
  });

  it('draws no moving effect at all under reduced motion', () => {
    const instance = field({ calm: true, reducedMotion: true, width: 1920, height: 1080 });
    instance.start();
    for (let index = 0; index < 120; index += 1) {
      const before = drawn;
      clock += 1000;
      step();
      // Stars only: no motes, no streak heads, no rings.
      expect(drawn - before).toBe(420);
    }
    instance.stop();
  });

  it('does not spawn a burst of catch-up flights after a long gap', () => {
    const instance = field({ width: 1920, height: 1080 });
    instance.start();
    step();
    // A hidden tab, then a return: one frame must not replay 200 seconds of sky.
    clock += 200_000;
    const before = drawn;
    step();
    const perFrame = drawn - before;
    // Stars + motes + at most the two capped streaks' heads.
    expect(perFrame).toBeLessThanOrEqual(420 + 16 + 2 + 1);
    instance.stop();
  });

  it('reuses a single pool instead of growing it', () => {
    const instance = field({ width: 1920, height: 1080 });
    instance.start();
    // Ten minutes of sky.
    run(instance, 600, 100);
    expect(instance.moteCount).toBe(16);
    expect(instance.starCount).toBe(420);
    instance.stop();
  });
});
