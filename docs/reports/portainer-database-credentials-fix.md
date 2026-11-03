# Portainer database-credentials fix – diagnostics, validation and a safe repair path

**Project:** ZeroPeek
**Scope:** Make a Portainer stack whose backend reports
`FATAL: database not reachable after … attempts` diagnosable and repairable
**without touching the existing PostgreSQL volume**. Centralise the remaining
configuration knowledge, reject placeholder secrets, and name the exact database
target in the log. **No product logic was changed.**
**Branch:** `fix/portainer-full-configuration`

Related: [PORTAINER.md](../deployment/PORTAINER.md) ·
[ENVIRONMENT.md](../deployment/ENVIRONMENT.md) ·
[REPAIR.md](../deployment/REPAIR.md) ·
[portainer-app-base-url-fix.md](./portainer-app-base-url-fix.md) ·
[postgresql-password-fix.md](./postgresql-password-fix.md)

---

## 1. Exact cause of the reported error

The stack is running the configuration from commit `3c39ba6`. In that revision
`docker-compose.portainer.yml` passed the environment straight through with no
defaults:

```yaml
APP_BASE_URL: ${APP_BASE_URL}
CORS_ORIGIN: ${CORS_ORIGIN}
DATABASE_URL: ${DATABASE_URL}
REDIS_URL: ${REDIS_URL}
SESSION_SECRET: ${SESSION_SECRET}
```

So every value the operator did not enter arrived **empty** – which matches the
report exactly: `SESSION_SECRET`, `CORS_ORIGIN`, `APP_BASE_URL` and `REDIS_URL`
empty, and a `DATABASE_URL` that still held a placeholder
(`postgresql://user:password@db:5432/…`). Because an explicit `DATABASE_URL`
**wins** over `POSTGRES_*`, the backend ignored the correct credentials and tried
the placeholder host/user/password, and after 30 attempts stopped with
`database not reachable`.

Since `3c39ba6` the repository has moved on (PRs #6–#8): `DATABASE_URL` is now
derived from `POSTGRES_*` with URL-safe encoding, `REDIS_URL` defaults to the
`cache` service, `SESSION_SECRET` is guarded with `:?`, and `APP_BASE_URL`
defaults to the canonical origin. Those fixes address most of the report, but the
**misleading placeholder `DATABASE_URL` was still silently accepted** and the
log still did not say _what_ it was trying to reach. That is the remaining gap
this change closes.

## 2. What changed

### a. The database target is now named, without the password

`config.ts` exposes `databaseTarget` (`user@host:port/database`, never the
password) and `databaseUrlSource` (`explicit` / `derived` / `none`). The
entrypoint logs them before connecting, and repeats the target in the final
`FATAL` line:

```text
database target: zeropeek@db:5432/zeropeek (source: derived)
```

A failure is now unambiguous instead of a bare "not reachable".

### b. A contradicting `DATABASE_URL` warns loudly

When an explicit `DATABASE_URL` names a different host/port/database/user than
the `POSTGRES_*` values beside it, the backend logs a prominent warning naming
both targets and how to fix it. This is the exact failure mode that produced the
report. It is a **warning**, not an error, because an external database is a
legitimate setup.

### c. Placeholder secrets and non-PostgreSQL URLs are rejected

- `SESSION_SECRET` that is empty, an obvious example placeholder
  (`change-me-session-secret`, `please-generate-a-32-byte-hex-secret`) or shorter
  than 32 characters stops the backend with a readable message in production.
- `DATABASE_URL` that is not a `postgresql://` URL is rejected with the target it
  parsed.
- `REDIS_URL` stays optional (unchanged) and still degrades gracefully.

### d. The repair path is documented

[REPAIR.md](../deployment/REPAIR.md) is a new runbook for aligning the stack with
an existing volume: read the log, confirm the volume's real roles/credentials,
leave `DATABASE_URL` empty, and – only with approval – `ALTER ROLE … PASSWORD`
without deleting data. It repeats the one rule: never remove `db-data`.

## 3. Files changed and added

**Added**

- `docs/deployment/REPAIR.md` – the safe repair runbook.
- `docs/reports/portainer-database-credentials-fix.md` – this report.

**Changed**

- `packages/backend/src/config.ts` – `databaseTarget`, `databaseUrlSource`,
  `describeDatabaseUrl`, `isPostgresUrl`, `isPlaceholderSecret`; production
  errors for a placeholder secret and a non-PostgreSQL URL; a warning for a
  contradicting explicit `DATABASE_URL`.
- `docker/backend-entrypoint.sh` – log the resolved target and source, surface
  config warnings, add the "clear `DATABASE_URL`" hint, repeat the target in the
  final `FATAL` line. No secret is ever printed.
- `packages/backend/src/config.test.ts`, `app.test.ts`,
  `deployment.compose.test.ts` – new cases.
- `docs/deployment/ENVIRONMENT.md`, `.env.portainer.example` – document the new
  validation and the `DATABASE_URL`-wins rule.

No file was deleted, renamed or moved. `docker-compose.portainer.yml` needed **no
change**: its defaults were already correct, and the remaining gap was in the
diagnostics and validation, not the interpolation.

## 4. Complete Portainer variable list

Exactly **four** values are required; everything else has a correct default. For
`zeropeek.xubi.org`:

| Variable                 | Required | Value                                          |
| ------------------------ | -------- | ---------------------------------------------- |
| `POSTGRES_DB`            | yes      | `zeropeek`                                     |
| `POSTGRES_USER`          | yes      | `zeropeek`                                     |
| `POSTGRES_PASSWORD`      | yes      | the password **already in the volume**         |
| `SESSION_SECRET`         | yes      | `openssl rand -hex 32` (≥ 32 characters)       |
| `APP_BASE_URL`           | no       | `https://zeropeek.xubi.org` (default)          |
| `CORS_ORIGIN`            | no       | `https://zeropeek.xubi.org`                    |
| `ZP_SITE_ADDRESS`        | no       | `zeropeek.xubi.org`                            |
| `CADDY_CONTAINER_PORT`   | no       | `443`                                          |
| `HTTP_PORT`              | no       | `443`                                          |
| `ZP_HTTP_CHALLENGE_PORT` | no       | `80`                                           |
| `COOKIE_SECURE`          | no       | `true`                                         |
| `DATABASE_URL`           | no       | **leave empty** (derived from `POSTGRES_*`)    |
| `REDIS_URL`              | no       | leave empty (defaults to `redis://cache:6379`) |

Full detail: [ENVIRONMENT.md](../deployment/ENVIRONMENT.md) and
[PORTAINER.md](../deployment/PORTAINER.md) section 5.

## 5. Migration and data safety

- No schema change in this PR.
- The entrypoint applies migrations only with `prisma migrate deploy` (forward
  only); **no reset, no drop**. A failed migration aborts the start and leaves the
  database untouched.
- The `db-data` volume is never removed or re-initialised by anything in this PR
  or its docs; [REPAIR.md](../deployment/REPAIR.md) states the rule explicitly.
- No password is ever logged.

## 6. Test results

**Unit / integration (`npm test`)** – 6 backend files, 77 tests pass; the shared
and frontend suites are unchanged. New coverage:

- `describeDatabaseUrl` hides the password and keeps user/host/port/db.
- `isPostgresUrl`, `isPlaceholderSecret`.
- Production rejects a placeholder/short `SESSION_SECRET` and a non-PostgreSQL
  `DATABASE_URL`.
- An explicit `DATABASE_URL` that contradicts `POSTGRES_*` produces a warning;
  a matching one does not.
- The entrypoint contract: names the target, explains the precedence, never
  echoes the connection string.

**Docker end-to-end** (built from `docker/backend.Dockerfile` and
`docker/frontend.Dockerfile`, run with a **separate** `db-data` volume under the
project name `zpe2e`):

| Scenario                                                             | Result                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Full `docker-compose.portainer.yml` stack, password `p@ss:w/rd?#%!*` | all 5 services **healthy**; 9 tables migrated; proxy `/api/health` 200               |
| Backend log target line                                              | `database target: zeropeek@db:5432/zeropeek (source: derived)`                       |
| Redis                                                                | `Redis is reachable at cache:6379.`                                                  |
| Wrong password                                                       | `… authentication failed …` then bounded `FATAL` after 15 attempts; volume untouched |
| Placeholder `DATABASE_URL`                                           | loud warning naming both targets; `source: explicit`                                 |
| Placeholder `SESSION_SECRET`                                         | `SESSION_SECRET still looks like a placeholder or is too short`                      |
| Non-PostgreSQL `DATABASE_URL`                                        | `DATABASE_URL must be a PostgreSQL connection string`                                |

The e2e stack was torn down with `down -v` under the unique `zpe2e` project, so
no other volume was touched.

## 7. Remaining manual steps

1. In Portainer, clear `DATABASE_URL` (or set it to the volume's real
   credentials) and set `SESSION_SECRET` to a 32+ character random value.
2. Redeploy the stack and confirm the log shows `source: derived` and a target
   that matches the volume.
3. If the volume's password is lost, follow
   [REPAIR.md](../deployment/REPAIR.md) section 4 – **with approval** – to run
   `ALTER ROLE … PASSWORD`; do not delete the volume.

Nothing is merged and no change was made to the running Portainer instance.
