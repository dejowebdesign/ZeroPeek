/**
 * Question rendering for the three surfaces.
 *
 * `questionInput` builds the player's answer control for any of the 13 types
 * and calls back with the answer payload the server expects. `questionResult`
 * renders the reveal/beamer view. Both read only `display`, the solution-free
 * view the server sends, so no answer can leak from these components.
 */

import type { PublicQuestion, Question } from '@zeropeek/shared';
import { scaleOptions } from '@zeropeek/shared';

import { el } from './dom.js';
import { button } from './ui.js';

/** Read a display field with a fallback. */
function display<T>(question: PublicQuestion, key: string, fallback: T): T {
  const value = question.display?.[key];
  return (value === undefined ? fallback : value) as T;
}

/** The prompt shown above every input. */
export function questionPrompt(question: PublicQuestion): HTMLElement {
  return el('h2', { class: 'question__prompt' }, question.text);
}

/**
 * The answer control. `onAnswer` is called exactly once with the payload the
 * server expects for this type. For `slide` there is no control at all.
 */
export function questionInput(
  question: PublicQuestion,
  onAnswer: (answer: unknown) => void,
): HTMLElement {
  const wrap = el('div', { class: 'question__input' });
  let answered = false;
  const answer = (value: unknown): void => {
    if (answered) return;
    answered = true;
    onAnswer(value);
  };

  switch (question.type) {
    case 'single':
    case 'poll': {
      const options = display<string[]>(question, 'options', []);
      options.forEach((label, index) => {
        wrap.append(
          el(
            'button',
            {
              class: 'option',
              type: 'button',
              onclick: () => answer(index),
            },
            el('span', { class: 'option__key' }, String(index + 1)),
            el('span', { class: 'option__label' }, label),
          ),
        );
      });
      break;
    }

    case 'trueFalse': {
      for (const [label, value] of [
        ['True', true],
        ['False', false],
      ] as const) {
        wrap.append(
          el(
            'button',
            { class: 'option', type: 'button', onclick: () => answer(value) },
            el('span', { class: 'option__label' }, label),
          ),
        );
      }
      break;
    }

    case 'multiple': {
      const options = display<string[]>(question, 'options', []);
      const chosen = new Set<number>();
      const boxes: HTMLButtonElement[] = [];
      options.forEach((label, index) => {
        const box = el(
          'button',
          {
            class: 'option',
            type: 'button',
            onclick: () => {
              if (chosen.has(index)) chosen.delete(index);
              else chosen.add(index);
              boxes[index]!.classList.toggle('option--chosen', chosen.has(index));
            },
          },
          el('span', { class: 'option__key' }, String(index + 1)),
          el('span', { class: 'option__label' }, label),
        );
        boxes.push(box);
        wrap.append(box);
      });
      wrap.append(
        button('Submit', {
          variant: 'primary',
          onClick: () => answer([...chosen].sort((a, b) => a - b)),
        }),
      );
      break;
    }

    case 'text': {
      const input = el('input', { class: 'input', type: 'text', placeholder: 'Your answer' });
      const submit = (): void => answer(input.value.trim());
      input.addEventListener('keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Enter') submit();
      });
      wrap.append(input, button('Submit', { variant: 'primary', onClick: submit }));
      break;
    }

    case 'slider': {
      const min = display<number>(question, 'min', 0);
      const max = display<number>(question, 'max', 100);
      const step = display<number>(question, 'step', 1);
      const unit = display<string>(question, 'unit', '');
      const valueLabel = el('strong', { class: 'slider__value' }, String(min));
      const input = el('input', {
        class: 'slider',
        type: 'range',
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(Math.round((min + max) / 2)),
      });
      valueLabel.textContent = `${input.value}${unit ? ` ${unit}` : ''}`;
      input.addEventListener('input', () => {
        valueLabel.textContent = `${input.value}${unit ? ` ${unit}` : ''}`;
      });
      wrap.append(
        valueLabel,
        input,
        button('Submit', { variant: 'primary', onClick: () => answer(Number(input.value)) }),
      );
      break;
    }

    case 'order': {
      // The server sends the items already shuffled. The player reorders them
      // and submits the resulting sequence.
      let items = [...display<string[]>(question, 'items', [])];
      const list = el('ul', { class: 'order-list' });
      const paint = (): void => {
        list.replaceChildren(
          ...items.map((item, index) =>
            el(
              'li',
              { class: 'order-item' },
              el('span', { class: 'order-item__label' }, item),
              el(
                'span',
                { class: 'order-item__controls' },
                button('↑', {
                  onClick: () => {
                    if (index === 0) return;
                    [items[index - 1], items[index]] = [items[index]!, items[index - 1]!];
                    paint();
                  },
                }),
                button('↓', {
                  onClick: () => {
                    if (index === items.length - 1) return;
                    [items[index + 1], items[index]] = [items[index]!, items[index + 1]!];
                    paint();
                  },
                }),
              ),
            ),
          ),
        );
      };
      paint();
      wrap.append(list, button('Submit', { variant: 'primary', onClick: () => answer(items) }));
      break;
    }

    case 'scale':
    case 'nps': {
      const options =
        question.type === 'nps'
          ? scaleOptions({ type: 'nps', lowLabel: '', highLabel: '' } as never)
          : Array.from({ length: display<number>(question, 'steps', 5) }, (_, i) => String(i + 1));
      const row = el('div', { class: 'scale-row' });
      options.forEach((label) => {
        row.append(
          el(
            'button',
            { class: 'scale-step', type: 'button', onclick: () => answer(Number(label)) },
            label,
          ),
        );
      });
      wrap.append(row);
      const low = display<string>(question, 'lowLabel', '');
      const high = display<string>(question, 'highLabel', '');
      if (low || high) {
        wrap.append(
          el('div', { class: 'scale-legend muted' }, el('span', null, low), el('span', null, high)),
        );
      }
      break;
    }

    case 'wordCloud':
    case 'open': {
      const maxLength = display<number>(question, 'maxLength', 200);
      const input = el('input', {
        class: 'input',
        type: 'text',
        maxlength: String(maxLength),
        placeholder: 'Your answer',
      });
      const submit = (): void => answer(input.value.trim());
      input.addEventListener('keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Enter') submit();
      });
      wrap.append(input, button('Submit', { variant: 'primary', onClick: submit }));
      break;
    }

    case 'ideas': {
      const maxIdeas = display<number>(question, 'maxIdeas', 5);
      const ideas: string[] = [];
      const list = el('ul', { class: 'idea-list' });
      const input = el('input', { class: 'input', type: 'text', placeholder: 'Add an idea' });
      const add = (): void => {
        const value = input.value.trim();
        if (!value || ideas.length >= maxIdeas) return;
        ideas.push(value);
        input.value = '';
        list.append(el('li', null, value));
      };
      input.addEventListener('keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Enter') add();
      });
      wrap.append(
        input,
        button('Add', { onClick: add }),
        list,
        button('Submit', { variant: 'primary', onClick: () => answer(ideas) }),
      );
      break;
    }

    case 'slide':
      // Slides have no answer; the host advances when ready.
      wrap.append(el('p', { class: 'muted' }, 'This is a slide – no answer needed.'));
      break;
  }

  return wrap;
}

/** Format one option's share for the result view. */
function bar(label: string, count: number, total: number): HTMLElement {
  const share = total === 0 ? 0 : Math.round((count / total) * 100);
  return el(
    'div',
    { class: 'bar' },
    el(
      'div',
      { class: 'bar__head' },
      el('span', { class: 'bar__label' }, label),
      el('span', { class: 'bar__count muted' }, `${count} · ${share}%`),
    ),
    el(
      'div',
      { class: 'bar__track' },
      el('div', { class: 'bar__fill', style: { width: `${share}%` } }),
    ),
  );
}

/**
 * The correct answer, as text, for the beamer. Only ever called after the
 * reveal, so showing the solution here cannot leak it to players.
 */
export function solutionText(question: Question): string {
  switch (question.type) {
    case 'single':
      return question.options[question.correctIndex] ?? '';
    case 'trueFalse':
      return question.correct ? 'True' : 'False';
    case 'multiple':
      return question.correctIndices.map((index) => question.options[index] ?? '').join(', ');
    case 'text':
      return question.accepted[0] ?? '';
    case 'slider':
      return `${question.answer}${question.unit ? ` ${question.unit}` : ''}`;
    case 'order':
      return question.items.join(' → ');
    case 'poll':
    case 'wordCloud':
    case 'open':
    case 'scale':
    case 'nps':
    case 'slide':
    case 'ideas':
      return '';
  }
}

/**
 * The reveal view: the question plus how the answers were distributed.
 * `distribution` is keyed by `JSON.stringify(answer)`, exactly what the engine
 * recorded, so it is only ever shown after the reveal.
 */
export function questionResult(
  question: Pick<PublicQuestion, 'text' | 'type' | 'display'>,
  distribution: Record<string, number>,
  solution?: string,
): HTMLElement {
  const total = Object.values(distribution).reduce((sum, value) => sum + value, 0);
  const wrap = el(
    'div',
    { class: 'question__result' },
    el('h2', { class: 'question__prompt' }, question.text),
  );
  if (solution) {
    wrap.append(el('p', { class: 'question__solution' }, `Correct: ${solution}`));
  }

  const label = (key: string): string => {
    try {
      const value = JSON.parse(key) as unknown;
      if (Array.isArray(value)) return value.join(', ');
      if (typeof value === 'boolean') return value ? 'True' : 'False';
      return String(value);
    } catch {
      return key;
    }
  };

  for (const [key, count] of Object.entries(distribution).sort((a, b) => b[1] - a[1])) {
    wrap.append(bar(label(key), count, total));
  }
  if (total === 0) wrap.append(el('p', { class: 'muted' }, 'No answers.'));
  return wrap;
}
