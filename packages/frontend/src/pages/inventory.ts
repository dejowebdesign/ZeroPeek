/**
 * Inventory surface (Phase 6.8, de-duplicated Phase 6.8.3, equip/unequip
 * Phase 6.8.4).
 *
 * A standalone page (inventory.html) for a **signed-in** account. It is the
 * central surface for the player's **items**: the active character's items (owned
 * and locked alike), the item equipped in each of the five slots, and the
 * equip/unequip management. It deliberately does not repeat the level/XP and
 * achievement figures — those live on the profile page (Phase 6.8.3/6.8.4), so
 * the two surfaces are distinct rather than two copies of the same cards.
 *
 * Everything is server-authoritative. The page reads `GET /api/inventory`,
 * equips through `POST /api/inventory/equip` and unequips through
 * `POST /api/inventory/unequip`; it never computes an unlock or decides ownership
 * itself. A locked item is shown with the server's own unlock level/hint, never an
 * invented condition, and its equip control is absent.
 *
 * It reuses the existing design system (`appShell`, `card`, `emptyState`,
 * `chip`, `avatarPreview`), so it inherits the dark glassmorphism look with no
 * new styling rules.
 */

import type {
  AvatarConfig,
  AvatarEquipment,
  EquipmentSlot,
  InventoryItemView,
  InventoryView,
} from '@zeropeek/shared';
import { EQUIPMENT_SLOTS, findCharacter } from '@zeropeek/shared';

import { ApiError, get, post, setCsrfToken } from '../api.js';
import { el, render } from '../dom.js';
import { appShell } from '../navigation.js';
import { SLOT_LABELS, avatarPreview, itemThumb } from '../avatar.js';
import {
  button,
  chip,
  emptyState,
  errorText,
  field,
  notice,
  setBusy,
  skeleton,
  toast,
} from '../ui.js';

interface PlayerMeResponse {
  user: { id: string; username: string; role: string } | null;
  csrfToken?: string;
}

const appElement = document.getElementById('app');
if (!appElement) throw new Error('ZeroPeek: the #app element is missing.');
const app: HTMLElement = appElement;

/** The player shell with the inventory entry marked active. */
function shell(children: Node[], actions: Node[] = []): HTMLElement {
  return appShell({
    role: 'player',
    active: 'inventory',
    title: 'Inventory',
    actions: [
      ...actions,
      el('a', { class: 'btn btn-secondary btn-sm', href: './profile.html' }, 'Profile'),
    ],
    children,
  });
}

/** A centred status screen (loading, error, sign-in needed). */
function statusScreen(node: HTMLElement): HTMLElement {
  return shell([el('section', { class: 'centered' }, el('div', { class: 'card' }, node))]);
}

/** The avatar configuration implied by the inventory's equipped items. */
function configFromItems(view: InventoryView): AvatarConfig | null {
  if (!view.characterId) return null;
  const equipment: AvatarEquipment = {
    visor: null,
    outfit: null,
    backpack: null,
    neckAccessory: null,
    wristAccessory: null,
  };
  for (const row of view.items) {
    if (row.equipped) equipment[row.item.slot as EquipmentSlot] = row.item.id;
  }
  return { characterId: view.characterId, equipment };
}

/** The number of the five slots that currently hold an item. */
function equippedCount(view: InventoryView): number {
  return view.items.filter((row) => row.equipped).length;
}

/** The item the active character currently wears in one slot, or `null`. */
function equippedInSlot(view: InventoryView, slot: EquipmentSlot): InventoryItemView | null {
  return view.items.find((row) => row.equipped && row.item.slot === slot) ?? null;
}

/**
 * The "what you are wearing" card: the character figure plus the five slots.
 *
 * Each slot names the item worn or states plainly that it is empty, and a filled
 * slot offers an **Unequip** control (Phase 6.8.4). This is the inventory's own
 * view of the loadout — the equipment half of the progress — kept apart from the
 * profile, which shows the character choice and the statistics.
 */
function loadoutSection(
  view: InventoryView,
  characterName: string,
  onUnequip: (slot: EquipmentSlot) => Promise<void>,
): HTMLElement {
  const config = configFromItems(view);
  if (!config) {
    return el(
      'section',
      { class: 'card' },
      el('h3', { class: 'profile__section-title' }, 'Equipped'),
      emptyState(
        'Nothing equipped yet',
        'Choose a character on your profile first. Each character owns its own items.',
      ),
    );
  }

  const preview = avatarPreview(config);
  const slots = el(
    'ul',
    { class: 'avatar__loadout' },
    ...EQUIPMENT_SLOTS.map((slot) => {
      const worn = equippedInSlot(view, slot);
      const value = worn
        ? el(
            'span',
            { class: 'avatar__loadout-value' },
            itemThumb(worn.item.id),
            el('span', { class: 'avatar__loadout-name' }, worn.item.name),
          )
        : el(
            'span',
            { class: 'avatar__loadout-value' },
            el('span', { class: 'avatar__loadout-empty muted' }, 'Nothing equipped'),
          );
      return el(
        'li',
        { class: 'avatar__loadout-row' },
        el('span', { class: 'avatar__loadout-slot' }, SLOT_LABELS[slot]),
        value,
        worn
          ? el(
              'span',
              { class: 'avatar__loadout-action' },
              button('Unequip', {
                variant: 'secondary',
                small: true,
                onClick: () => void onUnequip(slot),
              }),
            )
          : null,
      );
    }),
  );

  return el(
    'section',
    { class: 'card' },
    el('h3', { class: 'profile__section-title' }, `Equipped on ${characterName}`),
    el(
      'p',
      { class: 'muted profile__hint' },
      `${equippedCount(view)} of ${EQUIPMENT_SLOTS.length} slots filled.`,
    ),
    preview,
    slots,
  );
}

/**
 * One inventory item: thumbnail, name, state and an equip control when owned.
 *
 * An owned item offers **Equip**; the item already worn offers **Unequip**
 * instead, so a slot can be cleared from either the item list or the loadout.
 * A locked item offers neither.
 */
function itemRow(
  item: InventoryItemView,
  onEquip: (itemId: string) => Promise<void>,
  onUnequip: (slot: EquipmentSlot) => Promise<void>,
): HTMLElement {
  const thumb = itemThumb(item.item.id);
  const slot = item.item.slot as EquipmentSlot;
  const control = !item.owned
    ? null
    : item.equipped
      ? button('Unequip', {
          variant: 'secondary',
          small: true,
          onClick: () => void onUnequip(slot),
        })
      : button('Equip', {
          variant: 'primary',
          small: true,
          onClick: () => void onEquip(item.item.id),
        });

  return el(
    'li',
    { class: `inventory__item${item.owned ? '' : ' inventory__item--locked'}` },
    el(
      'div',
      { class: 'inventory__thumb' },
      thumb ?? el('span', { class: 'inventory__thumb-empty', 'aria-hidden': 'true' }, '▦'),
    ),
    el(
      'div',
      { class: 'inventory__meta' },
      el('span', { class: 'inventory__name' }, item.item.name),
      el('span', { class: 'muted inventory__slot' }, SLOT_LABELS[slot]),
      el(
        'span',
        { class: 'inventory__state' },
        item.owned
          ? chip(item.equipped ? 'Equipped' : 'Owned', item.equipped ? 'ok' : 'cyan')
          : chip('Locked', 'muted'),
        item.unlockHint ? el('span', { class: 'muted inventory__hint' }, item.unlockHint) : null,
      ),
    ),
    control ? el('div', { class: 'inventory__action' }, control) : null,
  );
}

/** The items card, grouped under the active character's name. */
function itemsSection(
  view: InventoryView,
  characterName: string,
  onEquip: (itemId: string) => Promise<void>,
  onUnequip: (slot: EquipmentSlot) => Promise<void>,
): HTMLElement {
  if (!view.characterId || view.items.length === 0) {
    return el(
      'section',
      { class: 'card' },
      el('h3', { class: 'profile__section-title' }, 'Items'),
      emptyState(
        'No items yet',
        'Choose a character on your profile first. Each character owns its own items.',
      ),
    );
  }
  return el(
    'section',
    { class: 'card' },
    el('h3', { class: 'profile__section-title' }, `Items for ${characterName}`),
    el(
      'ul',
      { class: 'inventory__list' },
      ...view.items.map((item) => itemRow(item, onEquip, onUnequip)),
    ),
  );
}

/** Render the full inventory. */
function showInventory(view: InventoryView): void {
  const character = findCharacter(view.characterId);
  const characterName = character ? character.name : (view.characterId ?? 'your character');

  const equip = async (itemId: string): Promise<void> => {
    try {
      await post<AvatarConfig>('/api/inventory/equip', { itemId });
      toast('Item equipped.', 'success');
      // Reload so the stored equipment is what the page reflects.
      await load();
    } catch (error) {
      toast(errorText(error), 'error');
    }
  };

  const unequip = async (slot: EquipmentSlot): Promise<void> => {
    try {
      await post<AvatarConfig>('/api/inventory/unequip', { slot });
      toast('Item unequipped.', 'success');
      await load();
    } catch (error) {
      toast(errorText(error), 'error');
    }
  };

  render(
    app,
    shell([
      el(
        'section',
        { class: 'profile' },
        el(
          'div',
          { class: 'profile__head' },
          el(
            'div',
            { class: 'profile__identity' },
            el('h2', { class: 'profile__name' }, 'Your inventory'),
            el(
              'div',
              { class: 'profile__chips' },
              view.characterId
                ? chip(`Character: ${characterName}`, 'accent')
                : chip('No character chosen', 'muted'),
            ),
          ),
        ),
      ),
      loadoutSection(view, characterName, unequip),
      itemsSection(view, characterName, equip, unequip),
    ]),
  );
}

/** The player sign-in form, shown when no player session is present. */
function renderSignIn(): void {
  const username = el('input', { class: 'input', autocomplete: 'username' });
  const password = el('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'current-password',
  });
  const feedback = el('div');
  const submit = button('Sign in', { variant: 'primary', type: 'submit' });

  const form = el(
    'form',
    {
      class: 'auth__form',
      onsubmit: async (event: Event) => {
        event.preventDefault();
        feedback.replaceChildren();
        setBusy(submit, true);
        try {
          const result = await post<{ csrfToken?: string }>('/api/player-auth/login', {
            username: username.value.trim(),
            password: password.value,
          });
          if (result.csrfToken) setCsrfToken(result.csrfToken);
          await load();
        } catch (error) {
          feedback.replaceChildren(notice(errorText(error), 'error'));
        } finally {
          setBusy(submit, false);
        }
      },
    },
    field('Username', username),
    field('Password', password),
    feedback,
    el('div', { class: 'auth__actions' }, submit),
  );

  render(
    app,
    statusScreen(
      el(
        'div',
        { class: 'profile__signin' },
        el('h2', { class: 'profile__section-title' }, 'Player sign-in'),
        el(
          'p',
          { class: 'muted' },
          'Sign in with your player account to see your inventory and progress.',
        ),
        form,
      ),
    ),
  );
  username.focus();
}

/** Load and render the inventory, or a sign-in / error screen. */
async function load(): Promise<void> {
  try {
    const view = await get<InventoryView>('/api/inventory');
    showInventory(view);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      renderSignIn();
      return;
    }
    render(app, statusScreen(notice(errorText(error), 'error')));
  }
}

/** Boot: require a **player** session, then load the inventory. */
async function boot(): Promise<void> {
  render(app, statusScreen(skeleton('card')));

  let me: PlayerMeResponse;
  try {
    me = await get<PlayerMeResponse>('/api/player-auth/me');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      renderSignIn();
      return;
    }
    render(app, statusScreen(notice(errorText(error), 'error')));
    return;
  }

  if (!me.user) {
    renderSignIn();
    return;
  }

  if (me.csrfToken) setCsrfToken(me.csrfToken);
  await load();
}

void boot();
