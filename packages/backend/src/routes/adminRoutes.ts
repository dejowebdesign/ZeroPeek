/**
 * Administration routes: user management (ADMIN only).
 *
 * Every route is guarded by `requireAdmin`, which itself enforces the session
 * and the CSRF token. Two lock-out rules are enforced here, never only in the
 * UI: the last active admin cannot be disabled or demoted, and an admin can
 * never disable their own account or strip their own admin role.
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
  setEmailVerified,
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
      // Least privilege: an omitted role means PLAYER, matching the schema
      // default. The admin UI always sends the role explicitly.
      role: body.role ?? 'PLAYER',
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
      // The last administrator is checked first so that disabling the only admin
      // reports the more specific reason (409). A sole admin is also the current
      // user, and both rules would apply.
      if (disabled && target.role === 'ADMIN' && (await countAdmins()) <= 1) {
        throw conflict('The last administrator cannot be disabled.');
      }
      // An administrator must never disable their own account. The UI hides the
      // control too, but that is only a convenience: the rule has to hold on the
      // server, so a direct API call is refused as well. Without it an admin
      // could lock themselves out whenever a second admin happens to exist.
      if (disabled && target.id === currentUser(request).id) {
        throw forbidden('You cannot disable your own account.');
      }
      return setDisabled(request.params.id, disabled);
    },
  );

  app.post<{ Params: { id: string }; Body: { role?: UserRole } }>(
    '/api/admin/users/:id/role',
    guard,
    async (request) => {
      const role = request.body?.role;
      if (role !== 'ADMIN' && role !== 'TRAINER' && role !== 'PLAYER') {
        throw badRequest('Unknown role.');
      }
      const target = await getUser(request.params.id);
      // Any demotion of the only administrator is refused, whether to TRAINER or
      // to PLAYER; otherwise the installation could be left without an admin.
      if (target.role === 'ADMIN' && role !== 'ADMIN' && (await countAdmins()) <= 1) {
        throw conflict('The last administrator cannot be demoted.');
      }
      if (target.id === currentUser(request).id && role !== 'ADMIN') {
        throw forbidden('You cannot remove your own administrator role.');
      }
      return setRole(request.params.id, role);
    },
  );

  /**
   * Confirm a single account's e-mail address. This is the deliberate manual
   * escape hatch for an account whose confirmation mail could not be delivered
   * (e.g. before SMTP is configured). It is ADMIN only and writes only
   * `emailVerifiedAt` on the one named account — never a role, password, session
   * or game datum, and never a bulk operation.
   *
   * The body is optional and defaults to `{ verified: true }`; `verified: false`
   * clears the timestamp, so the action stays reversible.
   */
  app.post<{ Params: { id: string }; Body: { verified?: boolean } }>(
    '/api/admin/users/:id/verified',
    guard,
    async (request) => {
      const verified = request.body?.verified ?? true;
      if (typeof verified !== 'boolean') throw badRequest('`verified` must be a boolean.');
      return setEmailVerified(request.params.id, verified);
    },
  );
}
