/**
 * Background catalogue tests (Phase 6.10).
 *
 * The catalogue is the contract between the owner's supplied files, the host
 * picker and the engine. These tests pin the ids, the paths and the resolution
 * rules, and they check every path against the real file in
 * `packages/frontend/public/backgrounds/` — so a renamed or missing asset fails
 * here rather than as a broken image in the show.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BACKGROUND_CATALOGUE,
  BACKGROUND_IDS,
  DEFAULT_BACKGROUND_ID,
  RANDOM_BACKGROUND,
  backgroundName,
  backgroundPath,
  findBackground,
  isBackgroundId,
  pickRandomBackground,
  resolveBackgroundChoice,
} from './backgrounds.js';

const here = dirname(fileURLToPath(import.meta.url));
const assetDir = join(here, '../../frontend/public/backgrounds');

/** The ten filenames the owner supplied, verbatim. */
const SUPPLIED_FILES = [
  'zeropeek_palmen_tron_background.webp',
  'zeropeek_synthwave_bruecke_zwei_berge.webp',
  'zeropeek_synthwave_forschungsstation_muted.webp',
  'zeropeek_synthwave_lagerhalle_minimal.webp',
  'zeropeek_synthwave_megacity_detail.webp',
  'zeropeek_synthwave_raumstation_ohne_boden.webp',
  'zeropeek_synthwave_skyline.webp',
  'zeropeek_synthwave_unterwasser_v3.webp',
  'zeropeek_synthwave_weltraum.webp',
  'zeropeek_synthwave_wueste.webp',
];

describe('background catalogue', () => {
  it('lists exactly the ten supplied files, in delivery order', () => {
    expect(BACKGROUND_CATALOGUE.map((item) => item.file)).toEqual(SUPPLIED_FILES);
  });

  it('derives a unique, stable id from every filename', () => {
    expect(BACKGROUND_IDS).toEqual([
      'palmen_tron_background',
      'synthwave_bruecke_zwei_berge',
      'synthwave_forschungsstation_muted',
      'synthwave_lagerhalle_minimal',
      'synthwave_megacity_detail',
      'synthwave_raumstation_ohne_boden',
      'synthwave_skyline',
      'synthwave_unterwasser_v3',
      'synthwave_weltraum',
      'synthwave_wueste',
    ]);
    expect(new Set(BACKGROUND_IDS).size).toBe(BACKGROUND_CATALOGUE.length);
  });

  it('points every entry at a supplied file under /backgrounds/', () => {
    for (const item of BACKGROUND_CATALOGUE) {
      expect(item.path).toBe(`/backgrounds/${item.file}`);
    }
  });

  it('gives every entry a non-empty display name that is not just the id', () => {
    for (const item of BACKGROUND_CATALOGUE) {
      expect(item.name.trim().length).toBeGreaterThan(0);
      expect(item.name).not.toBe(item.id);
    }
  });

  it('uses the first catalogue entry as the default', () => {
    expect(DEFAULT_BACKGROUND_ID).toBe(BACKGROUND_IDS[0]);
  });
});

describe('background asset files', () => {
  it('ships a real WebP file for every catalogue path', () => {
    for (const item of BACKGROUND_CATALOGUE) {
      const file = join(assetDir, item.file);
      expect(existsSync(file), `missing asset: ${item.file}`).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(0);
    }
  });

  it('keeps a WebP container header on every supplied file', () => {
    // A structural check on the container only — the module never inspects the
    // image itself, so no motif is classified here.
    for (const item of BACKGROUND_CATALOGUE) {
      const head = readFileSync(join(assetDir, item.file)).subarray(0, 12);
      expect(head.subarray(0, 4).toString('latin1')).toBe('RIFF');
      expect(head.subarray(8, 12).toString('latin1')).toBe('WEBP');
    }
  });

  it('ships no background file the catalogue does not list', () => {
    const onDisk = readdirSync(assetDir)
      .filter((name) => name.endsWith('.webp'))
      .sort();
    expect(onDisk).toEqual([...SUPPLIED_FILES].sort());
  });
});

describe('background lookup', () => {
  it('finds a background by id', () => {
    expect(findBackground('synthwave_skyline')?.file).toBe('zeropeek_synthwave_skyline.webp');
  });

  it('returns undefined for an unknown or empty id', () => {
    expect(findBackground('nope')).toBeUndefined();
    expect(findBackground(null)).toBeUndefined();
    expect(findBackground(undefined)).toBeUndefined();
    expect(findBackground('')).toBeUndefined();
  });

  it('recognises only catalogue ids', () => {
    expect(isBackgroundId('synthwave_wueste')).toBe(true);
    expect(isBackgroundId('synthwave_wueste.webp')).toBe(false);
    expect(isBackgroundId(42)).toBe(false);
    expect(isBackgroundId(null)).toBe(false);
  });

  it('falls back to the default background for an unknown id', () => {
    // A stale or hand-edited value must never produce a broken image reference.
    expect(backgroundPath('gone')).toBe('/backgrounds/zeropeek_palmen_tron_background.webp');
    expect(backgroundPath(null)).toBe('/backgrounds/zeropeek_palmen_tron_background.webp');
    expect(backgroundName('gone')).toBe(BACKGROUND_CATALOGUE[0]!.name);
  });

  it('resolves a known id to its own path, not the fallback', () => {
    expect(backgroundPath('synthwave_weltraum')).toBe(
      '/backgrounds/zeropeek_synthwave_weltraum.webp',
    );
  });
});

describe('random background selection', () => {
  it('picks a catalogue id for every value of the random source', () => {
    for (const value of [0, 0.1, 0.25, 0.5, 0.75, 0.999]) {
      expect(BACKGROUND_IDS).toContain(pickRandomBackground(() => value));
    }
  });

  it('maps the extremes onto the first and last entry', () => {
    expect(pickRandomBackground(() => 0)).toBe(BACKGROUND_IDS[0]);
    expect(pickRandomBackground(() => 0.9999)).toBe(BACKGROUND_IDS.at(-1));
  });

  it('never falls outside the catalogue when the source returns 1 or a negative', () => {
    // `Math.random()` is in [0, 1), but the guard keeps a hand-written source
    // from producing an undefined entry.
    expect(BACKGROUND_IDS).toContain(pickRandomBackground(() => 1));
    expect(BACKGROUND_IDS).toContain(pickRandomBackground(() => -0.5));
  });

  it('is deterministic for a given source, so one call fixes the whole round', () => {
    const source = () => 0.42;
    expect(pickRandomBackground(source)).toBe(pickRandomBackground(source));
  });
});

describe('host background choice', () => {
  it('keeps a concrete catalogue id as sent', () => {
    expect(resolveBackgroundChoice('synthwave_skyline')).toBe('synthwave_skyline');
  });

  it('turns the random sentinel into one concrete id', () => {
    expect(resolveBackgroundChoice(RANDOM_BACKGROUND, () => 0)).toBe(BACKGROUND_IDS[0]);
  });

  it('rejects an unknown value instead of storing it', () => {
    expect(resolveBackgroundChoice('made_up')).toBeUndefined();
    expect(resolveBackgroundChoice(undefined)).toBeUndefined();
    expect(resolveBackgroundChoice(42)).toBeUndefined();
    expect(resolveBackgroundChoice(null)).toBeUndefined();
  });
});
