/**
 * Game-show scene model and controller tests (Phase 6.9.2).
 *
 * These cover the pure scene logic the host page relies on: the 13-scene model,
 * the authoritative state → scene mapping, and the transition rules (including
 * reconnect and stale-event handling). The visuals live in the stylesheet and
 * are guarded by `design-system.test.ts`; nothing here draws anything.
 */

import { describe, expect, it } from 'vitest';

import type { HostState, PublicPlayer, PublicQuestion } from '@zeropeek/shared';

import {
  ENTRY_SCENE,
  SCENE_DEFINITIONS,
  SHOW_SCENES,
  ShowController,
  entryScene,
  samePhaseScenes,
  sceneBelongsTo,
  sceneDefinition,
  sceneForInput,
  sceneForState,
  sceneInputOf,
  type SceneInput,
} from './showScenes.js';

function player(id: string, score = 0): PublicPlayer {
  return { id, nickname: id, avatar: '', score, connected: true };
}

function question(id = 'q1'): PublicQuestion {
  return {
    id,
    type: 'single',
    text: 'Prompt',
    timeLimit: 20,
    display: { options: ['A', 'B'] },
    openedAt: 0,
    index: 0,
    total: 2,
    paused: false,
    remainingMs: null,
  } as PublicQuestion;
}

/** The full question as a reveal carries it (with its solution). */
function fullQuestion(id = 'q1') {
  return {
    id,
    type: 'single' as const,
    text: 'Prompt',
    timeLimit: 20,
    points: 'standard' as const,
    options: ['A', 'B'],
    correctIndex: 0,
  };
}

function state(overrides: Partial<HostState> = {}): HostState {
  return {
    gameId: 'g1',
    pin: '123456',
    phase: 'lobby',
    question: null,
    reveal: null,
    players: [],
    podium: null,
    answers: null,
    paused: false,
    skipped: false,
    lead: null,
    points: null,
    ranks: null,
    ...overrides,
  };
}

const input = (phase: SceneInput['phase'], questionId: string | null = null): SceneInput => ({
  phase,
  questionId,
});

describe('show scene model', () => {
  it('defines exactly the 13 scenes, in show order', () => {
    expect(SHOW_SCENES).toHaveLength(13);
    expect(SCENE_DEFINITIONS.map((scene) => scene.id)).toEqual([...SHOW_SCENES]);
    expect(SCENE_DEFINITIONS.map((scene) => scene.order)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });

  it('gives every scene a unique id and a definition', () => {
    const ids = SCENE_DEFINITIONS.map((scene) => scene.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of SHOW_SCENES) expect(sceneDefinition(id).id).toBe(id);
  });

  it('only ever transitions to a scene that exists', () => {
    for (const scene of SCENE_DEFINITIONS) {
      for (const target of scene.transitions) {
        expect(SHOW_SCENES).toContain(target);
      }
    }
  });

  it('maps each server phase to its entry scene', () => {
    expect(entryScene('lobby')).toBe('join');
    expect(entryScene('lead')).toBe('start');
    expect(entryScene('question')).toBe('question');
    expect(entryScene('reveal')).toBe('reveal');
    expect(entryScene('board')).toBe('leaderboard');
    expect(entryScene('end')).toBe('podium');
  });

  it('gives every scene a real phase (the show has no state the server lacks)', () => {
    for (const scene of SCENE_DEFINITIONS) {
      expect(SHOW_SCENES).toContain(scene.id);
      expect(Object.keys(ENTRY_SCENE)).toContain(scene.phase);
    }
  });

  it('knows which scenes belong to a phase', () => {
    expect(samePhaseScenes('lobby')).toEqual(['welcome', 'join', 'participants']);
    expect(samePhaseScenes('question')).toEqual(['question', 'answers', 'countdown']);
    expect(samePhaseScenes('reveal')).toEqual(['reveal', 'points']);
    expect(samePhaseScenes('board')).toEqual(['leaderboard', 'final']);
    expect(samePhaseScenes('end')).toEqual(['podium', 'outro']);
    expect(samePhaseScenes('lead')).toEqual(['start']);
    expect(sceneBelongsTo('participants', 'lobby')).toBe(true);
    expect(sceneBelongsTo('participants', 'question')).toBe(false);
  });
});

describe('sceneForState', () => {
  it('shows the welcome scene when no game is under control', () => {
    expect(sceneForState(null)).toBe('welcome');
    expect(sceneForInput(null)).toBe('welcome');
  });

  it('derives the scene from the authoritative phase', () => {
    expect(sceneForState(state({ phase: 'lobby', players: [player('a')] }))).toBe('join');
    expect(
      sceneForState(
        state({
          phase: 'lead',
          lead: { startedAt: 0, endsAt: 5000, durationSeconds: 5, skippable: true },
        }),
      ),
    ).toBe('start');
    expect(sceneForState(state({ phase: 'question', question: question() }))).toBe('question');
    expect(
      sceneForState(
        state({
          phase: 'reveal',
          reveal: { skipped: false, question: fullQuestion(), distribution: {} },
        }),
      ),
    ).toBe('reveal');
    expect(sceneForState(state({ phase: 'board', players: [player('a')] }))).toBe('leaderboard');
    expect(sceneForState(state({ phase: 'end', players: [player('a')] }))).toBe('podium');
  });

  it('falls back like the host console when a phase carries no data', () => {
    // A `lead`/`question` without its payload is not a valid situation to draw;
    // the host console falls back to the lobby, and so does the show.
    expect(sceneInputOf(state({ phase: 'lead' }))?.phase).toBe('lobby');
    expect(sceneInputOf(state({ phase: 'question' }))?.phase).toBe('lobby');
    expect(sceneInputOf(state({ phase: 'reveal' }))?.phase).toBe('question');
    expect(sceneForState(state({ phase: 'lead' }))).toBe('join');
    expect(sceneForState(state({ phase: 'question' }))).toBe('join');
    expect(sceneForState(state({ phase: 'reveal' }))).toBe('question');
  });

  it('reads the open question id from the question or the reveal', () => {
    expect(sceneInputOf(state({ phase: 'question', question: question('q7') }))).toEqual({
      phase: 'question',
      questionId: 'q7',
    });
    expect(
      sceneInputOf(
        state({
          phase: 'reveal',
          reveal: { skipped: false, question: fullQuestion('q7'), distribution: {} },
        }),
      ),
    ).toEqual({ phase: 'reveal', questionId: 'q7' });
    expect(sceneInputOf(null)).toBeNull();
  });
});

describe('ShowController transitions', () => {
  it('walks lobby → lead → question from authoritative descriptors', () => {
    const controller = new ShowController();
    expect(controller.sync(input('lobby'), 1)).toBe('join');
    expect(controller.sync(input('lead'), 2)).toBe('start');
    expect(controller.sync(input('question', 'q1'), 3)).toBe('question');
  });

  it('keeps the scene on a reconnect during the countdown', () => {
    const controller = new ShowController();
    expect(controller.sync(input('lead'), 1)).toBe('start');
    // A reconnect re-sends the same authoritative state: the scene must not jump.
    expect(controller.sync(input('lead'), 2)).toBe('start');
  });

  it('keeps the scene on a reconnect mid-round', () => {
    const controller = new ShowController();
    expect(controller.sync(input('board'), 1)).toBe('leaderboard');
    expect(controller.sync(input('board'), 2)).toBe('leaderboard');
  });

  it('ignores a stale snapshot so a late event cannot pull the show back', () => {
    const controller = new ShowController();
    expect(controller.sync(input('question', 'q1'), 10)).toBe('question');
    // An older snapshot (an overtaken resync) is dropped.
    expect(controller.sync(input('lobby'), 5)).toBe('question');
    expect(controller.currentPhase).toBe('question');
  });

  it('does not re-trigger a transition when the same state arrives twice', () => {
    const controller = new ShowController();
    expect(controller.sync(input('reveal', 'q1'), 1)).toBe('reveal');
    expect(controller.sync(input('reveal', 'q1'), 2)).toBe('reveal');
    expect(controller.sync(input('reveal', 'q1'), 3)).toBe('reveal');
  });

  it('always re-derives the scene from the phase, even for the same phase', () => {
    const controller = new ShowController();
    expect(controller.sync(input('question', 'q1'), 1)).toBe('question');
    // A new question is the same phase: the show stays on the question scene.
    expect(controller.sync(input('question', 'q2'), 2)).toBe('question');
    // A same-phase re-render (e.g. a pause) cannot park the show elsewhere.
    expect(controller.sync(input('question', 'q2'), 3)).toBe('question');
  });

  it('follows the server across every phase boundary', () => {
    const controller = new ShowController();
    expect(controller.sync(input('lobby'), 1)).toBe('join');
    expect(controller.sync(input('lead'), 2)).toBe('start');
    expect(controller.sync(input('question', 'q1'), 3)).toBe('question');
    expect(controller.sync(input('reveal', 'q1'), 4)).toBe('reveal');
    expect(controller.sync(input('board'), 5)).toBe('leaderboard');
    expect(controller.sync(input('end'), 6)).toBe('podium');
  });

  it('returns to the welcome scene when the game is released', () => {
    const controller = new ShowController();
    controller.sync(input('board'), 1);
    expect(controller.sync(null, 2)).toBe('welcome');
    expect(controller.currentPhase).toBeNull();
  });

  it('never invents a phase: the scene always comes from the descriptor', () => {
    const controller = new ShowController();
    // Starting from the welcome scene, a descriptor is what moves the show on.
    expect(controller.current).toBe('welcome');
    expect(controller.sync(input('end'), 1)).toBe('podium');
    expect(controller.currentPhase).toBe('end');
  });
});

describe('scene model stays presentation-only', () => {
  it('exposes no scoring, answering, phase-changing or navigation method', () => {
    const controller = new ShowController();
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(controller));
    // Only the derivation surface; the game — and therefore the scene — is
    // driven entirely by the server.
    expect(surface.sort()).toEqual(['constructor', 'current', 'currentPhase', 'sync'].sort());
  });
});
