/**
 * Pure builders for the player surface (Phase 6.2.2).
 *
 * Kept free of the socket and of the DOM root so they can be unit-tested, the
 * same way `showView.ts` serves the beamer. Everything here is presentation of
 * data the server already sends (`PublicPlayer`); nothing is invented, and the
 * play flow itself stays server-authoritative.
 */

import type { PlayerSync, PublicPlayer } from '@zeropeek/shared';

import { el } from './dom.js';
import { chip, emptyState } from './ui.js';

/** Which player screen a reconnect state maps to. */
export type PlayerScreen = 'lobby' | 'question' | 'reveal' | 'board' | 'end';

/**
 * Decide which screen a `PlayerSync` must render.
 *
 * This is the whole point of the reconnect fix: the screen follows the server's
 * authoritative phase, never a client guess, so a player can never fall back to
 * the lobby while the game runs. A `question` phase whose private result is
 * already present renders the reveal view, which covers a reconnect that arrives
 * in the same tick as the reveal (the event may already have passed the socket).
 */
export function screenForSync(sync: PlayerSync): PlayerScreen {
  if (sync.phase === 'lobby') return 'lobby';
  if (sync.phase === 'end') return 'end';
  if (sync.phase === 'board') return 'board';
  if (sync.phase === 'reveal') return 'reveal';
  // `question` (and any phase that carries an open question): the private result
  // is only set from the reveal onwards.
  if (sync.answer?.result) return 'reveal';
  return sync.question ? 'question' : 'lobby';
}

/** A short, human label for a player's connection state. */
export function connectionState(connected: boolean): { label: string; tone: 'ok' | 'muted' } {
  // The label carries the meaning; the chip's dot and colour only reinforce it,
  // so a status is never signalled by colour alone (design-concept §10).
  return connected ? { label: 'Connected', tone: 'ok' } : { label: 'Offline', tone: 'muted' };
}

/**
 * The waiting-room roster: every player the server has sent, in the order it
 * sent them, each with their connection state. `meId` marks the current player
 * so they can find themselves in the list.
 */
export function lobbyRoster(players: PublicPlayer[], meId?: string): HTMLElement {
  return el(
    'ul',
    { class: 'lobby__roster', 'aria-label': 'Players in this game' },
    ...players.map((player) => {
      const state = connectionState(player.connected);
      const isMe = player.id === meId;
      return el(
        'li',
        { class: `lobby__roster-row${isMe ? ' lobby__roster-row--me' : ''}` },
        el(
          'span',
          { class: 'lobby__roster-name' },
          player.nickname,
          isMe ? el('span', { class: 'lobby__roster-you muted' }, ' (you)') : null,
        ),
        chip(state.label, state.tone, true),
      );
    }),
  );
}

/**
 * The clearly-marked profile placeholder. A real profile needs an account
 * (Phase 6.3) and the profile model and API (Phase 6.6), so this must read as
 * "not built yet" and never look like a working profile. The wording is the one
 * fixed in `docs/roadmap/technical-roadmap.md` §3.1 and `docs/design/design-system.md` §8.2.
 */
export function profilePlaceholder(): HTMLElement {
  return emptyState('Dein Spielerprofil kommt mit Phase 6.6.');
}

/**
 * The optional "keep your progress" offer (Phase 6.3).
 *
 * Registration is voluntary: this is a quiet, dismissible invitation shown after
 * a game, never a gate before one. The wording makes clear it is optional and
 * that a guest can keep playing without an account.
 */
export function registerOffer(): HTMLElement {
  const link = el(
    'a',
    { class: 'btn btn-secondary', href: './auth.html#register' },
    'Create a free account',
  );
  return el(
    'div',
    { class: 'auth-offer' },
    el(
      'div',
      { class: 'auth-offer__text' },
      el('p', { class: 'auth-offer__title' }, 'Keep your progress'),
      el(
        'p',
        { class: 'auth-offer__hint muted' },
        'An account is optional. It saves your avatar, level and history across games.',
      ),
    ),
    link,
  );
}
