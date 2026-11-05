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
import { leaderboardRow, podiumPlace, questionDisplayOptions } from '../showView.js';
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
  pageHeader,
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
/** Players seen in the lobby, used to seed the answer count before the first answer. */
let lobbyPlayerCount = 0;

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
 * time. The timing itself is unchanged from before.
 */
function startTimer(node: HTMLElement, openedAt: number, seconds: number): void {
  stopTimer();
  const value = node.querySelector<HTMLElement>('.countdown__value');
  const tick = (): void => {
    const elapsed = Math.floor((Date.now() - openedAt) / 1000);
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
        // The server ACKs with { gameId, pin }; HostGame uses `id`.
        const created = await request<{ gameId: string; pin: string }>(
          ensureSocket(),
          'host:create',
          { quizId },
        );
        showLobby({ id: created.gameId, pin: created.pin });
      } catch (error) {
        toast(errorText(error), 'error');
      }
    };

    const resume = async (gameId: string): Promise<void> => {
      try {
        const state = await request<{ pin: string; players: PublicPlayer[] }>(
          ensureSocket(),
          'host:join',
          { gameId },
        );
        showLobby({ id: gameId, pin: state.pin }, state.players ?? []);
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
function showLobby(game: HostGame, initialPlayers: PublicPlayer[] = []): void {
  const players = el('ul', { class: 'lobby__players' });
  const paint = (list: PublicPlayer[]): void => {
    lobbyPlayerCount = list.length;
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
        { class: 'card lobby anim-fade-in' },
        el('p', { class: 'muted' }, 'Join at this address with the PIN'),
        el('p', { class: 'lobby__pin' }, game.pin),
        el('p', { class: 'lobby__actions' }, chip(location.origin + '/', 'cyan')),
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
  paint(initialPlayers);
  host.on('host:lobby', (payload) => paint(payload.players));
  host.on('host:question', (question) => showQuestion(game, question));
  host.on('host:reveal', (payload) => showReveal(game, payload.question, payload.distribution));
  host.on('host:board', (payload) => showBoard(game, payload.players));
  host.on('host:ended', (payload) => showPodium(game, payload.players));
}

/** The beamer question screen with a live timer and a running answer count. */
function showQuestion(game: HostGame, question: PublicQuestion): void {
  const timer = countdown(question.timeLimit, 1);
  const count = el('p', { class: 'show__answers muted' }, '0 answers');
  answerCountNode = count;
  // The server only emits `host:answers` on the first answer, so seed the total
  // from the lobby size to keep the wording stable before anyone answers.
  if (lobbyPlayerCount) count.textContent = `0 / ${lobbyPlayerCount} answers`;

  const options = questionDisplayOptions(question);

  render(
    app,
    el(
      'section',
      { class: 'centered show' },
      el(
        'div',
        { class: 'show__board card question anim-fade-in' },
        el(
          'div',
          { class: 'question__meta muted' },
          `Question ${question.index + 1} of ${question.total}`,
        ),
        el('h2', { class: 'question__prompt' }, question.text),
        timer,
        count,
        options.length
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
        el(
          'div',
          { class: 'show__controls' },
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
  answerCountNode = null;
  render(
    app,
    el(
      'section',
      { class: 'centered show' },
      el(
        'div',
        { class: 'show__board card question anim-fade-in' },
        questionResult(
          { text: question.text, type: question.type, display: questionDisplay(question) },
          distribution,
          solutionText(question),
        ),
        el(
          'div',
          { class: 'show__controls' },
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
  answerCountNode = null;
  render(
    app,
    el(
      'section',
      { class: 'centered show' },
      el(
        'div',
        { class: 'show__board card anim-fade-in' },
        el('h2', { class: 'show__title' }, 'Leaderboard'),
        el('p', { class: 'show__meta' }, chip(`${players.length} player(s)`, 'cyan')),
        el('ol', { class: 'leaderboard leaderboard--show' }, ...players.map(leaderboardRow)),
        el(
          'div',
          { class: 'show__controls' },
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
            onClick: () => {
              confirmDialog({
                title: 'End the game now?',
                body: 'The current question ends immediately and the final results are shown. This cannot be undone.',
                confirmLabel: 'End game',
                onConfirm: () => {
                  void request(ensureSocket(), 'host:end', { gameId: game.id }).catch((error) =>
                    toast(errorText(error), 'error'),
                  );
                },
              });
            },
          }),
        ),
      ),
    ),
  );
}

/** The final results: a podium for the top three plus the full ranking. */
function showPodium(game: HostGame, players: PublicPlayer[]): void {
  stopTimer();
  answerCountNode = null;
  const [first, second, third, ...rest] = players;

  render(
    app,
    el(
      'section',
      { class: 'centered show' },
      el(
        'div',
        { class: 'show__board card anim-pop' },
        el('h2', { class: 'show__title' }, 'Final results'),
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
        el(
          'div',
          { class: 'show__controls' },
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
      quiz: { id: string; title: string; questionCount: number };
      players: Array<{ nickname: string; score: number; rank: number }>;
      questions: Array<{ text: string; answered: number; correct: number }>;
    }>(`/api/reports/games/${id}`);
    render(
      app,
      el(
        'section',
        { class: 'wrap' },
        pageHeader(report.quiz.title, [button('Back', { onClick: () => void showHome() })]),
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
