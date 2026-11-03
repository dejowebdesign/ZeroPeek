import { describe, expect, it } from 'vitest';

import { DEFAULT_SCORING, DEFAULT_SCORING_SETTINGS } from './scoring.js';
import {
  correctnessOf,
  isSuspiciouslyFast,
  rankPlayers,
  scoreAnswer,
  speedFactor,
  type RankablePlayer,
} from './scoring.js';
import { PIN_ALPHABET, PIN_LENGTH, generatePin, isValidPin, normalizePin } from './pin.js';
import type { Question } from './questions.js';

const single: Question = {
  id: 'q1',
  type: 'single',
  text: 'Pick one',
  timeLimit: 20,
  points: 'standard',
  options: ['a', 'b', 'c'],
  correctIndex: 1,
};

describe('speedFactor', () => {
  it('is 1 for an instant answer and 0 at the limit', () => {
    expect(speedFactor(0, 20, DEFAULT_SCORING)).toBe(1);
    expect(speedFactor(20_000, 20, DEFAULT_SCORING)).toBe(0);
  });

  it('is monotonic decreasing over time', () => {
    const early = speedFactor(2_000, 20, DEFAULT_SCORING);
    const late = speedFactor(18_000, 20, DEFAULT_SCORING);
    expect(early).toBeGreaterThan(late);
  });

  it('supports a quadratic curve', () => {
    const config = { ...DEFAULT_SCORING, speedCurve: 'quadratic' as const };
    // At the halfway point linear gives 0.5, quadratic gives 0.25.
    expect(speedFactor(10_000, 20, config)).toBeCloseTo(0.25, 5);
  });
});

describe('scoreAnswer', () => {
  it('awards more points for a faster correct answer', () => {
    const fast = scoreAnswer(single, 1_000, 1);
    const slow = scoreAnswer(single, 19_000, 1);
    expect(fast.points).toBeGreaterThan(slow.points);
    expect(fast.outcome).toBe('correct');
  });

  it('awards base points at the end of the window', () => {
    const slow = scoreAnswer(single, 20_000, 1);
    expect(slow.points).toBe(DEFAULT_SCORING.basePoints);
  });

  it('awards base + full bonus for an instant answer', () => {
    const instant = scoreAnswer(single, 0, 1);
    expect(instant.points).toBe(DEFAULT_SCORING.basePoints * 1.5);
  });

  it('gives no points for a wrong answer', () => {
    expect(scoreAnswer(single, 1_000, 0).points).toBe(0);
    expect(scoreAnswer(single, 1_000, 0).outcome).toBe('wrong');
  });

  it('doubles the total for a double-points question', () => {
    const double: Question = { ...single, points: 'double' };
    const standard = scoreAnswer(single, 5_000, 1);
    const doubled = scoreAnswer(double, 5_000, 1);
    expect(doubled.points).toBe(standard.points * 2);
  });

  it('can apply double points to the base only (Q1 option)', () => {
    const double: Question = { ...single, points: 'double' };
    const settings = {
      ...DEFAULT_SCORING_SETTINGS,
      scoring: { ...DEFAULT_SCORING, doublePointsAppliesTo: 'base' as const },
    };
    const instant = scoreAnswer(double, 0, 1, settings);
    // base*2*(1+0.5) = 3000, whereas 'total' would give 1000*1.5*2 = 3000 too.
    // Use a non-instant time so the two options actually differ.
    const mid = scoreAnswer(double, 10_000, 1, settings);
    expect(mid.points).toBe(2000 * 1.25);
    expect(instant.points).toBe(3000);
  });

  it('honours the rounding step', () => {
    const settings = {
      ...DEFAULT_SCORING_SETTINGS,
      scoring: { ...DEFAULT_SCORING, basePoints: 100, roundingStep: 10 },
    };
    expect(scoreAnswer(single, 3_333, 1, settings).points % 10).toBe(0);
  });

  it('awards nothing for an unscored question', () => {
    const poll: Question = {
      id: 'p',
      type: 'poll',
      text: '?',
      timeLimit: 20,
      points: 'none',
      options: ['a', 'b'],
    };
    expect(scoreAnswer(poll, 1_000, 1).points).toBe(0);
  });
});

describe('correctnessOf', () => {
  it('scores single choice', () => {
    expect(correctnessOf(single, 1)).toBe(1);
    expect(correctnessOf(single, 0)).toBe(0);
  });

  it('scores true/false', () => {
    const tf: Question = {
      id: 't',
      type: 'trueFalse',
      text: '?',
      timeLimit: 10,
      points: 'standard',
      correct: false,
    };
    expect(correctnessOf(tf, false)).toBe(1);
    expect(correctnessOf(tf, true)).toBe(0);
  });

  it('scores multiple choice with partial credit', () => {
    const mc: Question = {
      id: 'm',
      type: 'multiple',
      text: '?',
      timeLimit: 30,
      points: 'standard',
      options: ['a', 'b', 'c', 'd'],
      correctIndices: [0, 2],
    };
    expect(correctnessOf(mc, [0, 2])).toBe(1);
    expect(correctnessOf(mc, [0])).toBe(0.5);
    expect(correctnessOf(mc, [0, 1])).toBe(0); // a wrong pick voids the answer
    expect(correctnessOf(mc, [])).toBe(0);
  });

  it('matches text answers case- and accent-insensitively', () => {
    const text: Question = {
      id: 'x',
      type: 'text',
      text: '?',
      timeLimit: 30,
      points: 'standard',
      accepted: ['Café'],
    };
    expect(correctnessOf(text, '  cafe ')).toBe(1);
    expect(correctnessOf(text, 'CAFÉ')).toBe(1);
    expect(correctnessOf(text, 'tea')).toBe(0);
  });

  it('scores sliders with tolerance and falloff', () => {
    const slider: Question = {
      id: 's',
      type: 'slider',
      text: '?',
      timeLimit: 30,
      points: 'standard',
      min: 0,
      max: 100,
      step: 1,
      answer: 50,
      tolerance: 5,
      unit: '',
    };
    expect(correctnessOf(slider, 52)).toBe(1);
    expect(correctnessOf(slider, 50)).toBe(1);
    const far = correctnessOf(slider, 90);
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(0.5);
  });

  it('scores ordering by position', () => {
    const order: Question = {
      id: 'o',
      type: 'order',
      text: '?',
      timeLimit: 30,
      points: 'standard',
      items: ['a', 'b', 'c'],
    };
    expect(correctnessOf(order, ['a', 'b', 'c'])).toBe(1);
    expect(correctnessOf(order, ['a', 'c', 'b'])).toBeCloseTo(1 / 3, 5);
    expect(correctnessOf(order, ['a', 'b'])).toBe(0);
  });
});

describe('isSuspiciouslyFast (Q2)', () => {
  it('is disabled when the threshold is zero', () => {
    expect(isSuspiciouslyFast(1, { minimumReactionMs: 0, onSuspicious: 'flag' })).toBe(false);
  });

  it('flags answers below the threshold', () => {
    expect(isSuspiciouslyFast(100, { minimumReactionMs: 300, onSuspicious: 'flag' })).toBe(true);
    expect(isSuspiciouslyFast(500, { minimumReactionMs: 300, onSuspicious: 'flag' })).toBe(false);
  });
});

describe('rankPlayers (Q6)', () => {
  const players: RankablePlayer[] = [
    { id: 'a', score: 100, correctCount: 2, totalTimeMs: 5000, joinedAt: 1 },
    { id: 'b', score: 300, correctCount: 3, totalTimeMs: 9000, joinedAt: 2 },
    { id: 'c', score: 300, correctCount: 3, totalTimeMs: 4000, joinedAt: 3 },
  ];

  it('orders by score first', () => {
    const ranked = rankPlayers(players);
    expect(ranked.map((p) => p.id)).toEqual(['c', 'b', 'a']);
    expect(ranked.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it('breaks a score tie by reaction time', () => {
    const ranked = rankPlayers(players);
    expect(ranked[0]!.id).toBe('c'); // same score, faster total time
  });

  it('shares a rank for an exact tie', () => {
    const tied: RankablePlayer[] = [
      { id: 'x', score: 100, correctCount: 1, totalTimeMs: 1000, joinedAt: 1 },
      { id: 'y', score: 100, correctCount: 1, totalTimeMs: 1000, joinedAt: 1 },
    ];
    const ranked = rankPlayers(tied);
    expect(ranked.map((p) => p.rank)).toEqual([1, 1]);
  });

  it('skips occupied ranks after a tie (1, 1, 3)', () => {
    const tied: RankablePlayer[] = [
      { id: 'x', score: 100, correctCount: 1, totalTimeMs: 1000, joinedAt: 1 },
      { id: 'y', score: 100, correctCount: 1, totalTimeMs: 1000, joinedAt: 1 },
      { id: 'z', score: 50, correctCount: 1, totalTimeMs: 2000, joinedAt: 2 },
    ];
    expect(rankPlayers(tied).map((p) => p.rank)).toEqual([1, 1, 3]);
  });

  it('does not mutate the input', () => {
    const copy = [...players];
    rankPlayers(players);
    expect(players).toEqual(copy);
  });
});

describe('PIN', () => {
  it('generates a PIN of the right length from the safe alphabet', () => {
    const pin = generatePin();
    expect(pin).toHaveLength(PIN_LENGTH);
    for (const char of pin) expect(PIN_ALPHABET).toContain(char);
  });

  it('is deterministic for a fixed random source', () => {
    expect(generatePin(() => 0)).toBe(PIN_ALPHABET[0]!.repeat(PIN_LENGTH));
    expect(generatePin(() => 0.999999)).toHaveLength(PIN_LENGTH);
  });

  it('excludes ambiguous characters', () => {
    for (const char of '01ILOSB58') {
      expect(PIN_ALPHABET).not.toContain(char);
    }
  });

  it('normalises user input, dropping separators and ambiguous characters', () => {
    // Lower-case is upper-cased; separators, `1` and `B` are dropped.
    expect(normalizePin(' kq-rt 23 ')).toBe('KQRT23');
    expect(normalizePin('ab-cd 12')).toBe('ACD2');
  });

  it('validates only well-formed PINs', () => {
    expect(isValidPin(generatePin(() => 0.5))).toBe(true);
    expect(isValidPin('ABC')).toBe(false);
  });
});
