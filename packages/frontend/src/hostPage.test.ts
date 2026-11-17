/**
 * Host page scene behaviour (Phase 6.9.2 correction).
 *
 * These drive the **real** host page in jsdom with a fake socket, so they cover
 * the wiring the pure `showScenes`/`hostView` tests cannot: that the scene is
 * display-only and follows the authoritative game phase, and that there is **no**
 * manual scene navigation in the console.
 *
 * Why this matters: a host step between scenes of a phase could park the show on
 * a scene the server is not in — the host ↔ beamer contradiction the concept
 * forbids (§10.1). The scene bar therefore shows the current scene and the
 * presentation toggle only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HostState, PublicQuestion } from '@zeropeek/shared';

type Handler = (...args: unknown[]) => void;

/** A minimal Socket.IO stand-in: event registration plus ack-routed commands. */
class FakeSocket {
  handlers = new Map<string, Set<Handler>>();
  routes = new Map<string, (payload: unknown) => unknown>();

  on(event: string, fn: Handler): this {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return this;
  }
  off(event: string, fn: Handler): this {
    this.handlers.get(event)?.delete(fn);
    return this;
  }
  once(event: string, fn: Handler): this {
    const wrap: Handler = (...args: unknown[]) => {
      this.off(event, wrap);
      fn(...args);
    };
    return this.on(event, wrap);
  }
  emit(event: string, payload: unknown, ack?: (reply: unknown) => void): this {
    const route = this.routes.get(event);
    if (route && ack) {
      try {
        ack({ ok: true, data: route(payload) });
      } catch (error) {
        ack({ ok: false, error: (error as Error).message });
      }
    }
    return this;
  }
  disconnect(): void {}
  /** Deliver a server → host event to every listener. */
  trigger(event: string, payload?: unknown): void {
    for (const fn of [...(this.handlers.get(event) ?? [])]) fn(payload);
  }
}

const fake = new FakeSocket();

vi.mock('./socket.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./socket.js')>();
  return { ...actual, connectHost: () => fake };
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

function stubFetch(): void {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/api/auth/me')) {
      return jsonResponse({ user: { id: 'u1', username: 'host', role: 'TRAINER' } });
    }
    if (url.includes('/api/quizzes')) {
      return jsonResponse({ quizzes: [{ id: 'quiz1', title: 'Quiz', questionCount: 3 }] });
    }
    if (url.includes('/api/reports/games')) return jsonResponse({ games: [] });
    return jsonResponse({});
  });
}

const app = (): HTMLElement => document.getElementById('app') as HTMLElement;
const screen = (): string => app().textContent ?? '';
const sceneLabel = (): string =>
  app().querySelector('.show__scene-label')?.textContent?.trim() ?? '';
const buttons = (): HTMLButtonElement[] => [...app().querySelectorAll('button')];
const clickButton = (label: string): void => {
  const node = buttons().find((b) => (b.textContent ?? '').includes(label));
  if (!node) {
    throw new Error(
      `no button "${label}". Buttons: ${buttons()
        .map((b) => b.textContent)
        .join('|')}`,
    );
  }
  node.click();
};

/** Every scene the manual navigation used to offer. None may appear. */
const SCENE_NAV_LABELS = [
  '‹',
  '›',
  'Welcome',
  'Player join',
  'Participants',
  'Question',
  'Answer options',
  'Countdown',
  'Answer reveal',
  'Points awarded',
  'Leaderboard',
  'Final round',
  'Winner podium',
  'End / thanks',
];

/**
 * The scene-navigation buttons, if any remained. The scene bar now holds only
 * the scene label and the presentation toggle; the steps container is gone. A
 * "Leaderboard"/"Reveal" control button lives in `.show__controls` (a real game
 * command), so the check is scoped to the scene bar.
 */
function sceneNavButtons(): HTMLButtonElement[] {
  const bar = app().querySelector('.show__scene-bar');
  if (!bar) return [];
  return [...bar.querySelectorAll('button')].filter((b) =>
    SCENE_NAV_LABELS.includes((b.textContent ?? '').trim()),
  );
}

/** Whether the (removed) scene-steps container is still rendered. */
function hasSceneSteps(): boolean {
  return app().querySelector('.show__scene-steps') !== null;
}

function publicQuestion(index: number, id: string): PublicQuestion {
  return {
    id,
    type: 'single',
    text: `Question ${index + 1}`,
    timeLimit: 30,
    display: { options: ['a', 'b'] },
    openedAt: Date.now(),
    index,
    total: 3,
    paused: false,
    remainingMs: null,
  };
}

function lobbyState(): HostState {
  return {
    gameId: 'g1',
    pin: '1234',
    phase: 'lobby',
    question: null,
    reveal: null,
    players: [{ id: 'p1', nickname: 'Ada', avatar: '', score: 0, connected: true }],
    podium: null,
    answers: null,
    paused: false,
    skipped: false,
    lead: null,
    points: null,
    ranks: null,
  };
}

const leadPayload = () => ({
  startedAt: Date.now(),
  endsAt: Date.now() + 3000,
  durationSeconds: 3,
  skippable: true,
});

function revealPayload(id: string) {
  return {
    skipped: false,
    question: {
      id,
      type: 'single' as const,
      text: 'Question',
      timeLimit: 30,
      points: 'standard' as const,
      options: ['a', 'b'],
      correctIndex: 0,
    },
    distribution: { '0': 1 },
    points: [],
  };
}

/** Boot the host page on its home screen with a fresh module graph. */
async function boot(): Promise<void> {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  await import('./pages/host.js');
  await vi.waitFor(() => {
    if (!screen().includes('Start a game')) throw new Error('home not rendered');
  });
}

/** Start a game and advance to the lobby's live view. */
async function enterLobby(): Promise<void> {
  fake.routes.set('host:create', () => lobbyState());
  await boot();
  clickButton('Start');
  await vi.waitFor(() => {
    if (!screen().includes('1234')) throw new Error('lobby not rendered');
  });
}

beforeEach(() => {
  fake.handlers.clear();
  fake.routes.clear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('host page – the scene is display-only', () => {
  it('offers no manual scene navigation in any phase', async () => {
    fake.routes.set('host:start', () => ({ phase: 'lead' }));
    fake.routes.set('host:next', () => ({ phase: 'question' }));

    await enterLobby();
    expect(sceneNavButtons()).toHaveLength(0);
    expect(hasSceneSteps()).toBe(false);

    clickButton('Start game');
    fake.trigger('host:lead', leadPayload());
    await vi.waitFor(() => {
      if (!sceneLabel().includes('Start countdown')) throw new Error('lead not shown');
    });
    expect(sceneNavButtons()).toHaveLength(0);
    expect(hasSceneSteps()).toBe(false);

    fake.trigger('host:question', publicQuestion(0, 'q1'));
    await vi.waitFor(() => {
      if (!sceneLabel().includes('Question')) throw new Error('question not shown');
    });
    expect(sceneNavButtons()).toHaveLength(0);
    expect(hasSceneSteps()).toBe(false);

    fake.trigger('host:reveal', revealPayload('q1'));
    await vi.waitFor(() => {
      if (!sceneLabel().includes('Answer reveal')) throw new Error('reveal not shown');
    });
    expect(sceneNavButtons()).toHaveLength(0);
    expect(hasSceneSteps()).toBe(false);

    fake.trigger('host:board', {
      players: [{ id: 'p1', nickname: 'Ada', avatar: '', score: 10, connected: true }],
      ranks: [],
    });
    await vi.waitFor(() => {
      if (!sceneLabel().includes('Leaderboard')) throw new Error('board not shown');
    });
    expect(sceneNavButtons()).toHaveLength(0);
    expect(hasSceneSteps()).toBe(false);
  });

  it('follows the authoritative phase from lobby to podium', async () => {
    fake.routes.set('host:start', () => ({ phase: 'lead' }));

    await enterLobby();
    expect(sceneLabel()).toContain('Player join');

    clickButton('Start game');
    fake.trigger('host:lead', leadPayload());
    await vi.waitFor(() => {
      if (!sceneLabel().includes('Start countdown')) throw new Error('lead not shown');
    });

    fake.trigger('host:question', publicQuestion(0, 'q1'));
    await vi.waitFor(() => {
      if (!sceneLabel().includes('Question')) throw new Error('question not shown');
    });

    // A same-phase re-render (e.g. a pause) must not move the scene.
    fake.trigger('host:paused', { questionId: 'q1', remainingMs: 20_000 });
    expect(sceneLabel()).toContain('Question');

    fake.trigger('host:reveal', revealPayload('q1'));
    await vi.waitFor(() => {
      if (!sceneLabel().includes('Answer reveal')) throw new Error('reveal not shown');
    });

    fake.trigger('host:board', {
      players: [{ id: 'p1', nickname: 'Ada', avatar: '', score: 10, connected: true }],
      ranks: [],
    });
    await vi.waitFor(() => {
      if (!sceneLabel().includes('Leaderboard')) throw new Error('board not shown');
    });

    fake.trigger('host:ended', {
      players: [{ id: 'p1', nickname: 'Ada', avatar: '', score: 10, connected: true }],
    });
    await vi.waitFor(() => {
      if (!sceneLabel().includes('Winner podium')) throw new Error('podium not shown');
    });
  });

  it('shows no scene bar at all while no game is under control', async () => {
    await boot();
    expect(app().querySelector('.show__scene-bar')).toBeNull();
  });
});
