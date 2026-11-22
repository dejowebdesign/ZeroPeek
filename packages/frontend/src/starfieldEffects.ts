/**
 * Space effects for the starfield canvas: shooting stars, comets, rare light
 * pulses, drifting motes and the nebula veils behind them.
 *
 * This module is deliberately *pure*. It owns the geometry, the intervals and the
 * hard caps, but it never touches a canvas, a clock or a DOM node — the canvas in
 * `starfieldCanvas.ts` drives it from its existing `requestAnimationFrame` loop.
 * That split is what lets the rules be tested without a renderer, and it is what
 * guarantees there is no second engine: every surface that already draws stars
 * gets these effects through the same `tick()`.
 *
 * Time model: an effect stores *when it was born*, not an age that is stepped
 * every frame. Position is then a pure function of elapsed time, exactly like the
 * stars. A hidden tab, a dropped frame or a late paint therefore cannot make a
 * meteor jump, drift off its path or spawn a burst of catch-up streaks.
 *
 * Budget: every collection has a fixed size that is allocated once. Nothing grows
 * while the page runs, so a long session cannot leak particles.
 */

/** Which surface the field is for; both share one implementation. */
export type EffectProfile = 'host' | 'player';

/**
 * Concurrent shooting stars. Two allows the occasional pair the brief asks for
 * ("gelegentlich dürfen zwei kurz hintereinander erscheinen") while making a
 * permanently crowded sky impossible.
 */
export const METEOR_MAX = 2;

/** Concurrent comets. They are a rare event, not a second meteor shower. */
export const COMET_MAX = 1;

/** Concurrent light pulses. At most one faint ring, ever. */
export const PULSE_MAX = 1;

/** Drifting motes, allocated once per resize. */
export const MOTE_COUNT: Record<EffectProfile, number> = { host: 26, player: 16 };

/**
 * Seconds between shooting stars. The brief asks for 8–20 s on average with
 * random spacing; the calm variant stretches that to roughly three times as long.
 */
export const METEOR_INTERVAL: readonly [number, number] = [8, 20];
export const METEOR_INTERVAL_CALM: readonly [number, number] = [24, 55];

/** Comets are an order of magnitude rarer than shooting stars. */
export const COMET_INTERVAL: readonly [number, number] = [55, 120];
export const COMET_INTERVAL_CALM: readonly [number, number] = [150, 300];

/** A faint expanding ring, rarer still. Suppressed entirely in the calm variant. */
export const PULSE_INTERVAL: readonly [number, number] = [90, 180];

/** The chance that a shooting star is followed by a second one shortly after. */
export const DOUBLE_METEOR_CHANCE = 0.22;

/** How long after the first star of a pair the second one appears. */
export const DOUBLE_METEOR_DELAY = 0.45;

/** Twinkle flare: how much brighter a star may briefly get, and how rarely. */
export const FLARE_DEPTH = 0.34;

/** The star colours, reused so a meteor tail matches the field it flies through. */
const METEOR_COLOURS = ['226, 240, 255', '190, 225, 255', '205, 195, 255'] as const;

/**
 * One shooting star. `bornAt` is elapsed seconds, so the whole flight is derived
 * from the clock rather than accumulated per frame.
 */
export interface Meteor {
  alive: boolean;
  bornAt: number;
  x: number;
  y: number;
  /** Unit direction. */
  dx: number;
  dy: number;
  /** px per second. */
  speed: number;
  /** Tail length in px, from head to tip. */
  length: number;
  /** Head radius in px. */
  radius: number;
  alpha: number;
  colour: string;
}

/** A comet: the same shape as a meteor, slower, longer-tailed and rarer. */
export interface Comet extends Meteor {}

/** A faint ring that expands once and fades. */
export interface Pulse {
  alive: boolean;
  bornAt: number;
  x: number;
  y: number;
  radius: number;
  alpha: number;
  colour: string;
}

/** A drifting mote of dust. Position is a pure function of elapsed time. */
export interface Mote {
  /** Normalised base position, 0–1. */
  x: number;
  y: number;
  radius: number;
  alpha: number;
  /** Horizontal drift in px/s. */
  drift: number;
  phase: number;
  rate: number;
  colour: string;
}

/** A soft coloured veil. Position and size are relative to the frame. */
export interface NebulaBlob {
  x: number;
  y: number;
  /** Radius relative to the frame's longer edge. */
  radius: number;
  colour: readonly [number, number, number];
  alpha: number;
}

/**
 * Three veils at the corners the UI leaves free. Kept to a low alpha on purpose:
 * they exist to give depth behind the stars, not to tint the motif.
 */
export const NEBULA_BLOBS: readonly NebulaBlob[] = [
  { x: 0.2, y: 0.24, radius: 0.62, colour: [58, 84, 190], alpha: 0.17 },
  { x: 0.8, y: 0.18, radius: 0.52, colour: [126, 84, 214], alpha: 0.14 },
  { x: 0.56, y: 0.84, radius: 0.7, colour: [34, 150, 186], alpha: 0.1 },
];

/** The nebula is pre-rendered at this fraction of the frame and scaled up. */
export const NEBULA_SCALE = 0.125;

/** Overall alpha of the nebula layer. Low enough to read as air, not as paint. */
export const NEBULA_ALPHA = 0.55;

/** Sample a random interval from a `[min, max]` pair, in seconds. */
export function sampleInterval(range: readonly [number, number], random: () => number): number {
  return range[0] + random() * (range[1] - range[0]);
}

/** The interval that applies to the current variant. */
export function meteorInterval(calm: boolean): readonly [number, number] {
  return calm ? METEOR_INTERVAL_CALM : METEOR_INTERVAL;
}

export function cometInterval(calm: boolean): readonly [number, number] {
  return calm ? COMET_INTERVAL_CALM : COMET_INTERVAL;
}

/**
 * How far a ray can travel from `(x, y)` before it leaves the frame. Used to size
 * a flight so a streak always crosses the visible area instead of dying halfway.
 */
export function exitDistance(
  x: number,
  y: number,
  dx: number,
  dy: number,
  width: number,
  height: number,
): number {
  const tx = dx > 0 ? (width - x) / dx : dx < 0 ? -x / dx : Number.POSITIVE_INFINITY;
  const ty = dy > 0 ? (height - y) / dy : dy < 0 ? -y / dy : Number.POSITIVE_INFINITY;
  const distance = Math.min(tx, ty);
  return Number.isFinite(distance) && distance > 0 ? distance : Math.hypot(width, height);
}

/** An empty slot, allocated once at start and reused for every flight. */
export function emptyMeteor(): Meteor {
  return {
    alive: false,
    bornAt: 0,
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    speed: 0,
    length: 0,
    radius: 0,
    alpha: 0,
    colour: '',
  };
}

/**
 * Fill a slot with a new shooting star.
 *
 * Direction is diagonal and always downward: the field should read as a sky the
 * stars fall through, not as horizontal scratches. The horizontal sign and the
 * angle vary per star, so no two flights look the same.
 */
export function launchMeteor(
  slot: Meteor,
  random: () => number,
  width: number,
  height: number,
  bornAt: number,
): void {
  // 30–72° below the horizon, mirrored left or right.
  const angle = Math.PI * (0.17 + random() * 0.23);
  const sign = random() < 0.5 ? -1 : 1;
  const dx = Math.cos(angle) * sign;
  const dy = Math.sin(angle);

  slot.alive = true;
  slot.bornAt = bornAt;
  slot.dx = dx;
  slot.dy = dy;
  // A little above and beside the frame, so the streak enters rather than pops in.
  slot.x = width * (-0.12 + random() * 0.94);
  slot.y = height * (-0.2 + random() * 0.5);
  slot.speed = 420 + random() * 520;
  slot.length = 90 + random() * 130;
  slot.radius = 1.1 + random() * 0.9;
  slot.alpha = 0.45 + random() * 0.35;
  slot.colour = METEOR_COLOURS[Math.floor(random() * METEOR_COLOURS.length)]!;
}

/**
 * Fill a slot with a comet. Same geometry, deliberately different feel: slower,
 * longer, dimmer and much rarer, so it never competes with a shooting star.
 */
export function launchComet(
  slot: Comet,
  random: () => number,
  width: number,
  height: number,
  bornAt: number,
): void {
  const angle = Math.PI * (0.12 + random() * 0.2);
  const sign = random() < 0.5 ? -1 : 1;
  const dx = Math.cos(angle) * sign;
  const dy = Math.sin(angle);

  slot.alive = true;
  slot.bornAt = bornAt;
  slot.dx = dx;
  slot.dy = dy;
  slot.x = width * (-0.15 + random() * 0.9);
  slot.y = height * (-0.25 + random() * 0.4);
  slot.speed = 55 + random() * 70;
  slot.length = 170 + random() * 110;
  slot.radius = 1.5 + random() * 0.8;
  slot.alpha = 0.3 + random() * 0.22;
  slot.colour = METEOR_COLOURS[Math.floor(random() * METEOR_COLOURS.length)]!;
}

/** Fill a slot with a faint expanding ring. */
export function launchPulse(
  slot: Pulse,
  random: () => number,
  width: number,
  height: number,
  bornAt: number,
): void {
  slot.alive = true;
  slot.bornAt = bornAt;
  slot.x = width * (0.2 + random() * 0.6);
  slot.y = height * (0.15 + random() * 0.5);
  slot.radius = Math.min(width, height) * (0.28 + random() * 0.16);
  slot.alpha = 0.06 + random() * 0.04;
  slot.colour = random() < 0.5 ? '150, 230, 255' : '190, 175, 255';
}

/** Write a meteor's head position into `out`, so a frame allocates nothing. */
export function meteorHead(meteor: Meteor, elapsed: number, out: { x: number; y: number }): void {
  const age = elapsed - meteor.bornAt;
  out.x = meteor.x + meteor.dx * meteor.speed * age;
  out.y = meteor.y + meteor.dy * meteor.speed * age;
}

/** Whether a flight is still inside its lifetime. */
export function meteorAlive(meteor: Meteor, elapsed: number): boolean {
  return meteor.alive && elapsed >= meteor.bornAt && elapsed < meteor.bornAt + meteorLife(meteor);
}

/** How long a flight lasts, derived from the distance it has to cover. */
export function meteorLife(meteor: Meteor): number {
  return Math.max(0.4, meteor.length / meteor.speed + 2.4);
}

/** Build the mote pool once. */
export function makeMotes(count: number, random: () => number): Mote[] {
  const motes: Mote[] = [];
  for (let index = 0; index < count; index += 1) {
    motes.push({
      x: random(),
      y: random(),
      radius: 0.4 + random() * 0.7,
      alpha: 0.06 + random() * 0.1,
      drift: 3 + random() * 6,
      phase: random() * Math.PI * 2,
      rate: 0.08 + random() * 0.16,
      colour: METEOR_COLOURS[Math.floor(random() * METEOR_COLOURS.length)]!,
    });
  }
  return motes;
}

/**
 * Write a mote's position into `out`.
 *
 * The mote drifts sideways and bobs on its own phase, then wraps. Like the stars
 * it is a pure function of time, so nothing has to be stepped or stored.
 */
export function moteAt(
  mote: Mote,
  elapsed: number,
  width: number,
  height: number,
  speed: number,
  out: { x: number; y: number },
): void {
  let x = (mote.x * width + mote.drift * speed * elapsed) % width;
  if (x < 0) x += width;
  const bob = Math.sin(mote.phase + elapsed * mote.rate) * height * 0.012;
  let y = (mote.y * height + bob) % height;
  if (y < 0) y += height;
  out.x = x;
  out.y = y;
}

/**
 * A star's occasional flare.
 *
 * The existing twinkle is a single sine, which is even and predictable. Raising
 * it to a high power produces a narrow peak: the star sits at its base brightness
 * almost all the time and brightens briefly, rarely, and never in sync with its
 * neighbour because the phase is per star.
 */
export function starFlare(phase: number, rate: number, elapsed: number, depth: number): number {
  const wave = Math.sin(phase * 2.7 + elapsed * rate * 0.31);
  if (wave <= 0) return 0;
  return Math.pow(wave, 6) * depth;
}
