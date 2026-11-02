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
  questionDisplay,
  type PublicPlayer,
  type PublicQuestion,
  type Question,
} from '@zeropeek/shared';

import { get, post, setCsrfToken, ApiError } from '../api.js';
import { el, render } from '../dom.js';
import { connectHost, request, type HostSocket } from '../socket.js';
import { questionResult, solutionText } from '../questionView.js';
import { brand, button, errorText, field, notice, pageHeader, toast } from '../ui.js';

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
  quiz: { id: string; title: string };
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
/** The node showing the running answer count, while a question is open. */
let answerCountNode: HTMLElement | null = null;

/** Stop the countdown timer, if running. */
function stopTimer(): void {
  if (timerHandle !== null) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

/** Render a countdown into `node` for a question opened at `openedAt`. */
function startTimer(node: HTMLElement, openedAt: number, seconds: number): void {
  stopTimer();
  const tick = (): void => {
    const elapsed = Math.floor((Date.now() - openedAt) / 1000);
    const left = Math.max(0, seconds - elapsed);
    node.textContent = `${left}s`;
    if (left === 0) stopTimer();
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
      submit.disabled = true;
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
        submit.disabled = false;
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

/** Ensure the host socket is connected and its shared handlers are attached. */
function ensureSocket(): HostSocket {
  if (!socket) {
    socket = connectHost();
    // One persistent handler for the running answer count; it updates whatever
    // node the current question screen installed.
    socket.on('host:answers', (payload) => {
      if (answerCountNode) {
        answerCountNode.textContent = `${payload.answered} / ${payload.total} answers`;
      }
    });
  }
  return socket;
}

/** The home screen: choose a quiz, resume a game, or read the reports. */
async function showHome(): Promise<void> {
  stopTimer();
  answerCountNode = null;
  try {
    const [{ quizzes }, { games }] = await Promise.all([
      get<{ quizzes: QuizSummary[] }>('/api/quizzes'),
      get<{ games: GameRow[] }>('/api/reports/games'),
    ]);

    const start = async (quizId: string): Promise<void> => {
      try {
        const created = await request<HostGame>(ensureSocket(), 'host:create', { quizId });
        showLobby(created);
      } catch (error) {
        toast(errorText(error), 'error');
      }
    };

    const resume = async (gameId: string): Promise<void> => {
      try {
        const state = await request<{ pin: string }>(ensureSocket(), 'host:join', { gameId });
        showLobby({ id: gameId, pin: state.pin });
      } catch (error) {
        toast(errorText(error), 'error');
      }
    };

    const open = games.filter((game) => game.phase !== 'end');
    const finished = games.filter((game) => game.phase === 'end');

    render(
      app,
      el(
        'section',
        { class: 'wrap' },
        pageHeader(`Welcome, ${me?.username ?? 'host'}`, [
          button('Editor', { onClick: () => (location.href = './editor.html') }),
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
        ]),
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
                      el('h2', { class: 'quiz-list__title' }, `${game.quiz.title} · ${game.pin}`),
                      el(
                        'p',
                        { class: 'muted' },
                        `${game._count.players} player(s) · ${game.phase}`,
                      ),
                    ),
                    el(
                      'div',
                      { class: 'quiz-list__actions' },
                      button('Resume', { variant: 'primary', onClick: () => void resume(game.id) }),
                    ),
                  ),
                ),
              ),
            )
          : null,
        el('h2', { class: 'section-title' }, 'Start a game'),
        quizzes.length === 0
          ? el('p', { class: 'muted' }, 'Create a quiz in the editor first.')
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
          ? el('p', { class: 'muted' }, 'No finished games yet.')
          : el(
              'ul',
              { class: 'report-list' },
              ...finished.map((game) =>
                el(
                  'li',
                  { class: 'report-list__item card' },
                  el('h3', null, game.quiz.title),
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
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      showLogin();
      return;
    }
    toast(errorText(error), 'error');
  }
}

/** The lobby screen with the join PIN and the growing player list. */
function showLobby(game: HostGame): void {
  const players = el('ul', { class: 'lobby__players' });
  const paint = (list: PublicPlayer[]): void => {
    players.replaceChildren(
      ...list.map((player) =>
        el('li', { class: 'lobby__player' }, el('span', null, player.nickname)),
      ),
    );
  };

  render(
    app,
    el(
      'section',
      { class: 'centered' },
      el(
        'div',
        { class: 'card lobby' },
        el('p', { class: 'muted' }, 'Join at this address with the PIN'),
        el('p', { class: 'lobby__pin' }, game.pin),
        el('p', { class: 'muted' }, `${location.origin}/`),
        players,
        el(
          'div',
          { class: 'lobby__actions' },
          button('Start game', {
            variant: 'primary',
            onClick: async () => {
              try {
                await request(ensureSocket(), 'host:start', { gameId: game.id });
              } catch (error) {
                toast(errorText(error), 'error');
              }
            },
          }),
        ),
      ),
    ),
  );

  const host = ensureSocket();
  host.on('host:lobby', (payload) => paint(payload.players));
  host.on('host:question', (question) => showQuestion(game, question));
  host.on('host:reveal', (payload) => showReveal(game, payload.question, payload.distribution));
  host.on('host:board', (payload) => showBoard(game, payload.players));
  host.on('host:ended', (payload) => showPodium(game, payload.players));
}

/** The beamer question screen with a live timer and a running answer count. */
function showQuestion(game: HostGame, question: PublicQuestion): void {
  const timer = el('strong', { class: 'question__timer' });
  const count = el('p', { class: 'muted' }, '0 answers');

  render(
    app,
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
        el('h2', { class: 'question__prompt' }, question.text),
        timer,
        count,
        el(
          'div',
          { class: 'lobby__actions' },
          button('Reveal', {
            variant: 'primary',
            onClick: async () => {
              try {
                await request(ensureSocket(), 'host:reveal', { gameId: game.id });
              } catch (error) {
                toast(errorText(error), 'error');
              }
            },
          }),
        ),
      ),
    ),
  );

  startTimer(timer, question.openedAt, question.timeLimit);
}

/** The reveal screen: the distribution of answers. */
function showReveal(
  game: HostGame,
  question: Question,
  distribution: Record<string, number>,
): void {
  stopTimer();
  render(
    app,
    el(
      'section',
      { class: 'centered' },
      el(
        'div',
        { class: 'card question' },
        questionResult(
          { text: question.text, type: question.type, display: questionDisplay(question) },
          distribution,
          solutionText(question),
        ),
        el(
          'div',
          { class: 'lobby__actions' },
          button('Leaderboard', {
            variant: 'primary',
            onClick: async () => {
              try {
                await request(ensureSocket(), 'host:board', { gameId: game.id });
              } catch (error) {
                toast(errorText(error), 'error');
              }
            },
          }),
        ),
      ),
    ),
  );
}

/** The leaderboard screen. */
function showBoard(game: HostGame, players: PublicPlayer[]): void {
  stopTimer();
  render(
    app,
    el(
      'section',
      { class: 'centered' },
      el(
        'div',
        { class: 'card' },
        el('h2', null, 'Leaderboard'),
        el(
          'ol',
          { class: 'leaderboard' },
          ...players.map((player, index) =>
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
          { class: 'lobby__actions' },
          button('Next question', {
            variant: 'primary',
            onClick: async () => {
              try {
                await request(ensureSocket(), 'host:next', { gameId: game.id });
              } catch (error) {
                toast(errorText(error), 'error');
              }
            },
          }),
          button('End game', {
            variant: 'danger',
            onClick: async () => {
              try {
                await request(ensureSocket(), 'host:end', { gameId: game.id });
              } catch (error) {
                toast(errorText(error), 'error');
              }
            },
          }),
        ),
      ),
    ),
  );
}

/** The final podium. */
function showPodium(game: HostGame, players: PublicPlayer[]): void {
  stopTimer();
  render(
    app,
    el(
      'section',
      { class: 'centered' },
      el(
        'div',
        { class: 'card' },
        el('h2', null, 'Final results'),
        el(
          'ol',
          { class: 'leaderboard' },
          ...players.map((player, index) =>
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
          { class: 'lobby__actions' },
          button('Back to home', { variant: 'primary', onClick: () => void showHome() }),
        ),
      ),
    ),
  );
  void game;
}

/** A full report for one finished game. */
async function showReport(id: string): Promise<void> {
  try {
    const report = await get<{
      quizTitle: string;
      players: Array<{ nickname: string; score: number; rank: number }>;
      questions: Array<{ text: string; answered: number; correct: number }>;
    }>(`/api/reports/${id}`);
    render(
      app,
      el(
        'section',
        { class: 'wrap' },
        pageHeader(report.quizTitle, [button('Back', { onClick: () => void showHome() })]),
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
                el('td', null, question.text),
                el('td', null, String(question.answered)),
                el('td', null, String(question.correct)),
              ),
            ),
          ),
        ),
      ),
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
