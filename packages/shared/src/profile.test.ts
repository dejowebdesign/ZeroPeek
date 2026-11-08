/**
 * Unit tests for the player-profile domain (Phase 6.6).
 *
 * The rules under test are the ones the server relies on: one participation per
 * finished game, ties counted as wins/podiums, skipped questions excluded, and an
 * honest `null` accuracy when nothing was answered. The same functions run in the
 * backend, so a passing test here means the server's arithmetic is the tested one.
 */

import { describe, expect, it } from 'vitest';

import {
  CHARACTER_CATALOGUE,
  CHARACTER_ID_MAX,
  DEFAULT_TIE_BREAK,
  EMPTY_PROFILE_STATS,
  findCharacter,
  rankGameSeats,
  summariseSeats,
  validateProfileUpdate,
  type ProfileGameSeat,
} from './index.js';

function seat(overrides: Partial<ProfileGameSeat> = {}): ProfileGameSeat {
  return {
    gameId: 'g1',
    playerId: 'p1',
    score: 0,
    correctCount: 0,
    answeredCount: 0,
    totalTimeMs: 0,
    joinedAt: 0,
    ...overrides,
  };
}

describe('rankGameSeats', () => {
  it('ranks by score and shares a rank on a full tie (1, 1, 3)', () => {
    const ranked = rankGameSeats(
      [
        seat({ playerId: 'a', score: 500, correctCount: 5 }),
        seat({ playerId: 'b', score: 500, correctCount: 5 }),
        seat({ playerId: 'c', score: 100, correctCount: 1 }),
      ],
      DEFAULT_TIE_BREAK,
    );
    const byId = new Map(ranked.map((entry) => [entry.playerId, entry.rank]));
    expect(byId.get('a')).toBe(1);
    expect(byId.get('b')).toBe(1);
    expect(byId.get('c')).toBe(3);
  });

  it('breaks a tie on correct count, then total time', () => {
    const ranked = rankGameSeats(
      [
        seat({ playerId: 'a', score: 500, correctCount: 4, totalTimeMs: 9000 }),
        seat({ playerId: 'b', score: 500, correctCount: 5, totalTimeMs: 12000 }),
        seat({ playerId: 'c', score: 500, correctCount: 4, totalTimeMs: 5000 }),
      ],
      DEFAULT_TIE_BREAK,
    );
    expect(ranked.map((entry) => entry.playerId)).toEqual(['b', 'c', 'a']);
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });
});

describe('summariseSeats', () => {
  it('returns an honest empty summary when there are no seats', () => {
    expect(summariseSeats([])).toEqual(EMPTY_PROFILE_STATS);
  });

  it('counts one participation per distinct game and a win for rank 1', () => {
    const stats = summariseSeats([
      { ...seat({ gameId: 'g1', playerId: 'me' }), rank: 1 },
      { ...seat({ gameId: 'g2', playerId: 'me' }), rank: 2 },
    ]);
    expect(stats.gamesPlayed).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.podiums).toBe(2);
  });

  it('counts a shared first place as a win for every tied leader', () => {
    const stats = summariseSeats([{ ...seat({ gameId: 'g1', playerId: 'me' }), rank: 1 }]);
    expect(stats.wins).toBe(1);
    expect(stats.podiums).toBe(1);
  });

  it('counts rank 3 as a podium but not a win', () => {
    const stats = summariseSeats([{ ...seat({ gameId: 'g1', playerId: 'me' }), rank: 3 }]);
    expect(stats.wins).toBe(0);
    expect(stats.podiums).toBe(1);
  });

  it('does not count rank 4 as a podium', () => {
    const stats = summariseSeats([{ ...seat({ gameId: 'g1', playerId: 'me' }), rank: 4 }]);
    expect(stats.podiums).toBe(0);
  });

  it('de-duplicates two seats in the same game, keeping the best', () => {
    const stats = summariseSeats([
      { ...seat({ gameId: 'g1', playerId: 'a', score: 900 }), rank: 2 },
      { ...seat({ gameId: 'g1', playerId: 'b', score: 1000 }), rank: 1 },
    ]);
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.wins).toBe(1);
  });

  it('computes accuracy from the summed counts and null when nothing was answered', () => {
    const withAnswers = summariseSeats([
      { ...seat({ gameId: 'g1', playerId: 'me', correctCount: 3, answeredCount: 4 }), rank: 1 },
      { ...seat({ gameId: 'g2', playerId: 'me', correctCount: 1, answeredCount: 6 }), rank: 2 },
    ]);
    expect(withAnswers.correctAnswers).toBe(4);
    expect(withAnswers.answeredCount).toBe(10);
    expect(withAnswers.accuracy).toBeCloseTo(0.4);

    const none = summariseSeats([{ ...seat({ gameId: 'g1', playerId: 'me' }), rank: 1 }]);
    expect(none.accuracy).toBeNull();
  });
});

describe('validateProfileUpdate', () => {
  it('accepts a character id and a null to clear it', () => {
    expect(validateProfileUpdate({ selectedCharacterId: 'ethan' })).toEqual([]);
    expect(validateProfileUpdate({ selectedCharacterId: null })).toEqual([]);
  });

  it('rejects a non-object body', () => {
    expect(validateProfileUpdate(null)).toHaveLength(1);
    expect(validateProfileUpdate('nope')).toHaveLength(1);
  });

  it('rejects any field the phase does not own (no XP, no statistics, no userId)', () => {
    for (const field of ['xp', 'level', 'wins', 'userId', 'accuracy', 'gamesPlayed']) {
      const issues = validateProfileUpdate({ selectedCharacterId: 'ethan', [field]: 1 });
      expect(issues.some((issue) => issue.path === field)).toBe(true);
    }
  });

  it('rejects a character id that is empty, non-string or too long', () => {
    expect(validateProfileUpdate({ selectedCharacterId: '' })).toHaveLength(1);
    expect(validateProfileUpdate({ selectedCharacterId: 42 })).toHaveLength(1);
    expect(
      validateProfileUpdate({ selectedCharacterId: 'x'.repeat(CHARACTER_ID_MAX + 1) }),
    ).toHaveLength(1);
  });
});

describe('character catalogue (Phase 6.6.2)', () => {
  it('lists the canonical Blockwelt-Helden ids and nothing invented', () => {
    expect(CHARACTER_CATALOGUE.map((character) => character.id)).toEqual([
      'ethan',
      'maya',
      'pixel',
      'bee',
      'dr-obscura',
      'o-bot',
    ]);
  });

  it('gives every character a name and a tagline to show without artwork', () => {
    for (const character of CHARACTER_CATALOGUE) {
      expect(character.name.length).toBeGreaterThan(0);
      expect(character.tagline.length).toBeGreaterThan(0);
      expect(['common', 'rare', 'legendary']).toContain(character.rarity);
    }
  });

  it('keeps every id within the length the server accepts', () => {
    for (const character of CHARACTER_CATALOGUE) {
      expect(character.id.length).toBeLessThanOrEqual(CHARACTER_ID_MAX);
      expect(validateProfileUpdate({ selectedCharacterId: character.id })).toEqual([]);
    }
  });

  it('finds a character by id and reports an unknown one as undefined', () => {
    expect(findCharacter('ethan')?.name).toBe('Ethan');
    expect(findCharacter('nobody')).toBeUndefined();
    expect(findCharacter(null)).toBeUndefined();
  });
});
