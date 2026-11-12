/**
 * Beamer view tests (Phase 6.1 fine-tuning).
 *
 * These cover the pure builders the host page uses for the presentation: the
 * answer list on the question screen, the leaderboard rows, and the podium
 * places. They assert structure and text only – the visual scale lives in the
 * stylesheet and is guarded by `design-system.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import type { PublicPlayer, PublicQuestion } from '@zeropeek/shared';

import { leaderboardRow, podiumPlace, questionDisplayOptions } from './showView.js';

function question(display: Record<string, unknown>): PublicQuestion {
  return {
    id: 'q1',
    type: 'single',
    text: 'Prompt',
    timeLimit: 20,
    display,
    openedAt: 0,
    index: 0,
    total: 1,
    paused: false,
    remainingMs: null,
  };
}

const player: PublicPlayer = {
  id: 'p1',
  nickname: 'Maya',
  avatar: '',
  score: 1234,
  connected: true,
};

describe('questionDisplayOptions', () => {
  it('lists the answer labels for a choice question', () => {
    expect(questionDisplayOptions(question({ options: ['A', 'B', 'C', 'D'] }))).toEqual([
      'A',
      'B',
      'C',
      'D',
    ]);
  });

  it('renders true/false options as readable labels', () => {
    expect(questionDisplayOptions(question({ options: [true, false] }))).toEqual(['True', 'False']);
  });

  it('returns nothing for a type without a fixed choice list', () => {
    expect(questionDisplayOptions(question({ maxLength: 200 }))).toEqual([]);
    expect(questionDisplayOptions(question({}))).toEqual([]);
  });

  it('ignores a malformed options field instead of throwing', () => {
    expect(questionDisplayOptions(question({ options: 'A,B' }))).toEqual([]);
  });
});

describe('leaderboardRow', () => {
  it('shows the rank, nickname and score', () => {
    const node = leaderboardRow(player, 2);
    expect(node.className).toBe('leaderboard__row');
    expect(node.querySelector('.leaderboard__rank')?.textContent).toBe('3');
    expect(node.querySelector('.leaderboard__name')?.textContent).toBe('Maya');
    expect(node.querySelector('.leaderboard__score')?.textContent).toBe('1234');
  });

  it('carries the player’s head portrait in the name cell (Phase 6.8.3/6.8.4)', () => {
    const withArt = leaderboardRow({ ...player, avatar: 'maya' }, 0);
    expect(withArt.querySelector('.leaderboard__who .player-avatar--art')).not.toBeNull();
    expect(withArt.querySelector('.player-avatar__img')).not.toBeNull();
    // In-game surfaces show the head crop, not the whole figure (Phase 6.8.4 §5).
    expect(withArt.querySelector('.player-avatar--head')).not.toBeNull();
    // A guest seat with no avatar shows a letter badge, never an empty frame.
    const guest = leaderboardRow(player, 0);
    expect(guest.querySelector('.player-avatar--art')).toBeNull();
    expect(guest.querySelector('.player-avatar__initial')?.textContent).toBe('M');
  });
});

describe('podiumPlace', () => {
  it('carries the rank as a modifier class and as text', () => {
    const node = podiumPlace(player, 1);
    expect(node.className).toBe('podium__place podium__place--1');
    expect(node.querySelector('.podium__rank')?.textContent).toBe('1');
    expect(node.querySelector('.podium__name')?.textContent).toBe('Maya');
    expect(node.querySelector('.podium__score')?.textContent).toBe('1234');
  });

  it('shows the winner’s full character figure large (Phase 6.8.4 §4)', () => {
    const node = podiumPlace({ ...player, avatar: 'ethan' }, 1);
    const badge = node.querySelector('.player-avatar');
    expect(badge?.classList.contains('player-avatar--lg')).toBe(true);
    // The podium shows the whole figure, never the head crop.
    expect(badge?.classList.contains('player-avatar--full')).toBe(true);
    expect(badge?.classList.contains('player-avatar--head')).toBe(false);
    expect(node.querySelector('.player-avatar__img')?.getAttribute('src')).toBe(
      '/characters/ethan/ethan_base_current.webp',
    );
  });

  it('falls back to a letter badge when a podium place has no artwork', () => {
    const node = podiumPlace({ ...player, avatar: '' }, 2);
    expect(node.querySelector('.player-avatar--art')).toBeNull();
    expect(node.querySelector('.player-avatar__initial')?.textContent).toBe('M');
  });
});
