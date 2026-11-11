/**
 * Player surface builders (Phase 6.2.2).
 *
 * These cover the pure presentation the player page renders from data the
 * server already sends: the connection-state label and the waiting-room roster.
 * They assert structure and text only; the look lives in the stylesheet and is
 * guarded by `design-system.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import type { PlayerSync, PublicPlayer } from '@zeropeek/shared';

import {
  connectionState,
  endProgressActions,
  hostPresenceStatus,
  hostStatusChip,
  joinIdentityHint,
  lobbyRoster,
  registerOffer,
  screenForSync,
} from './playerView.js';

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

  it('shows each player’s avatar, from the character the server seated them with', () => {
    const roster = lobbyRoster([
      player({ id: 'a', nickname: 'Ada', avatar: 'ethan' }),
      player({ id: 'b', nickname: 'Bob', avatar: '' }),
    ]);
    const rows = roster.querySelectorAll('.lobby__roster-row');
    // A character with artwork draws the real figure.
    expect(rows[0]?.querySelector('.player-avatar--art')).not.toBeNull();
    expect(rows[0]?.querySelector('.player-avatar__img')).not.toBeNull();
    // A guest (no avatar) falls back to a letter badge, never an empty frame.
    expect(rows[1]?.querySelector('.player-avatar--art')).toBeNull();
    expect(rows[1]?.querySelector('.player-avatar__initial')?.textContent).toBe('B');
  });
});

describe('joinIdentityHint', () => {
  it('tells a signed-in player their account name will be used', () => {
    const node = joinIdentityHint('alice');
    expect(node.textContent).toContain('alice');
    expect(node.textContent).toContain('avatar');
  });
});

describe('endProgressActions', () => {
  it('offers a signed-in player a saved confirmation and no registration', () => {
    const node = endProgressActions(true);
    expect(node.textContent).toContain('saved to your account');
    // The bug this fixes: a signed-in player must never be offered registration.
    expect(node.textContent).not.toContain('Create a free account');
    expect(node.querySelector('a[href="./auth.html#register"]')).toBeNull();
    // It points at the player's own progress surfaces instead.
    expect(node.querySelector('a[href="./profile.html"]')).not.toBeNull();
  });

  it('keeps the optional registration offer for a guest', () => {
    const node = endProgressActions(false);
    expect(node.classList.contains('auth-offer')).toBe(true);
    expect(node.querySelector('a')?.getAttribute('href')).toBe('./auth.html#register');
    expect(node.textContent).toContain('optional');
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

describe('hostPresenceStatus', () => {
  it('labels the host as connected when a host socket is present', () => {
    expect(hostPresenceStatus('connected')).toEqual({ label: 'Host connected', tone: 'ok' });
  });

  it('labels the host as reconnecting when none is present', () => {
    expect(hostPresenceStatus('reconnecting')).toEqual({
      label: 'Host reconnecting…',
      tone: 'warn',
    });
  });

  it('never signals the host state by colour alone (each state has a label)', () => {
    for (const status of ['connected', 'reconnecting'] as const) {
      expect(hostPresenceStatus(status).label).toBeTruthy();
    }
  });
});

describe('hostStatusChip', () => {
  it('renders nothing while the host is reachable or before the first event', () => {
    expect(hostStatusChip('connected')).toBeNull();
    expect(hostStatusChip(null)).toBeNull();
  });

  it('renders a status chip while the host is away', () => {
    const chip = hostStatusChip('reconnecting');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('role')).toBe('status');
    expect(chip?.textContent).toContain('Host reconnecting');
  });
});

describe('screenForSync', () => {
  const question = {
    id: 'q1',
    type: 'single' as const,
    text: 'Prompt',
    timeLimit: 20,
    display: { options: ['a', 'b'] },
    openedAt: 0,
    index: 0,
    total: 1,
    paused: false,
    remainingMs: null,
  };

  function sync(overrides: Partial<PlayerSync> = {}): PlayerSync {
    return {
      phase: 'lobby',
      question: null,
      answer: null,
      board: null,
      podium: null,
      placement: null,
      skipped: false,
      ...overrides,
    };
  }

  it('maps each running phase to its own screen, never the lobby', () => {
    expect(screenForSync(sync({ phase: 'lobby' }))).toBe('lobby');
    expect(screenForSync(sync({ phase: 'question', question }))).toBe('question');
    expect(screenForSync(sync({ phase: 'reveal', question }))).toBe('reveal');
    expect(screenForSync(sync({ phase: 'board', question }))).toBe('board');
    expect(screenForSync(sync({ phase: 'end' }))).toBe('end');
  });

  it('shows the reveal as soon as a private result is present', () => {
    const state = sync({
      phase: 'question',
      question,
      answer: {
        questionId: 'q1',
        answered: true,
        answer: 0,
        result: { outcome: 'correct', points: 10, score: 10, rank: 1 },
      },
    });
    expect(screenForSync(state)).toBe('reveal');
  });

  it('falls back to the lobby only when the question phase carries no question', () => {
    expect(screenForSync(sync({ phase: 'question', question: null }))).toBe('lobby');
  });

  it('shows the reveal screen for a skipped question', () => {
    // The server reports `skipped` and a `skipped` result, so a reconnect during
    // a skipped reveal lands on the reveal screen, not back on the question.
    const state = sync({
      phase: 'reveal',
      question,
      skipped: true,
      answer: {
        questionId: 'q1',
        answered: false,
        answer: null,
        result: { outcome: 'skipped', points: 0, score: 0, rank: 1 },
      },
    });
    expect(screenForSync(state)).toBe('reveal');
  });
});
