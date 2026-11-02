# Environment variables

Complete reference for the ZeroPeek configuration. Two files carry these keys:

- `.env.example` – local development (`docker-compose.yml`).
- `.env.portainer.example` – production (`docker-compose.portainer.yml`).

Never commit a real `.env`. In Portainer the values are entered in the stack's
environment editor; in local development copy the example to `.env`.

---

## Image selection

| Variable                  | Required | Default                                   | Description                                                            |
| ------------------------- | -------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| `ZEROPEEK_IMAGE_TAG`      | no       | `latest`                                  | Tag for both ZeroPeek images. Pin a `sha-<short>` for reproducibility. |
| `ZEROPEEK_BACKEND_IMAGE`  | no       | `ghcr.io/dejowebdesign/zeropeek-backend`  | Override if the backend image moves.                                   |
| `ZEROPEEK_FRONTEND_IMAGE` | no       | `ghcr.io/dejowebdesign/zeropeek-frontend` | Override if the frontend image moves.                                  |

## PostgreSQL

| Variable            | Required | Default | Description                                                                    |
| ------------------- | -------- | ------- | ------------------------------------------------------------------------------ |
| `POSTGRES_DB`       | yes      | –       | Database name created on first start.                                          |
| `POSTGRES_USER`     | yes      | –       | Database user.                                                                 |
| `POSTGRES_PASSWORD` | yes      | –       | Database password. Use a long random value.                                    |
| `DATABASE_URL`      | yes      | –       | Connection string used by the backend (Prisma). Host is the service name `db`. |

> The first three values are guarded with Compose's `:?` operator: if any of them
> is missing **or empty**, the stack fails to deploy with a clear message
> instead of starting a database that can never become healthy. An empty
> `POSTGRES_PASSWORD` aborts PostgreSQL initialisation
> (`Database is uninitialized and superuser password is not specified`) and
> leaves `db` permanently `unhealthy` – see
> [../reports/postgresql-password-fix.md](../reports/postgresql-password-fix.md).
>
> `DATABASE_URL` must repeat exactly the same database name, user and password.
> A mismatch does not stop the database container from starting, but the backend
> cannot log in and `/api/health` fails.

> `POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD` are applied **only when
> the `db-data` volume is first initialised**. On an existing volume PostgreSQL
> ignores them, so editing them later does not rename the user or change the
> password; the credentials that already exist inside the volume remain in
> force.

## Redis

| Variable          | Required | Default | Description                                             |
| ----------------- | -------- | ------- | ------------------------------------------------------- |
| `REDIS_URL`       | yes      | –       | `redis://cache:6379`. Host is the service name `cache`. |
| `REDIS_MAXMEMORY` | no       | `256mb` | Memory ceiling for the cache-only Redis instance.       |

## Application

| Variable       | Required | Default                | Description                                                       |
| -------------- | -------- | ---------------------- | ----------------------------------------------------------------- |
| `NODE_ENV`     | no       | `production` (compose) | Runtime mode.                                                     |
| `BACKEND_PORT` | no       | `3000`                 | Port Fastify listens on inside the container.                     |
| `BACKEND_HOST` | no       | `0.0.0.0`              | Bind address.                                                     |
| `LOG_LEVEL`    | no       | `info`                 | Pino log level.                                                   |
| `APP_BASE_URL` | yes      | –                      | Public URL of the app; used for links, QR codes and cookie scope. |
| `CORS_ORIGIN`  | yes      | `APP_BASE_URL`         | Allowed browser origin. Usually identical to `APP_BASE_URL`.      |

## Sessions and cookies

| Variable            | Required | Default                       | Description                                                       |
| ------------------- | -------- | ----------------------------- | ----------------------------------------------------------------- |
| `SESSION_SECRET`    | yes      | –                             | Signing secret. `openssl rand -hex 32`. Never reuse or commit.    |
| `SESSION_TTL_HOURS` | no       | `72`                          | Session lifetime in hours.                                        |
| `COOKIE_NAME`       | no       | `zp_session`                  | Session cookie name.                                              |
| `COOKIE_SECURE`     | no       | `true` (prod) / `false` (dev) | Send cookies only over HTTPS. Set `false` only for local testing. |

## Reverse proxy

| Variable    | Required | Default     | Description                                                     |
| ----------- | -------- | ----------- | --------------------------------------------------------------- |
| `HTTP_PORT` | no       | `80`        | Host port published by Caddy. Set `443` when TLS is configured. |
| `ZP_DOMAIN` | no       | `localhost` | Domain served by Caddy; used for automatic HTTPS.               |

## Optional

| Variable    | Required | Default | Description                                                   |
| ----------- | -------- | ------- | ------------------------------------------------------------- |
| `SMTP_URL`  | no       | –       | Mail server for verification / password reset (later phases). |
| `MAIL_FROM` | no       | –       | Sender address for outgoing mail.                             |

---

## Backward compatibility

The backend reads a couple of values under more than one name so older
deployments keep working:

- `APP_BASE_URL` takes precedence over the legacy `PUBLIC_BASE_URL`.
- `COOKIE_NAME` takes precedence over the legacy `SESSION_COOKIE_NAME`.

## Generating secrets

```bash
openssl rand -hex 32     # SESSION_SECRET
openssl rand -base64 32  # POSTGRES_PASSWORD
```

## Local development

```bash
cp .env.example .env
docker compose up --build
# frontend via proxy: http://localhost:8080
```

The local compose file additionally publishes the database and Redis ports for
debugging; the production stack does not.
