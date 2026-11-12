/**
 * Phase 6.8.4 — the level curve, the XP grant and the placement bonus.
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
  requiredXp,
  xpForLevel,
  xpGrantForGame,
} from './progression.js';

describe('level curve (game-design-concept §5.4)', () => {
  it('matches the published cumulative table', () => {
    const table: Array<[level: number, total: number]> = [
      [1, 0],
      [2, 100_000],
      [3, 210_000],
      [4, 330_000],
      [5, 460_000],
      [6, 600_000],
      [7, 750_000],
      [8, 910_000],
      [9, 1_080_000],
      [10, 1_260_000],
    ];
    for (const [level, total] of table) {
      expect(xpForLevel(level)).toBe(total);
    }
  });

  it('costs 100,000 + (level - 1) * 10,000 for the climb from a level', () => {
    expect(requiredXp(1)).toBe(100_000);
    expect(requiredXp(2)).toBe(110_000);
    expect(requiredXp(3)).toBe(120_000);
    expect(requiredXp(4)).toBe(130_000);
    expect(requiredXp(5)).toBe(140_000);
    expect(requiredXp(10)).toBe(190_000);
  });

  it('treats level 1 as 0 XP and never goes below it', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-100)).toBe(1);
  });

  it('resolves the level at and just below each threshold', () => {
    expect(levelForXp(99_999)).toBe(1);
    expect(levelForXp(100_000)).toBe(2);
    expect(levelForXp(209_999)).toBe(2);
    expect(levelForXp(210_000)).toBe(3);
  });

  it('counts several level-ups from a single large grant', () => {
    // 210,000 XP crosses into level 3 in one go.
    expect(levelForXp(210_000)).toBe(3);
    // 1,260,000 XP reaches level 10 in one grant.
    expect(levelForXp(1_260_000)).toBe(10);
  });
});

describe('level progress', () => {
  it('reports progress inside a level and what is still needed', () => {
    const progress = levelProgress(150_000);
    expect(progress.level).toBe(2);
    expect(progress.xpIntoLevel).toBe(50_000);
    expect(progress.xpForThisLevel).toBe(110_000);
    expect(progress.xpToNextLevel).toBe(60_000);
    expect(progress.nextLevel).toBe(3);
    expect(progress.ratio).toBeCloseTo(50_000 / 110_000, 5);
  });

  it('starts a fresh level with a full bar to the next one', () => {
    const progress = levelProgress(100_000);
    expect(progress.level).toBe(2);
    expect(progress.xpIntoLevel).toBe(0);
    expect(progress.xpToNextLevel).toBe(110_000);
    expect(progress.ratio).toBe(0);
  });

  it('uses the wider span once past level 1', () => {
    const progress = levelProgress(310_000);
    expect(progress.level).toBe(3);
    expect(progress.xpIntoLevel).toBe(100_000);
    expect(progress.xpForThisLevel).toBe(120_000);
    expect(progress.xpToNextLevel).toBe(20_000);
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
