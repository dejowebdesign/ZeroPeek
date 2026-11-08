/**
 * Unit tests for the character and cosmetics catalogue (Phase 6.7).
 *
 * These lock in the rules the server relies on:
 *   - every supplied character has a complete asset set and a full default kit;
 *   - every item belongs to exactly one character and one slot;
 *   - an item is compatible only with its own character;
 *   - a character change activates the new character's default equipment;
 *   - an invalid character, slot or item is rejected, and a manipulated payload
 *     can never equip another character's item.
 *
 * No geometry is asserted: the phase deliberately ships no coordinates. A test
 * that pinned a made-up position would defeat the phase's own rule.
 */

import { describe, expect, it } from 'vitest';

import {
  CHARACTER_ASSETS,
  COSMETIC_CATALOGUE,
  EMPTY_AVATAR_CONFIG,
  EMPTY_EQUIPMENT,
  EQUIPMENT_SLOTS,
  characterAvailability,
  cosmeticsForCharacter,
  cosmeticsForSlot,
  defaultAvatarConfig,
  equipmentForCharacter,
  findCharacterAssets,
  findCosmetic,
  hasCharacterArtwork,
  isCosmeticCompatible,
  isEquipmentSlot,
  validateAvatarConfig,
  type EquipmentSlot,
} from './index.js';

describe('character asset catalogue', () => {
  it('contains exactly the two characters whose artwork was supplied', () => {
    expect(CHARACTER_ASSETS.map((character) => character.id)).toEqual(['ethan', 'maya']);
  });

  it('gives every character a preview, a base and all five slots of default kit', () => {
    for (const character of CHARACTER_ASSETS) {
      expect(character.previewPath).toMatch(/^\/characters\//);
      expect(character.basePath).toMatch(/^\/characters\//);
      expect(Object.keys(character.defaultEquipment).sort()).toEqual([...EQUIPMENT_SLOTS].sort());
      for (const slot of EQUIPMENT_SLOTS) {
        const itemId = character.defaultEquipment[slot];
        const item = findCosmetic(itemId);
        // The default must be a real item of this character, in this slot.
        expect(item, `default ${slot} for ${character.id}`).toBeDefined();
        expect(item?.characterId).toBe(character.id);
        expect(item?.slot).toBe(slot);
      }
    }
  });

  it('reports the supplied characters as available and the rest as awaiting assets', () => {
    expect(characterAvailability('ethan')).toBe('available');
    expect(characterAvailability('maya')).toBe('available');
    // Canonical figures without artwork are named honestly, never faked.
    for (const id of ['pixel', 'bee', 'dr-obscura', 'o-bot']) {
      expect(characterAvailability(id)).toBe('awaiting_assets');
      expect(hasCharacterArtwork(id)).toBe(false);
    }
    expect(characterAvailability('nobody')).toBeUndefined();
  });

  it('finds an asset set by id and reports an unknown one as undefined', () => {
    expect(findCharacterAssets('ethan')?.name).toBe('Ethan');
    expect(findCharacterAssets('maya')?.name).toBe('Maya');
    expect(findCharacterAssets('nobody')).toBeUndefined();
    expect(findCharacterAssets(null)).toBeUndefined();
  });
});

describe('cosmetics catalogue', () => {
  it('has exactly the ten supplied items (five per character)', () => {
    expect(COSMETIC_CATALOGUE).toHaveLength(10);
    expect(cosmeticsForCharacter('ethan')).toHaveLength(5);
    expect(cosmeticsForCharacter('maya')).toHaveLength(5);
  });

  it('gives every item a unique id, a character and a valid slot', () => {
    const ids = new Set<string>();
    for (const item of COSMETIC_CATALOGUE) {
      expect(item.id.length).toBeGreaterThan(0);
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
      expect(['ethan', 'maya']).toContain(item.characterId);
      expect(isEquipmentSlot(item.slot)).toBe(true);
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.description.length).toBeGreaterThan(0);
      expect(item.assetPath).toMatch(/^\/characters\//);
    }
  });

  it('offers every slot for every supplied character exactly once', () => {
    for (const character of ['ethan', 'maya']) {
      for (const slot of EQUIPMENT_SLOTS) {
        expect(cosmeticsForSlot(character, slot)).toHaveLength(1);
      }
      // `equipmentForCharacter` returns them in slot order.
      expect(equipmentForCharacter(character).map((item) => item.slot)).toEqual([
        ...EQUIPMENT_SLOTS,
      ]);
    }
  });

  it('never ships an item whose artwork is claimed to be aligned yet', () => {
    // The honest current state: no aligned layer set exists, so nothing is
    // marked `aligned` and no geometry is fabricated.
    for (const item of COSMETIC_CATALOGUE) {
      expect(item.alignment).toBe('not_aligned');
      expect(item.layerGeometry).toBeUndefined();
      expect(item.unlockStatus).toBe('available');
    }
  });

  it('enforces character exclusivity', () => {
    expect(isCosmeticCompatible('ethan_visor', 'ethan')).toBe(true);
    expect(isCosmeticCompatible('maya_visor', 'maya')).toBe(true);
    // The core rule: no cross-character sharing, in either direction.
    expect(isCosmeticCompatible('ethan_visor', 'maya')).toBe(false);
    expect(isCosmeticCompatible('maya_visor', 'ethan')).toBe(false);
    // An unknown id is never compatible.
    expect(isCosmeticCompatible('nope', 'ethan')).toBe(false);
  });
});

describe('defaultAvatarConfig', () => {
  it('activates the full default kit for a supplied character', () => {
    const config = defaultAvatarConfig('maya');
    expect(config.characterId).toBe('maya');
    expect(config.equipment).toEqual({
      visor: 'maya_visor',
      outfit: 'maya_outfit',
      backpack: 'maya_backpack',
      neckAccessory: 'maya_compass',
      wristAccessory: 'maya_wristband',
    });
  });

  it('never mixes another character’s items into the default kit', () => {
    for (const character of CHARACTER_ASSETS) {
      for (const itemId of Object.values(defaultAvatarConfig(character.id).equipment)) {
        expect(findCosmetic(itemId)?.characterId).toBe(character.id);
      }
    }
  });

  it('falls back to empty equipment for a character without artwork', () => {
    expect(defaultAvatarConfig('pixel')).toEqual({
      characterId: 'pixel',
      equipment: { ...EMPTY_EQUIPMENT },
    });
  });
});

describe('validateAvatarConfig', () => {
  const mayaFull = {
    characterId: 'maya',
    equipment: {
      visor: 'maya_visor',
      outfit: 'maya_outfit',
      backpack: 'maya_backpack',
      neckAccessory: 'maya_compass',
      wristAccessory: 'maya_wristband',
    },
  };

  it('accepts a complete, self-consistent configuration', () => {
    const result = validateAvatarConfig(mayaFull);
    expect(result.issues).toEqual([]);
    expect(result.config).toEqual(mayaFull);
  });

  it('accepts a character with no equipment by applying the default kit', () => {
    const result = validateAvatarConfig({ characterId: 'ethan' });
    expect(result.issues).toEqual([]);
    expect(result.config).toEqual(defaultAvatarConfig('ethan'));
  });

  it('accepts a slot explicitly set to null (nothing worn there)', () => {
    const result = validateAvatarConfig({
      characterId: 'ethan',
      equipment: { ...defaultAvatarConfig('ethan').equipment, visor: null },
    });
    expect(result.issues).toEqual([]);
    expect(result.config?.equipment.visor).toBeNull();
  });

  it('rejects a non-object body', () => {
    for (const body of [null, 'nope', 42, []]) {
      expect(validateAvatarConfig(body).issues.length).toBeGreaterThan(0);
    }
  });

  it('rejects a missing or empty character id', () => {
    expect(validateAvatarConfig({}).issues.some((issue) => issue.path === 'characterId')).toBe(
      true,
    );
    expect(validateAvatarConfig({ characterId: '' }).issues.length).toBeGreaterThan(0);
    expect(validateAvatarConfig({ characterId: 7 }).issues.length).toBeGreaterThan(0);
  });

  it('rejects a character that has no artwork', () => {
    const result = validateAvatarConfig({ characterId: 'pixel' });
    expect(result.issues.some((issue) => issue.path === 'characterId')).toBe(true);
    expect(result.config).toBeUndefined();
  });

  it('rejects an unknown character id', () => {
    expect(validateAvatarConfig({ characterId: 'nobody' }).config).toBeUndefined();
  });

  it('rejects an unknown item id', () => {
    const result = validateAvatarConfig({
      characterId: 'ethan',
      equipment: { visor: 'ethan_hat' },
    });
    expect(result.issues.some((issue) => issue.path === 'equipment.visor')).toBe(true);
  });

  it('rejects an item placed in the wrong slot', () => {
    // `ethan_visor` is a visor, not an outfit.
    const result = validateAvatarConfig({
      characterId: 'ethan',
      equipment: { outfit: 'ethan_visor' },
    });
    expect(result.issues.some((issue) => issue.path === 'equipment.outfit')).toBe(true);
  });

  it('rejects an unknown equipment slot', () => {
    const result = validateAvatarConfig({
      characterId: 'ethan',
      equipment: { hat: 'ethan_visor' },
    });
    expect(result.issues.some((issue) => issue.path === 'equipment.hat')).toBe(true);
  });

  it('rejects a non-string, non-null item value', () => {
    const result = validateAvatarConfig({
      characterId: 'ethan',
      equipment: { visor: 42 },
    });
    expect(result.issues.some((issue) => issue.path === 'equipment.visor')).toBe(true);
  });

  it('rejects any extra top-level field', () => {
    const result = validateAvatarConfig({ characterId: 'ethan', xp: 9999 });
    expect(result.issues.some((issue) => issue.path === 'xp')).toBe(true);
  });

  it('rejects an extra field even when no equipment is supplied', () => {
    // Regression: the default-kit fallback must not swallow a smuggled field.
    const result = validateAvatarConfig({ characterId: 'ethan', xp: 9999, level: 3 });
    expect(result.config).toBeUndefined();
    expect(result.issues.map((issue) => issue.path).sort()).toEqual(['level', 'xp']);
  });

  // The central rule of the phase, tested in both directions.
  it('refuses an Ethan item on Maya and a Maya item on Ethan', () => {
    const ethanVisorOnMaya = validateAvatarConfig({
      characterId: 'maya',
      equipment: { visor: 'ethan_visor' },
    });
    expect(ethanVisorOnMaya.issues.some((issue) => issue.path === 'equipment.visor')).toBe(true);
    expect(ethanVisorOnMaya.config).toBeUndefined();

    const mayaVisorOnEthan = validateAvatarConfig({
      characterId: 'ethan',
      equipment: { visor: 'maya_visor' },
    });
    expect(mayaVisorOnEthan.issues.some((issue) => issue.path === 'equipment.visor')).toBe(true);
    expect(mayaVisorOnEthan.config).toBeUndefined();
  });

  it('refuses a whole foreign kit even when every slot is filled', () => {
    const result = validateAvatarConfig({
      characterId: 'ethan',
      equipment: {
        visor: 'maya_visor',
        outfit: 'maya_outfit',
        backpack: 'maya_backpack',
        neckAccessory: 'maya_compass',
        wristAccessory: 'maya_wristband',
      },
    });
    expect(result.issues).toHaveLength(5);
    expect(result.config).toBeUndefined();
  });

  it('reports an issue path for every offending slot, not just the first', () => {
    const result = validateAvatarConfig({
      characterId: 'ethan',
      equipment: { visor: 'maya_visor', outfit: 'maya_outfit' },
    });
    const paths = result.issues.map((issue) => issue.path).sort();
    expect(paths).toEqual(['equipment.outfit', 'equipment.visor']);
  });
});

describe('empty configuration', () => {
  it('has no character and nothing equipped', () => {
    expect(EMPTY_AVATAR_CONFIG).toEqual({ characterId: null, equipment: { ...EMPTY_EQUIPMENT } });
    for (const slot of EQUIPMENT_SLOTS as readonly EquipmentSlot[]) {
      expect(EMPTY_EQUIPMENT[slot]).toBeNull();
    }
  });
});
