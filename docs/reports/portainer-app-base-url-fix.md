# Portainer deployment fix – APP_BASE_URL, CORS and the ACME challenge port

**Project:** ZeroPeek
**Scope:** Make the Portainer stack deploy for the canonical domain
`https://zeropeek.xubi.org`. Fix the reported `APP_BASE_URL` interpolation error,
centralise the configuration so no value has to be guessed, and publish the port
Caddy needs for Let's Encrypt. **No product features were added.**
**Branch:** `fix/portainer-app-base-url`

Related: [PORTAINER.md](../deployment/PORTAINER.md) ·
[ENVIRONMENT.md](../deployment/ENVIRONMENT.md) ·
[portainer-redis-and-acme-fix.md](./portainer-redis-and-acme-fix.md) ·
[portainer-config-fix.md](./portainer-config-fix.md) ·
[postgresql-password-fix.md](./postgresql-password-fix.md)

---

## 1. Exact cause of the reported error

```
failed to load the compose file:
error while interpolating services.backend.environment.APP_BASE_URL:
required variable APP_BASE_URL is missing a value:
APP_BASE_URL muss gesetzt sein (z. B. https://quiz.example.com)
```

`docker-compose.portainer.yml` declared

```yaml
APP_BASE_URL: ${APP_BASE_URL:?APP_BASE_URL muss gesetzt sein (z. B. https://quiz.example.com)}
```

The `:?` operator aborts the **whole** deployment when the variable is missing
**or empty**. `APP_BASE_URL` is not a secret and it has one canonical value for
this deployment (`https://zeropeek.xubi.org`), so guarding it only turned a value
the compose file could know into a manual step that stops the stack.

The same class of bug was fixed for `REDIS_URL` in the previous change. This
change removes the last unnecessary guard, gives `APP_BASE_URL` a real default
and documents the complete variable set in one place, so the stack cannot fail
one variable at a time again.

Two further gaps surfaced while verifying:

- In TLS mode Caddy listens on `443`, but the ACME HTTP-01 challenge and the
  HTTP→HTTPS redirect both need **container port 80** published. Nothing mapped
  it, so a fresh certificate could not be issued.
- `COOKIE_SECURE` was documented as “leave empty”, which works, but the public
  site is HTTPS-only, so the template now sets it explicitly.

## 2. Changed and new files

| File                                              | Change                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `docker-compose.portainer.yml`                    | `APP_BASE_URL` now defaults to `https://zeropeek.xubi.org` (no `:?` guard); added the ACME/redirect port 80 |
| `.env.portainer.example`                          | Domain values for `zeropeek.xubi.org`, `COOKIE_SECURE=true`, challenge-port documentation                   |
| `docs/deployment/PORTAINER.md`                    | Complete variable list (§5.1), step-by-step (§5.2), TLS section (§6.1), troubleshooting rows                |
| `docs/deployment/ENVIRONMENT.md`                  | `APP_BASE_URL` documented as optional with its default; `CORS_ORIGIN` default = `APP_BASE_URL`              |
| `packages/backend/src/deployment.compose.test.ts` | **New.** Regression test that guards the compose/documentation contract                                     |
| `docs/reports/portainer-app-base-url-fix.md`      | **New.** This report                                                                                        |

No file was deleted or renamed, no product logic changed and the database volume
is untouched.

## 3. Complete Portainer variable list

Required — the deployment stops without these (Compose `:?` guards):

| Variable            | Value                    | Notes                                   |
| ------------------- | ------------------------ | --------------------------------------- |
| `POSTGRES_DB`       | `zeropeek`               | Existing database name.                 |
| `POSTGRES_USER`     | `zeropeek`               | User already inside the volume.         |
| `POSTGRES_PASSWORD` | _your database password_ | Secret. Must match the existing volume. |
| `SESSION_SECRET`    | `openssl rand -hex 32`   | Secret. Long random value.              |

Set for `https://zeropeek.xubi.org` (all have working defaults):

| Variable                 | Value                       |
| ------------------------ | --------------------------- |
| `APP_BASE_URL`           | `https://zeropeek.xubi.org` |
| `CORS_ORIGIN`            | `https://zeropeek.xubi.org` |
| `ZP_SITE_ADDRESS`        | `zeropeek.xubi.org`         |
| `CADDY_CONTAINER_PORT`   | `443`                       |
| `HTTP_PORT`              | `443`                       |
| `ZP_HTTP_CHALLENGE_PORT` | `80`                        |
| `COOKIE_SECURE`          | `true`                      |

Optional: `REDIS_URL` (default `redis://cache:6379`), `DATABASE_URL` (derived
from `POSTGRES_*`), `ZEROPEEK_IMAGE_TAG`, `ZP_ACME_CA`, `SESSION_TTL_HOURS`,
`COOKIE_NAME`, `LOG_LEVEL`, `REDIS_MAXMEMORY`, `ZEROPEEK_BACKEND_IMAGE`,
`ZEROPEEK_FRONTEND_IMAGE`. The full table is in
[PORTAINER.md §5.1](../deployment/PORTAINER.md).

## 4. Why the database volume is safe

`POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD` are read by the
`postgres` image **only on first initialisation** of an empty `db-data` volume.
On an existing volume they are ignored — changing the compose value does **not**
change the role or password inside PostgreSQL.

Consequence: if `DATABASE_URL` is derived from a `POSTGRES_PASSWORD` that no
longer matches the volume, the backend cannot connect. The correct fix is to put
the **current** password of the volume into `POSTGRES_PASSWORD` (the single
source of truth), not to change the database. No `ALTER ROLE`, no volume
removal, no `docker compose down -v`. The safe procedure is in
[PORTAINER.md §5.2](../deployment/PORTAINER.md).

## 5. Verification (all with a separate test database and test volumes)

| Check                                                  | Result                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `docker compose config` without `APP_BASE_URL`         | exit 0, renders `https://zeropeek.xubi.org` (reported error gone)                                            |
| `docker compose config` with an empty `SESSION_SECRET` | exit 1, readable message (still required, correctly)                                                         |
| Full stack, password `p@ss:w/rd?#%!*z`                 | 5/5 containers `healthy`                                                                                     |
| Derived `DATABASE_URL`                                 | `postgresql://zeropeek:p%40ss%3Aw%2Frd%3F%23%25%21%2Az@db:5432/zeropeek?schema=public` — exactly URL-encoded |
| `prisma migrate deploy` (twice)                        | applied once, then “No pending migrations to apply”                                                          |
| `/api/health` on 3737 and on 80                        | `{"status":"ok",…}`                                                                                          |
| CORS preflight for `Origin: https://zeropeek.xubi.org` | 204                                                                                                          |
| Backend logs grep for the password                     | 0 matches (raw and encoded)                                                                                  |
| Redis unreachable                                      | warning, backend stays `healthy`                                                                             |
| Backend with no config                                 | readable fail-fast message, exit — no restart loop                                                           |
| Redeploy (`up -d --force-recreate`)                    | DB row and Caddy `/data` marker both survive                                                                 |
| TLS Caddyfile (`caddy validate`)                       | “Valid configuration”, auto HTTP→HTTPS redirect enabled                                                      |
| TLS `config` render with `ZP_HTTP_CHALLENGE_PORT=80`   | `443` and `80` published, no conflict                                                                        |
| Backend test suite against the test DB                 | 61/61 pass (incl. the new 6-test deployment contract)                                                        |
| `npm run typecheck` / `format:check` / `build`         | all green                                                                                                    |

## 6. Remaining manual steps

1. In Portainer, open the `zeropeek` stack → **Environment variables** and enter
   the values from section 3 (the four required ones already exist; add the
   seven `zeropeek.xubi.org` HTTPS values).
2. Ensure the **current** password inside the `db-data` volume is the one in
   `POSTGRES_PASSWORD`. Do not change the database.
3. Deploy/update the stack. Nothing is changed in the running Portainer instance
   by this pull request.
4. Optional: for the first TLS attempt set `ZP_ACME_CA` to the Let's Encrypt
   staging directory to avoid the production rate limit, then remove it.

## 7. Open question for the maintainer

`ZP_HTTP_CHALLENGE_PORT` defaults to `HTTP_PORT`. In plain-HTTP mode the
duplicate `3737:80` collapses and the default deployment is unchanged. In TLS
mode (`HTTP_PORT=443`) set `ZP_HTTP_CHALLENGE_PORT=80` so the challenge port does
not collide with the TLS listener. An alternative is to guard it with `:?` in
TLS mode, but that would reintroduce the exact failure mode this change removes,
so a documented default was chosen instead.
