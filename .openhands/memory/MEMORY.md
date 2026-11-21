# Project memory — ZeroPeek

Durable, expensive-to-learn facts about this repo. Keep it short: the daily logs
(`YYYY-MM-DD.md`) hold the narratives and measurements; this file holds what a future
session must not get wrong. Prune it as its own change, never inside a feature branch.

**Read the code first.** `main` is far ahead of several older notes below; every status
claim here is dated. Verify with `grep '^model ' packages/backend/prisma/schema.prisma`,
`ls packages/backend/prisma/migrations/`, `ls packages/*/src/` before trusting a phase
description.

## Local verification environment (rebuild after a sandbox restart)

`/tmp` is wiped on restart. Postgres runs in the compose stack; expose it to the host and
point the suites at a **separate** database.

```bash
# 1. DB: create once, then forward the port out of the container
sudo docker exec <db-container> psql -U zeropeek -c 'CREATE DATABASE zeropeek_test'
sudo docker run -d --network <proj>_zeropeek -p 15432:5432 alpine/socat \
  tcp-listen:5432,fork,reuseaddr tcp-connect:db:5432

# 2. Prisma reads DATABASE_URL, not TEST_DATABASE_URL
export DATABASE_URL=postgresql://zeropeek:<pw>@localhost:15432/zeropeek_test
export TEST_DATABASE_URL="$DATABASE_URL"
npx prisma migrate deploy --schema packages/backend/prisma/schema.prisma   # idempotent
npm test
```

- Backend suites **silently skip** without these vars (the run looks green but is
  incomplete). `resetDatabase()` truncates whatever `DATABASE_URL` points at — never point
  it at the live DB. `packages/backend/vitest.config.ts` sets `fileParallelism: false`
  because every DB suite truncates the shared DB; keep it.
- Running `npm test` deletes the bootstrap admin, so a later dev login 401s — restart the
  backend before any manual check (bootstrap re-creates it).
- `npm ci` does **not** run `prisma generate`; see the CI trap below.
- A dockerd is often already running: use `sudo docker ...` (`docker info` as the non-root
  user fails). Start one only if `sudo docker info` fails; never delete a live `docker.pid`.

## Git / push in this sandbox

- **Always `git fetch origin main` before claiming anything about `main`.** A merge done on
  GitHub does not move the local `main` ref, so `git rev-parse main` will happily report a
  stale commit. `git ls-remote origin refs/heads/main` is authoritative.
- `git push -u origin <branch>` **works** when the credential helper is populated (verified
  2026-11-19 on `feat/phase-6-10-background-library`). If it prompts for a username instead
  of pushing, fall back to a one-shot URL
  `git push "https://x-access-token:${GITHUB_TOKEN}@github.com/dejowebdesign/ZeroPeek.git" <branch>`
  and then `git remote set-url origin <clean>` **and** unset `branch.<name>.remote/.merge`,
  because `git push` writes the token-bearing URL into `.git/config` (verified: it does).
- The `create_pr` tool works directly (owner/repo `dejowebdesign/ZeroPeek`). The `gh` CLI is
  usually **not** authenticated — use `curl -H "Authorization: Bearer $GITHUB_TOKEN"
  https://api.github.com/...` when a REST call is needed, or the public API for reads.
- **Do not push, open a PR, merge or deploy without explicit approval.** The owner merges and
  deploys himself, and he may merge while a session is still running.

## ZeroPeek repo (github.com/dejowebdesign/ZeroPeek)

- Public repo. npm-workspaces monorepo: `packages/{shared,backend,frontend}`, `docs/`,
  `docker/`, two compose files. TypeScript strict, Fastify 5 + Socket.IO 4 + Prisma,
  PostgreSQL 16, Redis 7 (present but **unused** by the backend), Caddy, Vanilla TS + Vite
  multi-page frontend. Node 22 in CI, 24 locally.
- **Frontend is a Vite multi-page build**, not a SPA and not Angular (ADR 0002): entries
  `index` (player), `host`, `editor`, `admin`, `auth`, `profile`, `inventory`, … served by
  `docker/Caddyfile.frontend` via `try_files {path} {path}.html {path}/index.html`, so
  `/admin` and `/admin.html` both work but `/admin/` does not. Strict CSP forbids inline
  styles, so the client styles via the CSSOM — **no `innerHTML` anywhere**.
  **Open follow-up:** no `Cache-Control` for `*.html` (only a weak ETag), so a stale bundle can
  be served after a deploy; a `no-cache` rule is proposed but NOT implemented (needs approval).
- **Four surfaces:** player `/`, host/beamer `/host.html` (there is **one** host view that is
  also the beamer; no separate presentation mode), editor, admin.
- **Socket.IO namespaces: player = default `/`, host = `/host`** (auth-gated). Wrappers live
  in `packages/frontend/src/socket.ts`.
- Deploy: `.github/workflows/docker-publish.yml` publishes
  `ghcr.io/dejowebdesign/zeropeek-{backend,frontend}` (tags `sha-<short>`, `main`, `latest`);
  `docker-compose.portainer.yml` is the self-contained production stack (no `build:`,
  Caddyfile inline via Compose `configs.content`, only the proxy publishes a port). `ci.yml`
  is **pull_request-only**; the publish workflow owns `main` + tags. Repo and GHCR packages
  are public, so Portainer pulls anonymously. The `deploy` job **skips with exit 0** (not a
  failure) while `PORTAINER_WEBHOOK_URL` is unset — a green run with no redeploy is expected.
- Untracked workspace files that are NOT from the repo: `nopeek-audit.md` and the owner's
  `ZeroPeek_*` ZIPs (character library, background library) — **never commit a ZIP**.
  `.openhands/memory/MEMORY.md` **is** tracked in git.

### Fresh-checkout trap (broke real CI)

`packages/shared` exposes `dist/` only (`main`/`types` point at `dist`). A clean clone has no
`dist`, so typechecking backend/frontend fails with `TS2307: Cannot find module
'@zeropeek/shared'`. The root `typecheck`/`test` scripts must run `build:shared` first. Never
reorder them.

### CI trap: the Prisma client is NOT generated by `npm ci`

`@prisma/client` ships as a **stub**; without `prisma generate` the backend does not compile
(**28 errors**: TS2305 for `PrismaClient`/`Prisma`/`UserRole`/`InputJsonValue` plus TS7006
implicit-any in every row callback). Both workflows run
`npm run prisma:generate -w @zeropeek/backend` **before** typecheck and `prisma migrate
deploy`. Reproducing locally is the trap: `composite: true` + `tsconfig.tsbuildinfo` makes
`tsc` skip re-checking, so deleting `.prisma` appears to change nothing. Delete the build
cache **and** the client: `rm -f packages/*/tsconfig.tsbuildinfo && rm -rf
packages/backend/dist && mv node_modules/.prisma /tmp/bak`.

### Docker trap (cost ~1 build cycle)

`tsc` with `composite: true` leaves `*.tsbuildinfo` in the package dir. If those files reach
a Docker build context, `tsc` thinks the package is already built and emits **no** `dist/`,
so dependents fail with `TS2307`. `.dockerignore` must contain `**/*.tsbuildinfo` (and
`**/dist`).

### Verifying workflows without a real push

`act` (nektos) runs a workflow in a container: `sudo /tmp/act push -W
.github/workflows/docker-publish.yml -j verify -P ubuntu-latest=catthehacker/ubuntu:act-latest
--pull=false`. `act < 0.2.86` has known CVEs — use 0.2.94+. `actionlint` catches expression
errors. The sandbox has no GHCR credentials, so a real `docker push` cannot be tested here;
build locally with the exact GHCR tag instead.

## Portainer stack: compose, TLS, DB

- **Compose `:?` guards that remain (exactly four, all intentional):**
  `POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` + `SESSION_SECRET`. Everything else has a
  default — never re-add a `:?` guard to a variable that has one. Guarding `APP_BASE_URL`
  once broke the stack (`required variable APP_BASE_URL is missing a value`).
- **`DATABASE_URL` is derived, not required:** the backend builds it from
  `POSTGRES_{USER,PASSWORD,DB}` with URL-safe encoding (verified: `p@ss:w/rd?#%!*z` →
  `p%40ss%3Aw%2Frd%3F%23%25%21%2Az`). Leave it empty. `REDIS_URL` is unused; never guard it.
- **`COOKIE_SECURE`** empty = derive from the `APP_BASE_URL` scheme. A `Secure` cookie over
  plain HTTP is silently dropped → login breaks. A localhost `APP_BASE_URL` is a **warning**,
  not fatal (internal plain-HTTP deploys need it). `CORS_ORIGIN` empty ⇒ defaults to
  `APP_BASE_URL` (same-origin), so it needs no entry.
- **Canonical public URL is `https://zeropeek.xubi.org`** (Portainer CE 2.45.3).
- **TLS = `ZP_SITE_ADDRESS` + `CADDY_CONTAINER_PORT` + `HTTP_PORT` (all three agreeing);**
  empty address = plain HTTP on 80. `ZP_HTTP_CHALLENGE_PORT` is the separate ACME listener below.
- **TLS needs container port 80 published** for ACME HTTP-01 + the HTTP→HTTPS redirect; Caddy
  binds it only in TLS mode. Compose publishes
  `'${ZP_HTTP_CHALLENGE_PORT:-${HTTP_PORT:-3737}}:80'`. The nested default is deliberate:
  plain-HTTP mode → `3737:80` twice → Compose **collapses** the dup (unchanged); TLS mode →
  default `443` **conflicts** with the primary `443:443`, so TLS users set
  `ZP_HTTP_CHALLENGE_PORT=80`. A duplicate host port inside one `ports:` list passes `config`
  but a genuine same-host-port pair fails at `up`.
- **Caddy `/data` MUST be a named volume** (`caddy-data`, `caddy-config`). Without it every
  recreation forgets the certificate + ACME account and re-requests one → Let's Encrypt "too
  many certificates (50) already issued". `ZP_ACME_CA` selects the ACME directory.
- **Compose-vs-Caddy interpolation trap:** the embedded Caddyfile is a `configs.content`
  block, so Compose substitutes `$VAR` inside it. Caddy's native `{$VAR:default}` becomes
  `{:default}` (invalid Caddyfile). Use Compose `${VAR:-default}`. A single `$` in an `.env`
  **value** is still interpolated (`p@ss$word` → `p@ss`); a literal `$$` survives, and in a
  `healthcheck.test` it reaches the container as one `$` (read from the container env).
  `${VAR:?msg}` fails for both unset and empty — the desired behaviour.
- **Postgres `unhealthy` root cause** (`dependency failed to start: container … is
  unhealthy`) = **empty `POSTGRES_PASSWORD`**: the entrypoint aborts a fresh init, the
  container restart-loops, and `depends_on: service_healthy` kills the deploy.
- **Restart: `on-failure:5` on the backend only** (others `unless-stopped`) — it exits non-zero
  on a misconfiguration or unreachable DB, so `unless-stopped` would loop forever.
- `pg_isready` is a **bad** healthcheck alone: it returns 0 for a nonexistent user *and*
  database. The loopback address is `trust` in the image's `pg_hba.conf`, so `psql -h
  127.0.0.1` accepts *any* password; a login-validating probe must use `psql -h
  "$(hostname)"` (scram-sha-256).
- **Existing Postgres volume:** `POSTGRES_*` apply only on first init of an empty `db-data`;
  on a populated volume they are ignored, so the compose value does NOT change the
  role/password. To fix a mismatch, put the volume's CURRENT password into
  `POSTGRES_PASSWORD` — never `ALTER ROLE`, never `down -v`.
- **Config rule:** use `isNonEmpty(env.X)` for every string fallback; never `env.X ??
  default` (an empty string is treated as set — an empty `CORS_ORIGIN` made `@fastify/cors`
  throw, so `/api/health` was 500 even with a reachable DB). Prisma 6 auth errors have **no
  `code`**; match the message text.
- Regression guard `packages/backend/src/deployment.compose.test.ts` parses `:?` vs `:-` and
  asserts the four required vars are documented in PORTAINER.md + ENVIRONMENT.md +
  `.env.portainer.example`, and that APP_BASE_URL/DATABASE_URL/REDIS_URL/CORS_ORIGIN/
  COOKIE_SECURE stay unguarded. `.env.portainer.example` has no Prettier parser, so never
  pass it to a bare `prettier --check <file>` list (the repo-wide `format:check .` is fine).
- Full-stack test recipe: build `zeropeek-backend:test`/`zeropeek-frontend:test`, run
  `docker compose -f docker-compose.portainer.yml --env-file <env> -p zptest up -d`, then
  `down -v`. Image vars are `ZEROPEEK_BACKEND_IMAGE`/`ZEROPEEK_FRONTEND_IMAGE` +
  `ZEROPEEK_IMAGE_TAG` (separate vars — `repo:tag` inside the image var is an invalid
  reference).

## Frontend design system (Phase 6.1, PR #18)

- Style: **"Dark Retro-Futuristic Wireframe & Glassmorphism"** — presentation only.
  Reference: `docs/design/design-system.md`.
- `packages/frontend/src/styles/tokens.css` = tokens + all component CSS (single file). Phase
  0 tokens are FROZEN and asserted byte-for-byte by `src/design-system.test.ts`.
  `backdrop.css` = wireframe floor grid + horizon + login starfield, CSS-only, no images.
- `design-system.test.ts` is a **contract**: every class a component emits must be listed
  there **and** defined in `tokens.css`, or it fails. Extending the system = add a token, add
  the component to `src/ui.ts` + CSS + `ui.test.ts`, register the class. Never hard-code a
  value.
- **Show/beamer sizing:** `--type-show-*`, `--show-gap`, `--show-pad` and the podium
  `min-height` mix **`vw + vh`**, so a 720p projector shrinks the board instead of scrolling
  it. `.show__options` is a fixed 2-column grid (stacks < 640px). Beamer markup builders live
  in `src/showView.ts` (pure, unit-tested) because `pages/host.ts` opens a socket on import.
- **Dead-vs-kept CSS is decided by "emitted OR documented".** `card--raised`,
  `card--interactive`, `anim-shake` are emitted by no component but are documented utilities
  → keep them and their contract entries.
- **CSS cascade traps:** a `@media` block adds **no specificity**, so a later plain rule
  defeats a mobile override — place the override after the base rule or out-specify it. At
  ≥1440px the 768/1024/1440 `min-width` blocks all match, so the widest `:root` value must
  win **by source order**.
- **Token-diff gotcha:** to prove Phase 0 tokens are unchanged, extract the **first** `:root`
  block and parse `--name: value;` in Python. A `grep -oP` over the whole file matches a later
  redefinition and gives a false "differs".

### Verification is TEXT-ONLY (owner rule, mandatory)

chrisB forbids all image work on ZeroPeek — **no screenshots, no PNG/JPEG creation, no image
analysis, no visual browser checks, no images in docs or PRs**. Verify with
text/tables/measurements only: `/usr/bin/chromium --headless=new --no-sandbox --disable-gpu
--window-size=W,H --virtual-time-budget=2500 --dump-dom`, render the REAL modules with
`npx esbuild <entry.ts> --bundle --format=esm --alias:@zp-frontend=./packages/frontend/src`
into a scratch page under `dist/`, write `getBoundingClientRect()`/`scrollHeight` into a
`data-json` attribute, read it back with `--dump-dom`, then delete the scratch page. **Never
pass `--screenshot`.**

`@supports` cannot be disabled from JS and Chromium has **no flag** for `backdrop-filter`;
never assert `getComputedStyle().backdropFilter` as proof (it reports the declared value even
when unsupported).

## Testing gotchas

- Frontend tests parse CSS as **text** (regex on rule bodies), so a CSS refactor can break
  them with no runtime change. `rule(selector, marker)` disambiguates repeated selectors by a
  declaration unique to the rule.
- **A local `const x = vi.fn()` shadows a module-level helper named `x`** — the test then
  silently calls the spy. Rename spies. `supportsRule(sel)` returns the first match after an
  `@supports`, which may be the base rule; assert on the raw `css` string when in doubt.
- **The Prisma client is a `Proxy`:** `vi.spyOn(prisma, '$transaction').mockRestore()` leaves
  the property **undefined**. Reassign the original method in a `finally`.
- **`engine.get()` caches a warm runtime** — concurrency repros and regression tests must call
  `engine.evict(gameId)` first, or the scenario is not exercised.
- **Concurrency bugs need a looped test.** Engine phase writes are async and fire-and-forget
  paths interleave; a one-shot assertion passes by luck. Loop 60–150× and count bad states (a
  real auto-reveal vs. `end` race failed **47/150** while passing single runs).
  `withPhaseLock` (per-game) serialises start/next/reveal/board/end; `*Internal` bodies avoid
  re-entering it.
- **`Question.id` is a global primary key**, so fixtures with hard-coded ids can only be seeded
  once per DB (`P2002`).
- `browser_set_storage` **merges** cookies (cannot delete HttpOnly ones) and **overwrites** the
  real cookie — a stale value silently breaks the session. For a genuine fresh session, log in
  fresh. To observe `location.assign` in jsdom use
  `Object.defineProperty(window,'location',{configurable:true,value:{assign,...}})`;
  `vi.spyOn(location,'assign')` throws.
- **Acceptance harness `/var/tmp/zpstab`** (wiped on restart; re-create from the daily log):
  real backend process + real Chromium player UI, programmatic assertions only. Sections A
  restart recovery, B all 13 types right/wrong/none, B2 time limits, C races, D reconnect →
  **344/344**. The reusable pattern for end-to-end checks without screenshots.
- **R-12 stays OPEN: no E2E and no visual tests** (R-1 was disarmed) — the harness above is a
  manual pattern, not a CI suite, so responsive/design regressions stay undetected.
- **Real-process-restart tests:** `npx tsx src/server.ts` re-execs, so SIGKILLing only the
  spawned child leaves the server alive and every "restart" talks to the OLD process. Spawn
  `detached: true`, `process.kill(-pid,'SIGKILL')` the group, assert `/api/health` is down
  before restarting.

## Gameplay engine: timings and invariants

- **`REVEAL_MS = 4000`, `BOARD_MS = 5000`** (exported from
  `packages/backend/src/services/engine.ts`).
- **AUTO (Phase 6.9.3) gates EXACTLY TWO transitions:** question → reveal
  (`armQuestionClock`) and board → next question (`armBoardAdvance`). The **reveal → board**
  step (`armRevealWindow`, `REVEAL_MS`) is a **fixed window in BOTH modes**. The answer clock
  and the start countdown always run. AUTO is server-authoritative (`host:auto`, default
  **off**), persisted in the existing `GameEvent` log (type `auto`, newest-wins), no column
  and no migration; `setAuto` is a no-op when unchanged.
- **One timer slot (`game.timer`).** Every arm helper must `clearTimer` first and only arm in
  its own phase (`armBoardAdvance` returns unless `phase === 'board'`). Missing the phase guard
  let `setAuto(true)` orphan the answer timer, which then revealed the question after AUTO was
  switched off again. **Invariant: one timer slot; each helper clears first and arms only in
  its own phase.**
- **`engine.revealInternal`/`boardInternal`: `clearTimer` must come AFTER the idempotency
  guards**, never before — the auto-advance timer is the only thing that moves the game off
  reveal/board, so clearing it on a duplicate command strands the game there permanently.
- **The deadline shown is the deadline enforced.** `limitMs()` = exactly `timeLimit·1000`; a
  hidden `ANSWER_GRACE_MS = 1500` was removed in Phase 6.9.5 (late guard `>` → `>=`). The speed
  bonus uses `elapsedMs` vs `question.timeLimit`, never `limitMs()`.
- **Legal phase moves:** host `next` only from `board`; `board` only from `reveal`
  (`reveal → board → next`). A `slide` renders as "No answer" (never graded) — correct. A
  `slide` cannot be paused; a paused question offers only Resume+Skip.
- **With a single player the question auto-reveals the instant they answer**, so the host
  `Reveal` button never appears — use **two** players for any host flow test.
- **`lead` is a real server phase** (Phase 6.9.1, `LEAD_SECONDS = 5`): `startInternal` →
  `enterLead`; only `advanceFromLead`/`skipLead` leave it, both under `withPhaseLock`. Recovery
  rebuilds the **remaining** window from the `lead` event's `endsAt`, never restarts it.
  `host:skipLead` is host-only and a duplicate is a `conflict`.
- **Never decide "the latest event" by ordering `GameEvent.createdAt`.** The column has
  **millisecond precision only**, so events written in the same tick (`reveal` + `skipped`,
  `paused` + `resumed`) have no defined order. Recovery reads the log in one query and matches
  by `questionId` in JS with no ordering assumption: skipped = a `skipped` event exists; paused
  = `pauses > resumes`; frozen remainder = `min(remainingMs)`.
- **`submitAnswer`** commits both writes in one `prisma.$transaction`, mirrors the runtime only
  after it resolves, maps `P2002` → `conflict('You have already answered.')`, and serialises
  same-player+question submissions via `withAnswerLock('playerId:questionId')`. `engine.get()`
  shares one in-flight load per game.
- **Point/rank deltas are READ, never recomputed:** `pointsDeltas` sums the persisted
  `playerAnswer.points` and derives `previousScore = score − delta`; `rankDeltas` re-ranks with
  each player's own delta removed. Idempotent and identical live vs. after a cold reload.
- Contract traps: `host:create` ACKs `{ gameId, pin }` (**not** `{ id, pin }`); `host:join` ACKs
  `{ pin, players }`; the report route is `/api/reports/games/:id` with body
  `{ quiz:{id,title,questionCount}, players, questions }`; the server rejects a quiz with
  **zero questions**, so "New quiz" must seed one and the editor must block removing the last.
  The host-namespace question event is `host:question`. `PublicPlayer` has no `rank` — rank is
  the array position.

## Host console (Phases 6.5.2, 6.5.3, 6.9.x)

- **The host console is server-driven.** `HostState` (shared) + `engine.hostState(game)` are
  ACKed by `host:create`/`host:join`; `renderHostState` dispatches on `hostScreen(state)`, and
  `sessionStorage['zeropeek.host.game']` auto-resumes after a reload. `HostState` is
  deliberately NOT `PlayerSync` (the host sees the solution and the full distribution and is
  never a player); `question` stays the solution-free `PublicQuestion` until `reveal`.
- **Control bar is derived** from `hostActions(phase, paused, type, hasNext)` via `controlsFor`,
  so the host can never be offered an action the phase forbids. `hasNext` is server-derived on
  the `board` event (omits `next` on the last board).
- **`answerCountNode`** is a single slot in `pages/host.ts`: set in `showQuestion`, `null` on
  **every** other screen. Miss one reset and the live answer count silently stops updating.
- **`attachHostHandlers` must bind `socket.on`/`socket.off` to the socket**
  (`socket.on.bind(socket)`) — `socket.on` is a prototype method, so extracting it throws inside
  the emitter because `this` is `undefined`, which **silently registers no listeners** and
  kills the whole host page. Unit tests missed it because the fake socket is an object literal;
  the regression test uses a class with real prototype methods.
- **`attachHostHandlers` needs an explicit entry in its `listeners` array for every new host
  event.** Adding it to the `HostEventHandlers` *type* is not enough — the handler silently
  never fires and only the command ACK still works. Derive any listener-count assertion from
  `Object.keys(handlersFor(...))`, never a hard-coded number.
- **A host reload arrives as `{ kind: 'sync' }`, not `{ kind: 'lobby' }`.** Gate lobby-only UI
  on `hostScreen(state)`, never on `lastRender.kind`, or it disappears exactly on reconnect.
- **`el()` uses `addEventListener`**, so binding a command via `onClick` and then adding
  `node.onclick = …` runs **both** handlers (Skip/End sent immediately *and* opened the confirm
  dialog; Cancel could not undo). `hostButton(..., { confirm })` makes the dialog the button's
  only click action and sends from `onConfirm`. **Invariant: one handler per button.**
- **Pause/skip/kick:** `host:pause`/`host:resume`/`host:skip`, lobby-only `host:kick` →
  `game:kicked`, and host presence (`game:host`, from the `/host` room size, debounced).
  Paused/skipped state is rows in the existing `GameEvent` log — **no migration**. Resume shifts
  `openedAt` forward by the pause duration and re-arms once; `revealInternal` no-ops while
  paused unless skipped. A skip **neutralises** the question (points refunded via an atomic
  idempotent `refundQuestion`; reports mark `gameReport.skipped`, CSV `skipped`,
  `quizStatistics.skippedGames`) and a skipped reveal carries **no solution**.
- **Show scenes (Phase 6.9.2) are DISPLAY-ONLY.** `showScenes.ts` is pure (no DOM/socket):
  `SHOW_SCENES` (13), `SCENE_DEFINITIONS`, `ENTRY_SCENE`, `ShowController.sync` (which
  **ignores a stale descriptor**, `at < lastAt`). The manual step strip, presentation mode and
  `.show__scene-*` CSS were **removed** in 6.9.3 — a host step could park the show on a scene
  the server was not in. `sync` always re-derives `entryScene(phase)`; the scene stays internal.
  `design-system.test.ts` asserts those classes stay gone.
- **`ClockSync` is display-only; the server stays authoritative.** `shared/src/clock.ts` is pure
  NTP maths (`offset = serverTime − (t1+t3)/2`, `CLOCK_SAMPLE_COUNT=5`,
  `CLOCK_MAX_ROUND_TRIP_MS=2000`, best = smallest round trip, unusable samples dropped, never
  clamped). `clock:ping`/`clock:pong` on both namespaces; `frontend/src/clockSync.ts` uses
  `performance.now()` and exposes `serverNow()`. One clock only — never a second one.

## Auth, identity and profiles

- **Two session contexts.** Host = `zp_session` (`COOKIE_NAME`), player = `zp_player_session`
  (`PLAYER_COOKIE_NAME`). `Session.kind` ('host'|'player') tags each row and a guard only
  accepts its own kind. `requireAuth`/`currentUser` (host) vs
  `requirePlayerAuth`/`currentPlayer` (player). `GET/PUT /api/profile` use the player guard;
  player auth lives at `/api/player-auth/{login,logout,me}`. `player:join` links a seat via the
  player cookie ONLY. A guard keys on the **cookie name**, so a session id under the wrong
  cookie name is 401 regardless of its `kind`.
- **Sign-in context follows the verified role:** `POST /api/auth/login` issues a **player**
  session for `PLAYER` and a **host** session for `ADMIN`/`TRAINER`; the role comes from
  `verifyCredentials`, never the request. `auth.html` redirects by role and its boot probes
  `/api/player-auth/me` too (the player cookie is invisible to `/api/auth/me`).
- **Roles:** `PLAYER` (Phase 6.3), `ADMIN`, `TRAINER`. `requireStaff` (ADMIN+TRAINER) guards
  quizzes/reports + the host socket. The server keeps the last-admin guards (409 on
  demote/disable of the sole admin; 403 without CSRF).
- **Neither logout endpoint has a CSRF preHandler:** `POST /api/auth/logout` and `POST
  /api/player-auth/logout` (both `{ ok: true }`). Do not change without a security review.
- **Enumeration-safe register (binding, spec §5.3):** a taken **e-mail** is answered
  **byte-identically** to a fresh registration (`{ ok: true, verificationSent: … }` derived from
  config only) and the password is still hashed to equalise timing; a taken **username** still
  returns `409 username_taken`. Do not "simplify" this back to a 409. The verification
  link/token is **never logged, in any environment** — re-issue from the UI.
- Auth endpoints have per-route limits (`limit()` in `authRoutes.ts`): login 30, register 10,
  verify 30, resend 5 /min, governed by `AUTH_RATE_LIMITS` (default on outside tests). Pass them
  as `{ config: { rateLimit: { max, timeWindow } } }` — the shorthand `rateLimit:` key fails
  typecheck (TS2559). Socket rate limiting is a separate in-memory token bucket
  (`socketRateLimit.ts`) keyed ONLY by a server-owned id (`socket:<id>` before a seat,
  `player:<playerId>` after) — a client field never moves a bucket. `SOCKET_RATE_LIMITS` is
  default on, **off in the `test` env** unless set. Current `SOCKET_RATE_RULES` (per 10 s):
  join 10, joinByAddress 60, answer 20, rejoin 15, rejoinBySocket 20. A rejected event runs no
  handler, so it can never change score or state.
- Mail via **nodemailer** from one `SMTP_URL` (`MAIL_FROM`, `MAIL_FROM_NAME`,
  `MAIL_VERIFY_TTL_HOURS` — **not** `EMAIL_…`). Unconfigured mail is a **warning**, not fatal; a
  no-op sender keeps registration working. `deployment.compose.test.ts` pins all four.
- **Guest joining stays guest-only** (nickname, no e-mail) — never gate it. A guest account
  takeover covers the **just-finished round only** (one-time, server-side claim).
- **Avatar catalogue is code in `shared`** (`characters.ts`, `cosmetics.ts`, `profile.ts`), NOT
  the DB. DB stores state only: `PlayerProfile.avatarConfig` JSONB (nullable, additive).
  Character ids: `ethan, maya, pixel, bee, dr-obscura, o-bot`. Items are
  **character-exclusive**; `validateAvatarConfig` rejects foreign items (422). Slots: backpack,
  outfit, neckAccessory, visor, wristAccessory. The server stays **permissive** on
  `selectedCharacterId` (any bounded string), so adding a character needs no backend change.
- **Do NOT stack avatar layers.** The supplied Ethan/Maya equipment WebP are NOT aligned to a
  shared canvas (owner metadata `not_defined`/`not_validated`, per-file dims differ). Preview =
  supplied figure + per-slot thumbnails; only `packages/frontend/src/avatar.ts` changes when
  aligned layers arrive. `playerAvatar(..., {crop:'head'|'full'})`: head = CSS
  `object-fit: cover` top (in-game/leaderboard), full = whole figure (podium).
- **Level curve (binding):** `requiredXp(level) = 100_000 + (level-1)*10_000`; `xpForLevel` =
  0 / 100k / 210k / 330k… `PlayerProfile.xp` is the truth and `level` is **derived on every
  read** (the column is repaired); a curve change may lower a shown level — intended, no XP
  lost. `reconcileLevelRewards(userId, level, characterId)` is the ONE idempotent grant
  mechanism (grant tx, `PUT /api/profile`, every progress/inventory/equip read) via
  `rewardItemsUpToLevel` + `skipDuplicates`.
- **Reward matrix is SLOT-based** (`shared/levelRewards.ts`): L2 outfit, L3 backpack, L4
  neckAccessory, L5 visor, L6 wristAccessory; the item is the **chosen character's** own item in
  that slot. L7+ has **no entry on purpose** (grants nothing, never blocks XP). Level 1 =
  nothing equipped. Cosmetics give **no gameplay advantage** (no pay-to-win).
- **XP/inventory are server-side only.** Never compute XP or a grant in the browser; the client
  displays what the server returns.

## Immutable game snapshot (Phase 6.4)

- **History loss (R-3) is closed by construction.** A started game reads its questions from
  `game_snapshots` (one JSONB envelope per game, unique `game_id`), never from the live quiz.
  `snapshotService.startWithSnapshot()` writes it in the **same transaction** as `startedAt`
  (from `engine.start()`), so a game never runs without a valid snapshot. Idempotent; legacy
  games with no snapshot **self-heal** on the first `quizForGame()` read.
- The 6.4 migration is **additive + data-preserving**: nullable `category`/`difficulty` on
  `quizzes`/`questions`, `games.quiz_id` nullable with `ON DELETE SET NULL`, and it **drops**
  `player_answers_question_id_fkey` (was `ON DELETE CASCADE`). **Never re-add that FK** — it
  destroyed answer history when a quiz was deleted.
- **The owner asked to replace the dropped FK with nullable `question_id` + `ON DELETE SET
  NULL`; the answer is no, with evidence (report §7).** Tested on real PostgreSQL: (A) no FK →
  id survives, report/CSV correct; (B) nullable + SET NULL → id becomes NULL and `gameReport()`
  throws; (C) `NOT NULL` + SET NULL → the quiz delete itself fails. Decisive second reason:
  `updateQuiz` **deletes and recreates every question row** on any save, so SET NULL would null
  the attribution of past games when a trainer merely renames a quiz. `question_id` is the only
  link from an answer to its question; the **snapshot** is the referential guarantee. A DB-level
  guard pins both constraints in `snapshot.integration.test.ts`.
- **Residual edge case (documented, not fixed):** a game started *before* 6.4 has no snapshot;
  if its quiz is deleted before the game is ever read, the report 409s. Self-closing for any
  game started under 6.4+.
- **`PlayerAnswer.questionId` + `updateQuiz` deleting/recreating questions means "autosave" in
  the editor is unsafe** — a save destroys the answer history of that quiz's games.
- `category`/`difficulty` are **free text** — no taxonomy is approved; a controlled vocabulary
  is an owner decision, not a cleanup.
- Editor pitfall: `validateQuiz` issue paths use the **dot** form (`questions.0.difficulty`), so
  the editor's matcher must be `/^questions[.[](\d+)[\]]?/`, not `questions[0]`.
- **`questionForm.ts` merge rule:** the form is not re-rendered between edits, so all handlers
  must merge into a single `latest` holder via `update(patch)`. Spreading the original `question`
  snapshot silently discards every earlier edit (`questionForm.test.ts`).

## Platform facts worth keeping

- **13 question types**, server-authoritative engine, **14 Prisma models**, Argon2id + server
  sessions + CSRF + strict CSP.
- **Capacity measured** (`tools/loadtest.mjs`): 25 players → join wall 95 ms, answer p95 28 ms,
  135 MB RSS; 35 players → 134 ms / 35 ms / 143 MB. Target "25 + host" is comfortable on one
  process.
- **Missing / data-only (verified in code):** `GamePlayer.team` and `ideas` voting are
  data-only (team mode is not a real mode); sound (6.11) and scene-specific background motifs
  are not started.
- **Q1–Q7 in `docs/architecture/README.md`** (scoring formula, "too fast" threshold, cheat-report
  signals, team assignment, IP retention, tie-breakers, self-paced mode) are the owner's calls.
  The engine exposes them as named `ScoringConfig`/`SpeedPolicy` options with documented
  defaults rather than hard-coded guesses. **Do not copy NoPeek's scoring formula and never
  store IPs.**
- **Binding product decisions (Phase 5c, PR #17)** — docs only: XP = quiz points + placement
  bonus 1500/1000/500; voluntary registration with verified email; guest-account takeover of the
  just-finished round only; items character-exclusive and visibly equippable; personal stats
  player-visible but quiz history **admin-only**; immutable `GameSnapshot` per game; random
  background once per round; show audio host-only; default language German; Redis not required at
  start; 25 players + host.
  **Superseded — never resurrect:** `10 XP/answer`, the `100 × (n−1)^1.5` 7-level curve,
  separate beamer route/show-token, `GET /api/profile/history`, single global cosmetic catalog.
- **Vite dev-proxy trap:** the rule must be `'^/api/'`, not `'/api'` — a bare `/api` prefix also
  swallows the client module `/api.ts`, which Vite serves from the project root.
  `server.allowedHosts` must include `'.prod-runtime.all-hands.dev'`.
- **Favicon: never auto-key it.** `favicon.png` has **no alpha** and its background is not
  homogeneous white (only ~30.4 % near-white), so automatic background removal would eat the
  artwork — request a **transparent master file** from the owner instead.
- Owner is **Dejan Popovic** (sole decision-maker). **chrisB is NOT an approver/blocker** — one
  factual mention remains that chrisB supplied the original NoPeek raw version.
- Docs convention: a new `.md` under `docs/` must pass `npm run format:check` (run
  `npx prettier --write` on it); Prettier reflows tables, that is expected. Historical reports
  keep their original "awaiting approval" body — add a dated "historical snapshot" note instead
  of rewriting. `docs/phases.md` + the roadmap status tables are the living status documents;
  update those. **Every phase adds its own `docs/phases.md` row in its feature commit.**
- **Before implementing a phase, diff the request against real `main`** — several phases were
  partly pre-built (e.g. the profile page existed before 6.6.2). Check `grep '^model '
  …/schema.prisma`, `ls …/prisma/migrations/`, `ls …/src/{routes,services}`, and the
  `*.integration.test.ts` names.

## Finale-Feuerwerk (Podium) — Phase 6.11.2 / 6.11.3
- `packages/frontend/src/finaleEffects.ts` ist **host-only**. Isolations-Test verlangt:
  kein `finaleEffects`/`finale-fireworks`/`finale-crowd` in `pages/` außer `host.ts`.
- Timeline-Vertrag (nicht ändern): `ROCKET_MS=0`, `EXPLOSION_MS=1500`, `CROWD_MS=2100`,
  `FINALE_END_MS=7000`; Audio-Reihenfolge Feuerwerk→Applaus, idempotent pro `gameId`.
- **"Animation unsichtbar" = Fläche messen, nicht Code lesen.** 6.11.2 malte nur 0.19–0.25 %
  der Fläche (1 Rakete mittig, 1 Burst) → auf dem Beamer nicht zu sehen. 6.11.3-Rewrite
  (Script aus 10 Raketen + 7 Bursts + 10 Nachzüglern, additive Blending) erreicht
  **0.74 % im Aufstieg / 4.07 % Peak / 1.2–2.1 % bis 6.9 s**.
- **Per-Frame-Emitter brauchen ein Sub-Budget.** Trails füllten `MAX_PARTICLES` und
  `add()` verwarf danach die Bursts lautlos → Bild wurde zum Feuerwerks-Zeitpunkt
  *dunkler*. Jetzt `MAX_TRAIL_PARTICLES=300` in `MAX_PARTICLES=900`, `kind:'trail'`,
  Zähler in `step()` per `reduce` neu berechnet.
- Podium bleibt lesbar: Canvas `z-index:40` < Board `41`, `pointer-events:none`
  (load-bearing). Karte nur 0.18 % verändert vs. No-Animation-Baseline.
- Mess-Harness (scratch, `/tmp/vis/`): Fake-Clock + manuelle `frames`-Queue, dann
  `getImageData()` → Pixelzahl/BBox/Drittel; Ausgabe via `<pre>` + `chromium --dump-dom`
  (keine Screenshots nötig). `--dump-dom` und `--screenshot` **nie im selben Lauf**
  (Screenshot-Modus liefert kein DOM) → zwei Pässe; `--window-size=1920,993
  --force-device-scale-factor=1` für die Referenzauflösung.
- **Fläche kommt von Wolken, nicht von Partikeln.** `Cloud`-Layer (weiche
  Radialgradienten, eigenes Array, `MAX_CLOUDS=28`) bringt 4 % → 15–34 %; mit Punkten
  allein ist bei ~5 % Schluss. Gradient braucht ein **Plateau** (4 Stops:
  1.0 / 0.78@50 % / 0.3@80 % / 0), sonst wird es ein Schleier statt eines Feuerwerks.
- **„Deckung“ mit Alpha>0 ist wertlos** — immer Alpha-Histogramm messen
  (>8 wash / >64 body / >128 hot / >200 core). Zielkorridor 6.11.3: body>64 ≈ 22 %
  bei wash>8 ≈ 32 %. `MAX_PARTICLES=1600`, `MAX_TRAIL_PARTICLES=360`.
- **Lesbarkeit ≠ geometrisches Keep-out.** Halo kann größer als der Frame sein. Die
  gültige Invariante ist die **Alpha auf dem Text** (Test: Gradientwert an 3 Textpunkten
  < 0.18; Browser: Canvas-Alpha unter dem Siegertext 0–3.6/255, Textkontrast 9.57
  identisch mit/ohne Animation). `placeBurst()` ist aktiv und verschiebt Bursts aus
  der Keep-Out-Ellipse.

## NoPeek reference project

- Reference app **NoPeek** lives at `https://nopeek.projekt-chrisb.de`. No ZIP/source archive is
  stored here — analyse it by fetching the **unminified** client assets: player at `/` (default
  ns), host at `/host`; player.js, host.js, editor.js, common.js, clock.js, quizschema.js,
  avatars.js, branding.js, app-config.js. `/var/tmp/nopeek/` is wiped on restart.
- NoPeek specifics: Kahoot-style **clock-offset sync** (`clock` ping/pong, best-of-N, re-sync
  after the WS upgrade) drives an absolute `at`; `leadMs` read-aloud lead; host events
  `lock`/`close`/`review`/`review-end`; player `avatar`/`qa:*`; `build` reload guard; the same 13
  question types; team mode; QR code; animated board/podium; per-type reveal views;
  CSV+Excel+print reports; homework mode; email 2FA. Scoring = base + speed bonus with
  double/none; exact numbers are server-side. **Analysis only — do not copy.**
- ZeroPeek's comparison docs live in `docs/analysis/nopeek-comparison/` (PR #9).

## Phase 6.10 — round backgrounds (merged, PR #54)

- Ten owner-supplied WebP files in `packages/frontend/public/backgrounds/` (`zeropeek_*.webp`),
  integrated **byte-identically** (SHA-256 checked). **Never re-encode.** `unzip` is NOT
  installed — use Python `zipfile`.
- `packages/shared/src/backgrounds.ts` is the only source of truth; catalogue ids are derived
  **from filenames only** (no image analysis, per briefing §29–31): `synthwave_skyline`,
  `synthwave_weltraum`, `synthwave_wueste`, `synthwave_megacity_detail`,
  `synthwave_bruecke_zwei_berge`, `synthwave_forschungsstation_muted`,
  `synthwave_lagerhalle_minimal`, `synthwave_raumstation_ohne_boden`,
  `synthwave_unterwasser_v3`, `palmen_tron_background`.
- **`RANDOM_BACKGROUND` (`'random'`) is resolved server-side, once.** Clients only send the
  sentinel; `resolveBackgroundChoice()` returns a concrete id or `undefined`. Never let a client
  pick an id itself — two devices would roll two images.
- The background is chosen in `engine.create` and appended as a `background` `GameEvent`; it is
  **never** re-rolled by join/start/question. No migration — `load()` restores the last valid
  event, so `engine.evict()` is the restart-path test. `setBackground()` is idempotent.
- The frontend paints one inert `[data-round-background]` div and only rewrites
  `--round-background` (no DOM recreation); `backdrop.css` adds a dark scrim so quiz text stays
  readable on any motif.
- **Open product decision:** no image is mapped to a specific screen (lobby/final/podium). The
  ten files are a round-wide pool; motif→scene mapping is the owner's call.

## Host background music (Phase 6.11, branches `feat/phase-6-11-host-music` + `-continuous-music`)
- **The track is the round's bed, not a question cue** (owner decision): it starts with
  the first question and stops only at real game end. Rule lives in `shouldPlay`:
  `paused → false`; `question|reveal|board → true`; `lead → running` only. `lead` never
  starts the track (pre-game countdown silent), so no question counter is needed —
  `question/reveal/board` are unreachable before question one, which is the proof the
  round is under way. `sync()` early-returns when intent is unchanged, so phase
  transitions issue **zero** `play()`/`pause()` — one play per round, one pause at `end`.
  There is **no `lead` between questions** today (`enterLead()` only from `start()`,
  `next()` goes `board → question`); the rule handles it anyway.
- **Caddy 2.8.4 has no `mime` directive.** `caddy validate` fails with
  `unrecognized directive: mime`; do not add a `mime {}` block to
  `docker/Caddyfile.frontend`. `.ogg` is already in Caddy's **built-in** table:
  serving a real `.ogg` returned `Content-Type: audio/ogg` with **no**
  `/etc/mime.types` present (verified by running the downloaded 2.8.4 binary on a
  spare port). The Caddyfile needs no change for audio.
- **Audio asset path is fixed by the briefing**: `public/audio/music/<name>.<ext>`
  (`ASSET-BRIEFING.md` Block G), so the module constant is
  `/audio/music/question-background.ogg`. Vite copies `public/` to `dist/`, and
  `docker/frontend.Dockerfile` copies `dist` — no Dockerfile change needed.
- **jsdom has no media pipeline**: `HTMLMediaElement.play/pause` are unimplemented
  and log `Not implemented:` to stderr. Any page test that reaches the `question`
  phase hits it, so stub both in the file-level `beforeEach` of
  `hostPage.test.ts` (not per block).
- Player/host isolation is enforced **structurally** by tests in
  `design-system.test.ts`: `pages/player.ts`, `playerView.ts` and `index.html`
  must not contain `hostMusic` or `/audio/`. Verified by temporarily importing the
  module into `player.ts` (test fails as intended). Re-check bundle isolation with
  `grep -c "audio/music" dist/assets/index-*.js` → must be 0.
- `design-system.test.ts` keeps a **class list** that must contain every styled
  class; a new `.music*` class that is missing there is silently unguarded.
- CSS breakpoint trap: `auth.test.ts` anchors on
  `tokens.lastIndexOf('@media (max-width: 480px)')`. A new media query **at 480px**
  in `tokens.css` breaks it — use another width (560px used here).
