# Project memory — IHK Prüfungsübersicht

Durable, expensive-to-learn facts about this repo. Deep detail belongs in the
daily logs; keep this file short.

## Local verification environment (rebuild after any sandbox restart)

`/tmp` is wiped on restart, so keep verification assets in `/var/tmp/ihkverify/`.

```bash
# DB + servers
DATABASE_URL="file:/var/tmp/ihkverify/ihk.db" npx -w backend prisma db push --skip-generate --accept-data-loss
DATABASE_URL="file:/var/tmp/ihkverify/ihk.db" ADMIN_TOKEN=testtoken ADMIN_PASSWORD=testpass123 PORT=12001 npm -w backend run serve &
cd frontend && BACKEND_URL=http://localhost:12001 npx next start -p 12000 &

# browser automation (puppeteer-core, NOT puppeteer — chromium is already installed)
cd /var/tmp/ihkverify && npm install puppeteer-core@23
# executablePath: /usr/bin/chromium, args: --no-sandbox --disable-dev-shm-usage
```

- Credentials: `admin` / `testpass123`, `pruefer1` / `prueferpass1` (create the
  examiner via `POST /api/users`).
- An **empty** DB makes `GET /api/ihk*` return **503** ("no data available
  yet") — that is expected, not a bug. Seed a `SUCCESS` `ImportRun` + `Sheet` +
  `IhkLocation` rows to get real content. `GET /api/ihk*` also needs auth.
- `@prisma/client` resolves from the **repo root** `node_modules`, not
  `backend/node_modules`.

## ZeroPeek repo (github.com/dejowebdesign/ZeroPeek)

- Was an **empty scaffold** (`ebbdd79` "Initial commit", only a 1-line README).
- Stack declared by the customer: TypeScript, Node.js, Socket.IO, PostgreSQL, Docker.
- Remote `origin` is set; develop on per-phase branches, e.g. `phase-0/project-foundation`,
  `feat/ci-docker-portainer`.
- **Do not push / open PRs without explicit approval** — the user stops for approval at the
  end of every phase.
- Phase 0 layout: npm workspaces `packages/{shared,backend,frontend}`; docs/architecture holds
  7 ADRs; `docs/reports/phase-N.md` holds the per-phase report. Open product questions are
  tracked as Q1–Q7 in `docs/architecture/README.md` (scoring formula, "too fast" threshold,
  cheat-report signals, team assignment, IP retention, tie-breakers, self-paced mode).
- **State on `main` @ `1cf30be` (PR #15, favicon + admin logo link) is far past Phase 0**: the
  whole domain is implemented — 13 question types, server-authoritative engine, 2 socket
  namespaces, 4 surfaces (player `/`, host/beamer `/host.html`, editor, admin), 8 Prisma models,
  Argon2id + server sessions + CSRF + strict CSP. `npm ci` → `prisma:generate` → `typecheck` →
  `test` → `build` → `format:check` all green.
  **CORRECTION (Phase 5b): with a real PostgreSQL all DB suites run → 181 tests green (94 backend
  + 25 frontend + 62 shared).** The engine is verified by integration tests, NOT by browser E2E
  (R-1 disarmed, R-12 still open). Recipe:
  `CREATE DATABASE zeropeek_test`, expose it (socat `-p 15432:5432` on the compose network), set
  `TEST_DATABASE_URL` + `DATABASE_URL`, `prisma migrate deploy`, `npm test`.
- **Missing entirely (only `avatar String` free-text exists)**: profiles, XP/level/inventory/
  achievements, a standalone beamer surface (the host page IS the beamer), sound, show graphics,
  global leaderboards. `GAME_PHASES` declares `lead` but it is never entered; `GamePlayer.team`
  and `ideas` voting are data-only. **Player accounts/registration now EXIST (Phase 6.3,
  `feat/phase-6-3-auth-registration`):** role `PLAYER`, `email_verified_at`, `email_verification_tokens`,
  `POST /api/auth/{register,verify,resend}`, an auth page (`auth.html`) with the starfield login.
- **Landmines found (verified, not assumed):** (1) `PlayerAnswer.questionId` is
  `onDelete: Cascade` and `quizService.updateQuiz` deletes+recreates all questions, so **editing a
  quiz destroys the answer history of its games** — so "autosave" in the editor is unsafe.
  (2) `engine.get()` rebuilds state after a restart but sets `openedAt=null`, no timer, and
  `answeredQuestionId=null`, so a running question never auto-reveals and a repeat answer hits
  Prisma P2002 → generic 500. (3) `player:rejoin` does not re-send the current question (R-5).
  (4) **No rate limit on socket events** (`@fastify/rate-limit` is HTTP-only) and **no Redis
  socket adapter** despite `redisUrl` (single-instance design).
- **Assets (Phase 5b, optimised in the working tree):** `logo.png` 2172×724 RGBA 1.2 MB →
  **480×160 / 81 KB**; `favicon.png` 1254² RGB no-alpha 1.63 MB → **256² / 110 KB**; orphaned
  `favicon.svg` **removed**; dead CSS rule `.brand-mark` **removed**. Favicon border is **not**
  homogeneous white (RGB 200–255; only 30.4 % near-white) → do NOT auto-key-out transparency;
  a transparent master must come from the project owner (Dejan Popovic).
- **Branding is fine — no "double Z":** the DOM renders exactly one `<img class="brand__logo"
  src="/logo.png">`; `.brand-mark` (a gradient square that used to hold a "Z") is dead code.
- **Logo palette (measured):** 38.9 % violet/indigo (255–285°), 23.2 % cyan (≈187°), 17.5 %
  magenta, 20.3 % blue, 14.9 % silver. Existing tokens `#7c5cff`/`#22d3ee` are in-family but not
  exact — propose a brand accent ladder alongside, never overwrite the tokens.
- **Capacity measured (Phase 5b, `tools/loadtest.mjs`):** 25 players → join wall 95 ms, answer
  p95 28 ms, 135 MB RSS; 35 players → join 134 ms, p95 35 ms, 143 MB. Target "25 + host" is
  comfortable on one process; R-2 only matters for several hundred players.
- **Engine tempo (by design):** `REVEAL_MS = 6000`, `BOARD_MS = 6000`, `ANSWER_GRACE_MS = 1500`;
  a full question cycle ≈ 12 s + answer time. Host can force "next" at any time.
- **The Phase 1–5 concept docs were first committed in Phase 5b** (they had existed only in the
  working tree; PR #9 was closed unmerged). `main` now holds them via PR #16, extended by Phase 5c
  (PR #17).
- **Phase 1–5 concept deliverables** (docs only, no code): `docs/analysis/
  phase-1-technical-inventory.md`, `docs/concept/{design,game-design}-concept.md`,
  `docs/concept/README.md`, `docs/roadmap/technical-roadmap.md`, `docs/assets/ASSET-BRIEFING.md`,
  `docs/reports/phase-5-concept-report.md`, plus `docs/reports/phase-5b-revision-and-first-works.md`.
  They answer the blockwelt-heroes brief and list the
  open decisions; the project waits for the project owner's approval + character/beamer/audio assets before
  any Phase 6 implementation. **Do not start Phase 6 or generate any images/characters.**
- **Phase 5b merged** (`main` = `f6582c4`, PR #16, "Konzeptüberarbeitung, Asset-Optimierung und
  gemessene Kapazität"). **Phase 5c** (`docs/phase-5c-product-decisions`, PR #17) folds the owner's
  **binding product decisions** into the docs — docs-only, no code/schema/migration/assets:
  XP = quiz points + placement bonus 1500/1000/500; level curve L1→L10 = 10.000 each, L10→L11 =
  11.000 then +1.000 each; voluntary registration with verified email; guest-account takeover of the
  **just-finished round only** (one-time, server-side claim); items are **character-exclusive** and
  visibly equippable; personal stats player-visible but quiz history **admin-only**; immutable
  `GameSnapshot` per game (R-3 defused); random background once per round; show audio host-only;
  default language German; Redis not required at start; 25 players + host (load-test ~35).
  **Superseded — never resurrect:** `10 XP/answer`, `100 × (n−1)^1.5` 7-level curve, separate beamer
  route/show-token, `GET /api/profile/history`, single global cosmetic catalog.
- Owner is **Dejan Popovic** (sole decision-maker). **chrisB is NOT an approver/blocker** — one
  factual mention remains that chrisB supplied the original NoPeek raw version.
- Docs convention: new `.md` under `docs/` must pass `npm run format:check` (run
  `npx prettier --write` on them); tables get reflowed by Prettier, that is expected.
- Frontend decision is **Vanilla TS + Vite multi-page** (player/host/editor), NOT Angular —
  reasons in ADR 0002; strict CSP forbids inline styles so the client styles via the CSSOM.
- Deployment (Phase 0.5): `.github/workflows/docker-publish.yml` publishes
  `ghcr.io/dejowebdesign/zeropeek-{backend,frontend}` (tags `sha-<short>`, `main`, `latest`);
  `docker-compose.portainer.yml` is the self-contained production stack (no `build:`, Caddyfile
  inline via Compose `configs.content`, only the proxy publishes a port). Docs in
  `docs/deployment/`. CI (`ci.yml`) is PR-only; publish workflow owns `main`+tags.

### Fresh-checkout trap (broke real CI, found by `act`)

`packages/shared` exposes `dist/` only (`main`/`types` point at `dist`). A clean clone has no
`dist`, so typechecking backend/frontend fails with `TS2307: Cannot find module '@zeropeek/shared'`.
The root `typecheck`/`test` scripts must therefore run `build:shared` first. Never reorder them.

### Verifying workflows without a real push

`act` (nektos) runs the workflow in a container: `sudo /tmp/act push -W
.github/workflows/docker-publish.yml -j verify -P ubuntu-latest=catthehacker/ubuntu:act-latest
--pull=false`. Note: **act < 0.2.86 has known CVEs** — use 0.2.94+. `actionlint` catches
expression errors. The sandbox has no GHCR creds, so a real `docker push` can't be tested here;
build locally with the exact GHCR tag instead.

### Real pipeline facts (confirmed on GitHub, not just locally)

- `docker-publish.yml` on `main` really works: run `41497604769` → verify ✓, both
  images published (`main`, `latest`, `sha-6db36e1`), deploy job skipped cleanly (no
  `PORTAINER_WEBHOOK_URL` secret). This is the authoritative test; the sandbox cannot push.
- The repo and its GHCR packages are **public**, so Portainer pulls anonymously — no registry
  credentials needed. `.env.portainer.example` default `ZEROPEEK_IMAGE_TAG` can stay `latest`
  or be pinned to a `sha-…`.
- Pushing from this sandbox: `gh auth setup-git` fails and plain `git push` prompts for a
  username (non-interactive → hangs). Use a one-shot URL
  `git push "https://x-access-token:${GITHUB_TOKEN}@github.com/...git" HEAD:<branch>`, then
  **immediately** `git remote set-url origin <clean>` **and** unset
  `branch.<name>.remote/.merge`, because `git push` writes the token-bearing URL into
  `.git/config` (verified: it does).

### Docker trap found here (cost ~1 build cycle)

`tsc` with `composite: true` leaves `*.tsbuildinfo` in the package dir. If those files get copied
into a Docker build context, `tsc` thinks the package is already built and emits **no** `dist/`,
so dependents fail with `TS2307: Cannot find module '@zeropeek/shared'`. `.dockerignore` must
contain `**/*.tsbuildinfo` (and `**/dist`). Also: in this sandbox the Docker socket needs
`sudo docker ...`; the daemon must be started with `sudo dockerd > /tmp/docker.log 2>&1 &`.

### Postgres `unhealthy` in the Portainer stack (root cause)

`dependency failed to start: container zero_peek-db-1 is unhealthy` == **empty `POSTGRES_PASSWORD`**.
The postgres entrypoint aborts a fresh init (`Database is uninitialized and superuser password is
not specified`), the container restart-loops, and the backend's `depends_on: service_healthy`
kills the deploy. Fix: `:?` guards on `POSTGRES_DB/USER/PASSWORD` in `docker-compose.portainer.yml`
so Compose fails fast with a clear message. Do **not** guard `DATABASE_URL`/`REDIS_URL`/
`APP_BASE_URL`/`SESSION_SECRET` — the Phase 0 backend boots without them.

`pg_isready` is a **bad** healthcheck on its own: it returns 0 for a nonexistent user *and*
database. The loopback address (`127.0.0.1`/`localhost`) is `trust` in the image's `pg_hba.conf`,
so `psql -h 127.0.0.1` accepts *any* password. A login-validating probe must use
`psql -h "$(hostname)"` (or the service IP) — that path is `scram-sha-256` and rejects a wrong
password. `POSTGRES_DB/USER/PASSWORD` are only applied on **first** volume init; on an existing
volume they are ignored. A failed init leaves the volume empty, so retrying with a correct
password recovers with no data loss.

### Compose interpolation facts

- `$$` in a `healthcheck.test` is escaped and reaches the container as a single `$`, so the
  variable is read from the *container* env at runtime (verified via `docker inspect`).
- A single `$` in an `.env` *value* is still interpolated by Compose (`p@ss$word` → `p@ss` +
  warning). A literal `$$` survives.
- `${VAR:?msg}` fails the deploy for both **unset** and **empty** values — the desired behaviour.
- **Per-route rate limit** in Fastify: pass it as `{ config: { rateLimit: { max, timeWindow } } }`,
  NOT the shorthand `rateLimit: {...}` key (that fails typecheck, TS2559). Used for the
  unauthenticated auth routes (Phase 6.3). Nothing else in the repo sets per-route limits.
- **Mail env var is `MAIL_VERIFY_TTL_HOURS`** (`config.ts`), with `SMTP_URL`, `MAIL_FROM`,
  `MAIL_FROM_NAME`. `deployment.compose.test.ts` now pins all four across both compose files + docs.
- **Backend DB tests need BOTH `DATABASE_URL` and `TEST_DATABASE_URL`** — Prisma itself reads
  `DATABASE_URL`, so overriding only `TEST_DATABASE_URL` still hits the (often dead) default.

## Testing gotchas

- `npm -w backend test` takes ~3 minutes (change-detection tests sleep ~19s
  each). Not a hang.
- Frontend tests parse `globals.css` as **text** (regex on rule bodies), so CSS
  refactors can break them without any runtime change. `rule(selector, marker)`
  disambiguates repeated selectors by a declaration unique to the rule.

## Verifying a glass / backdrop-filter header

CSS `@supports` cannot be disabled from JS (`CSS.supports` monkey-patching does
nothing) and Chromium has **no flag** to turn `backdrop-filter` off
(`--disable-blink-features=BackdropFilter`, `--disable-features=BackdropFilter`
are both ignored). To prove the blur actually renders:

1. Inject `style` hiding `.site-header__inner > *` (keep the surface + fill).
2. Screenshot, then inject `backdrop-filter:none !important` and screenshot.
3. Compare **mean absolute horizontal luminance gradient** inside the bar band.
   Real measured result: 0.42x (normal) / 0.35x (compact) sharpness with the
   blur on. Sharpness alone does not separate blur from flat fill — a
   translucent fill also lowers edge energy — so the on/off pair is required.

Never assert `getComputedStyle().backdropFilter` as proof: it reports the
declared value even when the feature is unsupported.

## CSS cascade trap found here

A `@media` block adds **no specificity**. The old
`@media (max-width:560px) { .session__user { display:none } }` (line ~1390) was
silently defeated by the later plain `.session__user { display:flex }` (line
~1773), which caused a real **105px horizontal overflow at 320px** in the
header. When adding a mobile override, place it *after* the base rule or
out-specify it.

## Phase 12 header — durable facts

- **The username MUST NOT appear in the header** (superseded 2026-10-31 by an
  explicit customer correction — the earlier "§3 Benutzername" reading was
  reversed: "admin ADMINISTRATOR" was a duplicate display they rejected). Show
  **only** the role badge: `.session__role` with `roleLabel()` →
  admin "Administrator", examiner "Prüfer". No tooltip with the name either.
  `.session__user` / `.session__name` are deleted — do not reintroduce them.
  Then `.session__logout` (icon + `.session__logout-text`, text hidden ≤560px).
- **`--header-h` must equal `--header-bar-h` at every breakpoint.** The band
  reserved 116px for a 96px bar (20px dead space) and the ≤768px block lowered
  the bar to 84px without the band (12px gap on mobile). Both showed as an empty
  strip between the bar and the hero. `<main class="page">` begins at
  `--header-h`, so the surplus is immediately visible.
- **Hero flush = `.page:has(> .hero) { padding-top: 0 }`.** `:has()` scopes it
  to pages whose first child is a full-bleed band; other pages keep
  `padding: 28px 0 56px`. Any other page needing to sit flush should use the same
  pattern rather than a blanket `.page` change.
- **Header grid must be `minmax(0,1fr) auto minmax(0,1fr)`.** Plain `1fr` tracks
  refuse to shrink, so the identity block pushes the bar wider (measured 21–44px
  overflow at 320–600px). Below 1049px collapse the middle *track* to `0`
  (`auto 0 minmax(0,1fr)`) — never `display:none` the `.header__center`, because
  `.nav--open` is its child and would vanish with it.
- **Band height is constant** (`--header-h`); the bar compacts inside it, so the
  page never reflows. The floating gap is padding on the sticky `.site-header`,
  not a child margin (a sticky child margin collapses and the gap vanishes).
- Shrink is **width-first** (max-width transition, like the reference), NOT a
  `scale()` transform (which blurs text). 240ms `cubic-bezier(.22,.61,.36,1)`.
- Reference glass = `rgba(9,16,30,.76)` + `blur(18px) saturate(150%)` + radius 22
  + hairline `rgba(110,168,254,.14)`. `sachkunde.duckdns.org` is Angular, so its
  header only exists after JS runs — measure it in a browser, not via curl.
- Logo: `frontend/public/ihk-logo.png`, embedded verbatim; `findLogo()` in
  `layout.tsx` picks the first existing of `ihk-logo.png`/`logo.png`/`logo.svg`.

## Vitest traps

- A local `const x = vi.fn()` shadows a module-level helper named `x`; the test
  then silently calls the spy. Rename spies to avoid collisions.
- `supportsRule(sel)` returns the first match after an `@supports`, which may be
  the base rule; assert on the raw `css` string when in doubt.

## Reverse-engineering audit: NoPeek (nopeek.projekt-chrisb.de), 2026-11-02

Target is a live-quiz web app ("ChrisBy Quiz" module). Full analysis artifacts in
`/var/tmp/nopeek/` (assets/, pages/, shot/*.png). **Analysis only — no implementation yet.**

- **Stack (confirmed):** vanilla JS (no framework), Socket.IO **v4.8.4** (client bundle
  served from `/socket.io/socket.io.min.js`), EIO=4 polling-first then upgrade, REST +
  HttpOnly cookie session + `X-CSRF-Token` + `X-Requested-With: fetch`, strict CSP, behind Cloudflare.
- **All client code is public & unminified:** `/player.js` (33 KB), `/host.js` (72 KB),
  `/editor.js` (24 KB), `/quizschema.js` (domain model + validation), `/avatars.js` (SVG
  catalogue), `/common.js`, `/branding.js`, `/account.js`, `/register.js` + 9 CSS files.
- **Socket.IO namespaces:** player = `/` (default), host = `/host` (auth-gated →
  `connect_error` msg `unauthorized` / `terms_required`).
- **Server is NOT public.** Payload shapes are *inferred from client code*, never observed
  live (no login → no game). Mark as high-probability, not confirmed.
- Pages: `/` (player), `/host`, `/register`, `/konto`, `/datenschutz`,
  `/nutzungsbedingungen`, `/impressum`. No sitemap/manifest.json/favicon.ico/sourcemaps.
- Socket.IO POST upgrade from raw urllib got **403** (Cloudflare WAF); GET handshake works.

## Repo: dejowebdesign/ZeroPeek (updated 2026-11-02, evening)
- Public GitHub repo. Default branch `main`. npm-workspaces monorepo:
  `packages/{shared,backend,frontend}`, `docs/`, `docker/`, 2 compose files.
- Stack: TS strict, Fastify 5 + Socket.IO 4 + Prisma, PostgreSQL 16, Redis 7,
  Caddy, Vanilla-TS + Vite frontend. Node 22 in CI, 24 locally.
- **Status: Phase 0 AND Phase 0.5 complete + PostgreSQL fix merged.**
  PRs #1 (CI/GHCR/Portainer), #2 (postgres healthcheck) merged into `main`.
  `main` HEAD `b29b318`. Branch `phase-0/project-foundation` **no longer exists**
  (the old briefing still references it — don't trust that).
- **GHCR images are published and PUBLIC** (anonymous pull works, verified):
  `ghcr.io/dejowebdesign/zeropeek-backend` / `-frontend`, tags `latest`, `main`,
  `sha-<short>`. Repo is public ⇒ Portainer needs no registry credentials.
- `docker-publish.yml` already runs verify→publish(both images)→deploy and has
  succeeded on `main`. `ci.yml` is pull_request-only. Triggers are disjoint.
  The `deploy` job **skips** (not fails) while `PORTAINER_WEBHOOK_URL` is unset.
- Verification commands: `npm install && npm run typecheck && npm test &&
  npm run build && npm run format:check` → 21 tests (7 backend / 5 frontend /
  9 shared). `npm test` builds shared first (`build:shared`) — a fresh checkout
  breaks typecheck otherwise.
- **Caddy/compose trap:** Compose interpolates `$` inside `configs.content`, so
  a Caddy `{$VAR:default}` placeholder is mangled (`{localhost::80}`), and `$$`
  is NOT unescaped there either. Build the site address with Compose instead:
  `${ZP_SITE_ADDRESS:-:80}`. Also `auto_https on` is **invalid** Caddy syntax.
- **TLS switch (as of PR #3):** set `ZP_SITE_ADDRESS=<domain>`,
  `CADDY_CONTAINER_PORT=443`, `HTTP_PORT=443` together. Empty `ZP_SITE_ADDRESS`
  = plain HTTP on :80 (default). `ZP_DOMAIN` is removed — don't reintroduce it.
- **Proxy host port default is 3737** (as of PR #4), NOT 80: port 80 is often
  already bound on the Docker host → `failed to bind port 0.0.0.0:80/tcp`. Only
  the *left* side changed; `CADDY_CONTAINER_PORT` (80 HTTP / 443 TLS) and the
  embedded Caddyfile are untouched, so the proxy healthcheck (probes the
  container port) needs no change. `docker-compose.yml` (dev) is a separate
  file and still uses `PROXY_PORT:-8080`.
- Test the stack without touching real data: `docker compose -f
  docker-compose.portainer.yml --env-file <env> -p <proj> up -d`, then `down -v`
  (unique `-p` keeps named volumes separate). Start dockerd with
  `sudo nohup dockerd > /tmp/docker.log 2>&1 &` (needs ~12 s).
- Untracked workspace files that are NOT from the repo: `nopeek-audit.md`.
  `.openhands/memory/MEMORY.md` **is** tracked in git (added in PR #2), so edits
  to it show up in `git status`; keep it out of feature PRs.

## ZeroPeek: platform status (verified 2026-11-02, branch `feat/full-platform-implementation`)
- **Phases 1–7 are implemented and green.** Earlier notes calling `host.html` /
  `editor.html` "Phase 0 placeholders" are OBSOLETE — delete-on-sight.
  Backend routes: `authRoutes` (`/api/auth/login|logout|me`), `quizRoutes`,
  `reportRoutes`, `adminRoutes`. Services: `engine`, `gameService`, `quizService`,
  `reportService`, `userService`. Pages: `player.ts` (index.html), `host.ts`,
  `editor.ts`, `admin.ts` (added this session).
- **Socket.IO namespaces: player = default `/`, host = `/host`** (host is
  auth-gated). Client wrappers live in `packages/frontend/src/socket.ts`.
- **Contract traps that cost real debugging time:**
  - `host:create` ACKs with `{ gameId, pin }` — **not** `{ id, pin }`.
  - `host:join` ACKs with `{ pin, players }` — resume must paint `players`.
  - Game report route is `/api/reports/games/:id` and the body is
    `{ quiz: { id, title, questionCount }, players, questions }` — **not**
    `/api/reports/:id` with a flat `quizTitle`.
  - Server rejects a quiz with **zero questions**, so "New quiz" must seed one
    question and the editor must block removing the last one.
- **`questionForm.ts` merge bug (fixed):** the form is not re-rendered between
  edits, so all 28 handlers must merge into a single `latest` holder via
  `update(patch)`. Spreading the original `question` snapshot silently discards
  every earlier edit. Regression test: `questionForm.test.ts`.
- **Vite dev-proxy trap:** the rule must be `'^/api/'`, not `'/api'` — a bare
  `/api` prefix also swallows the client module `/api.ts`, which Vite serves
  from the project root, breaking the page. `server.allowedHosts` must include
  `'.prod-runtime.all-hands.dev'` or the proxied hostname is rejected.
- **Module E**: `admin.html` + `pages/admin.ts` are new files. Server keeps the
  last-admin guards (409 on demote/disable of the sole admin; 403 without CSRF).
- Q1–Q7 in `docs/architecture/README.md` are still unanswered and block the
  Phase-5 product decisions; the engine exposes them as named `ScoringConfig` /
  `SpeedPolicy` options with documented defaults rather than hard-coded guesses.
- Portainer stack and `docker-publish.yml` (verify → publish → optional Portainer
  webhook) were already in place and reviewed as sound; do not rebuild them.

## Portainer/DB config fix (PR #6, 2026-11-03, branch `fix/portainer-config-and-db-url`)
- Two causes of `FATAL: database not reachable after 30 attempts.`: a placeholder
  `DATABASE_URL` passed through unguarded, **and** `loadConfig` using `??` — an
  empty string is treated as set, and an empty `CORS_ORIGIN` makes
  `@fastify/cors` throw → `/api/health` = 500 even with a reachable DB. Only the
  real Docker stack exposed the second one.
- Rule going forward: use `isNonEmpty(env.X)` for every string fallback; never
  `env.X ?? default`.
- `DATABASE_URL` is now derived from `POSTGRES_*` (percent-encoded password);
  `ConfigError` fails fast in production; backend `restart: on-failure:5`
  (verified: still auto-starts after a `dockerd` restart, bounded retries).
- Prisma 6 auth errors have **no `code`** — match the message text.
- Detail: `.openhands/memory/2026-11-03.md` and `docs/reports/portainer-config-fix.md`.

## CI trap: the Prisma client is NOT generated by `npm ci` (cost ~1 h to find)
- `@prisma/client` ships as a **stub**. `npm ci` installs it but does not run
  `prisma generate`, so `node_modules/.prisma/client` does not exist and the
  backend will not compile: **28 errors** (TS2305 "no exported member
  PrismaClient/Prisma/UserRole/InputJsonValue/GameUpdateInput" plus a cascade of
  TS7006 implicit-any in every callback that receives a Prisma row).
- Both `.github/workflows/ci.yml` and `docker-publish.yml` now run
  `npm run prisma:generate -w @zeropeek/backend` **before** typecheck and before
  `prisma migrate deploy`. `docker/backend.Dockerfile` already did this
  explicitly, which is why only CI broke.
- **This stayed hidden for a whole branch** because the workflows trigger only
  on `main` / tags, and `main` had no Prisma-typed code. Pushing a feature
  branch is the first real test of CI — always watch the run.
- **Reproducing it locally is the trap.** `composite: true` + `tsconfig.tsbuildinfo`
  makes `tsc` skip re-checking, so deleting `.prisma` appears to change nothing
  and returns 0 errors. To reproduce faithfully you must delete the build cache
  *and* the client:
  `rm -f packages/backend/tsconfig.tsbuildinfo packages/shared/tsconfig.tsbuildinfo`
  `rm -rf packages/backend/dist && mv node_modules/.prisma /tmp/bak`
  then `npm run typecheck -w @zeropeek/backend` → 28 errors without the step,
  0 after `npm run prisma:generate -w @zeropeek/backend`.

## ZeroPeek Portainer stack: REDIS_URL + ACME (PR #7, 2026-11-03)
- `REDIS_URL` is **unused** by the backend (no Redis adapter wired into Socket.IO).
  It is optional now: compose default `redis://cache:6379`, config.ts default the
  same. Never make it a `:?` guard again — that caused a hard deploy failure.
- **Caddy `/data` MUST be a named volume** (`caddy-data`, plus `caddy-config`).
  Without it every container recreation forgets the certificate + ACME account and
  re-requests one → Let's Encrypt "too many certificates (50) already issued".
- `ZP_ACME_CA` selects the ACME directory (empty = LE production; set to
  `https://acme-staging-v02.api.letsencrypt.org/directory` while testing).
- **Compose-vs-Caddy interpolation trap:** the embedded Caddyfile is a
  `configs.content` block, so Compose substitutes `$VAR` inside it. Caddy's native
  `{$VAR:default}` is rewritten to `{:default}` (invalid Caddyfile). Use Compose
  `${VAR:-default}` — same as the existing `ZP_SITE_ADDRESS`.
- `COOKIE_SECURE` empty = derive from `APP_BASE_URL` scheme (Secure cookie over
  plain HTTP is silently dropped → login breaks). A localhost `APP_BASE_URL` is a
  **warning**, not fatal (internal plain-HTTP deploys need it). `config.warnings`.
- **Canonical public URL is `https://zeropeek.xubi.org`** (Portainer CE 2.45.3).
  `APP_BASE_URL` is NOT guarded: compose default `APP_BASE_URL:-https://zeropeek.xubi.org`
  (PR #8), because the `:?` guard made the stack fail with
  `required variable APP_BASE_URL is missing a value`. `CORS_ORIGIN` empty ⇒
  defaults to `APP_BASE_URL` (same-origin), so it needs no entry.
- `docker-compose.portainer.yml` compose `:?` guards that remain (all intentional,
  exactly four): `POSTGRES_DB/USER/PASSWORD`, `SESSION_SECRET`. Everything else
  has a default — never re-add a `:?` guard to a variable that has one.
- **TLS needs container port 80 published** for ACME HTTP-01 + the HTTP→HTTPS
  redirect; Caddy binds it only in TLS mode. Compose publishes
  `'${ZP_HTTP_CHALLENGE_PORT:-${HTTP_PORT:-3737}}:80'` (PR #8). Nested default is
  deliberate: plain-HTTP mode → `3737:80` twice → Compose **collapses** the dup
  (no conflict, unchanged); TLS mode → default `443` **conflicts** with the
  primary `443:443` (`Bind for 0.0.0.0:443 failed: port is already allocated`),
  so TLS users set `ZP_HTTP_CHALLENGE_PORT=80`. A duplicate host port inside one
  compose `ports:` list passes `config` but a genuine same-host-port pair fails at `up`.
- **DATABASE_URL is derived, not required**: the backend builds it from
  `POSTGRES_{USER,PASSWORD,DB}` with URL-safe encoding (verified: password
  `p@ss:w/rd?#%!*z` → `p%40ss%3Aw%2Frd%3F%23%25%21%2Az`). Leave it empty.
- **Existing Postgres volume:** `POSTGRES_*` apply only on first init of an empty
  `db-data`; on a populated volume they are ignored, so the compose value does NOT
  change the role/password. To fix a mismatch, put the volume's CURRENT password
  into `POSTGRES_PASSWORD` — never `ALTER ROLE`, never `down -v`.
- Regression guard `packages/backend/src/deployment.compose.test.ts` (PR #8)
  parses `:?` vs `:-` from the compose file and asserts the four required vars are
  documented in PORTAINER.md + ENVIRONMENT.md + `.env.portainer.example`, and that
  APP_BASE_URL/DATABASE_URL/REDIS_URL/CORS_ORIGIN/COOKIE_SECURE stay unguarded.
  Note `.env.portainer.example` has no Prettier parser, so it must not be passed
  to a bare `prettier --check <file>` list (the repo-wide `format:check .` is fine).
- Full-stack test recipe: build `zeropeek-backend:test`/`zeropeek-frontend:test`,
  run `docker compose -f docker-compose.portainer.yml --env-file <env> -p zptest up -d`,
  then `down -v`. Use `sudo docker` (the daemon runs; see below). Image vars are
  `ZEROPEEK_BACKEND_IMAGE`/`ZEROPEEK_FRONTEND_IMAGE` + `ZEROPEEK_IMAGE_TAG`
  (separate vars — a value like `repo:tag` in the image var is an invalid reference).
- To run the DB-backed integration suites here: create a separate DB
  (`CREATE DATABASE zeropeek_test`), forward it out with
  `sudo docker run -d --network <proj>_zeropeek -p 15432:5432 alpine/socat
  tcp-listen:5432,fork,reuseaddr tcp-connect:db:5432`, set `TEST_DATABASE_URL`,
  `prisma migrate deploy`, then `npm test` → 61/61. `prisma migrate deploy` is
  idempotent ("No pending migrations to apply" on the second run).

## NoPeek reference project (github.com/dejowebdesign/ZeroPeek docs/analysis)
- Reference app **NoPeek** lives at `https://nopeek.projekt-chrisb.de` (reachable).
  No ZIP/source archive is stored in this repo or sandbox — analyse it by
  fetching the **unminified** client assets (same method as `nopeek-audit.md`):
  player at `/` (default ns), host at `/host`; assets player.js, host.js,
  editor.js, common.js, clock.js, quizschema.js, avatars.js, branding.js,
  app-config.js. Prior `/var/tmp/nopeek/` cache is wiped on sandbox restart.
- NoPeek specifics worth remembering: Kahoot-style **clock-offset sync** (`clock`
  ping/pong, best-of-N, re-sync after WS upgrade) drives an absolute `at`
  timestamp; `leadMs` read-aloud lead phase; host events incl. `lock`/`close`/
  `review`/`review-end`; player `avatar`/`qa:*`; `build` reload guard; 13 question
  types (same set as ZeroPeek); team mode; QR code; animated board/podium;
  per-type reveal views; CSV+Excel+print reports; homework mode; email 2FA.
  Scoring = base + speed bonus with double/none; exact numbers are server-side.
- ZeroPeek's analysis docs live in `docs/analysis/nopeek-comparison/` (PR #9,
  branch `docs/nopeek-comparison`). Do NOT copy NoPeek's scoring formula or store
  IPs — Q1/Q2/Q4/Q5/Q6/Q7 in `docs/architecture/README.md` gate those.
- Known ZeroPeek gaps (verified in code, not placeholders): team mode is
  data-only; `lead` phase declared but never entered; no QR; no clock sync; no
  host review/shortcuts; report lacks flag/timing columns and Excel/print export;
  `avatar` is an unvalidated free string; "too fast" rule implemented but off.

## Auth surface + player registration (Phase 6.3, PR #25, branch `feat/phase-6-3-auth-registration`)
- Additive only: new `PLAYER` role, `User.emailVerifiedAt` (nullable) and `EmailVerificationToken`
  (stores **SHA-256 hash** only). Migration `20261107120000_phase_6_3_player_role_email_verification`
  backfills existing rows to `created_at` so no current user is locked out. `requireStaff` (ADMIN+
  TRAINER) now guards quizzes/reports + the host socket; PLAYER is authenticated but not staff.
- **Enumeration-safe register (binding, spec §5.3):** a taken **e-mail** is answered **byte-identically**
  to a fresh registration (`{ ok: true, verificationSent: isMailConfigured(config) }`, derived from
  config only, never from the attempt) and the password is still Argon2id-hashed to equalise timing.
  A taken **username** still returns `409 username_taken`. Do not "simplify" this back to a 409.
- **The verification link/token is never logged, in any environment.** Re-issue from the UI instead.
- Auth endpoints have per-route limits (`limit()` in `authRoutes.ts`): login 30, register 10, verify 30,
  resend 5 /min. Governed by `AUTH_RATE_LIMITS` (config `authRateLimits`, default **on** outside
  tests); a test sets `AUTH_RATE_LIMITS=true` to prove 429s. Rate-limit options must sit under
  `config: { rateLimit: {...} }` — the shorthand `rateLimit:` key fails typecheck (TS2559).
- Mail via **nodemailer** from a single `SMTP_URL` (`MAIL_FROM`, `MAIL_FROM_NAME`,
  `MAIL_VERIFY_TTL_HOURS`). Variable name is `MAIL_VERIFY_TTL_HOURS` (NOT `EMAIL_…`). Unconfigured
  mail is a **warning**, not fatal; the no-op sender keeps registration working.
- Frontend: new Vite entry `auth.html` → `pages/auth.ts` (sign in / register / `#verify=<token>`),
  `starfield.ts` + `backdrop.css` (pure-CSS tiled `radial-gradient` stars, `prefers-reduced-motion`
  + a persisted "calm" switch), `registerOffer()` shown after a game. **Joining a game stays
  guest-only** (nickname, no e-mail) — never gate it.

## Immutable game snapshot (Phase 6.4, branch `feat/phase-6-4-quiz-editor-snapshots`)
- **R-3 (history loss) is closed by construction.** A started game reads its questions from
  `game_snapshots` (one JSONB envelope per game, unique `game_id`), never from the live quiz.
  `snapshotService.startWithSnapshot()` writes it inside the **same transaction** as `startedAt`
  (called from `engine.start()`), so a game is never running without a valid snapshot. Idempotent
  (repeat start returns the existing row; unique index is the race backstop). Legacy games with no
  snapshot **self-heal** on the first `quizForGame()` read.
- Migration `20261108090000_phase_6_4_quiz_editor_game_snapshot` is **additive + data-preserving**:
  nullable `category`/`difficulty` TEXT on `quizzes` and `questions`; `games.quiz_id` → nullable with
  `ON DELETE SET NULL`; and it **drops** `player_answers_question_id_fkey` (was `ON DELETE CASCADE`).
  Never re-add that FK — it is what destroyed answer history when a quiz was deleted. Re-verified on
  a populated scratch DB: counts preserved, and `DELETE FROM quizzes` leaves game/players/answers.
- `engine.evict(gameId)` is a test hook to force a DB reload (proves the snapshot, not the cache, is
  read). `reportService` reads the snapshot; `GameRow`/report types allow `quiz.id: string | null`
  with a "Deleted quiz" fallback.
- `category`/`difficulty` are **free text** — no taxonomy is approved. A controlled vocabulary
  (selects/filter facets) is an owner decision, not a cleanup.
- Editor pitfall: `validateQuiz` issue paths use the **dot** form (`questions.0.difficulty`), so the
  editor's matcher must be `/^questions[.[](\d+)[\]]?/`, not `questions[0]`.
- Report: `docs/reports/phase-6-4-quiz-editor-snapshot.md`. Not committed/pushed — awaiting owner
  approval (the owner merges and deploys).
- **Owner asked (2026-11-04) to replace the dropped FK with nullable `question_id` +
  `ON DELETE SET NULL`. Answered no, with evidence (report §7).** Three variants tested on real
  PostgreSQL: (A) no FK → id survives, report/CSV correct; (B) nullable + SET NULL → id becomes
  NULL and `gameReport()` **throws** `Error converting field "questionId" of expected non-nullable
  type "String"`; (C) `NOT NULL` + SET NULL → the quiz delete itself fails with
  `null value in column "question_id" ... violates not-null constraint`. So SET NULL is not a
  matter of taste — it is unimplementable without either breaking reads or blocking deletes.
  The second reason is decisive: `updateQuiz` **deletes and recreates every question row** on any
  editor save, so SET NULL would null the attribution of past games when a trainer merely renames
  a quiz (verified: id became NULL after an ordinary save).
- `question_id` is the **only** link from an answer to its question; `reportService` attributes by
  `row.questionId === question.id` against the snapshot. The snapshot, not the live table, is the
  referential guarantee. A DB-level guard now pins both constraints in
  `snapshot.integration.test.ts` ("holds the database guarantees that protect history") — no
  `player_answers_question_id_fkey`, and `games_quiz_id_fkey` is SET NULL (`confdeltype = 'n'`).
- **Residual edge case (verified, documented, not fixed):** a game started *before* 6.4 has no
  snapshot; if its quiz is deleted before the game is ever read, a report throws
  409 `This game has no snapshot and its quiz no longer exists.` Not a regression and not
  avoidable (the questions exist nowhere). Self-closing: any game started under 6.4+ is frozen in
  the start transaction, and any legacy game read once self-heals. Mitigation if wanted: backfill
  a snapshot for snapshot-less games before deleting a quiz (product decision).
- If a *hard* DB guarantee is ever wanted, reference the immutable copy, not the live quiz: add a
  `game_snapshot_questions` table (frozen ids per game) and point `question_id` at it with
  `ON DELETE CASCADE`. Cost: one table, a write on start, a data migration.

## Frontend design system (Phase 6.1, PR #18)
- Style: **"Dark Retro-Futuristic Wireframe & Glassmorphism"** — presentation only.
  Working reference: `docs/design/design-system.md`.
- `packages/frontend/src/styles/tokens.css` = tokens + all component CSS (single file).
  Phase 0 tokens are FROZEN and asserted byte-for-byte by `src/design-system.test.ts`.
- `packages/frontend/src/styles/backdrop.css` = wireframe floor grid + horizon + login
  starfield. CSS-only, no images. Both CSS files are linked in all 4 HTML entries.
- Reusable components live in `src/ui.ts` (`chip`, `progress`, `statTile`, `dialog`,
  `confirmDialog`, `skeleton`, `countdown`, `emptyState`, `setBusy`; `button()` extended).
  **No `innerHTML` anywhere** — CSP is `script-src 'self'`/`style-src 'self'` (guard test).
- Extending the system: add a token, add the component to `ui.ts` + CSS + `ui.test.ts`,
  and register its class in `design-system.test.ts`. Never hard-code a value.
- **Show/beamer sizing rule:** `--type-show-*`, `--show-gap`, `--show-pad` and the podium
  `min-height` mix **`vw + vh`** so a 720p projector shrinks the board instead of scrolling
  it. `.show__options` is a fixed 2-column grid (stacks < 640px). Beamer markup builders
  live in `src/showView.ts` (pure, unit-tested) because `pages/host.ts` opens a socket on
  import. `answerCountNode` in `host.ts` must be assigned in `showQuestion` and nulled in
  every other screen, or the live answer count silently stops updating.
- **TEXT-ONLY VERIFICATION (owner rule, 2026-11-05, mandatory):** chrisB forbids all image
  work on ZeroPeek — **no screenshots, no PNG/JPEG creation, no image analysis/processing, no
  visual browser checks, no images in docs or PRs**. Verify with text/tables/measurements
  only. Use `/usr/bin/chromium --headless=new --no-sandbox --disable-gpu
  --window-size=W,H --virtual-time-budget=2500 --dump-dom`; render the REAL modules with
  `npx esbuild <entry.ts> --bundle --format=esm --alias:@zp-frontend=./packages/frontend/src`
  into a scratch page under `dist/`, write `getBoundingClientRect()`/`scrollHeight` into a
  `data-json` attribute, read it back with `--dump-dom`, then delete the scratch page.
  **Never pass `--screenshot`.**
- **Token-diff gotcha:** to prove the Phase 0 tokens are unchanged, extract the first `:root`
  block (`git show <base>:…/tokens.css`) and parse `--name: value;` in Python. A raw
  `grep -oP -- "--muted:\s*\K[^;]+"` over the whole file matches a *later* redefinition and
  gives a false "differs". Parse the block, not the file.

## Git / push in this sandbox
- `git push -u origin <branch>` **prompts for a username** (no credential helper) and hangs.
  Push with `git push "https://${GITHUB_TOKEN}@github.com/dejowebdesign/ZeroPeek.git" <branch>`,
  then set `branch.<name>.remote` back to `origin` — otherwise the token leaks into `.git/config`.
- `create_pr` tool works directly (owner/repo `dejowebdesign/ZeroPeek`).

## Docker in this sandbox
- A dockerd is often **already running** (PID file `/var/run/docker.pid`).
  `docker info` as the non-root user fails; use **`sudo docker ...`**. Only start
  a daemon if `sudo docker info` fails, and do not delete a live `docker.pid`.
- Frontend image smoke test: `sudo docker build -f docker/frontend.Dockerfile -t
  <tag> .` then run on a spare port and probe `/`, `/host.html`, `/editor.html`,
  `/admin.html` (all 200). `docker/Caddyfile.frontend` uses
  `try_files {path} {path}.html {path}/index.html`, so both `/admin` and
  `/admin.html` work but `/admin/` does not.
- Pre-existing untracked workspace files (NOT from the repo): `.openhands/`,
  `nopeek-audit.md`. `.openhands/memory/MEMORY.md` is tracked in git.
