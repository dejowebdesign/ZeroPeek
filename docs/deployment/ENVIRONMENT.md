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

| Variable            | Required | Default | Description                                                                                                                  |
| ------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_DB`       | yes      | –       | Database name created on first start.                                                                                        |
| `POSTGRES_USER`     | yes      | –       | Database user.                                                                                                               |
| `POSTGRES_PASSWORD` | yes      | –       | Database password. Use a long random value.                                                                                  |
| `DATABASE_URL`      | no       | derived | Connection string used by the backend (Prisma). When empty it is built from the three values above (host `db`, port `5432`). |

> The first three values are guarded with Compose's `:?` operator: if any of them
> is missing **or empty**, the stack fails to deploy with a clear message
> instead of starting a database that can never become healthy. An empty
> `POSTGRES_PASSWORD` aborts PostgreSQL initialisation
> (`Database is uninitialized and superuser password is not specified`) and
> leaves `db` permanently `unhealthy` – see
> [../reports/postgresql-password-fix.md](../reports/postgresql-password-fix.md).

> **`DATABASE_URL` is derived automatically.** Leave it empty and the backend
> builds `postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@db:5432/<POSTGRES_DB>?schema=public`
> from the values above, percent-encoding anything in the password that is
> significant in a URL (`@`, `:`, `/`, `?`, `#`, `%`, a space, …). This is the
> recommended setup: the credentials live in exactly one place and cannot drift
> apart. Set `DATABASE_URL` explicitly only when the database is not the `db`
> service (e.g. an external server); then it must repeat exactly the same user,
> password and database name, with the password percent-encoded.

> `POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD` are applied **only when
> the `db-data` volume is first initialised**. On an existing volume PostgreSQL
> ignores them, so editing them later does not rename the user or change the
> password; the credentials that already exist inside the volume remain in
> force.

## Redis

| Variable          | Required | Default              | Description                                                                               |
| ----------------- | -------- | -------------------- | ----------------------------------------------------------------------------------------- |
| `REDIS_URL`       | no       | `redis://cache:6379` | Connection string for the Socket.IO / rate-limit cache. Host is the service name `cache`. |
| `REDIS_MAXMEMORY` | no       | `256mb`              | Memory ceiling for the cache-only Redis instance.                                         |

> **Redis is optional.** It is used for Socket.IO scaling and rate limiting, but
> the app runs without it. The compose file defaults `REDIS_URL` to the bundled
> `cache` service, so it normally needs no entry. The backend probes the
> connection on start and logs a clear warning when it is unreachable, then keeps
> serving; a cache outage never takes the app down.

## Application

| Variable       | Required | Default                | Description                                                                                                                                            |
| -------------- | -------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`     | no       | `production` (compose) | Runtime mode.                                                                                                                                          |
| `BACKEND_PORT` | no       | `3000`                 | Port Fastify listens on inside the container.                                                                                                          |
| `BACKEND_HOST` | no       | `0.0.0.0`              | Bind address.                                                                                                                                          |
| `LOG_LEVEL`    | no       | `info`                 | Pino log level.                                                                                                                                        |
| `APP_BASE_URL` | yes      | –                      | Public URL of the app; used for links, QR codes and cookie scope. Must be an absolute http(s) URL. A localhost address is accepted but logs a warning. |
| `CORS_ORIGIN`  | no       | `APP_BASE_URL`         | Allowed browser origin. Defaults to `APP_BASE_URL` when empty.                                                                                         |

## Sessions and cookies

| Variable            | Required | Default                     | Description                                                                                      |
| ------------------- | -------- | --------------------------- | ------------------------------------------------------------------------------------------------ |
| `SESSION_SECRET`    | yes      | –                           | Signing secret. `openssl rand -hex 32`. Never reuse or commit.                                   |
| `SESSION_TTL_HOURS` | no       | `72`                        | Session lifetime in hours.                                                                       |
| `COOKIE_NAME`       | no       | `zp_session`                | Session cookie name.                                                                             |
| `COOKIE_SECURE`     | no       | derived from `APP_BASE_URL` | Session cookie `Secure` flag. Empty = derive: an `https://` origin sets it, plain HTTP does not. |

## Required values fail fast

In production the backend validates its configuration on start. If any of
`SESSION_SECRET`, `DATABASE_URL` (or the `POSTGRES_*` values it is built from) or
`APP_BASE_URL` is missing or invalid, the container stops immediately with a
readable message that names every offending variable and how to fix it – instead
of a restart loop. The compose file also guards `POSTGRES_DB`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `APP_BASE_URL` and `SESSION_SECRET` with Compose's `:?`
operator, so most mistakes are caught before the containers even start.

`REDIS_URL` is deliberately **not** required: it defaults to the bundled `cache`
service, and the backend logs a warning and continues when Redis is unreachable.
A localhost `APP_BASE_URL` is likewise a warning, not an error, so an internal
deployment still starts.

In development and test the lenient defaults are kept.

## Reverse proxy

| Variable               | Required | Default                  | Description                                                                                           |
| ---------------------- | -------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `HTTP_PORT`            | no       | `3737`                   | Host port published by Caddy. Set `443` for TLS.                                                      |
| `CADDY_CONTAINER_PORT` | no       | `80`                     | Port Caddy listens on inside the container (`80` HTTP, `443` TLS).                                    |
| `ZP_SITE_ADDRESS`      | no       | empty                    | Domain Caddy serves. Empty = plain HTTP on `:80`. Set to the public domain to enable automatic HTTPS. |
| `ZP_ACME_CA`           | no       | Let's Encrypt production | ACME directory. Set to the staging URL while testing to protect the production rate limit.            |

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

### Certificate storage and the Let's Encrypt rate limit

Caddy stores every issued certificate and the ACME account under `/data`. The
compose file mounts that path from the named volume `caddy-data`, and `/config`
from `caddy-config`, so both survive container recreation, image updates and
redeploys.

> **This is required.** Without the volume, every redeploy forgets the
> certificate and the account and requests a new one. Let's Encrypt allows **50
> certificates per registered domain per week**; a stack that is redeployed
> several times can exhaust that quota and then fails with
> `too many certificates (50) already issued for "<domain>"`. With the volume,
> Caddy only requests a certificate when it has actually expired.

While testing the TLS setup, point Caddy at the **staging** directory so a
mistake cannot consume the production quota:

```env
ZP_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory
```

Staging certificates are not trusted by browsers (that is expected). Once the
site loads over HTTPS with a staging certificate, remove `ZP_ACME_CA` (or set it
empty) to obtain a trusted production certificate. To discard staging
certificates first, remove the volume:

```bash
docker volume rm <stack>_caddy-data   # e.g. zeropeek_caddy-data
```

If the quota is already exhausted, wait for it to reset (a week from the first
request) and then redeploy with the volume in place; do not delete the volume in
a loop, which only makes it worse.

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
