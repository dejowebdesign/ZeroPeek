/**
 * Integration tests for the REST API against a real PostgreSQL.
 *
 * Skipped automatically when no database is reachable (see testing/db.ts).
 * Covers the Phase 2 surface end to end: login, CSRF enforcement, quiz CRUD
 * with validation, ownership, admin user management and the last-admin guard.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import type { Quiz } from '@zeropeek/shared';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './db.js';
import { createUser } from './services/userService.js';
import { canConnect, resetDatabase } from './testing/db.js';

const available = await canConnect();

/** A minimal valid quiz payload. */
function quizPayload(overrides: Partial<Quiz> = {}): Partial<Quiz> {
  return {
    title: 'Geography',
    description: 'Capitals',
    theme: 'standard',
    defaultTimeLimit: 20,
    questions: [
      {
        id: 'q1',
        type: 'single',
        text: 'Capital of France?',
        timeLimit: 20,
        points: 'standard',
        options: ['Paris', 'Rome', 'Madrid'],
        correctIndex: 0,
      },
      {
        id: 'q2',
        type: 'trueFalse',
        text: 'The Nile is the longest river.',
        timeLimit: 15,
        points: 'standard',
        correct: true,
      },
    ],
    ...overrides,
  };
}

describe.skipIf(!available)('REST API integration', () => {
  let app: FastifyInstance;
  let cookie = '';
  let csrf = '';

  beforeAll(async () => {
    app = await buildApp({ config: loadConfig({ NODE_ENV: 'test', COOKIE_SECURE: 'false' }) });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createUser({ username: 'trainer', password: 'correct-horse-battery', role: 'TRAINER' });
    await createUser({ username: 'root', password: 'correct-horse-battery', role: 'ADMIN' });
    cookie = '';
    csrf = '';

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'trainer', password: 'correct-horse-battery' },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers['set-cookie'];
    cookie = (Array.isArray(setCookie) ? setCookie[0] : String(setCookie)).split(';')[0]!;
    csrf = login.json().csrfToken;
  });

  /** An authenticated request helper. The CSRF header is always sent, since
   * state-changing routes without a body (DELETE, duplicate) need it too. */
  const as = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: { cookie, 'x-csrf-token': csrf },
      ...(payload === undefined ? {} : { payload }),
    });

  describe('authentication', () => {
    it('rejects wrong credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'trainer', password: 'nope' },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('unauthorized');
    });

    it('reports the current session', async () => {
      const response = await as('GET', '/api/auth/me');
      expect(response.statusCode).toBe(200);
      expect(response.json().user.username).toBe('trainer');
      expect(response.json().csrfToken).toBe(csrf);
    });

    it('requires a session for protected routes', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/quizzes' });
      expect(response.statusCode).toBe(401);
    });

    it('does not leak the password hash', async () => {
      const response = await as('GET', '/api/auth/me');
      expect(JSON.stringify(response.json())).not.toContain('passwordHash');
      expect(JSON.stringify(response.json())).not.toContain('argon2');
    });
  });

  describe('CSRF', () => {
    it('rejects a write without a CSRF token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/quizzes',
        headers: { cookie },
        payload: quizPayload(),
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('forbidden');
    });

    it('rejects a write with a wrong CSRF token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/quizzes',
        headers: { cookie, 'x-csrf-token': 'not-the-token' },
        payload: quizPayload(),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('quiz CRUD', () => {
    it('creates, reads, updates and deletes a quiz', async () => {
      const created = await as('POST', '/api/quizzes', quizPayload());
      expect(created.statusCode).toBe(200);
      const quiz = created.json() as Quiz;
      expect(quiz.questions).toHaveLength(2);
      expect(quiz.questions[0]!.type).toBe('single');

      const read = await as('GET', `/api/quizzes/${quiz.id}`);
      expect(read.statusCode).toBe(200);
      expect(read.json().title).toBe('Geography');

      const updated = await as('PUT', `/api/quizzes/${quiz.id}`, {
        title: 'Geography II',
        questions: [quizPayload().questions![0]],
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().title).toBe('Geography II');
      expect(updated.json().questions).toHaveLength(1);

      const removed = await as('DELETE', `/api/quizzes/${quiz.id}`);
      expect(removed.statusCode).toBe(200);

      const gone = await as('GET', `/api/quizzes/${quiz.id}`);
      expect(gone.statusCode).toBe(404);
    });

    it('lists quizzes with a question count', async () => {
      await as('POST', '/api/quizzes', quizPayload());
      const list = await as('GET', '/api/quizzes');
      expect(list.json().quizzes).toHaveLength(1);
      expect(list.json().quizzes[0].questionCount).toBe(2);
    });

    it('rejects an invalid quiz with field-level issues', async () => {
      const invalid = quizPayload({
        questions: [
          {
            id: 'bad',
            type: 'single',
            text: 'Pick',
            timeLimit: 20,
            points: 'standard',
            options: ['a', 'b'],
            correctIndex: 7,
          },
        ],
      });
      const response = await as('POST', '/api/quizzes', invalid);
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('invalid');
      expect(response.json().error.issues[0].path).toContain('correctIndex');
    });

    it('rejects a question with more than four options on create', async () => {
      const invalid = quizPayload({
        questions: [
          {
            id: 'wide',
            type: 'single',
            text: 'Pick one',
            timeLimit: 20,
            points: 'standard',
            options: ['a', 'b', 'c', 'd', 'e'],
            correctIndex: 0,
          },
        ],
      });
      const response = await as('POST', '/api/quizzes', invalid);
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('invalid');
      expect(response.json().error.issues[0].path).toContain('options');
    });

    it('rejects a question with more than four options on update', async () => {
      const created = await as('POST', '/api/quizzes', quizPayload());
      const id = created.json().id;
      const response = await as('PUT', `/api/quizzes/${id}`, {
        title: 'Geography',
        description: 'Capitals',
        theme: 'standard',
        defaultTimeLimit: 20,
        questions: [
          {
            id: 'q1',
            type: 'single',
            text: 'Capital of France?',
            timeLimit: 20,
            points: 'standard',
            options: ['Paris', 'Rome', 'Madrid', 'Berlin', 'Lisbon'],
            correctIndex: 0,
          },
        ],
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.issues[0].path).toContain('options');
    });

    it('rejects an imported quiz with more than four options per question', async () => {
      const response = await as(
        'POST',
        '/api/quizzes/import',
        quizPayload({
          questions: [
            {
              id: 'q1',
              type: 'single',
              text: 'Pick one',
              timeLimit: 20,
              points: 'standard',
              options: ['a', 'b', 'c', 'd', 'e'],
              correctIndex: 0,
            },
          ],
        }),
      );
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('invalid');
    });

    it('accepts a question with exactly four options', async () => {
      const valid = quizPayload({
        questions: [
          {
            id: 'q1',
            type: 'single',
            text: 'Pick one',
            timeLimit: 20,
            points: 'standard',
            options: ['a', 'b', 'c', 'd'],
            correctIndex: 3,
          },
        ],
      });
      const response = await as('POST', '/api/quizzes', valid);
      expect(response.statusCode).toBe(200);
      expect(response.json().questions[0].options).toHaveLength(4);
    });

    it('stores every one of the 13 question types and reads them back', async () => {
      const questions = ALL_TYPES.map((question, index) => ({ ...question, id: `t${index}` }));
      const created = await as('POST', '/api/quizzes', quizPayload({ questions }));
      expect(created.statusCode).toBe(200);
      const roundTripped = created.json() as Quiz;
      expect(roundTripped.questions.map((q) => q.type)).toEqual(ALL_TYPES.map((q) => q.type));
      // The type-specific payload must survive the JSONB round trip.
      expect(roundTripped.questions).toEqual(questions);
    });

    it('duplicates a quiz with fresh ids', async () => {
      const created = await as('POST', '/api/quizzes', quizPayload());
      const id = created.json().id;
      const copy = await as('POST', `/api/quizzes/${id}/duplicate`);
      expect(copy.statusCode).toBe(200);
      expect(copy.json().id).not.toBe(id);
      expect(copy.json().title).toContain('(copy)');
    });

    it('exports a quiz as a JSON document', async () => {
      const created = await as('POST', '/api/quizzes', quizPayload());
      const id = created.json().id;
      const exported = await as('GET', `/api/quizzes/${id}/export`);
      expect(exported.statusCode).toBe(200);
      expect(exported.headers['content-disposition']).toContain('attachment');
      expect(JSON.parse(exported.body).questions).toHaveLength(2);
    });

    it("hides another trainer's quiz", async () => {
      await createUser({ username: 'other', password: 'correct-horse-battery', role: 'TRAINER' });
      const created = await as('POST', '/api/quizzes', quizPayload());
      const id = created.json().id;

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'other', password: 'correct-horse-battery' },
      });
      const otherCookie = String(login.headers['set-cookie']).split(';')[0] ?? '';
      const response = await app.inject({
        method: 'GET',
        url: `/api/quizzes/${id}`,
        headers: { cookie: otherCookie },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('admin', () => {
    const asAdmin = async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'root', password: 'correct-horse-battery' },
      });
      const adminCookie = String(login.headers['set-cookie']).split(';')[0]!;
      const adminCsrf = login.json().csrfToken as string;
      return (method: 'GET' | 'POST', url: string, payload?: unknown) =>
        app.inject({
          method,
          url,
          headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf },
          ...(payload === undefined ? {} : { payload }),
        });
    };

    it('forbids a trainer from the admin routes', async () => {
      const response = await as('GET', '/api/admin/users');
      expect(response.statusCode).toBe(403);
    });

    it('lets an admin create and list users', async () => {
      const admin = await asAdmin();
      const created = await admin('POST', '/api/admin/users', {
        username: 'newbie',
        password: 'a-long-enough-password',
        role: 'TRAINER',
      });
      expect(created.statusCode).toBe(200);
      const list = await admin('GET', '/api/admin/users');
      expect(list.json().users.map((u: { username: string }) => u.username)).toContain('newbie');
    });

    it('refuses to disable the last administrator', async () => {
      const admin = await asAdmin();
      const me = await admin('GET', '/api/auth/me');
      const response = await admin('POST', `/api/admin/users/${me.json().user.id}/disabled`, {
        disabled: true,
      });
      expect(response.statusCode).toBe(409);
    });

    it('refuses to let an admin disable their own account (P10)', async () => {
      // A second admin exists, so the last-admin rule does not apply. The
      // self-disable rule must still refuse, on the server, not only in the UI.
      await createUser({
        username: 'root2',
        password: 'correct-horse-battery',
        role: 'ADMIN',
      });
      const admin = await asAdmin();
      const me = await admin('GET', '/api/auth/me');
      const response = await admin('POST', `/api/admin/users/${me.json().user.id}/disabled`, {
        disabled: true,
      });
      expect(response.statusCode).toBe(403);
      // The account is untouched.
      const list = await admin('GET', '/api/admin/users');
      const self = list.json().users.find((u: { id: string }) => u.id === me.json().user.id);
      expect(self.disabled).toBe(false);
    });

    it('lets an admin disable another administrator', async () => {
      const other = await createUser({
        username: 'root2',
        password: 'correct-horse-battery',
        role: 'ADMIN',
      });
      const admin = await asAdmin();
      const response = await admin('POST', `/api/admin/users/${other.id}/disabled`, {
        disabled: true,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().disabled).toBe(true);
    });

    it('lets an admin disable and re-enable a normal user', async () => {
      const target = await createUser({
        username: 'plain',
        password: 'correct-horse-battery',
        role: 'TRAINER',
      });
      const admin = await asAdmin();

      const disabled = await admin('POST', `/api/admin/users/${target.id}/disabled`, {
        disabled: true,
      });
      expect(disabled.statusCode).toBe(200);
      expect(disabled.json().disabled).toBe(true);

      const enabled = await admin('POST', `/api/admin/users/${target.id}/disabled`, {
        disabled: false,
      });
      expect(enabled.statusCode).toBe(200);
      expect(enabled.json().disabled).toBe(false);
    });

    it('refuses to let an admin strip their own admin role', async () => {
      // With a second admin present the last-admin rule is satisfied, so this
      // exercises the self-demotion guard specifically.
      await createUser({
        username: 'root2',
        password: 'correct-horse-battery',
        role: 'ADMIN',
      });
      const admin = await asAdmin();
      const me = await admin('GET', '/api/auth/me');
      const response = await admin('POST', `/api/admin/users/${me.json().user.id}/role`, {
        role: 'TRAINER',
      });
      expect(response.statusCode).toBe(403);
    });

    it('accepts PLAYER as a target role and shows it back', async () => {
      const target = await createUser({
        username: 'gamer',
        password: 'correct-horse-battery',
        role: 'TRAINER',
      });
      const admin = await asAdmin();
      const response = await admin('POST', `/api/admin/users/${target.id}/role`, {
        role: 'PLAYER',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().role).toBe('PLAYER');
    });

    it('refuses to demote the last administrator to PLAYER', async () => {
      // The last-admin rule must hold for the new PLAYER target too, not only
      // for TRAINER, or an installation could lose its only admin.
      const admin = await asAdmin();
      const me = await admin('GET', '/api/auth/me');
      const response = await admin('POST', `/api/admin/users/${me.json().user.id}/role`, {
        role: 'PLAYER',
      });
      expect(response.statusCode).toBe(409);
    });

    it('rejects an unknown role', async () => {
      const target = await createUser({
        username: 'gamer',
        password: 'correct-horse-battery',
        role: 'TRAINER',
      });
      const admin = await asAdmin();
      const response = await admin('POST', `/api/admin/users/${target.id}/role`, {
        role: 'SUPERUSER',
      });
      expect(response.statusCode).toBe(400);
    });

    it('creates a user as PLAYER when no role is given', async () => {
      // Least privilege: an omitted role must not produce staff.
      const admin = await asAdmin();
      const created = await admin('POST', '/api/admin/users', {
        username: 'no-role',
        password: 'a-long-enough-password',
      });
      expect(created.statusCode).toBe(200);
      expect(created.json().role).toBe('PLAYER');
    });

    it('defaults a user created without a role to PLAYER at the service level', async () => {
      const user = await createUser({
        username: 'service-default',
        password: 'correct-horse-battery',
      });
      expect(user.role).toBe('PLAYER');
    });

    describe('e-mail confirmation', () => {
      it('lets an admin confirm a single unconfirmed account', async () => {
        const player = await createUser({
          username: 'maya',
          password: 'correct-horse-battery',
          email: 'maya@example.com',
          role: 'PLAYER',
          emailVerifiedAt: null,
        });
        const admin = await asAdmin();
        const response = await admin('POST', `/api/admin/users/${player.id}/verified`, {});
        expect(response.statusCode).toBe(200);
        expect(response.json().emailVerifiedAt).not.toBeNull();
      });

      it('is idempotent and keeps the original confirmation time', async () => {
        const first = new Date('2026-01-02T03:04:05.000Z');
        const player = await createUser({
          username: 'maya',
          password: 'correct-horse-battery',
          email: 'maya@example.com',
          role: 'PLAYER',
          emailVerifiedAt: first,
        });
        const admin = await asAdmin();
        const response = await admin('POST', `/api/admin/users/${player.id}/verified`, {});
        expect(response.statusCode).toBe(200);
        expect(new Date(response.json().emailVerifiedAt).toISOString()).toBe(first.toISOString());
      });

      it('does not touch any other account', async () => {
        const target = await createUser({
          username: 'maya',
          password: 'correct-horse-battery',
          email: 'maya@example.com',
          role: 'PLAYER',
          emailVerifiedAt: null,
        });
        await createUser({
          username: 'other',
          password: 'correct-horse-battery',
          email: 'other@example.com',
          role: 'PLAYER',
          emailVerifiedAt: null,
        });
        const admin = await asAdmin();
        await admin('POST', `/api/admin/users/${target.id}/verified`, {});
        const list = await admin('GET', '/api/admin/users');
        const other = list.json().users.find((u: { username: string }) => u.username === 'other');
        expect(other.emailVerifiedAt).toBeNull();
      });

      it('leaves the role, password and session state untouched', async () => {
        const player = await createUser({
          username: 'maya',
          password: 'correct-horse-battery',
          email: 'maya@example.com',
          role: 'PLAYER',
          emailVerifiedAt: null,
        });
        const before = await prisma.user.findUniqueOrThrow({ where: { id: player.id } });
        const admin = await asAdmin();
        await admin('POST', `/api/admin/users/${player.id}/verified`, {});
        const after = await prisma.user.findUniqueOrThrow({ where: { id: player.id } });
        expect(after.role).toBe(before.role);
        expect(after.passwordHash).toBe(before.passwordHash);
        expect(after.disabled).toBe(before.disabled);
      });

      it('lets a confirmed player sign in afterwards', async () => {
        const player = await createUser({
          username: 'maya',
          password: 'correct-horse-battery',
          email: 'maya@example.com',
          role: 'PLAYER',
          emailVerifiedAt: null,
        });
        const blocked = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'maya', password: 'correct-horse-battery' },
        });
        expect(blocked.statusCode).toBe(403);

        const admin = await asAdmin();
        await admin('POST', `/api/admin/users/${player.id}/verified`, {});

        const allowed = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'maya', password: 'correct-horse-battery' },
        });
        expect(allowed.statusCode).toBe(200);
      });

      it('can be reversed with verified:false', async () => {
        const player = await createUser({
          username: 'maya',
          password: 'correct-horse-battery',
          email: 'maya@example.com',
          role: 'PLAYER',
          emailVerifiedAt: null,
        });
        const admin = await asAdmin();
        await admin('POST', `/api/admin/users/${player.id}/verified`, {});
        const cleared = await admin('POST', `/api/admin/users/${player.id}/verified`, {
          verified: false,
        });
        expect(cleared.statusCode).toBe(200);
        expect(cleared.json().emailVerifiedAt).toBeNull();
      });

      it('forbids a trainer (non-admin) from confirming', async () => {
        const player = await createUser({
          username: 'maya',
          password: 'correct-horse-battery',
          email: 'maya@example.com',
          role: 'PLAYER',
          emailVerifiedAt: null,
        });
        // `as` uses the trainer session established in beforeEach.
        const response = await as('POST', `/api/admin/users/${player.id}/verified`, {});
        expect(response.statusCode).toBe(403);
        const after = await prisma.user.findUniqueOrThrow({ where: { id: player.id } });
        expect(after.emailVerifiedAt).toBeNull();
      });

      it('requires a session', async () => {
        const player = await createUser({
          username: 'maya',
          password: 'correct-horse-battery',
          email: 'maya@example.com',
          role: 'PLAYER',
          emailVerifiedAt: null,
        });
        const response = await app.inject({
          method: 'POST',
          url: `/api/admin/users/${player.id}/verified`,
          headers: { 'x-csrf-token': 'irrelevant' },
          payload: {},
        });
        expect(response.statusCode).toBe(401);
      });

      it('requires the CSRF token', async () => {
        const player = await createUser({
          username: 'maya',
          password: 'correct-horse-battery',
          email: 'maya@example.com',
          role: 'PLAYER',
          emailVerifiedAt: null,
        });
        const login = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'root', password: 'correct-horse-battery' },
        });
        const adminCookie = String(login.headers['set-cookie']).split(';')[0]!;
        const response = await app.inject({
          method: 'POST',
          url: `/api/admin/users/${player.id}/verified`,
          headers: { cookie: adminCookie },
          payload: {},
        });
        expect(response.statusCode).toBe(403);
        const after = await prisma.user.findUniqueOrThrow({ where: { id: player.id } });
        expect(after.emailVerifiedAt).toBeNull();
      });

      it('answers 404 for an unknown account', async () => {
        const admin = await asAdmin();
        const response = await admin(
          'POST',
          '/api/admin/users/00000000-0000-0000-0000-000000000000/verified',
          {},
        );
        expect(response.statusCode).toBe(404);
      });
    });
  });
});

/** One valid question of every type, used by the round-trip test. */
const ALL_TYPES = [
  {
    id: 'x',
    type: 'single',
    text: 'Single',
    timeLimit: 20,
    points: 'standard',
    options: ['a', 'b'],
    correctIndex: 1,
  },
  {
    id: 'x',
    type: 'trueFalse',
    text: 'TF',
    timeLimit: 10,
    points: 'standard',
    correct: false,
  },
  {
    id: 'x',
    type: 'multiple',
    text: 'Multi',
    timeLimit: 30,
    points: 'double',
    options: ['a', 'b', 'c'],
    correctIndices: [0, 2],
  },
  {
    id: 'x',
    type: 'text',
    text: 'Text',
    timeLimit: 30,
    points: 'standard',
    accepted: ['Paris', 'paris'],
  },
  {
    id: 'x',
    type: 'slider',
    text: 'Slider',
    timeLimit: 30,
    points: 'standard',
    min: 0,
    max: 10,
    step: 1,
    answer: 5,
    tolerance: 1,
    unit: 'kg',
  },
  {
    id: 'x',
    type: 'order',
    text: 'Order',
    timeLimit: 45,
    points: 'standard',
    items: ['a', 'b', 'c'],
  },
  { id: 'x', type: 'poll', text: 'Poll', timeLimit: 20, points: 'none', options: ['a', 'b'] },
  { id: 'x', type: 'wordCloud', text: 'Cloud', timeLimit: 30, points: 'none', maxLength: 30 },
  { id: 'x', type: 'open', text: 'Open', timeLimit: 60, points: 'none', maxLength: 400 },
  {
    id: 'x',
    type: 'scale',
    text: 'Scale',
    timeLimit: 20,
    points: 'none',
    steps: 5,
    lowLabel: 'low',
    highLabel: 'high',
  },
  {
    id: 'x',
    type: 'nps',
    text: 'NPS',
    timeLimit: 20,
    points: 'none',
    lowLabel: 'no',
    highLabel: 'yes',
  },
  { id: 'x', type: 'slide', text: 'Slide', timeLimit: 20, points: 'none', body: 'Body text' },
  {
    id: 'x',
    type: 'ideas',
    text: 'Ideas',
    timeLimit: 90,
    points: 'none',
    maxIdeas: 5,
    maxVotes: 3,
  },
] as unknown as Quiz['questions'];
