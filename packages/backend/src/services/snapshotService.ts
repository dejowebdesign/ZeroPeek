/**
 * Immutable game snapshots (Phase 6.4).
 *
 * A game must keep the quiz it was started with, no matter what happens to that
 * quiz afterwards. This service owns the one place that decides *which* quiz a
 * game runs on:
 *
 *   - before the run starts (`lobby`) a game follows the live, editable quiz;
 *   - the moment the run starts, the quiz is copied into `game_snapshots` and
 *     the game follows **only** that copy from then on.
 *
 * That makes editing or deleting the original quiz harmless to a started round
 * and to its report (product decision, `game-design-concept.md` §8.7).
 *
 * The copy is stored as one JSONB envelope per game (`@zeropeek/shared`
 * `GameSnapshotData`), which keeps the historical structure whole: questions,
 * options, correct solutions, types and order are preserved verbatim, so a
 * question the author later rewrites is still reported exactly as it was asked.
 *
 * Guarantees:
 *   - **one snapshot per game** (unique `game_id`), written once;
 *   - a repeated start returns the existing snapshot instead of a second,
 *     contradictory one;
 *   - snapshot creation and the transition into `question` happen in **one
 *     transaction**, so a game can never be running without a valid snapshot;
 *   - a concurrent edit of the quiz cannot mix old and new questions: the quiz
 *     is read inside the same transaction that writes the snapshot.
 */

import type { Prisma } from '@prisma/client';

import {
  parseSnapshotData,
  snapshotToQuiz,
  toSnapshotData,
  type GameSnapshotData,
  type Quiz,
} from '@zeropeek/shared';

import { prisma } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { getQuiz } from './quizService.js';

/** The transaction client type, so callers may pass an open transaction. */
type Tx = Prisma.TransactionClient;

/** Read the stored snapshot for a game, or null when there is none. */
export async function findSnapshot(gameId: string): Promise<GameSnapshotData | null> {
  const row = await prisma.gameSnapshot.findUnique({ where: { gameId } });
  if (!row) return null;
  return parseSnapshotData(row.payload);
}

/**
 * Ensure a game has a snapshot, creating it from the live quiz when it does not.
 *
 * Idempotent: an existing snapshot is returned untouched, so calling this twice
 * (a host double-click, a reconnect, a report read) never produces a second,
 * conflicting copy. The unique constraint on `game_id` is the backstop against a
 * race – if two callers insert at once, the loser re-reads the winner's row.
 *
 * Returns the snapshot payload, or throws when the game has no quiz to copy
 * (its source quiz is already gone and no snapshot exists).
 */
export async function ensureSnapshot(
  gameId: string,
  tx: Tx | typeof prisma = prisma,
): Promise<GameSnapshotData> {
  const existing = await tx.gameSnapshot.findUnique({ where: { gameId } });
  if (existing) {
    const parsed = parseSnapshotData(existing.payload);
    if (parsed) return parsed;
  }

  const game = await tx.game.findUnique({ where: { id: gameId } });
  if (!game) throw notFound('Game not found.');
  if (!game.quizId) {
    // No snapshot and no source quiz: this can only be a game that was started
    // before Phase 6.4 and whose quiz has since been deleted. Its recorded
    // answers and scores are intact, but the questions can no longer be
    // recovered – the report says so explicitly rather than inventing one.
    throw conflict('This game has no snapshot and its quiz no longer exists.');
  }

  const quiz = await getQuiz(game.quizId);
  const data = toSnapshotData(quiz, game.settings);

  try {
    const row = await tx.gameSnapshot.create({
      data: {
        gameId,
        quizId: game.quizId,
        version: data.version,
        title: data.quiz.title,
        questionCount: data.quiz.questions.length,
        payload: data as unknown as Prisma.InputJsonValue,
      },
    });
    return parseSnapshotData(row.payload) ?? data;
  } catch (error) {
    // A concurrent caller won the race; use its snapshot rather than failing.
    if (isUniqueViolation(error)) {
      const row = await tx.gameSnapshot.findUnique({ where: { gameId } });
      const parsed = row ? parseSnapshotData(row.payload) : null;
      if (parsed) return parsed;
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

/**
 * Freeze the quiz for a run that is about to start.
 *
 * The snapshot is written **before** the game leaves the lobby, in one
 * transaction with the `startedAt` stamp. So the invariant the product demands
 * holds by construction: a game is never in a running phase without a valid
 * snapshot. If the snapshot cannot be written, this throws and the game stays in
 * the lobby, where the host can simply try again.
 *
 * Returns the snapshot the game must use from now on.
 */
export async function startWithSnapshot(gameId: string): Promise<GameSnapshotData> {
  return prisma.$transaction(async (tx) => {
    const snapshot = await ensureSnapshot(gameId, tx);
    await tx.game.update({ where: { id: gameId }, data: { startedAt: new Date() } });
    return snapshot;
  });
}

/**
 * The quiz a game runs on.
 *
 * Prefers the snapshot. For a game that started before Phase 6.4 (no snapshot
 * yet) it falls back to the live quiz **explicitly** and freezes it on the way
 * out, so the legacy round becomes immutable too. A lobby game follows the live
 * quiz, because nothing has been frozen yet.
 */
export async function quizForGame(game: {
  id: string;
  quizId: string | null;
  phase: string;
}): Promise<Quiz> {
  const snapshot = await findSnapshot(game.id);
  if (snapshot) return snapshotToQuiz(snapshot.quiz);

  if (game.phase !== 'lobby') {
    // Legacy started game: self-heal by freezing the live quiz now.
    const created = await ensureSnapshot(game.id);
    return snapshotToQuiz(created.quiz);
  }

  if (!game.quizId) throw notFound('Quiz not found.');
  return getQuiz(game.quizId);
}
