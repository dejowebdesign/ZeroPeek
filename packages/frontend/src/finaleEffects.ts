/**
 * Finale show effects (Phase 6.11.3): a full-stage fireworks display, confetti
 * and crowd applause when the winner podium appears on the host/beamer surface.
 *
 * Host-only, like the soundtrack. The player page never imports this module, so
 * a player device cannot download the two effects or run the canvas — the
 * separation is structural, not a runtime check.
 *
 * The sequence is a fixed timeline, not a reaction to each repaint:
 *
 *   t = 0 ms      rockets leave the bottom edge across the stage, fireworks audio
 *   t = 1500 ms   the main volley: six large bursts, spread over the whole frame
 *   t = 2100 ms   crowd applause starts, confetti begins falling
 *   t = 5800 ms   the last burst has fired, everything starts to fade
 *   t = 7000 ms   everything has faded out; the podium is untouched
 *
 * Every stage is derived from **elapsed time since the trigger**, so a slow
 * frame, a background tab or a late paint can never shift the order: a stage
 * that is due and not yet fired fires on the next frame, in order.
 *
 * The trigger is idempotent per game. A repaint, a reconnect or a re-sync of the
 * same game returns `false` and does nothing, so the applause can never play
 * twice.
 *
 * Nothing here touches the game: no socket, no score, no phase. The effects are
 * purely additive decoration over the existing podium.
 *
 * Why this is a rewrite and not a tweak (Phase 6.11.3): the Phase 6.11.2 canvas
 * only ever drew one rocket from the centre and one burst at `y = 0.26h`. Measured
 * in Chromium at 1920×993 it covered 0.19 % of the frame while the rocket flew
 * and 0.25 % at the burst — on a projector that is a speck, which is why the
 * podium looked like it had no animation at all. The display is now driven by a
 * declarative script of rockets and bursts placed across the frame, so the
 * coverage is a property of the script rather than of one hard-coded point.
 */

/** Rocket leaves the bottom edge. */
export const ROCKET_MS = 0;

/**
 * The explosion. The brief fixes this at 1.5 s and the supplied track supports
 * it: its launch report is at 0.02 s and its main burst lands at 1.42 s, so the
 * visual flash sits 80 ms after the audio burst — the same perceived moment.
 */
export const EXPLOSION_MS = 1500;

/** Applause and the first confetti. Just after the burst has opened up. */
export const CROWD_MS = 2100;

/** The last effect has faded; the show is back to a clean podium. */
export const FINALE_END_MS = 7000;

/** How loud the effects play. Independent of the music level, by design. */
export const SFX_VOLUME = 0.6;

/** The supplied effects, copied into the frontend's public folder as OGG. */
export const FIREWORKS_SRC = '/audio/sfx/finale-fireworks.ogg';
export const CROWD_SRC = '/audio/sfx/finale-crowd.ogg';

/**
 * The stage of the sequence at a given elapsed time. Pure, so the ordering is
 * testable without a canvas or an audio element.
 */
export type FinaleStage = 'idle' | 'rocket' | 'explosion' | 'celebration' | 'fade' | 'done';

export function stageAt(elapsedMs: number): FinaleStage {
  if (!Number.isFinite(elapsedMs) || elapsedMs < ROCKET_MS) return 'idle';
  if (elapsedMs < EXPLOSION_MS) return 'rocket';
  if (elapsedMs < CROWD_MS) return 'explosion';
  if (elapsedMs < FINALE_END_MS - 1200) return 'celebration';
  if (elapsedMs < FINALE_END_MS) return 'fade';
  return 'done';
}

/** Whether the explosion is due at this elapsed time. */
export function explosionDue(elapsedMs: number): boolean {
  return elapsedMs >= EXPLOSION_MS;
}

/** Whether the applause is due at this elapsed time. */
export function crowdDue(elapsedMs: number): boolean {
  return elapsedMs >= CROWD_MS;
}

/**
 * The canvas scale factor. Capped at 2 so a 3× or 4× display does not quadruple
 * the pixel count for a decoration — the particles are soft glows, so the cap is
 * invisible and the frame cost stays predictable on a projector.
 */
export function pixelRatio(devicePixelRatio: number | undefined): number {
  if (typeof devicePixelRatio !== 'number' || !Number.isFinite(devicePixelRatio)) return 1;
  return Math.min(2, Math.max(1, devicePixelRatio));
}

/** Whether the viewer asked for less motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The palette: gold, ice blue, violet, and the extra show colours of 6.11.3. */
const PALETTE = ['#fbbf24', '#fcd34d', '#22d3ee', '#7c5cff', '#c4b5fd', '#ffffff'] as const;

/**
 * Burst palettes. Each volley picks one set, so two bursts next to each other do
 * not read as one — the brief asks for gold, silver/white, blue, turquoise, red
 * and violet, and the mix is what makes the frame look like a show.
 */
const BURST_PALETTES = [
  ['#fbbf24', '#fcd34d', '#fde68a', '#ffffff'], // gold
  ['#e2e8f0', '#ffffff', '#cbd5e1', '#94a3b8'], // silver / white
  ['#3b82f6', '#60a5fa', '#93c5fd', '#ffffff'], // blue
  ['#22d3ee', '#67e8f9', '#a5f3fc', '#ffffff'], // turquoise
  ['#ef4444', '#f87171', '#fca5a5', '#fbbf24'], // red
  ['#7c5cff', '#a78bfa', '#c4b5fd', '#e9d5ff'], // violet
] as const;

/**
 * How big a burst is. The brief names three classes with target coverage of the
 * frame: large 15–25 %, medium 8–15 %, small 3–8 %.
 *
 * The class is what the show is built from: seven identical bursts read as
 * wallpaper, while large/medium/small in the same frame read as a real display.
 */
type BurstSize = 'large' | 'medium' | 'small';

/**
 * Where a burst happens, in normalised frame coordinates, so the same script
 * lands correctly on a 4:3 projector and an ultrawide panel.
 *
 * The layout is deliberately asymmetric: the positions run across the top, the
 * upper corners and both flanks. The area directly over the podium card is
 * avoided by the script *and* by a runtime keep-out test in `burst`, so a large
 * shell can never wash out the winner's name even on an unusual aspect ratio.
 */
interface BurstScript {
  /** Horizontal centre, 0 = left edge, 1 = right edge. */
  x: number;
  /** Vertical centre, 0 = top edge, 1 = bottom edge. */
  y: number;
  /** When the burst fires, relative to the start of the sequence. */
  at: number;
  /** Radius of the luminous shell as a fraction of `min(width, height)`. */
  reach: number;
  /** Index into `BURST_PALETTES`. */
  palette: number;
  /** How many sparks this burst throws. */
  count: number;
  /** Drives the glow strength, the flash and the spark spread. */
  size: BurstSize;
}

/** A large burst: the anchor of the display. */
function large(x: number, y: number, at: number, palette: number): BurstScript {
  return { x, y, at, reach: 0.34, palette, count: 130, size: 'large' };
}

/** A medium burst: fills the gaps between the anchors. */
function medium(x: number, y: number, at: number, palette: number): BurstScript {
  return { x, y, at, reach: 0.21, palette, count: 80, size: 'medium' };
}

/** A small burst: keeps the sky alive between volleys. */
function small(x: number, y: number, at: number, palette: number): BurstScript {
  return { x, y, at, reach: 0.14, palette, count: 46, size: 'small' };
}

/**
 * The main volley, all due at 1500 ms as the brief requires.
 *
 * Three large anchors (upper left, upper right, high centre) plus four mediums
 * and two smalls. The three large ones overlap in time by design: the brief asks
 * for at least three large explosions visible at once, and they are what makes
 * the 1.5 s beat land as a finale rather than a pop.
 */
const MAIN_VOLLEY: readonly BurstScript[] = [
  large(0.15, 0.27, EXPLOSION_MS, 0),
  large(0.85, 0.25, EXPLOSION_MS, 2),
  large(0.5, 0.12, EXPLOSION_MS + 40, 1),
  medium(0.02, 0.53, EXPLOSION_MS, 4),
  medium(0.98, 0.51, EXPLOSION_MS, 3),
  medium(0.31, 0.06, EXPLOSION_MS + 110, 5),
  medium(0.69, 0.05, EXPLOSION_MS + 160, 0),
  small(0.04, 0.11, EXPLOSION_MS + 220, 1),
  small(0.96, 0.1, EXPLOSION_MS + 260, 4),
];

/**
 * The running volley: a large or medium burst every 300–400 ms from 2.6 s to
 * 5.75 s, so the sky never goes dark and the frame always has something opening.
 * The sizes alternate, which is what gives the sequence rhythm.
 */
const RUNNING_VOLLEY: readonly BurstScript[] = [
  medium(0.22, 0.3, 2600, 3),
  large(0.78, 0.3, 2950, 0),
  medium(0.45, 0.09, 3300, 1),
  large(0.13, 0.43, 3650, 4),
  medium(0.87, 0.45, 3950, 2),
  large(0.6, 0.13, 4250, 5),
  medium(0.32, 0.2, 4550, 0),
  small(0.03, 0.25, 4800, 3),
  medium(0.72, 0.09, 5000, 4),
  large(0.2, 0.13, 5300, 1),
  medium(0.92, 0.19, 5550, 2),
  small(0.55, 0.05, 5750, 0),
];

/** The whole display, in firing order. */
const SCRIPT: readonly BurstScript[] = [...MAIN_VOLLEY, ...RUNNING_VOLLEY];

/**
 * Rocket ascent. A rocket is a thin streak that climbs and leaves a trail; it is
 * not a burst, so it carries no palette of its own.
 */
interface RocketScript {
  /** Where it leaves the bottom edge, 0 = left, 1 = right. */
  fromX: number;
  /** Where it arrives, in normalised coordinates. */
  toX: number;
  toY: number;
  /** When it launches and when it reaches its apex. */
  from: number;
  to: number;
}

/**
 * Rockets. One per main burst plus a few extra, launched from spread-out points
 * along the bottom edge so the ascent already fills the width of the stage.
 *
 * Each rocket's apex is its burst position, so the display reads as cause and
 * effect: the streak climbs, then the sky opens where it stopped.
 */
const ROCKETS: readonly RocketScript[] = [
  ...MAIN_VOLLEY.map((burst, index) => ({
    fromX: 0.08 + (index / Math.max(1, MAIN_VOLLEY.length - 1)) * 0.84,
    toX: burst.x,
    toY: burst.y,
    from: 0,
    // Arrive a little before their burst so the streak is gone when it opens.
    to: burst.at - 60,
  })),
  { fromX: 0.34, toX: 0.42, toY: 0.2, from: 260, to: 1080 },
  { fromX: 0.66, toX: 0.6, toY: 0.17, from: 520, to: 1340 },
  { fromX: 0.5, toX: 0.55, toY: 0.1, from: 780, to: 1440 },
];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  colour: string;
  /** Gravity multiplier: sparks float, confetti falls. */
  gravity: number;
  /** Confetti tumbles; sparks do not. */
  spin: number;
  angle: number;
  /** Drag per second, so sparks slow down instead of flying off straight. */
  drag: number;
  /** `trail` is the rocket's smoke, `spark`/`glitter` the burst, `confetti` the paper. */
  kind: 'trail' | 'spark' | 'glitter' | 'confetti';
}

/**
 * A luminous cloud. This is what makes a burst read as *big*: a soft radial
 * gradient many times the size of its sparks, so the explosion has a body and
 * lights the frame instead of being a ring of dots.
 *
 * Clouds live in their own array rather than in `particles`: they are drawn as
 * one gradient fill each, so they are the cheapest way to add area, and they
 * must not compete for the spark budget.
 */
interface Cloud {
  x: number;
  y: number;
  /** Radius in px, already scaled to the frame. */
  radius: number;
  /** Seconds left, and the total, for the fade. */
  life: number;
  maxLife: number;
  colour: string;
  /** Peak alpha at the centre. */
  strength: number;
  /** `true` for the brief white flash drawn on top of everything. */
  flash: boolean;
}

/**
 * Hard caps, so the particle count can never grow with the frame rate.
 *
 * The cap is the frame budget, not a style choice. Measured on the 1920×993
 * reference frame the previous volley cost ~0.6 ms per tick including the draw,
 * so 1600 is still well inside a 16.6 ms frame on projector-class hardware while
 * leaving room for the host's own work.
 */
const MAX_PARTICLES = 1600;
/**
 * How much of the budget the rocket trails may use.
 *
 * Trails are the one source that runs every frame, so without a sub-budget they
 * fill the whole array during the ascent and the bursts that follow are dropped
 * by `add` — measured: 846 live particles at 1.2 s, then the main volley at
 * 1.5 s could only add a handful, and the frame got *darker* exactly when the
 * fireworks were due. Capping the trails keeps the show's share free.
 */
const MAX_TRAIL_PARTICLES = 360;
/** Clouds are the expensive draw, so they are capped tightly and separately. */
const MAX_CLOUDS = 28;
const CONFETTI_COUNT = 240;
/** Sparks per burst are scaled by this when the frame is very large. */
const BURST_SPARK_CAP = 150;

/**
 * The podium keep-out, in normalised frame coordinates.
 *
 * The board is centred and at most 1200 px wide with a height of roughly 340 px
 * on the reference frame, so this ellipse covers it with margin at any aspect
 * ratio. Bursts whose glow would reach into it are pushed outwards by
 * `placeBurst`, and the glow is drawn *before* the board in the stacking order,
 * so the winner's name always sits on top of an undimmed surface.
 */
const KEEP_OUT = { x: 0.5, y: 0.62, rx: 0.34, ry: 0.22 } as const;

function pick(seed: number): string {
  return PALETTE[Math.floor(Math.abs(seed) * PALETTE.length) % PALETTE.length]!;
}

/**
 * A palette colour with an explicit alpha, as `rgba(...)`.
 *
 * Canvas gradients need a colour stop with transparency, and the palette is
 * written as opaque hex so it can also be used directly by `fillStyle`. Parsing
 * the six-digit form here keeps the palette readable at its definition.
 */
function withAlpha(hex: string, alpha: number): string {
  const value = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${value}`;
}

/**
 * The host's finale effects.
 *
 * One instance per page. `start` is the only way the sequence begins and `stop`
 * is the only way it ends, so the show can never be left with a stray canvas or
 * a playing effect.
 */
export class FinaleEffects {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private particles: Particle[] = [];
  /** Luminous shells and flashes; drawn as gradients, capped separately. */
  private clouds: Cloud[] = [];
  private frame: number | null = null;
  private startedAt = 0;
  private key: string | null = null;
  /**
   * The last game the finale already ran for. It survives `stop`, so a repaint
   * or a reconnect of a finished game cannot play the applause a second time —
   * only a different game starts a new sequence.
   */
  private playedKey: string | null = null;
  private explosionFired = false;
  private crowdFired = false;
  /** How many bursts of `SCRIPT` have already fired, in script order. */
  private burstsFired = 0;
  /** Live trail particles, so the trails cannot starve the bursts. */
  private trailCount = 0;
  private confettiSpawned = 0;
  private trailSpawnedAt = 0;
  private fireworks: HTMLAudioElement | null = null;
  private crowd: HTMLAudioElement | null = null;

  constructor(
    private readonly options: {
      /** Where the canvas is attached. Defaults to `document.body`. */
      mount?: () => HTMLElement;
      /** Builds the canvas; injectable so a test needs no real DOM canvas. */
      canvas?: () => HTMLCanvasElement;
      /** Builds an audio element for a source path. */
      audio?: (src: string) => HTMLAudioElement;
      /** Clock in milliseconds. */
      now?: () => number;
      /** Frame scheduler; returns a handle for `cancel`. */
      requestFrame?: (callback: () => void) => number;
      cancelFrame?: (handle: number) => void;
      /** Force the reduced-motion path (tests, and the stored calm preference). */
      reducedMotion?: boolean;
      /** Random source, injectable so a test can be deterministic. */
      random?: () => number;
    } = {},
  ) {}

  /** Whether the sequence is on screen. */
  get isRunning(): boolean {
    return this.key !== null;
  }

  /** The game the current sequence belongs to, or `null`. */
  get currentKey(): string | null {
    return this.key;
  }

  /** Whether the applause has started (for the host's own diagnostics). */
  get hasApplause(): boolean {
    return this.crowdFired;
  }

  /** The live canvas, or `null` before the first trigger and after cleanup. */
  get element(): HTMLCanvasElement | null {
    return this.canvas;
  }

  /**
   * Start the sequence for a game.
   *
   * Returns `true` only for the first call per key. A repaint, a reconnect, a
   * re-sync or the podium → outro step all pass the same key and get `false`,
   * which is what keeps the applause from firing twice.
   */
  start(key: string): boolean {
    if (this.key === key || this.playedKey === key) return false;
    this.stop();
    this.playedKey = key;
    this.key = key;
    this.explosionFired = false;
    this.crowdFired = false;
    this.burstsFired = 0;
    this.trailCount = 0;
    this.confettiSpawned = 0;
    this.trailSpawnedAt = 0;
    this.particles = [];
    this.clouds = [];
    this.startedAt = this.clock();

    // Sound first: it is what makes the moment land, and it must not wait for a
    // canvas that a low-end device may struggle with.
    this.playFireworks();

    if (this.reduced) {
      // Reduced motion: the audio still marks the win, but nothing moves and no
      // canvas is created. The applause still follows on its cue.
      this.queueReducedCues();
      return true;
    }

    if (!this.mountCanvas()) return true;
    this.schedule();
    return true;
  }

  /** Stop everything: cancel the frame, drop the canvas, silence the effects. */
  stop(): void {
    this.key = null;
    if (this.frame !== null) {
      this.cancelFrame(this.frame);
      this.frame = null;
    }
    this.particles = [];
    this.clouds = [];
    this.canvas?.remove();
    this.canvas = null;
    this.context = null;
    for (const audio of [this.fireworks, this.crowd]) {
      if (!audio) continue;
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        // A refused seek or pause must not break the show.
      }
    }
  }

  /** Stop and release the audio elements. Called when the page goes away. */
  dispose(): void {
    this.stop();
    for (const audio of [this.fireworks, this.crowd]) {
      if (!audio) continue;
      try {
        audio.removeAttribute('src');
        audio.load();
      } catch {
        // See `stop`.
      }
    }
    this.fireworks = null;
    this.crowd = null;
  }

  /** Advance the timeline by one frame. Exposed for the scheduler and tests. */
  tick(): void {
    if (this.key === null) return;
    const elapsed = this.clock() - this.startedAt;
    const width = this.width();
    const height = this.height();

    // The trails are emitted along the way, not as one burst at launch.
    this.emitTrails(elapsed, width, height);

    // Every burst that is due fires now, in script order. A frame that arrives
    // late (a background tab, a slow beamer) catches up instead of skipping, so
    // the display can never lose a burst because of a dropped frame.
    while (this.burstsFired < SCRIPT.length && elapsed >= SCRIPT[this.burstsFired]!.at) {
      const burst = SCRIPT[this.burstsFired]!;
      this.burstsFired += 1;
      this.explosionFired = true;
      this.burst(burst, width, height);
    }
    if (!this.crowdFired && crowdDue(elapsed)) {
      this.crowdFired = true;
      this.playCrowd();
    }
    if (elapsed >= CROWD_MS) this.spawnConfetti(elapsed, width, height);

    this.step();
    this.draw(elapsed, width, height);

    // The end is a fixed time, not "when the last particle dies": a straggler
    // must not keep a canvas on the beamer after the show is over.
    if (elapsed >= FINALE_END_MS) this.stop();
  }

  private get reduced(): boolean {
    return this.options.reducedMotion ?? prefersReducedMotion();
  }

  private random(): number {
    return this.options.random ? this.options.random() : Math.random();
  }

  private clock(): number {
    return this.options.now ? this.options.now() : performance.now();
  }

  private schedule(): void {
    const request =
      this.options.requestFrame ??
      ((callback: () => void) => window.requestAnimationFrame(callback));
    const loop = (): void => {
      if (this.key === null) return;
      this.tick();
      if (this.key === null) return;
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

  /** In the reduced path there is no frame loop, so the cue is a timer. */
  private queueReducedCues(): void {
    const remaining = CROWD_MS - (this.clock() - this.startedAt);
    const fire = (): void => {
      if (this.key === null || this.crowdFired) return;
      this.crowdFired = true;
      this.playCrowd();
    };
    if (typeof window.setTimeout !== 'function') return;
    window.setTimeout(fire, Math.max(0, remaining));
  }

  private width(): number {
    return this.canvas?.clientWidth || this.viewportWidth();
  }

  private height(): number {
    return this.canvas?.clientHeight || this.viewportHeight();
  }

  private mountCanvas(): boolean {
    try {
      const canvas = this.options.canvas ? this.options.canvas() : document.createElement('canvas');
      canvas.className = 'finale';
      canvas.setAttribute('aria-hidden', 'true');
      const ratio = pixelRatio(typeof window === 'undefined' ? 1 : window.devicePixelRatio);
      const width = this.viewportWidth();
      const height = this.viewportHeight();
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const mount = this.options.mount ? this.options.mount() : document.body;
      mount.append(canvas);
      this.canvas = canvas;
      // jsdom has no 2D context. The timeline still runs, so the sound and the
      // stage order stay correct; only the drawing is skipped.
      this.context = canvas.getContext ? canvas.getContext('2d') : null;
      if (this.context && ratio !== 1) this.context.scale(ratio, ratio);
      return true;
    } catch {
      return false;
    }
  }

  private viewportWidth(): number {
    return typeof window === 'undefined' ? 0 : window.innerWidth || 0;
  }

  private viewportHeight(): number {
    return typeof window === 'undefined' ? 0 : window.innerHeight || 0;
  }

  /** Where the rocket starts and where it has to arrive at 1.5 s. */
  /**
   * The position of one rocket, derived from the elapsed time.
   *
   * Deriving it instead of integrating velocity is what makes the arrival exact:
   * whatever the frame rate, a rocket is at its apex at its scheduled time, so
   * the streak and the burst it belongs to cannot drift apart on a slow device.
   */
  private rocketAt(
    rocket: RocketScript,
    elapsed: number,
    width: number,
    height: number,
  ): { x: number; y: number; visible: boolean } | null {
    if (elapsed < rocket.from || elapsed > rocket.to) return null;
    const span = Math.max(1, rocket.to - rocket.from);
    const progress = Math.min(1, Math.max(0, (elapsed - rocket.from) / span));
    // Ease-out: fast off the ground, slowing as it reaches the top.
    const eased = 1 - (1 - progress) * (1 - progress);
    const fromX = rocket.fromX * width;
    const fromY = height + 10;
    const toX = rocket.toX * width;
    const toY = rocket.toY * height;
    return {
      x: fromX + (toX - fromX) * eased,
      y: fromY + (toY - fromY) * eased,
      visible: true,
    };
  }

  /**
   * A bright trail behind every rocket in flight, emitted along the ascent.
   *
   * The trail is what makes the ascent readable from the back of a room: a bare
   * 3 px dot would be invisible on a projector, a 40 px glowing streak is not.
   */
  private emitTrails(elapsed: number, width: number, height: number): void {
    if (elapsed - this.trailSpawnedAt < 16) return;
    this.trailSpawnedAt = elapsed;
    for (const rocket of ROCKETS) {
      const position = this.rocketAt(rocket, elapsed, width, height);
      if (!position) continue;
      for (let index = 0; index < 3; index += 1) {
        this.add({
          x: position.x + (this.random() - 0.5) * 7,
          y: position.y + (this.random() - 0.5) * 7,
          vx: (this.random() - 0.5) * 46,
          vy: 46 + this.random() * 70,
          life: 0.4 + this.random() * 0.4,
          maxLife: 0.8,
          size: 1.4 + this.random() * 2.2,
          colour: index === 0 ? '#ffffff' : index === 1 ? '#fde68a' : '#fbbf24',
          gravity: 0.5,
          spin: 0,
          angle: 0,
          drag: 0.4,
          kind: 'trail',
        });
      }
    }
  }

  /**
   * One scripted burst: a hot core, a coloured shell and a cloud of glitter.
   *
   * The three parts are what separate a firework from a dot. The core is white
   * and short-lived (the flash), the shell carries the palette and the reach,
   * and the glitter hangs afterwards so the burst leaves a glowing residue
   * instead of vanishing.
   */
  private burst(script: BurstScript, width: number, height: number): void {
    const placed = this.placeBurst(script, width, height);
    const cx = placed.x;
    const cy = placed.y;
    const reach = Math.min(width, height) * script.reach;
    const palette = BURST_PALETTES[script.palette % BURST_PALETTES.length]!;
    const count = Math.min(BURST_SPARK_CAP, script.count);
    // Large bursts get more light, medium less: this is what makes the three
    // classes read as different sizes even when their shells overlap.
    const weight = script.size === 'large' ? 1 : script.size === 'medium' ? 0.62 : 0.38;

    // The body of the explosion: a soft luminous cloud several times the spark
    // radius. Two shells per burst — a wide, faint halo and a tighter, brighter
    // core — so the falloff reads like real light rather than a flat disc.
    this.addCloud({
      x: cx,
      y: cy,
      radius: reach * 1.32,
      life: 1.5 * (0.8 + weight * 0.5),
      maxLife: 1.5 * (0.8 + weight * 0.5),
      colour: palette[1]!,
      strength: 0.075 * weight,
      flash: false,
    });
    this.addCloud({
      x: cx,
      y: cy,
      radius: reach * 1.05,
      life: 1.15 * (0.8 + weight * 0.5),
      maxLife: 1.15 * (0.8 + weight * 0.5),
      colour: palette[0]!,
      strength: 0.52 * weight,
      flash: false,
    });

    // The break flash: a hard white bloom on the frame the shell opens. It is
    // short — 260 ms — and it is the single strongest signal that a firework
    // just went off, which is what a projector at distance needs.
    if (script.size !== 'small') {
      this.addCloud({
        x: cx,
        y: cy,
        radius: reach * 0.62,
        life: 0.26,
        maxLife: 0.26,
        colour: '#ffffff',
        strength: 0.85,
        flash: true,
      });
    }

    // The white core sparks: fast, short, thrown outward on the break.
    for (let index = 0; index < 14; index += 1) {
      const angle = this.random() * Math.PI * 2;
      const speed = reach * (0.9 + this.random() * 0.5);
      this.add({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.18 + this.random() * 0.12,
        maxLife: 0.3,
        size: 2.6 + this.random() * 2,
        colour: '#ffffff',
        gravity: 0.3,
        spin: 0,
        angle: 0,
        drag: 2.4,
        kind: 'spark',
      });
    }

    // The coloured shell: the body of the burst, thrown to the full reach so the
    // sparks define the same circle the glow fills.
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + this.random() * 0.22;
      const speed = reach * (0.55 + this.random() * 0.6);
      this.add({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.7 + this.random() * 1.1,
        maxLife: 2.8,
        size: (2 + this.random() * 3.4) * (0.8 + weight * 0.5),
        colour: palette[index % palette.length]!,
        gravity: 0.72,
        spin: 0,
        angle: 0,
        drag: 1.15,
        kind: 'spark',
      });
    }

    // Glitter: slow, small, long-lived, and drifting down. It is the residue that
    // keeps the sky glowing after the shell has gone.
    const glitter = Math.round(count * 0.55);
    for (let index = 0; index < glitter; index += 1) {
      const angle = this.random() * Math.PI * 2;
      const speed = reach * (0.15 + this.random() * 0.62);
      this.add({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 2.1 + this.random() * 1.4,
        maxLife: 3.5,
        size: 1 + this.random() * 1.8,
        colour: this.random() < 0.5 ? '#ffffff' : palette[0]!,
        gravity: 0.42,
        spin: 0,
        angle: 0,
        drag: 1.6,
        kind: 'glitter',
      });
    }
  }

  /**
   * Move a burst out of the podium keep-out if its glow would reach the text.
   *
   * The script already avoids the centre, but the board is a fixed pixel size
   * while the frame is not, so on a tall or narrow viewport a burst that is fine
   * at 16:9 can land on the winner's name. Pushing the centre outwards by the
   * overlap keeps the guarantee true at every resolution instead of at one.
   */
  private placeBurst(script: BurstScript, width: number, height: number): { x: number; y: number } {
    let nx = script.x;
    let ny = script.y;
    const reach = Math.min(width, height) * script.reach;
    // Normalised keep-out radii, plus the burst's own radius in the same units.
    const rx = KEEP_OUT.rx + reach / Math.max(1, width);
    const ry = KEEP_OUT.ry + reach / Math.max(1, height);
    const dx = (nx - KEEP_OUT.x) / rx;
    const dy = (ny - KEEP_OUT.y) / ry;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) {
      // Inside the ellipse: push along the shortest way out, keeping the side
      // the burst was already on so the composition stays balanced.
      const scale = distance < 0.0001 ? 1 : 1 / distance;
      const pushX = (distance < 0.0001 ? 0 : dx) * scale;
      const pushY = (distance < 0.0001 ? -1 : dy) * scale;
      nx = KEEP_OUT.x + pushX * rx;
      ny = KEEP_OUT.y + pushY * ry;
    }
    return { x: Math.min(1, Math.max(0, nx)) * width, y: Math.min(1, Math.max(0, ny)) * height };
  }

  private addCloud(cloud: Cloud): void {
    if (this.clouds.length >= MAX_CLOUDS) this.clouds.shift();
    this.clouds.push(cloud);
  }

  private spawnConfetti(elapsed: number, width: number, height: number): void {
    const wanted = Math.min(
      CONFETTI_COUNT,
      Math.floor(((elapsed - CROWD_MS) / 1800) * CONFETTI_COUNT),
    );
    while (this.confettiSpawned < wanted) {
      this.confettiSpawned += 1;
      this.add({
        x: this.random() * width,
        y: -12,
        vx: (this.random() - 0.5) * 30,
        vy: 22 + this.random() * 34,
        // Sized to be gone by `FINALE_END_MS`, so the fade is real and the
        // canvas is never cut off mid-fall.
        life: 2 + this.random() * 1,
        maxLife: 3,
        size: 3 + this.random() * 4,
        colour: pick(this.random()),
        gravity: 4,
        spin: (this.random() - 0.5) * 7,
        angle: this.random() * Math.PI,
        drag: 0.6,
        kind: 'confetti',
      });
    }
  }

  private add(particle: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    if (particle.kind === 'trail' && this.trailCount >= MAX_TRAIL_PARTICLES) return;
    if (particle.kind === 'trail') this.trailCount += 1;
    this.particles.push(particle);
  }

  /**
   * Integrate one frame.
   *
   * The step is a fixed 1/60 s, not the measured delta: a particle's shape is
   * decoration, and a fixed step keeps the motion identical whether the beamer
   * runs at 60 or 30 frames. Only the *cues* are time-based, and those are read
   * from the elapsed clock, so a dropped frame can delay a burst but never move
   * it out of order.
   */
  private step(): void {
    const dt = 1 / 60;
    const width = this.width();
    const height = this.height();
    const alive: Particle[] = [];
    for (const particle of this.particles) {
      particle.life -= dt;
      if (particle.life <= 0) continue;
      // Exponential drag: a spark leaves the core fast and then slows, which is
      // what makes a burst open into a sphere instead of a star of straight lines.
      if (particle.drag > 0) {
        const decay = Math.max(0, 1 - particle.drag * dt);
        particle.vx *= decay;
        particle.vy *= decay;
      }
      particle.vy += particle.gravity * 60 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.angle += particle.spin * dt;
      if (particle.y > height + 40 || particle.x < -60 || particle.x > width + 60) continue;
      alive.push(particle);
    }
    this.particles = alive;
    // Recount rather than decrement: the only place a particle dies is this
    // loop, so the counter can never drift out of sync with the array.
    this.trailCount = alive.reduce(
      (total, particle) => total + (particle.kind === 'trail' ? 1 : 0),
      0,
    );

    // Clouds only fade; they do not move. A still glow reads as light in the
    // air, while a drifting one reads as a smoke puff.
    this.clouds = this.clouds.filter((cloud) => {
      cloud.life -= dt;
      return cloud.life > 0;
    });
  }

  private draw(elapsed: number, width: number, height: number): void {
    const ctx = this.context;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, width, height);

    // Additive blending is what turns overlapping sparks into light instead of
    // paint: two cyan sparks over a gold one read as a hot white core, which is
    // how real fireworks look. `lighter` is the whole reason the burst glows.
    ctx.globalCompositeOperation = 'lighter';

    // The luminous shells first, so the sparks sit inside their light. Each is
    // one radial gradient: three stops — full strength at the core, a third at
    // the midpoint, nothing at the rim — which is what gives the falloff a soft
    // edge instead of a visible circle.
    for (const cloud of this.clouds) {
      const fade = Math.max(0, cloud.life / cloud.maxLife);
      // A flash decays sharply (square) so it reads as a strike, while a shell
      // decays linearly so it lingers like light in the air.
      const envelope = cloud.flash ? fade * fade : fade;
      const alpha = cloud.strength * envelope;
      if (alpha <= 0.002 || cloud.radius < 1) continue;
      const gradient = ctx.createRadialGradient(
        cloud.x,
        cloud.y,
        0,
        cloud.x,
        cloud.y,
        cloud.radius,
      );
      gradient.addColorStop(0, withAlpha(cloud.colour, Math.min(1, alpha)));
      gradient.addColorStop(0.5, withAlpha(cloud.colour, Math.min(1, alpha * 0.78)));
      gradient.addColorStop(0.8, withAlpha(cloud.colour, Math.min(1, alpha * 0.3)));
      gradient.addColorStop(1, withAlpha(cloud.colour, 0));
      ctx.globalAlpha = 1;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cloud.x, cloud.y, cloud.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Each rocket is a glowing streak, not a dot: a short line along its recent
    // path plus a bright head. From the back of a room the streak is the thing
    // that is actually visible.
    for (const rocket of ROCKETS) {
      const head = this.rocketAt(rocket, elapsed, width, height);
      if (!head) continue;
      const tail = this.rocketAt(rocket, Math.max(rocket.from, elapsed - 90), width, height);
      const fromX = tail ? tail.x : head.x;
      const fromY = tail ? tail.y : head.y;

      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const particle of this.particles) {
      // Sparks fade out over their whole life; confetti stays opaque and simply
      // falls off the bottom, so it reads as paper rather than as light.
      const fade =
        particle.kind === 'confetti'
          ? 1
          : Math.max(0, Math.min(1, particle.life / Math.min(particle.maxLife, 1.2)));
      ctx.globalAlpha = fade;
      ctx.fillStyle = particle.colour;

      if (particle.kind === 'confetti') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.angle);
        ctx.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
        ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
        continue;
      }

      // Glitter twinkles: a small, fast brightness wobble makes a static dot
      // read as a sparkle instead of a speck of dust.
      if (particle.kind === 'glitter') {
        ctx.globalAlpha = fade * (0.45 + 0.55 * Math.abs(Math.sin(particle.life * 9)));
      }

      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();

      // A soft halo on the larger sparks, so the burst has volume on a projector
      // instead of looking like a scatter of hard dots.
      if (particle.size > 2.2) {
        ctx.globalAlpha = fade * 0.22;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size * 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private audioElement(src: string): HTMLAudioElement | null {
    if (this.options.audio) return this.options.audio(src);
    try {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = src;
      audio.volume = SFX_VOLUME;
      return audio;
    } catch {
      return null;
    }
  }

  private playFireworks(): void {
    this.fireworks ??= this.audioElement(FIREWORKS_SRC);
    this.play(this.fireworks);
  }

  private playCrowd(): void {
    this.crowd ??= this.audioElement(CROWD_SRC);
    this.play(this.crowd);
  }

  private play(audio: HTMLAudioElement | null): void {
    if (!audio) return;
    try {
      audio.currentTime = 0;
      const result = audio.play();
      // A refusal is the autoplay policy. The host has clicked to get here, so
      // this is rare, and a silent finale must never break the podium.
      if (result && typeof result.catch === 'function') result.catch(() => undefined);
    } catch {
      // See above.
    }
  }
}
