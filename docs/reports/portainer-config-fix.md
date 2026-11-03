# Portainer / database configuration fix

**Project:** ZeroPeek
**Scope:** Fix the Portainer deployment so the backend stops failing with
`FATAL: database not reachable after 30 attempts.` **No product features were
added.**
**Branch:** `fix/portainer-config-and-db-url`

Related: [PORTAINER.md](../deployment/PORTAINER.md) ·
[ENVIRONMENT.md](../deployment/ENVIRONMENT.md) ·
[postgresql-password-fix.md](./postgresql-password-fix.md) ·
[infrastructure-review.md](./infrastructure-review.md)

---

## 1. Exact cause

The reported container inspect is the whole story:

| Value            | Reported state    | Effect                                                                               |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`   | wrong placeholder | Prisma cannot authenticate → every connection attempt fails.                         |
| `SESSION_SECRET` | empty             | `@fastify/cookie` was registered with an empty secret.                               |
| `CORS_ORIGIN`    | empty             | **`@fastify/cors` throws `Invalid CORS origin option` on every request → HTTP 500.** |
| `APP_BASE_URL`   | empty             | Links, QR codes and cookie scope fall back to `http://localhost:8080`.               |
| `REDIS_URL`      | empty             | Socket.IO adapter falls back to `redis://cache:6379`.                                |

Two independent faults combined:

1. **The credentials in `DATABASE_URL` did not match the database.** The old
   `docker-compose.portainer.yml` passed `${DATABASE_URL}` through unguarded, and
   nothing derived it from the `POSTGRES_*` values. A placeholder therefore
   reached Prisma verbatim.
2. **Empty values were treated as "set".** `loadConfig` used `??`, which only
   replaces `null`/`undefined`, so an **empty string** was used as-is. An empty
   `CORS_ORIGIN` is rejected by `@fastify/cors`, which turns `/api/health` into a
   500 even after the database is reachable. This is reproduced in section 6.4.

The old entrypoint printed the same line for every failure and retried **30
times** with no diagnosis, which is why the symptom looked like a database
problem rather than a configuration problem.

> **The PostgreSQL volume is not the cause.** `POSTGRES_PASSWORD` in the stack
> only initialises a _fresh_ cluster; on an existing volume PostgreSQL ignores it.
> The volume was left untouched by every change in this branch.

## 2. What changed

| File                                  | Change                                                                                                                                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/backend/src/config.ts`      | `ConfigError`; `resolveDatabaseUrl()` derives `DATABASE_URL` from `POSTGRES_*` with URL-safe encoding; strict production validation; every string value now treats empty as unset; `sessionTtlMs` from `SESSION_TTL_HOURS`. |
| `packages/backend/src/server.ts`      | Catches `ConfigError` before building the app and exits `1` with the readable message.                                                                                                                                      |
| `packages/backend/src/app.ts`         | Cookie secret comes from the validated `config.sessionSecret`.                                                                                                                                                              |
| `packages/backend/src/sessions.ts`    | Session lifetime comes from `config.sessionTtlMs` (was a hard-coded constant).                                                                                                                                              |
| `docker/backend-entrypoint.sh`        | Preflight validation via the compiled `loadConfig`; derives `DATABASE_URL`; bounded (15) retry that prints the Prisma code and a hint; never prints a secret.                                                               |
| `docker-compose.portainer.yml`        | `:?` guards for the six critical variables; `DATABASE_URL` optional and derived; `POSTGRES_*` passed to the backend; backend `restart: on-failure:5`.                                                                       |
| `.env.portainer.example`              | Documents the derived `DATABASE_URL` and the required values.                                                                                                                                                               |
| `docs/deployment/ENVIRONMENT.md`      | Variable table, derivation rules, fail-fast behaviour.                                                                                                                                                                      |
| `docs/deployment/PORTAINER.md`        | §5.1 minimal variable set, §5.3 aligning credentials with an existing volume, restart-loop and database troubleshooting.                                                                                                    |
| `packages/backend/src/config.test.ts` | **New.** 18 unit tests for `loadConfig` / `resolveDatabaseUrl`.                                                                                                                                                             |
| `packages/backend/src/app.test.ts`    | Production case supplies the now-required values.                                                                                                                                                                           |

No file was deleted, renamed or moved. The product logic is unchanged.

### `DATABASE_URL` is now derived

Leave `DATABASE_URL` empty and the backend builds

```
postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@db:5432/<POSTGRES_DB>?schema=public
```

from the individual values. The password is percent-encoded, so `@ : / ? # % !`
and spaces are safe. The credentials then live in exactly one place and cannot
drift apart. Set `DATABASE_URL` explicitly only for an external database.

### Fail fast instead of a restart loop

Production start validates the environment first. A missing or invalid value
stops the container with one readable block:

```
ZeroPeek backend cannot start: the configuration is incomplete or invalid.

  - SESSION_SECRET is missing or empty. Set a long random value, e.g. `openssl rand -hex 32`.

Fix the values in the Portainer stack environment (see docs/deployment/PORTAINER.md) and redeploy.
```

The compose file additionally guards `POSTGRES_DB`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `APP_BASE_URL`, `REDIS_URL` and `SESSION_SECRET` with `:?`,
so most mistakes are rejected before any container starts.

The backend uses `restart: on-failure:5`. `unless-stopped` would restart a
misconfigured backend forever; `on-failure:5` retries a few times, then leaves the
container stopped and visible in Portainer. It still restarts after a host reboot.

## 3. Complete Portainer variable list

Set these under **Stack → Environment variables**.

**Required (no default):**

| Variable            | Value                                                                |
| ------------------- | -------------------------------------------------------------------- |
| `POSTGRES_DB`       | the database name, e.g. `zeropeek`                                   |
| `POSTGRES_USER`     | the user that exists in the volume, e.g. `zeropeek`                  |
| `POSTGRES_PASSWORD` | the password that exists in the volume                               |
| `SESSION_SECRET`    | `openssl rand -hex 32`                                               |
| `APP_BASE_URL`      | the public origin, e.g. `https://quiz.example.com` (never localhost) |

**Optional (safe default in the compose file):**

| Variable               | Default                   | When to change                                                   |
| ---------------------- | ------------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`         | derived from `POSTGRES_*` | only for an external database (then percent-encode the password) |
| `CORS_ORIGIN`          | `APP_BASE_URL`            | only if the browser origin differs                               |
| `REDIS_URL`            | `redis://cache:6379`      | only for an external cache                                       |
| `ZEROPEEK_IMAGE_TAG`   | `latest`                  | pin `sha-<short>` for reproducible deploys                       |
| `HTTP_PORT`            | `3737`                    | `443` with TLS                                                   |
| `CADDY_CONTAINER_PORT` | `80`                      | `443` with TLS                                                   |
| `ZP_SITE_ADDRESS`      | empty (plain HTTP)        | the public domain to enable TLS                                  |
| `COOKIE_SECURE`        | `true`                    | `false` only for plain-HTTP testing                              |
| `SESSION_TTL_HOURS`    | `72`                      | session lifetime                                                 |

`REDIS_URL` and `CORS_ORIGIN` already have the correct values in
`docker-compose.portainer.yml`; they need no Portainer entry. **Never commit
credentials** – enter them only in Portainer.

## 4. Safe update procedure (existing volume preserved)

1. **Do not touch the volume.** Never enable "remove volumes" when updating the
   stack. The `db-data` volume keeps the data.
2. **Recover the values that are already in the volume** (section 5.3 of
   PORTAINER.md). Do not change the database password:
   ```bash
   docker exec zero_peek-db-1 psql -U postgres -c '\du'   # roles
   docker exec zero_peek-db-1 psql -U postgres -c '\l'    # databases
   docker exec -e PGPASSWORD='<the-password>' zero_peek-db-1 \
     psql -w -h "$(hostname)" -U <user> -d <db> -tAc 'SELECT 1'   # tests, changes nothing
   ```
3. In Portainer, set `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
   `SESSION_SECRET` and `APP_BASE_URL` to those values, and leave `DATABASE_URL`
   **empty**.
4. **Update the stack.** The backend applies pending migrations with
   `prisma migrate deploy`, which only adds missing migrations – it never resets
   or drops data.
5. Verify: `docker logs zero_peek-backend-1` shows `No pending migrations to
apply.` and `Server listening`, and `GET /api/health` returns `200`.

If the login in step 2 fails with `password authentication failed`, the stack
password is not the one in the volume. Enter the **original** password. If it is
lost, an intentional `ALTER ROLE ... PASSWORD` is required – that changes the
running database and needs explicit approval, so it is **not** done here.

## 5. Verification (all commands run in this branch)

### 5.1 Repository checks

| Check                           | Result                         |
| ------------------------------- | ------------------------------ |
| `npm run typecheck`             | 3 workspaces clean             |
| `npm test` (without a database) | 106 passed, 28 skipped         |
| `npm test` (throwaway test DB)  | **53/53 backend tests passed** |

### 5.2 Compose validation

`docker compose -f docker-compose.portainer.yml config` with a password of
`p@ss:w/rd?#%!*` renders cleanly. Each `:?` guard was tested by emptying one
variable at a time; all six abort with a readable message:

```
empty POSTGRES_DB       -> required variable POSTGRES_DB is missing a value: POSTGRES_DB muss gesetzt sein
empty POSTGRES_USER     -> ... POSTGRES_USER ...
empty POSTGRES_PASSWORD -> ... POSTGRES_PASSWORD ...
empty SESSION_SECRET    -> ... SESSION_SECRET ... (openssl rand -hex 32)
empty APP_BASE_URL      -> ... APP_BASE_URL ... (z. B. https://quiz.example.com)
empty REDIS_URL         -> ... REDIS_URL ... (z. B. redis://cache:6379)
```

### 5.3 Special characters in the password

`resolveDatabaseUrl` encodes `p@ss:w/rd?#%!*` to
`p%40ss%3Aw%2Frd%3F%23%25%21%2A`; `decodeURIComponent` round-trips it exactly
(`config.test.ts`, and a live `new URL(...)` check inside the container:
`pw_len=14`).

### 5.4 Full stack with a special-character password

`docker compose -f docker-compose.portainer.yml --env-file <test.env> -p zptest up -d`
on a separate project and volume, `POSTGRES_PASSWORD=p@ss:w/rd?#%!*`:

```
backend   Up (healthy)
cache     Up (healthy)
db        Up (healthy)
frontend  Up (healthy)
proxy     Up (healthy)
```

- Backend log: `1 migration found`, `All migrations have been successfully applied.`,
  `Server listening at http://0.0.0.0:3000`.
- `GET /api/health` through the proxy → `200`
  `{"status":"ok","service":"zeropeek-backend","version":"0.0.0","questionTypes":13}`.
- Frontend `/`, `/host.html`, `/editor.html` → `200`.
- CORS preflight from the `APP_BASE_URL` origin → `204` with the matching
  `Access-Control-Allow-Origin`.
- PostgreSQL: all nine tables plus `_prisma_migrations` present; the one migration
  recorded as finished.
- Redis: `PONG`.

### 5.5 Empty `CORS_ORIGIN` (the 500 bug)

With `CORS_ORIGIN=` and a reachable database, the old build returned
`HTTP 500` for `/api/health` with `Invalid CORS origin option`. After treating
empty as unset, `/api/health` returns `200`. Covered by the
`treats set-but-empty values as unset` test.

### 5.6 Wrong password and missing configuration

- Wrong password: the log names it on every attempt
  (`waiting for the database (attempt n/15): connection authentication failed -
check POSTGRES_USER, POSTGRES_PASSWORD and DATABASE_URL`) and exits `1` after
  15 attempts with `FATAL: the database is not reachable after 15 attempts.` and
  `The PostgreSQL volume was left untouched.` No secret is printed.
- Missing configuration: the container exits `1` immediately with the
  `ZeroPeek backend cannot start …` block.

### 5.7 Volume preservation

A marker row was inserted, the stack was recreated with
`--force-recreate`, and the row was still present. The second run logged
`No pending migrations to apply.`

## 6. Remaining manual steps (need your approval)

1. **Portainer:** enter the five required variables (section 3) and update the
   stack. This branch does not touch the running instance.
2. **Database password:** none is required. Only if the original password is lost
   is an `ALTER ROLE ... PASSWORD` needed, and that is a change to the running
   database – it is **not** performed here.
3. **TLS:** optional and unchanged. Set `ZP_SITE_ADDRESS`, `CADDY_CONTAINER_PORT`
   and `HTTP_PORT` together (see PORTAINER.md). Plain HTTP remains the default.
4. **Merge:** not done. The pull request is open for review.
