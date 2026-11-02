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

| Variable               | Required | Default | Description                                                                                           |
| ---------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `HTTP_PORT`            | no       | `3737`  | Host port published by Caddy. Set `443` for TLS.                                                      |
| `CADDY_CONTAINER_PORT` | no       | `80`    | Port Caddy listens on inside the container (`80` HTTP, `443` TLS).                                    |
| `ZP_SITE_ADDRESS`      | no       | empty   | Domain Caddy serves. Empty = plain HTTP on `:80`. Set to the public domain to enable automatic HTTPS. |

> The default host port is **3737**, not 80, because port 80 is frequently
> already bound on the Docker host. Deploying with `HTTP_PORT=80` on such a host
> fails with `failed to bind port 0.0.0.0:80/tcp: bind: address already in use`.
> The container port stays 80; only the published host port changes.

### Enabling TLS

`ZP_SITE_ADDRESS` is the single switch for HTTPS. With it **empty** (the
default) Caddy serves plain HTTP on container port `80`, so the stack works out
of the box on a private network.

To serve HTTPS, set all three values consistently:

```env
ZP_SITE_ADDRESS=quiz.example.com
CADDY_CONTAINER_PORT=443
HTTP_PORT=443
```

Caddy then obtains and renews a Let's Encrypt certificate for
`quiz.example.com` automatically. Ports **80 and 443 must both be reachable
from the internet** so the ACME challenge can complete; Caddy uses port 80 for
the HTTP-01 challenge and the HTTP→HTTPS redirect even though the site itself
listens on 443.

> With TLS the host port must be **443**, not the 3737 default: clients expect
> HTTPS on 443.

> Publishing `HTTP_PORT=443` while leaving `ZP_SITE_ADDRESS` empty is a
> misconfiguration: Caddy would serve plain HTTP on a port clients expect to
> speak TLS on. Always set the three values together.

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
