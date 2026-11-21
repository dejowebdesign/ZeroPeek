/**
 * The 50-player lobby limit (Phase 6.14), against a real database.
 *
 * The limit is a product decision, not a UI detail: the dashboard renders it and
 * the backend enforces it. These tests therefore drive the real `joinGame` path
 * rather than the builder, and the concurrency cases fire genuinely parallel
 * inserts at the database — the only way to prove the check is not advisory.
 *
 * Skipped automatically when no database is reachable (see testing/db.ts).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Quiz } from '@zeropeek/shared';
import { MAX_PLAYERS_PER_LOBBY } from '@zeropeek/shared';

import { prisma } from './db.js';
import { createGame, joinGame } from './services/gameService.js';
import { createQuiz } from './services/quizService.js';
import { createUser } from './services/userService.js';
import { canConnect, resetDatabase } from './testing/db.js';

const available = await canConnect();

const QUIZ: Quiz = {
  id: '00000000-0000-4000-8000-0000000000c1',
  title: 'Lobby capacity test',
  description: '',
  theme: 'standard',
  defaultTimeLimit: 20,
  questions: [
    {
      id: '00000000-0000-4000-8000-0000000000c2',
      type: 'single',
      text: 'Ready?',
      timeLimit: 20,
      points: 'standard',
      options: ['Yes', 'No'],
      correctIndex: 0,
    },
  ],
};

describe.skipIf(!available)('lobby capacity', () => {
  let ownerId = '';
  let quizId = '';

  beforeAll(async () => {
    await resetDatabase(prisma);
    const owner = await createUser({
      username: 'capacityhost',
      password: 'correct-horse-battery',
      role: 'TRAINER',
    });
    ownerId = owner.id;
    const quiz = await createQuiz(ownerId, QUIZ);
    quizId = quiz.id;
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.playerAnswer.deleteMany();
    await prisma.gameEvent.deleteMany();
    await prisma.gamePlayer.deleteMany();
    await prisma.game.deleteMany();
  });

  /** A fresh lobby. */
  async function freshLobby() {
    return createGame(quizId, ownerId);
  }

  /** Seat `count` players, returning their nicknames. */
  async function seat(pin: string, count: number, prefix = 'player'): Promise<string[]> {
    const names: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const nickname = `${prefix}${index}`;
      await joinGame(pin, nickname);
      names.push(nickname);
    }
    return names;
  }

  it('accepts the first players and counts them', async () => {
    const game = await freshLobby();
    await seat(game.pin, 3);

    const seated = await prisma.gamePlayer.count({ where: { gameId: game.id } });
    expect(seated).toBe(3);
  });

  it('seats player 49 and player 50', async () => {
    const game = await freshLobby();
    await seat(game.pin, 48);

    const fortyNinth = await joinGame(game.pin, 'player48');
    const fiftieth = await joinGame(game.pin, 'player49');
    expect(fortyNinth.player.nickname).toBe('player48');
    expect(fiftieth.player.nickname).toBe('player49');

    const seated = await prisma.gamePlayer.count({ where: { gameId: game.id } });
    expect(seated).toBe(MAX_PLAYERS_PER_LOBBY);
  });

  it('rejects player 51 with a distinct, user-safe error', async () => {
    const game = await freshLobby();
    await seat(game.pin, MAX_PLAYERS_PER_LOBBY);

    await expect(joinGame(game.pin, 'one-too-many')).rejects.toMatchObject({
      status: 409,
      code: 'lobby_full',
      message: expect.stringContaining(String(MAX_PLAYERS_PER_LOBBY)),
    });
  });

  it('keeps the count at the limit after a rejection', async () => {
    const game = await freshLobby();
    await seat(game.pin, MAX_PLAYERS_PER_LOBBY);

    await expect(joinGame(game.pin, 'one-too-many')).rejects.toThrow(/full/i);

    const seated = await prisma.gamePlayer.count({ where: { gameId: game.id } });
    expect(seated).toBe(MAX_PLAYERS_PER_LOBBY);
  });

  it('does not count a registered player twice when they join again', async () => {
    const game = await freshLobby();
    const account = await createUser({
      username: 'returningplayer',
      password: 'correct-horse-battery',
      role: 'PLAYER',
    });

    const first = await joinGame(game.pin, 'returningplayer', '', account.id);
    const second = await joinGame(game.pin, 'returningplayer', '', account.id);

    expect(second.player.id).toBe(first.player.id);
    const seated = await prisma.gamePlayer.count({ where: { gameId: game.id } });
    expect(seated).toBe(1);
  });

  it('lets a full lobby free a place again when a seat is released', async () => {
    const game = await freshLobby();
    await seat(game.pin, MAX_PLAYERS_PER_LOBBY);

    await expect(joinGame(game.pin, 'latecomer')).rejects.toThrow(/full/i);

    // A seat leaving is the only way a place opens up; the limit must follow it
    // rather than stay latched.
    const victim = await prisma.gamePlayer.findFirstOrThrow({
      where: { gameId: game.id },
      orderBy: { joinedAt: 'asc' },
    });
    await prisma.gamePlayer.delete({ where: { id: victim.id } });

    const { player } = await joinGame(game.pin, 'latecomer');
    expect(player.nickname).toBe('latecomer');

    const seated = await prisma.gamePlayer.count({ where: { gameId: game.id } });
    expect(seated).toBe(MAX_PLAYERS_PER_LOBBY);
  });

  it('never exceeds the limit when joins arrive concurrently', async () => {
    const game = await freshLobby();
    await seat(game.pin, MAX_PLAYERS_PER_LOBBY - 2);

    // Six simultaneous joins for two remaining places. A read-then-write check
    // without a lock would let several of them see "one place left" and all
    // insert; the row lock must serialise them so exactly two win.
    const attempts = Array.from({ length: 6 }, (_, index) =>
      joinGame(game.pin, `racer${index}`).then(
        () => 'joined' as const,
        () => 'rejected' as const,
      ),
    );
    const outcomes = await Promise.all(attempts);

    expect(outcomes.filter((outcome) => outcome === 'joined')).toHaveLength(2);
    const seated = await prisma.gamePlayer.count({ where: { gameId: game.id } });
    expect(seated).toBe(MAX_PLAYERS_PER_LOBBY);
  });

  it('never exceeds the limit when a burst fills an empty lobby', async () => {
    const game = await freshLobby();

    // 60 concurrent joins against 50 places: the limit must hold exactly.
    const attempts = Array.from({ length: 60 }, (_, index) =>
      joinGame(game.pin, `burst${index}`).then(
        () => 'joined' as const,
        () => 'rejected' as const,
      ),
    );
    const outcomes = await Promise.all(attempts);

    expect(outcomes.filter((outcome) => outcome === 'joined')).toHaveLength(MAX_PLAYERS_PER_LOBBY);
    const seated = await prisma.gamePlayer.count({ where: { gameId: game.id } });
    expect(seated).toBe(MAX_PLAYERS_PER_LOBBY);
  });

  it('does not consume a second place on reconnect', async () => {
    const game = await freshLobby();
    const { player } = await joinGame(game.pin, 'reconnector');

    // A reconnect reclaims the existing seat; it must not add a row.
    const { rejoinGame } = await import('./services/gameService.js');
    const reclaimed = await rejoinGame(game.id, player.id, player.token);
    expect(reclaimed.id).toBe(player.id);

    const seated = await prisma.gamePlayer.count({ where: { gameId: game.id } });
    expect(seated).toBe(1);
  });

  it('counts seats per lobby, not across lobbies', async () => {
    const first = await freshLobby();
    const second = await freshLobby();
    await seat(first.pin, MAX_PLAYERS_PER_LOBBY);

    // A full lobby must not block a different one.
    const { player } = await joinGame(second.pin, 'elsewhere');
    expect(player.nickname).toBe('elsewhere');
  });
});
