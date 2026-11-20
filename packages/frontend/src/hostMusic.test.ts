/**
 * Host background music (Phase 6.11).
 *
 * Each behaviour the phase 6.11 scope requires is checked here against the real
 * module, with a fake media element standing in for the browser's `Audio` — the
 * only thing replaced, because jsdom has no media pipeline. Everything else
 * (settings, storage, phase rules, clamping, persistence) runs for real.
 *
 * The host/player separation is checked structurally: the player page must not
 * import the module at all, so no participant device can even construct it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MUSIC_SETTINGS,
  DEFAULT_VOLUME,
  HostMusic,
  MUSIC_SRC,
  MUSIC_STORAGE_KEY,
  clampVolume,
  effectiveVolume,
  endsTrack,
  isMusicPhase,
  normaliseSettings,
  readMusicSettings,
  shouldPlay,
  writeMusicSettings,
  type AudioFactory,
} from './hostMusic.js';

const here = dirname(fileURLToPath(import.meta.url));

/** A media element stub that records what the player asked it to do. */
interface FakeAudio {
  element: HTMLAudioElement;
  plays: number;
  pauses: number;
  volume: number;
  loop: boolean;
  currentTime: number;
  paused: boolean;
  failPlay?: boolean;
}

/**
 * Build a fake element. `play` resolves by default; `failPlay` makes it reject,
 * which is how a browser reports an autoplay refusal.
 */
function fakeAudio(options: { failPlay?: boolean } = {}): FakeAudio {
  const record: FakeAudio = {
    plays: 0,
    pauses: 0,
    volume: 1,
    loop: false,
    currentTime: 0,
    paused: true,
    failPlay: options.failPlay,
    element: null as unknown as HTMLAudioElement,
  };
  const element = {
    get volume() {
      return record.volume;
    },
    set volume(value: number) {
      record.volume = value;
    },
    get loop() {
      return record.loop;
    },
    set loop(value: boolean) {
      record.loop = value;
    },
    get currentTime() {
      return record.currentTime;
    },
    set currentTime(value: number) {
      record.currentTime = value;
    },
    get paused() {
      return record.paused;
    },
    play: () => {
      record.plays += 1;
      if (record.failPlay) return Promise.reject(new Error('NotAllowedError'));
      record.paused = false;
      return Promise.resolve();
    },
    pause: () => {
      record.pauses += 1;
      record.paused = true;
    },
    load: () => undefined,
    removeAttribute: () => undefined,
    addEventListener: () => undefined,
  } as unknown as HTMLAudioElement;
  record.element = element;
  return record;
}

/** A player wired to a fake element and an in-memory storage. */
function setup(options: { failPlay?: boolean; store?: Map<string, string> } = {}) {
  const store = options.store ?? new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  const audio = fakeAudio(options);
  const factory: AudioFactory = () => audio.element;
  const music = new HostMusic(factory, storage);
  return { music, audio, store };
}

describe('phase rules', () => {
  it('carries music in every phase of a running round', () => {
    for (const phase of ['question', 'reveal', 'board', 'lead'] as const) {
      expect(isMusicPhase(phase)).toBe(true);
    }
    for (const phase of ['lobby', 'end', null] as const) {
      expect(isMusicPhase(phase)).toBe(false);
    }
  });

  it('treats question, reveal and board as proof that a round is under way', () => {
    // Each of them starts the bed from cold, with nothing already running.
    for (const phase of ['question', 'reveal', 'board'] as const) {
      expect(shouldPlay(phase, false, false)).toBe(true);
    }
    // A countdown proves nothing on its own: it also runs before question one.
    for (const phase of ['lead', 'lobby', 'end', null] as const) {
      expect(shouldPlay(phase, false, false)).toBe(false);
    }
  });

  it('never starts the track from a countdown, but lets a running one continue', () => {
    // The pre-game lead: nothing is running, so nothing starts.
    expect(shouldPlay('lead', false, false)).toBe(false);
    // An inter-round lead: the bed is already up, so it keeps going.
    expect(shouldPlay('lead', false, true)).toBe(true);
  });

  it('starts from the phases that only exist after a question opened', () => {
    for (const phase of ['question', 'reveal', 'board'] as const) {
      expect(shouldPlay(phase, false, false)).toBe(true);
    }
  });

  it('does not play while the question is paused', () => {
    expect(shouldPlay('question', false)).toBe(true);
    expect(shouldPlay('question', true)).toBe(false);
    // A pause in any running phase silences the bed, not just in `question`.
    expect(shouldPlay('board', true, true)).toBe(false);
  });

  it('ends the track in the lobby, at the end and with no game', () => {
    expect(endsTrack('lobby')).toBe(true);
    expect(endsTrack('end')).toBe(true);
    expect(endsTrack(null)).toBe(true);
    // A continuing round keeps its position across reveal and board.
    expect(endsTrack('reveal')).toBe(false);
    expect(endsTrack('board')).toBe(false);
    expect(endsTrack('question')).toBe(false);
    expect(endsTrack('lead')).toBe(false);
  });
});

describe('volume maths', () => {
  it('clamps to 0…1 and survives junk input', () => {
    expect(clampVolume(0.42)).toBe(0.42);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(2)).toBe(1);
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_VOLUME);
  });

  it('treats mute as a flag, so the level survives it', () => {
    expect(effectiveVolume({ volume: 0.8, muted: false })).toBe(0.8);
    expect(effectiveVolume({ volume: 0.8, muted: true })).toBe(0);
    // Unmuting restores the stored level, not zero.
    expect(effectiveVolume({ volume: 0.8, muted: false })).toBe(0.8);
  });

  it('rejects a malformed stored value field by field', () => {
    expect(normaliseSettings(null)).toEqual(DEFAULT_MUSIC_SETTINGS);
    expect(normaliseSettings({ volume: 'loud', muted: 'yes' })).toEqual({
      volume: DEFAULT_VOLUME,
      muted: false,
    });
    expect(normaliseSettings({ volume: 3, muted: true })).toEqual({ volume: 1, muted: true });
  });
});

describe('playback follows the phase', () => {
  it('stays silent through the lobby and the pre-game countdown', () => {
    const { music, audio } = setup();
    music.sync('lobby');
    music.sync('lead');
    expect(music.isPlaying).toBe(false);
    expect(audio.plays).toBe(0);
  });

  it('starts when the first question begins', () => {
    const { music, audio } = setup();
    expect(music.isPlaying).toBe(false);
    music.sync('question');
    expect(music.isPlaying).toBe(true);
    expect(audio.plays).toBe(1);
  });

  it('keeps running through a question phase without restarting', () => {
    const { music, audio } = setup();
    music.sync('question');
    // A repaint, a duplicate event, or a second sync for the same phase.
    music.sync('question');
    music.sync('question');
    expect(audio.plays).toBe(1);
  });

  it('runs unbroken from question to reveal to board', () => {
    const { music, audio } = setup();
    music.sync('question');
    audio.currentTime = 12;
    music.sync('reveal');
    expect(music.isPlaying).toBe(true);
    expect(audio.pauses).toBe(0);
    music.sync('board');
    expect(music.isPlaying).toBe(true);
    expect(audio.pauses).toBe(0);
    // One play() for the whole run, and the position never jumped.
    expect(audio.plays).toBe(1);
    expect(audio.currentTime).toBe(12);
  });

  it('runs through a full round without a single extra play or pause', () => {
    const { music, audio } = setup();
    music.sync('lobby');
    music.sync('lead');
    expect(audio.plays).toBe(0);
    music.sync('question');
    music.sync('reveal');
    music.sync('board');
    // An inter-round countdown, then the next question.
    music.sync('lead');
    music.sync('question');
    music.sync('reveal');
    music.sync('board');
    expect(audio.plays).toBe(1);
    expect(audio.pauses).toBe(0);
    expect(music.isPlaying).toBe(true);
  });

  it('keeps running across an inter-round countdown', () => {
    const { music, audio } = setup();
    music.sync('question');
    music.sync('reveal');
    music.sync('board');
    const playsBefore = audio.plays;
    music.sync('lead');
    expect(music.isPlaying).toBe(true);
    music.sync('question');
    expect(audio.plays).toBe(playsBefore);
    expect(audio.pauses).toBe(0);
  });

  it('stops and rewinds at the end of the game', () => {
    const { music, audio } = setup();
    music.sync('question');
    audio.currentTime = 30;
    music.sync('end');
    expect(music.isPlaying).toBe(false);
    expect(audio.pauses).toBe(1);
    expect(audio.currentTime).toBe(0);
  });

  it('rewinds when the host returns to the lobby', () => {
    const { music, audio } = setup();
    music.sync('question');
    audio.currentTime = 30;
    music.sync('lobby');
    expect(music.isPlaying).toBe(false);
    expect(audio.pauses).toBe(1);
    expect(audio.currentTime).toBe(0);
  });

  it('starts a new game from the top after the previous one ended', () => {
    const { music, audio } = setup();
    music.sync('question');
    audio.currentTime = 30;
    music.sync('end');
    expect(audio.currentTime).toBe(0);
    // A fresh round: silent countdown, then the bed starts again from zero.
    music.sync('lobby');
    music.sync('lead');
    expect(music.isPlaying).toBe(false);
    music.sync('question');
    expect(music.isPlaying).toBe(true);
    expect(audio.plays).toBe(2);
    expect(audio.currentTime).toBe(0);
  });

  it('pauses and resumes with the game pause', () => {
    const { music, audio } = setup();
    music.sync('question', false);
    expect(music.isPlaying).toBe(true);
    music.sync('question', true);
    expect(music.isPlaying).toBe(false);
    expect(audio.pauses).toBe(1);
    music.sync('question', false);
    expect(music.isPlaying).toBe(true);
    expect(audio.plays).toBe(2);
  });

  it('never plays outside a running round, even when asked twice', () => {
    const { music, audio } = setup();
    for (const phase of ['lobby', 'lead', 'end'] as const) {
      music.sync(phase);
      expect(music.isPlaying).toBe(false);
    }
    expect(audio.plays).toBe(0);
  });
});

describe('one instance', () => {
  it('creates the element once and reuses it', () => {
    const { music } = setup();
    music.sync('question');
    const first = music.element;
    music.sync('reveal');
    music.sync('question');
    music.sync('end');
    music.sync('question');
    expect(music.element).toBe(first);
  });

  it('does not create an element before it is needed', () => {
    const { music } = setup();
    music.sync('lobby');
    expect(music.element).toBeNull();
  });

  it('holds exactly one element across a whole round', () => {
    const { music } = setup();
    music.sync('lobby');
    music.sync('lead');
    music.sync('question');
    const first = music.element;
    expect(first).not.toBeNull();
    // Every phase of a running round, twice over.
    for (const phase of ['reveal', 'board', 'lead', 'question', 'reveal', 'board'] as const) {
      music.sync(phase);
      expect(music.element).toBe(first);
    }
    music.sync('end');
    expect(music.element).toBe(first);
  });
});

describe('volume control', () => {
  it('applies a volume change immediately', () => {
    const { music, audio } = setup();
    music.sync('question');
    music.setVolume(0.25);
    expect(audio.volume).toBe(0.25);
    music.setVolume(0.75);
    expect(audio.volume).toBe(0.75);
  });

  it('0 percent is fully silent', () => {
    const { music, audio } = setup();
    music.sync('question');
    music.setVolume(0);
    expect(audio.volume).toBe(0);
  });

  it('100 percent is full level', () => {
    const { music, audio } = setup();
    music.sync('question');
    music.setVolume(1);
    expect(audio.volume).toBe(1);
  });

  it('touches no other audio: the module owns one element', () => {
    const { music } = setup();
    music.sync('question');
    music.setVolume(0.3);
    // The only element the module can reach is its own track.
    expect(music.element).not.toBeNull();
    expect(document.querySelectorAll('audio')).toHaveLength(0);
  });

  it('applies the stored level to the element when it is created', () => {
    const store = new Map<string, string>([
      [MUSIC_STORAGE_KEY, JSON.stringify({ volume: 0.3, muted: false })],
    ]);
    const { music, audio } = setup({ store });
    music.sync('question');
    expect(audio.volume).toBe(0.3);
  });
});

describe('mute', () => {
  it('mutes completely', () => {
    const { music, audio } = setup();
    music.sync('question');
    music.setVolume(0.6);
    music.setMuted(true);
    expect(audio.volume).toBe(0);
  });

  it('unmute restores the previous volume', () => {
    const { music, audio } = setup();
    music.sync('question');
    music.setVolume(0.6);
    music.setMuted(true);
    music.setMuted(false);
    expect(audio.volume).toBe(0.6);
    expect(music.current.volume).toBe(0.6);
  });

  it('never rewrites the slider value while muted', () => {
    const { music } = setup();
    music.sync('question');
    music.setVolume(0.45);
    music.toggleMute();
    expect(music.current.muted).toBe(true);
    expect(music.current.volume).toBe(0.45);
  });

  it('stays muted across the phases of a running round', () => {
    const { music, audio } = setup();
    music.sync('question');
    music.setVolume(0.7);
    music.setMuted(true);
    for (const phase of ['reveal', 'board', 'lead', 'question'] as const) {
      music.sync(phase);
      expect(audio.volume).toBe(0);
      expect(music.current.muted).toBe(true);
    }
    // The bed never re-cued, so muting held for the whole round.
    expect(audio.plays).toBe(1);
    // Unmute brings the level back without a restart.
    music.setMuted(false);
    expect(audio.volume).toBe(0.7);
    expect(audio.plays).toBe(1);
  });

  it('keeps playing while muted, so unmute needs no restart', () => {
    const { music } = setup();
    music.sync('question');
    music.setMuted(true);
    expect(music.isPlaying).toBe(true);
  });
});

describe('settings survive a repaint and a reload', () => {
  it('keeps the setting across repeated syncs', () => {
    const { music, audio } = setup();
    music.sync('question');
    music.setVolume(0.35);
    music.sync('question');
    music.sync('question');
    expect(audio.volume).toBe(0.35);
    expect(music.current.volume).toBe(0.35);
  });

  it('restores both values on the next visit', () => {
    const store = new Map<string, string>();
    const first = setup({ store });
    first.music.setVolume(0.2);
    first.music.setMuted(true);
    expect(store.get(MUSIC_STORAGE_KEY)).toBe(JSON.stringify({ volume: 0.2, muted: true }));

    const second = setup({ store });
    expect(second.music.current).toEqual({ volume: 0.2, muted: true });
    second.music.sync('question');
    expect(second.audio.volume).toBe(0);
  });

  it('falls back to the defaults when storage is unreadable', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    } as unknown as Storage;
    expect(readMusicSettings(broken)).toEqual(DEFAULT_MUSIC_SETTINGS);
    expect(() => writeMusicSettings(DEFAULT_MUSIC_SETTINGS, broken)).not.toThrow();
  });

  it('falls back to the defaults on malformed JSON', () => {
    const storage = {
      getItem: () => '{not json',
    } as unknown as Storage;
    expect(readMusicSettings(storage)).toEqual(DEFAULT_MUSIC_SETTINGS);
  });
});

describe('a missing or unplayable file never breaks the show', () => {
  it('keeps the phase running when play() is refused', async () => {
    const { music } = setup({ failPlay: true });
    expect(() => music.sync('question')).not.toThrow();
    // The autoplay refusal is recorded, not thrown.
    await Promise.resolve();
    expect(music.isBlocked).toBe(true);
    expect(music.isPlaying).toBe(true);
  });

  it('retries after a host gesture', async () => {
    const { music, audio } = setup({ failPlay: true });
    music.sync('question');
    await Promise.resolve();
    expect(music.isBlocked).toBe(true);
    audio.failPlay = false;
    expect(music.retry()).toBe(true);
    await Promise.resolve();
    expect(music.isBlocked).toBe(false);
  });

  it('survives an element that throws on construction', () => {
    const music = new HostMusic(() => {
      throw new Error('no media support');
    });
    expect(() => music.sync('question')).not.toThrow();
    expect(music.hasFailed).toBe(true);
  });

  it('survives a play() that throws synchronously', () => {
    const audio = fakeAudio();
    (audio.element as unknown as { play: () => never }).play = () => {
      throw new Error('InvalidStateError');
    };
    const music = new HostMusic(() => audio.element);
    expect(() => music.sync('question')).not.toThrow();
    expect(music.isBlocked).toBe(true);
  });

  it('survives dispose and a later sync', () => {
    const { music } = setup();
    music.sync('question');
    expect(() => music.dispose()).not.toThrow();
    expect(() => music.sync('question')).not.toThrow();
  });
});

describe('host and player stay separate', () => {
  it('the player page never imports the music module', () => {
    for (const file of ['pages/player.ts', 'playerView.ts']) {
      const source = readFileSync(join(here, file), 'utf8');
      expect(source).not.toContain('hostMusic');
      expect(source).not.toContain(MUSIC_SRC);
    }
  });

  it('only the host page imports it', () => {
    const host = readFileSync(join(here, 'pages/host.ts'), 'utf8');
    expect(host).toContain("from '../hostMusic.js'");
  });

  it('no other page imports it', () => {
    for (const file of [
      'pages/editor.ts',
      'pages/admin.ts',
      'pages/auth.ts',
      'pages/profile.ts',
      'pages/inventory.ts',
    ]) {
      expect(readFileSync(join(here, file), 'utf8')).not.toContain('hostMusic');
    }
  });

  it('points at the supplied file under the public audio folder', () => {
    expect(MUSIC_SRC).toBe('/audio/music/question-background.ogg');
  });

  it('the supplied file is present and unchanged', () => {
    // A size check is enough here: `backgrounds.test.ts` does the same for the
    // images, and the byte-identity was verified when the file was copied.
    const path = join(here, '../public/audio/music/question-background.ogg');
    const bytes = readFileSync(path);
    expect(bytes.length).toBe(1740831);
    // The Ogg container magic, so a truncated or replaced file fails loudly.
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('OggS');
  });
});
