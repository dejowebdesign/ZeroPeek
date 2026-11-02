# PostgreSQL password / healthcheck fix

Status: fixed and locally verified. Branch `fix/postgresql-healthcheck`.

Related: [PORTAINER.md](../deployment/PORTAINER.md) ·
[ENVIRONMENT.md](../deployment/ENVIRONMENT.md)

---

## 1. Symptom

Deploying the stack in Portainer fails with:

```
failed to deploy a stack: compose up operation failed:
dependency failed to start: container zero_peek-db-1 is unhealthy
```

and the database container log repeats:

```
Error: Database is uninitialized and superuser password is not specified.
```

## 2. Root cause

`POSTGRES_PASSWORD` was **empty** (or unset) in the Portainer stack environment.

`docker-compose.portainer.yml` referenced the variable as `${POSTGRES_PASSWORD}`
with **no default and no guard**. An empty value is accepted by Compose, so the
`db` container started normally, but the PostgreSQL entrypoint refuses to
initialise a fresh cluster without a superuser password. It exits with code 1,
the container enters a restart loop, never becomes healthy, and the backend's
`depends_on: db: condition: service_healthy` aborts the whole deployment with
exactly the message above.

### Evidence (reproduced locally, `postgres:16-alpine`)

| Input                                          | Result                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Empty `POSTGRES_PASSWORD`, fresh volume        | container `exit=1`, `health=unhealthy`, stack error identical to the report        |
| Correct password, fresh volume                 | `health=healthy`, `/api/health` OK                                                 |
| Empty `POSTGRES_PASSWORD`, **existing** volume | container starts (init is skipped) — the failure only affects first initialisation |

The relevant PostgreSQL entrypoint logic is: _"Database is uninitialized and
superuser password is not specified"_ → abort. This matches the official
PostgreSQL image documentation, which requires a non-empty `POSTGRES_PASSWORD`
for a new data directory.

### Secondary weakness found (not the reported error)

The old healthcheck was `pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"`.
`pg_isready` only checks that the server accepts connections; it returns `0`
even for a **non-existent user or database**. Measured:

```
pg_isready -U zeropeek -d zeropeek   -> exit 0
pg_isready -U nouser   -d zeropeek   -> exit 0   (wrong user!)
pg_isready -U zeropeek -d nodb       -> exit 0   (wrong db!)
psql     -U nouser     -d zeropeek   -> exit 2   (correctly fails)
```

So a `POSTGRES_USER`/`POSTGRES_DB` mismatch with an existing volume would leave
the database "healthy" while the backend could not log in.

## 3. Files changed

| File                                      | Change                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `docker-compose.portainer.yml`            | `:?` guards on the three PostgreSQL variables; hardened `db` healthcheck             |
| `.env.portainer.example`                  | documented that the four PostgreSQL values are required and must match               |
| `docs/deployment/ENVIRONMENT.md`          | required/empty rules, first-init-only semantics, `DATABASE_URL` consistency          |
| `docs/deployment/PORTAINER.md`            | new section 5.1 (step-by-step in Portainer) and an `unhealthy` troubleshooting table |
| `docs/reports/postgresql-password-fix.md` | this report                                                                          |

`docker-compose.yml` (local development) was **not** changed: it uses
`${VAR:-default}` fallbacks and publishes the database port, which is correct for
local use.

## 4. What was repaired

### 4.1 Fail fast on missing or empty credentials

```yaml
environment:
  POSTGRES_DB: ${POSTGRES_DB:?POSTGRES_DB muss gesetzt sein}
  POSTGRES_USER: ${POSTGRES_USER:?POSTGRES_USER muss gesetzt sein}
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD muss gesetzt sein}
```

The `:?` operator aborts the deployment with a clear message when a value is
missing **or empty**, instead of starting a database that can never become
healthy. No default password is used, and no fallback value is introduced.

Only these three variables are guarded. `DATABASE_URL`, `REDIS_URL`,
`APP_BASE_URL` and `SESSION_SECRET` are deliberately left as plain references:
the Phase 0 backend boots without them, so guarding them would break deployments
that currently start.

### 4.2 Healthcheck that validates a real login

```yaml
healthcheck:
  test:
    [
      'CMD-SHELL',
      'pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" && PGPASSWORD="$$POSTGRES_PASSWORD" psql -w -h "$$(hostname)" -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -tAc "SELECT 1" >/dev/null',
    ]
  interval: 10s
  timeout: 5s
  retries: 10
  start_period: 30s
```

- `pg_isready` keeps the fast "server up" signal.
- The `psql` probe performs a **real password login** to the actual user and
  database, so a credential mismatch now surfaces as `unhealthy` instead of a
  later backend error.
- Host is `$(hostname)`, **not** `127.0.0.1`/`localhost`. The image's
  `pg_hba.conf` grants `trust` on loopback, so `-h 127.0.0.1` would accept **any**
  password (measured: wrong password → `exit 0` via `127.0.0.1`, `exit 2` via the
  container hostname/IP).
- `$$` escapes the `$` so the values are read from the container environment at
  runtime instead of being interpolated by Compose (verified with
  `docker inspect`: `pg_isready -U "$POSTGRES_USER" …`).

## 5. Tests

All commands were run in this environment with Docker.

### 5.1 Compose validation

| Check                                         | Result                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `docker compose config` with a full valid env | exit 0                                                                                                 |
| Empty `POSTGRES_PASSWORD`                     | exit 1 — `required variable POSTGRES_PASSWORD is missing a value: POSTGRES_PASSWORD muss gesetzt sein` |
| Unset `POSTGRES_DB` / `POSTGRES_USER`         | exit 1 — clear message for each                                                                        |

### 5.2 Full stack

| Check                            | Result                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `up -d` with correct credentials | all five services **healthy**                                                       |
| `db` health log                  | `0: … accepting connections`                                                        |
| `GET /api/health`                | `{"status":"ok","service":"zeropeek-backend","version":"0.0.0","questionTypes":13}` |
| `GET /`                          | 200                                                                                 |

### 5.3 Healthcheck catches a credential mismatch

Volume initialised by user `origuser`, stack then reconfigured with `wronguser`:

- old check (`pg_isready` only) → would report **healthy** (wrong);
- new check → `psql: … FATAL: password authentication failed for user "wronguser"`,
  health stays `starting`/`unhealthy` while the server process runs.

### 5.4 Data safety

- No volume was deleted during the fix; the diagnostic volumes were created
  explicitly for the tests and removed afterwards.
- After a **failed** initialisation the volume is empty, so setting a password
  and redeploying recovers cleanly — verified: retry with a valid password gives
  a running container and a working `psql` login. **No data loss.**

### 5.5 Repository checks

- `npm run format:check` → all files formatted.
- `npm run typecheck` → pass.
- `npm test` → 21 tests pass (7 + 5 + 9 across the three packages).

## 6. Remaining limitations

- The real Portainer instance was **not** available here; every test ran against
  the same `docker-compose.portainer.yml` with `docker compose`. The behaviour
  that Portainer exercises is the Compose interpolation and healthcheck logic,
  both covered above.
- If the existing `db-data` volume on the server was initialised with a
  **different** `POSTGRES_USER`/password, setting new values will not change the
  credentials inside the volume. In that case the stack values must be set to the
  credentials that already exist (do not delete the volume). How to tell: if the
  container log repeats `FATAL: role "<user>" does not exist`, the configured user
  is not the one in the volume.
- Automatic TLS (`ZP_DOMAIN`, `HTTP_PORT=443`) is unchanged and still out of
  scope for this fix.

## 7. Steps required in Portainer

1. **Stacks** → select the `zeropeek` stack.
2. Open **Environment variables**.
3. Set `POSTGRES_DB` and `POSTGRES_USER` (e.g. `zeropeek` / `zeropeek`).
4. Set `POSTGRES_PASSWORD` to a strong value (`openssl rand -base64 32`).
5. Set `DATABASE_URL` to repeat exactly those values:
   `postgresql://<user>:<password>@db:5432/<db>?schema=public`.
6. **Update the stack** (re-pull the compose file from Git so the `:?` guards and
   the new healthcheck take effect).
7. Confirm all five services show **healthy** and
   `curl http://<host>/api/health` returns `{"status":"ok", …}`.

If the stack fails to deploy with a `required variable … is missing a value`
message, that is the new guard working: the named variable is still unset or
empty.
