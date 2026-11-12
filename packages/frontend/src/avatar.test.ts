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
  playerAvatar,
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
  it('builds a figure and an empty loadout for a character with artwork', () => {
    const node = avatarPreview(defaultAvatarConfig('ethan'));
    expect(node).not.toBeNull();
    const figure = node?.querySelector<HTMLImageElement>('.avatar__figure');
    expect(figure?.getAttribute('src')).toBe('/characters/ethan/ethan_full_preview.webp');
    // Phase 6.8.4: a character starts with nothing equipped, so there is one row
    // per slot and no thumbnail until an item is worn.
    expect(node?.querySelectorAll('.avatar__loadout-row')).toHaveLength(5);
    expect(node?.querySelectorAll('.avatar__thumb').length).toBe(0);
    expect(node?.querySelectorAll('.avatar__loadout-empty').length).toBe(5);
  });

  it('draws a thumbnail for each equipped slot', () => {
    const node = avatarPreview({
      characterId: 'ethan',
      equipment: {
        visor: 'ethan_visor',
        outfit: 'ethan_outfit',
        backpack: null,
        neckAccessory: null,
        wristAccessory: null,
      },
    });
    expect(node?.querySelectorAll('.avatar__thumb').length).toBe(2);
    expect(node?.querySelectorAll('.avatar__loadout-empty').length).toBe(3);
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
    const base = { ...defaultAvatarConfig('ethan').equipment, visor: 'ethan_visor' };
    const changed = withSlot(base, 'visor', null);
    expect(changed.visor).toBeNull();
    expect(changed.outfit).toBe(base.outfit);
    // The original is untouched (pure helper).
    expect(base.visor).toBe('ethan_visor');
  });
});

describe('player avatar badge (Phase 6.8.3)', () => {
  it('draws the real character figure for a character with artwork', () => {
    const badge = playerAvatar('Ada', 'ethan', { size: 'sm' });
    expect(badge.classList.contains('player-avatar')).toBe(true);
    expect(badge.classList.contains('player-avatar--art')).toBe(true);
    const img = badge.querySelector<HTMLImageElement>('.player-avatar__img');
    expect(img?.getAttribute('src')).toBe('/characters/ethan/ethan_base_current.webp');
    // Decorative: the nickname beside it carries the meaning.
    expect(badge.getAttribute('aria-hidden')).toBe('true');
  });

  it('falls back to a letter badge for a missing or art-less character', () => {
    for (const avatarId of ['', null, undefined, 'pixel', 'not-a-character']) {
      const badge = playerAvatar('maya', avatarId);
      expect(badge.classList.contains('player-avatar--art')).toBe(false);
      // No image at all — never an empty frame or an invented path.
      expect(badge.querySelector('img')).toBeNull();
      expect(badge.querySelector('.player-avatar__initial')?.textContent).toBe('M');
    }
  });

  it('uses a placeholder initial when the nickname is blank', () => {
    const badge = playerAvatar('   ');
    expect(badge.querySelector('.player-avatar__initial')?.textContent).toBe('?');
  });

  it('never invents a path: an art badge points at an existing file', () => {
    const badge = playerAvatar('Ada', 'maya', { size: 'lg' });
    const src = badge.querySelector<HTMLImageElement>('.player-avatar__img')?.getAttribute('src');
    expect(src).toBeTruthy();
    expect(existsSync(assetFile(src!))).toBe(true);
  });
});
