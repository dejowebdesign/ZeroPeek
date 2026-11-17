/**
 * Host surface: sign in, pick a quiz, run the game on the big screen, and read
 * the reports afterwards.
 *
 * The host socket authenticates from the session cookie, so the page must have
 * a valid session before it connects. Login is a small form; everything after
 * that is the beamer: lobby with the PIN, the question with a live timer, the
 * answer distribution, the leaderboard and the final podium.
 */

import {
  type GamePhase,
  type HostConnectionStatus,
  type HostReveal,
  type HostState,
  type LeadState,
  type PublicPlayer,
  type PublicQuestion,
  type QuestionType,
} from '@zeropeek/shared';

import { get, post, setCsrfToken, ApiError } from '../api.js';
import { el, render } from '../dom.js';
import { appShell } from '../navigation.js';
import { connectHost, request, type HostSocket } from '../socket.js';
import { ClockSync } from '../clockSync.js';
import { playerAvatar } from '../avatar.js';
import {
  leaderboardRow,
  participantCard,
  podiumPlace,
  questionDisplayOptions,
} from '../showView.js';
import {
  attachHostHandlers,
  canAct,
  connectionStatus,
  forgetGame,
  hostActions,
  hostScreen,
  nextStatus,
  rememberedGame,
  rememberGame,
  revealBody,
  type HostEventHandlers,
} from '../hostView.js';
import {
  ShowController,
  samePhaseScenes,
  sceneDefinition,
  sceneInputOf,
  type SceneInput,
} from '../showScenes.js';
import {
  brand,
  button,
  chip,
  confirmDialog,
  countdown,
  emptyState,
  errorText,
  field,
  notice,
  setBusy,
  toast,
} from '../ui.js';

interface MeResponse {
  user: { id: string; username: string; role: string } | null;
  csrfToken?: string;
}

interface QuizSummary {
  id: string;
  title: string;
  questionCount: number;
}

/** A game the host has created or resumed. */
interface HostGame {
  id: string;
  pin: string;
}

interface GameRow {
  id: string;
  pin: string;
  phase: string;
  createdAt: string;
  /** Null when the source quiz was deleted; the snapshot title is used instead. */
  quiz: { id: string | null; title: string } | null;
  questionCount: number | null;
  _count: { players: number };
}

interface GameReport {
  quiz: { id: string; title: string };
  players: Array<{ rank: number; nickname: string; score: number; answered: number }>;
  questions: Array<{ text: string; answered: number; correct: number }>;
}

const appElement = document.getElementById('app');
if (!appElement) throw new Error('ZeroPeek: the #app element is missing.');
const app: HTMLElement = appElement;

let socket: HostSocket | null = null;
let me: MeResponse['user'] = null;
let timerHandle: number | null = null;
/**
 * The clock correction for this host socket (Phase 6.8.5). The countdown is
 * drawn against the server's clock, so a host whose own clock is off still shows
 * the same number as the players. `null` until the first measurement lands.
 */
let clock: ClockSync | null = null;
/** The node showing the running answer count, while a question is open. */
let answerCountNode: HTMLElement | null = null;
/** Players seen in the lobby, used to seed the answer count before the first answer. */
let lobbyPlayerCount = 0;
/** The game currently being controlled, so a reconnect can re-request its state. */
let activeGame: HostGame | null = null;
/**
 * The show scene controller (Phase 6.9.2). It folds the authoritative state into
 * the current show scene and lets the host step between the scenes of a phase
 * without touching the game. Presentation only.
 */
const show = new ShowController();
/** The host's own connection state, shown in the control bar. */
let connection: HostConnectionStatus = 'connected';
/** Whether the socket has connected at least once (so a `connect` is a reconnect). */
let hasConnected = false;
/** The node carrying the connection banner, replaced by every game screen. */
let bannerNode: HTMLElement | null = null;
/** The open question and its answer count, so pause/resume can re-render in place. */
let currentQuestion: PublicQuestion | null = null;
let currentAnswers: { answered: number; total: number } | null = null;
/**
 * When the last live room event was drawn. A resync snapshot taken before this
 * instant is stale (see `resync`), so it must not be rendered over the newer
 * event.
 */
let lastLiveEventAt = 0;
/** Guards against a slow resync overwriting a newer one. */
let resyncToken = 0;

/** Stop the countdown timer, if running. */
function stopTimer(): void {
  if (timerHandle !== null) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

/**
 * Render a countdown into `node` for a question opened at `openedAt`.
 *
 * The visual is the shared wireframe ring (`countdown`): the number is written
 * into `.countdown__value` and the ring's `--progress` follows the remaining
 * time. The elapsed time is measured against the **server's** clock (Phase
 * 6.8.5) via `clock`, so a host whose own clock is off still shows the same
 * number as the players; before the first measurement lands `clock.serverNow()`
 * falls back to the local clock, which is the previous behaviour.
 */
function startTimer(node: HTMLElement, openedAt: number, seconds: number): void {
  stopTimer();
  const value = node.querySelector<HTMLElement>('.countdown__value');
  const tick = (): void => {
    const now = clock ? clock.serverNow() : Date.now();
    const elapsed = Math.floor((now - openedAt) / 1000);
    const left = Math.max(0, seconds - elapsed);
    const label = `${left}s`;
    if (value) value.textContent = label;
    else node.textContent = label;
    node.style.setProperty('--progress', String(seconds > 0 ? left / seconds : 0));
    if (left === 0) stopTimer();
  };
  tick();
  timerHandle = window.setInterval(tick, 250);
}

/**
 * Render the start countdown into `node` (Phase 6.9.1).
 *
 * The number is derived from the server's own `endsAt`, measured against the
 * server clock (`clock.serverNow()`), so the host shows the same countdown the
 * players see and a reconnect mid-countdown resumes the remaining time instead
 * of restarting. Nothing here decides the phase: the transition to `question`
 * arrives as its own server event.
 */
function startLeadTimer(node: HTMLElement, lead: LeadState): void {
  stopTimer();
  const value = node.querySelector<HTMLElement>('.countdown__value');
  const total = Math.max(1, lead.durationSeconds);
  const tick = (): void => {
    const now = clock ? clock.serverNow() : Date.now();
    const remainingMs = Math.max(0, lead.endsAt - now);
    const left = Math.ceil(remainingMs / 1000);
    if (value) value.textContent = String(left);
    else node.textContent = String(left);
    node.style.setProperty('--progress', String(Math.min(1, remainingMs / (total * 1000))));
    if (remainingMs <= 0) stopTimer();
  };
  tick();
  timerHandle = window.setInterval(tick, 250);
}

/** The login screen. */
function showLogin(message?: string): void {
  stopTimer();
  const username = el('input', { class: 'input', autocomplete: 'username' });
  const password = el('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'current-password',
  });
  const feedback = el('div');
  const submit = button('Sign in', {
    variant: 'primary',
    onClick: async () => {
      feedback.replaceChildren();
      setBusy(submit, true);
      try {
        const result = await post<MeResponse>('/api/auth/login', {
          username: username.value.trim(),
          password: password.value,
        });
        if (result.csrfToken) setCsrfToken(result.csrfToken);
        me = result.user;
        await showHome();
      } catch (error) {
        feedback.replaceChildren(notice(errorText(error), 'error'));
      } finally {
        setBusy(submit, false);
      }
    },
  });

  render(
    app,
    el(
      'section',
      { class: 'centered' },
      el(
        'form',
        {
          class: 'card join',
          onsubmit: (event: Event) => {
            event.preventDefault();
            submit.click();
          },
        },
        brand(),
        el('h1', { class: 'join__title' }, 'Host sign in'),
        el('p', { class: 'muted' }, 'Sign in to create a game and control it.'),
        field('Username', username),
        field('Password', password),
        message ? notice(message, 'info') : null,
        feedback,
        el('div', { class: 'join__actions' }, submit),
      ),
    ),
  );
  username.focus();
}

/**
 * Ensure the host socket exists, and wire its listeners exactly once.
 *
 * The listeners are registered here — never inside a render function — and
 * `attachHostHandlers` guarantees a single registration per socket. Each handler
 * dispatches through `renderHostState`, so a re-render or a reconnect changes
 * what is drawn without ever adding a second listener.
 */
function ensureSocket(): HostSocket {
  if (!socket) {
    const host = connectHost();
    socket = host;
    // Measure the offset to the server clock for this socket (Phase 6.8.5). The
    // round is fired immediately and again on every reconnect below.
    clock = new ClockSync(host);
    void clock.sync();

    attachHostHandlers(host, {
      lobby: (payload) => {
        lastLiveEventAt = Date.now();
        renderHostState({ kind: 'lobby', pin: payload.pin, players: payload.players });
      },
      lead: (lead) => {
        lastLiveEventAt = Date.now();
        renderHostState({ kind: 'lead', lead });
      },
      question: (question) => {
        lastLiveEventAt = Date.now();
        renderHostState({ kind: 'question', question });
      },
      answers: (payload) => {
        lastLiveEventAt = Date.now();
        // Keep the held count in step with the DOM, so a pause/resume re-render
        // (which redraws from `currentAnswers`) shows the current number rather
        // than the one from when the question opened.
        currentAnswers = { answered: payload.answered, total: payload.total };
        if (answerCountNode) {
          answerCountNode.textContent = `${payload.answered} / ${payload.total} answers`;
        }
      },
      reveal: (payload) => {
        lastLiveEventAt = Date.now();
        renderHostState({ kind: 'reveal', reveal: payload });
      },
      board: (payload) => {
        lastLiveEventAt = Date.now();
        renderHostState({ kind: 'board', players: payload.players });
      },
      ended: (payload) => {
        lastLiveEventAt = Date.now();
        renderHostState({ kind: 'end', players: payload.players });
      },
      // A pause/resume only changes the clock and the controls, so the question
      // screen is re-rendered in place from the state already held, rather than
      // waiting for a fresh `host:question`.
      paused: (payload) => {
        lastLiveEventAt = Date.now();
        if (currentQuestion && currentQuestion.id === payload.questionId) {
          renderHostState({
            kind: 'question',
            question: {
              ...currentQuestion,
              paused: true,
              remainingMs: payload.remainingMs,
            },
            answers: currentAnswers,
          });
        }
      },
      resumed: (payload) => {
        lastLiveEventAt = Date.now();
        if (currentQuestion && currentQuestion.id === payload.questionId) {
          // The host countdown is re-anchored at the server's current instant for
          // the remaining seconds (Phase 6.8.5), so it lines up with what the
          // players see instead of with the host's own wall clock. The server
          // stays authoritative for the actual deadline.
          const resumedAt = clock ? clock.serverNow() : Date.now();
          renderHostState({
            kind: 'question',
            question: {
              ...currentQuestion,
              paused: false,
              remainingMs: null,
              // The timer restarts from the resumed moment for the remaining time.
              openedAt: resumedAt,
              timeLimit: Math.max(1, Math.ceil(payload.remainingMs / 1000)),
            },
            answers: currentAnswers,
          });
        }
      },
    } satisfies HostEventHandlers);

    host.on('connect', () => {
      const wasConnected = hasConnected;
      hasConnected = true;
      // Re-measure the offset on every (re)connect: a reconnect may land on a
      // different backend process, and a laptop that slept has a drifted clock.
      void clock?.sync();
      // A reconnect must re-ask the server and must NOT be "connected" for
      // control purposes until that snapshot is on screen. Marking the
      // connection live only after the resync lands keeps the controls disabled
      // for the whole reconnection, so a click during it cannot be sent against a
      // phase the server may already have left.
      if (wasConnected) {
        setConnection('reconnecting');
        void resync().finally(() => setConnection('connected'));
      } else {
        setConnection('connected');
      }
    });
    host.on('disconnect', () => setConnection(nextStatus(connection, 'disconnect')));
    host.on('connect_error', () => setConnection(nextStatus(connection, 'connect_error')));
  }
  return socket;
}

/** Update the connection banner, then re-enable or disable the controls. */
function setConnection(status: HostConnectionStatus): void {
  connection = status;
  if (!bannerNode) return;
  const { label, tone } = connectionStatus(status);
  bannerNode.replaceChildren(chip(label, tone, true));
  bannerNode.className = `host-connection host-connection--${status}`;
  // A disabled control is a courtesy, not a guard: the server still validates.
  for (const node of app.querySelectorAll<HTMLButtonElement>('button[data-host-action]')) {
    node.disabled = !canAct(status);
  }
}

/** Re-request the authoritative state after a reconnect. */
async function resync(): Promise<void> {
  if (!activeGame) return;
  const token = ++resyncToken;
  const requestedAt = Date.now();
  try {
    const state = await request<HostState>(ensureSocket(), 'host:join', { gameId: activeGame.id });
    // Drop a superseded resync: a newer one already started, or a live room
    // event arrived *after* this snapshot was requested — so the snapshot is
    // older than what is already on screen. The ACK of a command and the room
    // broadcast of the same transition travel on the same socket, and either may
    // arrive first; rendering a snapshot taken before a newer event would show a
    // phase the server has already left.
    if (token !== resyncToken) return;
    if (lastLiveEventAt > requestedAt) return;
    activeGame = { id: state.gameId, pin: state.pin };
    renderHostState({ kind: 'sync', state });
  } catch (error) {
    toast(errorText(error), 'error');
  }
}

/** The events a host screen can be rendered from, live or on reconnect. */
type HostRender =
  | { kind: 'lobby'; pin: string; players: PublicPlayer[] }
  | { kind: 'lead'; lead: LeadState }
  | {
      kind: 'question';
      question: PublicQuestion;
      answers?: { answered: number; total: number } | null;
    }
  | { kind: 'reveal'; reveal: HostReveal }
  | { kind: 'board'; players: PublicPlayer[] }
  | { kind: 'end'; players: PublicPlayer[] }
  | { kind: 'sync'; state: HostState };

/** The authoritative descriptor a render input maps to (Phase 6.9.2). */
function descriptorOf(input: HostRender): SceneInput {
  switch (input.kind) {
    case 'sync':
      return sceneInputOf(input.state) ?? { phase: 'lobby', questionId: null };
    case 'lobby':
      return { phase: 'lobby', questionId: null };
    case 'lead':
      return { phase: 'lead', questionId: null };
    case 'question':
      return { phase: 'question', questionId: input.question.id };
    case 'reveal':
      return { phase: 'reveal', questionId: input.reveal.question.id };
    case 'board':
      return { phase: 'board', questionId: null };
    default:
      return { phase: 'end', questionId: null };
  }
}

/** The last render input, so a presentation-only scene step can re-render it. */
let lastRender: HostRender | null = null;

/**
 * Re-render the situation currently on screen. Used only after a presentation
 * scene step: the descriptor is unchanged, so `show.sync` keeps the stepped
 * scene and nothing about the game moves.
 */
function rerender(): void {
  if (lastRender) renderHostState(lastRender);
}

/**
 * The single entry point for every host screen, whether it was triggered by a
 * live event or by a reconnect. Nothing here decides the phase from local
 * state: the payload already carries it, so the host always shows what the
 * server last said. The show controller (Phase 6.9.2) is folded in here so the
 * scene is always derived from the same authoritative descriptor.
 */
function renderHostState(input: HostRender): void {
  lastRender = input;
  show.sync(descriptorOf(input));

  if (input.kind === 'sync') {
    activeGame = { id: input.state.gameId, pin: input.state.pin };
    const screen = hostScreen(input.state);
    if (screen === 'lobby') return showLobby(input.state.pin, input.state.players ?? []);
    if (screen === 'lead' && input.state.lead) return showLead(input.state.lead);
    if (screen === 'reveal' && input.state.reveal) return showReveal(input.state.reveal);
    if (screen === 'board') return showBoard(input.state.players ?? []);
    if (screen === 'end') return showPodium(input.state.players ?? input.state.podium ?? []);
    if (input.state.question) return showQuestion(input.state.question, input.state.answers);
    return showLobby(input.state.pin, input.state.players ?? []);
  }

  switch (input.kind) {
    case 'lobby':
      return showLobby(input.pin, input.players);
    case 'lead':
      return showLead(input.lead);
    case 'question':
      return showQuestion(input.question, input.answers);
    case 'reveal':
      return showReveal(input.reveal);
    case 'board':
      return showBoard(input.players);
    default:
      return showPodium(input.players);
  }
}

/**
 * Whether the show is in presentation mode (Phase 6.9.2). When on, the host
 * controls and the scene bar are hidden so the beamer shows a clean stage; the
 * toggle itself stays visible so the host can leave the mode. In-memory only —
 * a reload returns to the steering view.
 */
let presentationMode = false;

/** The `show-presentation` modifier, applied to the board of every scene. */
function presentationClass(): string {
  return presentationMode ? ' show-presentation' : '';
}

/**
 * The presentation-mode toggle. It only shows or hides the host chrome; it sends
 * no game command and changes no state the server owns.
 */
function presentationToggle(): HTMLElement {
  return el(
    'div',
    { class: 'show__present' },
    button(presentationMode ? 'Exit presentation' : 'Presentation mode', {
      variant: 'ghost',
      small: true,
      ariaLabel: presentationMode
        ? 'Leave presentation mode and show the host controls'
        : 'Hide the host controls for a clean presentation',
      onClick: () => {
        presentationMode = !presentationMode;
        rerender();
      },
    }),
  );
}

/**
 * The show scene bar (Phase 6.9.2): the current scene's name and presentation-
 * only steps to the other scenes of the same phase. It sends no game command —
 * stepping only changes what is drawn — so it cannot create an invalid state.
 * Returns `null` for a phase with a single scene, so nothing is drawn where
 * there is nothing to choose.
 */
function sceneBar(): HTMLElement | null {
  const phase = show.currentPhase;
  if (phase === null) return null;
  const scenes = samePhaseScenes(phase);
  const current = sceneDefinition(show.current);
  const steppable = scenes.length > 1;

  const steps = steppable
    ? [
        button('‹', {
          small: true,
          ariaLabel: 'Previous scene',
          onClick: () => {
            show.cycle(-1);
            rerender();
          },
        }),
        ...scenes.map((id) =>
          button(sceneDefinition(id).title, {
            variant: id === show.current ? 'primary' : 'ghost',
            small: true,
            disabled: id === show.current,
            onClick: () => {
              if (show.step(id)) rerender();
            },
          }),
        ),
        button('›', {
          small: true,
          ariaLabel: 'Next scene',
          onClick: () => {
            show.cycle(1);
            rerender();
          },
        }),
      ]
    : [];

  return el(
    'div',
    { class: 'show__scene-bar' },
    el('span', { class: 'show__scene-label' }, `Scene ${current.order} of 13 · ${current.title}`),
    steppable ? el('div', { class: 'show__scene-steps' }, ...steps) : null,
    presentationToggle(),
  );
}

/** Re-request a game's authoritative state and render the phase it reports. */
async function resumeGame(gameId: string): Promise<void> {
  try {
    const state = await request<HostState>(ensureSocket(), 'host:join', { gameId });
    activeGame = { id: state.gameId, pin: state.pin };
    rememberGame(state.gameId);
    renderHostState({ kind: 'sync', state });
  } catch (error) {
    forgetGame();
    toast(errorText(error), 'error');
  }
}

/** The home screen: choose a quiz, resume a game, or read the reports. */
async function showHome(): Promise<void> {
  stopTimer();
  answerCountNode = null;
  bannerNode = null;
  // No game under control: the show resets to its client-side welcome scene and
  // forgets the last render, so a later step cannot re-draw a finished game.
  lastRender = null;
  show.sync(null);
  try {
    const [{ quizzes }, { games }] = await Promise.all([
      get<{ quizzes: QuizSummary[] }>('/api/quizzes'),
      get<{ games: GameRow[] }>('/api/reports/games'),
    ]);

    const start = async (quizId: string): Promise<void> => {
      try {
        // The server ACKs with the full host state; the lobby is drawn from it.
        const state = await request<HostState>(ensureSocket(), 'host:create', { quizId });
        activeGame = { id: state.gameId, pin: state.pin };
        rememberGame(state.gameId);
        renderHostState({ kind: 'sync', state });
      } catch (error) {
        toast(errorText(error), 'error');
      }
    };

    // The editor's "Start" action deep-links here as `?quiz=<id>`; honour it
    // once the quizzes are loaded, then clear it so a reload does not restart.
    const requestedQuizId = new URLSearchParams(location.search).get('quiz');
    if (requestedQuizId && quizzes.some((quiz) => quiz.id === requestedQuizId)) {
      history.replaceState(null, '', location.pathname);
      await start(requestedQuizId);
      return;
    }

    // A reload mid-game resumes the game the host was controlling, before the
    // home screen is drawn, so a refresh never strands the host on the overview.
    const pending = rememberedGame();
    if (pending && games.some((game) => game.id === pending && game.phase !== 'end')) {
      await resumeGame(pending);
      return;
    }
    if (pending) forgetGame();

    const open = games.filter((game) => game.phase !== 'end');
    const finished = games.filter((game) => game.phase === 'end');

    render(
      app,
      appShell({
        role: 'host',
        active: 'overview',
        badge: 'Host',
        isAdmin: me?.role === 'ADMIN',
        title: `Welcome, ${me?.username ?? 'host'}`,
        actions: [
          button('Editor', { onClick: () => (location.href = './editor.html') }),
          // Only administrators can reach the user management page.
          ...(me?.role === 'ADMIN'
            ? [button('Users', { onClick: () => (location.href = './admin.html') })]
            : []),
          button('Sign out', {
            onClick: async () => {
              try {
                await post('/api/auth/logout');
              } finally {
                me = null;
                socket?.disconnect();
                socket = null;
                showLogin();
              }
            },
          }),
        ],
        children: [
          el(
            'section',
            { class: 'wrap' },
            open.length
              ? el(
                  'div',
                  null,
                  el('h2', { class: 'section-title' }, 'Open games'),
                  el(
                    'ul',
                    { class: 'quiz-list' },
                    ...open.map((game) =>
                      el(
                        'li',
                        { class: 'quiz-list__item card' },
                        el(
                          'div',
                          null,
                          el(
                            'h2',
                            { class: 'quiz-list__title' },
                            `${game.quiz?.title ?? 'Deleted quiz'} · ${game.pin}`,
                          ),
                          el(
                            'p',
                            { class: 'muted' },
                            `${game._count.players} player(s) · ${game.phase}`,
                          ),
                        ),
                        el(
                          'div',
                          { class: 'quiz-list__actions' },
                          button('Resume', {
                            variant: 'primary',
                            onClick: () => void resumeGame(game.id),
                          }),
                        ),
                      ),
                    ),
                  ),
                )
              : null,
            el('h2', { class: 'section-title' }, 'Start a game'),
            quizzes.length === 0
              ? emptyState(
                  'No quizzes yet',
                  'Create your first quiz in the editor.',
                  button('Open editor', { onClick: () => (location.href = './editor.html') }),
                )
              : el(
                  'ul',
                  { class: 'quiz-list' },
                  ...quizzes.map((quiz) =>
                    el(
                      'li',
                      { class: 'quiz-list__item card' },
                      el(
                        'div',
                        null,
                        el('h2', { class: 'quiz-list__title' }, quiz.title),
                        el('p', { class: 'muted' }, `${quiz.questionCount} question(s)`),
                      ),
                      el(
                        'div',
                        { class: 'quiz-list__actions' },
                        button('Start', { variant: 'primary', onClick: () => void start(quiz.id) }),
                      ),
                    ),
                  ),
                ),
            el('h2', { class: 'section-title' }, 'Finished games'),
            finished.length === 0
              ? emptyState('No finished games yet', 'Finished games and their reports appear here.')
              : el(
                  'ul',
                  { class: 'report-list' },
                  ...finished.map((game) =>
                    el(
                      'li',
                      { class: 'report-list__item card' },
                      el('h3', null, game.quiz?.title ?? 'Deleted quiz'),
                      el(
                        'p',
                        { class: 'muted' },
                        `${game._count.players} player(s) · ${new Date(game.createdAt).toLocaleString()}`,
                      ),
                      el(
                        'div',
                        { class: 'quiz-list__actions' },
                        button('View report', { onClick: () => void showReport(game.id) }),
                        button('Ranking CSV', {
                          onClick: () => {
                            location.href = `/api/reports/games/${game.id}/ranking.csv`;
                          },
                        }),
                      ),
                    ),
                  ),
                ),
          ),
        ],
      }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      showLogin();
      return;
    }
    toast(errorText(error), 'error');
  }
}

/**
 * The connection banner every game screen shows. Kept in one node that
 * `setConnection` repaints, so a dropped socket is visible immediately and a
 * recovered one is announced without re-rendering the screen.
 */
function connectionBanner(): HTMLElement {
  bannerNode = el('div', {
    class: `host-connection host-connection--${connection}`,
    role: 'status',
  });
  const { label, tone } = connectionStatus(connection);
  bannerNode.replaceChildren(chip(label, tone, true));
  return bannerNode;
}

/** The game id of the game under control; screens are only reachable inside one. */
function currentGameId(): string {
  return activeGame?.id ?? '';
}

/**
 * The control bar for a phase, built from `hostActions` so the allowed controls
 * always match the server's phase (hostView §hostActions). Ending and skipping
 * keep a confirmation dialog; `home` leaves the game instead of commanding it.
 */
function controlsFor(phase: GamePhase, isPaused = false, type?: QuestionType): HTMLElement {
  const nodes = hostActions(phase, isPaused, type).map((action) => {
    if (action.id === 'home') {
      return button(action.label, {
        variant: action.variant,
        onClick: () => {
          activeGame = null;
          forgetGame();
          void showHome();
        },
      });
    }
    if (action.id === 'end') {
      const node = hostButton(action.label, 'host:end', { variant: action.variant });
      node.onclick = () => {
        confirmDialog({
          title: 'End the game now?',
          body: 'The current question ends immediately and the final results are shown. This cannot be undone.',
          confirmLabel: 'End game',
          onConfirm: () => void send('host:end'),
        });
      };
      return node;
    }
    if (action.id === 'skip') {
      const node = hostButton(action.label, 'host:skip', { variant: action.variant });
      node.onclick = () => {
        confirmDialog({
          title: 'Skip this question?',
          body: 'The question ends and is shown without its solution. It is not scored; answers already given stay on record.',
          confirmLabel: 'Skip question',
          onConfirm: () => void send('host:skip'),
        });
      };
      return node;
    }
    return hostButton(action.label, `host:${action.id}`, { variant: action.variant });
  });
  return el('div', { class: 'show__controls' }, ...nodes);
}

/** A control button, tagged so `setConnection` can disable every host action at
 * once while the socket is down. */
function hostButton(
  label: string,
  action: string,
  options: { variant?: 'primary' | 'danger' } = {},
): HTMLButtonElement {
  const node = button(label, { variant: options.variant, onClick: () => void send(action) });
  node.setAttribute('data-host-action', action);
  return node;
}

/**
 * The lobby-phase scenes (Phase 6.9.2): welcome, player join and participants.
 * They are three views of the same server phase, so the host may step between
 * them; only the join view steers (it carries the kick buttons). The join view
 * keeps the exact markup the host console has always shown.
 */
function showLobby(pin: string, initialPlayers: PublicPlayer[] = []): void {
  stopTimer();
  answerCountNode = null;
  const scene = show.current;

  // The join view's live roster. Built for every view so a step back to `join`
  // always shows the current players, but only wired into the DOM for `join`.
  const players = el('ul', { class: 'lobby__players' });
  const paint = (list: PublicPlayer[]): void => {
    lobbyPlayerCount = list.length;
    players.replaceChildren(
      ...list.map((player) =>
        el(
          'li',
          { class: 'lobby__player' },
          playerAvatar(player.nickname, player.avatar, { size: 'sm' }),
          el('span', { class: 'lobby__player-name' }, player.nickname),
          kickButton(player.id, player.nickname),
        ),
      ),
    );
  };
  paint(initialPlayers);

  let body: HTMLElement;
  let wide = false;
  if (scene === 'welcome') {
    body = el(
      'div',
      { class: 'lobby__welcome' },
      el('h2', { class: 'lobby__title' }, 'Welcome'),
      el('p', { class: 'muted' }, 'ZeroPeek – the game show is about to begin.'),
      el('p', { class: 'lobby__actions' }, chip(location.origin + '/', 'cyan')),
    );
  } else if (scene === 'participants') {
    wide = true;
    body = el(
      'div',
      { class: 'lobby__participants' },
      el('h2', { class: 'lobby__title' }, 'Participants'),
      el('p', { class: 'lobby__actions' }, chip(`${initialPlayers.length} player(s)`, 'cyan')),
      initialPlayers.length
        ? el('ol', { class: 'participants' }, ...initialPlayers.map(participantCard))
        : el('p', { class: 'muted' }, 'No players have joined yet.'),
    );
  } else {
    body = el(
      'div',
      { class: 'lobby__join' },
      el('p', { class: 'muted' }, 'Join at this address with the PIN'),
      el('p', { class: 'lobby__pin' }, pin),
      el('p', { class: 'lobby__actions' }, chip(location.origin + '/', 'cyan')),
      players,
    );
  }

  render(
    app,
    el(
      'section',
      { class: 'centered' },
      el(
        'div',
        { class: `card lobby anim-fade-in${wide ? ' lobby--wide' : ''}${presentationClass()}` },
        connectionBanner(),
        body,
        sceneBar(),
        controlsFor('lobby'),
      ),
    ),
  );

  setConnection(connection);
}

/**
 * Remove a player from the lobby. Confirmed, because the removal is immediate
 * and the player cannot rejoin the same slot without joining again.
 */
function kickButton(playerId: string, nickname: string): HTMLButtonElement {
  const node = button('Remove', {
    variant: 'danger',
    small: true,
    onClick: () => {
      confirmDialog({
        title: `Remove ${nickname}?`,
        body: 'The player is removed from this lobby. They can join again with the PIN.',
        confirmLabel: 'Remove',
        onConfirm: () => void sendKick(playerId),
      });
    },
  });
  node.setAttribute('data-host-action', 'host:kick');
  return node;
}

/** Send a kick for the game under control; the server re-checks the lobby. */
async function sendKick(playerId: string): Promise<void> {
  if (!canAct(connection)) {
    toast('Reconnect before you continue.', 'error');
    return;
  }
  const gameId = currentGameId();
  if (!gameId) return;
  try {
    await request(ensureSocket(), 'host:kick', { gameId, playerId });
  } catch (error) {
    toast(errorText(error), 'error');
  }
}

/**
 * Send a host command for the game under control, refusing to fire while the
 * socket is down so a stale click cannot be mistaken for a successful action.
 */
async function send(event: string): Promise<void> {
  if (!canAct(connection)) {
    toast('Reconnect before you continue.', 'error');
    return;
  }
  const gameId = currentGameId();
  if (!gameId) return;
  try {
    await request(ensureSocket(), event, { gameId });
  } catch (error) {
    toast(errorText(error), 'error');
  }
}

/**
 * The start-countdown screen (Phase 6.9.1). It reuses the existing beamer board
 * and wireframe countdown ring — no new layout — and shows the same server-owned
 * countdown the players see. The host can skip it; the server decides the
 * transition either way.
 */
function showLead(lead: LeadState): void {
  answerCountNode = null;
  currentQuestion = null;
  currentAnswers = null;
  const timer = countdown(Math.ceil(lead.durationSeconds), 1);

  render(
    app,
    el(
      'section',
      { class: 'centered show' },
      el(
        'div',
        { class: `show__board card anim-fade-in${presentationClass()}` },
        connectionBanner(),
        el('h2', { class: 'show__title' }, 'Get ready!'),
        el('p', { class: 'show__meta muted' }, 'The first question starts in'),
        timer,
        sceneBar(),
        controlsFor('lead'),
      ),
    ),
  );

  startLeadTimer(timer, lead);
  setConnection(connection);
}

/** The beamer question screen with a live timer and a running answer count. */
function showQuestion(
  question: PublicQuestion,
  answers?: { answered: number; total: number } | null,
): void {
  currentQuestion = question;
  currentAnswers = answers ?? null;

  const timer = countdown(question.timeLimit, 1);
  const count = el('p', { class: 'show__answers muted' }, '0 answers');
  answerCountNode = count;
  // Prefer the server's count from a reconnect; otherwise seed the total from
  // the lobby size so the wording is stable before the first answer arrives.
  if (answers) count.textContent = `${answers.answered} / ${answers.total} answers`;
  else if (lobbyPlayerCount) count.textContent = `0 / ${lobbyPlayerCount} answers`;

  const options = questionDisplayOptions(question);
  // The three question-phase scenes emphasise a different part of the same
  // board (Phase 6.9.2): the full board (default), the options without the ring,
  // or the ring without the options. Same data, same game — only the framing
  // changes.
  const scene = show.current;
  const showOptions = options.length > 0 && scene !== 'countdown';
  const showTimer = scene !== 'answers';

  render(
    app,
    el(
      'section',
      { class: 'centered show' },
      el(
        'div',
        { class: `show__board card question anim-fade-in${presentationClass()}` },
        connectionBanner(),
        el(
          'div',
          { class: 'question__meta muted' },
          `Question ${question.index + 1} of ${question.total}`,
        ),
        el('h2', { class: 'question__prompt' }, question.text),
        question.paused ? el('p', { class: 'show__paused' }, chip('Paused', 'warn', true)) : null,
        showTimer ? timer : null,
        count,
        showOptions
          ? el(
              'div',
              { class: 'show__options' },
              ...options.map((label, index) =>
                el(
                  'div',
                  { class: 'show__option' },
                  el('span', { class: 'option__key' }, String(index + 1)),
                  el('span', { class: 'show__option-label' }, label),
                ),
              ),
            )
          : null,
        sceneBar(),
        controlsFor('question', question.paused, question.type),
      ),
    ),
  );

  if (question.paused) {
    // Frozen at the server's remaining time: no interval runs, so the clock
    // cannot move while the game is paused.
    const remaining = Math.ceil((question.remainingMs ?? 0) / 1000);
    const value = timer.querySelector<HTMLElement>('.countdown__value');
    const limit = question.timeLimit * 1000;
    if (value) value.textContent = `${remaining}s`;
    timer.style.setProperty(
      '--progress',
      String(limit > 0 ? (question.remainingMs ?? 0) / limit : 0),
    );
  } else {
    // The timer is derived from the server's original `openedAt`, so a reconnect
    // continues the same countdown instead of restarting it.
    startTimer(timer, question.openedAt, question.timeLimit);
  }
  setConnection(connection);
}

/**
 * The reveal screen. A skipped question was neutralised, so it is shown as
 * "Question skipped" and never with its solution or answer distribution
 * (Phase 6.5.3, decision B). A regular reveal is unchanged.
 */
function showReveal(reveal: HostReveal): void {
  stopTimer();
  answerCountNode = null;
  currentQuestion = null;
  currentAnswers = null;

  const body = revealBody(reveal);
  // The reveal phase has two scenes (Phase 6.9.2): the plain answer reveal and
  // the "points awarded" view, which repeats the distribution under a points
  // heading. Both read the same server reveal; the per-player deltas arrive in
  // the payload and are shown in a later sub-phase.
  const heading = show.current === 'points' ? 'Points awarded' : null;

  render(
    app,
    el(
      'section',
      { class: 'centered show' },
      el(
        'div',
        { class: `show__board card question anim-fade-in${presentationClass()}` },
        connectionBanner(),
        heading ? el('h2', { class: 'show__title' }, heading) : null,
        body,
        sceneBar(),
        controlsFor('reveal'),
      ),
    ),
  );
  setConnection(connection);
}

/** The leaderboard screen. */
function showBoard(players: PublicPlayer[]): void {
  stopTimer();
  answerCountNode = null;
  const scene = show.current;
  render(
    app,
    el(
      'section',
      { class: 'centered show' },
      el(
        'div',
        { class: `show__board card anim-fade-in${presentationClass()}` },
        connectionBanner(),
        el('h2', { class: 'show__title' }, scene === 'final' ? 'Final round' : 'Leaderboard'),
        scene === 'final'
          ? el(
              'p',
              { class: 'show__meta muted' },
              'The last round is coming up — here is the current standing.',
            )
          : null,
        el('p', { class: 'show__meta' }, chip(`${players.length} player(s)`, 'cyan')),
        el('ol', { class: 'leaderboard leaderboard--show' }, ...players.map(leaderboardRow)),
        sceneBar(),
        controlsFor('board'),
      ),
    ),
  );
  setConnection(connection);
}

/** The final results: a podium for the top three plus the full ranking. */
function showPodium(players: PublicPlayer[]): void {
  stopTimer();
  answerCountNode = null;
  const [first, second, third, ...rest] = players;
  // The end phase has two scenes (Phase 6.9.2): the winner podium and the
  // closing/thanks view. The outro keeps the final standing on screen and adds a
  // short closing line; no report is fetched (the report stays on the console).
  const outro = show.current === 'outro';

  render(
    app,
    el(
      'section',
      { class: 'centered show' },
      el(
        'div',
        { class: `show__board card anim-pop${presentationClass()}` },
        connectionBanner(),
        el('h2', { class: 'show__title' }, outro ? 'Thank you for playing' : 'Final results'),
        first ? el('p', { class: 'show__winner' }, `Winner: ${first.nickname}`) : null,
        el(
          'ol',
          { class: 'podium' },
          second ? podiumPlace(second, 2) : null,
          first ? podiumPlace(first, 1) : null,
          third ? podiumPlace(third, 3) : null,
        ),
        rest.length
          ? el(
              'ol',
              { class: 'leaderboard leaderboard--show' },
              ...rest.map((player, index) => leaderboardRow(player, index + 3)),
            )
          : null,
        outro ? el('p', { class: 'show__meta muted' }, 'See you at the next round.') : null,
        sceneBar(),
        controlsFor('end'),
      ),
    ),
  );
  setConnection(connection);
}

/** A full report for one finished game. */
async function showReport(id: string): Promise<void> {
  try {
    const report = await get<{
      quiz: { id: string; title: string; questionCount: number };
      players: Array<{ nickname: string; score: number; rank: number }>;
      questions: Array<{ text: string; answered: number; correct: number }>;
    }>(`/api/reports/games/${id}`);
    render(
      app,
      appShell({
        role: 'host',
        active: 'reports',
        badge: 'Host',
        isAdmin: me?.role === 'ADMIN',
        title: report.quiz.title,
        actions: [button('Back', { onClick: () => void showHome() })],
        children: [
          el('h2', { class: 'section-title' }, 'Players'),
          el(
            'ol',
            { class: 'leaderboard' },
            ...report.players.map((player) =>
              el(
                'li',
                { class: 'leaderboard__row' },
                el('span', { class: 'leaderboard__rank' }, String(player.rank)),
                el('span', { class: 'leaderboard__name' }, player.nickname),
                el('span', { class: 'leaderboard__score' }, String(player.score)),
              ),
            ),
          ),
          el('h2', { class: 'section-title' }, 'Questions'),
          el(
            'table',
            { class: 'report-table' },
            el(
              'thead',
              null,
              el(
                'tr',
                null,
                el('th', null, 'Question'),
                el('th', null, 'Answered'),
                el('th', null, 'Correct'),
              ),
            ),
            el(
              'tbody',
              null,
              ...report.questions.map((question) =>
                el(
                  'tr',
                  null,
                  el('td', { 'data-label': 'Question' }, question.text),
                  el('td', { 'data-label': 'Answered' }, String(question.answered)),
                  el('td', { 'data-label': 'Correct' }, String(question.correct)),
                ),
              ),
            ),
          ),
        ],
      }),
    );
  } catch (error) {
    toast(errorText(error), 'error');
  }
}

// Boot: check for an existing session, then either go home or show the login.
void (async () => {
  try {
    const result = await get<MeResponse>('/api/auth/me');
    if (result.user) {
      me = result.user;
      if (result.csrfToken) setCsrfToken(result.csrfToken);
      await showHome();
      return;
    }
  } catch {
    // Not signed in.
  }
  showLogin();
})();
