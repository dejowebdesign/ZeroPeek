/**
 * Product-wide constants. All values are ZeroPeek's own; no values are copied
 * from any other project.
 */

/** The 13 supported question types. Keys are stable identifiers used on the wire. */
export const QUESTION_TYPES = {
  single: { label: 'Single Choice', description: 'Exactly one correct answer', scored: true },
  trueFalse: { label: 'True / False', description: 'Judge a statement', scored: true },
  multiple: { label: 'Multiple Choice', description: 'Several correct answers', scored: true },
  text: { label: 'Text Input', description: 'Type the answer', scored: true },
  slider: { label: 'Slider', description: 'Estimate a number', scored: true },
  order: { label: 'Ordering', description: 'Sort the elements', scored: true },
  poll: { label: 'Poll', description: 'Opinion, no points', scored: false },
  wordCloud: { label: 'Word Cloud', description: 'Free answers as a word cloud', scored: false },
  open: { label: 'Open Question', description: 'Longer free-text answers', scored: false },
  scale: { label: 'Scale', description: 'Rating on a stepped scale', scored: false },
  nps: { label: 'Recommendation 0–10', description: 'Net promoter style score', scored: false },
  slide: {
    label: 'Text Slide',
    description: 'Explanation or transition, no answer',
    scored: false,
  },
  ideas: { label: 'Idea Collection', description: 'Collect ideas, then vote', scored: false },
} as const;

export type QuestionType = keyof typeof QUESTION_TYPES;

/** Stable, ordered list of all question type identifiers. */
export const QUESTION_TYPE_IDS = Object.keys(QUESTION_TYPES) as QuestionType[];

/** Points configuration available to a question. */
export const POINTS_MODES = {
  standard: 'Standard',
  double: 'Double points',
  none: 'No points',
} as const;

export type PointsMode = keyof typeof POINTS_MODES;

/** Selectable time limits in seconds. */
export const TIME_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240] as const;

/** Minimum and maximum time limit in seconds. */
export const TIME_MIN = 5;
export const TIME_MAX = 240;

/** Default time limit in seconds. */
export const DEFAULT_TIME = 20;

/** Answer-slot limits. A question has at most four answers (product decision). */
export const MIN_ANSWER_OPTIONS = 2;
export const MAX_ANSWER_OPTIONS = 4;

/** Length limits (characters). */
export const QUESTION_TEXT_MAX = 500;
export const OPTION_TEXT_MAX = 200;
export const SLIDE_BODY_MAX = 1000;
export const NICKNAME_MAX = 16;
export const QUIZ_TITLE_MAX = 120;

/**
 * Length limit for the optional `category` and `difficulty` labels.
 *
 * No fixed taxonomy is defined for either field yet: which categories and which
 * difficulty scale ZeroPeek should offer is an **open product decision** (see
 * `docs/roadmap/technical-roadmap.md` §5 and the Phase 6.4 report). Until it is
 * decided, both are free text, so no invented set of values is imposed on the
 * data.
 */
export const LABEL_MAX = 60;

/** Scale question bounds. */
export const SCALE_MIN_STEPS = 3;
export const SCALE_MAX_STEPS = 10;

/** Idea collection limits. */
export const IDEAS_MAX = 12;
export const IDEA_VOTES = 3;
export const IDEA_TEXT_MAX = 80;

/** Team mode. */
export const MIN_TEAMS = 2;
export const MAX_TEAMS = 6;
export const TEAM_NAMES = ['Falcons', 'Lynxes', 'Otters', 'Ravens', 'Ibexes', 'Marlins'] as const;

/** Visual themes (own names; the design system lives in the frontend). */
export const THEMES = {
  auto: 'Automatic (season)',
  standard: 'Standard',
  autumn: 'Autumn',
  winter: 'Winter',
  spring: 'Spring',
  summer: 'Summer',
  night: 'Night',
  ocean: 'Ocean',
  neon: 'Neon',
  minimal: 'Minimal',
} as const;

export type ThemeId = keyof typeof THEMES;

/** How a participant identifies for cross-game reporting. */
export const PARTICIPANT_ID_MODES = {
  off: 'Nickname only',
  optional: 'Identifier optional',
  required: 'Identifier required',
} as const;

export type ParticipantIdMode = keyof typeof PARTICIPANT_ID_MODES;

/** Game session phases, in order. The server is authoritative over transitions. */
export const GAME_PHASES = ['lobby', 'lead', 'question', 'reveal', 'board', 'end'] as const;
export type GamePhase = (typeof GAME_PHASES)[number];
