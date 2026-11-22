/**
 * The animated starfield canvas (Phase 6.13).
 *
 * The Phase 6.3 field was pure CSS: tiled gradients on two pseudo-elements with a
 * very slow drift. It cost nothing to download, but it could not twinkle, could
 * not vary per star, and could not place a star anywhere but on a tile grid — on
 * a projector it reads as a static texture. This module replaces it with a real
 * canvas, which is what the brief asks for and what the login surface needs to
 * feel alive.
 *
 * What it does *not* do is cover the round background. The stars are drawn at low
 * alpha over the motif, so the image stays the dominant layer; the field is
 * atmosphere, not content.
 *
 * Cost is bounded three ways, because this runs on player phones too:
 *   - the particle count is derived from the *area*, capped by profile, so a 4K
 *     projector and a phone both get a sane number;
 *   - the pixel ratio is capped at 2, so a 3× phone does not triple the fill;
 *   - the loop pauses on `document.hidden` and resumes on return, so a
 *     backgrounded tab costs nothing.
 *
 * Two profiles, because the two surfaces have different jobs: the host drives a
 * projector and can afford a richer field, a player phone cannot.
 *
 * Phase 6.15 adds the space effects — shooting stars, rare comets, faint light
 * pulses, drifting motes and the nebula veils — but not a second renderer: the
 * geometry and the caps live in `starfieldEffects.ts` and are drawn from the
 * `tick()` below, inside the loop that already exists. Draw order is the brief's
 * visual priority: nebula, motes, stars, then the rare events on top.
 */

import {
  COMET_MAX,
  DOUBLE_METEOR_CHANCE,
  DOUBLE_METEOR_DELAY,
  FLARE_DEPTH,
  METEOR_MAX,
  MOTE_COUNT,
  NEBULA_ALPHA,
  NEBULA_BLOBS,
  NEBULA_SCALE,
  PULSE_INTERVAL,
  PULSE_MAX,
  cometInterval,
  emptyMeteor,
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
  type Comet,
  type EffectProfile,
  type Meteor,
  type Mote,
  type Pulse,
} from './starfieldEffects.js';

/** How the field is sized and how much it animates. */
export type StarfieldProfile = EffectProfile;

export interface StarfieldCanvasOptions {
  /** Which surface this field is for. Defaults to `player`. */
  profile?: StarfieldProfile;
  /** Force the calm variant (tests, and the stored calm preference). */
  calm?: boolean;
  /** Element the canvas is appended to. Defaults to `document.body`. */
  mount?: () => HTMLElement;
  /** Builds the canvas; injectable so a test needs no real DOM canvas. */
  canvas?: () => HTMLCanvasElement;
  /** Clock in milliseconds. */
  now?: () => number;
  /** Frame scheduler; returns a handle for `cancel`. */
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  /** Random source, injectable so a test can be deterministic. */
  random?: () => number;
  /** Viewport size; injectable so a test can set a frame. */
  size?: () => { width: number; height: number };
  /** Observes size changes; injectable because jsdom has no ResizeObserver. */
  observeResize?: (callback: () => void) => () => void;
  /** Observes page visibility; injectable for the same reason. */
  observeVisibility?: (callback: (hidden: boolean) => void) => () => void;
  /** Force the reduced-motion variant (tests). */
  reducedMotion?: boolean;
}

/** One star. Plain fields only: nothing here is allocated per frame. */
interface Star {
  /** Position in CSS pixels, normalised to the frame. */
  x: number;
  y: number;
  /** Radius in CSS pixels. */
  radius: number;
  /** Base brightness, 0–1. */
  alpha: number;
  /** Drift speed in px/s, already scaled by depth. */
  vx: number;
  vy: number;
  /** Twinkle phase and rate, so no two stars pulse together. */
  phase: number;
  rate: number;
  /** Pre-mixed fill style, so a frame never builds a colour string. */
  colour: string;
  /** Depth band, 0 (far) to 1 (near). Drives size, speed and alpha. */
  depth: number;
}

/**
 * Stars per megapixel of frame area.
 *
 * Measured against the round background: at 260/MP the field is clearly present
 * on a projector without competing with the motif, and a 1920×1080 frame lands
 * on ~540 stars, which is dense enough to read as a sky and sparse enough that
 * the image still shows through.
 */
const STARS_PER_MEGAPIXEL = 260;

/** Hard caps per profile, so a huge projector cannot run away with the budget. */
const MAX_STARS: Record<StarfieldProfile, number> = { host: 900, player: 420 };

/**
 * The pixel ratio is capped at 2. The stars are 0.6–1.8 px dots and soft glows,
 * so a 3× ratio adds fill cost with no visible gain.
 */
const MAX_RATIO = 2;

/**
 * Three depth bands. Far stars are small, dim and slow; near stars are larger,
 * brighter and drift faster, which is what produces parallax without a 3D scene.
 */
const DEPTH_BANDS = [
  { min: 0.35, max: 0.55, radius: [0.5, 0.85], alpha: [0.28, 0.5], speed: 2.2 },
  { min: 0.55, max: 0.8, radius: [0.8, 1.25], alpha: [0.45, 0.72], speed: 4.4 },
  { min: 0.8, max: 1, radius: [1.2, 1.9], alpha: [0.65, 0.95], speed: 7.5 },
] as const;

/** The brand's star colours: white, a cyan tint and a violet tint. */
const STAR_COLOURS = ['255, 255, 255', '226, 232, 240', '150, 230, 255', '190, 175, 255'] as const;

/**
 * How much a star's brightness may swing with its twinkle. Kept small: a star
 * that flickers at full contrast looks like a bug, not a sky.
 */
const TWINKLE_DEPTH = 0.38;

/** The calm variant moves at this fraction of the normal speed. */
const CALM_SPEED = 0.35;

/**
 * Overall opacity of the star layer, multiplied into every star's own alpha.
 *
 * The stars sit *over* the round background image, so their brightness is what
 * decides how much of the motif survives. `0.9` is 10 % down from full: the field
 * still reads as a sky, and the image underneath gains contrast. Applying one
 * factor at the single draw site keeps both profiles, every breakpoint and the
 * calm variant on the same level; density, speed and twinkle stay untouched.
 */
const LAYER_OPACITY = 0.9;

/**
 * The animated starfield.
 *
 * One instance per surface. `start` is the only way the loop begins and `stop`
 * the only way it ends, so a re-render can never leave two canvases behind.
 */
export class StarfieldCanvas {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private stars: Star[] = [];
  private frame: number | null = null;
  private startedAt = 0;
  private running = false;
  private hidden = false;
  private width = 0;
  private height = 0;
  private ratio = 1;
  private unsubscribeResize: (() => void) | null = null;
  private unsubscribeVisibility: (() => void) | null = null;
  /** Reused per frame so a tick allocates nothing. */
  private readonly scratch = { x: 0, y: 0 };
  /** Fixed-size effect pools: allocated once, never grown. */
  private readonly meteors: Meteor[] = [];
  private readonly comets: Comet[] = [];
  private readonly pulses: Pulse[] = [];
  private motes: Mote[] = [];
  /** Elapsed seconds of the next allowed spawn, per effect kind. */
  private nextMeteorAt = 0;
  private nextCometAt = 0;
  private nextPulseAt = 0;
  /** A second star of a pair, or `0` when none is pending. */
  private pendingMeteorAt = 0;
  /** The pre-rendered nebula, rebuilt on resize. */
  private nebula: HTMLCanvasElement | null = null;

  constructor(private readonly options: StarfieldCanvasOptions = {}) {}

  /** Whether the loop is currently scheduled. */
  get isRunning(): boolean {
    return this.running;
  }

  /** The live canvas, or `null` before `start` and after `stop`. */
  get element(): HTMLCanvasElement | null {
    return this.canvas;
  }

  /** How many stars are being drawn. */
  get starCount(): number {
    return this.stars.length;
  }

  /** How many drifting motes the current frame holds. */
  get moteCount(): number {
    return this.motes.length;
  }

  /** The canvas backing-store size, for the tests and diagnostics. */
  get pixelSize(): { width: number; height: number } {
    return {
      width: this.canvas?.width ?? 0,
      height: this.canvas?.height ?? 0,
    };
  }

  /**
   * Build the canvas and start the loop.
   *
   * Idempotent: a second call while running is a no-op, which is what keeps a
   * re-render from adding a second canvas.
   */
  start(): boolean {
    if (this.running) return false;
    if (!this.mountCanvas()) return false;
    this.running = true;
    this.hidden = false;
    this.startedAt = this.clock();
    this.seedStars();
    this.seedEffects();
    this.observe();
    this.schedule();
    return true;
  }

  /** Cancel the loop and drop the canvas. Safe to call when not running. */
  stop(): void {
    this.running = false;
    if (this.frame !== null) {
      this.cancelFrame(this.frame);
      this.frame = null;
    }
    this.unsubscribeResize?.();
    this.unsubscribeResize = null;
    this.unsubscribeVisibility?.();
    this.unsubscribeVisibility = null;
    this.canvas?.remove();
    this.canvas = null;
    this.context = null;
    this.stars = [];
    this.motes = [];
    this.nebula = null;
    for (const meteor of this.meteors) meteor.alive = false;
    for (const comet of this.comets) comet.alive = false;
    for (const pulse of this.pulses) pulse.alive = false;
  }

  /** Draw one frame. Exposed for the scheduler and the tests. */
  tick(): void {
    if (!this.running) return;
    const ctx = this.context;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;

    const elapsed = (this.clock() - this.startedAt) / 1000;
    const width = this.width;
    const height = this.height;

    // A full clear, not a trail fade: the stars must not smear, and the layer
    // below must stay untouched — the canvas is transparent, not painted over.
    ctx.clearRect(0, 0, width, height);

    const calm = this.isCalm();
    const speed = calm ? CALM_SPEED : 1;
    // Twinkling is reduced in the calm variant but never removed: a field of
    // frozen dots is the static texture this module exists to replace.
    const twinkle = calm ? TWINKLE_DEPTH * 0.45 : TWINKLE_DEPTH;

    // Reduced motion freezes the whole effect layer: the veils stay, the motes
    // and the streaks are not drawn, and nothing spawns. The stars keep their
    // existing behaviour, which is what the surface already promised.
    const still = this.isStill();

    // The nebula goes down first: it is air behind the field, not paint on top.
    this.paintNebula(ctx, elapsed, still);
    if (!still) this.paintMotes(ctx, elapsed, speed);
    this.paintStars(ctx, elapsed, width, height, speed, twinkle);

    // The rare events come last, so a shooting star is never hidden by a star.
    // Calm only spaces them further apart; reduced motion removes them.
    if (!still) {
      this.advanceMeteors(ctx, elapsed, width, height);
      this.advanceComets(ctx, elapsed, width, height);
      this.advancePulses(ctx, elapsed);
    }

    ctx.globalAlpha = 1;
  }

  private paintStars(
    ctx: CanvasRenderingContext2D,
    elapsed: number,
    width: number,
    height: number,
    speed: number,
    twinkle: number,
  ): void {
    for (const star of this.stars) {
      // Drift is applied as a wrapped offset from the elapsed time, not by
      // mutating `x`: the position stays a pure function of time, so a paused
      // tab resumes exactly where it would have been.
      this.scratch.x = star.x * width + star.vx * speed * elapsed;
      this.scratch.y = star.y * height + star.vy * speed * elapsed;

      let px = this.scratch.x % width;
      if (px < 0) px += width;
      let py = this.scratch.y % height;
      if (py < 0) py += height;

      const pulse = Math.sin(star.phase + elapsed * star.rate) * twinkle;
      // A rare, brief flare on top of the even twinkle: the field gains depth
      // without any star blinking in sync with another.
      const flare = starFlare(star.phase, star.rate, elapsed, FLARE_DEPTH);
      const alpha = Math.max(0, Math.min(1, star.alpha + pulse + flare));
      if (alpha <= 0.01) continue;

      ctx.globalAlpha = alpha * LAYER_OPACITY;
      ctx.fillStyle = star.colour;
      ctx.beginPath();
      ctx.arc(px, py, star.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private isCalm(): boolean {
    if (this.options.calm !== undefined) return this.options.calm;
    if (this.options.reducedMotion !== undefined) return this.options.reducedMotion;
    return false;
  }

  /**
   * Whether the operating system asked for reduced motion.
   *
   * This is deliberately *not* the same flag as `calm`. The brief separates them:
   * the calm preference quietens the sky (fewer shooting stars, slower drift),
   * while reduced motion removes everything that moves on its own. Folding the two
   * together would either leave a reduced-motion user with moving streaks or take
   * the shooting stars away from a calm user who still wants them.
   */
  private isStill(): boolean {
    return this.options.reducedMotion === true;
  }

  /**
   * Allocate the effect pools and the first spawn times.
   *
   * The pools are fixed-length: a flight always reuses a dead slot, so the arrays
   * never grow and a long session cannot leak. The first shooting star is due
   * inside the normal window rather than immediately, so the page opens calm.
   */
  private seedEffects(): void {
    const calm = this.isCalm();
    this.meteors.length = 0;
    for (let index = 0; index < METEOR_MAX; index += 1) this.meteors.push(emptyMeteor());
    this.comets.length = 0;
    for (let index = 0; index < COMET_MAX; index += 1) this.comets.push(emptyMeteor());
    this.pulses.length = 0;
    for (let index = 0; index < PULSE_MAX; index += 1) {
      this.pulses.push({
        alive: false,
        bornAt: 0,
        x: 0,
        y: 0,
        radius: 0,
        alpha: 0,
        colour: '',
      });
    }
    this.motes = makeMotes(MOTE_COUNT[this.profile()], () => this.random());
    this.pendingMeteorAt = 0;
    this.nextMeteorAt = sampleInterval(meteorInterval(calm), () => this.random());
    this.nextCometAt = sampleInterval(cometInterval(calm), () => this.random());
    // A ring is the rarest event; the calm variant drops it entirely, because it
    // is the only effect that reads as a "light impulse".
    this.nextPulseAt =
      calm || this.isStill()
        ? Number.POSITIVE_INFINITY
        : sampleInterval(PULSE_INTERVAL, () => this.random());
  }

  /** The first dead slot, or `null` when every slot is in flight. */
  private freeMeteor(): Meteor | null {
    for (const meteor of this.meteors) if (!meteor.alive) return meteor;
    return null;
  }

  private freeComet(): Comet | null {
    for (const comet of this.comets) if (!comet.alive) return comet;
    return null;
  }

  private freePulse(): Pulse | null {
    for (const pulse of this.pulses) if (!pulse.alive) return pulse;
    return null;
  }

  /**
   * Spawn and draw shooting stars.
   *
   * Spawning is driven by an absolute due time, not by a per-frame probability, so
   * a slow frame cannot multiply the rate: one spawn per due time, and the next
   * due time is sampled fresh. The cap is structural — a slot that is still flying
   * is simply not available, so the sky can never hold more than `METEOR_MAX`.
   */
  private advanceMeteors(
    ctx: CanvasRenderingContext2D,
    elapsed: number,
    width: number,
    height: number,
  ): void {
    if (this.pendingMeteorAt > 0 && elapsed >= this.pendingMeteorAt) {
      this.pendingMeteorAt = 0;
      const slot = this.freeMeteor();
      if (slot) launchMeteor(slot, () => this.random(), width, height, elapsed);
    }

    if (elapsed >= this.nextMeteorAt) {
      const slot = this.freeMeteor();
      if (slot) {
        launchMeteor(slot, () => this.random(), width, height, elapsed);
        // Occasionally a second star follows shortly after the first. It is
        // scheduled, not spawned at once, so the pair reads as a sequence.
        if (this.random() < DOUBLE_METEOR_CHANCE) {
          this.pendingMeteorAt = elapsed + DOUBLE_METEOR_DELAY;
        }
      }
      this.nextMeteorAt =
        elapsed + sampleInterval(meteorInterval(this.isCalm()), () => this.random());
    }

    for (const meteor of this.meteors) {
      if (!meteorAlive(meteor, elapsed)) {
        meteor.alive = false;
        continue;
      }
      this.paintStreak(ctx, meteor, elapsed);
    }
  }

  /** Spawn and draw the rare comets. Same geometry, slower and longer. */
  private advanceComets(
    ctx: CanvasRenderingContext2D,
    elapsed: number,
    width: number,
    height: number,
  ): void {
    if (elapsed >= this.nextCometAt) {
      const slot = this.freeComet();
      if (slot) launchComet(slot, () => this.random(), width, height, elapsed);
      this.nextCometAt =
        elapsed + sampleInterval(cometInterval(this.isCalm()), () => this.random());
    }

    for (const comet of this.comets) {
      if (!meteorAlive(comet, elapsed)) {
        comet.alive = false;
        continue;
      }
      this.paintStreak(ctx, comet, elapsed);
    }
  }

  /** Spawn and draw the faint expanding rings. */
  private advancePulses(ctx: CanvasRenderingContext2D, elapsed: number): void {
    if (elapsed >= this.nextPulseAt) {
      const slot = this.freePulse();
      if (slot) launchPulse(slot, () => this.random(), this.width, this.height, elapsed);
      this.nextPulseAt = elapsed + sampleInterval(PULSE_INTERVAL, () => this.random());
    }

    const life = 2.6;
    for (const pulse of this.pulses) {
      if (!pulse.alive) continue;
      const age = elapsed - pulse.bornAt;
      if (age < 0 || age > life) {
        pulse.alive = false;
        continue;
      }
      // A slow bloom that fades as it widens: no flash, no strobe.
      const progress = age / life;
      const fade = Math.sin(progress * Math.PI);
      ctx.globalAlpha = pulse.alpha * fade * NEBULA_ALPHA;
      ctx.strokeStyle = `rgb(${pulse.colour})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(pulse.x, pulse.y, pulse.radius * (0.6 + progress * 0.6), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /**
   * Draw one shooting star or comet: a fading tail and a small bright head.
   *
   * The tail is a single linear gradient rather than a chain of dots, so a flight
   * costs one stroke instead of dozens of arcs. The head fades in and out over the
   * flight, so a star enters and leaves instead of popping.
   */
  private paintStreak(ctx: CanvasRenderingContext2D, streak: Meteor, elapsed: number): void {
    meteorHead(streak, elapsed, this.scratch);
    const headX = this.scratch.x;
    const headY = this.scratch.y;

    // The head must be inside the frame; the tail may still be outside.
    if (headX < -streak.length || headX > this.width + streak.length) return;
    if (headY < -streak.length || headY > this.height + streak.length) return;

    const life = meteorLife(streak);
    const age = elapsed - streak.bornAt;
    const progress = Math.min(1, Math.max(0, age / life));
    // Fade in over the first fifth, out over the last third.
    const fade = progress < 0.2 ? progress / 0.2 : progress > 0.67 ? (1 - progress) / 0.33 : 1;
    const alpha = streak.alpha * Math.max(0, Math.min(1, fade)) * LAYER_OPACITY;
    if (alpha <= 0.01) return;

    const tailX = headX - streak.dx * streak.length;
    const tailY = headY - streak.dy * streak.length;

    const gradient = ctx.createLinearGradient(headX, headY, tailX, tailY);
    gradient.addColorStop(0, `rgba(${streak.colour}, ${alpha.toFixed(3)})`);
    gradient.addColorStop(0.35, `rgba(${streak.colour}, ${(alpha * 0.35).toFixed(3)})`);
    gradient.addColorStop(1, `rgba(${streak.colour}, 0)`);

    ctx.globalAlpha = 1;
    ctx.strokeStyle = gradient;
    ctx.lineWidth = streak.radius * 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(headX, headY);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    ctx.globalAlpha = alpha;
    ctx.fillStyle = `rgb(${streak.colour})`;
    ctx.beginPath();
    ctx.arc(headX, headY, streak.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Draw the nebula veils.
   *
   * The blobs are radial gradients, which are expensive to build, so they are
   * pre-rendered once into a small offscreen canvas and then scaled up. A cheap
   * breathing transform (a fraction of a percent) keeps them from reading as a
   * still image without a second animation loop.
   */
  private paintNebula(ctx: CanvasRenderingContext2D, elapsed: number, calm: boolean): void {
    const canvas = this.nebula;
    if (!canvas) return;
    // Reduced motion keeps the veils but stops the breathing entirely.
    const breath = calm ? 0 : Math.sin(elapsed * 0.07) * 0.012;
    const scale = 1 + breath;
    const drawWidth = this.width * scale;
    const drawHeight = this.height * scale;
    const offsetX = (this.width - drawWidth) / 2;
    const offsetY = (this.height - drawHeight) / 2;

    ctx.globalAlpha = NEBULA_ALPHA;
    ctx.drawImage(canvas, offsetX, offsetY, drawWidth, drawHeight);
  }

  /** Build the nebula layer for the current frame size. */
  private buildNebula(): void {
    if (typeof document === 'undefined' || this.width <= 0 || this.height <= 0) {
      this.nebula = null;
      return;
    }
    try {
      const scale = NEBULA_SCALE;
      const width = Math.max(1, Math.round(this.width * scale));
      const height = Math.max(1, Math.round(this.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext ? canvas.getContext('2d') : null;
      if (!ctx || typeof ctx.createRadialGradient !== 'function') {
        this.nebula = null;
        return;
      }
      const longer = Math.max(width, height);
      for (const blob of NEBULA_BLOBS) {
        const radius = blob.radius * longer;
        const gradient = ctx.createRadialGradient(
          blob.x * width,
          blob.y * height,
          0,
          blob.x * width,
          blob.y * height,
          radius,
        );
        const [r, g, b] = blob.colour;
        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${blob.alpha})`);
        gradient.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, ${blob.alpha * 0.35})`);
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(blob.x * width, blob.y * height, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      this.nebula = canvas;
    } catch {
      // A context without gradients (jsdom, an exotic browser) simply gets no
      // nebula. The star field is the layer that must never fail.
      this.nebula = null;
    }
  }

  /** Draw the drifting motes: dust that gives the field a near plane. */
  private paintMotes(ctx: CanvasRenderingContext2D, elapsed: number, speed: number): void {
    for (const mote of this.motes) {
      moteAt(mote, elapsed, this.width, this.height, speed, this.scratch);
      const shimmer = Math.sin(mote.phase + elapsed * mote.rate);
      const alpha = mote.alpha * (0.6 + shimmer * 0.4) * LAYER_OPACITY;
      if (alpha <= 0.005) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgb(${mote.colour})`;
      ctx.beginPath();
      ctx.arc(this.scratch.x, this.scratch.y, mote.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private clock(): number {
    return this.options.now ? this.options.now() : performance.now();
  }

  private random(): number {
    return this.options.random ? this.options.random() : Math.random();
  }

  private profile(): StarfieldProfile {
    return this.options.profile ?? 'player';
  }

  private frameSize(): { width: number; height: number } {
    if (this.options.size) return this.options.size();
    if (typeof window === 'undefined') return { width: 0, height: 0 };
    return { width: window.innerWidth || 0, height: window.innerHeight || 0 };
  }

  private mountCanvas(): boolean {
    try {
      const canvas = this.options.canvas ? this.options.canvas() : document.createElement('canvas');
      canvas.className = 'starfield-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      const mount = this.options.mount ? this.options.mount() : document.body;
      mount.append(canvas);
      this.canvas = canvas;
      // jsdom has no 2D context. The loop still runs so the tests can assert the
      // scheduling and the star field; only the drawing is skipped.
      this.context = canvas.getContext ? canvas.getContext('2d') : null;
      this.resize();
      return true;
    } catch {
      return false;
    }
  }

  /** Fit the backing store to the frame at the capped ratio. */
  private resize(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const { width, height } = this.frameSize();
    const ratio = Math.min(
      MAX_RATIO,
      typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
    );
    if (width === this.width && height === this.height && ratio === this.ratio) return;
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    if (this.context) {
      this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    // The field is sized to the frame, so a resize rebuilds it; keeping the old
    // positions would cluster every star into the top-left after a shrink. The
    // nebula is a scaled bitmap, so it has to be re-rendered at the new size too.
    this.seedStars();
    this.buildNebula();
  }

  /** Build the star field for the current frame size. */
  private seedStars(): void {
    const area = (this.width * this.height) / 1_000_000;
    const wanted = Math.max(
      24,
      Math.min(MAX_STARS[this.profile()], Math.round(area * STARS_PER_MEGAPIXEL)),
    );
    const stars: Star[] = [];
    for (let index = 0; index < wanted; index += 1) {
      stars.push(this.makeStar());
    }
    this.stars = stars;
  }

  private makeStar(): Star {
    const band = DEPTH_BANDS[Math.floor(this.random() * DEPTH_BANDS.length)]!;
    const depth = band.min + this.random() * (band.max - band.min);
    const radius = band.radius[0] + this.random() * (band.radius[1] - band.radius[0]);
    const alpha = band.alpha[0] + this.random() * (band.alpha[1] - band.alpha[0]);
    // A slight downward drift on top of the horizontal motion: a pure sideways
    // field reads as a scrolling texture, a diagonal one as a slow sky.
    const angle = this.random() * Math.PI * 2;
    const speed = band.speed * (0.6 + this.random() * 0.8);
    const colour = STAR_COLOURS[Math.floor(this.random() * STAR_COLOURS.length)]!;
    return {
      x: this.random(),
      y: this.random(),
      radius,
      alpha,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.45,
      phase: this.random() * Math.PI * 2,
      rate: 0.35 + this.random() * 0.9,
      colour: `rgb(${colour})`,
      depth,
    };
  }

  private observe(): void {
    const resize =
      this.options.observeResize ??
      ((callback: () => void) => {
        if (typeof window === 'undefined' || typeof window.ResizeObserver !== 'function') {
          const handler = (): void => callback();
          window.addEventListener?.('resize', handler);
          return () => window.removeEventListener?.('resize', handler);
        }
        const observer = new window.ResizeObserver(() => callback());
        observer.observe(document.documentElement);
        return () => observer.disconnect();
      });
    this.unsubscribeResize = resize(() => {
      this.resize();
    });

    const visibility =
      this.options.observeVisibility ??
      ((callback: (hidden: boolean) => void) => {
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
          return () => undefined;
        }
        const handler = (): void => callback(document.hidden);
        document.addEventListener('visibilitychange', handler);
        return () => document.removeEventListener('visibilitychange', handler);
      });
    this.unsubscribeVisibility = visibility((hidden) => this.setHidden(hidden));
  }

  /**
   * Pause on a hidden page and resume on return.
   *
   * A hidden tab still gets `requestAnimationFrame` at a throttled rate, so
   * without this the loop would keep drawing into a canvas nobody can see. The
   * elapsed clock is not reset, so the field resumes where it would have been.
   */
  private setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    if (hidden) {
      if (this.frame !== null) {
        this.cancelFrame(this.frame);
        this.frame = null;
      }
      return;
    }
    if (this.running && this.frame === null) this.schedule();
  }

  private schedule(): void {
    const request =
      this.options.requestFrame ??
      ((callback: () => void) => window.requestAnimationFrame(callback));
    const loop = (): void => {
      if (!this.running) return;
      this.tick();
      if (!this.running || this.hidden) {
        this.frame = null;
        return;
      }
      this.frame = request(loop);
    };
    this.frame = request(loop);
  }

  private cancelFrame(handle: number): void {
    if (this.options.cancelFrame) {
      this.options.cancelFrame(handle);
      return;
    }
    window.cancelAnimationFrame(handle);
  }
}
