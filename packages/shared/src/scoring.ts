/**
 * Scoring: points for one answer, and ranking.
 *
 * Three product decisions from `docs/architecture/README.md` are still open
 * (Q1 scoring formula, Q2 "too fast" rule, Q6 tie-breaking). Rather than
 * hard-coding a guess, every one of them is a **named option in a config
 * object** with a documented default. The defaults are proposals, not decided
 * product behaviour: changing them is a config change, never a code change in
 * the engine.
 *
 * The module is pure so the exact same function can run in a test, on the
 * server (authoritative) and in a preview in the editor.
 */

import { TIME_MAX, TIME_MIN } from './constants.js';
import type { Question } from './questions.js';
import { normalizeText } from './validation.js';

/** Q1 – how a correct answer turns into points. */
export interface ScoringConfig {
  /** Points for a correct answer at the very end of the time window. */
  basePoints: number;
  /**
   * Share of `basePoints` awarded on top for answering instantly, i.e. the
   * maximum speed bonus as a fraction of the base. `0` disables the time bonus.
   */
  speedBonusRatio: number;
  /** Curve of the speed bonus between 0 and 1 seconds elapsed. */
  speedCurve: 'linear' | 'quadratic';
  /** Points are rounded to a multiple of this value (1 = no rounding). */
  roundingStep: number;
  /**
   * Q1 sub-question: does `double` points multiply only the base, or base plus
   * bonus? `'total'` multiplies the final result, `'base'` only the base.
   */
  doublePointsAppliesTo: 'total' | 'base';
  /** Award partial credit for partially correct answers (e.g. multiple choice). */
  partialCredit: boolean;
  /** Points for a wrong answer. */
  wrongAnswerPoints: number;
}

/** Default proposal for Q1. Configurable; see docs/architecture/README.md. */
export const DEFAULT_SCORING: ScoringConfig = {
  basePoints: 1000,
  speedBonusRatio: 0.5,
  speedCurve: 'linear',
  roundingStep: 1,
  doublePointsAppliesTo: 'total',
  partialCredit: false,
  wrongAnswerPoints: 0,
};

/** Q2 – how to treat an answer that arrives implausibly fast. */
export interface SpeedPolicy {
  /**
   * An answer faster than this many milliseconds is treated as suspicious.
   * `0` disables the rule entirely (the current default: the rule is
   * implemented but switched off until Q2 is answered).
   */
  minimumReactionMs: number;
  /** What to do with a suspicious answer. */
  onSuspicious: 'flag' | 'zero' | 'ignore';
}

/** Default proposal for Q2 – rule implemented, but not enforced yet. */
export const DEFAULT_SPEED_POLICY: SpeedPolicy = {
  minimumReactionMs: 0,
  onSuspicious: 'flag',
};

/** Q6 – how to order players with the same score. */
export type TieBreak = 'totalTime' | 'correctCount' | 'joinedAt';

/** Default proposal for Q6. The list is applied in order. */
export const DEFAULT_TIE_BREAK: TieBreak[] = ['correctCount', 'totalTime', 'joinedAt'];

/** Full scoring settings for one game. */
export interface ScoringSettings {
  scoring: ScoringConfig;
  speed: SpeedPolicy;
  tieBreak: TieBreak[];
}

/** The defaults, as one object, for a new game. */
export const DEFAULT_SCORING_SETTINGS: ScoringSettings = {
  scoring: DEFAULT_SCORING,
  speed: DEFAULT_SPEED_POLICY,
  tieBreak: DEFAULT_TIE_BREAK,
};

/** Why an answer did not score, for the reveal screen and the report. */
export type AnswerOutcome = 'correct' | 'partial' | 'wrong' | 'flagged' | 'unanswered';

/** The score for a single answer. */
export interface ScoreResult {
  points: number;
  outcome: AnswerOutcome;
  /** Share of the question solved, 0..1. Used for partial credit and reports. */
  correctness: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Speed factor in `[0, 1]`: 1 for an instant answer, 0 at the time limit.
 * This is the time-bonus curve behind Q1.
 */
export function speedFactor(
  elapsedMs: number,
  timeLimitSeconds: number,
  config: ScoringConfig,
): number {
  const limitMs = Math.max(TIME_MIN, Math.min(TIME_MAX, timeLimitSeconds)) * 1000;
  const remaining = clamp(1 - elapsedMs / limitMs, 0, 1);
  return config.speedCurve === 'quadratic' ? remaining * remaining : remaining;
}

function applyRounding(points: number, step: number): number {
  if (!Number.isFinite(step) || step <= 1) return Math.round(points);
  return Math.round(points / step) * step;
}

/**
 * Points for a fully or partially correct answer.
 *
 * `correctness` is 0..1; `1` is a fully correct answer. The result is
 * `base * (1 + speedBonusRatio * speed) * correctness` for a standard
 * question, multiplied by 2 for double points.
 */
export function scoreAnswer(
  question: Question,
  elapsedMs: number,
  correctness: number,
  settings: ScoringSettings = DEFAULT_SCORING_SETTINGS,
): ScoreResult {
  const { scoring } = settings;
  const safeCorrectness = clamp(correctness, 0, 1);

  if (question.points === 'none' || safeCorrectness <= 0) {
    return {
      points: safeCorrectness <= 0 ? scoring.wrongAnswerPoints : 0,
      outcome: safeCorrectness <= 0 ? 'wrong' : 'correct',
      correctness: safeCorrectness,
    };
  }

  const speed = speedFactor(elapsedMs, question.timeLimit, scoring);
  const bonus = scoring.speedBonusRatio * speed;
  const multiplier = question.points === 'double' ? 2 : 1;

  const points =
    question.points === 'double' && scoring.doublePointsAppliesTo === 'base'
      ? scoring.basePoints * multiplier * (1 + bonus)
      : scoring.basePoints * (1 + bonus) * multiplier;

  const scaled = scoring.partialCredit ? points * safeCorrectness : points;

  return {
    points: applyRounding(scaled, scoring.roundingStep),
    outcome: safeCorrectness >= 1 ? 'correct' : 'partial',
    correctness: safeCorrectness,
  };
}

/**
 * How correct a raw answer is for a question, as a value in 0..1.
 *
 * The shape of `answer` is type-specific and mirrors what the player sends:
 * option index, boolean, indices, string, number or string list.
 */
export function correctnessOf(question: Question, answer: unknown): number {
  switch (question.type) {
    case 'single':
      return answer === question.correctIndex ? 1 : 0;
    case 'trueFalse':
      return answer === question.correct ? 1 : 0;
    case 'multiple': {
      if (!Array.isArray(answer)) return 0;
      const given = new Set(answer.filter((item): item is number => Number.isInteger(item)));
      const expected = new Set(question.correctIndices);
      if (given.size === 0) return 0;
      const hits = [...given].filter((index) => expected.has(index)).length;
      const misses = [...given].filter((index) => !expected.has(index)).length;
      // Any wrong pick voids the answer; otherwise the share of correct picks.
      if (misses > 0) return 0;
      return hits / expected.size;
    }
    case 'text': {
      if (typeof answer !== 'string') return 0;
      const normalized = normalizeText(answer);
      if (normalized.length === 0) return 0;
      return question.accepted.some((accepted) => normalizeText(accepted) === normalized) ? 1 : 0;
    }
    case 'slider': {
      if (typeof answer !== 'number' || !Number.isFinite(answer)) return 0;
      const distance = Math.abs(answer - question.answer);
      if (distance <= question.tolerance) return 1;
      // Outside the tolerance: linear falloff over one tolerance width.
      const range = Math.max(question.max - question.min, 1);
      return clamp(1 - distance / range, 0, 1) * 0.5;
    }
    case 'order': {
      if (!Array.isArray(answer)) return 0;
      const given = answer.filter((item): item is string => typeof item === 'string');
      if (given.length !== question.items.length) return 0;
      const hits = given.filter((item, index) => item === question.items[index]).length;
      return hits / question.items.length;
    }
    case 'poll':
    case 'wordCloud':
    case 'open':
    case 'scale':
    case 'nps':
    case 'ideas':
      // Unscored: any answer counts as complete, none of them award points.
      return answer === null || answer === undefined ? 0 : 1;
    case 'slide':
      return 0;
  }
}

/** Whether an answer should be flagged under the Q2 speed policy. */
export function isSuspiciouslyFast(elapsedMs: number, policy: SpeedPolicy): boolean {
  return policy.minimumReactionMs > 0 && elapsedMs < policy.minimumReactionMs;
}

/** A player row the ranking operates on. */
export interface RankablePlayer {
  id: string;
  score: number;
  correctCount: number;
  /** Sum of reaction times in milliseconds; lower is better. */
  totalTimeMs: number;
  /** Join order; lower means earlier. */
  joinedAt: number;
}

/** Whether two players are tied under the configured rules. */
function isTied(a: RankablePlayer, b: RankablePlayer, tieBreak: TieBreak[]): boolean {
  if (a.score !== b.score) return false;
  for (const rule of tieBreak) {
    if (rule === 'correctCount' && a.correctCount !== b.correctCount) return false;
    if (rule === 'totalTime' && a.totalTimeMs !== b.totalTimeMs) return false;
    if (rule === 'joinedAt' && a.joinedAt !== b.joinedAt) return false;
  }
  return true;
}

function comparePlayers(a: RankablePlayer, b: RankablePlayer, tieBreak: TieBreak[]): number {
  if (b.score !== a.score) return b.score - a.score;
  for (const rule of tieBreak) {
    if (rule === 'correctCount' && b.correctCount !== a.correctCount) {
      return b.correctCount - a.correctCount;
    }
    if (rule === 'totalTime' && a.totalTimeMs !== b.totalTimeMs) {
      return a.totalTimeMs - b.totalTimeMs;
    }
    if (rule === 'joinedAt' && a.joinedAt !== b.joinedAt) {
      return a.joinedAt - b.joinedAt;
    }
  }
  return a.id.localeCompare(b.id);
}

/**
 * Rank players: highest score first, then the configured tie-breakers (Q6).
 * Returns a new array; the input is not mutated. Ranks are 1-based and
 * **shared** when two players are tied under every configured rule, so the next
 * distinct player skips the occupied ranks (1, 1, 3).
 */
export function rankPlayers(
  players: readonly RankablePlayer[],
  tieBreak: TieBreak[] = DEFAULT_TIE_BREAK,
): Array<RankablePlayer & { rank: number }> {
  const sorted = [...players].sort((a, b) => comparePlayers(a, b, tieBreak));

  const result: Array<RankablePlayer & { rank: number }> = [];
  let rank = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const player = sorted[index]!;
    const previous = index > 0 ? sorted[index - 1]! : undefined;
    if (previous === undefined || !isTied(previous, player, tieBreak)) {
      rank = index + 1;
    }
    result.push({ ...player, rank });
  }
  return result;
}
