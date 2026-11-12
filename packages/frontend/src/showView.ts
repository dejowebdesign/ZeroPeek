/**
 * Pure builders for the beamer surface.
 *
 * Kept apart from `pages/host.ts` (which boots a socket on import) so the
 * presentation markup can be tested directly. Both functions only read the
 * solution-free data the server sends, so nothing here can leak an answer.
 */

import type { PublicPlayer, PublicQuestion } from '@zeropeek/shared';

import { playerAvatar } from './avatar.js';
import { el } from './dom.js';

/**
 * The answer labels for the beamer, read from the solution-free `display` the
 * server already sends. Only types with a fixed set of choices produce a list;
 * for every other type the beamer shows the prompt and timer alone.
 */
export function questionDisplayOptions(question: PublicQuestion): string[] {
  const raw = question.display?.options;
  if (!Array.isArray(raw)) return [];
  return raw.map((value) =>
    typeof value === 'boolean' ? (value ? 'True' : 'False') : String(value),
  );
}

/** One beamer leaderboard row: rank, head portrait, name, score. */
export function leaderboardRow(player: PublicPlayer, index: number): HTMLElement {
  return el(
    'li',
    { class: 'leaderboard__row' },
    el('span', { class: 'leaderboard__rank' }, String(index + 1)),
    el(
      'span',
      { class: 'leaderboard__who' },
      playerAvatar(player.nickname, player.avatar, { size: 'md', crop: 'head' }),
      el('span', { class: 'leaderboard__name' }, player.nickname),
    ),
    el('span', { class: 'leaderboard__score' }, String(player.score)),
  );
}

/**
 * A podium place. `rank` is 1-based and drives the modifier class, so the
 * styling for gold, silver and bronze stays in the stylesheet. The winner's
 * **full character figure** is shown large, so the champion is recognisable from
 * across the room (Phase 6.8.4 §4). Only the existing supplied artwork is framed
 * (`crop: 'full'`); no layer is composed and no image is generated.
 */
export function podiumPlace(player: PublicPlayer, rank: number): HTMLElement {
  return el(
    'li',
    { class: `podium__place podium__place--${rank}` },
    playerAvatar(player.nickname, player.avatar, { size: 'lg', crop: 'full' }),
    el('span', { class: 'podium__rank' }, String(rank)),
    el('span', { class: 'podium__name' }, player.nickname),
    el('span', { class: 'podium__score' }, String(player.score)),
  );
}
