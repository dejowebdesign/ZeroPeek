/**
 * Host dashboard (Phase 6.14, Option B): the pre-game surface.
 *
 * This is the screen the host sees **before** a game runs: pick a quiz, read the
 * preparation state, resume an open game. It is deliberately *not* a second
 * projection surface — once a game starts, the existing host view is the only
 * beamer and control surface (Phase 6.9.3, see
 * `docs/reports/phase-6-9-3-host-auto-control.md`). Nothing here adds a
 * presentation mode, a scene bar or a fullscreen switch.
 *
 * Every value rendered here comes from the server: the quiz list from
 * `/api/quizzes`, the open games from `/api/reports/games`, the roster from the
 * game's report. There are no sample players, no invented capacity and no
 * placeholder status: a figure the server does not provide is shown as "—".
 *
 * The module is a pure builder (data in, DOM out) so the layout and its empty
 * states are testable without the socket.
 */

import { el } from './dom.js';
import { playerAvatar } from './avatar.js';
import { button, chip, emptyState } from './ui.js';
import { freeLobbySeats, lobbyCapacityState, MAX_PLAYERS_PER_LOBBY } from '@zeropeek/shared';

/** A quiz as the dashboard needs it. Mirrors `QuizSummary` on the host page. */
export interface DashboardQuiz {
  id: string;
  title: string;
  questionCount: number;
  category?: string | null;
}

/** An open (not yet ended) game, as listed by `/api/reports/games`. */
export interface DashboardGame {
  id: string;
  pin: string;
  quizTitle: string;
  playerCount: number;
  phase: string;
}

/** One player in the lobby column. */
export interface DashboardPlayer {
  id: string;
  nickname: string;
  avatar: string;
}

/** Everything the dashboard draws, all of it server-provided. */
export interface DashboardData {
  quizzes: DashboardQuiz[];
  /** The quiz the start button would launch, or null when none is chosen. */
  selectedQuizId: string | null;
  openGames: DashboardGame[];
  /** The roster of `rosterGame`, or an empty list. */
  roster: DashboardPlayer[];
  /** The open game the roster belongs to, or null when no game is open. */
  rosterGame: DashboardGame | null;
}

/** The user actions the dashboard can raise. */
export interface DashboardHandlers {
  onSelectQuiz: (quizId: string) => void;
  onStart: () => void;
  onResume: (gameId: string) => void;
}

/** A small caption/value pair used by the status cards and the status column. */
function statRow(label: string, value: string): HTMLElement {
  return el(
    'div',
    { class: 'dash-row' },
    el('span', { class: 'dash-row__label' }, label),
    el('span', { class: 'dash-row__value' }, value),
  );
}

/**
 * The lobby capacity card: `seated / MAX`, the free places and a fill bar.
 *
 * The limit comes from the shared constant, so the number the host reads is the
 * number the server enforces. The state (`normal`, `high`, `full`) is decided by
 * the shared helper rather than by a threshold repeated here.
 */
function capacityCard(seated: number): HTMLElement {
  const state = lobbyCapacityState(seated);
  const free = freeLobbySeats(seated);
  const caption = state === 'full' ? 'Lobby full' : `${free} place${free === 1 ? '' : 's'} free`;
  const percent = Math.min(100, Math.round((seated / MAX_PLAYERS_PER_LOBBY) * 100));

  return el(
    'div',
    { class: `dash-stat dash-stat--${state}`, 'data-capacity': state },
    el('span', { class: 'dash-stat__caption' }, 'Players in lobby'),
    el('span', { class: 'dash-stat__value' }, `${seated} / ${MAX_PLAYERS_PER_LOBBY}`),
    el('span', { class: 'dash-stat__hint' }, caption),
    el(
      'div',
      {
        class: 'dash-meter',
        role: 'progressbar',
        'aria-label': 'Lobby capacity',
        'aria-valuemin': '0',
        'aria-valuemax': String(MAX_PLAYERS_PER_LOBBY),
        'aria-valuenow': String(seated),
      },
      el('span', {
        class: 'dash-meter__fill',
        style: { width: `${percent}%` },
      }),
    ),
  );
}

/** One status card: a caption, a large figure and an optional hint. */
function statusCard(caption: string, value: string, hint?: string): HTMLElement {
  return el(
    'div',
    { class: 'dash-stat' },
    el('span', { class: 'dash-stat__caption' }, caption),
    el('span', { class: 'dash-stat__value' }, value),
    hint ? el('span', { class: 'dash-stat__hint' }, hint) : null,
  );
}

/**
 * Build the dashboard.
 *
 * Layout follows the agreed wireframe: status cards and the preparation card in
 * the main column, the lobby roster and the game status in a side column. The
 * navigation is the shell's sidebar, so it is not repeated here.
 */
export function hostDashboard(data: DashboardData, handlers: DashboardHandlers): HTMLElement {
  const selected = data.quizzes.find((quiz) => quiz.id === data.selectedQuizId) ?? null;
  const rosterGame = data.rosterGame;
  const openCount = data.openGames.length;

  // ---- status cards -------------------------------------------------------
  // The player figure belongs to an open game; without one there is nothing to
  // count, so the card says so instead of inventing a capacity or a zero.
  const playerCard = rosterGame
    ? capacityCard(rosterGame.playerCount)
    : statusCard(
        'Players in lobby',
        `— / ${MAX_PLAYERS_PER_LOBBY}`,
        openCount ? 'Choose a game' : 'No game open',
      );

  const quizCard = selected
    ? statusCard(
        'Current quiz',
        selected.title,
        selected.category ?? `${selected.questionCount} question(s)`,
      )
    : statusCard('Current quiz', '—', 'None selected');

  const ready = Boolean(selected && selected.questionCount > 0);
  const prepCard = statusCard(
    'Preparation',
    ready ? 'Ready' : 'Not ready',
    ready ? 'All set to start' : 'Select a quiz with questions',
  );

  // ---- preparation card ---------------------------------------------------
  const select = el(
    'select',
    {
      class: 'input dash-select',
      'aria-label': 'Select a quiz',
      ...(data.quizzes.length === 0 ? { disabled: true } : {}),
    },
    ...(data.quizzes.length === 0
      ? [el('option', { value: '' }, 'No quizzes yet')]
      : data.quizzes.map((quiz) =>
          el(
            'option',
            { value: quiz.id },
            `${quiz.title} · ${quiz.questionCount} question${quiz.questionCount === 1 ? '' : 's'}`,
          ),
        )),
  ) as HTMLSelectElement;
  if (selected) select.value = selected.id;
  select.addEventListener('change', () => handlers.onSelectQuiz(select.value));

  const startButton = button('Start game', {
    variant: 'primary',
    onClick: () => handlers.onStart(),
  });
  startButton.disabled = !ready;
  startButton.classList.add('dash-start');

  const preparation = el(
    'section',
    { class: 'card dash-prep', 'aria-label': 'Game preparation' },
    el('h2', { class: 'dash-prep__title' }, 'Game preparation'),
    data.quizzes.length === 0
      ? emptyState(
          'No quizzes yet',
          'Create your first quiz in the editor.',
          button('Open editor', { onClick: () => (location.href = './editor.html') }),
        )
      : el(
          'div',
          { class: 'dash-prep__body' },
          el(
            'label',
            { class: 'dash-field' },
            el('span', { class: 'dash-field__label' }, 'Selected quiz'),
            select,
          ),
          el(
            'div',
            { class: 'dash-facts' },
            statRow('Questions', selected ? String(selected.questionCount) : '—'),
            statRow('Category', selected?.category ?? '—'),
            statRow(
              'Players',
              rosterGame
                ? `${rosterGame.playerCount} / ${MAX_PLAYERS_PER_LOBBY}`
                : `— / ${MAX_PLAYERS_PER_LOBBY}`,
            ),
            // The round background is a per-game value the server owns and the
            // host picks in the lobby (Phase 6.10). Before a game exists there is
            // nothing to choose, so the card names where it is set instead of
            // offering a control that would have no target.
            statRow('Background', rosterGame ? 'Set in the lobby' : 'Chosen in the lobby'),
          ),
          startButton,
        ),
  );

  // ---- side column: roster and game status --------------------------------
  const rosterList = data.roster.length
    ? el(
        'ul',
        { class: 'dash-roster' },
        ...data.roster.map((player) =>
          el(
            'li',
            { class: 'dash-roster__item' },
            playerAvatar(player.nickname, player.avatar, { size: 'sm' }),
            el('span', { class: 'dash-roster__name' }, player.nickname),
          ),
        ),
      )
    : el('p', { class: 'muted dash-roster__empty' }, 'No players yet.');

  const lobbyColumn = el(
    'section',
    { class: 'card dash-side__block', 'aria-label': 'Lobby players' },
    el(
      'div',
      { class: 'dash-side__head' },
      el('h2', { class: 'dash-side__title' }, 'Lobby – players'),
      rosterGame ? chip(`${data.roster.length} / ${MAX_PLAYERS_PER_LOBBY}`, 'cyan') : null,
    ),
    rosterGame
      ? el('p', { class: 'muted dash-side__meta' }, `${rosterGame.quizTitle} · ${rosterGame.pin}`)
      : null,
    rosterList,
  );

  // Only figures the server actually reports: the phase and the player count of
  // the open game. No "ready"/"waiting" split is invented here.
  const seated = rosterGame ? rosterGame.playerCount : 0;
  const capacityState = lobbyCapacityState(seated);
  const statusColumn = el(
    'section',
    { class: 'card dash-side__block', 'aria-label': 'Game status' },
    el('h2', { class: 'dash-side__title' }, 'Game status'),
    rosterGame
      ? el(
          'div',
          { class: 'dash-facts' },
          statRow('Lobby', rosterGame.phase),
          statRow('Players', `${seated} / ${MAX_PLAYERS_PER_LOBBY}`),
          statRow('Free places', String(freeLobbySeats(seated))),
          statRow('Open games', String(openCount)),
          capacityState === 'full'
            ? el('p', { class: 'dash-full-note', role: 'status' }, 'Lobby full')
            : null,
        )
      : el(
          'div',
          { class: 'dash-facts' },
          statRow('Lobby', 'Not open'),
          statRow('Players', `— / ${MAX_PLAYERS_PER_LOBBY}`),
          statRow('Open games', String(openCount)),
        ),
  );

  const side = el('aside', { class: 'dash-side' }, lobbyColumn, statusColumn);

  // ---- open games: resume ------------------------------------------------
  const resume = openCount
    ? el(
        'section',
        { class: 'card dash-open', 'aria-label': 'Open games' },
        el('h2', { class: 'dash-open__title' }, 'Open games'),
        el(
          'ul',
          { class: 'dash-open__list' },
          ...data.openGames.map((game) =>
            el(
              'li',
              { class: 'dash-open__item' },
              el(
                'div',
                { class: 'dash-open__info' },
                el('span', { class: 'dash-open__name' }, game.quizTitle),
                el(
                  'span',
                  { class: 'muted' },
                  `PIN ${game.pin} · ${game.playerCount} player(s) · ${game.phase}`,
                ),
              ),
              button('Resume', {
                variant: 'primary',
                small: true,
                onClick: () => handlers.onResume(game.id),
              }),
            ),
          ),
        ),
      )
    : null;

  return el(
    'div',
    { class: 'host-dash' },
    el(
      'div',
      { class: 'dash-main' },
      el('div', { class: 'dash-stats' }, playerCard, quizCard, prepCard),
      preparation,
      resume,
    ),
    side,
  );
}
