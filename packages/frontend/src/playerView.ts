/**
 * Pure builders for the player surface (Phase 6.2.2).
 *
 * Kept free of the socket and of the DOM root so they can be unit-tested, the
 * same way `showView.ts` serves the beamer. Everything here is presentation of
 * data the server already sends (`PublicPlayer`); nothing is invented, and the
 * play flow itself stays server-authoritative.
 */

import type { HostPresence, PlayerSync, PublicPlayer } from '@zeropeek/shared';

import { el } from './dom.js';
import { playerAvatar } from './avatar.js';
import { chip, notice } from './ui.js';

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

/**
 * The label and tone for the host's reachability, as the player sees it.
 *
 * This is about the host's connection only — never the game phase — so a player
 * is told that the host is away without any suggestion the game itself stopped.
 * The wording carries the meaning; the chip's dot and colour only reinforce it.
 */
export function hostPresenceStatus(status: HostPresence): {
  label: string;
  tone: 'ok' | 'warn';
} {
  return status === 'connected'
    ? { label: 'Host connected', tone: 'ok' }
    : { label: 'Host reconnecting…', tone: 'warn' };
}

/**
 * The player's host-status indicator.
 *
 * Rendered only when the host is *not* reachable: a permanent "Host connected"
 * badge would be noise on every screen, and the meaningful signal is the host
 * being away. Returns `null` while the host is fine or before the first event,
 * so the shell adds nothing.
 */
export function hostStatusChip(status: HostPresence | null): HTMLElement | null {
  if (status !== 'reconnecting') return null;
  const { label, tone } = hostPresenceStatus(status);
  return el('div', { class: 'player-host-status', role: 'status' }, chip(label, tone, true));
}

/** A short, human label for a player's connection state. */
export function connectionState(connected: boolean): { label: string; tone: 'ok' | 'muted' } {
  // The label carries the meaning; the chip's dot and colour only reinforce it,
  // so a status is never signalled by colour alone (design-concept §10).
  return connected ? { label: 'Connected', tone: 'ok' } : { label: 'Offline', tone: 'muted' };
}

/**
 * The waiting-room roster: every player the server has sent, in the order it
 * sent them, each with their avatar, name and connection state. `meId` marks the
 * current player so they can find themselves in the list.
 *
 * The avatar is the character id the server resolved for the seat
 * (`PublicPlayer.avatar`), drawn as a real figure when the character has artwork
 * and as a letter badge otherwise (Phase 6.8.3) — so a signed-in player is
 * recognisable in the lobby, not just by name.
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
        playerAvatar(player.nickname, player.avatar, { size: 'sm' }),
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
 * A small, non-blocking hint on the join form telling a signed-in player that
 * their account name (and avatar) will be used, so the missing name field is
 * understood rather than surprising (Phase 6.8.3). Rendered only when the
 * browser holds a player session.
 */
export function joinIdentityHint(username: string): HTMLElement {
  return notice(`Joining as ${username}. Your avatar will be shown in the game.`, 'info');
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

/**
 * What the end screen shows under the podium (Phase 6.8.3).
 *
 * A **signed-in** player already had their round granted to the account at
 * `end`, so they are told it was saved and are offered **no** registration: the
 * bug this fixes was a "Create a free account" button shown to a player who was
 * already signed in. A **guest** keeps the optional invitation — registration is
 * voluntary and never a gate — and, once they register, the stored claim proof
 * carries the round over (the profile page's claim card).
 */
export function endProgressActions(signedIn: boolean): HTMLElement {
  if (signedIn) {
    return el(
      'div',
      { class: 'end-saved' },
      notice('Your progress for this round was saved to your account.', 'success'),
      el(
        'p',
        { class: 'muted end-saved__hint' },
        'See your level, statistics and achievements on your profile.',
      ),
      el(
        'div',
        { class: 'end-saved__actions' },
        el('a', { class: 'btn btn-secondary', href: './profile.html' }, 'Open profile'),
        el('a', { class: 'btn btn-secondary', href: './inventory.html' }, 'Open inventory'),
      ),
    );
  }
  return registerOffer();
}
