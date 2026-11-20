/**
 * Finale show effects (Phase 6.11.2): fireworks, confetti and crowd applause when
 * the winner podium appears on the host/beamer surface.
 *
 * Host-only, like the soundtrack. The player page never imports this module, so
 * a player device cannot download the two effects or run the canvas — the
 * separation is structural, not a runtime check.
 *
 * The sequence is a fixed timeline, not a reaction to each repaint:
 *
 *   t = 0 ms      rocket leaves the bottom edge, golden trail, fireworks audio
 *   t = 1500 ms   explosion in the upper third, three colour layers
 *   t = 2100 ms   crowd applause starts, confetti begins falling
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

/** The palette: gold, ice blue, violet and a little white light. */
const PALETTE = ['#fbbf24', '#fcd34d', '#22d3ee', '#7c5cff', '#c4b5fd', '#ffffff'] as const;

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
  /** `spark` fades as a dot, `confetti` as a small rotating rectangle. */
  kind: 'spark' | 'confetti';
}

/** Hard caps, so the particle count can never grow with the frame rate. */
const MAX_PARTICLES = 420;
const CONFETTI_COUNT = 90;
const EXPLOSION_PER_LAYER = 42;
const GLITTER_COUNT = 36;
const SECONDARY_BURSTS = 3;
const SECONDARY_PER_BURST = 18;

function pick(seed: number): string {
  return PALETTE[Math.floor(Math.abs(seed) * PALETTE.length) % PALETTE.length]!;
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
  private secondaryFired = 0;
  private confettiSpawned = 0;
  private trailSpawnedAt = 0;
  private rocketPathFixed: { fromX: number; toX: number; toY: number } | null = null;
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
    this.secondaryFired = 0;
    this.confettiSpawned = 0;
    this.trailSpawnedAt = 0;
    this.rocketPathFixed = null;
    this.particles = [];
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

    // The trail is emitted along the way, not as one burst at the start.
    if (elapsed < EXPLOSION_MS) this.emitTrail(elapsed, width, height);

    if (!this.explosionFired && explosionDue(elapsed)) {
      this.explosionFired = true;
      this.explode(width, height);
    }
    if (!this.crowdFired && crowdDue(elapsed)) {
      this.crowdFired = true;
      this.playCrowd();
    }
    if (elapsed >= CROWD_MS) this.spawnConfetti(elapsed, width, height);
    this.spawnSecondaries(elapsed, width, height);

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
  private rocketPath(width: number, height: number): { fromX: number; toX: number; toY: number } {
    return {
      fromX: width * 0.5,
      toX: width * (0.38 + this.random() * 0.24),
      toY: height * 0.26,
    };
  }

  /**
   * The rocket's position, derived from the elapsed time.
   *
   * Deriving it instead of integrating velocity is what makes the arrival exact:
   * whatever the frame rate, the rocket is at the explosion point at 1.5 s, so
   * the flash and the audio burst cannot drift apart on a slow device.
   *
   * The path is fixed when the sequence starts, so the target cannot jitter from
   * frame to frame as the random source advances.
   */
  private rocketAt(
    elapsed: number,
    width: number,
    height: number,
  ): { x: number; y: number; progress: number } {
    const path = this.rocketPathFixed ?? this.rocketPath(width, height);
    this.rocketPathFixed = path;
    const progress = Math.min(1, Math.max(0, elapsed / EXPLOSION_MS));
    // Ease-out: fast off the ground, slowing as it reaches the top.
    const eased = 1 - (1 - progress) * (1 - progress);
    return {
      x: path.fromX + (path.toX - path.fromX) * eased,
      y: height + 10 + (path.toY - height - 10) * eased,
      progress,
    };
  }

  /** A bright golden trail with a few sparks, emitted along the ascent. */
  private emitTrail(elapsed: number, width: number, height: number): void {
    if (elapsed - this.trailSpawnedAt < 16) return;
    this.trailSpawnedAt = elapsed;
    const rocket = this.rocketAt(elapsed, width, height);
    for (let index = 0; index < 2; index += 1) {
      this.add({
        x: rocket.x + (this.random() - 0.5) * 6,
        y: rocket.y + (this.random() - 0.5) * 6,
        vx: (this.random() - 0.5) * 40,
        vy: 40 + this.random() * 60,
        life: 0.35 + this.random() * 0.35,
        maxLife: 0.7,
        size: 0.9 + this.random() * 1.4,
        colour: index === 0 ? '#ffffff' : '#fbbf24',
        gravity: 0.5,
        spin: 0,
        angle: 0,
        kind: 'spark',
      });
    }
  }

  /**
   * The explosion: three radial layers, one per brand colour, plus glitter.
   *
   * It is anchored in the upper third of the screen, above the podium card, so
   * it never covers a name or a placement.
   */
  private explode(width: number, height: number): void {
    const cx = width * 0.5;
    const cy = height * 0.26;
    const layers = [
      { colour: '#fbbf24', speed: 1.0 },
      { colour: '#22d3ee', speed: 0.78 },
      { colour: '#7c5cff', speed: 0.58 },
    ];
    const reach = Math.min(width, height) * 0.34;
    for (const layer of layers) {
      for (let index = 0; index < EXPLOSION_PER_LAYER; index += 1) {
        const angle = (Math.PI * 2 * index) / EXPLOSION_PER_LAYER + this.random() * 0.18;
        const speed = reach * layer.speed * (0.55 + this.random() * 0.6);
        this.add({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1.3 + this.random() * 0.7,
          maxLife: 2,
          size: 1.6 + this.random() * 2.4,
          colour: layer.colour,
          gravity: 0.85,
          spin: 0,
          angle: 0,
          kind: 'spark',
        });
      }
    }
    for (let index = 0; index < GLITTER_COUNT; index += 1) {
      const angle = this.random() * Math.PI * 2;
      const speed = reach * (0.2 + this.random() * 0.5);
      this.add({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.8 + this.random() * 0.9,
        maxLife: 2.7,
        size: 0.9 + this.random() * 1.2,
        colour: '#ffffff',
        gravity: 0.55,
        spin: 0,
        angle: 0,
        kind: 'spark',
      });
    }
  }

  /** Smaller bursts behind the celebration, spaced out over the fade. */
  private spawnSecondaries(elapsed: number, width: number, height: number): void {
    const cues = [CROWD_MS + 700, CROWD_MS + 1600, CROWD_MS + 2600];
    while (this.secondaryFired < cues.length && elapsed >= cues[this.secondaryFired]!) {
      this.secondaryFired += 1;
      const cx = width * (0.2 + this.random() * 0.6);
      const cy = height * (0.16 + this.random() * 0.18);
      const reach = Math.min(width, height) * 0.16;
      const colour = this.secondaryFired % 2 === 0 ? '#22d3ee' : '#fbbf24';
      for (let index = 0; index < SECONDARY_PER_BURST; index += 1) {
        const angle = (Math.PI * 2 * index) / SECONDARY_PER_BURST;
        this.add({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * reach * (0.5 + this.random() * 0.5),
          vy: Math.sin(angle) * reach * (0.5 + this.random() * 0.5),
          life: 0.9 + this.random() * 0.5,
          maxLife: 1.4,
          size: 1.2 + this.random() * 1.6,
          colour,
          gravity: 0.7,
          spin: 0,
          angle: 0,
          kind: 'spark',
        });
      }
    }
  }

  /** Confetti across the whole surface, in small batches so it trickles. */
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
        size: 3 + this.random() * 3,
        colour: pick(this.random()),
        gravity: 4,
        spin: (this.random() - 0.5) * 6,
        angle: this.random() * Math.PI,
        kind: 'confetti',
      });
    }
  }

  private add(particle: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) return;
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
      particle.vy += particle.gravity * 60 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.angle += particle.spin * dt;
      if (particle.y > height + 40 || particle.x < -60 || particle.x > width + 60) continue;
      alive.push(particle);
    }
    this.particles = alive;
  }

  private draw(elapsed: number, width: number, height: number): void {
    const ctx = this.context;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, width, height);

    // The rocket itself, drawn on top of its own trail until the burst.
    if (elapsed < EXPLOSION_MS) {
      const rocket = this.rocketAt(elapsed, width, height);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      ctx.arc(rocket.x, rocket.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(rocket.x, rocket.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const particle of this.particles) {
      const fade = Math.max(0, Math.min(1, particle.life / Math.min(particle.maxLife, 1.2)));
      ctx.globalAlpha = fade;
      ctx.fillStyle = particle.colour;
      if (particle.kind === 'confetti') {
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.angle);
        ctx.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
        ctx.restore();
        continue;
      }
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
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
