/**
 * Phase 6.8.3 — the level curve, the XP grant and the placement bonus.
 *
 * These are the binding rules from `game-design-concept.md` §5, checked against
 * the exact table the concept publishes, so the shared function and the document
 * can never drift apart.
 */

import { describe, expect, it } from 'vitest';

import {
  levelForXp,
  levelProgress,
  placementBonus,
  xpCostForLevel,
  xpForLevel,
  xpGrantForGame,
} from './progression.js';

describe('level curve (game-design-concept §5.4)', () => {
  it('matches the published cumulative table', () => {
    const table: Array<[level: number, total: number]> = [
      [1, 0],
      [2, 10_000],
      [3, 20_000],
      [4, 30_000],
      [5, 40_000],
      [6, 50_000],
      [7, 60_000],
      [8, 70_000],
      [9, 80_000],
      [10, 90_000],
      [11, 101_000],
      [12, 113_000],
      [13, 126_000],
      [14, 140_000],
      [15, 155_000],
    ];
    for (const [level, total] of table) {
      expect(xpForLevel(level)).toBe(total);
    }
  });

  it('costs 10,000 for the climbs into levels 2..10', () => {
    for (let level = 1; level <= 9; level += 1) {
      expect(xpCostForLevel(level)).toBe(10_000);
    }
  });

  it('costs 11,000 into level 11 and +1,000 for each further climb', () => {
    expect(xpCostForLevel(10)).toBe(11_000);
    expect(xpCostForLevel(11)).toBe(12_000);
    expect(xpCostForLevel(12)).toBe(13_000);
    expect(xpCostForLevel(13)).toBe(14_000);
  });

  it('treats level 1 as 0 XP and never goes below it', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-100)).toBe(1);
  });

  it('resolves the level at and just below each threshold', () => {
    expect(levelForXp(9_999)).toBe(1);
    expect(levelForXp(10_000)).toBe(2);
    expect(levelForXp(99_999)).toBe(10);
    expect(levelForXp(100_999)).toBe(10);
    expect(levelForXp(101_000)).toBe(11);
  });

  it('counts several level-ups from a single large grant', () => {
    // 100,000 XP crosses every threshold up to level 10 in one go.
    expect(levelForXp(100_000)).toBe(10);
    // 155,000 XP reaches level 15 in one grant.
    expect(levelForXp(155_000)).toBe(15);
  });
});

describe('level progress', () => {
  it('reports progress inside a level and what is still needed', () => {
    const progress = levelProgress(12_500);
    expect(progress.level).toBe(2);
    expect(progress.xpIntoLevel).toBe(2_500);
    expect(progress.xpForThisLevel).toBe(10_000);
    expect(progress.xpToNextLevel).toBe(7_500);
    expect(progress.nextLevel).toBe(3);
    expect(progress.ratio).toBeCloseTo(0.25, 5);
  });

  it('starts a fresh level with a full bar to the next one', () => {
    const progress = levelProgress(10_000);
    expect(progress.level).toBe(2);
    expect(progress.xpIntoLevel).toBe(0);
    expect(progress.xpToNextLevel).toBe(10_000);
    expect(progress.ratio).toBe(0);
  });

  it('uses the wider span once past level 10', () => {
    const progress = levelProgress(101_500);
    expect(progress.level).toBe(11);
    expect(progress.xpIntoLevel).toBe(500);
    expect(progress.xpForThisLevel).toBe(12_000);
    expect(progress.xpToNextLevel).toBe(11_500);
  });
});

describe('placement bonus (game-design-concept §5.3)', () => {
  it('pays 1500/1000/500 for the top three and nothing beyond', () => {
    expect(placementBonus(1)).toBe(1_500);
    expect(placementBonus(2)).toBe(1_000);
    expect(placementBonus(3)).toBe(500);
    expect(placementBonus(4)).toBe(0);
    expect(placementBonus(25)).toBe(0);
  });

  it('pays the same bonus to tied players (shared rank)', () => {
    // `rankPlayers` gives tied players the same rank, so the same input yields
    // the same bonus for everyone tied.
    expect(placementBonus(1)).toBe(placementBonus(1));
    expect(placementBonus(2)).toBe(placementBonus(2));
  });
});

describe('xp grant for a game', () => {
  it('grants the score as XP plus the placement bonus', () => {
    // The concept's worked example: 8,500 points and a win -> 10,000 XP.
    expect(xpGrantForGame(8_500, 1)).toEqual({
      base: 8_500,
      placementBonus: 1_500,
      total: 10_000,
    });
  });

  it('grants no bonus beyond the top three', () => {
    expect(xpGrantForGame(2_000, 5)).toEqual({
      base: 2_000,
      placementBonus: 0,
      total: 2_000,
    });
  });

  it('never grants a negative base', () => {
    expect(xpGrantForGame(-10, 1).base).toBe(0);
  });

  it('is exactly the score for a guest-style zero rank bonus', () => {
    expect(xpGrantForGame(4_321, 4).total).toBe(4_321);
  });
});
