/**
 * Quiz persistence: create, read, update, delete, duplicate and import/export.
 *
 * Every write validates the incoming quiz with the shared validator before it
 * touches the database, so an invalid question can never be stored (ADR 0006:
 * server-side validation on every write).
 */

import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { validateQuiz, type Quiz } from '@zeropeek/shared';

import { prisma } from '../db.js';
import { invalid, notFound } from '../errors.js';
import { fromQuestion, toQuiz, type QuizRow } from '../mappers.js';

/** The Prisma include that pulls a quiz with its ordered questions. */
const WITH_QUESTIONS = { questions: { orderBy: { position: 'asc' as const } } };

function assertValid(quiz: Quiz): void {
  const result = validateQuiz(quiz);
  if (!result.ok) {
    throw invalid('The quiz is not valid.', result.issues);
  }
}

/** List quiz summaries for one owner (or all, for an admin). */
export async function listQuizzes(ownerId: string | null, isAdmin: boolean) {
  return prisma.quiz.findMany({
    where: isAdmin ? {} : { ownerId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      description: true,
      theme: true,
      category: true,
      difficulty: true,
      updatedAt: true,
      _count: { select: { questions: true } },
    },
  });
}

/** Load one quiz as the domain model, or throw 404. */
export async function getQuiz(id: string): Promise<Quiz> {
  const row = await prisma.quiz.findUnique({ where: { id }, include: WITH_QUESTIONS });
  if (!row) throw notFound('Quiz not found.');
  return toQuiz(row as unknown as QuizRow);
}

/** Load a quiz only if the caller may access it. */
export async function getQuizForUser(
  id: string,
  ownerId: string,
  isAdmin: boolean,
): Promise<Quiz & { ownerId: string | null }> {
  const row = await prisma.quiz.findUnique({ where: { id }, include: WITH_QUESTIONS });
  if (!row) throw notFound('Quiz not found.');
  if (!isAdmin && row.ownerId !== null && row.ownerId !== ownerId) {
    throw notFound('Quiz not found.');
  }
  return { ...toQuiz(row as unknown as QuizRow), ownerId: row.ownerId };
}

/**
 * Create a quiz. Question ids are generated when missing so the client may send
 * questions without ids.
 */
export async function createQuiz(ownerId: string, input: Partial<Quiz>): Promise<Quiz> {
  const quiz: Quiz = {
    id: input.id ?? randomUUID(),
    title: input.title ?? '',
    description: input.description ?? '',
    theme: input.theme ?? 'standard',
    defaultTimeLimit: input.defaultTimeLimit ?? 20,
    category: label(input.category),
    difficulty: label(input.difficulty),
    questions: (input.questions ?? []).map((question) => ({
      ...question,
      id: question.id || randomUUID(),
    })),
  };
  assertValid(quiz);

  const row = await prisma.quiz.create({
    data: {
      id: quiz.id,
      ownerId,
      title: quiz.title,
      description: quiz.description,
      theme: quiz.theme,
      defaultTimeLimit: quiz.defaultTimeLimit,
      category: quiz.category ?? null,
      difficulty: quiz.difficulty ?? null,
      questions: {
        create: quiz.questions.map((question, position) => {
          const { payload, ...rest } = fromQuestion(question);
          return {
            id: question.id,
            position,
            ...rest,
            payload: payload as Prisma.InputJsonValue,
          };
        }),
      },
    },
    include: WITH_QUESTIONS,
  });
  return toQuiz(row as unknown as QuizRow);
}

/**
 * Replace a quiz's metadata and its entire question list.
 *
 * Questions are replaced inside one transaction. That is safe for history
 * because a started game reads its questions from its own `GameSnapshot`, which
 * was frozen when the run began – editing a quiz can no longer alter a finished
 * report (Phase 6.4, R-3).
 */
export async function updateQuiz(
  id: string,
  ownerId: string,
  isAdmin: boolean,
  input: Partial<Quiz>,
): Promise<Quiz> {
  const existing = await prisma.quiz.findUnique({ where: { id } });
  if (!existing) throw notFound('Quiz not found.');
  if (!isAdmin && existing.ownerId !== null && existing.ownerId !== ownerId) {
    throw notFound('Quiz not found.');
  }

  const current = await getQuiz(id);
  const quiz: Quiz = {
    id,
    title: input.title ?? current.title,
    description: input.description ?? current.description,
    theme: input.theme ?? current.theme,
    defaultTimeLimit: input.defaultTimeLimit ?? current.defaultTimeLimit,
    category: label(input.category ?? current.category),
    difficulty: label(input.difficulty ?? current.difficulty),
    questions: (input.questions ?? current.questions).map((question) => ({
      ...question,
      id: question.id || randomUUID(),
    })),
  };
  assertValid(quiz);

  await prisma.$transaction(async (tx) => {
    await tx.quiz.update({
      where: { id },
      data: {
        title: quiz.title,
        description: quiz.description,
        theme: quiz.theme,
        defaultTimeLimit: quiz.defaultTimeLimit,
        category: quiz.category ?? null,
        difficulty: quiz.difficulty ?? null,
      },
    });
    if (input.questions) {
      await tx.question.deleteMany({ where: { quizId: id } });
      for (const [position, question] of quiz.questions.entries()) {
        const { payload, ...rest } = fromQuestion(question);
        await tx.question.create({
          data: {
            id: question.id,
            quizId: id,
            position,
            ...rest,
            payload: payload as Prisma.InputJsonValue,
          },
        });
      }
    }
  });

  return getQuiz(id);
}

/** Normalise an optional label: trim it, and treat "empty" as "not set". */
function label(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Delete a quiz.
 *
 * Phase 6.4: this no longer touches games. `games.quiz_id` is `ON DELETE SET
 * NULL`, and each started game keeps its questions in its own snapshot, so
 * deleting a quiz leaves every game and its history intact. The quiz's own
 * questions cascade away with it (nothing else references them).
 */
export async function deleteQuiz(id: string, ownerId: string, isAdmin: boolean): Promise<void> {
  const existing = await prisma.quiz.findUnique({ where: { id } });
  if (!existing) throw notFound('Quiz not found.');
  if (!isAdmin && existing.ownerId !== null && existing.ownerId !== ownerId) {
    throw notFound('Quiz not found.');
  }
  await prisma.quiz.delete({ where: { id } });
}

/** Duplicate a quiz, including all questions, under a new title. */
export async function duplicateQuiz(id: string, ownerId: string, isAdmin: boolean): Promise<Quiz> {
  const source = await getQuizForUser(id, ownerId, isAdmin);
  return createQuiz(ownerId, {
    title: `${source.title} (copy)`,
    description: source.description,
    theme: source.theme,
    defaultTimeLimit: source.defaultTimeLimit,
    category: source.category,
    difficulty: source.difficulty,
    questions: source.questions.map((question) => ({ ...question, id: randomUUID() })),
  });
}

/** Count quizzes owned by a user (used by the admin overview). */
export async function countQuizzes(ownerId: string): Promise<number> {
  return prisma.quiz.count({ where: { ownerId } });
}
