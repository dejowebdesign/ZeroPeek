/**
 * Player surface: join by PIN, answer, see your own result.
 *
 * The player never receives the solution or another player's answers – the
 * server sends each player only their own private result (see `socket.ts`).
 * The join credentials (game id, player id, token) are kept in `sessionStorage`
 * so a refresh reconnects to the same slot instead of joining twice.
 */

import type {
  HostPresence,
  OwnResult,
  PlayerAnswerState,
  PlayerSync,
  PublicPlayer,
  PublicQuestion,
} from '@zeropeek/shared';

import { el, render } from '../dom.js';
import { appShell } from '../navigation.js';
import { connectPlayer, request, type PlayerSocket } from '../socket.js';
import { questionInput, questionPrompt } from '../questionView.js';
import {
  hostStatusChip,
  lobbyRoster,
  profilePlaceholder,
  registerOffer,
  screenForSync,
} from '../playerView.js';
import { button, chip, errorText, field, notice, setBusy, spinner } from '../ui.js';

const STORAGE_KEY = 'zeropeek.player';

/** The host's reachability as last announced, or null before the first event. */
let hostStatus: HostPresence | null = null;
/** The open question and this player's prior answer, so pause/resume re-renders in place. */
let currentQuestion: PublicQuestion | null = null;
let currentPrior: PlayerAnswerState | null = null;
/** A closure that repaints the current screen, so a host-status change re-renders it. */
let repaint: (() => void) | null = null;

/** Repaint the current screen in place (used when only the host status changed). */
function rerenderCurrent(): void {
  repaint?.();
}

/** Wrap a centred screen in the player shell, marking the active nav entry. */
function shell(active: string, content: HTMLElement): HTMLElement {
  // Remember how to redraw this exact screen, so a host-status change can repaint
  // in place (the chip is part of the shell) without losing the current view.
  repaint = () => render(app, shell(active, content));
  // The host-status chip is prepended to every screen, so a host dropping out is
  // visible wherever the player is. It renders nothing while the host is fine.
  const host = hostStatusChip(hostStatus);
  return appShell({
    role: 'player',
    active,
    children: host ? [host, content] : [content],
  });
}

interface StoredSession {
  gameId: string;
  playerId: string;
  token: string;
  nickname: string;
}

function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function saveSession(session: StoredSession): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

const appElement = document.getElementById('app');
if (!appElement) throw new Error('ZeroPeek: the #app element is missing.');
const app: HTMLElement = appElement;

{
  const socket: PlayerSocket = connectPlayer();

  /** Show the join form. */
  function showJoin(message?: string): void {
    const pin = el('input', {
      class: 'input',
      inputmode: 'numeric',
      maxlength: '6',
      placeholder: '000000',
      autocomplete: 'off',
    });
    const nickname = el('input', {
      class: 'input',
      maxlength: '16',
      placeholder: 'Your name',
      autocomplete: 'off',
    });
    const feedback = el('div', { class: 'join__feedback' });
    const submit = button('Join', {
      variant: 'primary',
      onClick: async () => {
        feedback.replaceChildren();
        setBusy(submit, true);
        try {
          const result = await request<{ playerId: string; gameId: string; token: string }>(
            socket,
            'player:join',
            { pin: pin.value.trim().toUpperCase(), nickname: nickname.value.trim() },
          );
          saveSession({ ...result, nickname: nickname.value.trim() });
          showWaiting();
        } catch (error) {
          feedback.replaceChildren(notice(errorText(error), 'error'));
        } finally {
          setBusy(submit, false);
        }
      },
    });

    render(
      app,
      shell(
        'lobby',
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
            el('h1', { class: 'join__title' }, 'Join a game'),
            el('p', { class: 'muted' }, 'Enter the PIN shown on the big screen.'),
            field('Game PIN', pin),
            field('Your name', nickname),
            message ? notice(message, 'info') : null,
            feedback,
            el('div', { class: 'join__actions' }, submit),
          ),
        ),
      ),
    );
    pin.focus();
  }

  /** Show the waiting room until the host starts. */
  function showWaiting(players: PublicPlayer[] = []): void {
    const session = loadSession();
    render(
      app,
      shell(
        'lobby',
        el(
          'section',
          { class: 'centered' },
          el(
            'div',
            { class: 'card lobby anim-fade-in' },
            el('h1', { class: 'join__title' }, `You're in, ${session?.nickname ?? 'player'}!`),
            el('p', { class: 'muted' }, 'Look at the big screen. The game starts soon.'),
            el(
              'div',
              { class: 'lobby__status' },
              players.length
                ? chip(`${players.length} player(s) joined`, 'cyan')
                : spinner('Waiting for the host…'),
            ),
            players.length ? lobbyRoster(players, session?.playerId) : null,
          ),
        ),
      ),
    );
  }

  /** Show the clearly-marked profile placeholder (a real profile is Phase 6.6). */
  function showProfile(): void {
    render(
      app,
      shell(
        'profile',
        el('section', { class: 'centered' }, el('div', { class: 'card' }, profilePlaceholder())),
      ),
    );
  }

  /** Show an open question. `prior` carries a reconnect's existing answer. */
  function showQuestion(question: PublicQuestion, prior?: PlayerAnswerState | null): void {
    currentQuestion = question;
    currentPrior = prior ?? null;
    let submitted = prior?.answered === true;
    const feedback = el('div');
    if (submitted) feedback.replaceChildren(notice('Answer received.', 'success'));
    const input = questionInput(question, async (answer) => {
      if (submitted || question.paused) return;
      submitted = true;
      feedback.replaceChildren(spinner('Sending…'));
      try {
        await request(socket, 'player:answer', { questionId: question.id, answer });
        feedback.replaceChildren(notice('Answer received.', 'success'));
      } catch (error) {
        submitted = false;
        feedback.replaceChildren(notice(errorText(error), 'error'));
      }
    });
    if (prior?.answered || question.paused) {
      // Already answered (or the question is paused): the control stays visible
      // but inert, so a player cannot submit a second answer or answer a frozen
      // question.
      input.querySelectorAll('button, input, select, textarea').forEach((node) => {
        (node as HTMLButtonElement).disabled = true;
      });
    }

    render(
      app,
      shell(
        'questions',
        el(
          'section',
          { class: 'centered' },
          el(
            'div',
            { class: 'card question' },
            el(
              'div',
              { class: 'question__meta muted' },
              `Question ${question.index + 1} of ${question.total}`,
            ),
            questionPrompt(question),
            question.paused ? notice('The host paused the game.', 'info') : null,
            input,
            feedback,
          ),
        ),
      ),
    );
  }

  /** Show the player's own result for the revealed question. */
  function showResult(questionId: string, result: OwnResult): void {
    if (result.outcome === 'skipped') {
      render(
        app,
        shell(
          'questions',
          el(
            'section',
            { class: 'centered' },
            el(
              'div',
              { class: 'card anim-slide-up' },
              el('p', { class: 'notice notice--info' }, 'Question skipped'),
              el(
                'p',
                { class: 'lobby__actions' },
                chip('Not scored', 'muted', true),
                chip(`Score ${result.score}`, 'accent'),
              ),
            ),
          ),
        ),
      );
      return;
    }
    const tone =
      result.outcome === 'correct'
        ? 'notice--success'
        : result.outcome === 'wrong'
          ? 'notice--error'
          : 'notice--info';
    const headline =
      result.outcome === 'correct'
        ? `Correct! +${result.points}`
        : result.outcome === 'wrong'
          ? 'Wrong answer'
          : 'No answer';
    const outcomeChip =
      result.outcome === 'correct'
        ? chip('Correct', 'ok', true)
        : result.outcome === 'wrong'
          ? chip('Wrong', 'bad', true)
          : chip('No answer', 'muted', true);
    render(
      app,
      shell(
        'questions',
        el(
          'section',
          { class: 'centered' },
          el(
            'div',
            { class: 'card anim-slide-up' },
            el('p', { class: `notice ${tone}` }, headline),
            el(
              'p',
              { class: 'lobby__actions' },
              outcomeChip,
              chip(`Score ${result.score}`, 'accent'),
              chip(`Rank ${result.rank}`, 'cyan'),
            ),
            el(
              'p',
              { class: 'muted', style: { fontSize: '0.75rem' } },
              `Question ${questionId.slice(0, 8)}`,
            ),
          ),
        ),
      ),
    );
  }

  /** Show the leaderboard. */
  function showBoard(players: PublicPlayer[]): void {
    const session = loadSession();
    render(
      app,
      shell(
        'questions',
        el(
          'section',
          { class: 'centered' },
          el(
            'div',
            { class: 'card' },
            el('h1', { class: 'join__title' }, 'Leaderboard'),
            el(
              'ol',
              { class: 'leaderboard' },
              ...players.slice(0, 10).map((player, index) =>
                el(
                  'li',
                  {
                    class:
                      player.id === session?.playerId
                        ? 'leaderboard__row leaderboard__row--me'
                        : 'leaderboard__row',
                  },
                  el('span', { class: 'leaderboard__rank' }, String(index + 1)),
                  el('span', { class: 'leaderboard__name' }, player.nickname),
                  el('span', { class: 'leaderboard__score' }, String(player.score)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /** Show the final placement. */
  function showEnd(payload: { rank: number; score: number; podium: PublicPlayer[] }): void {
    render(
      app,
      shell(
        'lobby',
        el(
          'section',
          { class: 'centered' },
          el(
            'div',
            { class: 'card' },
            el('h1', { class: 'join__title' }, `You finished #${payload.rank}`),
            el('p', { class: 'muted' }, `Final score: ${payload.score}`),
            el(
              'ol',
              { class: 'leaderboard' },
              ...payload.podium.map((player, index) =>
                el(
                  'li',
                  { class: 'leaderboard__row' },
                  el('span', { class: 'leaderboard__rank' }, String(index + 1)),
                  el('span', { class: 'leaderboard__name' }, player.nickname),
                  el('span', { class: 'leaderboard__score' }, String(player.score)),
                ),
              ),
            ),
            el(
              'div',
              { class: 'join__actions' },
              button('Play again', {
                variant: 'primary',
                onClick: () => {
                  clearSession();
                  showJoin();
                },
              }),
            ),
            // Optional: an account keeps progress across games. A guest can
            // simply play again; this never blocks anything.
            registerOffer(),
          ),
        ),
      ),
    );
  }

  /**
   * Render the screen the server says the player is on. This is the single entry
   * point for a reconnect, so the client never decides the phase itself.
   */
  function renderSync(sync: PlayerSync): void {
    switch (screenForSync(sync)) {
      case 'question':
        if (sync.question) showQuestion(sync.question, sync.answer);
        else showWaiting(sync.board ?? []);
        break;
      case 'reveal':
        if (sync.question && sync.answer?.result) {
          showResult(sync.question.id, sync.answer.result);
        } else if (sync.question) {
          showQuestion(sync.question, sync.answer);
        } else {
          showWaiting(sync.board ?? []);
        }
        break;
      case 'board':
        showBoard(sync.board ?? []);
        break;
      case 'end':
        if (sync.placement) {
          showEnd({
            rank: sync.placement.rank,
            score: sync.placement.score,
            podium: sync.podium ?? [],
          });
        } else {
          showWaiting(sync.board ?? []);
        }
        break;
      default:
        showWaiting(sync.board ?? []);
    }
  }

  // ---------------------------------------------------------------------------
  // Server events.
  // ---------------------------------------------------------------------------
  socket.on('game:state', (payload) => {
    if (payload.phase === 'lobby') showWaiting(payload.players);
  });
  socket.on('game:question', (question) => showQuestion(question));
  socket.on('game:reveal', (payload) => showResult(payload.questionId, payload.result));
  socket.on('game:board', (payload) => showBoard(payload.players));
  socket.on('game:ended', (payload) => showEnd(payload));

  // The host's reachability: update the banner state and re-render the current
  // screen so the chip appears or disappears without a full navigation.
  socket.on('game:host', (payload) => {
    hostStatus = payload.status;
    rerenderCurrent();
  });

  // Pause/resume only change the clock and the controls, so the open question is
  // re-rendered from the state already held.
  socket.on('game:paused', (payload) => {
    if (currentQuestion && currentQuestion.id === payload.questionId) {
      currentQuestion = { ...currentQuestion, paused: true, remainingMs: payload.remainingMs };
      showQuestion(currentQuestion, currentPrior);
    }
  });
  socket.on('game:resumed', (payload) => {
    if (currentQuestion && currentQuestion.id === payload.questionId) {
      // The player screen shows no clock of its own, so resuming only has to
      // unfreeze the answer control.
      currentQuestion = { ...currentQuestion, paused: false, remainingMs: null };
      showQuestion(currentQuestion, currentPrior);
    }
  });

  // The host removed this player. Clear the stored session so a reload does not
  // try to reclaim a slot that no longer exists, and return to the join form.
  socket.on('game:kicked', () => {
    clearSession();
    hostStatus = null;
    showJoin('You were removed from the game by the host.');
  });

  // ---------------------------------------------------------------------------
  // Boot: the profile placeholder is reachable by URL, otherwise reconnect if a
  // session is stored, otherwise show the join form.
  // ---------------------------------------------------------------------------
  const onProfile = (): boolean => location.hash === '#profile';

  window.addEventListener('hashchange', () => {
    if (onProfile()) showProfile();
    else if (loadSession()) showWaiting();
    else showJoin();
  });

  if (onProfile()) {
    showProfile();
  } else {
    const stored = loadSession();
    if (stored) {
      render(app, shell('lobby', el('section', { class: 'centered' }, spinner('Reconnecting…'))));
      request<PlayerSync>(socket, 'player:rejoin', {
        gameId: stored.gameId,
        playerId: stored.playerId,
        token: stored.token,
      })
        .then((sync) => renderSync(sync))
        .catch(() => {
          clearSession();
          showJoin('Your previous game has ended. Join again.');
        });
    } else {
      showJoin();
    }
  }
}
