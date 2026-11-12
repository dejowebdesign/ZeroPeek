/**
 * Avatar rendering helpers (Phase 6.7).
 *
 * The Blockwelt-Helden avatar is built from the artwork the project owner
 * supplied for **Ethan** and **Maya**: one full preview, one base figure and five
 * equipment images per character, copied verbatim into
 * `packages/frontend/public/characters/<id>/`.
 *
 * **Why the preview is not a composited stack.** The supplied equipment images
 * are individually correct but **not aligned** to a shared canvas — the owner's
 * metadata reports every layer's position as `not_defined`/`not_validated`, and
 * the shared catalogue therefore marks each item `alignment: 'not_aligned'`. To
 * avoid inventing coordinates (phase brief §16 forbids guessing), the preview
 * shows the character's own supplied preview/base figure, and the equipped items
 * as their own labelled thumbnails beside it. When the aligned layer set arrives,
 * only this module changes: the catalogue gains `layerGeometry` and the figure
 * becomes a real stacked composition.
 *
 * Everything here is CSP-safe: images are `<img src>` from `public/`, text goes
 * through `textContent`, and no markup is built from a string.
 */

import {
  EQUIPMENT_SLOTS,
  cosmeticsForSlot,
  findCharacterAssets,
  findCosmetic,
  type AvatarConfig,
  type AvatarEquipment,
  type EquipmentSlot,
} from '@zeropeek/shared';

import { el } from './dom.js';

/** Human labels for the five equipment slots. */
export const SLOT_LABELS: Record<EquipmentSlot, string> = {
  backpack: 'Backpack',
  outfit: 'Outfit',
  neckAccessory: 'Neck accessory',
  visor: 'Visor',
  wristAccessory: 'Wrist accessory',
};

/** The character's supplied full-figure preview image, or `null` without artwork. */
export function characterPreviewImage(
  characterId: string | null | undefined,
): HTMLImageElement | null {
  const assets = findCharacterAssets(characterId);
  if (!assets) return null;
  return el('img', {
    class: 'avatar__figure',
    src: assets.previewPath,
    alt: `${assets.name} preview`,
    loading: 'lazy',
    decoding: 'async',
  });
}

/** The character's supplied base figure image, or `null` without artwork. */
export function characterBaseImage(
  characterId: string | null | undefined,
): HTMLImageElement | null {
  const assets = findCharacterAssets(characterId);
  if (!assets) return null;
  return el('img', {
    class: 'avatar__base',
    src: assets.basePath,
    alt: `${assets.name} figure`,
    loading: 'lazy',
    decoding: 'async',
  });
}

/** A small thumbnail of one equipment item. */
export function itemThumb(itemId: string | null): HTMLElement | null {
  const item = findCosmetic(itemId);
  if (!item) return null;
  return el('img', {
    class: 'avatar__thumb',
    src: item.assetPath,
    alt: item.name,
    title: item.name,
    loading: 'lazy',
    decoding: 'async',
  });
}

/**
 * A compact avatar badge for a player in a list — lobby roster, leaderboard,
 * beamer podium and the player's own round header (Phase 6.8.3, head crop
 * Phase 6.8.4).
 *
 * `avatarId` is the character id the **server** resolved for the seat
 * (`PublicPlayer.avatar`), never a client guess. When it names a character with
 * supplied artwork (Ethan/Maya) the real base figure is drawn from
 * `public/characters/`; otherwise a clean initial badge of the nickname is
 * shown. There is deliberately **no** invented image path and **no** empty
 * frame: an unknown or missing id always falls back to the letter badge, so a
 * guest or a character awaiting artwork still gets a tidy, legible mark.
 *
 * `crop` selects the visible slice of the supplied figure (Phase 6.8.4 §5):
 * `'head'` (the default) shows only the head, framed by CSS `object-fit: cover`
 * with a top anchor, for the in-game surfaces; `'full'` shows the whole figure,
 * for the winner podium. No image is generated or edited — only the existing
 * file is framed.
 *
 * The badge is decorative: the nickname sits next to it, so it is hidden from
 * assistive technology to avoid repeating the name.
 */
export function playerAvatar(
  nickname: string,
  avatarId?: string | null,
  options: { size?: 'sm' | 'md' | 'lg'; crop?: 'head' | 'full' } = {},
): HTMLElement {
  const assets = findCharacterAssets(avatarId);
  const size = options.size ?? 'md';
  const crop = options.crop ?? 'head';
  const frame = el('span', {
    class: `player-avatar player-avatar--${size} player-avatar--${crop}${assets ? ' player-avatar--art' : ''}`,
    'aria-hidden': 'true',
  });
  if (assets) {
    frame.append(
      el('img', {
        class: 'player-avatar__img',
        src: assets.basePath,
        alt: '',
        loading: 'lazy',
        decoding: 'async',
      }),
    );
  } else {
    const initial = nickname.trim().charAt(0).toUpperCase() || '?';
    frame.append(el('span', { class: 'player-avatar__initial' }, initial));
  }
  return frame;
}

/**
 * The compact "player display" used during a round: head portrait, nickname and
 * — for a signed-in player with progress — the real level and XP (Phase 6.8.4
 * §5). Values come from the caller (the server's own figures); this builder never
 * invents a level or an XP number.
 */
export function playerBadge(
  nickname: string,
  avatarId: string | null | undefined,
  progress: { level: number; xp: number } | null,
  options: { size?: 'sm' | 'md' | 'lg' } = {},
): HTMLElement {
  return el(
    'div',
    { class: 'player-badge' },
    playerAvatar(nickname, avatarId, { size: options.size ?? 'md' }),
    el(
      'div',
      { class: 'player-badge__body' },
      el('span', { class: 'player-badge__name' }, nickname),
      progress
        ? el(
            'span',
            { class: 'player-badge__meta muted' },
            `Level ${progress.level} · ${progress.xp} XP`,
          )
        : null,
    ),
  );
}

/** One "slot: item" row for the loadout list. */
function loadoutRow(slot: EquipmentSlot, itemId: string | null): HTMLElement {
  const item = findCosmetic(itemId);
  const thumb = itemThumb(itemId);
  return el(
    'div',
    { class: 'avatar__loadout-row' },
    el('span', { class: 'avatar__loadout-slot' }, SLOT_LABELS[slot]),
    el(
      'span',
      { class: 'avatar__loadout-value' },
      thumb ?? el('span', { class: 'avatar__loadout-empty muted' }, 'Nothing equipped'),
      item ? el('span', { class: 'avatar__loadout-name' }, item.name) : null,
    ),
  );
}

/**
 * The avatar preview: the character figure plus the equipped loadout.
 *
 * Returns `null` for a character without artwork, so callers show a name-only
 * state instead of an empty frame.
 */
export function avatarPreview(config: AvatarConfig): HTMLElement | null {
  const assets = findCharacterAssets(config.characterId);
  if (!assets) return null;

  const rows = EQUIPMENT_SLOTS.map((slot) => loadoutRow(slot, config.equipment[slot]));

  return el(
    'div',
    { class: 'avatar__preview' },
    el(
      'div',
      { class: 'avatar__figure-frame' },
      characterPreviewImage(config.characterId) ?? characterBaseImage(config.characterId),
    ),
    el('div', { class: 'avatar__loadout' }, ...rows),
  );
}

/** The equipment a character owns for one slot (0 or 1 item today). */
export function slotItems(characterId: string, slot: EquipmentSlot) {
  return cosmeticsForSlot(characterId, slot);
}

/** Every slot the character has at least one item for, in render order. */
export function availableSlots(characterId: string): EquipmentSlot[] {
  return EQUIPMENT_SLOTS.filter((slot) => slotItems(characterId, slot).length > 0);
}

/** A copy of an equipment set with one slot replaced. */
export function withSlot(
  equipment: AvatarEquipment,
  slot: EquipmentSlot,
  itemId: string | null,
): AvatarEquipment {
  return { ...equipment, [slot]: itemId };
}
