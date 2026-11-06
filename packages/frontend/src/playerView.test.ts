/**
 * Player surface builders (Phase 6.2.2).
 *
 * These cover the pure presentation the player page renders from data the
 * server already sends: the connection-state label and the waiting-room roster.
 * They assert structure and text only; the look lives in the stylesheet and is
 * guarded by `design-system.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import type { PublicPlayer } from '@zeropeek/shared';

import { connectionState, lobbyRoster, profilePlaceholder, registerOffer } from './playerView.js';

function player(overrides: Partial<PublicPlayer> = {}): PublicPlayer {
  return {
    id: 'p1',
    nickname: 'Maya',
    avatar: '',
    score: 0,
    connected: true,
    ...overrides,
  };
}

describe('connectionState', () => {
  it('labels a connected player', () => {
    expect(connectionState(true)).toEqual({ label: 'Connected', tone: 'ok' });
  });

  it('labels a disconnected player', () => {
    expect(connectionState(false)).toEqual({ label: 'Offline', tone: 'muted' });
  });
});

describe('lobbyRoster', () => {
  it('lists one row per player, in the order the server sent them', () => {
    const roster = lobbyRoster([
      player({ id: 'a', nickname: 'Ada' }),
      player({ id: 'b', nickname: 'Bob' }),
    ]);
    const rows = roster.querySelectorAll('.lobby__roster-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Ada');
    expect(rows[1]?.textContent).toContain('Bob');
  });

  it('shows each player’s connection state as a labelled chip, not by colour alone', () => {
    const roster = lobbyRoster([
      player({ id: 'a', nickname: 'Ada', connected: true }),
      player({ id: 'b', nickname: 'Bob', connected: false }),
    ]);
    const rows = roster.querySelectorAll('.lobby__roster-row');
    expect(rows[0]?.textContent).toContain('Connected');
    expect(rows[1]?.textContent).toContain('Offline');
    // A dot is present so the status is not signalled by colour only.
    expect(rows[0]?.querySelector('.chip__dot')).not.toBeNull();
  });

  it('marks the current player’s own row', () => {
    const roster = lobbyRoster([player({ id: 'a', nickname: 'Ada' }), player({ id: 'b' })], 'b');
    const mine = roster.querySelectorAll('.lobby__roster-row--me');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.textContent).toContain('(you)');
  });

  it('renders no rows for an empty roster', () => {
    expect(lobbyRoster([]).querySelectorAll('.lobby__roster-row')).toHaveLength(0);
  });
});

describe('profilePlaceholder', () => {
  it('reads as not built yet and never as a working profile', () => {
    const node = profilePlaceholder();
    expect(node.classList.contains('empty')).toBe(true);
    expect(node.textContent).toContain('Dein Spielerprofil kommt mit Phase 6.6.');
  });
});

describe('registerOffer', () => {
  it('is a quiet, optional invitation with a link to the auth page', () => {
    const node = registerOffer();
    expect(node.classList.contains('auth-offer')).toBe(true);
    const link = node.querySelector('a');
    expect(link?.getAttribute('href')).toBe('./auth.html#register');
    // The wording makes clear the account is optional.
    expect(node.textContent).toContain('optional');
  });
});
