/**
 * Integration tests for the avatar configuration API (Phase 6.7) against a real
 * PostgreSQL. Skipped automatically when no database is reachable.
 *
 * The API is `PUT /api/profile/avatar`. The rules under test are the ones the
 * phase makes binding:
 *
 *   1. Authorisation — only the signed-in **player** may write, and only their
 *      own avatar; a host session and a missing CSRF token are refused.
 *   2. Character exclusivity — a payload that puts one character's item on
 *      another is rejected, in both directions, and nothing is written.
 *   3. Validation — an unknown character, an unknown item, a wrong slot, an
 *      unknown field or a non-object body is rejected with 422.
 *   4. Persistence — a valid configuration is stored, read back through
 *      `GET /api/profile`, and survives a fresh login.
 *   5. Backwards compatibility — a profile with no avatar configuration keeps
 *      working, and a character change activates the new character's defaults.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { defaultAvatarConfig } from '@zeropeek/shared';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './db.js';
import { createUser } from './services/userService.js';
import { canConnect, resetDatabase } from './testing/db.js';

const available = await canConnect();

describe.skipIf(!available)('avatar configuration integration', () => {
  let app: FastifyInstance;

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
  });

  /** Sign an account in as a **player**; returns its cookie, CSRF token and id. */
  async function signIn(
    username: string,
    role: 'PLAYER' | 'ADMIN' | 'TRAINER' = 'PLAYER',
  ): Promise<{ cookie: string; csrf: string; id: string }> {
    const user = await createUser({ username, password: 'correct-horse-battery', role });
    const url = role === 'PLAYER' ? '/api/player-auth/login' : '/api/auth/login';
    const login = await app.inject({
      method: 'POST',
      url,
      payload: { username, password: 'correct-horse-battery' },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers['set-cookie'];
    return {
      cookie: (Array.isArray(setCookie) ? setCookie[0] : String(setCookie)).split(';')[0]!,
      csrf: login.json().csrfToken,
      id: user.id,
    };
  }

  const as = (
    session: { cookie: string; csrf: string },
    method: 'GET' | 'PUT' | 'POST',
    url: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url,
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
      ...(payload === undefined ? {} : { payload }),
    });

  const MAYA_FULL = {
    characterId: 'maya',
    equipment: {
      visor: 'maya_visor',
      outfit: 'maya_outfit',
      backpack: 'maya_backpack',
      neckAccessory: 'maya_compass',
      wristAccessory: 'maya_wristband',
    },
  };

  describe('authorisation', () => {
    it('refuses an unauthenticated avatar write', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/profile/avatar',
        payload: MAYA_FULL,
      });
      expect(response.statusCode).toBe(401);
    });

    it('refuses a write without the CSRF token', async () => {
      const me = await signIn('alice');
      const response = await app.inject({
        method: 'PUT',
        url: '/api/profile/avatar',
        headers: { cookie: me.cookie },
        payload: MAYA_FULL,
      });
      expect(response.statusCode).toBe(403);
    });

    it('refuses a host (staff) session on the player avatar route', async () => {
      const staff = await signIn('staff', 'ADMIN');
      const response = await app.inject({
        method: 'PUT',
        url: '/api/profile/avatar',
        headers: { cookie: staff.cookie, 'x-csrf-token': staff.csrf },
        payload: MAYA_FULL,
      });
      expect(response.statusCode).toBe(401);
      // No profile is created for the staff account by this attempt.
      expect(await prisma.playerProfile.count({ where: { userId: staff.id } })).toBe(0);
    });

    it('never lets one account write another account’s avatar', async () => {
      const alice = await signIn('alice');
      const bob = await signIn('bob');

      await as(alice, 'PUT', '/api/profile/avatar', MAYA_FULL);
      // Bob writes his own; there is no userId parameter, so he cannot touch
      // Alice's row.
      await as(bob, 'PUT', '/api/profile/avatar', {
        characterId: 'ethan',
        equipment: defaultAvatarConfig('ethan').equipment,
      });

      const aliceRow = await prisma.playerProfile.findUnique({ where: { userId: alice.id } });
      const bobRow = await prisma.playerProfile.findUnique({ where: { userId: bob.id } });
      expect((aliceRow?.avatarConfig as { characterId?: string })?.characterId).toBe('maya');
      expect((bobRow?.avatarConfig as { characterId?: string })?.characterId).toBe('ethan');
    });
  });

  describe('saving and reading back', () => {
    it('stores a valid configuration and returns it', async () => {
      const alice = await signIn('alice');
      const write = await as(alice, 'PUT', '/api/profile/avatar', MAYA_FULL);
      expect(write.statusCode).toBe(200);
      expect(write.json()).toEqual(MAYA_FULL);

      const read = await as(alice, 'GET', '/api/profile');
      expect(read.json().profile.avatarConfig).toEqual(MAYA_FULL);
    });

    it('applies the character’s default kit when no equipment is sent', async () => {
      const alice = await signIn('alice');
      const write = await as(alice, 'PUT', '/api/profile/avatar', { characterId: 'ethan' });
      expect(write.statusCode).toBe(200);
      expect(write.json()).toEqual(defaultAvatarConfig('ethan'));
    });

    it('keeps the picker and the avatar editor in agreement', async () => {
      const alice = await signIn('alice');
      await as(alice, 'PUT', '/api/profile/avatar', MAYA_FULL);
      const read = await as(alice, 'GET', '/api/profile');
      // A valid avatar write also updates the canonical character choice.
      expect(read.json().profile.selectedCharacterId).toBe('maya');
      expect(read.json().profile.avatarConfig.characterId).toBe('maya');
    });

    it('persists the configuration across a fresh login', async () => {
      const alice = await signIn('alice');
      await as(alice, 'PUT', '/api/profile/avatar', MAYA_FULL);

      const again = await app.inject({
        method: 'POST',
        url: '/api/player-auth/login',
        payload: { username: 'alice', password: 'correct-horse-battery' },
      });
      const setCookie = again.headers['set-cookie'];
      const cookie = (Array.isArray(setCookie) ? setCookie[0] : String(setCookie)).split(';')[0]!;
      const read = await app.inject({
        method: 'GET',
        url: '/api/profile',
        headers: { cookie },
      });
      expect(read.json().profile.avatarConfig).toEqual(MAYA_FULL);
    });

    it('accepts a slot explicitly cleared to null', async () => {
      const alice = await signIn('alice');
      const write = await as(alice, 'PUT', '/api/profile/avatar', {
        characterId: 'ethan',
        equipment: { ...defaultAvatarConfig('ethan').equipment, visor: null },
      });
      expect(write.statusCode).toBe(200);
      expect(write.json().equipment.visor).toBeNull();
    });
  });

  describe('character exclusivity', () => {
    it('refuses an Ethan item on Maya', async () => {
      const alice = await signIn('alice');
      const response = await as(alice, 'PUT', '/api/profile/avatar', {
        characterId: 'maya',
        equipment: { ...MAYA_FULL.equipment, visor: 'ethan_visor' },
      });
      expect(response.statusCode).toBe(422);
      // Nothing was written by the rejected request.
      const read = await as(alice, 'GET', '/api/profile');
      expect(read.json().profile.avatarConfig).toBeNull();
    });

    it('refuses a Maya item on Ethan', async () => {
      const alice = await signIn('alice');
      const response = await as(alice, 'PUT', '/api/profile/avatar', {
        characterId: 'ethan',
        equipment: { visor: 'maya_visor' },
      });
      expect(response.statusCode).toBe(422);
    });

    it('refuses a whole foreign kit and reports every offending slot', async () => {
      const alice = await signIn('alice');
      const response = await as(alice, 'PUT', '/api/profile/avatar', {
        characterId: 'ethan',
        equipment: MAYA_FULL.equipment,
      });
      expect(response.statusCode).toBe(422);
      const issues = response.json().error.issues as Array<{ path: string }>;
      expect(issues.map((issue) => issue.path).sort()).toEqual([
        'equipment.backpack',
        'equipment.neckAccessory',
        'equipment.outfit',
        'equipment.visor',
        'equipment.wristAccessory',
      ]);
    });
  });

  describe('validation', () => {
    it('rejects an unknown character id', async () => {
      const alice = await signIn('alice');
      const response = await as(alice, 'PUT', '/api/profile/avatar', { characterId: 'nobody' });
      expect(response.statusCode).toBe(422);
    });

    it('rejects a character that has no artwork yet', async () => {
      const alice = await signIn('alice');
      const response = await as(alice, 'PUT', '/api/profile/avatar', { characterId: 'pixel' });
      expect(response.statusCode).toBe(422);
    });

    it('rejects an unknown item id', async () => {
      const alice = await signIn('alice');
      const response = await as(alice, 'PUT', '/api/profile/avatar', {
        characterId: 'ethan',
        equipment: { visor: 'ethan_hat' },
      });
      expect(response.statusCode).toBe(422);
    });

    it('rejects an item in the wrong slot', async () => {
      const alice = await signIn('alice');
      const response = await as(alice, 'PUT', '/api/profile/avatar', {
        characterId: 'ethan',
        equipment: { outfit: 'ethan_visor' },
      });
      expect(response.statusCode).toBe(422);
    });

    it('rejects an unknown slot', async () => {
      const alice = await signIn('alice');
      const response = await as(alice, 'PUT', '/api/profile/avatar', {
        characterId: 'ethan',
        equipment: { hat: 'ethan_visor' },
      });
      expect(response.statusCode).toBe(422);
    });

    it('rejects a smuggled extra field', async () => {
      const alice = await signIn('alice');
      const response = await as(alice, 'PUT', '/api/profile/avatar', {
        characterId: 'ethan',
        xp: 9999,
      });
      expect(response.statusCode).toBe(422);
    });

    it('rejects a non-object JSON body', async () => {
      const alice = await signIn('alice');
      const response = await as(alice, 'PUT', '/api/profile/avatar', []);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('backwards compatibility', () => {
    it('reports null for a profile that has never configured an avatar', async () => {
      const alice = await signIn('alice');
      const read = await as(alice, 'GET', '/api/profile');
      expect(read.statusCode).toBe(200);
      expect(read.json().profile.avatarConfig).toBeNull();
    });

    it('activates the new character’s default kit on a character change', async () => {
      const alice = await signIn('alice');
      // Start on Ethan, then switch to Maya through the picker endpoint.
      await as(alice, 'PUT', '/api/profile', { selectedCharacterId: 'ethan' });
      const switched = await as(alice, 'PUT', '/api/profile', {
        selectedCharacterId: 'maya',
      });
      expect(switched.statusCode).toBe(200);
      // The avatar now wears Maya's defaults, not Ethan's.
      const read = await as(alice, 'GET', '/api/profile');
      expect(read.json().profile.avatarConfig).toEqual(defaultAvatarConfig('maya'));
    });

    it('clears the avatar configuration when the character choice is cleared', async () => {
      const alice = await signIn('alice');
      await as(alice, 'PUT', '/api/profile/avatar', MAYA_FULL);
      const cleared = await as(alice, 'PUT', '/api/profile', { selectedCharacterId: null });
      expect(cleared.statusCode).toBe(200);
      const read = await as(alice, 'GET', '/api/profile');
      expect(read.json().profile.avatarConfig).toBeNull();
      expect(read.json().profile.selectedCharacterId).toBeNull();
    });

    it('leaves an account that predates the phase fully usable', async () => {
      // An account created without a profile stands in for one that existed
      // before Phase 6.7. The first read materialises a profile with no avatar,
      // and an avatar can then be configured.
      const user = await createUser({
        username: 'veteran',
        password: 'correct-horse-battery',
        role: 'PLAYER',
      });
      expect(await prisma.playerProfile.count({ where: { userId: user.id } })).toBe(0);

      const login = await app.inject({
        method: 'POST',
        url: '/api/player-auth/login',
        payload: { username: 'veteran', password: 'correct-horse-battery' },
      });
      const setCookie = login.headers['set-cookie'];
      const session = {
        cookie: (Array.isArray(setCookie) ? setCookie[0] : String(setCookie)).split(';')[0]!,
        csrf: login.json().csrfToken,
      };

      const read = await as(session, 'GET', '/api/profile');
      expect(read.statusCode).toBe(200);
      expect(read.json().profile.avatarConfig).toBeNull();

      const write = await as(session, 'PUT', '/api/profile/avatar', {
        characterId: 'ethan',
        equipment: defaultAvatarConfig('ethan').equipment,
      });
      expect(write.statusCode).toBe(200);
      expect(write.json().characterId).toBe('ethan');
    });
  });
});
