/**
 * Host surface rules (Phase 6.5.2).
 *
 * These cover the pure logic the host page relies on: the phase → screen and
 * phase → allowed-actions mapping, the connection-status rules, and the
 * idempotent listener registration. They assert behaviour only; the look lives
 * in the stylesheet and is guarded by `design-system.test.ts`.
 *
 * Tests F (listeners) and G (connection status) of the phase brief live here.
 */

import { describe, expect, it, vi } from 'vitest';

import type { HostReveal, HostState } from '@zeropeek/shared';

import {
  attachHostHandlers,
  canAct,
  connectionStatus,
  detachHostHandlers,
  forgetGame,
  GAME_KEY,
  hostActions,
  hostScreen,
  nextStatus,
  rememberedGame,
  rememberGame,
  revealBody,
  type HostEventHandlers,
  type ListenerSocket,
} from './hostView.js';

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
    ...overrides,
  };
}

/** A tiny fake socket that records its listeners, so a test can fire them. */
function fakeSocket() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const offCalls = { count: 0 };
  const socket = {
    offCalls,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    off: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((entry) => entry !== listener),
      );
      offCalls.count += 1;
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    count: (event: string) => (listeners.get(event) ?? []).length,
  };
  return socket as unknown as ListenerSocket & {
    emit: (event: string, ...args: unknown[]) => void;
    count: (event: string) => number;
    offCalls: { count: number };
  };
}

describe('hostScreen', () => {
  it('maps each phase to its screen', () => {
    expect(hostScreen(state({ phase: 'lobby' }))).toBe('lobby');
    expect(hostScreen(state({ phase: 'question', question: questionView() }))).toBe('question');
    expect(
      hostScreen(
        state({
          phase: 'reveal',
          reveal: { skipped: false, question: question(), distribution: {} },
        }),
      ),
    ).toBe('reveal');
    expect(hostScreen(state({ phase: 'board' }))).toBe('board');
    expect(hostScreen(state({ phase: 'end' }))).toBe('end');
  });

  it('falls back to a safe screen when phase data is missing', () => {
    // A `reveal` with no reveal payload must not throw; it shows the question.
    expect(hostScreen(state({ phase: 'reveal' }))).toBe('question');
    // A `question` with no question shows the lobby.
    expect(hostScreen(state({ phase: 'question' }))).toBe('lobby');
  });

  function question() {
    return {
      id: 'q1',
      type: 'single' as const,
      text: 'Capital of France?',
      timeLimit: 20,
      points: 'standard' as const,
      options: ['Paris', 'Rome'],
      correctIndex: 0,
    };
  }
  function questionView() {
    return {
      id: 'q1',
      type: 'single' as const,
      text: 'Capital of France?',
      timeLimit: 20,
      display: {},
      openedAt: 0,
      index: 0,
      total: 1,
      paused: false,
      remainingMs: null,
    };
  }
});

describe('hostActions', () => {
  it('offers exactly the transitions the engine allows per phase', () => {
    expect(hostActions('lobby').map((a) => a.id)).toEqual(['start']);
    // A running question can be revealed, paused and skipped.
    expect(hostActions('question').map((a) => a.id)).toEqual(['reveal', 'pause', 'skip']);
    expect(hostActions('reveal').map((a) => a.id)).toEqual(['board']);
    expect(hostActions('board').map((a) => a.id)).toEqual(['next', 'end']);
    expect(hostActions('end').map((a) => a.id)).toEqual(['home']);
  });

  it('swaps pause for resume while the question is frozen', () => {
    // A paused question may only resume or be skipped: the engine refuses a plain
    // reveal while paused, so no dead Reveal button is offered.
    const ids = hostActions('question', true).map((a) => a.id);
    expect(ids).toEqual(['resume', 'skip']);
    expect(ids).not.toContain('pause');
    expect(ids).not.toContain('reveal');
  });

  it('offers no Pause for a slide, which has no clock to freeze', () => {
    // `engine.pause` refuses a slide, so the control must not be offered.
    const ids = hostActions('question', false, 'slide').map((a) => a.id);
    expect(ids).toEqual(['reveal', 'skip']);
    expect(ids).not.toContain('pause');
    // A normal question still offers Pause.
    expect(hostActions('question', false, 'single').map((a) => a.id)).toContain('pause');
  });

  it('offers no game transition after the end', () => {
    const ids = hostActions('end').map((a) => a.id);
    for (const forbidden of ['start', 'reveal', 'board', 'next', 'end', 'skip']) {
      expect(ids).not.toContain(forbidden);
    }
  });

  it('marks only the destructive actions as such', () => {
    expect(hostActions('board').find((a) => a.id === 'end')?.variant).toBe('danger');
    expect(hostActions('question').find((a) => a.id === 'skip')?.variant).toBe('danger');
    expect(hostActions('lobby').every((a) => a.variant === 'primary')).toBe(true);
    // Reveal is always primary; pause/resume swap places and stay primary.
    expect(hostActions('question').find((a) => a.id === 'reveal')?.variant).toBe('primary');
    expect(hostActions('question').find((a) => a.id === 'pause')?.variant).toBe('primary');
    expect(hostActions('question', true).find((a) => a.id === 'resume')?.variant).toBe('primary');
  });
});

describe('connection status', () => {
  it('labels each status', () => {
    expect(connectionStatus('connected').label).toBe('Connected');
    expect(connectionStatus('reconnecting').label).toBe('Reconnecting…');
    expect(connectionStatus('offline').label).toBe('Connection lost');
  });

  it('never signals a status by colour alone (each chip has a tone)', () => {
    for (const status of ['connected', 'reconnecting', 'offline'] as const) {
      expect(connectionStatus(status).tone).toBeTruthy();
    }
  });

  it('only treats a live socket as connected', () => {
    expect(canAct('connected')).toBe(true);
    expect(canAct('reconnecting')).toBe(false);
    expect(canAct('offline')).toBe(false);
  });

  it('moves to reconnecting on disconnect and back on connect', () => {
    expect(nextStatus('connected', 'disconnect')).toBe('reconnecting');
    expect(nextStatus('reconnecting', 'connect')).toBe('connected');
  });

  it('treats connect_error as offline, not merely reconnecting', () => {
    expect(nextStatus('connected', 'connect_error')).toBe('offline');
  });

  it('never downgrades an offline socket to reconnecting on a disconnect', () => {
    expect(nextStatus('offline', 'disconnect')).toBe('offline');
  });
});

describe('remembered game', () => {
  /** A `Storage` stub that can also be told to throw, as private mode does. */
  function storage(): Storage & { failing?: boolean } {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (key: string) => map.get(key) ?? null,
      key: (index: number) => [...map.keys()][index] ?? null,
      removeItem: (key: string) => void map.delete(key),
      setItem: (key: string, value: string) => void map.set(key, value),
    };
  }

  it('round-trips a game id', () => {
    const store = storage();
    rememberGame('g-123', store);
    expect(rememberedGame(store)).toBe('g-123');
    expect(store.getItem(GAME_KEY)).toBe('g-123');
  });

  it('forgets a game on request', () => {
    const store = storage();
    rememberGame('g-123', store);
    forgetGame(store);
    expect(rememberedGame(store)).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    const broken = {
      get length() {
        return 0;
      },
      clear: () => undefined,
      getItem: () => {
        throw new Error('blocked');
      },
      key: () => null,
      removeItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;

    expect(() => rememberGame('g-123', broken)).not.toThrow();
    expect(() => forgetGame(broken)).not.toThrow();
    expect(rememberedGame(broken)).toBeNull();
  });
});

describe('attachHostHandlers', () => {
  it('registers each listener exactly once, however often it is called', () => {
    const socket = fakeSocket();
    const handlers = handlersFor();
    attachHostHandlers(socket, handlers);
    attachHostHandlers(socket, handlers);
    attachHostHandlers(socket, handlers);

    for (const event of [
      'host:lobby',
      'host:question',
      'host:answers',
      'host:reveal',
      'host:board',
      'host:ended',
    ]) {
      expect(socket.count(event)).toBe(1);
    }
  });

  it('fires the latest handlers without re-registering', () => {
    const socket = fakeSocket();
    const first = handlersFor({ lobby: vi.fn() });
    const second = handlersFor({ lobby: vi.fn() });

    attachHostHandlers(socket, first);
    attachHostHandlers(socket, second);
    socket.emit('host:lobby', { pin: '1', players: [] });

    expect(first.lobby).not.toHaveBeenCalled();
    expect(second.lobby).toHaveBeenCalledTimes(1);
    expect(socket.count('host:lobby')).toBe(1);
  });

  it('does not double-fire on a second registration', () => {
    const socket = fakeSocket();
    const lobby = vi.fn();
    attachHostHandlers(socket, handlersFor({ lobby }));
    attachHostHandlers(socket, handlersFor({ lobby }));

    socket.emit('host:lobby', { pin: '1', players: [] });
    expect(lobby).toHaveBeenCalledTimes(1);
  });

  it('routes every event to its own handler', () => {
    const socket = fakeSocket();
    const handlers = handlersFor();
    attachHostHandlers(socket, handlers);

    socket.emit('host:question', { id: 'q1' });
    socket.emit('host:answers', { questionId: 'q1', answered: 1, total: 2 });
    socket.emit('host:reveal', { question: {}, distribution: {} });
    socket.emit('host:board', { players: [] });
    socket.emit('host:ended', { players: [] });
    socket.emit('host:paused', { questionId: 'q1', remainingMs: 5000 });
    socket.emit('host:resumed', { questionId: 'q1', remainingMs: 5000 });

    expect(handlers.question).toHaveBeenCalledTimes(1);
    expect(handlers.answers).toHaveBeenCalledTimes(1);
    expect(handlers.reveal).toHaveBeenCalledTimes(1);
    expect(handlers.board).toHaveBeenCalledTimes(1);
    expect(handlers.ended).toHaveBeenCalledTimes(1);
    expect(handlers.paused).toHaveBeenCalledTimes(1);
    expect(handlers.resumed).toHaveBeenCalledTimes(1);
  });

  it('stops firing after detach, and re-registers cleanly afterwards', () => {
    const socket = fakeSocket();
    const lobby = vi.fn();
    const detach = attachHostHandlers(socket, handlersFor({ lobby }));

    detach();
    socket.emit('host:lobby', { pin: '1', players: [] });
    expect(lobby).not.toHaveBeenCalled();
    expect(socket.offCalls.count).toBe(8);

    attachHostHandlers(socket, handlersFor({ lobby }));
    socket.emit('host:lobby', { pin: '1', players: [] });
    expect(lobby).toHaveBeenCalledTimes(1);
    expect(socket.count('host:lobby')).toBe(1);
  });

  it('detachHostHandlers is a no-op for an unwired socket', () => {
    const socket = fakeSocket();
    expect(() => detachHostHandlers(socket)).not.toThrow();
  });
});

/** A complete handler set, with every entry a fresh spy unless overridden. */
function handlersFor(overrides: Partial<HostEventHandlers> = {}): HostEventHandlers {
  return {
    lobby: vi.fn(),
    question: vi.fn(),
    answers: vi.fn(),
    reveal: vi.fn(),
    board: vi.fn(),
    ended: vi.fn(),
    paused: vi.fn(),
    resumed: vi.fn(),
    ...overrides,
  };
}

describe('revealBody (Phase 6.5.3, decision B)', () => {
  it('shows a skipped reveal as neutralised, with no solution or distribution', () => {
    const reveal: HostReveal = {
      skipped: true,
      question: { id: 'q1', type: 'single', text: 'Capital of France?' },
    };
    const html = revealBody(reveal).outerHTML;
    expect(html).toContain('Capital of France?');
    expect(html).toContain('Question skipped');
    // The solution must never appear: the union carries no field for it.
    expect(html).not.toContain('Correct');
    expect(html).not.toContain('Paris');
    expect(html).not.toContain('distribution');
  });

  it('shows a regular reveal with the solution and the distribution', () => {
    const reveal: HostReveal = {
      skipped: false,
      question: {
        id: 'q1',
        type: 'single',
        text: 'Capital of France?',
        timeLimit: 20,
        points: 'standard',
        options: ['Paris', 'Rome'],
        correctIndex: 0,
      },
      distribution: { '0': 3, '1': 1 },
    };
    const html = revealBody(reveal).outerHTML;
    expect(html).toContain('Capital of France?');
    expect(html).toContain('Correct: Paris');
    expect(html).not.toContain('Question skipped');
  });
});
