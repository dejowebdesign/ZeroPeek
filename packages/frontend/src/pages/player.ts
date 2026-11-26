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
  LeadState,
  OwnResult,
  PlayerAnswerState,
  PlayerSync,
  ProgressView,
  PublicPlayer,
  PublicQuestion,
} from '@zeropeek/shared';
import { levelProgress } from '@zeropeek/shared';

import { get } from '../api.js';
import { playerAvatar } from '../avatar.js';
import { applyRoundBackground, clearRoundBackground } from '../background.js';
import { el, render } from '../dom.js';
import { appShell } from '../navigation.js';
import { connectPlayer, request, type PlayerSocket } from '../socket.js';
import { ClockSync } from '../clockSync.js';
import { questionInput } from '../questionView.js';
import {
  answerDeadlineRemainingMs,
  endProgressActions,
  hostStatusChip,
  joinIdentityHint,
  lobbyRoster,
  pinFromQuery,
  screenForSync,
} from '../playerView.js';
import {
  brand,
  button,
  chip,
  countdown,
  errorText,
  field,
  notice,
  setBusy,
  spinner,
} from '../ui.js';
import { saveClaim } from '../claim.js';
import { startStarfield } from '../starfieldLayer.js';

const STORAGE_KEY = 'zeropeek.player';

/** The signed-in player account, or `null` for a guest (Phase 6.8.3). */
interface PlayerAccount {
  id: string;
  username: string;
}

/** The host's reachability as last announced, or null before the first event. */
let hostStatus: HostPresence | null = null;
/** The open question and this player's prior answer, so pause/resume re-renders in place. */
let currentQuestion: PublicQuestion | null = null;
let currentPrior: PlayerAnswerState | null = null;

/**
 * The last public board the server sent (Phase 6.14). Only used to show the
 * player their own rank and score in the header; it is never written to, never
 * sorted on the client and never used to compute a score.
 */
let currentBoard: PublicPlayer[] = [];
/** A closure that repaints the current screen, so a host-status change re-renders it. */
let repaint: (() => void) | null = null;
/**
 * The signed-in player account, resolved once at boot from `/api/player-auth/me`
 * (Phase 6.8.3). `null` means a guest. It decides whether the join asks for a
 * name (guest) or uses the account's (signed-in) and whether the end screen
 * offers registration — the two bugs this phase fixes. Only the **player**
 * context is read, so a host signed in on the same browser stays a guest here.
 */
let account: PlayerAccount | null = null;

/**
 * The signed-in player's own level/XP, read once at boot from `/api/progress`
 * (Phase 6.8.4 §5). `null` for a guest or when the read fails, so the in-game
 * player display simply omits the level line rather than inventing one. These are
 * the server's own figures — never a client guess or a demo value.
 */
let myProgress: ProgressView | null = null;

/** Repaint the current screen in place (used when only the host status changed). */
function rerenderCurrent(): void {
  repaint?.();
}

/** Wrap a centred screen in the player shell, marking the active nav entry. */
function shell(
  active: string,
  content: HTMLElement,
  options: { hideBrand?: boolean } = {},
): HTMLElement {
  // Remember how to redraw this exact screen, so a host-status change can repaint
  // in place (the chip is part of the shell) without losing the current view.
  repaint = () => render(app, shell(active, content, options));
  // The host-status chip is prepended to every screen, so a host dropping out is
  // visible wherever the player is. It renders nothing while the host is fine.
  const host = hostStatusChip(hostStatus);
  return appShell({
    role: 'player',
    active,
    hideBrand: options.hideBrand,
    children: host ? [host, content] : [content],
  });
}

interface StoredSession {
  gameId: string;
  playerId: string;
  token: string;
  nickname: string;
  /** The character id the server seated this player with, or `''` (Phase 6.8.3). */
  avatar: string;
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
  // Clock correction for the start countdown (Phase 6.9.1), reusing the Phase
  // 6.8.5 sync. The countdown is drawn against the server's clock so every device
  // shows the same number; the server still decides when the question opens.
  const clock = new ClockSync(socket);
  void clock.sync();
  /** The interval driving the player's start countdown, or null when idle. */
  let leadTimer: number | null = null;

  function stopLeadTimer(): void {
    if (leadTimer !== null) {
      clearInterval(leadTimer);
      leadTimer = null;
    }
  }

  /**
   * The timeout that closes the answer control when the question's visible clock
   * runs out (Phase 6.9.5). The server is the authority on the deadline — this is
   * only the matching local feedback, so the buttons go inert at the same instant
   * the server stops accepting, instead of staying clickable against a closed
   * question. Cleared on every screen change.
   */
  let questionTimer: number | null = null;

  /**
   * The visible countdown (Phase 6.14). `questionTimer` only closes the answer
   * control at the deadline; this interval redraws the ring and the number while
   * the question is open. Both are cleared together, so a screen change can
   * never leave a ring ticking over a question that is no longer on screen.
   */
  let ringTimer: number | null = null;

  function stopQuestionTimer(): void {
    if (questionTimer !== null) {
      clearTimeout(questionTimer);
      questionTimer = null;
    }
    if (ringTimer !== null) {
      clearInterval(ringTimer);
      ringTimer = null;
    }
  }

  /**
   * Drive the ring from the server's own `openedAt` through the clock sync, the
   * same source the deadline uses. Nothing is stored locally, so a reconnect
   * continues the countdown instead of restarting it.
   */
  function startRing(
    ring: HTMLElement,
    value: HTMLElement | null,
    openedAt: number,
    limitMs: number,
  ): void {
    const paint = (): void => {
      const remaining = Math.max(0, openedAt + limitMs - clock.serverNow());
      const ratio = limitMs > 0 ? remaining / limitMs : 0;
      ring.style.setProperty('--progress', String(ratio));
      if (value) value.textContent = String(Math.ceil(remaining / 1000));
      // Below a fifth of the limit the ring turns warm. The colour is a
      // reinforcement only — the number still states the time in text.
      ring.classList.toggle('player-timer--low', ratio <= 0.2);
    };
    paint();
    ringTimer = window.setInterval(paint, 250);
  }

  /** Show the join form. A signed-in player is asked for the PIN only. */
  function showJoin(message?: string): void {
    stopLeadTimer();
    stopQuestionTimer();
    // A scanned lobby QR carries `?pin=` (Phase 6.14), so the field starts filled
    // and the player only confirms. An unusable value is ignored, never shown.
    const prefilled = pinFromQuery(location.search);
    const pin = el('input', {
      class: 'input',
      inputmode: 'numeric',
      maxlength: '6',
      placeholder: '000000',
      autocomplete: 'off',
      value: prefilled,
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
          // A signed-in player sends no nickname: the server seats them under
          // their account name and avatar (Phase 6.8.3). A guest sends the name.
          const payload = account
            ? { pin: pin.value.trim().toUpperCase() }
            : { pin: pin.value.trim().toUpperCase(), nickname: nickname.value.trim() };
          const result = await request<{
            playerId: string;
            gameId: string;
            token: string;
            nickname: string;
            avatar: string;
          }>(socket, 'player:join', payload);
          // Store the identity the **server** seated (never the typed one), so a
          // reconnect and the screens agree with the roster.
          saveSession({ ...result });
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
            account ? joinIdentityHint(account.username) : null,
            field('Game PIN', pin),
            // A guest must supply a name; a signed-in player never re-enters one.
            account ? null : field('Your name', nickname),
            message ? notice(message, 'info') : null,
            feedback,
            el('div', { class: 'join__actions' }, submit),
          ),
        ),
      ),
    );
    // Focus the first field the player actually has to fill: with a prefilled PIN
    // that is the nickname, otherwise the PIN itself.
    (prefilled && !account ? nickname : pin).focus();
  }

  /** Show the waiting room until the host starts. */
  function showWaiting(players: PublicPlayer[] = []): void {
    stopLeadTimer();
    stopQuestionTimer();
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
            el(
              'div',
              { class: 'lobby__me' },
              playerAvatar(session?.nickname ?? 'player', session?.avatar, { size: 'lg' }),
            ),
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

  /**
   * The start countdown (Phase 6.9.1). Reuses the shared wireframe ring and the
   * server's own `endsAt`, so a player sees the same countdown the host and beamer
   * show and a reconnect mid-countdown continues it rather than restarting.
   */
  function showLead(lead: LeadState): void {
    stopLeadTimer();
    stopQuestionTimer();
    currentQuestion = null;
    const timer = countdown(Math.ceil(lead.durationSeconds), 1);
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
            el('h1', { class: 'join__title' }, 'Get ready!'),
            el('p', { class: 'muted' }, 'The first question starts in'),
            timer,
          ),
        ),
      ),
    );
    const value = timer.querySelector<HTMLElement>('.countdown__value');
    const total = Math.max(1, lead.durationSeconds);
    const tick = (): void => {
      const remainingMs = Math.max(0, lead.endsAt - clock.serverNow());
      const left = Math.ceil(remainingMs / 1000);
      if (value) value.textContent = String(left);
      timer.style.setProperty('--progress', String(Math.min(1, remainingMs / (total * 1000))));
      if (remainingMs <= 0) stopLeadTimer();
    };
    tick();
    leadTimer = window.setInterval(tick, 250);
  }

  /** Show an open question. `prior` carries a reconnect's existing answer. */
  function showQuestion(question: PublicQuestion, prior?: PlayerAnswerState | null): void {
    stopLeadTimer();
    stopQuestionTimer();
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
    /** Make the answer control inert and say why. */
    const closeInput = (): void => {
      input.querySelectorAll('button, input, select, textarea').forEach((node) => {
        (node as HTMLButtonElement).disabled = true;
      });
    };
    if (prior?.answered || question.paused) {
      // Already answered (or the question is paused): the control stays visible
      // but inert, so a player cannot submit a second answer or answer a frozen
      // question.
      closeInput();
    }
    // A running question closes its control when the visible clock reaches zero,
    // the same instant the server stops accepting (Phase 6.9.5). The countdown is
    // drawn from the server's `openedAt` through the clock sync, so every device
    // closes together; a paused question has no clock and stays inert until the
    // host resumes, and a slide has no clock and no answer control at all.
    if (!submitted && !question.paused && question.type !== 'slide') {
      const remainingMs = answerDeadlineRemainingMs(question, clock.serverNow());
      if (remainingMs !== null && remainingMs <= 0) {
        closeInput();
      } else if (remainingMs !== null) {
        questionTimer = window.setTimeout(() => {
          closeInput();
          if (!submitted) feedback.replaceChildren(notice('Time is up.', 'info'));
        }, remainingMs);
      }
    }

    const me = loadSession();
    const myEntry = myBoardEntry();
    render(
      app,
      shell(
        'questions',
        el(
          'section',
          { class: 'centered player-game' },
          playerHeader(me?.nickname ?? 'player', me?.avatar, myEntry),
          el(
            'div',
            { class: 'player-question' },
            el(
              'div',
              { class: 'player-question__card' },
              el(
                'div',
                { class: 'player-question__head' },
                el(
                  'span',
                  { class: 'player-question__topic' },
                  el('span', { class: 'player-question__topic-icon', 'aria-hidden': 'true' }, '⚖'),
                  // The wireframe asks for the quiz name here. `PlayerSync` carries
                  // no quiz title, so the question's own category is shown when the
                  // author set one; otherwise the type is named. Nothing is invented.
                  question.category ?? (question.type === 'slide' ? 'Info' : 'Question'),
                ),
                el(
                  'span',
                  { class: 'player-question__counter' },
                  `Question ${question.index + 1} of ${question.total}`,
                ),
              ),
              el('h2', { class: 'player-question__prompt' }, question.text),
              el('div', { class: 'player-question__rule' }),
              question.paused ? notice('The host paused the game.', 'info') : null,
              input,
              feedback,
            ),
            // A slide carries no answer and no clock, so the ring is not drawn.
            question.type === 'slide' || question.paused ? null : timerRing(question),
          ),
        ),
        // The header above carries the logo in its centre column, so the shell
        // does not draw it a second time.
        { hideBrand: true },
      ),
    );
  }

  /**
   * The question ring. It is built here rather than inside the card so the two
   * can sit side by side; `startRing` then drives it from the server's deadline.
   */
  function timerRing(question: PublicQuestion): HTMLElement | null {
    const openedAt = question.openedAt;
    const limitMs = Math.max(0, question.timeLimit) * 1000;
    if (openedAt === null || limitMs <= 0) return null;
    const ring = countdown(Math.ceil(limitMs / 1000), 1);
    const value = ring.querySelector<HTMLElement>('.countdown__value');
    const wrap = el(
      'div',
      { class: 'player-timer' },
      el(
        'div',
        { class: 'player-timer__dial', role: 'timer', 'aria-label': 'Time remaining' },
        ring,
        el('span', { class: 'player-timer__label', 'aria-hidden': 'true' }, 'Time'),
      ),
    );
    startRing(wrap, value, openedAt, limitMs);
    return wrap;
  }

  /**
   * The player's own row from the current board, or null. Rank and score come
   * from the server's leaderboard — nothing is counted on the client.
   */
  function myBoardEntry(): PublicPlayer | null {
    const id = loadSession()?.playerId;
    if (!id) return null;
    return currentBoard.find((entry) => entry.id === id) ?? null;
  }

  /**
   * The three-zone header: the player's profile on the left, the logo in the
   * centre, rank and score on the right. A signed-in player also gets the real
   * level and XP figures, from `levelProgress` over the server's XP total.
   */
  function playerHeader(
    nickname: string,
    avatar: string | null | undefined,
    mine: PublicPlayer | null,
  ): HTMLElement {
    const bar = myProgress ? levelProgress(myProgress.xp) : null;
    const rank = mine ? currentBoard.indexOf(mine) + 1 : null;
    return el(
      'header',
      { class: 'player-head' },
      el(
        'div',
        { class: 'player-head__profile' },
        playerAvatar(nickname, avatar, { size: 'lg' }),
        el(
          'div',
          { class: 'player-head__body' },
          el('span', { class: 'player-head__name' }, nickname),
          bar
            ? el('span', { class: 'player-head__level' }, `Level ${bar.level}`)
            : el('span', { class: 'player-head__level' }, 'Guest'),
          bar
            ? el('span', {
                class: 'player-head__xp',
                style: { '--ratio': String(bar.ratio) },
                role: 'progressbar',
                'aria-label': `Progress to level ${bar.nextLevel}`,
                'aria-valuemin': '0',
                'aria-valuemax': String(bar.xpForThisLevel),
                'aria-valuenow': String(bar.xpIntoLevel),
                'aria-valuetext': `${bar.xpIntoLevel} of ${bar.xpForThisLevel} XP`,
              })
            : null,
          bar
            ? el(
                'span',
                { class: 'player-head__xp-label' },
                `XP ${bar.xpIntoLevel.toLocaleString()} / ${bar.xpForThisLevel.toLocaleString()}`,
              )
            : null,
        ),
      ),
      el('div', { class: 'player-head__logo' }, brand()),
      el(
        'div',
        { class: 'player-head__status' },
        rank === null
          ? null
          : el(
              'div',
              { class: 'player-stat' },
              el('span', { class: 'player-stat__icon', 'aria-hidden': 'true' }, '🏆'),
              el('span', { class: 'player-stat__value' }, `#${rank}`),
              el('span', { class: 'player-stat__label' }, 'Place'),
            ),
        mine
          ? el(
              'div',
              { class: 'player-stat' },
              el('span', { class: 'player-stat__icon', 'aria-hidden': 'true' }, '★'),
              el('span', { class: 'player-stat__value' }, String(mine.score)),
              el('span', { class: 'player-stat__label' }, 'Points'),
            )
          : null,
        // The reference includes a separate settings glyph. Keep it decorative
        // until a real player settings action exists; do not imply a dead control.
        el(
          'span',
          {
            class: 'player-head__settings',
            'aria-disabled': 'true',
            'aria-label': 'Settings unavailable during the quiz',
            title: 'Settings unavailable during the quiz',
          },
          el('span', { 'aria-hidden': 'true' }, '⚙'),
        ),
      ),
    );
  }

  /** Show the player's own result for the revealed question. */
  function showResult(questionId: string, result: OwnResult): void {
    stopQuestionTimer();
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
    stopQuestionTimer();
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
                  el(
                    'span',
                    { class: 'leaderboard__who' },
                    playerAvatar(player.nickname, player.avatar, { size: 'sm' }),
                    el('span', { class: 'leaderboard__name' }, player.nickname),
                  ),
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
    stopQuestionTimer();
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
            { class: 'card' },
            el(
              'div',
              { class: 'lobby__me' },
              playerAvatar(session?.nickname ?? 'player', session?.avatar, { size: 'lg' }),
            ),
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
                  el(
                    'span',
                    { class: 'leaderboard__who' },
                    playerAvatar(player.nickname, player.avatar, { size: 'sm' }),
                    el('span', { class: 'leaderboard__name' }, player.nickname),
                  ),
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
            // A signed-in player's round was already granted to their account, so
            // they are told it was saved and offered no registration. A guest
            // keeps the optional invitation (Phase 6.8.3).
            endProgressActions(account !== null),
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
    // The background comes from the server with every snapshot, so a reconnect
    // restores exactly the image the round is using (Phase 6.10).
    applyRoundBackground(sync.background);
    // Keep the last board for the header's own rank and score (Phase 6.14).
    if (sync.board) currentBoard = sync.board;
    switch (screenForSync(sync)) {
      case 'lead':
        if (sync.lead) showLead(sync.lead);
        else showWaiting(sync.board ?? []);
        break;
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
  // The start countdown (Phase 6.9.1). The server timestamps are rendered against
  // the clock sync, so every device counts down together.
  socket.on('game:lead', (lead) => showLead(lead));
  socket.on('game:question', (question) => showQuestion(question));
  // The host changed the round's background (Phase 6.10). The payload is the
  // catalogue id the server owns, so every player shows the same image.
  socket.on('game:background', (payload) => applyRoundBackground(payload.background));
  socket.on('game:reveal', (payload) => showResult(payload.questionId, payload.result));
  socket.on('game:board', (payload) => showBoard(payload.players));
  socket.on('game:ended', (payload) => showEnd(payload));
  // A guest who just finished a round is offered a proof to keep it. It is stored
  // locally; the profile page redeems it once after registering (Phase 6.8.2).
  socket.on('game:claimable', (payload) => {
    saveClaim({ ...payload, receivedAt: Date.now() });
  });

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
      // unfreeze the answer control. The question's deadline is rebased on the
      // resumed remainder (the pause shifted the server's `openedAt` forward), so
      // the Phase 6.9.5 close-timer waits exactly the time that was left rather
      // than firing against the pre-pause deadline.
      const limitMs = currentQuestion.timeLimit * 1000;
      currentQuestion = {
        ...currentQuestion,
        paused: false,
        remainingMs: null,
        openedAt: clock.serverNow() - (limitMs - payload.remainingMs),
      };
      showQuestion(currentQuestion, currentPrior);
    }
  });

  // The host removed this player. Clear the stored session so a reload does not
  // try to reclaim a slot that no longer exists, and return to the join form.
  socket.on('game:kicked', () => {
    clearRoundBackground();
    clearSession();
    hostStatus = null;
    showJoin('You were removed from the game by the host.');
  });

  // ---------------------------------------------------------------------------
  // Boot: reconnect if a session is stored, otherwise show the join form. The
  // profile is its own page (profile.html, Phase 6.6), so it is not routed here.
  //
  // The same rejoin runs on every **socket** reconnect, not only on page load:
  // an automatic Socket.IO reconnect (a dropped Wi-Fi, a sleeping tab) opens a
  // brand-new socket that belongs to no room, so without this the player would
  // silently stop receiving the game (no question, no result) until they
  // reloaded. `player:rejoin` re-joins the room and returns the real current
  // state, so the screen is rebuilt from the server rather than a client guess.
  // ---------------------------------------------------------------------------
  function rejoinStored(): void {
    const stored = loadSession();
    if (!stored) {
      showJoin();
      return;
    }
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
  }

  let hasConnected = false;
  socket.on('connect', () => {
    // Re-measure the offset on every (re)connect: a reconnect may land on a
    // different backend process, and a device that slept has a drifted clock.
    void clock.sync();
    // The first connect is handled by the boot below; a later connect is an
    // automatic reconnect and must re-establish the game membership.
    if (hasConnected) rejoinStored();
    hasConnected = true;
  });

  // The animated field, at the lighter profile: a player phone has a smaller
  // GPU budget than the host's projector, and the join screen is the only
  // surface here that shows it.
  startStarfield('player');

  // Resolve the signed-in player account once, then boot. The lookup is
  // best-effort: any failure (offline, a stale cookie, a 401) simply means
  // "guest", so the join is never blocked by it. Only the **player** context is
  // read, so a host signed in on the same browser stays a guest on this surface.
  void (async () => {
    try {
      const me = await get<{ user: { id: string; username: string; role: string } | null }>(
        '/api/player-auth/me',
      );
      account = me.user ? { id: me.user.id, username: me.user.username } : null;
    } catch {
      account = null;
    }
    // The player's own level/XP, for the in-game display (Phase 6.8.4 §5). Only
    // read for a signed-in account; a guest has no progress to show. A failure is
    // not fatal — the display just omits the level line.
    if (account) {
      try {
        myProgress = await get<ProgressView>('/api/progress');
      } catch {
        myProgress = null;
      }
    }
    if (loadSession()) rejoinStored();
    else showJoin();
  })();
}
