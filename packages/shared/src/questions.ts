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
 * `correctIndices`, `accepted`, `answer`, `items` order) are never copied, so
 * the correct answer cannot leak to the client before the reveal. The backend
 * builds the player payload through this function (see the game engine).
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
      // The items are shown shuffled; the correct order stays on the server.
      return { items: question.items };
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
 * The display options of a rating question, in fixed order (never shuffled).
 * `nps` yields "0".."10"; all other scales yield "1"..steps.
 */
export function scaleOptions(question: ScaleQuestion | NpsQuestion): string[] {
  const count = question.type === 'nps' ? 11 : question.steps;
  const start = question.type === 'nps' ? 0 : 1;
  return Array.from({ length: count }, (_, i) => String(i + start));
}
