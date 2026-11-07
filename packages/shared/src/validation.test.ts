import { describe, expect, it } from 'vitest';

import { LABEL_MAX, QUESTION_TYPE_IDS, type QuestionType } from './constants.js';
import type { Question } from './questions.js';
import {
  parseSnapshotData,
  questionDisplay,
  SNAPSHOT_VERSION,
  snapshotToQuiz,
  toSnapshotData,
} from './questions.js';
import { allowedPointsModes, isAnswerable, validateQuestion, validateQuiz } from './validation.js';
import type { Quiz } from './questions.js';

/** One valid example per question type – the editor's "insert question" defaults. */
export const VALID_EXAMPLES: Record<QuestionType, Question> = {
  single: {
    id: 'q-single',
    type: 'single',
    text: 'Which planet is the largest?',
    timeLimit: 20,
    points: 'standard',
    options: ['Mars', 'Jupiter', 'Venus'],
    correctIndex: 1,
  },
  trueFalse: {
    id: 'q-trueFalse',
    type: 'trueFalse',
    text: 'The sun is a star.',
    timeLimit: 10,
    points: 'standard',
    correct: true,
  },
  multiple: {
    id: 'q-multiple',
    type: 'multiple',
    text: 'Which are prime?',
    timeLimit: 30,
    points: 'double',
    options: ['2', '4', '7', '9'],
    correctIndices: [0, 2],
  },
  text: {
    id: 'q-text',
    type: 'text',
    text: 'Capital of France?',
    timeLimit: 30,
    points: 'standard',
    accepted: ['Paris'],
  },
  slider: {
    id: 'q-slider',
    type: 'slider',
    text: 'How many?',
    timeLimit: 30,
    points: 'standard',
    min: 0,
    max: 100,
    step: 5,
    answer: 50,
    tolerance: 10,
    unit: 'kg',
  },
  order: {
    id: 'q-order',
    type: 'order',
    text: 'Sort ascending',
    timeLimit: 45,
    points: 'standard',
    items: ['one', 'two', 'three'],
  },
  poll: {
    id: 'q-poll',
    type: 'poll',
    text: 'Favourite?',
    timeLimit: 20,
    points: 'none',
    options: ['A', 'B'],
  },
  wordCloud: {
    id: 'q-wordCloud',
    type: 'wordCloud',
    text: 'One word please',
    timeLimit: 30,
    points: 'none',
    maxLength: 30,
  },
  open: {
    id: 'q-open',
    type: 'open',
    text: 'Explain',
    timeLimit: 60,
    points: 'none',
    maxLength: 500,
  },
  scale: {
    id: 'q-scale',
    type: 'scale',
    text: 'Rate',
    timeLimit: 20,
    points: 'none',
    steps: 5,
    lowLabel: 'low',
    highLabel: 'high',
  },
  nps: {
    id: 'q-nps',
    type: 'nps',
    text: 'Recommend?',
    timeLimit: 20,
    points: 'none',
    lowLabel: 'unlikely',
    highLabel: 'likely',
  },
  slide: {
    id: 'q-slide',
    type: 'slide',
    text: 'Welcome',
    timeLimit: 20,
    points: 'none',
    body: 'Some explanation',
  },
  ideas: {
    id: 'q-ideas',
    type: 'ideas',
    text: 'Your ideas',
    timeLimit: 90,
    points: 'none',
    maxIdeas: 5,
    maxVotes: 3,
  },
};

describe('question examples cover every type', () => {
  it('has exactly one valid example for each of the 13 types', () => {
    expect(Object.keys(VALID_EXAMPLES).sort()).toEqual([...QUESTION_TYPE_IDS].sort());
    expect(Object.keys(VALID_EXAMPLES)).toHaveLength(13);
  });

  it('passes validation for every example', () => {
    for (const type of QUESTION_TYPE_IDS) {
      const issues = validateQuestion(VALID_EXAMPLES[type]);
      expect(issues, `type ${type}: ${JSON.stringify(issues)}`).toEqual([]);
    }
  });

  it('agrees with the scored/unscored catalogue for points modes', () => {
    for (const type of QUESTION_TYPE_IDS) {
      const modes = allowedPointsModes(type);
      const question = VALID_EXAMPLES[type];
      expect(modes).toContain(question.points);
    }
  });

  it('marks only the slide as non-answerable', () => {
    const nonAnswerable = QUESTION_TYPE_IDS.filter((type) => !isAnswerable(type));
    expect(nonAnswerable).toEqual(['slide']);
  });
});

describe('validateQuestion', () => {
  it('rejects a single-choice index out of range', () => {
    const broken: Question = { ...VALID_EXAMPLES.single, correctIndex: 9 } as Question;
    expect(validateQuestion(broken).map((i) => i.path)).toContain('question.correctIndex');
  });

  it('rejects an empty option list', () => {
    const broken: Question = { ...VALID_EXAMPLES.poll, options: ['only'] } as Question;
    expect(validateQuestion(broken).map((i) => i.path)).toContain('question.options');
  });

  it('accepts a question with exactly four options', () => {
    const question: Question = {
      ...VALID_EXAMPLES.single,
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 3,
    } as Question;
    expect(validateQuestion(question)).toEqual([]);
  });

  it('rejects a question with more than four options', () => {
    for (const type of ['single', 'multiple', 'poll'] as const) {
      const broken: Question = {
        ...VALID_EXAMPLES[type],
        options: ['A', 'B', 'C', 'D', 'E'],
      } as Question;
      expect(
        validateQuestion(broken).map((i) => i.path),
        type,
      ).toContain('question.options');
    }
  });

  it('rejects an imported quiz whose question has five options', () => {
    const quiz: Quiz = {
      id: 'q',
      title: 'Imported',
      description: '',
      theme: 'standard',
      defaultTimeLimit: 20,
      questions: [
        {
          ...VALID_EXAMPLES.single,
          options: ['A', 'B', 'C', 'D', 'E'],
        } as Question,
      ],
    };
    expect(validateQuiz(quiz).ok).toBe(false);
  });

  it('names the four-option ceiling in the message', () => {
    const broken: Question = {
      ...VALID_EXAMPLES.poll,
      options: ['A', 'B', 'C', 'D', 'E'],
    } as Question;
    const message = validateQuestion(broken).find((i) => i.path === 'question.options')?.message;
    expect(message).toContain('4');
  });

  it('rejects a multiple-choice question where every option is correct', () => {
    const broken: Question = {
      ...VALID_EXAMPLES.multiple,
      correctIndices: [0, 1, 2, 3],
    } as Question;
    expect(validateQuestion(broken).map((i) => i.path)).toContain('question.correctIndices');
  });

  it('rejects points on an unscored type', () => {
    const broken: Question = { ...VALID_EXAMPLES.poll, points: 'standard' } as Question;
    expect(validateQuestion(broken).map((i) => i.path)).toContain('question.points');
  });

  it('rejects "none" points on a scored type', () => {
    const broken: Question = { ...VALID_EXAMPLES.single, points: 'none' } as Question;
    expect(validateQuestion(broken).map((i) => i.path)).toContain('question.points');
  });

  it('rejects an out-of-range time limit', () => {
    const broken: Question = { ...VALID_EXAMPLES.single, timeLimit: 1 } as Question;
    expect(validateQuestion(broken).map((i) => i.path)).toContain('question.timeLimit');
  });

  it('rejects a slider whose min is not below max', () => {
    const broken: Question = { ...VALID_EXAMPLES.slider, min: 100, max: 100 } as Question;
    expect(validateQuestion(broken).map((i) => i.path)).toContain('question.min');
  });

  it('rejects a scale with too few steps', () => {
    const broken: Question = { ...VALID_EXAMPLES.scale, steps: 1 } as Question;
    expect(validateQuestion(broken).map((i) => i.path)).toContain('question.steps');
  });

  it('allows a slide with no time limit constraint applied', () => {
    const slide: Question = { ...VALID_EXAMPLES.slide, timeLimit: 0 } as Question;
    expect(validateQuestion(slide).map((i) => i.path)).not.toContain('question.timeLimit');
  });
});

describe('validateQuiz', () => {
  const baseQuiz = (): Quiz => ({
    id: 'quiz-1',
    title: 'Demo',
    description: '',
    theme: 'standard',
    defaultTimeLimit: 20,
    questions: [VALID_EXAMPLES.single],
  });

  it('accepts a valid quiz', () => {
    const result = validateQuiz(baseQuiz());
    expect(result.ok).toBe(true);
  });

  it('rejects an empty question list', () => {
    const quiz = { ...baseQuiz(), questions: [] };
    const result = validateQuiz(quiz);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.path)).toContain('questions');
  });

  it('rejects duplicate question ids', () => {
    const quiz = { ...baseQuiz(), questions: [VALID_EXAMPLES.single, VALID_EXAMPLES.single] };
    const result = validateQuiz(quiz);
    expect(result.issues.map((i) => i.message)).toContain('Question ids must be unique.');
  });

  it('rejects a missing title', () => {
    const quiz = { ...baseQuiz(), title: '   ' };
    expect(validateQuiz(quiz).ok).toBe(false);
  });

  it('accepts optional category and difficulty labels', () => {
    const quiz: Quiz = { ...baseQuiz(), category: 'Geography', difficulty: 'Easy' };
    expect(validateQuiz(quiz).ok).toBe(true);
  });

  it('rejects an over-long label', () => {
    const quiz = { ...baseQuiz(), category: 'x'.repeat(LABEL_MAX + 1) };
    const result = validateQuiz(quiz);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.path)).toContain('category');
  });

  it('rejects an over-long question label', () => {
    const quiz = {
      ...baseQuiz(),
      questions: [{ ...VALID_EXAMPLES.single, difficulty: 'x'.repeat(LABEL_MAX + 1) }],
    };
    const result = validateQuiz(quiz);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.path)).toContain('questions.0.difficulty');
  });
});

describe('game snapshot round-trip', () => {
  const baseQuiz = (): Quiz => ({
    id: 'quiz-snap',
    title: 'Snapshot demo',
    description: 'desc',
    theme: 'standard',
    defaultTimeLimit: 15,
    category: 'Science',
    difficulty: 'Hard',
    questions: [VALID_EXAMPLES.single],
  });

  it('round-trips a quiz through the snapshot envelope', () => {
    const original = baseQuiz();
    const parsed = parseSnapshotData(toSnapshotData(original));
    expect(parsed).not.toBeNull();
    expect(snapshotToQuiz(parsed!.quiz)).toEqual(original);
  });

  it('deep-copies the questions, so a later edit cannot reach the snapshot', () => {
    const original = baseQuiz();
    const data = toSnapshotData(original);
    // Mutate the source after the snapshot was taken.
    (original.questions[0] as { text: string }).text = 'MUTATED';
    expect(data.quiz.questions[0]!.text).toBe('Which planet is the largest?');
  });

  it('keeps the frozen title when the live quiz is renamed', () => {
    const original = baseQuiz();
    const data = toSnapshotData(original);
    original.title = 'Renamed';
    expect(snapshotToQuiz(data.quiz).title).toBe('Snapshot demo');
  });

  it('returns null for a value that is not a snapshot', () => {
    expect(parseSnapshotData(null)).toBeNull();
    expect(parseSnapshotData('nope')).toBeNull();
    expect(parseSnapshotData({ quiz: {} })).toBeNull();
  });

  it('tolerates a snapshot from before the labels existed', () => {
    // No version, no category/difficulty – a row written by an older build.
    const legacy = {
      quiz: {
        quizId: 'quiz-old',
        title: 'Legacy',
        description: '',
        theme: 'standard',
        defaultTimeLimit: 20,
        questions: [VALID_EXAMPLES.single],
      },
    };
    const parsed = parseSnapshotData(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(SNAPSHOT_VERSION);
    expect(parsed!.quiz.category).toBeUndefined();
    expect(parsed!.quiz.questions).toHaveLength(1);
  });
});

describe('questionDisplay', () => {
  it('never exposes the correct answer of a scored question', () => {
    const leaked = ['correctIndex', 'correct', 'correctIndices', 'accepted', 'answer', 'tolerance'];
    for (const type of QUESTION_TYPE_IDS) {
      const display = questionDisplay(VALID_EXAMPLES[type]);
      for (const key of leaked) {
        expect(Object.keys(display), `${type} leaked ${key}`).not.toContain(key);
      }
    }
  });

  it('keeps the options for choice questions', () => {
    expect(questionDisplay(VALID_EXAMPLES.single)).toEqual({
      options: ['Mars', 'Jupiter', 'Venus'],
    });
  });

  it('keeps the slider bounds but not the answer', () => {
    const display = questionDisplay(VALID_EXAMPLES.slider);
    expect(display).toMatchObject({ min: 0, max: 100, step: 5, unit: 'kg' });
    expect(display).not.toHaveProperty('answer');
  });
});
