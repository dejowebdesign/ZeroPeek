/**
 * Pure builders and rules for the host surface (Phase 6.5.2).
 *
 * Kept free of the DOM root and of the real socket so they can be unit-tested,
 * the same way `playerView.ts` serves the player. Two things live here:
 *
 *  - the phase → screen and phase → allowed-actions mapping, so the control bar
 *    is derived from the server's phase and never from a client guess;
 *  - the idempotent socket-listener registration, so re-rendering a screen can
 *    never accumulate duplicate listeners (the bug this phase fixes).
 */

import type {
  GamePhase,
  HostConnectionStatus,
  HostState,
  PublicPlayer,
  PublicQuestion,
  Question,
} from '@zeropeek/shared';

/** Which host screen a state maps to. */
export type HostScreen = 'lobby' | 'question' | 'reveal' | 'board' | 'end';

/** The `sessionStorage` key holding the game a reload should resume. */
export const GAME_KEY = 'zeropeek.host.game';

/**
 * Remember the game under control so a reload resumes it automatically.
 *
 * Best-effort: a browser in private mode can throw on storage access, and
 * auto-resume is a convenience, never a requirement, so a failure is ignored.
 */
export function rememberGame(gameId: string, storage: Storage = sessionStorage): void {
  try {
    storage.setItem(GAME_KEY, gameId);
  } catch {
    // See above.
  }
}

/** Forget the remembered game (the host left it deliberately). */
export function forgetGame(storage: Storage = sessionStorage): void {
  try {
    storage.removeItem(GAME_KEY);
  } catch {
    // See `rememberGame`.
  }
}

/** The game a reload should resume, or `null` if there is none. */
export function rememberedGame(storage: Storage = sessionStorage): string | null {
  try {
    return storage.getItem(GAME_KEY);
  } catch {
    return null;
  }
}

/**
 * Decide which screen a `HostState` must render.
 *
 * The screen follows the server's authoritative phase, so a host that reloads
 * mid-game resumes the live screen. `reveal` and `board` carry data that only
 * exists in those phases; if it is missing the state is treated as the phase
 * that can still be rendered safely rather than throwing.
 */
export function hostScreen(state: HostState): HostScreen {
  if (state.phase === 'end') return 'end';
  if (state.phase === 'board') return 'board';
  if (state.phase === 'reveal') return state.reveal ? 'reveal' : 'question';
  if (state.phase === 'question') return state.question ? 'question' : 'lobby';
  return 'lobby';
}

/** A control the host may use in the current phase. */
export type HostActionId = 'start' | 'reveal' | 'board' | 'next' | 'end' | 'home';

export interface HostAction {
  id: HostActionId;
  label: string;
  variant: 'primary' | 'danger';
}

/**
 * The actions allowed in a phase, verified against the engine:
 *
 *   lobby    – start (engine.start); no other transition is legal from the lobby
 *   question – reveal (engine.reveal); the timer and the auto-reveal are the
 *              only other ways out, so no "next" and no "end" here
 *   reveal   – board (engine.board)
 *   board    – next (engine.next) and end (engine.end)
 *   end      – none; only returning home, which is not a game action
 *
 * This is display only. Hiding a button is not a security measure: the server
 * re-checks the phase on every command and `engine` refuses an illegal one.
 */
export function hostActions(phase: GamePhase): HostAction[] {
  switch (phase) {
    case 'lobby':
      return [{ id: 'start', label: 'Start game', variant: 'primary' }];
    case 'question':
      return [{ id: 'reveal', label: 'Reveal', variant: 'primary' }];
    case 'reveal':
      return [{ id: 'board', label: 'Leaderboard', variant: 'primary' }];
    case 'board':
      return [
        { id: 'next', label: 'Next question', variant: 'primary' },
        { id: 'end', label: 'End game', variant: 'danger' },
      ];
    default:
      return [{ id: 'home', label: 'Back to home', variant: 'primary' }];
  }
}

/** The label and tone for the host's connection banner. */
export function connectionStatus(status: HostConnectionStatus): {
  label: string;
  tone: 'ok' | 'warn' | 'muted';
} {
  switch (status) {
    case 'connected':
      return { label: 'Connected', tone: 'ok' };
    case 'reconnecting':
      return { label: 'Reconnecting…', tone: 'warn' };
    default:
      return { label: 'Connection lost', tone: 'muted' };
  }
}

/**
 * How a connection event moves the host's status.
 *
 * `connect` is the only event that means "live": `disconnect` and `connect_error`
 * both leave the host unable to act, and only a fresh `connect` (followed by a
 * state re-fetch) may be shown as connected again. Keeping this pure makes the
 * "never show a stale state as current" rule testable.
 */
export function nextStatus(
  current: HostConnectionStatus,
  event: 'connect' | 'disconnect' | 'connect_error' | 'reconnect_attempt',
): HostConnectionStatus {
  if (event === 'connect') return 'connected';
  if (event === 'disconnect') return current === 'offline' ? 'offline' : 'reconnecting';
  return 'offline';
}

/** Whether a host action may be sent right now. Never while disconnected. */
export function canAct(status: HostConnectionStatus): boolean {
  return status === 'connected';
}

/** The events a host socket delivers, as consumed by the page. */
export interface HostEventHandlers {
  lobby: (payload: { pin: string; players: PublicPlayer[] }) => void;
  question: (question: PublicQuestion) => void;
  answers: (payload: { questionId: string; answered: number; total: number }) => void;
  reveal: (payload: { question: Question; distribution: Record<string, number> }) => void;
  board: (payload: { players: PublicPlayer[] }) => void;
  ended: (payload: { players: PublicPlayer[] }) => void;
}

/**
 * The subset of a socket this module needs, so a fake can stand in for tests.
 *
 * Typed loosely on purpose: the real `Socket` narrows event names to a literal
 * union and its listeners to typed payloads, neither of which is assignable from
 * the plain `string`/`unknown` shapes used here. `attachHostHandlers` only ever
 * passes names from its own fixed list, so the loose shape is safe and keeps the
 * caller free of casts.
 */
export interface ListenerSocket {
  on: (...args: never[]) => unknown;
  off?: (...args: never[]) => unknown;
}

type RawListener = (...args: unknown[]) => void;

/** The live handler set per socket, so a re-render swaps behaviour, not listeners. */
const liveHandlers = new WeakMap<object, HostEventHandlers>();
/** The listeners registered per socket, so a detach can remove exactly those. */
const registered = new WeakMap<object, Array<[string, RawListener]>>();

/**
 * Register the host's socket listeners exactly once per socket.
 *
 * Each registered listener reads the *current* handler set through
 * `liveHandlers`, so calling this again (after a re-render, or after a
 * reconnect) updates the behaviour without adding a duplicate listener. This is
 * what stops `showLobby` from stacking a fresh set of handlers on every call.
 *
 * Returns a detach function that removes exactly the listeners it added.
 */
export function attachHostHandlers(
  socket: ListenerSocket,
  handlers: HostEventHandlers,
): () => void {
  const key = socket as unknown as object;
  liveHandlers.set(key, handlers);
  if (registered.has(key)) return () => detachHostHandlers(socket);

  const register = socket.on as (event: string, listener: RawListener) => unknown;
  const forward =
    (pick: (handlers: HostEventHandlers) => RawListener): RawListener =>
    (...args: unknown[]): void => {
      const current = liveHandlers.get(key);
      if (current) pick(current)(...args);
    };

  const listeners: Array<[string, RawListener]> = [
    ['host:lobby', forward((h) => h.lobby as RawListener)],
    ['host:question', forward((h) => h.question as RawListener)],
    ['host:answers', forward((h) => h.answers as RawListener)],
    ['host:reveal', forward((h) => h.reveal as RawListener)],
    ['host:board', forward((h) => h.board as RawListener)],
    ['host:ended', forward((h) => h.ended as RawListener)],
  ];

  for (const [event, listener] of listeners) register(event, listener);
  registered.set(key, listeners);

  return () => detachHostHandlers(socket);
}

/** Remove the listeners registered by `attachHostHandlers`, if any. */
export function detachHostHandlers(socket: ListenerSocket): void {
  const key = socket as unknown as object;
  const listeners = registered.get(key);
  if (!listeners) return;
  const unregister = socket.off as ((event: string, listener: RawListener) => unknown) | undefined;
  if (unregister) for (const [event, listener] of listeners) unregister(event, listener);
  registered.delete(key);
  liveHandlers.delete(key);
}
