# Infrastructure review – repository state, PostgreSQL, GHCR and Portainer

**Project:** ZeroPeek
**Scope:** Analysis of the current repository and infrastructure, plus the fixes
found necessary. **No product features were added.**
**Date:** 2026-11-02
**Branch:** `fix/portainer-tls-and-infra-review`

Related: [PORTAINER.md](../deployment/PORTAINER.md) ·
[GITHUB_ACTIONS.md](../deployment/GITHUB_ACTIONS.md) ·
[ENVIRONMENT.md](../deployment/ENVIRONMENT.md) ·
[postgresql-password-fix.md](./postgresql-password-fix.md)

---

## 1. Actual repository state (verified, not assumed)

The briefing described a repository at Phase 0 on branch
`phase-0/project-foundation` at commit `09c0c10` with 59 files. **That is no
longer the state of the repository.** Verified via the GitHub API and the local
clone:

| Fact                 | Briefing said                | Actual                                                                  |
| -------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| Default branch       | `phase-0/project-foundation` | `main` (that branch no longer exists)                                   |
| HEAD                 | `09c0c10`                    | `b29b318` (merge of PR #2)                                              |
| Work completed       | Phase 0                      | **Phase 0 and Phase 0.5** (CI, GHCR, Portainer) plus the PostgreSQL fix |
| Files                | 59                           | 68 tracked files on `main`                                              |
| Merged pull requests | –                            | **#1** (Phase 0.5) and **#2** (PostgreSQL healthcheck fix)              |
| `docker-publish.yml` | "to be created"              | **Already exists and already ran successfully on `main`**               |

The two feature branches from those PRs (`feat/ci-docker-portainer`,
`fix/postgresql-healthcheck`) still exist remotely.

### What already works (independently re-verified in this environment)

| Check                                    | Command / method                                        | Result                                                             |
| ---------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| Install                                  | `npm install`                                           | exit 0                                                             |
| Typecheck                                | `npm run typecheck`                                     | 3 workspaces clean                                                 |
| Unit tests                               | `npm test`                                              | **21 passed** (7 backend, 5 frontend, 9 shared)                    |
| Build                                    | `npm run build`                                         | shared → backend → frontend, exit 0                                |
| Formatting                               | `npm run format:check`                                  | clean                                                              |
| Dev compose                              | `docker compose config`                                 | valid                                                              |
| Portainer compose (HTTP)                 | `docker compose -f docker-compose.portainer.yml config` | valid, **0** `build:` keys                                         |
| Portainer compose (TLS)                  | same, with TLS variables                                | valid                                                              |
| Variable guards                          | unset/empty each PostgreSQL variable                    | exit 1 with the documented message for each                        |
| **Full stack from GHCR, no local build** | `docker compose … up -d`                                | **all 5 services healthy**                                         |
| API through the proxy                    | `GET /api/health`                                       | `{"status":"ok",…,"questionTypes":13}` + hardening headers         |
| Frontend pages                           | `/`, `/host.html`, `/editor.html`                       | 200 / 200 / 200                                                    |
| Healthcheck catches bad credentials      | wrong password vs. `pg_isready`                         | `psql` exit 2 (fails) where `pg_isready` exits 0 (wrongly healthy) |

Docker Compose v5.6.1, Docker 29.9.2 were used. Every test stack was torn down
with `down -v`; **no existing volume was touched and no data was deleted.**

## 2. PostgreSQL – cause of the reported errors

Both reported errors have the **same root cause**: the Portainer stack was
deployed without the PostgreSQL variables set.

- `POSTGRES_PASSWORD` empty → the official `postgres` entrypoint refuses to
  initialise a fresh cluster: _"Database is uninitialized and superuser password
  is not specified"_. Reproduced verbatim with a throwaway container.
- `POSTGRES_DB`/`POSTGRES_USER` missing → Compose's `:?` guard aborts the
  deployment: _"required variable POSTGRES_DB is missing a value: POSTGRES_DB
  muss gesetzt sein"_. Reproduced for all three variables, both unset and empty.

This was **already fixed in PR #2** (`fix/postgresql-healthcheck`) and the fix is
present on `main`. It was re-verified here, not taken on trust:

1. The `:?` guards fail fast for missing **and** empty values (verified).
2. The hardened `db` healthcheck performs a **real login**
   (`PGPASSWORD=… psql -w -h "$(hostname)" …`), so a credential mismatch shows up
   as `unhealthy`. Measured: a wrong password gives `psql` exit 2, while the old
   `pg_isready`-only check returned exit 0 for a **non-existent user** — i.e. the
   old check could report a broken database as healthy.
3. Host is `$(hostname)`, not loopback, because the image's `pg_hba.conf` grants
   `trust` on loopback (a wrong password is accepted there).

The backend and PostgreSQL use the same credentials via `DATABASE_URL`, whose
host is the compose service name `db`. `POSTGRES_HOST_AUTH_METHOD=trust` is not
used anywhere, and no default password is present in any file.

**Conclusion: no further PostgreSQL change is required.** The remaining action is
operational — the variables must actually be entered in Portainer (see §5).

## 3. Defect found and fixed: the documented TLS procedure did not work

`docs/deployment/PORTAINER.md` and `ENVIRONMENT.md` both instructed:

> set `HTTP_PORT=443` once TLS is configured

That instruction cannot work with the shipped file. The embedded Caddyfile
hard-coded `auto_https off` and a `:80` site address, so setting `HTTP_PORT=443`
only re-mapped host `443` → container `80` and served **plain HTTP on the TLS
port**. Reproduced: `HTTP_PORT=443` published `0.0.0.0:443->80/tcp`, plain HTTP
to `:443` answered `200`, and HTTPS failed with a TLS handshake error.

Additionally, the `proxy` healthcheck probed `http://127.0.0.1:80/`, which fails
once Caddy serves TLS on `:443`.

### Fix

- The site address is now built from `ZP_SITE_ADDRESS`:
  `${ZP_SITE_ADDRESS:-:80}`. Empty (the default) keeps plain HTTP on `:80`, so
  nothing changes for existing deployments. Setting it to the public domain
  enables Caddy's automatic HTTPS.
- The container port is parameterised as `CADDY_CONTAINER_PORT` so the published
  port and the listener stay in step (`443:443` for TLS).
- The `proxy` healthcheck is now a port-agnostic TCP probe
  (`nc -z 127.0.0.1 80 || nc -z 127.0.0.1 443`), which works in both modes.
- The dead `ZP_DOMAIN` variable was removed; `ZP_SITE_ADDRESS` is the single
  source of truth.

Verified end to end: with `ZP_SITE_ADDRESS=localhost`,
`CADDY_CONTAINER_PORT=443`, `HTTP_PORT=18443`, all five services report
**healthy**, an HTTPS request completes a real TLS handshake (certificate issued
by _Caddy Local Authority_) and returns the correct health payload. The HTTP
default mode was re-tested afterwards and still works.

## 4. GitHub Actions and GHCR – status

Both workflows are active and have run successfully:

| Run                            | Trigger        | Result                                                         |
| ------------------------------ | -------------- | -------------------------------------------------------------- |
| `CI` (41497501461…)            | `pull_request` | success                                                        |
| `Docker Publish` (41497604769) | push to `main` | success — verify → publish backend → publish frontend → deploy |
| `Docker Publish` (41519022667) | push to `main` | success — same job graph                                       |

The pipeline already satisfies the requirements in the briefing: checkout, Node
22, install, typecheck, tests, build, Buildx, both images, GHCR publish,
`sha-<short>` tag, `latest` on the default branch, per-image `gha` layer cache,
and publishing gated behind `needs: verify`. Permissions are least-privilege
(`contents: read`; `packages: write` only on `publish`).

**GHCR images exist and are publicly pullable** (verified anonymously, no
credentials):

```
ghcr.io/dejowebdesign/zeropeek-backend   tags: main, latest, sha-6db36e1, sha-b29b318
ghcr.io/dejowebdesign/zeropeek-frontend  tags: main, latest, sha-6db36e1, sha-b29b318
```

The repository is **public**, so Portainer needs no registry credentials. (The
GitHub token available here could not list packages via the API — that is a
token-scope limitation, not evidence about visibility; the anonymous pull test
is the authoritative result.)

**Automatic deployment is not active.** The `deploy` job ran but skipped: the
`PORTAINER_WEBHOOK_URL` secret is not configured (confirmed in the run log:
_"PORTAINER_WEBHOOK_URL is not configured – skipping automatic deployment"_).
Manual updates work today; adding the secret enables auto-deploy.

## 5. Portainer compatibility

Confirmed by running the production compose file against GHCR images with no
local build:

- No `build:` keys anywhere in `docker-compose.portainer.yml`.
- The Caddyfile is embedded via `configs:` `content:`, so no repository checkout
  and no host bind mounts are needed.
- Only `proxy` publishes a port; `db`, `cache`, `backend` and `frontend` are
  reachable only on the internal `zeropeek` bridge network.
- Named volume `db-data` persists PostgreSQL data across updates.
- Healthchecks and `restart: unless-stopped` on all five services.
- No credentials in the compose file.

### Steps required in Portainer

1. **Stacks → `zeropeek` → Environment variables.**
2. Set, at minimum:
   - `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
     (`openssl rand -base64 32`)
   - `DATABASE_URL` = `postgresql://<user>:<password>@db:5432/<db>?schema=public`
     (must repeat exactly the three values above)
   - `SESSION_SECRET` = `openssl rand -hex 32`
   - `APP_BASE_URL`, `CORS_ORIGIN` = the public origin
   - `ZEROPEEK_IMAGE_TAG` = a `sha-<short>` tag for a reproducible deployment
3. **Update the stack** (re-pull the compose file from Git so the `:?` guards
   and the new proxy configuration take effect).
4. For TLS, additionally set `ZP_SITE_ADDRESS`, `CADDY_CONTAINER_PORT=443` and
   `HTTP_PORT=443`, then update the stack again.
5. Confirm all five services are **healthy** and
   `curl http(s)://<host>/api/health` returns `{"status":"ok", …}`.

> If the existing `db-data` volume was initialised with different credentials,
> the values in the stack must be set to the credentials already inside the
> volume. **Do not delete the volume.**

## 6. Other findings (reported, not changed)

These are outside the infrastructure scope and are recorded for a decision:

1. **Unvalidated critical variables in production.**
   `SESSION_SECRET`, `APP_BASE_URL`, `CORS_ORIGIN` and `DATABASE_URL` are
   referenced without `:?`. Measured: the backend starts **healthy** with all of
   them empty and silently falls back to a placeholder cookie secret
   (`'phase-0-placeholder'`) and `http://localhost:8080`. Today this is harmless
   (no sessions or DB access until Phase 2), but in Phase 2 an unset
   `SESSION_SECRET` would be a real session-forgery risk. Adding guards now would
   prevent an unconfigured production stack from booting — a behavioural change
   that needs the product owner's approval, so it is **not** included here.
2. **`Caddyfile.frontend` is not baked into the frontend image.**
   `frontend.Dockerfile` copies `docker/Caddyfile.frontend`, but `.dockerignore`
   excludes nothing relevant and the build context is the repository root, so the
   file is available. Verified working (the frontend serves the pages). Worth a
   `**/dist` exclusion check if the build context is ever narrowed.
3. **Local-only:** `docker-compose.yml` defaults to the password
   `change-me-in-production`. That is acceptable for local development and is
   documented; the production file has no default.
4. **No ARM images.** `docker-publish.yml` builds `linux/amd64` only. Add
   `linux/arm64` plus QEMU setup if the Portainer host is ARM-based.

## 7. Open product decisions (Q1–Q7, unchanged)

Taken verbatim from [`docs/architecture/README.md`](../architecture/README.md);
none are decided here:

| #   | Question                                                                                                                 | Needed before |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Q1  | Exact scoring formula: base points, time-bonus curve, rounding, and whether "double points" multiplies base or total.    | Phase 5       |
| Q2  | Threshold and policy for the "too fast" rule (answers faster than humanly possible).                                     | Phase 5       |
| Q3  | Which signals feed the anomaly / "cheat report" (IP reuse, duplicate names, timing patterns) and their retention period. | Phase 5 / 7   |
| Q4  | Team assignment algorithm (automatic balance vs. host-assigned) and team scoring rules.                                  | Phase 5       |
| Q5  | Whether participant IP addresses may be stored at all, and for how long (data minimisation).                             | Phase 5 / 7   |
| Q6  | Tie-breaking rules on the leaderboard.                                                                                   | Phase 5       |
| Q7  | Whether a self-paced/homework mode is in scope (present in the reference app, not listed in Modules A–F).                | Phase 7       |

## 8. Files changed in this task

| File                                    | Change                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `docker-compose.portainer.yml`          | TLS-capable Caddy site address; parameterised container port; proxy healthcheck works in both modes |
| `.env.portainer.example`                | `ZP_SITE_ADDRESS` and `CADDY_CONTAINER_PORT` documented; dead `ZP_DOMAIN` removed                   |
| `docs/deployment/ENVIRONMENT.md`        | Reverse-proxy section rewritten with an "Enabling TLS" procedure                                    |
| `docs/deployment/PORTAINER.md`          | New section 6.1 (HTTPS); `ZP_SITE_ADDRESS` added to the variable table                              |
| `docker/Caddyfile`                      | Comment corrected (referenced the removed `ZP_DOMAIN`)                                              |
| `docs/reports/infrastructure-review.md` | This report                                                                                         |

No product code, no test, no database and no volume was modified.

## 9. Recommendation

The infrastructure is in good shape: Phase 0.5 is genuinely complete, the
PostgreSQL errors are fixed and re-verified, images publish to GHCR, and the
stack runs from GHCR in Portainer without a local build. The one real defect
found — the non-functional TLS procedure — is fixed and verified in both modes.

Recommended next steps, each requiring explicit approval:

1. Merge this PR.
2. In Portainer: set the environment variables (§5) and deploy; verify all five
   services are healthy.
3. Optionally add the `PORTAINER_WEBHOOK_URL` secret to enable automatic
   deployment.
4. Decide whether to add the `:?` guards for `SESSION_SECRET`, `APP_BASE_URL`,
   `CORS_ORIGIN` and `DATABASE_URL` before Phase 2 (finding §6.1).
5. Answer Q1–Q7 when convenient (blocking Phase 5).
6. Begin Phase 1 (quiz domain) only on explicit approval.
