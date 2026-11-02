/**
 * Validation and normalisation for the quiz domain.
 *
 * The same code runs in the editor (inline feedback), in the REST API (every
 * write) and in the game engine (every socket payload), so client and server
 * can never disagree about what a valid question is. Pure functions only: no
 * `node:` imports, no DOM, so the module stays usable from the browser.
 *
 * See ADR 0005 – the shared package is the single source of truth.
 */

import {
  IDEA_TEXT_MAX,
  IDEA_VOTES,
  IDEAS_MAX,
  MAX_ANSWER_OPTIONS,
  MIN_ANSWER_OPTIONS,
  OPTION_TEXT_MAX,
  QUESTION_TEXT_MAX,
  QUESTION_TYPES,
  QUIZ_TITLE_MAX,
  SCALE_MAX_STEPS,
  SCALE_MIN_STEPS,
  SLIDE_BODY_MAX,
  TIME_MAX,
  TIME_MIN,
} from './constants.js';
import type { PointsMode, QuestionType } from './constants.js';
import type { Question, Quiz } from './questions.js';

/** A single validation problem, addressed by a JSON-path-like string. */
export interface ValidationIssue {
  /** Dotted path of the offending value, e.g. `questions.2.correctIndex`. */
  path: string;
  /** Human-readable, English, safe to show in the editor. */
  message: string;
}

/** Result of validating a value. `value` is present only when `ok` is true. */
export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  issues: ValidationIssue[];
}

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value, issues: [] };
}

function fail<T>(issues: ValidationIssue[]): ValidationResult<T> {
  return { ok: false, issues };
}

/** True when the value is a non-empty string once trimmed. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** True when the value is a finite number. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Normalise free-text for answer comparison: lower-case, trim, collapse inner
 * whitespace, strip accents and drop punctuation. Used by `text` answers and
 * by duplicate-nickname checks.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether a question type is scored (contributes points). */
export function isScoredType(type: QuestionType): boolean {
  return QUESTION_TYPES[type].scored;
}

/** Valid points modes for a type: unscored types are always `none`. */
export function allowedPointsModes(type: QuestionType): PointsMode[] {
  return isScoredType(type) ? ['standard', 'double'] : ['none'];
}

function validateOptions(
  options: unknown,
  path: string,
  issues: ValidationIssue[],
): string[] | undefined {
  if (!isStringArray(options)) {
    issues.push({ path, message: 'Options must be an array of strings.' });
    return undefined;
  }
  if (options.length < MIN_ANSWER_OPTIONS || options.length > MAX_ANSWER_OPTIONS) {
    issues.push({
      path,
      message: `Between ${MIN_ANSWER_OPTIONS} and ${MAX_ANSWER_OPTIONS} options are required.`,
    });
  }
  options.forEach((option, index) => {
    if (!isNonEmptyString(option)) {
      issues.push({ path: `${path}.${index}`, message: 'Option text must not be empty.' });
    } else if (option.length > OPTION_TEXT_MAX) {
      issues.push({
        path: `${path}.${index}`,
        message: `Option text must not exceed ${OPTION_TEXT_MAX} characters.`,
      });
    }
  });
  return options;
}

/**
 * Validate the fields shared by every question. Returns the list of issues and
 * whether the type is scored, so the caller can check `points` consistently.
 */
function validateBase(question: Question, path: string, issues: ValidationIssue[]): void {
  if (!isNonEmptyString(question.id)) {
    issues.push({ path: `${path}.id`, message: 'A question id is required.' });
  }
  if (!isNonEmptyString(question.text)) {
    issues.push({ path: `${path}.text`, message: 'Question text must not be empty.' });
  } else if (question.text.length > QUESTION_TEXT_MAX) {
    issues.push({
      path: `${path}.text`,
      message: `Question text must not exceed ${QUESTION_TEXT_MAX} characters.`,
    });
  }

  const scored = isScoredType(question.type);

  if (question.type !== 'slide') {
    if (!isFiniteNumber(question.timeLimit)) {
      issues.push({ path: `${path}.timeLimit`, message: 'A time limit is required.' });
    } else if (question.timeLimit < TIME_MIN || question.timeLimit > TIME_MAX) {
      issues.push({
        path: `${path}.timeLimit`,
        message: `The time limit must be between ${TIME_MIN} and ${TIME_MAX} seconds.`,
      });
    }
  }

  if (scored && question.points === 'none') {
    issues.push({ path: `${path}.points`, message: 'A scored question needs a points mode.' });
  }
  if (!scored && question.points !== 'none') {
    issues.push({
      path: `${path}.points`,
      message: 'This question type is not scored, so points must be "none".',
    });
  }
}

/**
 * Validate a single question of any of the 13 types. The switch is exhaustive:
 * adding a type to `Question` without handling it here is a compile error.
 */
export function validateQuestion(question: Question, path = 'question'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateBase(question, path, issues);

  switch (question.type) {
    case 'single': {
      const options = validateOptions(question.options, `${path}.options`, issues);
      if (
        options &&
        !(
          Number.isInteger(question.correctIndex) &&
          question.correctIndex >= 0 &&
          question.correctIndex < options.length
        )
      ) {
        issues.push({
          path: `${path}.correctIndex`,
          message: 'Select exactly one correct option.',
        });
      }
      break;
    }
    case 'trueFalse': {
      if (typeof question.correct !== 'boolean') {
        issues.push({ path: `${path}.correct`, message: 'Choose True or False.' });
      }
      break;
    }
    case 'multiple': {
      const options = validateOptions(question.options, `${path}.options`, issues);
      const indices = question.correctIndices;
      if (!Array.isArray(indices) || indices.length === 0) {
        issues.push({
          path: `${path}.correctIndices`,
          message: 'Select at least one correct option.',
        });
      } else {
        const unique = new Set(indices);
        if (unique.size !== indices.length) {
          issues.push({
            path: `${path}.correctIndices`,
            message: 'Correct options must be unique.',
          });
        }
        if (
          options &&
          indices.some((index) => !Number.isInteger(index) || index < 0 || index >= options.length)
        ) {
          issues.push({
            path: `${path}.correctIndices`,
            message: 'A correct option index is out of range.',
          });
        }
        if (options && unique.size >= options.length) {
          issues.push({
            path: `${path}.correctIndices`,
            message: 'At least one option must be wrong, otherwise every answer is correct.',
          });
        }
      }
      break;
    }
    case 'text': {
      if (!isStringArray(question.accepted) || question.accepted.length === 0) {
        issues.push({ path: `${path}.accepted`, message: 'Provide at least one accepted answer.' });
      } else {
        question.accepted.forEach((answer, index) => {
          if (!isNonEmptyString(answer)) {
            issues.push({
              path: `${path}.accepted.${index}`,
              message: 'An accepted answer must not be empty.',
            });
          }
        });
      }
      break;
    }
    case 'slider': {
      if (
        !isFiniteNumber(question.min) ||
        !isFiniteNumber(question.max) ||
        question.min >= question.max
      ) {
        issues.push({
          path: `${path}.min`,
          message: 'The minimum must be smaller than the maximum.',
        });
      }
      if (!isFiniteNumber(question.step) || question.step <= 0) {
        issues.push({ path: `${path}.step`, message: 'The step must be greater than zero.' });
      }
      if (
        isFiniteNumber(question.answer) &&
        isFiniteNumber(question.min) &&
        isFiniteNumber(question.max) &&
        (question.answer < question.min || question.answer > question.max)
      ) {
        issues.push({
          path: `${path}.answer`,
          message: 'The correct value must lie between min and max.',
        });
      }
      if (!isFiniteNumber(question.tolerance) || question.tolerance < 0) {
        issues.push({ path: `${path}.tolerance`, message: 'The tolerance must not be negative.' });
      }
      break;
    }
    case 'order': {
      if (!isStringArray(question.items) || question.items.length < 2) {
        issues.push({ path: `${path}.items`, message: 'Ordering needs at least two items.' });
      } else {
        question.items.forEach((item, index) => {
          if (!isNonEmptyString(item)) {
            issues.push({ path: `${path}.items.${index}`, message: 'An item must not be empty.' });
          }
        });
      }
      break;
    }
    case 'poll': {
      validateOptions(question.options, `${path}.options`, issues);
      break;
    }
    case 'wordCloud':
    case 'open': {
      if (!Number.isInteger(question.maxLength) || question.maxLength < 1) {
        issues.push({
          path: `${path}.maxLength`,
          message: 'A positive maximum length is required.',
        });
      }
      break;
    }
    case 'scale': {
      if (
        !Number.isInteger(question.steps) ||
        question.steps < SCALE_MIN_STEPS ||
        question.steps > SCALE_MAX_STEPS
      ) {
        issues.push({
          path: `${path}.steps`,
          message: `A scale needs between ${SCALE_MIN_STEPS} and ${SCALE_MAX_STEPS} steps.`,
        });
      }
      break;
    }
    case 'nps': {
      // Labels are optional; the 0–10 range is fixed by the type.
      break;
    }
    case 'slide': {
      if (typeof question.body !== 'string' || question.body.length > SLIDE_BODY_MAX) {
        issues.push({
          path: `${path}.body`,
          message: `The slide body must not exceed ${SLIDE_BODY_MAX} characters.`,
        });
      }
      break;
    }
    case 'ideas': {
      if (
        !Number.isInteger(question.maxIdeas) ||
        question.maxIdeas < 1 ||
        question.maxIdeas > IDEAS_MAX
      ) {
        issues.push({
          path: `${path}.maxIdeas`,
          message: `Between 1 and ${IDEAS_MAX} ideas are allowed.`,
        });
      }
      if (
        !Number.isInteger(question.maxVotes) ||
        question.maxVotes < 1 ||
        question.maxVotes > IDEA_VOTES
      ) {
        issues.push({
          path: `${path}.maxVotes`,
          message: `Between 1 and ${IDEA_VOTES} votes are allowed.`,
        });
      }
      if (typeof question.text !== 'string') {
        issues.push({ path: `${path}.text`, message: 'A prompt is required.' });
      }
      break;
    }
  }

  return issues;
}

/** Validate a whole quiz, including the ordered question list. */
export function validateQuiz(quiz: Quiz): ValidationResult<Quiz> {
  const issues: ValidationIssue[] = [];

  if (!isNonEmptyString(quiz.id)) {
    issues.push({ path: 'id', message: 'A quiz id is required.' });
  }
  if (!isNonEmptyString(quiz.title)) {
    issues.push({ path: 'title', message: 'A quiz title is required.' });
  } else if (quiz.title.length > QUIZ_TITLE_MAX) {
    issues.push({
      path: 'title',
      message: `The title must not exceed ${QUIZ_TITLE_MAX} characters.`,
    });
  }
  if (typeof quiz.description !== 'string') {
    issues.push({ path: 'description', message: 'The description must be a string.' });
  }
  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    issues.push({ path: 'questions', message: 'A quiz needs at least one question.' });
  } else {
    const seen = new Set<string>();
    quiz.questions.forEach((question, index) => {
      if (seen.has(question.id)) {
        issues.push({ path: `questions.${index}.id`, message: 'Question ids must be unique.' });
      }
      seen.add(question.id);
      issues.push(...validateQuestion(question, `questions.${index}`));
    });
  }

  return issues.length === 0 ? ok(quiz) : fail(issues);
}

/**
 * Whether a question may be answered at all. Slides and ideas have no
 * per-player answer; everything else collects one.
 */
export function isAnswerable(type: QuestionType): boolean {
  return type !== 'slide';
}
