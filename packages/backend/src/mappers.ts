/**
 * Mapping between Prisma rows and the `@zeropeek/shared` domain model.
 *
 * The database stores a question as columns (`type`, `text`, `timeLimit`,
 * `points`, `position`) plus a JSONB `payload` for the type-specific fields
 * (ADR 0004). The domain model is a discriminated union. These two functions
 * are the only place that knows both shapes, so the rest of the backend works
 * exclusively with the domain type.
 */

import type { PointsMode, Question, QuestionType, Quiz } from '@zeropeek/shared';

/** The shape of a `Question` row as returned by Prisma. */
export interface QuestionRow {
  id: string;
  quizId: string;
  type: string;
  text: string;
  timeLimit: number;
  points: string;
  position: number;
  payload: unknown;
}

/** The shape of a `Quiz` row with its questions, as returned by Prisma. */
export interface QuizRow {
  id: string;
  title: string;
  description: string;
  theme: string;
  defaultTimeLimit: number;
  questions: QuestionRow[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * Rebuild the domain question from a row. The type-specific fields live in
 * `payload`; the common fields are columns. Unknown types fall back to a slide
 * so a corrupted row can never crash the engine.
 */
export function toQuestion(row: QuestionRow): Question {
  const base = {
    id: row.id,
    text: row.text,
    timeLimit: row.timeLimit,
    points: row.points as PointsMode,
  };
  const payload = asRecord(row.payload);

  switch (row.type as QuestionType) {
    case 'single':
      return {
        ...base,
        type: 'single',
        options: (payload.options as string[]) ?? [],
        correctIndex: (payload.correctIndex as number) ?? 0,
      };
    case 'trueFalse':
      return { ...base, type: 'trueFalse', correct: Boolean(payload.correct) };
    case 'multiple':
      return {
        ...base,
        type: 'multiple',
        options: (payload.options as string[]) ?? [],
        correctIndices: (payload.correctIndices as number[]) ?? [],
      };
    case 'text':
      return { ...base, type: 'text', accepted: (payload.accepted as string[]) ?? [] };
    case 'slider':
      return {
        ...base,
        type: 'slider',
        min: (payload.min as number) ?? 0,
        max: (payload.max as number) ?? 100,
        step: (payload.step as number) ?? 1,
        answer: (payload.answer as number) ?? 0,
        tolerance: (payload.tolerance as number) ?? 0,
        unit: (payload.unit as string) ?? '',
      };
    case 'order':
      return { ...base, type: 'order', items: (payload.items as string[]) ?? [] };
    case 'poll':
      return { ...base, type: 'poll', options: (payload.options as string[]) ?? [] };
    case 'wordCloud':
      return { ...base, type: 'wordCloud', maxLength: (payload.maxLength as number) ?? 40 };
    case 'open':
      return { ...base, type: 'open', maxLength: (payload.maxLength as number) ?? 500 };
    case 'scale':
      return {
        ...base,
        type: 'scale',
        steps: (payload.steps as number) ?? 5,
        lowLabel: (payload.lowLabel as string) ?? '',
        highLabel: (payload.highLabel as string) ?? '',
      };
    case 'nps':
      return {
        ...base,
        type: 'nps',
        lowLabel: (payload.lowLabel as string) ?? '',
        highLabel: (payload.highLabel as string) ?? '',
      };
    case 'slide':
      return { ...base, type: 'slide', body: (payload.body as string) ?? '' };
    case 'ideas':
      return {
        ...base,
        type: 'ideas',
        maxIdeas: (payload.maxIdeas as number) ?? 5,
        maxVotes: (payload.maxVotes as number) ?? 3,
      };
    default:
      return { ...base, type: 'slide', body: row.text };
  }
}

/**
 * Split a domain question into the column values and the JSONB payload for
 * storage. The inverse of `toQuestion`.
 */
export function fromQuestion(question: Question): {
  type: string;
  text: string;
  timeLimit: number;
  points: string;
  payload: Record<string, unknown>;
} {
  const { id: _id, type, text, timeLimit, points, ...rest } = question;
  return { type, text, timeLimit, points, payload: rest as Record<string, unknown> };
}

/** Rebuild a full quiz (ordered by `position`) from rows. */
export function toQuiz(row: QuizRow): Quiz {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    theme: row.theme,
    defaultTimeLimit: row.defaultTimeLimit,
    questions: [...row.questions]
      .sort((a, b) => a.position - b.position)
      .map((question) => toQuestion(question)),
  };
}
