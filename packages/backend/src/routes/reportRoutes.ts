/**
 * Report routes: game list, per-game report, quiz statistics and CSV exports.
 */

import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config.js';
import { currentUser, requireAuth } from '../sessions.js';
import {
  exportAnswersCsv,
  exportRankingCsv,
  gameReport,
  listGames,
  quizStatistics,
} from '../services/reportService.js';

function csv(reply: { header: (k: string, v: string) => unknown }, filename: string): void {
  reply.header('Content-Type', 'text/csv; charset=utf-8');
  reply.header('Content-Disposition', `attachment; filename="${filename}"`);
}

export function registerReportRoutes(app: FastifyInstance, config: AppConfig): void {
  const guard = { preHandler: requireAuth(config) };

  app.get<{ Querystring: { quizId?: string } }>('/api/reports/games', guard, async (request) => {
    currentUser(request);
    return { games: await listGames({ quizId: request.query.quizId }) };
  });

  app.get<{ Params: { id: string } }>('/api/reports/games/:id', guard, async (request) => {
    currentUser(request);
    return gameReport(request.params.id);
  });

  app.get<{ Params: { id: string } }>(
    '/api/reports/games/:id/answers.csv',
    guard,
    async (request, reply) => {
      currentUser(request);
      csv(reply, `zeropeek-game-${request.params.id}-answers.csv`);
      return exportAnswersCsv(request.params.id);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/reports/games/:id/ranking.csv',
    guard,
    async (request, reply) => {
      currentUser(request);
      csv(reply, `zeropeek-game-${request.params.id}-ranking.csv`);
      return exportRankingCsv(request.params.id);
    },
  );

  app.get<{ Params: { id: string } }>('/api/reports/quizzes/:id', guard, async (request) => {
    currentUser(request);
    return quizStatistics(request.params.id);
  });
}
