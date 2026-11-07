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
  hostPresenceStatus,
  hostStatusChip,
  lobbyRoster,
  profilePlaceholder,
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
