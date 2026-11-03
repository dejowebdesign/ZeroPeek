import { describe, expect, it } from 'vitest';

import {
  QUESTION_TYPES,
  QUESTION_TYPE_IDS,
  TEAM_NAMES,
  TIME_OPTIONS,
  GAME_PHASES,
  type QuestionType,
} from './constants.js';
import {
  questionDisplay,
  scaleOptions,
  shuffleWithSeed,
  type NpsQuestion,
  type ScaleQuestion,
} from './questions.js';

describe('question type catalogue', () => {
  it('contains exactly the 13 required question types', () => {
    expect(QUESTION_TYPE_IDS).toHaveLength(13);
  });

  it('includes the scored types', () => {
    const scored = QUESTION_TYPE_IDS.filter((id) => QUESTION_TYPES[id].scored);
    expect(scored).toEqual(['single', 'trueFalse', 'multiple', 'text', 'slider', 'order']);
  });

  it('marks the unscored types as such', () => {
    const unscored = QUESTION_TYPE_IDS.filter((id) => !QUESTION_TYPES[id].scored);
    expect(unscored).toEqual(['poll', 'wordCloud', 'open', 'scale', 'nps', 'slide', 'ideas']);
  });

  it('keeps every type identifier as a valid key', () => {
    for (const id of QUESTION_TYPE_IDS) {
      const key: QuestionType = id;
      expect(QUESTION_TYPES[key].label.length).toBeGreaterThan(0);
    }
  });
});

describe('constants', () => {
  it('exposes six unique team names', () => {
    expect(TEAM_NAMES).toHaveLength(6);
    expect(new Set(TEAM_NAMES).size).toBe(6);
  });

  it('offers ascending time options', () => {
    const sorted = [...TIME_OPTIONS].sort((a, b) => a - b);
    expect([...TIME_OPTIONS]).toEqual(sorted);
  });

  it('defines the game phases in order', () => {
    expect(GAME_PHASES[0]).toBe('lobby');
    expect(GAME_PHASES.at(-1)).toBe('end');
  });
});

describe('scaleOptions', () => {
  it('returns 1..steps for a scale question', () => {
    const q: ScaleQuestion = {
      id: 'q1',
      type: 'scale',
      text: 'Rate this',
      timeLimit: 20,
      points: 'none',
      steps: 5,
      lowLabel: 'low',
      highLabel: 'high',
    };
    expect(scaleOptions(q)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('returns 0..10 for an NPS question', () => {
    const q: NpsQuestion = {
      id: 'q2',
      type: 'nps',
      text: 'Would you recommend us?',
      timeLimit: 20,
      points: 'none',
      lowLabel: 'unlikely',
      highLabel: 'likely',
    };
    expect(scaleOptions(q)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  });
});

describe('shuffleWithSeed', () => {
  it('is deterministic for the same seed', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(shuffleWithSeed(items, 'seed-1')).toEqual(shuffleWithSeed(items, 'seed-1'));
  });

  it('differs across seeds (so the order is not predictable)', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const orders = new Set(
      ['s1', 's2', 's3', 's4', 's5'].map((seed) => shuffleWithSeed(items, seed).join('')),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('keeps every item and never mutates the input', () => {
    const items = ['x', 'y', 'z'];
    const shuffled = shuffleWithSeed(items, 'abc');
    expect([...shuffled].sort()).toEqual([...items].sort());
    expect(items).toEqual(['x', 'y', 'z']);
  });

  it('hides the correct order of an ordering question from the display payload', () => {
    const question = {
      id: 'q-1',
      type: 'order' as const,
      text: 'Order the steps',
      timeLimit: 20,
      points: 'standard' as const,
      items: ['one', 'two', 'three', 'four', 'five'],
    };
    const display = questionDisplay(question) as { items: string[] };
    // The displayed order is a permutation, and (for this seed) not the answer.
    expect([...display.items].sort()).toEqual([...question.items].sort());
    expect(display.items).not.toEqual(question.items);
  });
});
