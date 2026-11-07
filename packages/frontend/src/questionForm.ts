/**
 * Edit form and factory for every question type.
 *
 * `newQuestion` produces a valid starting question for a type; `questionForm`
 * renders the type-specific fields and calls `onChange` with the updated
 * question whenever a field changes. The form keeps the question object valid
 * for its type, so the local `validateQuiz` on save rarely fails.
 */

import {
  DEFAULT_TIME,
  IDEAS_MAX,
  IDEA_VOTES,
  LABEL_MAX,
  MAX_ANSWER_OPTIONS,
  MIN_ANSWER_OPTIONS,
  OPTION_TEXT_MAX,
  QUESTION_TEXT_MAX,
  SCALE_MAX_STEPS,
  SCALE_MIN_STEPS,
  SLIDE_BODY_MAX,
  TIME_OPTIONS,
  type PointsMode,
  type Question,
  type QuestionType,
} from '@zeropeek/shared';

import { el } from './dom.js';
import { button, field } from './ui.js';

/** A unique-enough id for a question created in the editor. */
function newId(): string {
  return crypto.randomUUID();
}

/** The default number of options. */
const DEFAULT_OPTIONS = ['Option A', 'Option B', 'Option C', 'Option D'];

/** Build a valid starter question of the given type. */
export function newQuestion(type: QuestionType, defaultTime = DEFAULT_TIME): Question {
  const base = { id: newId(), text: '', timeLimit: defaultTime, points: 'standard' as PointsMode };
  switch (type) {
    case 'single':
      return { ...base, type, options: [...DEFAULT_OPTIONS], correctIndex: 0 };
    case 'trueFalse':
      return { ...base, type, correct: true };
    case 'multiple':
      return { ...base, type, options: [...DEFAULT_OPTIONS], correctIndices: [0] };
    case 'text':
      return { ...base, type, accepted: [''] };
    case 'slider':
      return {
        ...base,
        type,
        min: 0,
        max: 100,
        step: 1,
        answer: 50,
        tolerance: 1,
        unit: '',
      };
    case 'order':
      return { ...base, type, items: ['First', 'Second', 'Third'] };
    case 'poll':
      return { ...base, type, points: 'none', options: [...DEFAULT_OPTIONS] };
    case 'wordCloud':
      return { ...base, type, points: 'none', maxLength: 40 };
    case 'open':
      return { ...base, type, points: 'none', maxLength: 500 };
    case 'scale':
      return { ...base, type, points: 'none', steps: 5, lowLabel: 'low', highLabel: 'high' };
    case 'nps':
      return { ...base, type, points: 'none', lowLabel: 'not likely', highLabel: 'very likely' };
    case 'slide':
      return { ...base, type, points: 'none', body: '' };
    case 'ideas':
      return { ...base, type, points: 'none', maxIdeas: IDEAS_MAX, maxVotes: IDEA_VOTES };
  }
}

/** A text input that reports changes. */
function textInput(
  value: string,
  onChange: (value: string) => void,
  options: { maxlength?: number; placeholder?: string; type?: string } = {},
): HTMLInputElement {
  const input = el('input', {
    class: 'input',
    value,
    ...(options.maxlength ? { maxlength: String(options.maxlength) } : {}),
    ...(options.placeholder ? { placeholder: options.placeholder } : {}),
    ...(options.type ? { type: options.type } : {}),
  });
  input.addEventListener('input', () => onChange(input.value));
  return input;
}

/** A numeric input that reports changes as numbers. */
function numberInput(
  value: number,
  onChange: (value: number) => void,
  options: { min?: number; max?: number; step?: number } = {},
): HTMLInputElement {
  const input = el('input', {
    class: 'input',
    type: 'number',
    value: String(value),
    ...(options.min !== undefined ? { min: String(options.min) } : {}),
    ...(options.max !== undefined ? { max: String(options.max) } : {}),
    ...(options.step !== undefined ? { step: String(options.step) } : {}),
  });
  input.addEventListener('input', () => onChange(Number(input.value)));
  return input;
}

/** A textarea that reports changes. */
function textArea(
  value: string,
  onChange: (value: string) => void,
  maxlength?: number,
): HTMLTextAreaElement {
  const node = el('textarea', {
    class: 'input',
    rows: '3',
    ...(maxlength ? { maxlength: String(maxlength) } : {}),
  });
  node.value = value;
  node.addEventListener('input', () => onChange(node.value));
  return node;
}

/** A checkbox that reports changes. */
function checkbox(
  label: string,
  checked: boolean,
  onChange: (value: boolean) => void,
): HTMLElement {
  const input = el('input', { type: 'checkbox', ...(checked ? { checked: true } : {}) });
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'checkbox' }, input, el('span', null, label));
}

/** An editable list of short strings (options, items, accepted answers). */
function stringList(
  values: string[],
  onChange: (values: string[]) => void,
  options: { min?: number; max?: number; maxlength?: number; placeholder?: string } = {},
): HTMLElement {
  const wrap = el('div', { class: 'string-list' });
  const paint = (): void => {
    wrap.replaceChildren(
      ...values.map((value, index) =>
        el(
          'div',
          { class: 'string-list__row' },
          textInput(
            value,
            (next) => {
              values[index] = next;
              onChange([...values]);
            },
            { maxlength: options.maxlength, placeholder: options.placeholder },
          ),
          button('✕', {
            variant: 'danger',
            onClick: () => {
              if (options.min !== undefined && values.length <= options.min) return;
              values.splice(index, 1);
              onChange([...values]);
              paint();
            },
          }),
        ),
      ),
    );
    const canAdd = options.max === undefined || values.length < options.max;
    if (canAdd) {
      wrap.append(
        button('+ Add', {
          onClick: () => {
            values.push('');
            onChange([...values]);
            paint();
          },
        }),
      );
    }
  };
  paint();
  return wrap;
}

/** The shared header fields (prompt, time limit, points, optional labels). */
function commonFields(get: () => Question, onChange: (next: Question) => void): HTMLElement {
  const question = get();
  const timeSelect = el(
    'select',
    { class: 'input' },
    ...TIME_OPTIONS.map((seconds) =>
      el(
        'option',
        { value: String(seconds), ...(seconds === question.timeLimit ? { selected: true } : {}) },
        `${seconds}s`,
      ),
    ),
  );
  timeSelect.addEventListener('change', () =>
    onChange({ ...get(), timeLimit: Number(timeSelect.value) }),
  );

  const pointsSelect = el(
    'select',
    { class: 'input' },
    ...[
      ['standard', 'Standard'],
      ['double', 'Double'],
      ['none', 'No points'],
    ].map(([value, label]) =>
      el('option', { value, ...(value === question.points ? { selected: true } : {}) }, label),
    ),
  );
  pointsSelect.addEventListener('change', () =>
    onChange({ ...get(), points: pointsSelect.value as PointsMode }),
  );

  // Category and difficulty are free-text and optional (Phase 6.4). No fixed
  // taxonomy exists yet, so the field suggests nothing and accepts anything
  // within the length limit. An emptied field is stored as "not set".
  const category = textInput(
    question.category ?? '',
    (value) => onChange({ ...get(), category: value.trim() || undefined }),
    { maxlength: LABEL_MAX, placeholder: 'e.g. Geography (optional)' },
  );
  const difficulty = textInput(
    question.difficulty ?? '',
    (value) => onChange({ ...get(), difficulty: value.trim() || undefined }),
    { maxlength: LABEL_MAX, placeholder: 'e.g. Easy (optional)' },
  );

  return el(
    'div',
    { class: 'question-form__head' },
    el(
      'div',
      { class: 'grid grid--3' },
      field(
        'Prompt',
        textInput(question.text, (text) => onChange({ ...get(), text }), {
          maxlength: QUESTION_TEXT_MAX,
          placeholder: 'Your question',
        }),
      ),
      field('Time limit', timeSelect),
      field('Points', pointsSelect),
    ),
    el(
      'div',
      { class: 'grid grid--2' },
      field('Category', category),
      field('Difficulty', difficulty),
    ),
  );
}

/**
 * Render the type-specific fields for a question. `onChange` receives a new,
 * complete question object each time.
 */
export function questionForm(question: Question, onChange: (next: Question) => void): HTMLElement {
  const form = el('div', { class: 'question-form' });
  // The form is not re-rendered between edits, so every handler must merge into
  // the newest question. Spreading the original `question` would drop edits made
  // to other fields.
  let latest = question;
  const update = (patch: Partial<Question>): void => {
    latest = { ...latest, ...patch } as Question;
    onChange(latest);
  };
  form.append(commonFields(() => latest, update));

  switch (question.type) {
    case 'single': {
      form.append(
        el('p', { class: 'muted' }, 'Mark the correct option.'),
        stringList([...question.options], (options) => update({ options }), {
          min: MIN_ANSWER_OPTIONS,
          max: MAX_ANSWER_OPTIONS,
          maxlength: OPTION_TEXT_MAX,
        }),
      );
      const radios = el(
        'div',
        { class: 'radio-row' },
        ...question.options.map((_, index) =>
          el(
            'label',
            { class: 'radio' },
            el('input', {
              type: 'radio',
              name: `correct-${question.id}`,
              ...(index === question.correctIndex ? { checked: true } : {}),
              onchange: () => update({ correctIndex: index }),
            }),
            el('span', null, `#${index + 1}`),
          ),
        ),
      );
      form.append(field('Correct option', radios));
      break;
    }

    case 'trueFalse':
      form.append(
        field(
          'Correct answer',
          el(
            'div',
            { class: 'radio-row' },
            ...[
              ['True', true],
              ['False', false],
            ].map(([label, value]) =>
              el(
                'label',
                { class: 'radio' },
                el('input', {
                  type: 'radio',
                  name: `tf-${question.id}`,
                  ...(question.correct === value ? { checked: true } : {}),
                  onchange: () => update({ correct: value as boolean }),
                }),
                el('span', null, label as string),
              ),
            ),
          ),
        ),
      );
      break;

    case 'multiple': {
      form.append(
        el('p', { class: 'muted' }, 'Mark every correct option.'),
        stringList([...question.options], (options) => update({ options }), {
          min: MIN_ANSWER_OPTIONS,
          max: MAX_ANSWER_OPTIONS,
          maxlength: OPTION_TEXT_MAX,
        }),
      );
      const boxes = el(
        'div',
        { class: 'radio-row' },
        ...question.options.map((_, index) =>
          el(
            'label',
            { class: 'checkbox' },
            el('input', {
              type: 'checkbox',
              ...(question.correctIndices.includes(index) ? { checked: true } : {}),
              onchange: (event: Event) => {
                const checked = (event.target as HTMLInputElement).checked;
                const set = new Set(question.correctIndices);
                if (checked) set.add(index);
                else set.delete(index);
                update({ correctIndices: [...set].sort((a, b) => a - b) });
              },
            }),
            el('span', null, `#${index + 1}`),
          ),
        ),
      );
      form.append(field('Correct options', boxes));
      break;
    }

    case 'text':
      form.append(
        el('p', { class: 'muted' }, 'Accepted answers (compared case- and accent-insensitively).'),
        stringList([...question.accepted], (accepted) => update({ accepted }), {
          min: 1,
          placeholder: 'Accepted answer',
        }),
      );
      break;

    case 'slider':
      form.append(
        el(
          'div',
          { class: 'grid grid--3' },
          field(
            'Minimum',
            numberInput(question.min, (min) => update({ min })),
          ),
          field(
            'Maximum',
            numberInput(question.max, (max) => update({ max })),
          ),
          field(
            'Step',
            numberInput(question.step, (step) => update({ step }), { min: 1 }),
          ),
        ),
        el(
          'div',
          { class: 'grid grid--3' },
          field(
            'Correct value',
            numberInput(question.answer, (answer) => update({ answer })),
          ),
          field(
            'Tolerance',
            numberInput(question.tolerance, (tolerance) => update({ tolerance }), {
              min: 0,
            }),
          ),
          field(
            'Unit',
            textInput(question.unit, (unit) => update({ unit }), {
              placeholder: 'e.g. kg',
            }),
          ),
        ),
      );
      break;

    case 'order':
      form.append(
        el(
          'p',
          { class: 'muted' },
          'Enter the items in the correct order. Players see them shuffled.',
        ),
        stringList([...question.items], (items) => update({ items }), {
          min: 2,
          placeholder: 'Item',
        }),
      );
      break;

    case 'poll':
      form.append(
        el('p', { class: 'muted' }, 'A poll has no correct answer.'),
        stringList([...question.options], (options) => update({ options }), {
          min: MIN_ANSWER_OPTIONS,
          max: MAX_ANSWER_OPTIONS,
          maxlength: OPTION_TEXT_MAX,
        }),
      );
      break;

    case 'wordCloud':
    case 'open':
      form.append(
        field(
          'Maximum length',
          numberInput(question.maxLength, (maxLength) => update({ maxLength }), {
            min: 1,
            max: 2000,
          }),
        ),
      );
      break;

    case 'scale':
      form.append(
        el(
          'div',
          { class: 'grid grid--3' },
          field(
            'Steps',
            numberInput(question.steps, (steps) => update({ steps }), {
              min: SCALE_MIN_STEPS,
              max: SCALE_MAX_STEPS,
            }),
          ),
          field(
            'Low label',
            textInput(question.lowLabel, (lowLabel) => update({ lowLabel })),
          ),
          field(
            'High label',
            textInput(question.highLabel, (highLabel) => update({ highLabel })),
          ),
        ),
      );
      break;

    case 'nps':
      form.append(
        el(
          'div',
          { class: 'grid grid--2' },
          field(
            'Low label',
            textInput(question.lowLabel, (lowLabel) => update({ lowLabel })),
          ),
          field(
            'High label',
            textInput(question.highLabel, (highLabel) => update({ highLabel })),
          ),
        ),
      );
      break;

    case 'slide':
      form.append(
        field(
          'Body',
          textArea(question.body, (body) => update({ body }), SLIDE_BODY_MAX),
        ),
      );
      break;

    case 'ideas':
      form.append(
        el(
          'div',
          { class: 'grid grid--2' },
          field(
            'Max ideas per player',
            numberInput(question.maxIdeas, (maxIdeas) => update({ maxIdeas }), {
              min: 1,
              max: IDEAS_MAX,
            }),
          ),
          field(
            'Votes per player',
            numberInput(question.maxVotes, (maxVotes) => update({ maxVotes }), {
              min: 1,
              max: IDEA_VOTES,
            }),
          ),
        ),
      );
      break;
  }

  return form;
}
