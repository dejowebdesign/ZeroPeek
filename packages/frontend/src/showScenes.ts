/**
 * Game-show scene model and scene controller (Phase 6.9.2).
 *
 * The show is the presentation half of the **combined** host/beamer surface: the
 * `/host.html` page keeps steering and showing (brief §3). There is no second
 * route, no show token and no second game engine. This module is pure — no DOM,
 * no socket, no game logic — so the scene model can be unit-tested on its own.
 *
 * Two rules decide everything here:
 *
 *  1. **The server owns the situation.** A scene is only ever *derived* from the
 *     authoritative state; nothing here can start, advance or score a game.
 *  2. **The presentation owns only how it looks.** Scenes that share a server
 *     phase (welcome/join/participants, question/answers/countdown,
 *     reveal/points, leaderboard/final, podium/outro) are alternative views of
 *     the *same* situation, so the host may step between them without touching
 *     the game.
 */

import type { GamePhase, HostState } from '@zeropeek/shared';

import { hostScreen } from './hostView.js';

/** The 13 show scenes, in presentation order (brief §4). */
export const SHOW_SCENES = [
  'welcome',
  'join',
  'participants',
  'start',
  'question',
  'answers',
  'countdown',
  'reveal',
  'points',
  'leaderboard',
  'final',
  'podium',
  'outro',
] as const;

export type ShowScene = (typeof SHOW_SCENES)[number];

/**
 * The server phase a scene is drawn for. Every scene maps to a real phase,
 * because even the welcome screen is shown inside a live lobby — the show has no
 * state the server does not have.
 */
export type ScenePhase = GamePhase;

/**
 * How a scene relates to the game. `idle` is the attract/intro view, `lobby`
 * the gathering view, `live` a running round and `finale` the aftermath.
 */
export type SceneMode = 'idle' | 'lobby' | 'live' | 'finale';

/** A piece of authoritative data a scene needs before it can be drawn. */
export type SceneRequirement = 'players' | 'lead' | 'question' | 'reveal';

export interface SceneDefinition {
  /** Stable id. */
  id: ShowScene;
  /** 1-based position in the show, matching brief §4. */
  order: number;
  /** Short internal label. */
  title: string;
  /** The server phase this scene belongs to. */
  phase: ScenePhase;
  /** How the scene relates to the game. */
  mode: SceneMode;
  /** The authoritative data the scene needs; empty for the intro scenes. */
  requires: readonly SceneRequirement[];
  /**
   * The scenes the show may move to from here, in flow order. A transition may
   * cross phases — the server drives those — while `ShowController.step` only
   * ever moves between scenes of the *current* phase.
   */
  transitions: readonly ShowScene[];
}

/** All 13 scene definitions. The order of this array is the show order. */
export const SCENE_DEFINITIONS: readonly SceneDefinition[] = [
  {
    id: 'welcome',
    order: 1,
    title: 'Welcome',
    phase: 'lobby',
    mode: 'idle',
    requires: [],
    transitions: ['join'],
  },
  {
    id: 'join',
    order: 2,
    title: 'Player join',
    phase: 'lobby',
    mode: 'lobby',
    requires: ['players'],
    transitions: ['welcome', 'participants'],
  },
  {
    id: 'participants',
    order: 3,
    title: 'Participants',
    phase: 'lobby',
    mode: 'lobby',
    requires: ['players'],
    transitions: ['join', 'start'],
  },
  {
    id: 'start',
    order: 4,
    title: 'Start countdown',
    phase: 'lead',
    mode: 'live',
    requires: ['lead', 'players'],
    transitions: ['question'],
  },
  {
    id: 'question',
    order: 5,
    title: 'Question',
    phase: 'question',
    mode: 'live',
    requires: ['question'],
    transitions: ['answers'],
  },
  {
    id: 'answers',
    order: 6,
    title: 'Answer options',
    phase: 'question',
    mode: 'live',
    requires: ['question'],
    transitions: ['countdown'],
  },
  {
    id: 'countdown',
    order: 7,
    title: 'Countdown',
    phase: 'question',
    mode: 'live',
    requires: ['question'],
    transitions: ['question'],
  },
  {
    id: 'reveal',
    order: 8,
    title: 'Answer reveal',
    phase: 'reveal',
    mode: 'live',
    requires: ['reveal'],
    transitions: ['points'],
  },
  {
    id: 'points',
    order: 9,
    title: 'Points awarded',
    phase: 'reveal',
    mode: 'live',
    requires: ['reveal', 'players'],
    transitions: ['reveal'],
  },
  {
    id: 'leaderboard',
    order: 10,
    title: 'Leaderboard',
    phase: 'board',
    mode: 'live',
    requires: ['players'],
    transitions: ['final'],
  },
  {
    id: 'final',
    order: 11,
    title: 'Final round',
    phase: 'board',
    mode: 'live',
    requires: ['players'],
    transitions: ['leaderboard'],
  },
  {
    id: 'podium',
    order: 12,
    title: 'Winner podium',
    phase: 'end',
    mode: 'finale',
    requires: ['players'],
    transitions: ['outro'],
  },
  {
    id: 'outro',
    order: 13,
    title: 'End / thanks',
    phase: 'end',
    mode: 'finale',
    requires: ['players'],
    transitions: ['podium'],
  },
];

/**
 * The scene a phase opens with. The lobby opens on `join` — the PIN view the
 * host console has always shown — while the other scenes of the phase (welcome,
 * participants) are reached by stepping, so the existing behaviour is unchanged.
 */
export const ENTRY_SCENE: Record<GamePhase, ShowScene> = {
  lobby: 'join',
  lead: 'start',
  question: 'question',
  reveal: 'reveal',
  board: 'leaderboard',
  end: 'podium',
};

/** The definition of one scene. */
export function sceneDefinition(id: ShowScene): SceneDefinition {
  const found = SCENE_DEFINITIONS.find((scene) => scene.id === id);
  // `SHOW_SCENES` and `SCENE_DEFINITIONS` are declared together, so a missing
  // definition is a programming error, not a runtime condition.
  if (!found) throw new Error(`ZeroPeek: no definition for scene "${id}".`);
  return found;
}

/** Whether a scene belongs to a server phase. */
export function sceneBelongsTo(id: ShowScene, phase: GamePhase): boolean {
  return sceneDefinition(id).phase === phase;
}

/** The scenes of one phase, in show order. */
export function samePhaseScenes(phase: GamePhase): ShowScene[] {
  return SCENE_DEFINITIONS.filter((scene) => scene.phase === phase).map((scene) => scene.id);
}

/** The scene a phase opens with; the host may step to the phase's other scenes. */
export function entryScene(phase: GamePhase): ShowScene {
  return ENTRY_SCENE[phase];
}

/**
 * The minimum an authoritative state must tell the show: which phase the game is
 * effectively in and which question is open. Both are server-owned; a live event
 * and a full snapshot yield the same descriptor, so the show derives its scene
 * the same way however the news arrived. The phase is the *effective* phase — a
 * `lead`/`question` that arrived without its payload has already fallen back to
 * the lobby (see `sceneInputOf`), exactly as the host console does.
 */
export interface SceneInput {
  phase: GamePhase;
  /** The open question's id, or `null` when no question is in play. */
  questionId: string | null;
}

/** The server phase behind a host screen id. */
function screenPhase(screen: ReturnType<typeof hostScreen>): GamePhase {
  // `hostScreen` only returns `welcome` for a `null` state, which never reaches
  // here; mapping it to the lobby keeps the type total.
  return screen === 'lobby' || screen === 'welcome' ? 'lobby' : screen;
}

/**
 * The descriptor for an authoritative host snapshot. `null` = no game.
 *
 * The phase is read through the existing `hostScreen` selector, so the show can
 * never disagree with the host console about which screen a state belongs to —
 * including its safe fallbacks for a half-filled snapshot (a `lead`/`question`
 * without its payload falls back to the lobby; a `reveal` without a reveal falls
 * back to the question).
 */
export function sceneInputOf(state: HostState | null): SceneInput | null {
  if (!state) return null;
  return {
    phase: screenPhase(hostScreen(state)),
    questionId: state.question?.id ?? state.reveal?.question.id ?? null,
  };
}

/**
 * The scene a descriptor maps to. `null` — no game under control — is the
 * welcome scene.
 */
export function sceneForInput(input: SceneInput | null): ShowScene {
  if (!input) return 'welcome';
  return entryScene(input.phase);
}

/** The scene an authoritative snapshot maps to. */
export function sceneForState(state: HostState | null): ShowScene {
  return sceneForInput(sceneInputOf(state));
}

/**
 * The scene controller.
 *
 * It holds no game state of its own: `sync` folds an authoritative descriptor
 * into the current scene, and `step` only ever moves between scenes of the phase
 * the server last reported. A stale descriptor (an older `at`) is ignored, so a
 * late socket event or an overtaken resync can never pull the show backwards.
 *
 * The controller is *derived state*: it never sends a command, so a bad step can
 * never reach the engine.
 */
export class ShowController {
  private scene: ShowScene = 'welcome';
  private phase: ScenePhase | null = null;
  /** The current question, so a new question resets to the question scene. */
  private questionId: string | null = null;
  private lastAt = Number.NEGATIVE_INFINITY;

  /** The scene currently on screen. */
  get current(): ShowScene {
    return this.scene;
  }

  /** The server phase the current scene was derived from; `null` with no game. */
  get currentPhase(): ScenePhase | null {
    return this.phase;
  }

  /**
   * Fold an authoritative descriptor into the controller and return the scene to
   * render. A descriptor older than the last one is ignored (returns the scene
   * unchanged). A phase change — or a new question — resets to that phase's entry
   * scene; a re-render of the same situation keeps the host's sub-scene.
   */
  sync(input: SceneInput | null, at = Date.now()): ShowScene {
    if (at < this.lastAt) return this.scene;
    this.lastAt = at;

    if (!input) {
      this.phase = null;
      this.questionId = null;
      this.scene = 'welcome';
      return this.scene;
    }

    const phase = input.phase;
    const moved = phase !== this.phase;
    const newQuestion = input.questionId !== this.questionId;
    const sceneFits = this.phase !== null && sceneBelongsTo(this.scene, phase);

    if (moved || newQuestion || !sceneFits) {
      this.scene = entryScene(phase);
    }
    this.phase = phase;
    this.questionId = input.questionId;
    return this.scene;
  }

  /**
   * Move to another scene of the current phase — a presentation-only step
   * ("Präsentationsszenen wechseln", concept §24). A target outside the current
   * phase is refused, so a manual step can never show a scene the server is not
   * in and can never touch the game.
   */
  step(target: ShowScene): boolean {
    if (this.phase === null) return false;
    if (!sceneBelongsTo(target, this.phase)) return false;
    this.scene = target;
    return true;
  }

  /** Step to the next (`1`) or previous (`-1`) scene of the current phase. */
  cycle(direction: 1 | -1): ShowScene {
    if (this.phase === null) return this.scene;
    const scenes = samePhaseScenes(this.phase);
    if (scenes.length < 2) return this.scene;
    const index = scenes.indexOf(this.scene);
    const next = (index + direction + scenes.length) % scenes.length;
    this.scene = scenes[next] ?? this.scene;
    return this.scene;
  }

  /** Whether the current phase has more than one scene to step between. */
  get steppable(): boolean {
    return this.phase !== null && samePhaseScenes(this.phase).length > 1;
  }
}
