/**
 * Host page control behaviour (Phase 6.9.2 correction, extended in 6.9.3).
 *
 * These drive the **real** host page in jsdom with a fake socket, so they cover
 * the wiring the pure `showScenes`/`hostView` tests cannot: that the scene is
 * display-only and follows the authoritative game phase, that there is **no**
 * manual scene navigation, and that the AUTO toggle mirrors the server's mode
 * and sends `host:auto` rather than changing anything locally.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HostState, PublicQuestion } from '@zeropeek/shared';

type Handler = (...args: unknown[]) => void;

/** A minimal Socket.IO stand-in: event registration plus ack-routed commands. */
class FakeSocket {
  handlers = new Map<string, Set<Handler>>();
  routes = new Map<string, (payload: unknown) => unknown>();
  /** Every event name passed to `emit`, so a test can assert what was sent. */
  sent: string[] = [];

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
    this.sent.push(event);
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

/** Click a button inside the open confirmation dialog, by its visible label. */
const clickDialogButton = (label: string): void => {
  const node = [...document.querySelectorAll<HTMLButtonElement>('.dialog button')].find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (!node) throw new Error(`no dialog button "${label}"`);
  node.click();
};

/** The AUTO toggle currently on screen, or null when it is not offered. */
const autoToggle = (): HTMLButtonElement | null =>
  app().querySelector<HTMLButtonElement>('[data-auto-toggle]');
const autoText = (): string => autoToggle()?.textContent?.trim() ?? '';

/** The game-show chrome Phase 6.9.3 removed. None of it may appear again. */
const REMOVED_LABELS = [
  'Presentation mode',
  'Exit presentation',
  'Scene 2 of 13',
  'SCENE 2 OF 13',
  'Player join',
  'Winner podium',
  'End / thanks',
];

/**
 * Whether any removed presentation/scene control is still rendered. The scene is
 * now purely internal: no scene number, no scene title and no mode switch.
 */
function removedControls(): string[] {
  const text = screen();
  const found = REMOVED_LABELS.filter((label) => text.includes(label));
  // The technical scene-step container, if it ever came back.
  if (app().querySelector('.show__scene-steps')) found.push('.show__scene-steps');
  return found;
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
    auto: false,
    paused: false,
    skipped: false,
    lead: null,
    points: null,
    ranks: null,
    hasNext: false,
    background: 'synthwave_skyline',
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
      text: 'Revealed prompt',
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
  fake.sent = [];
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('host page – no presentation chrome, and the AUTO toggle', () => {
  it('offers no scene navigation, scene number or presentation toggle in any phase', async () => {
    fake.routes.set('host:start', () => ({ phase: 'lead' }));
    fake.routes.set('host:next', () => ({ phase: 'question' }));

    await enterLobby();
    expect(removedControls()).toEqual([]);

    clickButton('Start game');
    fake.trigger('host:lead', leadPayload());
    await vi.waitFor(() => {
      if (!screen().includes('Get ready!')) throw new Error('lead not shown');
    });
    expect(removedControls()).toEqual([]);

    fake.trigger('host:question', publicQuestion(0, 'q1'));
    await vi.waitFor(() => {
      if (!screen().includes('Question 1 of 3')) throw new Error('question not shown');
    });
    expect(removedControls()).toEqual([]);

    fake.trigger('host:reveal', revealPayload('q1'));
    await vi.waitFor(() => {
      if (!screen().includes('Revealed prompt')) throw new Error('reveal not shown');
    });
    expect(removedControls()).toEqual([]);

    fake.trigger('host:board', {
      players: [{ id: 'p1', nickname: 'Ada', avatar: '', score: 10, connected: true }],
      ranks: [],
      hasNext: true,
    });
    await vi.waitFor(() => {
      if (!screen().includes('Leaderboard')) throw new Error('board not shown');
    });
    expect(removedControls()).toEqual([]);
  });

  it('hides the AUTO toggle in the lobby and on the final screen', async () => {
    fake.routes.set('host:start', () => ({ phase: 'lead' }));

    await enterLobby();
    // The lobby is not frozen yet: no AUTO switch there.
    expect(autoToggle()).toBeNull();

    clickButton('Start game');
    fake.trigger('host:lead', leadPayload());
    await vi.waitFor(() => {
      if (!autoToggle()) throw new Error('AUTO toggle not shown in lead');
    });

    fake.trigger('host:ended', {
      players: [{ id: 'p1', nickname: 'Ada', avatar: '', score: 10, connected: true }],
    });
    await vi.waitFor(() => {
      if (!screen().includes('Final results')) throw new Error('podium not shown');
    });
    // The game is over: nothing left to automate.
    expect(autoToggle()).toBeNull();
  });

  it('shows the server mode and defaults to AUTO: Off', async () => {
    fake.routes.set('host:start', () => ({ phase: 'lead' }));
    await enterLobby();
    clickButton('Start game');
    fake.trigger('host:lead', leadPayload());
    await vi.waitFor(() => {
      if (!autoToggle()) throw new Error('AUTO toggle not shown');
    });
    expect(autoText()).toBe('AUTO: Off');
    expect(autoToggle()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('sends host:auto with the flipped value and follows the server ACK', async () => {
    fake.routes.set('host:start', () => ({ phase: 'lead' }));
    const sent: boolean[] = [];
    fake.routes.set('host:auto', (payload) => {
      const auto = (payload as { auto: boolean }).auto;
      sent.push(auto);
      return { auto };
    });

    await enterLobby();
    clickButton('Start game');
    fake.trigger('host:lead', leadPayload());
    await vi.waitFor(() => {
      if (!autoToggle()) throw new Error('AUTO toggle not shown');
    });

    // Flip on: the value sent is the opposite of what is shown, and the label
    // follows the server's answer, never a local guess.
    autoToggle()!.click();
    await vi.waitFor(() => {
      if (autoText() !== 'AUTO: On') throw new Error('toggle did not turn on');
    });
    expect(sent).toEqual([true]);
    expect(autoToggle()?.getAttribute('aria-pressed')).toBe('true');

    autoToggle()!.click();
    await vi.waitFor(() => {
      if (autoText() !== 'AUTO: Off') throw new Error('toggle did not turn off');
    });
    expect(sent).toEqual([true, false]);
  });

  it('repaints from the host:auto broadcast without moving the screen', async () => {
    fake.routes.set('host:start', () => ({ phase: 'lead' }));

    await enterLobby();
    clickButton('Start game');
    fake.trigger('host:lead', leadPayload());
    await vi.waitFor(() => {
      if (!autoToggle()) throw new Error('AUTO toggle not shown');
    });

    fake.trigger('host:question', publicQuestion(0, 'q1'));
    await vi.waitFor(() => {
      if (!screen().includes('Question 1 of 3')) throw new Error('question not shown');
    });

    // A second host tab turned AUTO on; the broadcast must update the toggle and
    // leave the question screen exactly where it was.
    fake.trigger('host:auto', { auto: true });
    expect(autoText()).toBe('AUTO: On');
    expect(screen()).toContain('Question 1 of 3');
  });
});

describe('host page – destructive controls and the leaderboard advance', () => {
  it('sends host:skip only after the confirmation is accepted', async () => {
    fake.routes.set('host:start', () => ({ phase: 'lead' }));
    fake.routes.set('host:skip', () => ({ phase: 'reveal' }));

    await enterLobby();
    clickButton('Start game');
    fake.trigger('host:lead', leadPayload());
    fake.trigger('host:question', publicQuestion(0, 'q1'));
    await vi.waitFor(() => {
      if (!screen().includes('Question 1 of 3')) throw new Error('question not shown');
    });
    fake.sent = [];

    // Opening the dialog must not send anything: a stray send here would end the
    // question before the host decided. Regression for the double-bound handler
    // (`hostButton` already sent, then `onclick` opened the dialog on top).
    clickButton('Skip question');
    expect(fake.sent).toEqual([]);
    expect(document.querySelectorAll('.dialog').length).toBe(1);

    // Cancel leaves the game untouched and sends nothing.
    clickDialogButton('Cancel');
    expect(fake.sent).toEqual([]);
    expect(document.querySelectorAll('.dialog').length).toBe(0);

    // Confirming sends exactly one command.
    clickButton('Skip question');
    clickDialogButton('Skip question');
    await vi.waitFor(() => {
      if (fake.sent.length !== 1) throw new Error('host:skip not sent exactly once');
    });
    expect(fake.sent).toEqual(['host:skip']);
  });

  it('sends host:end only after the confirmation is accepted', async () => {
    fake.routes.set('host:start', () => ({ phase: 'lead' }));
    fake.routes.set('host:end', () => ({ phase: 'end' }));

    await enterLobby();
    clickButton('Start game');
    fake.trigger('host:lead', leadPayload());
    fake.trigger('host:board', {
      players: [{ id: 'p1', nickname: 'Ada', avatar: '', score: 10, connected: true }],
      ranks: [],
      hasNext: false,
    });
    await vi.waitFor(() => {
      if (!screen().includes('Leaderboard')) throw new Error('board not shown');
    });
    fake.sent = [];

    clickButton('End game');
    expect(fake.sent).toEqual([]);
    clickDialogButton('Cancel');
    expect(fake.sent).toEqual([]);

    clickButton('End game');
    clickDialogButton('End game');
    await vi.waitFor(() => {
      if (fake.sent.length !== 1) throw new Error('host:end not sent exactly once');
    });
    expect(fake.sent).toEqual(['host:end']);
  });

  it('offers Next question on the board while a further question exists', async () => {
    fake.routes.set('host:start', () => ({ phase: 'lead' }));
    fake.routes.set('host:next', () => ({ phase: 'question' }));

    await enterLobby();
    clickButton('Start game');
    fake.trigger('host:lead', leadPayload());
    fake.trigger('host:board', {
      players: [{ id: 'p1', nickname: 'Ada', avatar: '', score: 10, connected: true }],
      ranks: [],
      hasNext: true,
    });
    await vi.waitFor(() => {
      if (!screen().includes('Leaderboard')) throw new Error('board not shown');
    });

    const next = buttons().find((b) => (b.textContent ?? '').includes('Next question'));
    expect(next).toBeDefined();
    next!.click();
    await vi.waitFor(() => {
      if (!fake.sent.includes('host:next')) throw new Error('host:next not sent');
    });
  });

  it('drops Next question on the last leaderboard', async () => {
    fake.routes.set('host:start', () => ({ phase: 'lead' }));

    await enterLobby();
    clickButton('Start game');
    fake.trigger('host:lead', leadPayload());
    fake.trigger('host:board', {
      players: [{ id: 'p1', nickname: 'Ada', avatar: '', score: 10, connected: true }],
      ranks: [],
      hasNext: false,
    });
    await vi.waitFor(() => {
      if (!screen().includes('Leaderboard')) throw new Error('board not shown');
    });

    // No further question: only End game remains, so no dead Next is offered.
    expect(screen()).not.toContain('Next question');
    expect(buttons().some((b) => (b.textContent ?? '').includes('End game'))).toBe(true);
  });

  it('restores the board controls from a reconnect snapshot', async () => {
    fake.routes.set('host:start', () => ({ phase: 'lead' }));
    await enterLobby();
    clickButton('Start game');
    fake.trigger('host:lead', leadPayload());
    fake.trigger('host:board', {
      players: [{ id: 'p1', nickname: 'Ada', avatar: '', score: 10, connected: true }],
      ranks: [],
      hasNext: false,
    });
    await vi.waitFor(() => {
      if (!screen().includes('Leaderboard')) throw new Error('board not shown');
    });

    // A reconnect re-fetches the state; the server's `hasNext: false` must render
    // the same controls as the live event did.
    fake.routes.set('host:join', () => ({
      ...lobbyState(),
      phase: 'board',
      players: [{ id: 'p1', nickname: 'Ada', avatar: '', score: 10, connected: true }],
      ranks: [],
      hasNext: false,
    }));
    fake.trigger('connect');
    await vi.waitFor(() => {
      if (screen().includes('Next question')) throw new Error('dead Next after resync');
    });
    expect(buttons().some((b) => (b.textContent ?? '').includes('End game'))).toBe(true);
  });
});

describe('host page – background picker (Phase 6.10)', () => {
  /** The picker currently on screen, or null when it is not offered. */
  const picker = (): HTMLElement | null => app().querySelector<HTMLElement>('.show__background');
  const pickerLabel = (): string =>
    picker()?.querySelector('.show__background-label')?.textContent?.trim() ?? '';
  /** The layer the background module paints, or null before it is created. */
  const layer = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('[data-round-background]');
  const layerImage = (): string => layer()?.style.getPropertyValue('--round-background') ?? '';

  it('is offered in the lobby and names the server background', async () => {
    await enterLobby();
    expect(picker()).not.toBeNull();
    expect(pickerLabel()).toBe('Background: Synthwave – Skyline');
  });

  it('paints the supplied file, not a placeholder', async () => {
    await enterLobby();
    expect(layerImage()).toContain('/backgrounds/zeropeek_synthwave_skyline.webp');
  });

  it('sends the chosen id to the server and never decides locally', async () => {
    await enterLobby();
    // The server would answer with a different background than the one asked for
    // in a broken implementation; here it echoes the request, as the engine does.
    fake.routes.set('host:background', (payload) => ({
      background: (payload as { background: string }).background,
    }));

    clickButton('Synthwave – Wüste');

    await vi.waitFor(() => {
      if (!fake.sent.includes('host:background')) throw new Error('no command sent');
    });
    await vi.waitFor(() => {
      if (!layerImage().includes('zeropeek_synthwave_wueste.webp')) {
        throw new Error('layer not repainted from the ACK');
      }
    });
    expect(pickerLabel()).toBe('Background: Synthwave – Wüste');
  });

  it('repaints from the broadcast, so a second host stays in step', async () => {
    await enterLobby();
    fake.trigger('host:background', { background: 'synthwave_weltraum' });
    await vi.waitFor(() => {
      if (!layerImage().includes('zeropeek_synthwave_weltraum.webp')) {
        throw new Error('broadcast not applied');
      }
    });
    expect(pickerLabel()).toBe('Background: Synthwave – Weltraum');
  });

  it('offers a Random control that sends the sentinel, not a client-side roll', async () => {
    await enterLobby();
    let sent: unknown = null;
    fake.routes.set('host:background', (payload) => {
      sent = (payload as { background: string }).background;
      return { background: 'synthwave_skyline' };
    });

    clickButton('Random');
    await vi.waitFor(() => {
      if (sent === null) throw new Error('no command sent');
    });
    // The client must ask the server to choose; it must not pick an id itself.
    expect(sent).toBe('random');
  });

  it('is hidden once the game leaves the lobby', async () => {
    fake.routes.set('host:start', () => ({ phase: 'lead' }));
    await enterLobby();
    expect(picker()).not.toBeNull();

    clickButton('Start game');
    fake.trigger('host:lead', leadPayload());
    await vi.waitFor(() => {
      if (!screen().includes('Get ready!')) throw new Error('lead not shown');
    });
    expect(picker()).toBeNull();
  });

  it('is restored by a reconnect snapshot, because a reload arrives as a sync', async () => {
    fake.routes.set('host:create', () => lobbyState());
    await boot();
    clickButton('Start');
    await vi.waitFor(() => {
      if (!screen().includes('1234')) throw new Error('lobby not rendered');
    });

    // A reconnect is what a browser reload produces: the state arrives as a
    // `sync` snapshot, not as a `lobby` event. The picker must still be there.
    fake.routes.set('host:join', () => ({
      ...lobbyState(),
      background: 'synthwave_unterwasser_v3',
    }));
    // The page treats the first `connect` as the initial connection and only
    // resyncs from the second one on, so the test has to open the socket first.
    fake.trigger('connect');
    fake.trigger('disconnect');
    fake.trigger('connect');
    await vi.waitFor(() => {
      if (!layerImage().includes('zeropeek_synthwave_unterwasser_v3.webp')) {
        throw new Error('reconnect did not restore the background');
      }
    });
    expect(picker()).not.toBeNull();
    expect(pickerLabel()).toBe('Background: Synthwave – Unterwasser');
  });
});
