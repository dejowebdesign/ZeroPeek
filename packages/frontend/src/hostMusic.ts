/**
 * Host background music (Phase 6.11).
 *
 * One track, one owner: the host/beamer surface plays the supplied question
 * music, and nothing else does. The player page never imports this module, so a
 * player device cannot load or start the track — the separation is structural,
 * not a runtime check.
 *
 * Boundaries that matter:
 *   - **Phase-driven, never UI-driven.** Playback follows the authoritative game
 *     phase passed to `sync`, so a repaint, a reconnect or a local toggle can
 *     never start the music in the wrong phase.
 *   - **One continuous bed per round.** The track starts with the first question
 *     and runs unbroken through every reveal, leaderboard and inter-round pause
 *     until the game actually ends. Moving between those phases touches neither
 *     `play()` nor `pause()`.
 *   - **One instance.** The element is created lazily, once, and reused. Nothing
 *     re-cues it mid-round; only the end of the game stops it.
 *   - **Music only.** The volume and mute settings act on this element alone, so
 *     sound effects keep their own level.
 *   - **Never breaks the show.** Every media call is guarded: a missing or
 *     unplayable file, or a browser that refuses to autoplay, only disables the
 *     music.
 *
 * The supplied file is used byte-for-byte as delivered. It is not re-encoded,
 * trimmed or normalised here.
 */

import type { GamePhase } from '@zeropeek/shared';

/** The supplied track, copied unchanged into the frontend's public folder. */
export const MUSIC_SRC = '/audio/music/question-background.ogg';

/** Where the host's own mix settings live. Host-local; never sent anywhere. */
export const MUSIC_STORAGE_KEY = 'zeropeek.host.music';

/** Start at half volume: audible, never startling on a beamer. */
export const DEFAULT_VOLUME = 0.5;

/** The host's mix settings. `volume` is always 0…1. */
export interface MusicSettings {
  volume: number;
  muted: boolean;
}

export const DEFAULT_MUSIC_SETTINGS: MusicSettings = { volume: DEFAULT_VOLUME, muted: false };

/**
 * The phases that may carry music once the game has begun.
 *
 * The track is the round's bed, not a question cue: it runs from the first
 * question through every reveal, leaderboard and inter-round pause until the
 * game actually ends. `lead` is listed because an inter-round countdown belongs
 * to the running round — see `shouldPlay` for why it cannot *start* the music.
 */
export function isMusicPhase(phase: GamePhase | null): boolean {
  return phase === 'question' || phase === 'reveal' || phase === 'board' || phase === 'lead';
}

/**
 * Whether the track should be audible for a phase.
 *
 * The phases that prove a question has already been opened — `question`,
 * `reveal` and `board` — start the bed, because a reveal resolves a question and
 * a board ranks one, so any of them means the round is under way. A host that
 * reloads straight onto the leaderboard therefore resumes the music exactly
 * where the show is. That is the server's own ordering, not a local assumption.
 *
 * `lead` is the only ambiguous phase: it runs before the first question and,
 * should the server ever add one, between rounds. So it never *starts* the
 * track — `running` is the module's own playback state, and it only lets an
 * already running track continue. The pre-game countdown stays silent, an
 * inter-round countdown keeps the bed going, and no question counter or local
 * game history is involved.
 *
 * A paused game is still the question phase, but the brief asks the music to
 * follow the existing pause concept — the countdown is frozen, so the music
 * pauses with it and resumes on the same spot.
 */
export function shouldPlay(phase: GamePhase | null, paused = false, running = false): boolean {
  if (paused) return false;
  if (!isMusicPhase(phase)) return false;
  // `lead` never starts the track; it only lets a running track continue.
  if (phase === 'lead') return running;
  return true;
}

/**
 * Whether leaving this phase ends the track for good (rewind) rather than
 * merely pausing it. A round that continues keeps its position, so the music
 * carries across reveal and leaderboard into the next question without a
 * restart; a finished or abandoned game starts from the top next time.
 */
export function endsTrack(phase: GamePhase | null): boolean {
  return phase === null || phase === 'lobby' || phase === 'end';
}

/** Clamp a volume to 0…1; a non-number falls back to the default. */
export function clampVolume(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, value));
}

/**
 * The volume the element should actually carry.
 *
 * Mute is a separate flag, not a volume of 0, so unmuting can restore the level
 * the host had set. This function is the single place the two are combined.
 */
export function effectiveVolume(settings: MusicSettings): number {
  return settings.muted ? 0 : clampVolume(settings.volume);
}

/** Validate a value read from storage, falling back per field. */
export function normaliseSettings(raw: unknown): MusicSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MUSIC_SETTINGS };
  const source = raw as Partial<MusicSettings>;
  return {
    volume: clampVolume(source.volume as number),
    muted: source.muted === true,
  };
}

/** `localStorage`, or `null` when the environment has none (SSR, some tests). */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Read the host's saved settings. Best-effort: private mode can throw on
 * storage access, and a remembered volume is a convenience, never a
 * requirement, so a failure falls back to the defaults.
 */
export function readMusicSettings(storage?: Storage | null): MusicSettings {
  // `undefined` means "use the browser's storage"; an explicit `null` means
  // "no storage", which is what a caller without one (and a test) passes.
  const store = storage === undefined ? safeStorage() : storage;
  if (!store) return { ...DEFAULT_MUSIC_SETTINGS };
  try {
    const raw = store.getItem(MUSIC_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MUSIC_SETTINGS };
    return normaliseSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_MUSIC_SETTINGS };
  }
}

/** Persist the host's settings. Best-effort, see `readMusicSettings`. */
export function writeMusicSettings(settings: MusicSettings, storage?: Storage | null): void {
  const store = storage === undefined ? safeStorage() : storage;
  if (!store) return;
  try {
    store.setItem(MUSIC_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // See `readMusicSettings`.
  }
}

/** How the music element is created; injectable so tests need no real media. */
export type AudioFactory = () => HTMLAudioElement;

function defaultAudioFactory(): HTMLAudioElement {
  const audio = new Audio();
  audio.preload = 'none';
  audio.src = MUSIC_SRC;
  audio.loop = true;
  return audio;
}

/**
 * The host's music player.
 *
 * It owns exactly one media element for the lifetime of the page. `sync` is the
 * only way playback changes, and it takes the authoritative phase, so the music
 * cannot drift from the game.
 */
export class HostMusic {
  private settings: MusicSettings;
  private audio: HTMLAudioElement | null = null;
  /** The desired playback state, so `sync` only acts on a real change. */
  private playing = false;
  /** Set when the browser refused a `play()`; cleared by a host gesture. */
  private blocked = false;
  /** Set when the file itself could not be loaded. */
  private failed = false;
  private readonly storage: Storage | null;

  constructor(
    private readonly createAudio: AudioFactory = defaultAudioFactory,
    storage?: Storage | null,
  ) {
    this.storage = storage ?? null;
    this.settings = readMusicSettings(this.storage);
  }

  /** The current settings, as a copy so callers cannot mutate them. */
  get current(): MusicSettings {
    return { ...this.settings };
  }

  /** Whether a track is meant to be running right now. */
  get isPlaying(): boolean {
    return this.playing;
  }

  /** Whether playback is waiting for a host gesture (browser autoplay policy). */
  get isBlocked(): boolean {
    return this.blocked;
  }

  /** Whether the track could not be loaded at all. */
  get hasFailed(): boolean {
    return this.failed;
  }

  /** The live element, or `null` when none has been created yet. */
  get element(): HTMLAudioElement | null {
    return this.audio;
  }

  /**
   * Follow the authoritative phase.
   *
   * Idempotent: calling it twice with the same phase does nothing the second
   * time, so a repaint or a duplicate event cannot restart the track.
   *
   * Once the round is under way the track is continuous — `question`, `reveal`,
   * `board` and an inter-round `lead` all keep it audible, and moving between
   * them touches neither `play()` nor `pause()`. Only the end of the game (or a
   * return to the lobby) stops it, and `this.playing` is the single latch that
   * remembers the round has begun, so nothing local has to guess.
   */
  sync(phase: GamePhase | null, paused = false): void {
    const play = shouldPlay(phase, paused, this.playing);

    // No change of intent: leave the element completely alone. This is what
    // keeps the bed unbroken across reveal and board instead of re-cueing it.
    if (play === this.playing) {
      if (!play && endsTrack(phase)) this.rewind();
      return;
    }

    this.playing = play;
    if (play) {
      this.start();
    } else {
      this.pause();
      if (endsTrack(phase)) this.rewind();
    }
  }

  /** Set the music volume (0…1). Never affects other audio. */
  setVolume(value: number): void {
    this.settings = { ...this.settings, volume: clampVolume(value) };
    this.apply();
    this.persist();
  }

  /** Mute or unmute. The volume itself is preserved across a mute. */
  setMuted(muted: boolean): void {
    this.settings = { ...this.settings, muted };
    this.apply();
    this.persist();
  }

  /** Flip the mute flag; the previous volume comes back on unmute. */
  toggleMute(): boolean {
    this.setMuted(!this.settings.muted);
    return this.settings.muted;
  }

  /**
   * Retry a playback the browser refused.
   *
   * Called from a host click, which is the gesture the autoplay policy wants.
   * Returns whether the track is now playing.
   */
  retry(): boolean {
    if (!this.playing) return false;
    this.blocked = false;
    this.start();
    return !this.blocked;
  }

  /** Stop, drop the element and leave the settings in place. */
  dispose(): void {
    this.playing = false;
    const audio = this.audio;
    this.audio = null;
    if (!audio) return;
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch {
      // Nothing to recover: the element is being discarded anyway.
    }
  }

  /** Create the element once, with its error handler attached. */
  private ensureAudio(): HTMLAudioElement | null {
    if (this.audio) return this.audio;
    try {
      const audio = this.createAudio();
      audio.loop = true;
      audio.volume = effectiveVolume(this.settings);
      audio.addEventListener('error', () => {
        this.failed = true;
      });
      this.audio = audio;
      return audio;
    } catch {
      // A browser without media support must not break the show.
      this.failed = true;
      return null;
    }
  }

  private start(): void {
    const audio = this.ensureAudio();
    if (!audio) return;
    this.apply();
    try {
      const result = audio.play();
      // Chrome and Safari return a promise; a refusal is the autoplay policy,
      // which a host gesture can lift.
      if (result && typeof result.catch === 'function') {
        result.then(
          () => {
            this.blocked = false;
          },
          () => {
            this.blocked = true;
          },
        );
      }
    } catch {
      this.blocked = true;
    }
  }

  private pause(): void {
    try {
      this.audio?.pause();
    } catch {
      // A failed pause must not break the show.
    }
  }

  private rewind(): void {
    const audio = this.audio;
    if (!audio) return;
    try {
      if (audio.currentTime > 0) audio.currentTime = 0;
    } catch {
      // Some browsers refuse a seek before metadata; harmless.
    }
  }

  private apply(): void {
    if (!this.audio) return;
    try {
      this.audio.volume = effectiveVolume(this.settings);
    } catch {
      // See `pause`.
    }
  }

  private persist(): void {
    writeMusicSettings(this.settings, this.storage);
  }
}
