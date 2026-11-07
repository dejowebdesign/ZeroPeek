/**
 * Question rendering tests.
 *
 * These check that every one of the 13 types produces a control, that the
 * player input calls back with the exact payload shape the server expects, and
 * that the reveal view shows the distribution and the solution.
 */

import { describe, expect, it } from 'vitest';

import type { PublicQuestion, Question, QuestionType } from '@zeropeek/shared';
import { QUESTION_TYPE_IDS, questionDisplay } from '@zeropeek/shared';

import { questionInput, questionResult, solutionText } from './questionView.js';

/** A representative question per type. */
function sample(type: QuestionType): Question {
  const base = { id: `q-${type}`, text: 'Prompt', timeLimit: 20, points: 'standard' as const };
  switch (type) {
    case 'single':
      return { ...base, type, options: ['A', 'B'], correctIndex: 1 };
    case 'trueFalse':
      return { ...base, type, correct: true };
    case 'multiple':
      return { ...base, type, options: ['A', 'B', 'C'], correctIndices: [0, 2] };
    case 'text':
      return { ...base, type, accepted: ['paris'] };
    case 'slider':
      return { ...base, type, min: 0, max: 10, step: 1, answer: 5, tolerance: 1, unit: 'kg' };
    case 'order':
      return { ...base, type, items: ['one', 'two', 'three'] };
    case 'poll':
      return { ...base, type, options: ['A', 'B'] };
    case 'wordCloud':
      return { ...base, type, maxLength: 30 };
    case 'open':
      return { ...base, type, maxLength: 200 };
    case 'scale':
      return { ...base, type, steps: 5, lowLabel: 'low', highLabel: 'high' };
    case 'nps':
      return { ...base, type, lowLabel: 'no', highLabel: 'yes' };
    case 'slide':
      return { ...base, type, body: 'Body text' };
    case 'ideas':
      return { ...base, type, maxIdeas: 5, maxVotes: 3 };
  }
}

/** Wrap a question the way the server would send it to a player. */
function asPublic(question: Question): PublicQuestion {
  return {
    id: question.id,
    type: question.type,
    text: question.text,
    timeLimit: question.timeLimit,
    display: questionDisplay(question),
    openedAt: Date.now(),
    index: 0,
    total: 1,
    paused: false,
    remainingMs: null,
  };
}

describe('questionInput', () => {
  it('produces a control for every one of the 13 types', () => {
    for (const type of QUESTION_TYPE_IDS) {
      const node = questionInput(asPublic(sample(type)), () => undefined);
      expect(node.childElementCount).toBeGreaterThan(0);
    }
  });

  it('reports the option index for a single-choice question', () => {
    let answer: unknown;
    const node = questionInput(asPublic(sample('single')), (value) => (answer = value));
    const options = node.querySelectorAll('button.option');
    (options[1] as HTMLButtonElement).click();
    expect(answer).toBe(1);
  });

  it('reports a boolean for a true/false question', () => {
    let answer: unknown;
    const node = questionInput(asPublic(sample('trueFalse')), (value) => (answer = value));
    const options = node.querySelectorAll('button.option');
    (options[1] as HTMLButtonElement).click();
    expect(answer).toBe(false);
  });

  it('collects a sorted index list for multiple choice', () => {
    let answer: unknown;
    const node = questionInput(asPublic(sample('multiple')), (value) => (answer = value));
    const options = node.querySelectorAll('button.option');
    (options[2] as HTMLButtonElement).click();
    (options[0] as HTMLButtonElement).click();
    const submit = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Submit')!;
    submit.click();
    expect(answer).toEqual([0, 2]);
  });

  it('reports a trimmed string for a text question', () => {
    let answer: unknown;
    const node = questionInput(asPublic(sample('text')), (value) => (answer = value));
    const input = node.querySelector('input') as HTMLInputElement;
    input.value = '  Paris  ';
    const submit = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Submit')!;
    submit.click();
    expect(answer).toBe('Paris');
  });

  it('reports the displayed (shuffled) item order for an ordering question', () => {
    let answer: unknown;
    const publicQuestion = asPublic(sample('order'));
    const node = questionInput(publicQuestion, (value) => (answer = value));
    const submit = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Submit')!;
    submit.click();
    expect(answer).toEqual(publicQuestion.display.items);
  });

  it('ignores a second answer', () => {
    let count = 0;
    const node = questionInput(asPublic(sample('single')), () => (count += 1));
    const options = node.querySelectorAll('button.option');
    (options[0] as HTMLButtonElement).click();
    (options[1] as HTMLButtonElement).click();
    expect(count).toBe(1);
  });
});

describe('questionResult', () => {
  it('renders one bar per distinct answer, with the counts', () => {
    const question = asPublic(sample('single'));
    const node = questionResult(question, { '0': 3, '1': 1 });
    expect(node.querySelectorAll('.bar')).toHaveLength(2);
    expect(node.textContent).toContain('3');
    expect(node.textContent).toContain('75%');
  });

  it('shows the solution when one is given', () => {
    const question = asPublic(sample('single'));
    const node = questionResult(question, {}, 'B');
    expect(node.textContent).toContain('Correct: B');
  });

  it('says so when nothing was answered', () => {
    const node = questionResult(asPublic(sample('poll')), {});
    expect(node.textContent).toContain('No answers');
  });
});

describe('solutionText', () => {
  it('describes the answer for the scored types', () => {
    expect(solutionText(sample('single'))).toBe('B');
    expect(solutionText(sample('trueFalse'))).toBe('True');
    expect(solutionText(sample('multiple'))).toBe('A, C');
    expect(solutionText(sample('slider'))).toBe('5 kg');
    expect(solutionText(sample('order'))).toBe('one → two → three');
  });

  it('is empty for the unscored types', () => {
    for (const type of ['poll', 'wordCloud', 'open', 'scale', 'nps', 'slide', 'ideas'] as const) {
      expect(solutionText(sample(type))).toBe('');
    }
  });
});
