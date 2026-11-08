/**
 * Avatar rendering and asset tests (Phase 6.7).
 *
 * These lock in the phase's asset promise: every character and item in the
 * shared catalogue points at a file that **actually exists** under
 * `public/characters/`, and the renderer builds a figure only for a character
 * that has artwork. A missing or renamed asset therefore fails the build instead
 * of shipping a broken `<img>`.
 *
 * No image is opened or interpreted — only the file's presence and its WebP
 * signature are checked, which the phase permits (format/transparency checks).
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CHARACTER_ASSETS, COSMETIC_CATALOGUE, defaultAvatarConfig } from '@zeropeek/shared';
import { describe, expect, it } from 'vitest';

import {
  SLOT_LABELS,
  avatarPreview,
  availableSlots,
  characterBaseImage,
  characterPreviewImage,
  itemThumb,
  slotItems,
  withSlot,
} from './avatar.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

/** Resolve a catalogue `assetPath` (e.g. `/characters/ethan/…`) to a file. */
function assetFile(assetPath: string): string {
  return join(publicDir, assetPath.replace(/^\//, ''));
}

/** Whether a file is a WebP by its RIFF/WEBP signature. */
function isWebp(path: string): boolean {
  const header = readFileSync(path).subarray(0, 12);
  return (
    header.subarray(0, 4).toString('ascii') === 'RIFF' &&
    header.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

describe('character assets exist on disk', () => {
  it('has a real WebP file for every character preview and base', () => {
    for (const character of CHARACTER_ASSETS) {
      for (const path of [character.previewPath, character.basePath]) {
        const file = assetFile(path);
        expect(existsSync(file), path).toBe(true);
        expect(isWebp(file), path).toBe(true);
        expect(statSync(file).size).toBeGreaterThan(0);
      }
    }
  });

  it('has a real WebP file for every cosmetic item', () => {
    for (const item of COSMETIC_CATALOGUE) {
      const file = assetFile(item.assetPath);
      expect(existsSync(file), item.assetPath).toBe(true);
      expect(isWebp(file), item.assetPath).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(0);
    }
  });

  it('never reuses the same file for two different items', () => {
    const paths = COSMETIC_CATALOGUE.map((item) => item.assetPath);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('renderer', () => {
  it('builds a figure and a loadout for a character with artwork', () => {
    const node = avatarPreview(defaultAvatarConfig('ethan'));
    expect(node).not.toBeNull();
    const figure = node?.querySelector<HTMLImageElement>('.avatar__figure');
    expect(figure?.getAttribute('src')).toBe('/characters/ethan/ethan_full_preview.webp');
    // One loadout row per slot, each with its item thumbnail.
    expect(node?.querySelectorAll('.avatar__loadout-row')).toHaveLength(5);
    expect(node?.querySelectorAll('.avatar__thumb').length).toBe(5);
  });

  it('returns null for a character without artwork, so no empty frame is drawn', () => {
    expect(
      avatarPreview({
        characterId: 'pixel',
        equipment: { ...defaultAvatarConfig('pixel').equipment },
      }),
    ).toBeNull();
    expect(
      avatarPreview({ characterId: null, equipment: defaultAvatarConfig('ethan').equipment }),
    ).toBeNull();
  });

  it('gives every slot a human label', () => {
    for (const slot of availableSlots('ethan')) {
      expect(SLOT_LABELS[slot].length).toBeGreaterThan(0);
    }
  });

  it('offers every supplied slot for Ethan and Maya', () => {
    for (const id of ['ethan', 'maya']) {
      expect(availableSlots(id)).toEqual([
        'backpack',
        'outfit',
        'neckAccessory',
        'visor',
        'wristAccessory',
      ]);
    }
  });

  it('exposes only a character’s own items for a slot', () => {
    for (const item of slotItems('ethan', 'visor')) {
      expect(item.characterId).toBe('ethan');
    }
    expect(slotItems('pixel', 'visor')).toEqual([]);
  });

  it('returns no figure or thumbnail image for a character without artwork', () => {
    expect(characterPreviewImage('pixel')).toBeNull();
    expect(characterBaseImage('pixel')).toBeNull();
    expect(itemThumb('ethan_visor')).not.toBeNull();
    expect(itemThumb('nope')).toBeNull();
  });

  it('replaces one slot without disturbing the others', () => {
    const base = defaultAvatarConfig('ethan').equipment;
    const changed = withSlot(base, 'visor', null);
    expect(changed.visor).toBeNull();
    expect(changed.outfit).toBe(base.outfit);
    // The original is untouched (pure helper).
    expect(base.visor).toBe('ethan_visor');
  });
});
