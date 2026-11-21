/**
 * Host dashboard (Phase 6.14, Option B).
 *
 * The dashboard is the pre-game surface. Two properties matter and are guarded
 * here:
 *
 * 1. It only shows what the server sent. A figure that was not provided reads
 *    "—" — no invented capacity, no sample players, no placeholder phase.
 * 2. It introduces **no** presentation chrome. The running game keeps its single
 *    host/beamer view (Phase 6.9.3), so a scene bar, a scene counter or a
 *    fullscreen switch must never appear here either.
 */

import { describe, expect, it, vi } from 'vitest';

import { hostDashboard, type DashboardData } from './hostDashboard.js';

const handlers = {
  onSelectQuiz: vi.fn(),
  onStart: vi.fn(),
  onResume: vi.fn(),
};

/** A dashboard with no data at all: the state of a brand-new installation. */
function emptyData(): DashboardData {
  return { quizzes: [], selectedQuizId: null, openGames: [], roster: [], rosterGame: null };
}

const text = (node: Element): string => node.textContent ?? '';

describe('host dashboard – content comes from the server', () => {
  it('shows a dash instead of a capacity when no game is open', () => {
    const node = hostDashboard(emptyData(), handlers);
    const cards = [...node.querySelectorAll('.dash-stat')].map(text);

    // The player figure is unknown, so it is a dash — never a made-up "0 / 25".
    expect(cards[0]).toContain('—');
    expect(cards[0]).toContain('No game open');
    expect(text(node)).not.toMatch(/\d+\s*\/\s*\d+/);
  });

  it('names the open game with its real pin and player count', () => {
    const data: DashboardData = {
      quizzes: [{ id: 'q1', title: 'Blockwelt Basics', questionCount: 8, category: 'Welt' }],
      selectedQuizId: 'q1',
      openGames: [
        {
          id: 'g1',
          pin: '4321',
          quizTitle: 'Blockwelt Basics',
          playerCount: 3,
          phase: 'lobby',
        },
      ],
      roster: [
        { id: 'p1', nickname: 'Maya', avatar: '' },
        { id: 'p2', nickname: 'Ethan', avatar: '' },
      ],
      rosterGame: {
        id: 'g1',
        pin: '4321',
        quizTitle: 'Blockwelt Basics',
        playerCount: 3,
        phase: 'lobby',
      },
    };
    const node = hostDashboard(data, handlers);

    expect(text(node)).toContain('4321');
    expect(text(node)).toContain('Maya');
    expect(text(node)).toContain('Ethan');
    // The roster column counts what it lists, from the server's seat data.
    expect(node.querySelectorAll('.dash-roster__item')).toHaveLength(2);
  });

  it('reports "Ready" only for a selected quiz that has questions', () => {
    const ready = hostDashboard(
      {
        ...emptyData(),
        quizzes: [{ id: 'q1', title: 'Quiz', questionCount: 4 }],
        selectedQuizId: 'q1',
      },
      handlers,
    );
    const empty = hostDashboard(
      {
        ...emptyData(),
        quizzes: [{ id: 'q2', title: 'Empty', questionCount: 0 }],
        selectedQuizId: 'q2',
      },
      handlers,
    );

    // The preparation figure lives in the status row, not in the prep card.
    const prepOf = (node: Element): string => text(node.querySelectorAll('.dash-stat')[2]!);
    expect(prepOf(ready)).toContain('Ready');
    expect(prepOf(empty)).toContain('Not ready');
  });

  it('offers no start button at all when there is no quiz', () => {
    const none = hostDashboard(emptyData(), handlers);
    const noQuestions = hostDashboard(
      {
        ...emptyData(),
        quizzes: [{ id: 'q2', title: 'Empty', questionCount: 0 }],
        selectedQuizId: 'q2',
      },
      handlers,
    );

    // With no quiz there is nothing to start, so the card points at the editor
    // instead of rendering a dead button.
    expect(none.querySelector('.dash-start')).toBeNull();
    expect(text(none)).toContain('Open editor');
    // A quiz that exists but has no questions keeps the button, disabled.
    expect(noQuestions.querySelector<HTMLButtonElement>('.dash-start')?.disabled).toBe(true);
  });

  it('offers the start button and the quiz list once a quiz is ready', () => {
    const node = hostDashboard(
      {
        ...emptyData(),
        quizzes: [
          { id: 'q1', title: 'Alpha', questionCount: 3 },
          { id: 'q2', title: 'Beta', questionCount: 5 },
        ],
        selectedQuizId: 'q2',
      },
      handlers,
    );

    const start = node.querySelector<HTMLButtonElement>('.dash-start');
    expect(start?.disabled).toBe(false);
    expect(node.querySelectorAll('.dash-select option')).toHaveLength(2);
    expect(node.querySelector<HTMLSelectElement>('.dash-select')?.value).toBe('q2');
  });

  it('points at the editor when there is no quiz at all', () => {
    const node = hostDashboard(emptyData(), handlers);
    expect(text(node)).toContain('No quizzes yet');
    expect(text(node)).toContain('Open editor');
  });
});

describe('host dashboard – actions are reported, never decided locally', () => {
  it('reports the chosen quiz on change', () => {
    handlers.onSelectQuiz.mockClear();
    const node = hostDashboard(
      {
        ...emptyData(),
        quizzes: [
          { id: 'q1', title: 'Alpha', questionCount: 3 },
          { id: 'q2', title: 'Beta', questionCount: 5 },
        ],
        selectedQuizId: 'q1',
      },
      handlers,
    );

    const select = node.querySelector<HTMLSelectElement>('.dash-select')!;
    select.value = 'q2';
    select.dispatchEvent(new Event('change'));

    expect(handlers.onSelectQuiz).toHaveBeenCalledWith('q2');
  });

  it('reports a resume with the game id, and never starts it itself', () => {
    handlers.onResume.mockClear();
    handlers.onStart.mockClear();
    const node = hostDashboard(
      {
        ...emptyData(),
        openGames: [{ id: 'g7', pin: '9999', quizTitle: 'Alt', playerCount: 2, phase: 'lobby' }],
      },
      handlers,
    );

    [...node.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => text(button).includes('Resume'))!
      .click();

    expect(handlers.onResume).toHaveBeenCalledWith('g7');
    expect(handlers.onStart).not.toHaveBeenCalled();
  });
});

describe('host dashboard – no presentation chrome', () => {
  it('carries no scene bar, scene counter or fullscreen switch', () => {
    const node = hostDashboard(
      {
        ...emptyData(),
        quizzes: [{ id: 'q1', title: 'Quiz', questionCount: 3 }],
        selectedQuizId: 'q1',
      },
      handlers,
    );
    const shown = text(node);

    // The labels Phase 6.9.3 removed must not return on the dashboard either.
    for (const label of [
      'Presentation mode',
      'Exit presentation',
      'Player join',
      'Winner podium',
    ]) {
      expect(shown).not.toContain(label);
    }
    expect(shown).not.toMatch(/scene\s+\d+\s+of\s+\d+/i);
    expect(node.querySelector('[data-scene-nav]')).toBeNull();
    expect(node.querySelector('.scene-bar')).toBeNull();
  });

  it('does not duplicate the navigation, which the shell already provides', () => {
    const node = hostDashboard(emptyData(), handlers);
    expect(node.querySelector('nav')).toBeNull();
  });
});
