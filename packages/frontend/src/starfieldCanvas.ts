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
 */

/** How the field is sized and how much it animates. */
export type StarfieldProfile = 'host' | 'player';

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
      const alpha = Math.max(0, Math.min(1, star.alpha + pulse));
      if (alpha <= 0.01) continue;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = star.colour;
      ctx.beginPath();
      ctx.arc(px, py, star.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  private isCalm(): boolean {
    if (this.options.calm !== undefined) return this.options.calm;
    if (this.options.reducedMotion !== undefined) return this.options.reducedMotion;
    return false;
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
    // positions would cluster every star into the top-left after a shrink.
    this.seedStars();
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
