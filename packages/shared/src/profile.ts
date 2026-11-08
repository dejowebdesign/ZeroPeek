/**
 * Player profile domain (Phase 6.6).
 *
 * The profile shows a registered player their **own** progress. It is
 * deliberately separate from the quiz history: the history (old questions,
 * answers, game reports, other participants' results) stays admin-only
 * (`game-design-concept.md` §4.7). Nothing here exposes a question, an answer
 * or another player's data.
 *
 * Everything is pure so the same rules run in a unit test and on the server.
 * The server is the only place that computes a statistic — the client never
 * derives, guesses or stores one. No value here depends on an IP address
 * (product decision Q5).
 */

import { rankPlayers, type TieBreak } from './scoring.js';
import type { AvatarConfig } from './characters.js';
import type { ValidationIssue } from './validation.js';

/**
 * One of a player's seats in a finished game, before ranking.
 *
 * A seat is one `GamePlayer` row of a finished game. The caller passes the
 * *whole* roster of each finished game, so this module can compute the shared
 * rank with the game's own frozen tie-breakers — the same `rankPlayers` the
 * engine used live, so a recomputed rank can never disagree with the leaderboard
 * the players actually saw.
 */
export interface ProfileGameSeat {
  gameId: string;
  playerId: string;
  score: number;
  /** Correct answers on this seat, excluding skipped (neutralised) questions. */
  correctCount: number;
  /** Questions this seat answered, excluding skipped (neutralised) questions. */
  answeredCount: number;
  totalTimeMs: number;
  /** Join order, in milliseconds; lower is earlier. */
  joinedAt: number;
}

/** A player's seat after ranking. */
export interface RankedProfileSeat extends ProfileGameSeat {
  /** The shared rank in this game (1, 1, 3 on a tie); 1 is the winner. */
  rank: number;
}

/** The aggregated personal statistics shown in the profile. */
export interface ProfileStats {
  /** Distinct finished games this account took part in. */
  gamesPlayed: number;
  /** Finished games where this account's best seat ranked first (ties count). */
  wins: number;
  /** Finished games where this account's best seat reached the top three. */
  podiums: number;
  /** Correct answers across those games, excluding skipped questions. */
  correctAnswers: number;
  /** Questions answered across those games, excluding skipped questions. */
  answeredCount: number;
  /**
   * `correctAnswers / answeredCount`, or `null` when nothing has been answered
   * yet. `null` is deliberate: a player with no answers has no accuracy, and the
   * UI shows an honest empty state instead of a misleading `0 %`.
   */
  accuracy: number | null;
}

/** The authenticated account's own profile, as returned by `GET /api/profile`. */
export interface ProfileView {
  user: {
    id: string;
    username: string;
    role: string;
  };
  profile: {
    /**
     * The chosen Blockwelt-Helden character, or `null`. The avatar configuration
     * (Phase 6.7) mirrors this value in `avatarConfig.characterId`.
     */
    selectedCharacterId: string | null;
    /**
     * The stored avatar configuration (Phase 6.7), or `null` when the player has
     * not configured one yet. `null` is a valid state: the picker still works and
     * the avatar editor offers the character's default equipment.
     */
    avatarConfig: AvatarConfig | null;
  };
  stats: ProfileStats;
}

/** An empty statistic set, used for an account that has played nothing yet. */
export const EMPTY_PROFILE_STATS: ProfileStats = {
  gamesPlayed: 0,
  wins: 0,
  podiums: 0,
  correctAnswers: 0,
  answeredCount: 0,
  accuracy: null,
};

/**
 * The longest accepted character id (Phase 6.6).
 *
 * The id is a plain, opaque string until Phase 6.7 introduces the character
 * catalogue and validates it against that catalogue. The limit only bounds the
 * stored value so a request cannot write an unbounded string.
 */
export const CHARACTER_ID_MAX = 64;

/** How rare a character is. Cosmetic only — it never affects play. */
export type CharacterRarity = 'common' | 'rare' | 'legendary';

/** One Blockwelt-Helden character a player can choose (Phase 6.6.2). */
export interface Character {
  /** Stable key stored in `PlayerProfile.selectedCharacterId`. */
  id: string;
  /** Display name. */
  name: string;
  /** A short characterisation, shown under the name. */
  tagline: string;
  /** Cosmetic rarity, used for the frame and colouring. */
  rarity: CharacterRarity;
}

/**
 * The characters a player may pick from (Phase 6.6.2).
 *
 * These are the canonical Blockwelt-Helden figures; their ids are fixed by the
 * concept (`docs/concept/game-design-concept.md` §2.1/§2.3) and the asset
 * briefing (`docs/assets/ASSET-BRIEFING.md`, Block B). **No artwork ships yet** —
 * the character files are still outstanding — so an entry carries a name and a
 * tagline only. Nothing here draws or invents a figure.
 *
 * The picker offers exactly these ids. The server stays permissive on purpose:
 * `validateProfileUpdate` accepts any bounded string, so a character added here
 * needs no backend change, and a value stored before this list existed is still
 * shown to its owner.
 */
export const CHARACTER_CATALOGUE: readonly Character[] = [
  { id: 'ethan', name: 'Ethan', tagline: 'The builder hero', rarity: 'common' },
  { id: 'maya', name: 'Maya', tagline: 'The builder heroine', rarity: 'common' },
  { id: 'pixel', name: 'Pixel', tagline: 'The loyal dog', rarity: 'common' },
  { id: 'bee', name: 'The Bee', tagline: 'The buzzing companion', rarity: 'rare' },
  { id: 'dr-obscura', name: 'Dr. Obscura', tagline: 'The antagonist', rarity: 'legendary' },
  { id: 'o-bot', name: 'O-Bot', tagline: 'The minion', rarity: 'legendary' },
];

/** Look a character up by id, or `undefined` when the id is not in the catalogue. */
export function findCharacter(id: string | null | undefined): Character | undefined {
  if (!id) return undefined;
  return CHARACTER_CATALOGUE.find((character) => character.id === id);
}

/**
 * Validate the body of `PUT /api/profile`.
 *
 * Only the fields Phase 6.6 owns are accepted. Any other field (a statistic, an
 * XP value, a `userId`, …) is rejected, so a client cannot smuggle a value the
 * server computes or a field the server did not authorise. `selectedCharacterId`
 * is either a bounded, trimmed string or `null` (clear the choice).
 */
export function validateProfileUpdate(body: unknown): ValidationIssue[] {
  if (body === null || typeof body !== 'object') {
    return [{ path: '', message: 'A JSON object is required.' }];
  }
  const record = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  const allowed = new Set(['selectedCharacterId']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      issues.push({ path: key, message: 'This field cannot be changed.' });
    }
  }

  if ('selectedCharacterId' in record) {
    const value = record.selectedCharacterId;
    if (value !== null && typeof value !== 'string') {
      issues.push({ path: 'selectedCharacterId', message: 'Must be a string or null.' });
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        issues.push({ path: 'selectedCharacterId', message: 'Must not be empty.' });
      } else if (trimmed.length > CHARACTER_ID_MAX) {
        issues.push({
          path: 'selectedCharacterId',
          message: `Must be at most ${CHARACTER_ID_MAX} characters.`,
        });
      }
    }
  }

  return issues;
}

/**
 * Rank a finished game's seats with the game's own tie-breakers.
 *
 * Thin wrapper over the shared `rankPlayers`, so the profile ranks a game
 * exactly as the engine did. Returns the ranked seats in rank order.
 */
export function rankGameSeats(
  seats: readonly ProfileGameSeat[],
  tieBreak: TieBreak[],
): RankedProfileSeat[] {
  const ranked = rankPlayers(
    seats.map((seat) => ({
      id: seat.playerId,
      score: seat.score,
      correctCount: seat.correctCount,
      totalTimeMs: seat.totalTimeMs,
      joinedAt: seat.joinedAt,
    })),
    tieBreak,
  );
  const byId = new Map(seats.map((seat) => [seat.playerId, seat]));
  return ranked.map((entry) => ({ ...byId.get(entry.id)!, rank: entry.rank }));
}

/**
 * The seat that should represent an account in one game.
 *
 * Normally an account has exactly one seat per game. If it somehow holds more
 * than one (two tabs, two nicknames), only the best seat counts, so a game is
 * never counted twice. "Best" is the lowest rank, then the higher score, then the
 * smaller player id — fully deterministic.
 */
function bestSeat(a: RankedProfileSeat, b: RankedProfileSeat): RankedProfileSeat {
  if (a.rank !== b.rank) return a.rank < b.rank ? a : b;
  if (a.score !== b.score) return a.score > b.score ? a : b;
  return a.playerId <= b.playerId ? a : b;
}

/**
 * Aggregate an account's ranked seats into the profile statistics.
 *
 * Rules (documented so they are testable and never silently changed):
 *   - one participation per **distinct finished game** (seats are de-duplicated
 *     by game id, keeping the best seat — see `bestSeat`);
 *   - a **win** is a best seat ranked first; on a shared rank (1, 1, 3) every
 *     tied leader wins;
 *   - a **podium** is a best seat ranked in the top three;
 *   - correct/answered counts come from the best seat only, so a duplicate seat
 *     cannot inflate them;
 *   - **skipped questions are excluded** by the caller (they were neutralised:
 *     answers kept but zeroed), so they neither count as answered nor as wrong;
 *   - a game with no answered questions still counts as played and can be won.
 */
export function summariseSeats(seats: readonly RankedProfileSeat[]): ProfileStats {
  const byGame = new Map<string, RankedProfileSeat>();
  for (const seat of seats) {
    const current = byGame.get(seat.gameId);
    byGame.set(seat.gameId, current ? bestSeat(current, seat) : seat);
  }

  let wins = 0;
  let podiums = 0;
  let correctAnswers = 0;
  let answeredCount = 0;
  for (const seat of byGame.values()) {
    if (seat.rank === 1) wins += 1;
    if (seat.rank <= 3) podiums += 1;
    correctAnswers += seat.correctCount;
    answeredCount += seat.answeredCount;
  }

  return {
    gamesPlayed: byGame.size,
    wins,
    podiums,
    correctAnswers,
    answeredCount,
    accuracy: answeredCount === 0 ? null : correctAnswers / answeredCount,
  };
}
