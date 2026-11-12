/**
 * Character asset catalogue and avatar configuration (Phase 6.7).
 *
 * This module is the **single source of truth** for the two Blockwelt-Helden
 * characters whose artwork the project owner has supplied — **Ethan** and
 * **Maya** — and for the rules that govern a player's avatar configuration.
 *
 * Boundaries that matter:
 *   - **No invented characters.** Only `ethan` and `maya` have assets. The other
 *     canonical figures (`pixel`, `bee`, `dr-obscura`, `o-bot`) are still listed
 *     in `CHARACTER_CATALOGUE` for the picker, but have **no** artwork and are
 *     reported as `awaiting_assets` here; nothing is drawn or generated for them.
 *   - **No invented geometry.** The supplied single-item graphics are not yet
 *     aligned to a shared canvas, so this module exposes **no** coordinates,
 *     scales, anchors or z-orders. See `cosmetics.ts`.
 *   - **Character exclusivity** (Phase 5c §3.2): an item belongs to exactly one
 *     character and may only ever be equipped on that character. The server is
 *     the authority; `validateAvatarConfig` is the pure rule it runs.
 *
 * The pure functions here run unchanged in the backend, so a passing unit test
 * proves the server's behaviour.
 */

import {
  EQUIPMENT_SLOTS,
  cosmeticsForCharacter,
  findCosmetic,
  isEquipmentSlot,
  type CosmeticItem,
  type EquipmentSlot,
} from './cosmetics.js';
import { CHARACTER_CATALOGUE, type CharacterRarity } from './profile.js';
import type { ValidationIssue } from './validation.js';

/** Whether a character has usable artwork yet. */
export type CharacterAvailability = 'available' | 'awaiting_assets';

/**
 * One character **that has artwork**, with the paths to its supplied images and
 * the default equipment a player wears on first selecting it.
 *
 * Only characters with a complete asset package appear here. `name`, `tagline`
 * and `rarity` are read from the shared `CHARACTER_CATALOGUE`, so the display
 * name is defined once.
 */
export interface CharacterAssetSet {
  /** Stable id, the same key stored in `PlayerProfile.selectedCharacterId`. */
  id: string;
  /** Display name (from the shared catalogue). */
  name: string;
  /** Short characterisation (from the shared catalogue). */
  tagline: string;
  /** Cosmetic rarity (from the shared catalogue). */
  rarity: CharacterRarity;
  /** Always `available`: this list only contains characters with artwork. */
  availability: 'available';
  /** Public URL of the full-character preview image. */
  previewPath: string;
  /** Public URL of the separate base figure image. */
  basePath: string;
  /**
   * The equipment automatically worn when this character is selected. Every one
   * of the five slots has exactly one default item, taken from the character's
   * own catalogue — so a default can never be another character's item.
   */
  defaultEquipment: Record<EquipmentSlot, string>;
}

/**
 * The default equipment for a character, derived from its own items.
 *
 * Derived rather than hand-written so it can never name an item the character
 * does not own. Throws if a character is missing a slot's item, which would mean
 * an incomplete asset package — a programming error, caught by the unit tests.
 */
function defaultEquipmentFor(characterId: string): Record<EquipmentSlot, string> {
  const items = cosmeticsForCharacter(characterId);
  const defaults = {} as Record<EquipmentSlot, string>;
  for (const slot of EQUIPMENT_SLOTS) {
    const item = items.find((candidate) => candidate.slot === slot);
    if (!item) throw new Error(`Character "${characterId}" has no ${slot} item.`);
    defaults[slot] = item.id;
  }
  return defaults;
}

/** Look a catalogue character up, or throw if the id is not canonical. */
function canonical(characterId: string) {
  const character = CHARACTER_CATALOGUE.find((candidate) => candidate.id === characterId);
  if (!character) throw new Error(`Unknown character id "${characterId}".`);
  return character;
}

/**
 * The characters with supplied artwork.
 *
 * Ethan and Maya each ship seven WebP images (a preview, a base figure and five
 * equipment layers) copied verbatim from the owner's ZIP into
 * `packages/frontend/public/characters/<id>/`. The paths below point at those
 * exact files.
 */
export const CHARACTER_ASSETS: readonly CharacterAssetSet[] = [
  {
    ...canonical('ethan'),
    availability: 'available',
    previewPath: '/characters/ethan/ethan_full_preview.webp',
    basePath: '/characters/ethan/ethan_base_current.webp',
    defaultEquipment: defaultEquipmentFor('ethan'),
  },
  {
    ...canonical('maya'),
    availability: 'available',
    previewPath: '/characters/maya/maya_full_preview.webp',
    basePath: '/characters/maya/maya_base.webp',
    defaultEquipment: defaultEquipmentFor('maya'),
  },
];

/** Look an asset-bearing character up by id, or `undefined`. */
export function findCharacterAssets(characterId: string | null | undefined) {
  if (!characterId) return undefined;
  return CHARACTER_ASSETS.find((entry) => entry.id === characterId);
}

/**
 * Whether a character has artwork and can therefore be equipped.
 *
 * The picker may still offer a name-only character, but the avatar editor can
 * only render and equip the ones with assets.
 */
export function hasCharacterArtwork(characterId: string | null | undefined): boolean {
  return findCharacterAssets(characterId) !== undefined;
}

/**
 * The availability of a canonical character.
 *
 * A character with an asset package is `available`; every other canonical figure
 * is `awaiting_assets` — honestly reported, never faked with placeholder art.
 * An unknown id is `undefined`.
 */
export function characterAvailability(
  characterId: string | null | undefined,
): CharacterAvailability | undefined {
  const character = CHARACTER_CATALOGUE.find((candidate) => candidate.id === characterId);
  if (!character) return undefined;
  return hasCharacterArtwork(character.id) ? 'available' : 'awaiting_assets';
}

/**
 * The equipment of one character, in slot order, for the avatar editor.
 *
 * Only this character's items are returned, so the editor can never offer
 * another character's equipment (Phase 5c §3.2).
 */
export function equipmentForCharacter(characterId: string): CosmeticItem[] {
  return EQUIPMENT_SLOTS.flatMap((slot) =>
    cosmeticsForCharacter(characterId).filter((item) => item.slot === slot),
  );
}

/** The stored avatar configuration: the equipped item id per slot. */
export interface AvatarEquipment {
  visor: string | null;
  outfit: string | null;
  backpack: string | null;
  neckAccessory: string | null;
  wristAccessory: string | null;
}

/** A full avatar configuration as returned by the API. */
export interface AvatarConfig {
  /** The chosen character, or `null` when the player has picked none yet. */
  characterId: string | null;
  /** The equipped item per slot (all `null` when nothing is equipped). */
  equipment: AvatarEquipment;
}

/** An empty equipment set (nothing equipped). */
export const EMPTY_EQUIPMENT: AvatarEquipment = {
  visor: null,
  outfit: null,
  backpack: null,
  neckAccessory: null,
  wristAccessory: null,
};

/** An empty avatar configuration (no character, nothing equipped). */
export const EMPTY_AVATAR_CONFIG: AvatarConfig = {
  characterId: null,
  equipment: { ...EMPTY_EQUIPMENT },
};

/**
 * The configuration a character **starts** with: the chosen character and
 * **nothing equipped**.
 *
 * Phase 6.8.4 binding rule: level 1 begins with the base character and no
 * unlockable equipment, and an unlocked item is never equipped automatically —
 * equipping happens only in the inventory. A character without artwork also
 * starts with nothing equipped (there is nothing to wear yet).
 */
export function defaultAvatarConfig(characterId: string): AvatarConfig {
  return { characterId, equipment: { ...EMPTY_EQUIPMENT } };
}

/**
 * Validate and normalise an avatar configuration against the catalogue.
 *
 * This is the server-side rule (Phase 6.7 §7). It is pure and total: it either
 * returns a normalised configuration or a list of issues. It enforces, in order:
 *
 *   1. the body is a JSON object;
 *   2. `characterId` is a known character **with artwork** (a name-only figure
 *      cannot be equipped);
 *   3. `equipment` is an object whose keys are all real slots and whose values are
 *      all real items **belonging to that character and matching that slot**;
 *   4. no unknown field is smuggled in.
 *
 * A manipulated payload can therefore never equip another character's item: an
 * Ethan visor on Maya fails rule 3, because the item's `characterId` is `ethan`.
 */
export function validateAvatarConfig(body: unknown): {
  config?: AvatarConfig;
  issues: ValidationIssue[];
} {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { issues: [{ path: '', message: 'A JSON object is required.' }] };
  }
  const record = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  for (const key of Object.keys(record)) {
    if (key !== 'characterId' && key !== 'equipment') {
      issues.push({ path: key, message: 'This field cannot be changed.' });
    }
  }

  const characterId = record.characterId;
  if (typeof characterId !== 'string' || characterId.trim().length === 0) {
    issues.push({ path: 'characterId', message: 'A character id is required.' });
    return { issues };
  }
  const assets = findCharacterAssets(characterId);
  if (!assets) {
    issues.push({
      path: 'characterId',
      message: `"${characterId}" is not a character with available artwork.`,
    });
    return { issues };
  }

  const equipmentRaw = record.equipment;
  if (equipmentRaw === undefined) {
    // No equipment supplied: fall back to the character's default equipment —
    // but only if nothing else was wrong (a smuggled extra field must still
    // fail, not be quietly accepted alongside a default kit).
    if (issues.length > 0) return { issues };
    return { config: defaultAvatarConfig(characterId), issues };
  }
  if (equipmentRaw === null || typeof equipmentRaw !== 'object' || Array.isArray(equipmentRaw)) {
    issues.push({ path: 'equipment', message: 'Must be an object.' });
    return { issues };
  }

  const equipmentRecord = equipmentRaw as Record<string, unknown>;
  const equipment: AvatarEquipment = { ...EMPTY_EQUIPMENT };

  for (const key of Object.keys(equipmentRecord)) {
    if (!isEquipmentSlot(key)) {
      issues.push({ path: `equipment.${key}`, message: 'Unknown equipment slot.' });
      continue;
    }
    const value = equipmentRecord[key];
    if (value === null) {
      equipment[key] = null;
      continue;
    }
    if (typeof value !== 'string') {
      issues.push({ path: `equipment.${key}`, message: 'Must be an item id or null.' });
      continue;
    }
    const item = findCosmetic(value);
    if (!item) {
      issues.push({ path: `equipment.${key}`, message: `Unknown item "${value}".` });
      continue;
    }
    if (item.slot !== key) {
      issues.push({
        path: `equipment.${key}`,
        message: `"${value}" is not a ${key} item.`,
      });
      continue;
    }
    if (item.characterId !== characterId) {
      issues.push({
        path: `equipment.${key}`,
        message: `"${value}" belongs to ${item.characterId}, not ${characterId}.`,
      });
      continue;
    }
    equipment[key] = value;
  }

  if (issues.length > 0) return { issues };
  return { config: { characterId, equipment }, issues };
}
