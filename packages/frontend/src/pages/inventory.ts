/**
 * Inventory surface (Phase 6.8).
 *
 * A standalone page (inventory.html) for a **signed-in** account. It shows the
 * account's level and XP, the items of its **currently chosen** character (owned
 * and locked alike) and its achievements.
 *
 * Everything is server-authoritative. The page reads `GET /api/inventory`,
 * `GET /api/progress` and `GET /api/achievements`, and equips through
 * `POST /api/inventory/equip`; it never computes a level, an XP total or an
 * unlock. A locked item is shown with the server's own unlock hint (an honest
 * "to be defined" while the reward matrix is unapproved), never an invented
 * condition, and its equip control is disabled.
 *
 * It reuses the existing design system (`appShell`, `card`, `progress`,
 * `emptyState`, `chip`), so it inherits the dark glassmorphism look with no new
 * styling rules beyond the achievement list.
 */

import type {
  AchievementView,
  AchievementsView,
  AvatarConfig,
  EquipmentSlot,
  InventoryItemView,
  InventoryView,
  ProgressView,
} from '@zeropeek/shared';
import { findCharacter } from '@zeropeek/shared';

import { ApiError, get, post, setCsrfToken } from '../api.js';
import { el, render } from '../dom.js';
import { appShell } from '../navigation.js';
import { SLOT_LABELS, itemThumb } from '../avatar.js';
import {
  button,
  chip,
  emptyState,
  errorText,
  field,
  notice,
  progress,
  setBusy,
  skeleton,
  statTile,
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

/** A `ratio` (0..1) as a whole-number percentage. */
function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** The level/XP summary card. */
function progressSection(view: ProgressView): HTMLElement {
  const { progress: bar } = view;
  return el(
    'section',
    { class: 'card' },
    el('h3', { class: 'profile__section-title' }, 'Progress'),
    el(
      'div',
      { class: 'profile__stats' },
      statTile(String(view.level), 'Level'),
      statTile(String(view.xp), 'Experience'),
      statTile(String(view.achievementsUnlocked), 'Achievements'),
      statTile(String(view.itemsOwned), 'Items'),
    ),
    progress(bar.xpIntoLevel, bar.xpIntoLevel + bar.xpToNextLevel, {
      label: `Level ${view.level}`,
      caption: `${bar.xpIntoLevel} / ${bar.xpIntoLevel + bar.xpToNextLevel} XP to level ${view.level + 1}`,
    }),
    el(
      'p',
      { class: 'muted profile__hint' },
      view.nextRewardLevel === null
        ? 'Rewards for levelling up are still being finalised, so no item is granted yet.'
        : `Next reward at level ${view.nextRewardLevel}.`,
    ),
  );
}

/** One inventory item: thumbnail, name, state and an equip control when owned. */
function itemRow(item: InventoryItemView, onEquip: (itemId: string) => Promise<void>): HTMLElement {
  const thumb = itemThumb(item.item.id);
  const equip = item.owned
    ? button(item.equipped ? 'Equipped' : 'Equip', {
        variant: item.equipped ? 'secondary' : 'primary',
        small: true,
        disabled: item.equipped,
        onClick: () => void onEquip(item.item.id),
      })
    : null;

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
      el('span', { class: 'muted inventory__slot' }, SLOT_LABELS[item.item.slot as EquipmentSlot]),
      el(
        'span',
        { class: 'inventory__state' },
        item.owned
          ? chip(item.equipped ? 'Equipped' : 'Owned', item.equipped ? 'ok' : 'cyan')
          : chip('Locked', 'muted'),
        item.unlockHint ? el('span', { class: 'muted inventory__hint' }, item.unlockHint) : null,
      ),
    ),
    equip ? el('div', { class: 'inventory__action' }, equip) : null,
  );
}

/** The items card, grouped under the active character's name. */
function itemsSection(
  view: InventoryView,
  characterName: string,
  onEquip: (itemId: string) => Promise<void>,
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
    el('ul', { class: 'inventory__list' }, ...view.items.map((item) => itemRow(item, onEquip))),
  );
}

/** One achievement row: name, description and progress toward the threshold. */
function achievementRow(view: AchievementView): HTMLElement {
  const { achievement } = view;
  return el(
    'li',
    { class: `achievement${view.earned ? ' achievement--earned' : ''}` },
    el(
      'div',
      { class: 'achievement__head' },
      el('span', { class: 'achievement__name' }, achievement.name),
      view.earned
        ? chip('Unlocked', 'ok', true)
        : chip(`${view.current} / ${view.threshold}`, 'muted'),
    ),
    el('p', { class: 'muted achievement__hint' }, achievement.description),
    view.earned
      ? null
      : progress(view.current, view.threshold, { label: 'Progress', caption: percent(view.ratio) }),
  );
}

/** The achievements card. */
function achievementsSection(view: AchievementsView): HTMLElement {
  return el(
    'section',
    { class: 'card' },
    el('h3', { class: 'profile__section-title' }, 'Achievements'),
    view.achievements.length === 0
      ? emptyState('No achievements yet', 'Achievements will appear here once they are defined.')
      : el(
          'ul',
          { class: 'achievements' },
          ...view.achievements.map((achievement) => achievementRow(achievement)),
        ),
  );
}

/** Render the full inventory. */
function showInventory(
  view: InventoryView,
  progress: ProgressView,
  achievements: AchievementsView,
): void {
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
      progressSection(progress),
      itemsSection(view, characterName, equip),
      achievementsSection(achievements),
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
    const [view, progress, achievements] = await Promise.all([
      get<InventoryView>('/api/inventory'),
      get<ProgressView>('/api/progress'),
      get<AchievementsView>('/api/achievements'),
    ]);
    showInventory(view, progress, achievements);
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
