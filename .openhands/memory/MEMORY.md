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
