/**
 * Quiz CRUD routes.
 *
 * All routes require a staff session (ADMIN or TRAINER); writes additionally
 * require a CSRF token (see `requireStaff`). Ownership is enforced in the
 * service, so a trainer can only read and change their own quizzes.
 */

import type { FastifyInstance } from 'fastify';

import type { Quiz } from '@zeropeek/shared';

import type { AppConfig } from '../config.js';
import { currentUser, requireStaff } from '../sessions.js';
import {
  createQuiz,
  deleteQuiz,
  duplicateQuiz,
  getQuizForUser,
  listQuizzes,
  updateQuiz,
} from '../services/quizService.js';

export function registerQuizRoutes(app: FastifyInstance, config: AppConfig): void {
  const guard = { preHandler: requireStaff(config) };

  app.get('/api/quizzes', guard, async (request) => {
    const user = currentUser(request);
    const rows = await listQuizzes(user.id, user.role === 'ADMIN');
    return {
      quizzes: rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        theme: row.theme,
        questionCount: row._count.questions,
        updatedAt: row.updatedAt,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/quizzes/:id', guard, async (request) => {
    const user = currentUser(request);
    return getQuizForUser(request.params.id, user.id, user.role === 'ADMIN');
  });

  app.post<{ Body: Partial<Quiz> }>('/api/quizzes', guard, async (request) => {
    const user = currentUser(request);
    return createQuiz(user.id, request.body);
  });

  app.put<{ Params: { id: string }; Body: Partial<Quiz> }>(
    '/api/quizzes/:id',
    guard,
    async (request) => {
      const user = currentUser(request);
      return updateQuiz(request.params.id, user.id, user.role === 'ADMIN', request.body);
    },
  );

  app.delete<{ Params: { id: string } }>('/api/quizzes/:id', guard, async (request) => {
    const user = currentUser(request);
    await deleteQuiz(request.params.id, user.id, user.role === 'ADMIN');
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/quizzes/:id/duplicate', guard, async (request) => {
    const user = currentUser(request);
    return duplicateQuiz(request.params.id, user.id, user.role === 'ADMIN');
  });

  /** Export a quiz as a JSON document for backup or transfer. */
  app.get<{ Params: { id: string } }>('/api/quizzes/:id/export', guard, async (request, reply) => {
    const user = currentUser(request);
    const quiz = await getQuizForUser(request.params.id, user.id, user.role === 'ADMIN');
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="zeropeek-quiz-${quiz.id}.json"`);
    return quiz;
  });

  /** Import a quiz from a previously exported document. */
  app.post<{ Body: Partial<Quiz> }>('/api/quizzes/import', guard, async (request) => {
    const user = currentUser(request);
    return createQuiz(user.id, request.body);
  });
}
