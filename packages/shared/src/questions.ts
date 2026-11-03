/**
 * Question model vocabulary.
 *
 * Phase 0 defines the *shape* of a question and its per-type payloads so that the
 * backend, the editor and the engine can agree on the contract. The full
 * validation pipeline (`validate`, `coerce`, normalisation) is implemented in
 * Phase 1 on top of these types.
 */

import type { PointsMode, QuestionType } from './constants.js';

/** Fields shared by every question, regardless of type. */
export interface QuestionBase {
  /** Stable identifier assigned by the editor/database. */
  id: string;
  type: QuestionType;
  /** The question text (also used as the slide heading for `slide`). */
  text: string;
  /** Time limit in seconds. Ignored for `slide`. */
  timeLimit: number;
  /** Points mode. Always `none` for unscored types. */
  points: PointsMode;
}

/** A single choice question. */
export interface SingleChoiceQuestion extends QuestionBase {
  type: 'single';
  options: string[];
  /** Index into `options` of the correct answer. */
  correctIndex: number;
}

/** A true/false question. Options are fixed by the type. */
export interface TrueFalseQuestion extends QuestionBase {
  type: 'trueFalse';
  /** true = "True" is correct, false = "False" is correct. */
  correct: boolean;
}

/** A multiple choice question. */
export interface MultipleChoiceQuestion extends QuestionBase {
  type: 'multiple';
  options: string[];
  /** Indices of all correct options, ascending. */
  correctIndices: number[];
}

/** A free-text input question with accepted answers. */
export interface TextInputQuestion extends QuestionBase {
  type: 'text';
  /** Accepted answers; matching is normalised (case, accents, punctuation). */
  accepted: string[];
}

/** A slider question with a target value and tolerance. */
export interface SliderQuestion extends QuestionBase {
  type: 'slider';
  min: number;
  max: number;
  step: number;
  /** The correct value. */
  answer: number;
  /** Accepted deviation from `answer`. */
  tolerance: number;
  unit: string;
}

/** An ordering question. */
export interface OrderingQuestion extends QuestionBase {
  type: 'order';
  /** Elements in their correct order. */
  items: string[];
}

/** A poll (unscored single choice). */
export interface PollQuestion extends QuestionBase {
  type: 'poll';
  options: string[];
}

/** A word-cloud question (unscored free text). */
export interface WordCloudQuestion extends QuestionBase {
  type: 'wordCloud';
  maxLength: number;
}

/** An open question with longer free-text answers. */
export interface OpenQuestion extends QuestionBase {
  type: 'open';
  maxLength: number;
}

/** A stepped scale rating. */
export interface ScaleQuestion extends QuestionBase {
  type: 'scale';
  steps: number;
  lowLabel: string;
  highLabel: string;
}

/** A 0–10 recommendation question. */
export interface NpsQuestion extends QuestionBase {
  type: 'nps';
  lowLabel: string;
  highLabel: string;
}

/** A text slide: no answers, no timer. */
export interface SlideQuestion extends QuestionBase {
  type: 'slide';
  body: string;
}

/** An idea collection with a later voting phase. */
export interface IdeasQuestion extends QuestionBase {
  type: 'ideas';
  maxIdeas: number;
  maxVotes: number;
}

/** Discriminated union of all supported question types. */
export type Question =
  | SingleChoiceQuestion
  | TrueFalseQuestion
  | MultipleChoiceQuestion
  | TextInputQuestion
  | SliderQuestion
  | OrderingQuestion
  | PollQuestion
  | WordCloudQuestion
  | OpenQuestion
  | ScaleQuestion
  | NpsQuestion
  | SlideQuestion
  | IdeasQuestion;

/** A quiz is an ordered list of questions plus metadata. */
export interface Quiz {
  id: string;
  title: string;
  description: string;
  theme: string;
  defaultTimeLimit: number;
  questions: Question[];
}

/**
 * The type-specific fields a player or beamer may see while a question is open.
 *
 * This is an **allow-list**: solution fields (`correctIndex`, `correct`,
 * `correctIndices`, `accepted`, `answer`) are never copied, so the correct
 * answer cannot leak to the client before the reveal. The backend builds the
 * player payload through this function (see the game engine).
 *
 * Ordering questions are special: `correctnessOf` compares against the original
 * `items`, so the display presents a deterministic **shuffled** copy (see
 * `shuffleWithSeed`) that every client can reproduce.
 */

export function questionDisplay(question: Question): Record<string, unknown> {
  switch (question.type) {
    case 'single':
    case 'multiple':
    case 'poll':
      return { options: question.options };
    case 'trueFalse':
      return { options: [true, false] };
    case 'text':
      return {};
    case 'slider':
      return {
        min: question.min,
        max: question.max,
        step: question.step,
        unit: question.unit,
      };
    case 'order':
      // Shuffled, deterministically by id, so the correct order stays on the
      // server until the reveal. `correctnessOf` compares against the original
      // `items`, so the player sends their ordering of these displayed items.
      return { items: shuffleWithSeed(question.items, question.id) };
    case 'wordCloud':
    case 'open':
      return { maxLength: question.maxLength };
    case 'scale':
      return { steps: question.steps, lowLabel: question.lowLabel, highLabel: question.highLabel };
    case 'nps':
      return { lowLabel: question.lowLabel, highLabel: question.highLabel };
    case 'slide':
      return { body: question.body };
    case 'ideas':
      return { maxIdeas: question.maxIdeas, maxVotes: question.maxVotes };
  }
}

/**
 * A deterministic shuffle, seeded by a string.
 *
 * Seeding by the question id means the server and every client derive the same
 * shuffled order, so the reveal can show the correct order and the answer never
 * leaks beforehand.
 */
export function shuffleWithSeed<T>(items: readonly T[], seed: string): T[] {
  // mulberry32 PRNG seeded from a simple string hash.
  let state = 0x9e3779b9;
  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(state ^ seed.charCodeAt(index), 0x85ebca6b) >>> 0;
  }
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

/**
 * The display options of a rating question, in fixed order (never shuffled).
 * `nps` yields "0".."10"; all other scales yield "1"..steps.
 */
export function scaleOptions(question: ScaleQuestion | NpsQuestion): string[] {
  const count = question.type === 'nps' ? 11 : question.steps;
  const start = question.type === 'nps' ? 0 : 1;
  return Array.from({ length: count }, (_, i) => String(i + start));
}
