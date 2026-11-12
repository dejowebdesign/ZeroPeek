/**
 * Phase 6.8 — achievement rules and level rewards.
 *
 * The catalogue is provisional (see the module docblock), so these tests assert
 * the **mechanic** rather than a fixed list: the evaluator is pure, an earned
 * achievement stays earned, and the level-reward lookup never invents an item.
 */

import { describe, expect, it } from 'vitest';

import {
  ACHIEVEMENT_CATALOGUE,
  achievementProgress,
  achievementsEarned,
  conditionMet,
  findAchievement,
  type AchievementContext,
} from './achievements.js';
import {
  LEVEL_REWARDS,
  levelRewardItem,
  levelsWithRewards,
  nextRewardLevel,
  rewardItemsUpToLevel,
  unlockLevelForItem,
} from './levelRewards.js';

/** A context with nothing achieved yet. */
function emptyContext(overrides: Partial<AchievementContext> = {}): AchievementContext {
  return {
    gamesPlayed: 0,
    wins: 0,
    podiums: 0,
    correctAnswers: 0,
    answeredCount: 0,
    level: 1,
    longestCorrectStreak: 0,
    perfectRounds: 0,
    ...overrides,
  };
}

describe('achievement catalogue', () => {
  it('has unique ids and a threshold >= 1 on every condition', () => {
    const ids = ACHIEVEMENT_CATALOGUE.map((achievement) => achievement.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const achievement of ACHIEVEMENT_CATALOGUE) {
      expect(achievement.condition.threshold).toBeGreaterThanOrEqual(1);
      // No reward item is invented while the matrix is unapproved.
      expect(achievement.rewardItemId).toBeNull();
    }
  });

  it('looks an achievement up by id', () => {
    expect(findAchievement('first-game')?.name).toBe('First round');
    expect(findAchievement('nope')).toBeUndefined();
  });
});

describe('achievementsEarned', () => {
  it('earns nothing on an empty context', () => {
    expect(achievementsEarned(emptyContext())).toEqual([]);
  });

  it('earns the first-round achievement after one finished game', () => {
    expect(achievementsEarned(emptyContext({ gamesPlayed: 1 }))).toContain('first-game');
  });

  it('earns a win achievement only with a win', () => {
    expect(achievementsEarned(emptyContext({ gamesPlayed: 1 }))).not.toContain('first-win');
    expect(achievementsEarned(emptyContext({ wins: 1 }))).toContain('first-win');
  });

  it('earns every threshold that is met at once', () => {
    const earned = achievementsEarned(emptyContext({ gamesPlayed: 50, wins: 3, level: 7 }));
    expect(earned).toEqual(
      expect.arrayContaining([
        'first-game',
        'games-10',
        'games-50',
        'first-win',
        'level-5',
        'level-7',
      ]),
    );
  });

  it('is monotonic: a bigger context earns a superset', () => {
    const small = new Set(achievementsEarned(emptyContext({ gamesPlayed: 1 })));
    const big = new Set(achievementsEarned(emptyContext({ gamesPlayed: 50 })));
    for (const id of small) expect(big.has(id)).toBe(true);
  });
});

describe('conditionMet / achievementProgress', () => {
  it('is met exactly at the threshold, not below', () => {
    const condition = { kind: 'games-played' as const, threshold: 10 };
    expect(conditionMet(emptyContext({ gamesPlayed: 9 }), condition)).toBe(false);
    expect(conditionMet(emptyContext({ gamesPlayed: 10 }), condition)).toBe(true);
  });

  it('caps the progress ratio at 1', () => {
    const achievement = findAchievement('games-10')!;
    const progress = achievementProgress(emptyContext({ gamesPlayed: 25 }), achievement, true);
    expect(progress.ratio).toBe(1);
    expect(progress.earned).toBe(true);
  });

  it('reports a partial ratio before the threshold', () => {
    const achievement = findAchievement('games-10')!;
    const progress = achievementProgress(emptyContext({ gamesPlayed: 5 }), achievement, false);
    expect(progress.ratio).toBeCloseTo(0.5, 5);
    expect(progress.earned).toBe(false);
  });
});

describe('level rewards (binding matrix, Phase 6.8.4)', () => {
  it('publishes the brief’s slot order for levels 2..6', () => {
    expect(LEVEL_REWARDS).toEqual([
      { level: 2, slot: 'outfit' },
      { level: 3, slot: 'backpack' },
      { level: 4, slot: 'neckAccessory' },
      { level: 5, slot: 'visor' },
      { level: 6, slot: 'wristAccessory' },
    ]);
    expect(levelsWithRewards()).toEqual([2, 3, 4, 5, 6]);
  });

  it('resolves a reward to the character’s own item for the slot', () => {
    expect(levelRewardItem(2, 'ethan')?.id).toBe('ethan_outfit');
    expect(levelRewardItem(3, 'maya')?.id).toBe('maya_backpack');
    // The resolved item always belongs to the requested character.
    for (const level of [2, 3, 4, 5, 6]) {
      for (const id of ['ethan', 'maya']) {
        expect(levelRewardItem(level, id)?.characterId).toBe(id);
      }
    }
  });

  it('grants nothing for a level without an entry or a character without artwork', () => {
    expect(levelRewardItem(1, 'ethan')).toBeUndefined();
    expect(levelRewardItem(7, 'ethan')).toBeUndefined();
    expect(levelRewardItem(2, 'pixel')).toBeUndefined();
    expect(levelRewardItem(2, null)).toBeUndefined();
  });

  it('reports the next reward level strictly after the current one', () => {
    expect(nextRewardLevel(1)).toBe(2);
    expect(nextRewardLevel(2)).toBe(3);
    expect(nextRewardLevel(6)).toBeUndefined();
  });

  it('lists every reward earned up to a level, and none beyond', () => {
    expect(rewardItemsUpToLevel(1, 'ethan')).toEqual([]);
    expect(rewardItemsUpToLevel(2, 'ethan').map((item) => item.id)).toEqual(['ethan_outfit']);
    expect(rewardItemsUpToLevel(6, 'ethan').map((item) => item.slot)).toEqual([
      'outfit',
      'backpack',
      'neckAccessory',
      'visor',
      'wristAccessory',
    ]);
    // A level above the matrix grants nothing extra.
    expect(rewardItemsUpToLevel(99, 'ethan')).toHaveLength(5);
  });

  it('maps an item back to its unlock level', () => {
    expect(unlockLevelForItem({ slot: 'outfit' })).toBe(2);
    expect(unlockLevelForItem({ slot: 'wristAccessory' })).toBe(6);
  });
});
