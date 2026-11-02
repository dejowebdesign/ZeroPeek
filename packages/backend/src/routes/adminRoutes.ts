/**
 * Administration routes: user management (ADMIN only).
 *
 * Every route is guarded by `requireAdmin`, which itself enforces the session
 * and the CSRF token. The last active admin cannot be disabled or demoted, so
 * an installation can never lock itself out.
 */

import type { FastifyInstance } from 'fastify';

import type { UserRole } from '@prisma/client';

import type { AppConfig } from '../config.js';
import { badRequest, conflict, forbidden } from '../errors.js';
import {
  countAdmins,
  createUser,
  getUser,
  listUsers,
  setDisabled,
  setPassword,
  setRole,
} from '../services/userService.js';
import { currentUser, requireAdmin } from '../sessions.js';

interface CreateUserBody {
  username?: string;
  password?: string;
  email?: string | null;
  role?: UserRole;
}

export function registerAdminRoutes(app: FastifyInstance, config: AppConfig): void {
  const guard = { preHandler: requireAdmin(config) };

  app.get('/api/admin/users', guard, async () => ({ users: await listUsers() }));

  app.post<{ Body: CreateUserBody }>('/api/admin/users', guard, async (request) => {
    const body = request.body ?? {};
    if (typeof body.username !== 'string' || typeof body.password !== 'string') {
      throw badRequest('A username and password are required.');
    }
    return createUser({
      username: body.username,
      password: body.password,
      email: body.email ?? null,
      role: body.role ?? 'TRAINER',
    });
  });

  app.post<{ Params: { id: string }; Body: { password?: string } }>(
    '/api/admin/users/:id/password',
    guard,
    async (request) => {
      const password = request.body?.password;
      if (typeof password !== 'string') throw badRequest('A new password is required.');
      await setPassword(request.params.id, password);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { disabled?: boolean } }>(
    '/api/admin/users/:id/disabled',
    guard,
    async (request) => {
      const disabled = request.body?.disabled;
      if (typeof disabled !== 'boolean') throw badRequest('`disabled` must be a boolean.');
      const target = await getUser(request.params.id);
      if (disabled && target.role === 'ADMIN' && (await countAdmins()) <= 1) {
        throw conflict('The last administrator cannot be disabled.');
      }
      return setDisabled(request.params.id, disabled);
    },
  );

  app.post<{ Params: { id: string }; Body: { role?: UserRole } }>(
    '/api/admin/users/:id/role',
    guard,
    async (request) => {
      const role = request.body?.role;
      if (role !== 'ADMIN' && role !== 'TRAINER') throw badRequest('Unknown role.');
      const target = await getUser(request.params.id);
      if (target.role === 'ADMIN' && role === 'TRAINER' && (await countAdmins()) <= 1) {
        throw conflict('The last administrator cannot be demoted.');
      }
      if (target.id === currentUser(request).id && role !== 'ADMIN') {
        throw forbidden('You cannot remove your own administrator role.');
      }
      return setRole(request.params.id, role);
    },
  );
}
