/**
 * Finale show effects (Phase 6.11.2).
 *
 * The timeline is tested through the clock, not through real frames: a fake
 * clock and a manual scheduler let the test place the playhead at 0 ms, 1499 ms,
 * 1500 ms and beyond, which is the only way to prove "exactly 1.5 s".
 *
 * jsdom has no canvas and no media pipeline, so both are stubbed: the canvas
 * keeps the real element (so the DOM assertions are meaningful) and only its 2D
 * context is a recorder, and the audio elements record `play`/`pause`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CROWD_MS,
  EXPLOSION_MS,
  FINALE_END_MS,
  FinaleEffects,
  ROCKET_MS,
  crowdDue,
  explosionDue,
  pixelRatio,
  stageAt,
} from './finaleEffects.js';

interface FakeAudio {
  src: string;
  play: number;
  pause: number;
  currentTime: number;
  volume: number;
  preload: string;
}

let audios: FakeAudio[];
let frames: Array<() => void>;
let clock: number;
let cancelled: number[];

beforeEach(() => {
  audios = [];
  frames = [];
  cancelled = [];
  clock = 1000;
  document.body.innerHTML = '';
  // jsdom throws "not implemented" for a 2D context; a recorder is enough,
  // because the test asserts the timeline, not the pixels.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: () => undefined,
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    fillRect: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    createRadialGradient: () => ({ addColorStop: () => undefined }) as unknown as CanvasGradient,
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    scale: () => undefined,
    set globalAlpha(_value: number) {},
    set fillStyle(_value: string) {},
    set strokeStyle(_value: string) {},
    set lineWidth(_value: number) {},
    set lineCap(_value: string) {},
    set globalCompositeOperation(_value: string) {},
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeAudio(src: string): HTMLAudioElement {
  const record: FakeAudio = { src, play: 0, pause: 0, currentTime: 0, volume: 1, preload: '' };
  audios.push(record);
  return {
    get src() {
      return record.src;
    },
    set src(value: string) {
      record.src = value;
    },
    get currentTime() {
      return record.currentTime;
    },
    set currentTime(value: number) {
      record.currentTime = value;
    },
    get volume() {
      return record.volume;
    },
    set volume(value: number) {
      record.volume = value;
    },
    get preload() {
      return record.preload;
    },
    set preload(value: string) {
      record.preload = value;
    },
    play: () => {
      record.play += 1;
      return Promise.resolve();
    },
    pause: () => {
      record.pause += 1;
    },
    removeAttribute: () => undefined,
    load: () => undefined,
  } as unknown as HTMLAudioElement;
}

function effects(overrides: { reducedMotion?: boolean } = {}): FinaleEffects {
  return new FinaleEffects({
    now: () => clock,
    audio: makeAudio,
    requestFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelFrame: (handle) => {
      cancelled.push(handle);
    },
    random: () => 0.5,
    ...overrides,
  });
}

/** Advance the fake clock and run one frame. */
function advance(instance: FinaleEffects, toMs: number): void {
  clock = 1000 + toMs;
  const next = frames.shift();
  if (next) next();
  else instance.tick();
}

describe('finale timeline', () => {
  it('names the four stages at their documented times', () => {
    expect(ROCKET_MS).toBe(0);
    expect(EXPLOSION_MS).toBe(1500);
    expect(CROWD_MS).toBe(2100);
    expect(stageAt(0)).toBe('rocket');
    expect(stageAt(1499)).toBe('rocket');
    expect(stageAt(1500)).toBe('explosion');
    expect(stageAt(2099)).toBe('explosion');
    expect(stageAt(2100)).toBe('celebration');
    expect(stageAt(FINALE_END_MS - 100)).toBe('fade');
    expect(stageAt(FINALE_END_MS)).toBe('done');
  });

  it('only fires the explosion from exactly 1.5 s', () => {
    expect(explosionDue(0)).toBe(false);
    expect(explosionDue(1499)).toBe(false);
    expect(explosionDue(1500)).toBe(true);
  });

  it('starts the applause only after the explosion', () => {
    expect(crowdDue(0)).toBe(false);
    expect(crowdDue(EXPLOSION_MS)).toBe(false);
    expect(crowdDue(CROWD_MS - 1)).toBe(false);
    expect(crowdDue(CROWD_MS)).toBe(true);
    expect(CROWD_MS).toBeGreaterThan(EXPLOSION_MS);
  });
});

describe('pixel ratio', () => {
  it('caps the ratio so a 4× display does not quadruple the pixel count', () => {
    expect(pixelRatio(1)).toBe(1);
    expect(pixelRatio(2)).toBe(2);
    expect(pixelRatio(3)).toBe(2);
    expect(pixelRatio(undefined)).toBe(1);
    expect(pixelRatio(Number.NaN)).toBe(1);
  });
});

describe('finale on the host surface', () => {
  it('mounts the canvas and plays the fireworks the moment it starts', () => {
    const instance = effects();
    expect(instance.start('game-1')).toBe(true);
    expect(document.querySelectorAll('canvas.finale')).toHaveLength(1);
    // The rocket audio is the first element and it is playing at t = 0.
    expect(audios).toHaveLength(1);
    expect(audios[0]!.src).toBe('/audio/sfx/finale-fireworks.ogg');
    expect(audios[0]!.play).toBe(1);
  });

  it('does not start the applause before 1.5 s has passed', () => {
    const instance = effects();
    instance.start('game-1');
    advance(instance, 1400);
    // Only the fireworks element exists so far.
    expect(audios).toHaveLength(1);
    expect(instance.hasApplause).toBe(false);
  });

  it('fires the explosion at 1.5 s and the applause after it', () => {
    const instance = effects();
    instance.start('game-1');
    advance(instance, 1499);
    expect(instance.hasApplause).toBe(false);

    advance(instance, 1500);
    // The explosion is visual only; the crowd is still pending.
    expect(instance.hasApplause).toBe(false);

    advance(instance, CROWD_MS);
    expect(instance.hasApplause).toBe(true);
    expect(audios).toHaveLength(2);
    const crowd = audios.find((audio) => audio.src === '/audio/sfx/finale-crowd.ogg');
    expect(crowd?.play).toBe(1);
  });

  it('plays the fireworks before the crowd', () => {
    const instance = effects();
    instance.start('game-1');
    advance(instance, CROWD_MS);
    expect(audios[0]!.src).toBe('/audio/sfx/finale-fireworks.ogg');
    expect(audios[1]!.src).toBe('/audio/sfx/finale-crowd.ogg');
  });

  it('triggers only once per game, so a repaint adds nothing', () => {
    const instance = effects();
    expect(instance.start('game-1')).toBe(true);
    advance(instance, 300);

    // A repaint of the same game: the podium is drawn again, same game id.
    expect(instance.start('game-1')).toBe(false);
    expect(document.querySelectorAll('canvas.finale')).toHaveLength(1);
    expect(audios[0]!.play).toBe(1);
  });

  it('does not replay after the sequence has finished (reconnect case)', () => {
    const instance = effects();
    instance.start('game-1');
    advance(instance, FINALE_END_MS + 500);
    // The sequence stopped itself and dropped the canvas.
    expect(instance.isRunning).toBe(false);
    expect(document.querySelectorAll('canvas.finale')).toHaveLength(0);

    // A reconnect re-sends the same game: still no second run.
    expect(instance.start('game-1')).toBe(false);
    expect(document.querySelectorAll('canvas.finale')).toHaveLength(0);
    expect(audios[0]!.play).toBe(1);
  });

  it('starts a new sequence for a different game', () => {
    const instance = effects();
    instance.start('game-1');
    advance(instance, 300);
    expect(instance.start('game-2')).toBe(true);
    expect(instance.currentKey).toBe('game-2');
  });

  it('stops the sounds and removes the canvas when the show is left', () => {
    const instance = effects();
    instance.start('game-1');
    advance(instance, CROWD_MS);
    expect(document.querySelectorAll('canvas.finale')).toHaveLength(1);

    instance.stop();
    expect(document.querySelectorAll('canvas.finale')).toHaveLength(0);
    expect(instance.isRunning).toBe(false);
    for (const audio of audios) expect(audio.pause).toBeGreaterThanOrEqual(1);
    expect(cancelled.length).toBeGreaterThanOrEqual(1);
  });

  it('leaves no canvas behind when the sequence runs to its end', () => {
    const instance = effects();
    instance.start('game-1');
    for (let ms = 0; ms <= FINALE_END_MS + 2000; ms += 100) advance(instance, ms);
    expect(document.querySelectorAll('canvas.finale')).toHaveLength(0);
    expect(instance.isRunning).toBe(false);
  });

  it('stops and rewinds both effect sounds at the end of the sequence', () => {
    const instance = effects();
    instance.start('game-1');
    advance(instance, CROWD_MS);
    // Both sounds are live by now, one play each.
    expect(audios.map((audio) => audio.src)).toEqual([
      '/audio/sfx/finale-fireworks.ogg',
      '/audio/sfx/finale-crowd.ogg',
    ]);
    for (const audio of audios) expect(audio.play).toBe(1);

    advance(instance, FINALE_END_MS);
    // Each element is paused and rewound exactly once, so a later run starts
    // from the top rather than resuming mid-sound.
    for (const audio of audios) {
      expect(audio.pause).toBe(1);
      expect(audio.currentTime).toBe(0);
    }
  });

  it('plays each effect sound exactly once, never in parallel duplicates', () => {
    const instance = effects();
    instance.start('game-1');
    // Walk the whole sequence in small steps, past every confetti cue.
    for (let ms = 0; ms <= FINALE_END_MS + 500; ms += 50) advance(instance, ms);
    // Two elements in total, each played once: the fireworks and the crowd.
    expect(audios).toHaveLength(2);
    for (const audio of audios) expect(audio.play).toBe(1);
  });

  it('keeps the two effects on separate elements so one can start while the other plays', () => {
    const instance = effects();
    instance.start('game-1');
    advance(instance, CROWD_MS);
    const [fireworks, crowd] = audios;
    expect(fireworks).not.toBe(crowd);
    expect(fireworks!.src).toBe('/audio/sfx/finale-fireworks.ogg');
    expect(crowd!.src).toBe('/audio/sfx/finale-crowd.ogg');
    // The fireworks are still playing when the crowd starts: the rocket sound is
    // not cut off, the two overlap only where the direction allows it.
    expect(fireworks!.pause).toBe(0);
  });

  it('keeps the particle count bounded', () => {
    const instance = effects();
    instance.start('game-1');
    for (let ms = 0; ms <= 5000; ms += 16) advance(instance, ms);
    // The cap is an implementation detail, but it must exist: a runaway count
    // is what turns a projector into a slideshow. Phase 6.11.3 raised it from
    // 900 to 1600 for the large/medium/small volleys; the ceiling is the frame
    // budget (measured ~0.6 ms per tick at the previous size), not a style choice.
    const particles = (instance as unknown as { particles: unknown[] }).particles;
    expect(particles.length).toBeLessThanOrEqual(1600);
    // It must still be a real ceiling, not "whatever the display happened to
    // spawn": a full volley has to be large enough to cover the stage.
    expect(particles.length).toBeGreaterThan(200);
  });

  it('caps the luminous shells separately from the sparks', () => {
    const instance = effects();
    instance.start('game-1');
    for (let ms = 0; ms <= 6000; ms += 16) advance(instance, ms);
    const clouds = (instance as unknown as { clouds: unknown[] }).clouds;
    // Clouds are the expensive draw, so they never grow with the spark count.
    expect(clouds.length).toBeLessThanOrEqual(28);
  });

  it('fires the whole main volley at 1.5 s, not one burst', () => {
    const instance = effects();
    instance.start('game-1');
    const spawned = () => (instance as unknown as { particles: unknown[] }).particles.length;

    advance(instance, EXPLOSION_MS - 1);
    const beforeBurst = spawned();

    advance(instance, EXPLOSION_MS);
    // The volley is several bursts, so the jump in particle count is an order of
    // magnitude larger than one burst would be.
    expect(spawned() - beforeBurst).toBeGreaterThan(300);
  });

  it('spreads the bursts across the frame instead of stacking them in the middle', () => {
    const instance = effects();
    instance.start('game-1');
    advance(instance, EXPLOSION_MS);

    const sparks = (
      instance as unknown as { particles: { x: number; y: number; kind: string }[] }
    ).particles.filter((particle) => particle.kind === 'spark');
    expect(sparks.length).toBeGreaterThan(0);

    // jsdom has no layout, so the canvas reports 0 and `width()`/`height()` fall
    // back to the 1024×768 window. The volley must therefore already occupy both
    // halves of the frame and the upper area at the moment it fires.
    const width = window.innerWidth;
    const left = sparks.filter((particle) => particle.x < width * 0.4).length;
    const right = sparks.filter((particle) => particle.x > width * 0.6).length;
    const upper = sparks.filter((particle) => particle.y < window.innerHeight * 0.45).length;

    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(upper).toBeGreaterThan(0);
  });

  it('never lights the podium text above a readable level', () => {
    const instance = effects();
    instance.start('game-1');
    for (let ms = 0; ms <= 6000; ms += 16) advance(instance, ms);

    const clouds = (
      instance as unknown as {
        clouds: { x: number; y: number; radius: number; strength: number; flash: boolean }[];
      }
    ).clouds;
    expect(clouds.length).toBeGreaterThan(0);

    // The readability contract is about *light on the text*, not geometry: a
    // huge, very faint halo may pass behind the board (that is the ambient glow
    // that makes the show feel big) as long as the summed alpha over the text
    // stays low. Each cloud contributes its gradient value at the distance of
    // the text, and those contributions add up under `lighter`.
    const width = window.innerWidth;
    const height = window.innerHeight;
    const textPoints: Array<[number, number]> = [
      [width / 2, height / 2 - 60], // title
      [width / 2, height / 2], // winner name
      [width / 2, height / 2 + 60], // placements
    ];

    for (const cloud of clouds) {
      for (const [px, py] of textPoints) {
        const distance = Math.hypot(px - cloud.x, py - cloud.y);
        // Outside the shell: no light at all.
        if (distance >= cloud.radius) continue;
        // Gradient stops: 1.0 at the centre, 0.38 at 45 %, 0 at the rim.
        const t = distance / cloud.radius;
        const falloff = t <= 0.45 ? 1 - (t / 0.45) * 0.62 : 0.38 * (1 - (t - 0.45) / 0.55);
        const alpha = cloud.strength * Math.max(0, falloff);
        // A single cloud must never put more than 18 % light on a text pixel.
        // That is the threshold where white type on the dark glass still reads
        // at projector distance; the browser contrast check confirms it.
        expect(alpha).toBeLessThan(0.18);
      }
    }
  });
});

describe('reduced motion', () => {
  it('marks the win with sound but never creates a canvas', () => {
    const instance = effects({ reducedMotion: true });
    expect(instance.start('game-1')).toBe(true);
    expect(document.querySelectorAll('canvas.finale')).toHaveLength(0);
    // The fireworks still play: the moment is marked audibly.
    expect(audios[0]!.play).toBe(1);
  });

  it('still queues the applause on its own cue', () => {
    vi.useFakeTimers();
    try {
      const instance = effects({ reducedMotion: true });
      instance.start('game-1');
      expect(audios).toHaveLength(1);
      vi.advanceTimersByTime(CROWD_MS);
      expect(audios).toHaveLength(2);
      expect(audios[1]!.src).toBe('/audio/sfx/finale-crowd.ogg');
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a queued applause when the show is left first', () => {
    vi.useFakeTimers();
    try {
      const instance = effects({ reducedMotion: true });
      instance.start('game-1');
      instance.stop();
      vi.advanceTimersByTime(CROWD_MS);
      expect(audios).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
