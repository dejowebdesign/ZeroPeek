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

## Repo: dejowebdesign/ZeroPeek (2026-11-02)
- Public GitHub repo, checked out on branch `main` (HEAD `ebbdd79`, "Initial commit").
- **Currently contains only `README.md`** — an empty scaffold for the planned rebuild.
- README declares the intended stack: TypeScript, Node.js, Socket.IO, PostgreSQL
  (matches the recommended stack from the NoPeek audit).
- Pre-existing untracked workspace files (NOT from the repo): `.openhands/`, `nopeek-audit.md`.
