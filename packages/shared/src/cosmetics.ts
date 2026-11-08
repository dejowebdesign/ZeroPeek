/**
 * Cosmetics catalogue (Phase 6.7) – the character-exclusive equipment items.
 *
 * **Binding product rule (Phase 5c, `game-design-concept.md` §3.2):** every
 * character owns its *own* items. There is deliberately **no** universal
 * catalogue whose entries can be worn by any figure. An item therefore carries
 * the `characterId` it belongs to, and the server only ever accepts an item on
 * the character it was made for.
 *
 * The catalogue is **code**, not database rows: it is the single source of truth
 * for what exists and is versioned with the application, so a client can never
 * invent an item. The database stores only *which* of these items a player wears
 * (`PlayerProfile.avatarConfig`).
 *
 * Only the assets actually supplied by the project owner are listed here — the
 * seven WebP files per character for **Ethan** and **Maya**. Nothing is invented
 * and no image is generated: each entry points at a real file copied from the
 * owner's ZIP under `packages/frontend/public/characters/<id>/`.
 *
 * **Layer geometry is deliberately absent.** The supplied single-item graphics
 * are not yet pixel-aligned to a shared avatar canvas, so no coordinate, scale,
 * anchor or z-order is fabricated. `layerGeometry` is reserved for the day the
 * aligned assets exist (see `LayerGeometry` and `AssetAlignment`); until then
 * every item reports `alignment: 'not_aligned'` and the UI shows the item as its
 * own thumbnail, never as a composed layer on the figure.
 */

/** The five equipment slots a Blockwelt-Helden avatar has (Phase 6.7). */
export type EquipmentSlot = 'visor' | 'outfit' | 'backpack' | 'neckAccessory' | 'wristAccessory';

/**
 * The slots in the fixed render order used by the (future) layered avatar.
 *
 * This is the intended painting order (back to front) once the aligned layer
 * assets exist: the backpack sits behind the figure, the outfit on the body, the
 * neck accessory over the chest, the visor on the face and the wrist accessory
 * last. The order is declared now so a later renderer needs no change here, but
 * **no geometry is implied** by it.
 */
export const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = [
  'backpack',
  'outfit',
  'neckAccessory',
  'visor',
  'wristAccessory',
];

/** Whether a slot value is one of the known slots. */
export function isEquipmentSlot(value: unknown): value is EquipmentSlot {
  return typeof value === 'string' && (EQUIPMENT_SLOTS as readonly string[]).includes(value);
}

/**
 * How far an item's artwork has been aligned to a shared avatar canvas.
 *
 * `not_aligned` is the honest current state: the owner's ZIP ships correctly
 * cropped single-item graphics but **no** shared canvas size, anchor point,
 * scale or z-order, so the item cannot yet be stacked on the figure without
 * inventing coordinates. `aligned` becomes usable only when the owner supplies
 * the aligned layer set. The renderer must not treat `not_aligned` items as
 * placeable layers.
 */
export type AssetAlignment = 'not_aligned' | 'aligned';

/**
 * Geometry needed to place one layer on the avatar canvas (Phase 6.7 §10).
 *
 * **Reserved and never populated in the productive catalogue today.** Every
 * field here is meaningless until the owner delivers the aligned layer set; a
 * fabricated value would produce a figure with equipment sitting in the wrong
 * place, which is exactly the failure the phase brief forbids. When the aligned
 * assets arrive, each item gains a `layerGeometry` and `alignment: 'aligned'`.
 */
export interface LayerGeometry {
  /** Shared canvas width in pixels (same for every layer of a character). */
  canvasWidth: number;
  /** Shared canvas height in pixels. */
  canvasHeight: number;
  /** Layer offset from the canvas origin, in pixels. */
  x: number;
  y: number;
  /** Uniform scale applied to the layer. */
  scale: number;
  /** Named anchor the layer was aligned to (e.g. `feet`). */
  anchor: string;
  /** Painting order; higher draws on top. */
  zOrder: number;
}

/** Availability of an item to the player (unlock state). */
export type UnlockStatus =
  /** Equippable now — the default equipment shipped with the character. */
  | 'available'
  /** Reserved for the Phase 6.8 inventory/unlock system. No item uses it yet. */
  | 'locked';

/**
 * One character-exclusive cosmetic item.
 *
 * Every field is derived from the owner's supplied asset package
 * (`metadata/<id>.json`) or from the phase brief — none is invented.
 */
export interface CosmeticItem {
  /** Stable, unique id stored in `PlayerProfile.avatarConfig`. */
  id: string;
  /** Display name shown in the avatar editor. */
  name: string;
  /** A short, plain description for the editor. */
  description: string;
  /** The character this item belongs to; it can never be worn by another. */
  characterId: string;
  /** The slot the item occupies. */
  slot: EquipmentSlot;
  /** Public URL of the item's own artwork (served from the frontend `public/`). */
  assetPath: string;
  /** Unlock state. Phase 6.7 ships only `available` default equipment. */
  unlockStatus: UnlockStatus;
  /** How far the artwork is aligned to the avatar canvas (see `AssetAlignment`). */
  alignment: AssetAlignment;
  /** Reserved alignment geometry; absent until the aligned layer set exists. */
  layerGeometry?: LayerGeometry;
}

/**
 * The supplied Ethan equipment (owner ZIP, `Characters/Ethan/Equipment`).
 *
 * Names follow the phase brief §4; the asset paths point at the files copied
 * verbatim into `packages/frontend/public/characters/ethan/`.
 */
const ETHAN_ITEMS: readonly CosmeticItem[] = [
  {
    id: 'ethan_visor',
    name: 'Cyber Visor',
    description: 'A tech visor over the eyes.',
    characterId: 'ethan',
    slot: 'visor',
    assetPath: '/characters/ethan/visor_cyber.webp',
    unlockStatus: 'available',
    alignment: 'not_aligned',
  },
  {
    id: 'ethan_outfit',
    name: 'Standard Outfit',
    description: 'Ethan’s standard builder outfit.',
    characterId: 'ethan',
    slot: 'outfit',
    assetPath: '/characters/ethan/outfit_standard.webp',
    unlockStatus: 'available',
    alignment: 'not_aligned',
  },
  {
    id: 'ethan_backpack',
    name: 'Tech Backpack',
    description: 'A technical backpack.',
    characterId: 'ethan',
    slot: 'backpack',
    assetPath: '/characters/ethan/backpack_tech.webp',
    unlockStatus: 'available',
    alignment: 'not_aligned',
  },
  {
    id: 'ethan_compass',
    name: 'Compass Pendant',
    description: 'A compass worn on a pendant.',
    characterId: 'ethan',
    slot: 'neckAccessory',
    assetPath: '/characters/ethan/compass_pendant.webp',
    unlockStatus: 'available',
    alignment: 'not_aligned',
  },
  {
    id: 'ethan_wristband',
    name: 'Tech Wristband',
    description: 'A technical wristband.',
    characterId: 'ethan',
    slot: 'wristAccessory',
    assetPath: '/characters/ethan/wristband_tech.webp',
    unlockStatus: 'available',
    alignment: 'not_aligned',
  },
];

/** The supplied Maya equipment (owner ZIP, `Characters/Maya/Equipment`). */
const MAYA_ITEMS: readonly CosmeticItem[] = [
  {
    id: 'maya_visor',
    name: 'Cyber Visor & Headset',
    description: 'A tech visor combined with a headset.',
    characterId: 'maya',
    slot: 'visor',
    assetPath: '/characters/maya/visor_headset_cyber.webp',
    unlockStatus: 'available',
    alignment: 'not_aligned',
  },
  {
    id: 'maya_outfit',
    name: 'Standard Outfit',
    description: 'Maya’s standard builder outfit.',
    characterId: 'maya',
    slot: 'outfit',
    assetPath: '/characters/maya/outfit_standard.webp',
    unlockStatus: 'available',
    alignment: 'not_aligned',
  },
  {
    id: 'maya_backpack',
    name: 'Tech Backpack',
    description: 'A technical backpack.',
    characterId: 'maya',
    slot: 'backpack',
    assetPath: '/characters/maya/backpack_tech.webp',
    unlockStatus: 'available',
    alignment: 'not_aligned',
  },
  {
    id: 'maya_compass',
    name: 'Compass Pendant',
    description: 'A compass worn on a pendant.',
    characterId: 'maya',
    slot: 'neckAccessory',
    assetPath: '/characters/maya/compass_pendant.webp',
    unlockStatus: 'available',
    alignment: 'not_aligned',
  },
  {
    id: 'maya_wristband',
    name: 'Tech Wristband',
    description: 'A technical wristband.',
    characterId: 'maya',
    slot: 'wristAccessory',
    assetPath: '/characters/maya/wristband_tech.webp',
    unlockStatus: 'available',
    alignment: 'not_aligned',
  },
];

/**
 * Every cosmetic item that exists, in a fixed order (Ethan, then Maya).
 *
 * The list is flat and small on purpose: lookups are by id or by character, and
 * the character-exclusivity rule is enforced from each item's `characterId`.
 */
export const COSMETIC_CATALOGUE: readonly CosmeticItem[] = [...ETHAN_ITEMS, ...MAYA_ITEMS];

/** Look an item up by its id, or `undefined` when it does not exist. */
export function findCosmetic(id: string | null | undefined): CosmeticItem | undefined {
  if (!id) return undefined;
  return COSMETIC_CATALOGUE.find((item) => item.id === id);
}

/** Every item that belongs to one character, in catalogue order. */
export function cosmeticsForCharacter(characterId: string): CosmeticItem[] {
  return COSMETIC_CATALOGUE.filter((item) => item.characterId === characterId);
}

/** The items of one character that fit a given slot (0 or 1 today). */
export function cosmeticsForSlot(characterId: string, slot: EquipmentSlot): CosmeticItem[] {
  return cosmeticsForCharacter(characterId).filter((item) => item.slot === slot);
}

/**
 * Whether an item may be worn by a character.
 *
 * The one rule that matters: an item is compatible **only** with the character
 * it belongs to. There is no cross-character sharing, so an Ethan visor is never
 * compatible with Maya. An unknown id is never compatible.
 */
export function isCosmeticCompatible(itemId: string, characterId: string): boolean {
  const item = findCosmetic(itemId);
  return item !== undefined && item.characterId === characterId;
}
