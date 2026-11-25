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
  RANDOM_BACKGROUND,
  backgroundPath,
  stepBackground,
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
import { hostDashboard, type DashboardPlayer } from '../hostDashboard.js';
import { connectHost, request, type HostSocket } from '../socket.js';
import { ClockSync } from '../clockSync.js';
import { playerAvatar } from '../avatar.js';
import { applyRoundBackground, clearRoundBackground } from '../background.js';
import { renderJoinQr } from '../joinQr.js';
import {
  leaderboardRow,
  participantCard,
  podiumPlace,
  questionDisplayOptions,
} from '../showView.js';
import {
  attachHostHandlers,
  autoHint,
  autoLabel,
  backgroundNeighbour,
  backgroundSelection,
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
import { ShowController, sceneInputOf, type SceneInput } from '../showScenes.js';
import { HostMusic } from '../hostMusic.js';
import { FinaleEffects } from '../finaleEffects.js';
import { startStarfield } from '../starfieldLayer.js';
import { optionLetter } from '../questionView.js';
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
  category?: string | null;
}

/**
 * The quiz the dashboard's start button would launch. Kept at module scope so a
 * repaint (a change of selection) and a return from a finished round both land on
 * the host's last choice rather than silently resetting to the newest quiz.
 */
let dashboardQuizId: string | null = null;

/** A game the host has created or resumed. */
interface HostGame {
  id: string;
  pin: string;
}

/** A finished or open game row from `/api/reports/games`. */
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
 * the current show scene. The scene is display-only — derived from the game
 * phase — so it never steers the game; it only selects which internal view of a
 * phase is drawn.
 */
const show = new ShowController();
/**
 * The server's AUTO mode for the game under control (Phase 6.9.3). The server
 * owns the value; this mirror is set from every authoritative state and from the
 * `host:auto` broadcast, so the toggle always shows what the game is actually
 * doing. Default off, like the server.
 */
let autoMode = false;
/** The AUTO toggle currently on screen, so its label can be repainted in place. */
let autoNode: HTMLButtonElement | null = null;
/**
 * The carousel position in force (Phase 6.14), mirrored from the server: a
 * catalogue id, or `random` when the round is on a random pick. The server owns
 * it; this mirror exists so a repaint can redraw the label and the arrows without
 * another round trip. The painted image is always the concrete `background` id,
 * never this value.
 */
let backgroundChoice: string = RANDOM_BACKGROUND;
/** The carousel's position line, repainted without rebuilding the arrows. */
let backgroundPositionNode: HTMLElement | null = null;
/** The carousel's arrows, so their destination labels follow the position. */
let backgroundPrevNode: HTMLButtonElement | null = null;
let backgroundNextNode: HTMLButtonElement | null = null;
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
/**
 * The host's background music (Phase 6.11). One instance for the page, driven by
 * the authoritative phase through `renderHostState`. It exists only on this
 * surface — the player page never imports the module — so the track can never
 * start on a participant device.
 */
const music = new HostMusic();
/** The music control currently on screen, so a mute or volume change repaints it. */
let musicNode: HTMLElement | null = null;
/**
 * The finale effects (Phase 6.11.2): rocket, explosion, applause and confetti on
 * the winner podium. One instance for the page, keyed on the game id so it runs
 * exactly once per game. Host-only: the player page never imports the module.
 */
const finale = new FinaleEffects();

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
        renderHostState({ kind: 'board', players: payload.players, hasNext: payload.hasNext });
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
      // The AUTO mode changed (Phase 6.9.3). The server is the source of truth,
      // so this only repaints the toggle — it never moves the game or the screen.
      auto: (payload) => {
        lastLiveEventAt = Date.now();
        setAuto(payload.auto);
      },
      // The round's background changed (Phase 6.10). The server owns the value, so
      // this only repaints the layer and the picker — it never moves the game.
      background: (payload) => {
        lastLiveEventAt = Date.now();
        setBackground(payload.background, payload.choice);
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
  | { kind: 'board'; players: PublicPlayer[]; hasNext: boolean }
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

/** The last render input, so the AUTO toggle can repaint the screen it is on. */
let lastRender: HostRender | null = null;

/**
 * Whether the game is paused in this render input (Phase 6.11).
 *
 * The pause is server-owned: it arrives as `question.paused` on a live event, on
 * a `paused` broadcast, or inside a `sync` snapshot. The music reads it from the
 * same place the paused badge does, so the two can never disagree.
 */
function isPausedRender(input: HostRender): boolean {
  if (input.kind === 'question') return input.question.paused;
  if (input.kind === 'sync') return input.state.question?.paused === true;
  return false;
}

/**
 * The single entry point for every host screen, whether it was triggered by a
 * live event or by a reconnect. Nothing here decides the phase from local
 * state: the payload already carries it, so the host always shows what the
 * server last said. The show controller (Phase 6.9.2) is folded in here so the
 * internal scene is always derived from the same authoritative descriptor, and
 * the AUTO mirror is refreshed from every snapshot.
 */
function renderHostState(input: HostRender): void {
  lastRender = input;
  show.sync(descriptorOf(input));
  // The music follows the authoritative phase, never a local flag (Phase 6.11).
  // `show.currentPhase` is derived from the same descriptor the screen is drawn
  // from, so music and screen can never disagree. A paused question freezes the
  // track exactly like the countdown.
  music.sync(show.currentPhase, isPausedRender(input));
  // The finale belongs to the end phase alone. Leaving it — a new round, a new
  // question, the lobby, or going home — cancels the canvas and silences the
  // effects, so nothing keeps playing over the next screen (Phase 6.11.2).
  if (show.currentPhase !== 'end') finale.stop();
  if (input.kind === 'sync') {
    autoMode = input.state.auto;
    // The authoritative background arrives with every snapshot, so a reload or a
    // reconnect restores exactly the image the round is using (Phase 6.10) and the
    // carousel position it was picked from (Phase 6.14).
    backgroundChoice = input.state.backgroundChoice;
    applyRoundBackground(input.state.background);
    activeGame = { id: input.state.gameId, pin: input.state.pin };
    const screen = hostScreen(input.state);
    if (screen === 'lobby') return showLobby(input.state.pin, input.state.players ?? []);
    if (screen === 'lead' && input.state.lead) return showLead(input.state.lead);
    if (screen === 'reveal' && input.state.reveal) return showReveal(input.state.reveal);
    if (screen === 'board') return showBoard(input.state.players ?? [], input.state.hasNext);
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
      return showBoard(input.players, input.hasNext);
    default:
      return showPodium(input.players);
  }
}

/**
 * The host's music control (Phase 6.11).
 *
 * A compact bar under the game controls: a mute button and a volume slider. It
 * is drawn on every live game screen so the host can reach it during a question
 * without leaving the beamer, and it is deliberately small so it never covers
 * the question.
 *
 * It is **display plus local preference only**: it never sends anything to the
 * server and never decides a phase. Volume and mute are the host's own mix, kept
 * in `localStorage`, so they survive a repaint, a reconnect and a reload, and
 * they are never transmitted to a player device.
 */
function musicControl(): HTMLElement | null {
  musicNode = null;
  // Only inside a game: the quiz picker (`lastRender === null`) is not the show.
  if (lastRender === null) return null;

  const settings = music.current;
  const percent = Math.round(settings.volume * 100);

  const muteButton = button(settings.muted ? 'Unmute' : 'Mute', {
    variant: settings.muted ? 'secondary' : 'ghost',
    small: true,
    ariaLabel: settings.muted ? 'Unmute the background music' : 'Mute the background music',
    onClick: () => {
      // The click is also the gesture that lifts a browser autoplay block.
      music.toggleMute();
      if (!music.current.muted) music.retry();
      repaintMusic();
    },
  });
  muteButton.setAttribute('data-music-mute', '');
  muteButton.setAttribute('aria-pressed', String(settings.muted));

  const slider = el('input', {
    class: 'music__slider',
    type: 'range',
    min: '0',
    max: '100',
    step: '1',
    value: String(percent),
    'aria-label': 'Background music volume',
  });
  slider.setAttribute('data-music-volume', '');
  // `input` (not `change`) so the level follows the handle while dragging.
  slider.addEventListener('input', () => {
    music.setVolume(Number(slider.value) / 100);
    repaintMusic();
  });

  const value = el('span', { class: 'music__value' }, `${percent}%`);
  const icon = el(
    'span',
    { class: 'music__icon', 'aria-hidden': 'true' },
    settings.muted ? '🔇' : '🔊',
  );

  musicNode = el(
    'div',
    {
      class: `music${settings.muted ? ' music--muted' : ''}`,
      role: 'group',
      'aria-label': 'Background music',
    },
    icon,
    slider,
    value,
    muteButton,
  );
  return musicNode;
}

/** Repaint the music control in place after a volume or mute change. */
function repaintMusic(): void {
  const node = musicNode;
  if (!node) return;
  const settings = music.current;
  const percent = Math.round(settings.volume * 100);
  node.classList.toggle('music--muted', settings.muted);
  const icon = node.querySelector<HTMLElement>('.music__icon');
  if (icon) icon.textContent = settings.muted ? '🔇' : '🔊';
  const value = node.querySelector<HTMLElement>('.music__value');
  if (value) value.textContent = `${percent}%`;
  const slider = node.querySelector<HTMLInputElement>('[data-music-volume]');
  // The handle stays where the host put it; only mute changes the sound, so
  // muting never rewrites the remembered level.
  if (slider && Number(slider.value) !== percent) slider.value = String(percent);
  const mute = node.querySelector<HTMLButtonElement>('[data-music-mute]');
  if (mute) {
    mute.textContent = settings.muted ? 'Unmute' : 'Mute';
    mute.setAttribute('aria-pressed', String(settings.muted));
    mute.className = `btn btn-${settings.muted ? 'secondary' : 'ghost'} btn-sm`;
    mute.setAttribute(
      'aria-label',
      settings.muted ? 'Unmute the background music' : 'Mute the background music',
    );
  }
}

/**
 * The AUTO toggle (Phase 6.9.3). It shows the server's authoritative mode and
 * asks the server to change it; it never changes the mode locally, so the label
 * can only ever show what the game is really doing. The standard is **Off**
 * (manual): the host advances the reveal and the leaderboard by hand. When it is
 * **On** the server runs those two transitions by itself.
 *
 * It is offered on every live game screen except the lobby (where it would mean
 * nothing yet) and the final screen (the game is over). The toggle itself is not
 * a `data-host-action` button: it stays clickable while the mode is known, but a
 * click while the socket is down is refused with the same guard as a command.
 */
function autoToggle(): HTMLElement | null {
  autoNode = null;
  if (lastRender === null) return null;
  const kind = lastRender.kind;
  // No AUTO before the game is frozen (lobby) or after it ended.
  if (kind === 'lobby' || kind === 'end') return null;
  if (kind === 'sync') {
    const screen = hostScreen(lastRender.state);
    if (screen === 'lobby' || screen === 'end') return null;
  }

  autoNode = button(autoLabel(autoMode), {
    variant: autoMode ? 'secondary' : 'ghost',
    small: true,
    ariaLabel: autoHint(autoMode),
    onClick: () => void toggleAuto(),
  });
  autoNode.setAttribute('data-auto-toggle', '');
  autoNode.setAttribute('aria-pressed', String(autoMode));
  return el('div', { class: 'show__auto' }, autoNode);
}

/**
 * The background carousel (Phase 6.14).
 *
 * A one-line selector: a left arrow, the position in force, a right arrow. It
 * replaces the former list of every background, which grew to eleven buttons and
 * pushed the lobby controls off a projector screen.
 *
 * There is no separate heading or description above it: the motif's name and the
 * position between the arrows already say which background is in force, and the
 * extra line only cost height on a projector.
 *
 * Two rules keep it honest:
 *   - The server owns the position. An arrow only *sends* the neighbouring id;
 *     the `host:background` broadcast repaints the row, exactly as before.
 *   - The arrows carry the destination in their accessible name ("Next:
 *     Skyline"), so a host on a projector knows what a click selects.
 */
function backgroundPicker(): HTMLElement | null {
  backgroundPositionNode = null;
  backgroundPrevNode = null;
  backgroundNextNode = null;
  if (lastRender === null) return null;
  // Only in the lobby: the image must not be swapped mid-question by accident.
  // A reconnect arrives as a `sync` snapshot, so that path is matched through the
  // derived screen — otherwise the carousel would vanish on a reload.
  const inLobby =
    lastRender.kind === 'lobby' ||
    (lastRender.kind === 'sync' && hostScreen(lastRender.state) === 'lobby');
  if (!inLobby) return null;

  const prev = button('‹', {
    variant: 'ghost',
    small: true,
    ariaLabel: `Previous background: ${backgroundNeighbour(backgroundChoice, -1).name}`,
    onClick: () => void chooseBackground(stepBackground(backgroundChoice, -1)),
  });
  const next = button('›', {
    variant: 'ghost',
    small: true,
    ariaLabel: `Next background: ${backgroundNeighbour(backgroundChoice, 1).name}`,
    onClick: () => void chooseBackground(stepBackground(backgroundChoice, 1)),
  });

  const position = el('span', { class: 'show__background-position' });
  backgroundPositionNode = position;
  backgroundPrevNode = prev;
  backgroundNextNode = next;
  paintCarousel();

  return el(
    'div',
    { class: 'show__background' },
    el(
      'div',
      { class: 'show__background-carousel', role: 'group', 'aria-label': 'Background' },
      prev,
      position,
      next,
    ),
  );
}

/**
 * Repaint the carousel's position line and arrow labels from `backgroundChoice`.
 *
 * Called on every paint path (first build, broadcast, ACK, snapshot), so the
 * arrows always describe the stop they would move to next. Kept separate from
 * `backgroundPicker` so a live change does not rebuild the buttons and steal
 * focus from the host's keyboard.
 */
function paintCarousel(): void {
  const selection = backgroundSelection(backgroundChoice);
  if (backgroundPositionNode) {
    backgroundPositionNode.replaceChildren(
      el('span', { class: 'show__background-name' }, selection.name),
      el('span', { class: 'show__background-index' }, `${selection.position} / ${selection.total}`),
    );
  }
  if (backgroundPrevNode) {
    backgroundPrevNode.setAttribute(
      'aria-label',
      `Previous background: ${backgroundNeighbour(backgroundChoice, -1).name}`,
    );
  }
  if (backgroundNextNode) {
    backgroundNextNode.setAttribute(
      'aria-label',
      `Next background: ${backgroundNeighbour(backgroundChoice, 1).name}`,
    );
  }
}

/** Ask the server to change the round's background; the broadcast repaints. */
async function chooseBackground(choice: string): Promise<void> {
  if (!canAct(connection)) {
    toast('Reconnect before you continue.', 'error');
    return;
  }
  const gameId = currentGameId();
  if (!gameId) return;
  try {
    // The ACK carries the stored position as well as the resolved image, so the
    // carousel labels the round with what the server chose — picking Random
    // leaves the label on Random even though the image is a concrete id.
    const ack = await request<{ background: string; choice: string }>(
      ensureSocket(),
      'host:background',
      { gameId, background: choice },
    );
    setBackground(ack.background, ack.choice);
  } catch (error) {
    toast(errorText(error), 'error');
  }
}

/**
 * Apply the server's background values to the layer and the carousel.
 *
 * `background` is the concrete image every screen paints; `choice` is the
 * carousel position behind it (a catalogue id or `random`). Called from the
 * `host:background` broadcast and from the ACK, so both paths end in the same
 * paint and a repaint can never disagree with the server.
 */
function setBackground(background: string, choice: string): void {
  backgroundChoice = choice;
  applyRoundBackground(background);
  paintCarousel();
}

/** Ask the server to flip the AUTO mode; the `host:auto` broadcast repaints. */
async function toggleAuto(): Promise<void> {
  if (!canAct(connection)) {
    toast('Reconnect before you continue.', 'error');
    return;
  }
  const gameId = currentGameId();
  if (!gameId) return;
  try {
    const { auto } = await request<{ auto: boolean }>(ensureSocket(), 'host:auto', {
      gameId,
      auto: !autoMode,
    });
    setAuto(auto);
  } catch (error) {
    toast(errorText(error), 'error');
  }
}

/**
 * Reflect the server's AUTO mode in the toggle without re-fetching. Called from
 * the `host:auto` broadcast and from the ACK of our own change, so a second host
 * tab and this one stay in step. Only the label and the pressed state change;
 * nothing about the game moves.
 */
function setAuto(auto: boolean): void {
  autoMode = auto;
  if (!autoNode) return;
  autoNode.textContent = autoLabel(auto);
  autoNode.setAttribute('aria-pressed', String(auto));
  autoNode.setAttribute('aria-label', autoHint(auto));
  autoNode.className = `btn ${auto ? 'btn-secondary' : 'btn-ghost'} btn-sm`;
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

/**
 * Read the roster of one open game from its report.
 *
 * The dashboard shows the lobby players before a game is under host control, so
 * it cannot use the socket snapshot (that needs `host:join`, which would put the
 * host *into* the game and leave the dashboard). The report endpoint carries the
 * same seat data and is already staff-guarded, so it is the honest source: it
 * returns the real players or an empty list, never a sample.
 */
async function loadRoster(gameId: string): Promise<DashboardPlayer[]> {
  try {
    const report = await get<{ players: { playerId: string; nickname: string }[] }>(
      `/api/reports/games/${gameId}`,
    );
    return (report.players ?? []).map((player) => ({
      id: player.playerId,
      nickname: player.nickname,
      // The report carries no avatar, so the seat is drawn from its initial. The
      // dashboard must not guess a character the server did not send.
      avatar: '',
    }));
  } catch {
    // A roster is an optional extra on the dashboard: a failed read must not take
    // the whole start surface down, so the column simply stays empty.
    return [];
  }
}

/** The home screen: choose a quiz, resume a game, or read the reports. */
async function showHome(): Promise<void> {
  stopTimer();
  answerCountNode = null;
  // Leaving the show cancels the finale too: the canvas is dropped and the
  // effects are silenced before the quiz picker is drawn (Phase 6.11.2).
  finale.stop();
  bannerNode = null;
  // No game under control: the show resets to its client-side welcome scene, the
  // AUTO mirror is cleared (the server owns it per game), and the last render is
  // forgotten so the toggle cannot re-draw a finished game.
  lastRender = null;
  autoMode = false;
  autoNode = null;
  // Leaving the show drops the round background too, so an image from a previous
  // game cannot linger behind the quiz picker (Phase 6.10).
  backgroundChoice = RANDOM_BACKGROUND;
  backgroundPositionNode = null;
  backgroundPrevNode = null;
  backgroundNextNode = null;
  clearRoundBackground();
  // No game under control: the show music stops and rewinds (Phase 6.11).
  music.sync(null);
  musicNode = null;
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

    // The dashboard keeps the host's quiz choice across repaints and reloads of
    // this screen. It falls back to the newest quiz, so the start button is
    // usable without a first click, but nothing is started implicitly.
    if (!quizzes.some((quiz) => quiz.id === dashboardQuizId)) {
      dashboardQuizId = quizzes[0]?.id ?? null;
    }

    // The roster belongs to an open game. Only the newest one is read, so the
    // dashboard costs one extra request and never fans out over every game.
    const rosterGame = open[0] ?? null;
    const roster: DashboardPlayer[] = rosterGame ? await loadRoster(rosterGame.id) : [];

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
          hostDashboard(
            {
              quizzes: quizzes.map((quiz) => ({
                id: quiz.id,
                title: quiz.title,
                questionCount: quiz.questionCount,
                category: quiz.category ?? null,
              })),
              selectedQuizId: dashboardQuizId,
              openGames: open.map((game) => ({
                id: game.id,
                pin: game.pin,
                quizTitle: game.quiz?.title ?? 'Deleted quiz',
                playerCount: game._count.players,
                phase: game.phase,
              })),
              roster,
              rosterGame: rosterGame
                ? {
                    id: rosterGame.id,
                    pin: rosterGame.pin,
                    quizTitle: rosterGame.quiz?.title ?? 'Deleted quiz',
                    playerCount: rosterGame._count.players,
                    phase: rosterGame.phase,
                  }
                : null,
            },
            {
              onSelectQuiz: (quizId) => {
                dashboardQuizId = quizId;
                void showHome();
              },
              onStart: () => {
                if (dashboardQuizId) void start(dashboardQuizId);
              },
              onResume: (gameId) => void resumeGame(gameId),
            },
          ),
          // Finished games stay reachable from the dashboard; the reports are the
          // only place a host can read a past round, so they are not dropped.
          ...(finished.length
            ? [
                el(
                  'section',
                  { class: 'wrap' },
                  el('h2', { class: 'section-title' }, 'Finished games'),
                  el(
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
              ]
            : []),
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
function controlsFor(
  phase: GamePhase,
  isPaused = false,
  type?: QuestionType,
  hasNext = true,
): HTMLElement {
  const nodes = hostActions(phase, isPaused, type, hasNext).map((action) => {
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
      return hostButton(action.label, 'host:end', {
        variant: action.variant,
        confirm: {
          title: 'End the game now?',
          body: 'The current question ends immediately and the final results are shown. This cannot be undone.',
          confirmLabel: 'End game',
        },
      });
    }
    if (action.id === 'skip') {
      return hostButton(action.label, 'host:skip', {
        variant: action.variant,
        confirm: {
          title: 'Skip this question?',
          body: 'The question ends and is shown without its solution. It is not scored; answers already given stay on record.',
          confirmLabel: 'Skip question',
        },
      });
    }
    return hostButton(action.label, `host:${action.id}`, { variant: action.variant });
  });
  return el('div', { class: 'show__controls' }, ...nodes);
}

/**
 * A control button, tagged so `setConnection` can disable every host action at
 * once while the socket is down. When `confirm` is given the command is sent
 * **only** after the dialog is accepted: the button's own click action is the
 * confirmation, never an extra listener on top of a direct send.
 */
function hostButton(
  label: string,
  action: string,
  options: {
    variant?: 'primary' | 'danger';
    confirm?: { title: string; body: string; confirmLabel: string };
  } = {},
): HTMLButtonElement {
  const node = button(label, {
    variant: options.variant,
    onClick: options.confirm
      ? () =>
          confirmDialog({
            title: options.confirm!.title,
            body: options.confirm!.body,
            confirmLabel: options.confirm!.confirmLabel,
            onConfirm: () => void send(action),
          })
      : () => void send(action),
  });
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
    // The join view (Phase 6.14): the QR code sits in the same block as the PIN
    // and the address, so a phone can be pointed at the screen and the PIN read
    // off the same card. `renderJoinQr` composes the URL from the current origin
    // and this game's PIN, so the code always opens *this* lobby.
    const qrHost = el('div', { class: 'lobby__qr' });
    renderJoinQr(qrHost, pin);
    body = el(
      'div',
      { class: 'lobby__join' },
      el('p', { class: 'muted' }, 'Join at this address with the PIN'),
      el('p', { class: 'lobby__pin' }, pin),
      el('p', { class: 'lobby__actions' }, chip(location.origin + '/', 'cyan')),
      qrHost,
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
        { class: `card lobby anim-fade-in${wide ? ' lobby--wide' : ''}` },
        connectionBanner(),
        body,
        backgroundPicker(),
        autoToggle(),
        musicControl(),
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
        { class: `show__board card anim-fade-in` },
        connectionBanner(),
        el('h2', { class: 'show__title' }, 'Get ready!'),
        el('p', { class: 'show__meta muted' }, 'The first question starts in'),
        timer,
        autoToggle(),
        musicControl(),
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
  if (answers) count.textContent = `${answers.answered} / ${answers.total} answers`;
  else if (lobbyPlayerCount) count.textContent = `0 / ${lobbyPlayerCount} answers`;

  const options = questionDisplayOptions(question);
  const scene = show.current;
  const showOptions = options.length > 0 && scene !== 'countdown';
  const showTimer = scene !== 'answers';

  // Build the 3-column live dashboard layout
  // Left: Navigation sidebar
  const navItems = [
    { id: 'overview', label: 'Übersicht', icon: '📊' },
    { id: 'control', label: 'Spiel steuern', icon: '🎮' },
    { id: 'quiz', label: 'Quiz & Fragen', icon: '❓' },
    { id: 'backgrounds', label: 'Hintergründe', icon: '🖼️' },
    { id: 'players', label: 'Spieler & Lobby', icon: '👥' },
    { id: 'inventory', label: 'Inventar & Avatare', icon: '🎒' },
    { id: 'reports', label: 'Auswertung', icon: '📈' },
    { id: 'end', label: 'Beenden', icon: '🏁' },
  ].map((item) =>
    el(
      'button',
      {
        class: `host-live__nav-item${show.current === item.id ? ' host-live__nav-item--active' : ''}`,
        onClick: () => show.step(item.id),
      },
      el('span', { class: 'host-live__nav-icon' }, item.icon),
      el('span', { class: 'host-live__nav-label' }, item.label),
    ),
  );

  const leftNav = el('nav', { class: 'host-live__nav' }, ...navItems);

  // Center: Status cards + Question card
  const playerCount = lobbyPlayerCount ?? 0;
  const quizTitle = activeGame ? '' : '';
  
  const statusCards = el('div', { class: 'host-live__stats' },
    el('div', { class: 'host-live__stat' },
      el('div', { class: 'host-live__stat-caption' }, 'Spieler in der Lobby'),
      el('div', { class: 'host-live__stat-value' }, `${playerCount} / ∞`),
      el('div', { class: 'host-live__stat-hint muted' }, 'Kapazität unbegrenzt'),
    ),
    el('div', { class: 'host-live__stat' },
      el('div', { class: 'host-live__stat-caption' }, 'Aktuelles Quiz'),
      el('div', { class: 'host-live__stat-value' }, question.text.substring(0, 30) + '...'),
      el('div', { class: 'host-live__stat-hint muted' }, 'Quiz aktiv'),
    ),
    el('div', { class: 'host-live__stat' },
      el('div', { class: 'host-live__stat-caption' }, 'Fortschritt'),
      el('div', { class: 'host-live__stat-value' }, `Frage ${question.index + 1} / ${question.total}`),
      el('div', { class: 'host-live__stat-hint muted' }, `${Math.round(((question.index + 1) / question.total) * 100)} %`),
    ),
  );

  const questionCard = el('div', { class: 'host-live__question' },
    el('h3', { class: 'host-live__question-title' }, 'AKTUELLE FRAGE'),
    el('div', { class: 'host-live__divider' }),
    el('h2', { class: 'question__prompt' }, question.text),
    question.paused ? el('p', { class: 'show__paused' }, chip('Paused', 'warn', true)) : null,
    showTimer ? timer : null,
    count,
    showOptions
      ? el('div', { class: 'host-live__options' },
          ...options.map((label, index) =>
            el('div', { class: 'host-live__option' },
              el('span', { class: 'option__key' }, optionLetter(index)),
              el('span', { class: 'show__option-label' }, label),
            ),
          ),
        )
      : null,
  );

  const centerColumn = el('div', { class: 'host-live__main' }, statusCards, questionCard);

  // Right: Sidebar with players and game phases
  const playerItems = (answers?.total ? Array.from({ length: answers.total }, (_, i) => i) : [])
    .map((i) =>
      el('li', { class: 'host-live__player' },
        el('span', { class: 'host-live__player-dot', style: 'background: var(--ok)' }),
        el('span', { class: 'host-live__player-name' }, `Player ${i + 1}`),
      ),
    );

  const phases = [
    { id: 'question', label: 'Frage läuft', num: '1' },
    { id: 'collect', label: 'Antworten sammeln', num: '2' },
    { id: 'reveal', label: 'Auflösung', num: '3' },
    { id: 'next', label: 'Nächste Frage', num: '4' },
  ].map((phase) =>
    el('li',
      { class: `host-live__phase${show.current === phase.id ? ' host-live__phase--active' : ''}` },
      el('span', { class: 'host-live__phase-num' }, phase.num),
      el('span', phase.label),
    ),
  );

  const rightSidebar = el('aside', { class: 'host-live__side' },
    el('div', { class: 'host-live__side-block' },
      el('h4', { class: 'host-live__side-title' }, 'Lobby – Spieler'),
      el('ul', { class: 'host-live__players' }, ...playerItems),
    ),
    el('div', { class: 'host-live__side-block' },
      el('h4', { class: 'host-live__side-title' }, 'Spielablauf'),
      el('ul', { class: 'host-live__phases' }, ...phases),
    ),
  );

  // Bottom control bar
  const timerFill = el('div', { class: 'host-live__timer-fill' });
  const timerLabel = el('span', { class: 'host-live__timer-label' }, '0s');
  const timerWrap = el('div', { class: 'host-live__timer-wrap' },
    el('div', { class: 'host-live__timer-bar' }, timerFill),
    timerLabel,
  );

  const controlButtons = controlsFor('question', question.paused, question.type);
  const autoBtn = autoToggle();
  const musicBtn = musicControl();

  const bottomBar = el('div', { class: 'host-live__controls' },
    timerWrap,
    ...Array.from(controlButtons.children),
    autoBtn,
    musicBtn,
  );

  // Render the full 3-column layout
  render(
    app,
    el(
      'section',
      { class: 'host-live' },
      leftNav,
      centerColumn,
      rightSidebar,
      bottomBar,
    ),
  );

  if (question.paused) {
    const remaining = Math.ceil((question.remainingMs ?? 0) / 1000);
    const value = timer.querySelector<HTMLElement>('.countdown__value');
    const limit = question.timeLimit * 1000;
    if (value) value.textContent = `${remaining}s`;
    timer.style.setProperty('--progress', String(limit > 0 ? (question.remainingMs ?? 0) / limit : 0));
    // Update timer bar
    const progress = limit > 0 ? (question.remainingMs ?? 0) / limit : 0;
    timerFill.style.width = `${progress * 100}%`;
    timerLabel.textContent = `${remaining}s`;
  } else {
    startTimer(timer, question.openedAt, question.timeLimit);
    // Update timer bar every tick
    const updateTimerBar = () => {
      const now = clock ? clock.serverNow() : Date.now();
      const elapsed = Math.floor((now - question.openedAt) / 1000);
      const left = Math.max(0, question.timeLimit - elapsed);
      const progress = question.timeLimit > 0 ? left / question.timeLimit : 0;
      timerFill.style.width = `${progress * 100}%`;
      timerLabel.textContent = `${left}s`;
    };
    // Wrap the original tick to also update the bar
    const originalTick = timerHandle;
    // We'll let the existing timer handle it
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
        { class: `show__board card question anim-fade-in` },
        connectionBanner(),
        heading ? el('h2', { class: 'show__title' }, heading) : null,
        body,
        autoToggle(),
        musicControl(),
        controlsFor('reveal'),
      ),
    ),
  );
  setConnection(connection);
}

/** The leaderboard screen. */
function showBoard(players: PublicPlayer[], hasNext = true): void {
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
        { class: `show__board card anim-fade-in` },
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
        autoToggle(),
        musicControl(),
        controlsFor('board', false, undefined, hasNext),
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

  // The finale is keyed on the game, so stepping podium → outro, a repaint or a
  // reconnect of the same game never replays it (Phase 6.11.2). A game without an
  // id (should not happen) falls back to a stable key, not a random one.
  finale.start(activeGame?.id ?? `end:${players.length}`);

  render(
    app,
    el(
      'section',
      { class: 'centered show' },
      el(
        'div',
        { class: `show__board card anim-pop` },
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
        autoToggle(),
        musicControl(),
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
//
// The animated field starts before the first paint so the login screen is never
// a flat dark panel. The host drives a projector, so it gets the richer field.
startStarfield('host');

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
