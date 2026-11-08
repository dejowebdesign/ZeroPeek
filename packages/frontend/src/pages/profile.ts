/**
 * Player profile surface (Phase 6.6).
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
 */

import type { ProfileStats, ProfileView } from '@zeropeek/shared';

import { ApiError, get, setCsrfToken } from '../api.js';
import { el, render } from '../dom.js';
import { appShell } from '../navigation.js';
import { button, chip, emptyState, errorText, notice, skeleton, statTile } from '../ui.js';

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

/** The profile headline: name and the chosen character. */
function headline(view: ProfileView): HTMLElement {
  const character = view.profile.selectedCharacterId;
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
        // The visual character picker arrives with the avatar system (Phase 6.7).
        // Until then the chosen id is shown as text, never a fabricated portrait.
        character
          ? chip(`Character: ${character}`, 'accent')
          : chip('No character chosen', 'muted'),
      ),
    ),
  );
}

/** A human label for the account role. */
function roleLabel(role: string): string {
  if (role === 'ADMIN') return 'Administrator';
  if (role === 'TRAINER') return 'Host';
  return 'Player';
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

/** Render the full profile. */
function showProfile(view: ProfileView): void {
  render(
    app,
    shell([el('section', { class: 'profile' }, headline(view), statsSection(view.stats))]),
  );
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

void boot();
