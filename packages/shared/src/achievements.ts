/**
 * Achievement catalogue and unlock rules (Phase 6.8).
 *
 * An achievement is a permanent, cosmetic milestone on an account. Nothing here
 * affects play: no achievement grants points, an advantage or an entry into a
 * ranking, so there is no way to "win" by farming one.
 *
 * **The catalogue below is provisional.** `game-design-concept.md` §6.3 lists
 * these as *suggestions* and explicitly marks the final names, thresholds and
 * reward items as open (`§16.2`), to be fixed by the project owner. The
 * **mechanic** — evaluate a pure context, unlock once, never revoke — is final
 * and tested; the concrete entries are replaced in one place once approved.
 *
 * The evaluation is pure and total: the server builds an `AchievementContext`
 * from persisted data and asks which achievements are earned. The client can
 * never assert an unlock.
 */

/** The data an achievement rule may look at, all server-computed. */
export interface AchievementContext {
  /** Distinct finished games the account took part in. */
  gamesPlayed: number;
  /** Finished games where the account ranked first (ties count). */
  wins: number;
  /** Finished games where the account reached the top three. */
  podiums: number;
  /** Correct answers across those games (skipped questions excluded). */
  correctAnswers: number;
  /** Questions answered across those games (skipped questions excluded). */
  answeredCount: number;
  /** The account's current level. */
  level: number;
  /** The longest run of correct answers in a row, across all games. */
  longestCorrectStreak: number;
  /** Games in which every answered question was correct (at least one answered). */
  perfectRounds: number;
}

/**
 * The condition of one achievement.
 *
 * A discriminated union so a rule is data, not code: adding an achievement is a
 * catalogue entry, and the evaluator stays the single tested implementation.
 */
export type AchievementCondition =
  | { kind: 'games-played'; threshold: number }
  | { kind: 'wins'; threshold: number }
  | { kind: 'podiums'; threshold: number }
  | { kind: 'correct-answers'; threshold: number }
  | { kind: 'level'; threshold: number }
  | { kind: 'perfect-round'; threshold: number }
  | { kind: 'correct-streak'; threshold: number };

/** One achievement definition. */
export interface Achievement {
  /** Stable id stored in `PlayerAchievement.achievementId`. */
  id: string;
  /** Display name. */
  name: string;
  /** A short, plain description. */
  description: string;
  /** The condition that unlocks it. */
  condition: AchievementCondition;
  /**
   * The cosmetic item granted on unlock, or `null`. **Always `null` today**: the
   * reward matrix is an open product decision (§6.2a/§16.2) and no reward artwork
   * beyond the default kits exists, so nothing is invented.
   */
  rewardItemId: string | null;
}

/**
 * The provisional achievement catalogue (`game-design-concept.md` §6.3).
 *
 * Kept deliberately small. Thresholds and names await the owner's approval.
 */
export const ACHIEVEMENT_CATALOGUE: readonly Achievement[] = [
  {
    id: 'first-game',
    name: 'First round',
    description: 'Finish your first game.',
    condition: { kind: 'games-played', threshold: 1 },
    rewardItemId: null,
  },
  {
    id: 'first-win',
    name: 'First win',
    description: 'Finish a game in first place.',
    condition: { kind: 'wins', threshold: 1 },
    rewardItemId: null,
  },
  {
    id: 'perfect-round',
    name: 'Flawless',
    description: 'Answer every question of a game correctly.',
    condition: { kind: 'perfect-round', threshold: 1 },
    rewardItemId: null,
  },
  {
    id: 'streak-10',
    name: 'Streak of 10',
    description: 'Answer 10 questions in a row correctly.',
    condition: { kind: 'correct-streak', threshold: 10 },
    rewardItemId: null,
  },
  {
    id: 'games-10',
    name: 'Regular',
    description: 'Finish 10 games.',
    condition: { kind: 'games-played', threshold: 10 },
    rewardItemId: null,
  },
  {
    id: 'games-50',
    name: 'Veteran',
    description: 'Finish 50 games.',
    condition: { kind: 'games-played', threshold: 50 },
    rewardItemId: null,
  },
  {
    id: 'level-5',
    name: 'Master',
    description: 'Reach level 5.',
    condition: { kind: 'level', threshold: 5 },
    rewardItemId: null,
  },
  {
    id: 'level-7',
    name: 'Legend',
    description: 'Reach level 7.',
    condition: { kind: 'level', threshold: 7 },
    rewardItemId: null,
  },
];

/** Look an achievement up by id, or `undefined`. */
export function findAchievement(id: string): Achievement | undefined {
  return ACHIEVEMENT_CATALOGUE.find((achievement) => achievement.id === id);
}

/** The progress a context has toward one condition, as a raw number. */
function progressFor(context: AchievementContext, condition: AchievementCondition): number {
  switch (condition.kind) {
    case 'games-played':
      return context.gamesPlayed;
    case 'wins':
      return context.wins;
    case 'podiums':
      return context.podiums;
    case 'correct-answers':
      return context.correctAnswers;
    case 'level':
      return context.level;
    case 'perfect-round':
      return context.perfectRounds;
    case 'correct-streak':
      return context.longestCorrectStreak;
  }
}

/** Whether a context satisfies a condition. */
export function conditionMet(
  context: AchievementContext,
  condition: AchievementCondition,
): boolean {
  return progressFor(context, condition) >= condition.threshold;
}

/**
 * The ids of every achievement the context has earned.
 *
 * Pure: the caller passes a server-built context and receives ids. The service
 * then unlocks only the ones not already stored, so a repeat call is a no-op.
 */
export function achievementsEarned(context: AchievementContext): string[] {
  return ACHIEVEMENT_CATALOGUE.filter((achievement) =>
    conditionMet(context, achievement.condition),
  ).map((achievement) => achievement.id);
}

/** How far a context has progressed toward one achievement. */
export interface AchievementProgress {
  achievement: Achievement;
  /** The current value of the condition's subject. */
  current: number;
  /** The value that unlocks it. */
  threshold: number;
  /** `current / threshold`, capped at 1. */
  ratio: number;
  /** Whether the achievement is already earned. */
  earned: boolean;
}

/** The progress of a context toward one achievement, for the UI. */
export function achievementProgress(
  context: AchievementContext,
  achievement: Achievement,
  earned: boolean,
): AchievementProgress {
  const current = progressFor(context, achievement.condition);
  const threshold = achievement.condition.threshold;
  return {
    achievement,
    current,
    threshold,
    ratio: threshold <= 0 ? 1 : Math.min(1, current / threshold),
    earned,
  };
}
