/**
 * Player profile surface (Phase 6.6, character picker Phase 6.6.2).
 *
 * A standalone page (profile.html) for a **signed-in** account. It shows the
 * account its own display name and personal statistics, all computed on the
 * server: won games, podiums and accuracy. Nothing here is a quiz history — the
 * history (old questions, answers, other players' results) stays admin-only, and
 * this page has no endpoint that could return it.
 *
 * The page never invents a value. When a figure is not yet available it shows an
 * honest empty state, never a placeholder number. It is a client of the existing
 * design system (`appShell`, `card`, `statTile`, `emptyState`), so it inherits the
 * dark glassmorphism look without new styling rules.
 *
 * The character picker offers the ids from the shared catalogue and saves through
 * the existing `PUT /api/profile` — no new endpoint, no new field, and no
 * artwork: until the character files are supplied an entry is a name and a
 * tagline, never a drawn or generated figure.
 */

import type { Character, ProfileStats, ProfileView } from '@zeropeek/shared';
import { CHARACTER_CATALOGUE, findCharacter } from '@zeropeek/shared';

import { ApiError, get, put, setCsrfToken } from '../api.js';
import { el, render } from '../dom.js';
import { appShell } from '../navigation.js';
import {
  button,
  chip,
  emptyState,
  errorText,
  notice,
  setBusy,
  skeleton,
  statTile,
  toast,
} from '../ui.js';

interface MeResponse {
  user: { id: string; username: string; role: string } | null;
  csrfToken?: string;
}

const appElement = document.getElementById('app');
if (!appElement) throw new Error('ZeroPeek: the #app element is missing.');
const app: HTMLElement = appElement;

/** Where a signed-out visitor is sent to sign in. */
const LOGIN_URL = './auth.html';
/** Where a signed-in player returns to (join a game). */
const HOME_URL = './';

/** A whole-number percentage, or an em dash when there is no accuracy yet. */
function accuracyText(stats: ProfileStats): string {
  if (stats.accuracy === null) return '—';
  return `${Math.round(stats.accuracy * 100)}%`;
}

/** The player shell with the profile entry marked active. */
function shell(children: Node[]): HTMLElement {
  return appShell({
    role: 'player',
    active: 'profile',
    title: 'Profile',
    actions: [el('a', { class: 'btn btn-secondary btn-sm', href: HOME_URL }, 'Back to the game')],
    children,
  });
}

/** A centred status screen (loading, error, sign-in needed). */
function statusScreen(node: HTMLElement): HTMLElement {
  return shell([el('section', { class: 'centered' }, el('div', { class: 'card' }, node))]);
}

/** A human label for the account role. */
function roleLabel(role: string): string {
  if (role === 'ADMIN') return 'Administrator';
  if (role === 'TRAINER') return 'Host';
  return 'Player';
}

/** The profile headline: name, role and the current character. */
function headline(view: ProfileView): HTMLElement {
  const character = findCharacter(view.profile.selectedCharacterId);
  const chosen = view.profile.selectedCharacterId;

  return el(
    'div',
    { class: 'profile__head' },
    el(
      'div',
      { class: 'profile__identity' },
      el('h2', { class: 'profile__name' }, view.user.username),
      el(
        'div',
        { class: 'profile__chips' },
        chip(roleLabel(view.user.role), 'cyan', true),
        // The visual character portrait arrives with the avatar system (Phase
        // 6.7). Until the artwork exists the chosen character is named, never a
        // fabricated image. An unknown id (stored before this list existed) is
        // shown as-is rather than hidden or silently changed.
        chosen
          ? chip(`Character: ${character ? character.name : chosen}`, 'accent')
          : chip('No character chosen', 'muted'),
      ),
    ),
  );
}

/** The personal-statistics tiles. */
function statsSection(stats: ProfileStats): HTMLElement {
  if (stats.gamesPlayed === 0) {
    return el(
      'section',
      { class: 'card' },
      el('h3', { class: 'profile__section-title' }, 'Your statistics'),
      emptyState(
        'No finished games yet',
        'Play a round to the end while signed in and your results will appear here.',
      ),
    );
  }

  return el(
    'section',
    { class: 'card' },
    el('h3', { class: 'profile__section-title' }, 'Your statistics'),
    el(
      'div',
      { class: 'grid grid--3 profile__stats' },
      statTile(String(stats.wins), 'Games won'),
      statTile(String(stats.podiums), 'Podium finishes'),
      statTile(accuracyText(stats), 'Accuracy'),
      statTile(String(stats.gamesPlayed), 'Games played'),
      statTile(String(stats.correctAnswers), 'Correct answers'),
      statTile(String(stats.answeredCount), 'Questions answered'),
    ),
    stats.accuracy === null
      ? el(
          'p',
          { class: 'muted profile__hint' },
          'Accuracy appears once you have answered a question.',
        )
      : null,
  );
}

/** One selectable character: a radio whose label carries the name and tagline. */
function characterOption(character: Character, selected: string | null): HTMLElement {
  const id = `character-${character.id}`;
  const input = el('input', {
    class: 'profile__radio',
    type: 'radio',
    name: 'selectedCharacterId',
    id,
    value: character.id,
    ...(character.id === selected ? { checked: true } : {}),
  });

  return el(
    'label',
    {
      class: `profile__option profile__option--${character.rarity}${
        character.id === selected ? ' profile__option--selected' : ''
      }`,
      for: id,
    },
    input,
    el(
      'span',
      { class: 'profile__option-body' },
      el('span', { class: 'profile__option-name' }, character.name),
      el('span', { class: 'profile__option-tagline muted' }, character.tagline),
    ),
  );
}

/**
 * The character picker.
 *
 * Saves through the existing `PUT /api/profile`. The radio selection is the
 * pending choice; the panel is only replaced after the server has accepted it,
 * so the visible selection always reflects what is actually stored. A failure is
 * shown in place and leaves the choice unchanged.
 */
function characterSection(view: ProfileView): HTMLElement {
  const stored = view.profile.selectedCharacterId;
  const panel = el('div', { class: 'profile__picker' });

  const save = button('Save character', { variant: 'primary', type: 'submit', disabled: true });
  const status = el('p', { class: 'profile__save-status', role: 'status' });

  const inCatalogue = CHARACTER_CATALOGUE.some((character) => character.id === stored);
  const inputs = CHARACTER_CATALOGUE.map((character) => ({
    character,
    input: null as HTMLInputElement | null,
  }));

  for (const entry of inputs) {
    const option = characterOption(entry.character, stored);
    entry.input = option.querySelector<HTMLInputElement>('input');
    panel.append(option);
  }

  /** The currently checked id, or the stored one when nothing is checked. */
  const checkedId = (): string | null =>
    panel.querySelector<HTMLInputElement>('input[name="selectedCharacterId"]:checked')?.value ??
    null;

  // Enable "Save" only when the pending choice differs from what is stored.
  const refreshSave = (): void => {
    save.disabled = checkedId() === stored;
    status.textContent = '';
    status.className = 'profile__save-status';
  };

  panel.addEventListener('change', () => {
    for (const entry of inputs) {
      entry.input
        ?.closest('.profile__option')
        ?.classList.toggle('profile__option--selected', entry.input.checked);
    }
    refreshSave();
  });

  const form = el(
    'form',
    {
      class: 'profile__form',
      novalidate: true,
      onsubmit: async (event: Event) => {
        event.preventDefault();
        const chosen = checkedId();
        if (!chosen || chosen === stored) return;

        setBusy(save, true);
        status.textContent = '';
        status.className = 'profile__save-status';
        try {
          await put<ProfileView>('/api/profile', { selectedCharacterId: chosen });
          toast('Character saved.', 'success');
          // Reload so the headline and the picker reflect the stored value, and
          // an unexpected server-side change can never leave the UI out of sync.
          await load();
        } catch (error) {
          status.className = 'profile__save-status profile__save-status--error';
          status.textContent = errorText(error);
          setBusy(save, false);
        }
      },
    },
    panel,
    inCatalogue
      ? null
      : el(
          'p',
          { class: 'muted profile__hint' },
          `“${stored}” is not one of the characters on offer. Choose one below to replace it.`,
        ),
    el('div', { class: 'profile__save' }, save, status),
  );

  return el(
    'section',
    { class: 'card' },
    el('h3', { class: 'profile__section-title' }, 'Your character'),
    el(
      'p',
      { class: 'muted profile__hint' },
      'Choose the Blockwelt-Helden figure you play as. Character artwork arrives later.',
    ),
    form,
  );
}

/** Render the full profile. */
function showProfile(view: ProfileView): void {
  render(
    app,
    shell([
      el('section', { class: 'profile' }, headline(view), statsSection(view.stats)),
      characterSection(view),
    ]),
  );
}

/** Load and render the profile, or a sign-in / error screen. */
async function load(): Promise<void> {
  try {
    const view = await get<ProfileView>('/api/profile');
    showProfile(view);
  } catch (error) {
    const message =
      error instanceof ApiError && error.status === 401
        ? 'Your session has expired. Please sign in again.'
        : errorText(error);
    render(app, statusScreen(notice(message, 'error')));
  }
}

/** Boot: require a session, then load the profile. */
async function boot(): Promise<void> {
  render(app, statusScreen(skeleton('card')));

  let me: MeResponse;
  try {
    me = await get<MeResponse>('/api/auth/me');
  } catch (error) {
    render(app, statusScreen(notice(errorText(error), 'error')));
    return;
  }

  if (!me.user) {
    render(
      app,
      statusScreen(
        el(
          'div',
          { class: 'profile__signin' },
          el('p', {}, 'Sign in to see your profile.'),
          el('a', { class: 'btn btn-primary', href: LOGIN_URL }, 'Sign in'),
        ),
      ),
    );
    return;
  }

  if (me.csrfToken) setCsrfToken(me.csrfToken);
  await load();
}

void boot();
