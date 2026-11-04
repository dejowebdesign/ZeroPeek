/**
 * ZeroPeek socket load probe (temporary tool, not part of the app).
 *
 * Boots the real backend in-process against a throwaway database and drives
 * N simulated players through a full quiz over real Socket.IO, measuring
 * join/answer/event latency and per-question completion. Purpose: give the
 * capacity claim for "25 players + host" a measured basis instead of a guess.
 *
 * Usage:  node loadtest.mjs <players> [baseUrl]
 */

import { io as connect } from 'socket.io-client';
import { randomUUID } from 'node:crypto';

const PLAYERS = Number(process.argv[2] ?? 25);
const BASE = process.argv[3] ?? 'http://localhost:3001';

const config = {
  nodeEnv: 'test',
  port: 0,
  host: '127.0.0.1',
  appBaseUrl: BASE,
  corsOrigin: BASE,
  logLevel: 'silent',
  cookieSecure: false,
  sessionCookieName: 'zp_session',
  sessionTtlMs: 3600_000,
  redisUrl: 'redis://127.0.0.1:6399',
  sessionSecret: 'load-test-secret-load-test-secret',
  databaseUrl: process.env.DATABASE_URL,
  databaseUrlSource: 'explicit',
  databaseTarget: null,
  warnings: [],
};

const { buildApp } = await import('../packages/backend/dist/app.js');
const { attachSocketIO } = await import('../packages/backend/dist/socket.js');
const { createQuiz } = await import('../packages/backend/dist/services/quizService.js');
const { createUser } = await import('../packages/backend/dist/services/userService.js');
const { prisma } = await import('../packages/backend/dist/db.js');

const QUESTIONS = 3;
const quiz = {
  id: randomUUID(),
  title: 'Load probe',
  description: '',
  theme: 'standard',
  defaultTimeLimit: 20,
  questions: Array.from({ length: QUESTIONS }, (_, i) => ({
    id: randomUUID(),
    type: 'single',
    text: `Question ${i + 1}`,
    timeLimit: 20,
    points: 'standard',
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
  })),
};

function waitEvent(socket, event, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${event}`)), timeoutMs);
    socket.once(event, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });
}
function ack(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (r) => (r?.ok ? resolve(r.data) : reject(new Error(r?.error))));
  });
}

/**
 * A buffering listener for one event: `next()` always resolves with the next
 * occurrence, even if it arrived before the call. Needed because the engine
 * emits on the ack's microtask, so a plain once() can miss an event.
 */
function queue(socket, event) {
  const buffered = [];
  const waiters = [];
  socket.on(event, (payload) => {
    const w = waiters.shift();
    if (w) w(payload);
    else buffered.push(payload);
  });
  return {
    next: (timeoutMs = 60000) =>
      new Promise((resolve, reject) => {
        if (buffered.length) return resolve(buffered.shift());
        const t = setTimeout(() => reject(new Error(`timeout ${event}`)), timeoutMs);
        waiters.push((p) => {
          clearTimeout(t);
          resolve(p);
        });
      }),
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function main() {
  const app = await buildApp({ config });
  const sockets = attachSocketIO(app.server, config, BASE);
  await app.listen({ port: 3001, host: '127.0.0.1' });
  const url = 'http://127.0.0.1:3001';

  const admin = await createUser({
    username: `load-${Date.now()}`,
    password: 'loadtest-password-1',
    role: 'ADMIN',
  });
  await createQuiz(admin.id, quiz);

  // --- Host: login (real cookie) then create the game -----------------------
  const login = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: admin.username, password: 'loadtest-password-1' }),
  });
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

  const host = connect(`${url}/host`, {
    transports: ['websocket'],
    extraHeaders: { cookie },
  });
  await waitEvent(host, 'connect');
  const created = await ack(host, 'host:create', { quizId: quiz.id });
  const { pin, gameId } = created;

  // --- Players: join concurrently -------------------------------------------
  const players = [];
  const joinTimes = [];
  const joinT0 = performance.now();
  await Promise.all(
    Array.from({ length: PLAYERS }, (_, i) => {
      return (async () => {
        const s = connect(url, { transports: ['websocket'] });
        await waitEvent(s, 'connect');
        const t0 = performance.now();
        const res = await ack(s, 'player:join', { pin, nickname: `p${i}` });
        joinTimes.push(performance.now() - t0);
        players.push({ s, id: res.playerId });
      })();
    }),
  );
  const joinWall = performance.now() - joinT0;

  // --- Full game: answer every question -------------------------------------
  const answerLatencies = [];
  const questionTimes = [];
  let answered = 0;

  const qQuestion = queue(host, 'host:question');
  const qReveal = queue(host, 'host:reveal');
  const qBoard = queue(host, 'host:board');
  const qEnded = queue(host, 'host:ended');

  await ack(host, 'host:start', { gameId });
  let question = await qQuestion.next(30000);

  let q = 0;
  while (question && q < QUESTIONS) {
    const qStart = performance.now();
    await Promise.all(
      players.map(async ({ s }) => {
        const t0 = performance.now();
        await ack(s, 'player:answer', { questionId: question.id, answer: 0 });
        answerLatencies.push(performance.now() - t0);
        answered += 1;
      }),
    );
    await qReveal.next(30000);
    await qBoard.next(30000);
    questionTimes.push(performance.now() - qStart);

    q += 1;
    if (q >= QUESTIONS) break;
    question = await qQuestion.next(60000);
  }

  // The host ends the round explicitly (as in real use).
  const endT0 = performance.now();
  await ack(host, 'host:end', { gameId }).catch(() => {});
  await qEnded.next(15000).catch(() => {});
  const endMs = performance.now() - endT0;

  const mem = process.memoryUsage();
  console.log(
    JSON.stringify(
      {
        players: PLAYERS,
        questions: QUESTIONS,
        answersTotal: answered,
        joinWallMs: Math.round(joinWall),
        joinMs: {
          p50: Math.round(pct(joinTimes, 50)),
          p95: Math.round(pct(joinTimes, 95)),
          max: Math.round(pct(joinTimes, 100)),
        },
        answerMs: {
          p50: Math.round(pct(answerLatencies, 50)),
          p95: Math.round(pct(answerLatencies, 95)),
          max: Math.round(pct(answerLatencies, 100)),
        },
        questionCycleMs: {
          p50: Math.round(pct(questionTimes, 50)),
          max: Math.round(pct(questionTimes, 100)),
        },
        endMs: Math.round(endMs),
        rssMb: Math.round(mem.rss / 1048576),
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
      },
      null,
      2,
    ),
  );

  players.forEach(({ s }) => s.disconnect());
  host.disconnect();
  await sockets.close();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('LOADTEST ERROR', e);
  process.exit(1);
});
