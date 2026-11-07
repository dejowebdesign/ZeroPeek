/**
 * Question edit-form tests.
 *
 * The form is rendered once and then only its handlers fire, so every field
 * must merge into the newest question. A regression test guards against a
 * handler spreading a stale snapshot and silently discarding another field's
 * edit (e.g. the prompt being lost when an option was typed afterwards).
 */

import { describe, expect, it } from 'vitest';

import type { Question } from '@zeropeek/shared';

import { questionForm } from './questionForm.js';

/** The input/select control of the field labelled `label`. */
function control(form: HTMLElement, label: string): HTMLInputElement {
  const field = [...form.querySelectorAll('label.field')].find(
    (node) => node.querySelector('.field__label')?.textContent === label,
  );
  const node = field?.querySelector('input, select, textarea');
  if (!node) throw new Error(`No control for field "${label}"`);
  return node as HTMLInputElement;
}

/** Set a value and fire the event the control listens to. */
function edit(node: HTMLInputElement, value: string, event = 'input'): void {
  node.value = value;
  node.dispatchEvent(new Event(event, { bubbles: true }));
}

/** The single-choice question used as the fixture. */
function single(): Question {
  return {
    id: 'q1',
    text: '',
    timeLimit: 20,
    points: 'standard',
    type: 'single',
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correctIndex: 0,
  };
}

describe('questionForm', () => {
  it('keeps an edit to one field when another field is edited afterwards', () => {
    let latest: Question = single();
    const form = questionForm(latest, (next) => {
      latest = next;
    });

    edit(control(form, 'Prompt'), 'What is the capital of France?');
    expect(latest.text).toBe('What is the capital of France?');

    // Typing an option must not revert the prompt to the empty original.
    const [first, second] = [
      ...form.querySelectorAll('.string-list__row input'),
    ] as HTMLInputElement[];
    if (!first || !second) throw new Error('Expected at least two option inputs');
    edit(first, 'Paris');
    edit(second, 'Berlin');

    expect(latest.text).toBe('What is the capital of France?');
    expect(latest.type === 'single' && latest.options.slice(0, 2)).toEqual(['Paris', 'Berlin']);
  });

  it('reports each change with a complete question for its type', () => {
    let latest: Question = single();
    const form = questionForm(latest, (next) => {
      latest = next;
    });

    edit(control(form, 'Prompt'), 'Prompt');
    edit(control(form, 'Time limit'), '30', 'change');
    edit(control(form, 'Points'), 'double', 'change');

    expect(latest).toMatchObject({ text: 'Prompt', timeLimit: 30, points: 'double' });
    expect(latest.type).toBe('single');
  });

  it('carries the optional category and difficulty labels (Phase 6.4)', () => {
    let latest: Question = single();
    const form = questionForm(latest, (next) => {
      latest = next;
    });

    edit(control(form, 'Category'), 'Geography');
    expect(latest.category).toBe('Geography');

    // A second field must not wipe the first one.
    edit(control(form, 'Difficulty'), 'Easy');
    expect(latest).toMatchObject({ category: 'Geography', difficulty: 'Easy' });

    // Clearing a label stores it as "not set", not as an empty string.
    edit(control(form, 'Category'), '');
    expect(latest.category).toBeUndefined();
    expect(latest.difficulty).toBe('Easy');
  });

  it('pre-fills the labels of an existing question', () => {
    const question: Question = { ...single(), category: 'Science', difficulty: 'Hard' };
    const form = questionForm(question, () => {});
    expect(control(form, 'Category').value).toBe('Science');
    expect(control(form, 'Difficulty').value).toBe('Hard');
  });
});
