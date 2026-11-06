# Portainer deployment

ZeroPeek runs in production as a Portainer stack defined by
`docker-compose.portainer.yml`. The stack **pulls pre-built images from GHCR**
and never builds anything on the host.

- Images: `ghcr.io/dejowebdesign/zeropeek-backend`,
  `ghcr.io/dejowebdesign/zeropeek-frontend`
- Stack file: `docker-compose.portainer.yml` (repository root)
- Environment template: `.env.portainer.example`

Related documents: [GITHUB_ACTIONS.md](./GITHUB_ACTIONS.md) ·
[ENVIRONMENT.md](./ENVIRONMENT.md) · [ROLLBACK.md](./ROLLBACK.md)

---

## 1. What the stack contains

| Service    | Image                           | Published port | Purpose                              |
| ---------- | ------------------------------- | -------------- | ------------------------------------ |
| `proxy`    | `caddy:2-alpine`                | `${HTTP_PORT}` | Edge reverse proxy, only public port |
| `frontend` | `ghcr.io/.../zeropeek-frontend` | –              | Static Vite build served by Caddy    |
| `backend`  | `ghcr.io/.../zeropeek-backend`  | –              | Fastify API + Socket.IO              |
| `db`       | `postgres:16-alpine`            | –              | Persistent data (`db-data` volume)   |
| `cache`    | `redis:7-alpine`                | –              | Socket.IO scaling / rate limiting    |

All five share the internal bridge network `zeropeek`. Only `proxy` publishes a
port, so the database and Redis are unreachable from outside the Docker host.

## 2. Prerequisites

- A Docker host with Portainer (CE or BE) running.
- Outbound internet access from the host to `ghcr.io`.
- Free host ports: **3737** for the proxy in plain-HTTP mode, or **443 and 80**
  for TLS (`443` serves the site, `80` answers the ACME challenge and the
  HTTP→HTTPS redirect).

## 3. Adding the stack in Portainer

### Option A – from the Git repository (recommended)

1. Portainer → **Stacks** → **Add stack**.
2. Name: `zeropeek`.
3. Build method: **Repository**.
4. Repository settings:
   - **Repository URL:** `https://github.com/dejowebdesign/ZeroPeek`
   - **Repository reference:** `refs/heads/main`
   - **Compose path:** `docker-compose.portainer.yml`
   - Authentication: off for a public repository. For a private repository,
     enable **Authentication** and supply a GitHub token with read access.
5. **Environment variables:** paste the full list from section 5.1 in one pass.
   At minimum set `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and
   `SESSION_SECRET`; for `zeropeek.xubi.org` also set the HTTPS values from
   section 6.1. Leave `DATABASE_URL`, `REDIS_URL` and `CORS_ORIGIN` empty only if
   you prefer their defaults — the compose file already knows the `db` and
   `cache` services.
6. **Deploy the stack.**

Portainer can later poll the repository (**GitOps updates**) and redeploy when
the compose file changes. Because the images are pulled by tag, an update to
the compose file is not required for a new application version — see section 7.

### Option B – paste the compose file (no repository access)

1. Portainer → **Stacks** → **Add stack** → **Web editor**.
2. Paste the contents of `docker-compose.portainer.yml`.
3. Add the environment variables, then deploy.

> **Important:** use the _portainer_ compose file, not `docker-compose.yml`.
> The latter has `build:` sections and is meant for local development only.

## 4. GHCR access

### Public repository

Nothing to do — Portainer pulls the images anonymously.

### Private repository

The packages are private too. Register the registry once in Portainer:

1. **Registries** → **Add registry** → **Custom registry**.
2. Registry URL: `ghcr.io`
3. Username: your GitHub username.
4. Password: a **Personal Access Token (classic)** with the `read:packages`
   scope. (A fine-grained token needs "Read" access to packages.)
5. Confirm. Portainer now uses these credentials for `ghcr.io` pulls.

The token is stored in Portainer, never in this repository.

> **Changing the repository to private does not change the packages.** GHCR
> package visibility is set per package and only inherits the repository's
> visibility **when the package is first pushed**; after that the two are
> independent. If the repository is later made private, the existing
> `zeropeek-backend` / `zeropeek-frontend` packages may still be public — or, if
> they were already private, they stay private. Verify each package's visibility
> under **GitHub → Packages → the package → Package settings**, and either keep
> them public (anonymous pulls keep working, nothing to configure in Portainer) or
> make them private **and** register the GHCR credentials above. A private package
> without credentials makes Portainer's pull fail with `unauthorized`.

## 5. Environment variables

Set them in the stack's **Environment variables** section. The complete list and
meaning is in [ENVIRONMENT.md](./ENVIRONMENT.md).

### 5.1 The complete variable list

This is the **full** set of variables the stack reads, with the value to use for
the production domain `zeropeek.xubi.org`. Enter them all in the Portainer stack
**Environment variables** editor in one pass — that is what prevents the stack
from failing on one missing variable at a time.

**Required — the deployment stops without these:**

| Variable            | Value for `zeropeek.xubi.org` | Notes                                                          |
| ------------------- | ----------------------------- | -------------------------------------------------------------- |
| `POSTGRES_DB`       | `zeropeek`                    | Name of the existing database.                                 |
| `POSTGRES_USER`     | `zeropeek`                    | User that already exists in the volume.                        |
| `POSTGRES_PASSWORD` | _your database password_      | **Secret.** Must match the password already inside the volume. |
| `SESSION_SECRET`    | `openssl rand -hex 32`        | **Secret.** Long random value; never reuse or commit.          |

**Set for `zeropeek.xubi.org` (they also have working defaults):**

| Variable                 | Value for `zeropeek.xubi.org` | Notes                                                                                    |
| ------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `APP_BASE_URL`           | `https://zeropeek.xubi.org`   | Default already; set only for a different host.                                          |
| `CORS_ORIGIN`            | `https://zeropeek.xubi.org`   | Same-origin default is `APP_BASE_URL`; set it explicitly to be explicit.                 |
| `ZP_SITE_ADDRESS`        | `zeropeek.xubi.org`           | The public domain Caddy serves. Enables automatic HTTPS.                                 |
| `CADDY_CONTAINER_PORT`   | `443`                         | Caddy listens on 443 inside the container (TLS).                                         |
| `HTTP_PORT`              | `443`                         | Host port published for HTTPS.                                                           |
| `ZP_HTTP_CHALLENGE_PORT` | `80`                          | Host port mapped to container port 80 for the ACME challenge (default: `HTTP_PORT`).     |
| `COOKIE_SECURE`          | `true`                        | Secure cookies. Default derives this from `APP_BASE_URL`; set it explicitly for clarity. |

**Optional — leave unset unless you need them:**

| Variable                                             | Default                   | When to set it                                                               |
| ---------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| `REDIS_URL`                                          | `redis://cache:6379`      | Only when Redis is **not** the bundled `cache` service.                      |
| `DATABASE_URL`                                       | derived from `POSTGRES_*` | Only when the database is **not** the `db` service.                          |
| `ZEROPEEK_IMAGE_TAG`                                 | `latest`                  | Pin `sha-<short>` for a reproducible deployment.                             |
| `ZP_ACME_CA`                                         | Let's Encrypt production  | Set to the staging directory while testing TLS.                              |
| `SESSION_TTL_HOURS`                                  | `72`                      | Session lifetime.                                                            |
| `COOKIE_NAME`                                        | `zp_session`              | Session cookie name.                                                         |
| `LOG_LEVEL`                                          | `info`                    | Pino log level.                                                              |
| `REDIS_MAXMEMORY`                                    | `256mb`                   | Memory ceiling for the cache-only Redis.                                     |
| `ZEROPEEK_BACKEND_IMAGE` / `ZEROPEEK_FRONTEND_IMAGE` | GHCR defaults             | Override if the images move.                                                 |
| `SMTP_URL`                                           | empty (mail disabled)     | Enable account-confirmation e-mails (Phase 6.3). Any SMTP relay, e.g. Brevo. |
| `MAIL_FROM`                                          | empty                     | Verified sender address for outgoing mail.                                   |
| `MAIL_FROM_NAME`                                     | `ZeroPeek`                | Display name shown next to `MAIL_FROM`.                                      |
| `MAIL_VERIFY_TTL_HOURS`                              | `24`                      | How long a confirmation link stays valid.                                    |
| `AUTH_RATE_LIMITS`                                   | `true`                    | Stricter per-route limits on the auth endpoints.                             |

> **Exactly four values are required and must not be empty** (Compose `:?`
> guards): `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and
> `SESSION_SECRET`. **Every other variable has a correct default**, including
> `APP_BASE_URL` (which defaults to `https://zeropeek.xubi.org`). `REDIS_URL`,
> `CORS_ORIGIN`, `DATABASE_URL` and `COOKIE_SECURE` are never required — the
> stack knows its own `cache` and `db` services and derives the rest.

### 5.2 Setting the PostgreSQL credentials in Portainer

`POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD` are **required and must
not be empty**. The stack file guards them with Compose's `:?` operator, so a
missing or empty value stops the deployment with a clear error instead of
starting a database that can never become healthy.

Step by step (for `zeropeek.xubi.org`):

1. Open Portainer and sign in.
2. Go to **Stacks** and select the `zeropeek` stack (container names start with
   `zero_peek-`).
3. Open the stack's **Editor** / **Environment variables** section.
4. Set `POSTGRES_DB` – the database name, e.g. `zeropeek`.
5. Set `POSTGRES_USER` – the database user, e.g. `zeropeek`.
6. Set `POSTGRES_PASSWORD` to the password that already exists in the volume
   (see below if you are unsure). It may contain any characters; the connection
   string is built from it with URL-safe encoding.
7. Leave `DATABASE_URL` **empty**. The backend builds it from the three values
   above. Set it only for an external database.
8. Set `SESSION_SECRET` (`openssl rand -hex 32`).
9. Set the HTTPS values for the domain (see section 6.1):
   `APP_BASE_URL=https://zeropeek.xubi.org`,
   `CORS_ORIGIN=https://zeropeek.xubi.org`, `ZP_SITE_ADDRESS=zeropeek.xubi.org`,
   `CADDY_CONTAINER_PORT=443`, `HTTP_PORT=443`, `ZP_HTTP_CHALLENGE_PORT=80` and
   `COOKIE_SECURE=true`.
10. Click **Deploy the stack** (or **Update the stack**).

> **Existing volume:** these three values are applied only the first time the
> `db-data` volume is initialised. If the volume already exists, PostgreSQL
> ignores them and the credentials stored inside the volume stay in force – the
> values in the stack must match them, otherwise the backend cannot log in.
> Never delete the volume to "reset" the password without backing up first.

> **Never commit credentials.** Enter them only in Portainer. `.env.portainer.example`
> contains placeholders, not real secrets.

### 5.3 Aligning the credentials with an existing volume

`POSTGRES_PASSWORD` in the stack does **not** change the password of an
already-initialised cluster; it only takes effect on a fresh volume. To line the
stack up with a database that already exists, recover the values that are in use
instead of changing them:

```bash
# 1. What user and database does the volume actually contain?
docker exec zero_peek-db-1 psql -U postgres -c '\du'   # roles
docker exec zero_peek-db-1 psql -U postgres -c '\l'    # databases

# 2. Test the password you intend to set (no change is made):
docker exec -e PGPASSWORD='<the-password>' zero_peek-db-1 \
  psql -w -h "$(hostname)" -U <user> -d <db> -tAc 'SELECT 1'
```

- If the login succeeds, enter exactly those values in the stack.
- If it fails with `password authentication failed`, the password in the stack is
  not the one in the volume. Enter the **original** password; if it was lost, an
  intentional password change is required and must be approved first (it is a
  change to the running database and outside the scope of this repository):

  ```sql
  ALTER ROLE "<user>" WITH PASSWORD '<new-password>';
  ```

  Change `POSTGRES_PASSWORD` in the stack to the same new value afterwards. This
  is the only supported way to change the password without deleting data.

### 5.4 First working deployment with preliminary values

To get the stack **running once** before the real credentials are known, start
from the template and fill in two obviously-preliminary values. Everything else
already has a correct default.

```bash
cp .env.portainer.example .env      # `.env` is git-ignored, never committed
```

Then set only these two lines in `.env` (the rest of the file stays as-is):

```env
POSTGRES_PASSWORD=zeropeek-preliminary-password
SESSION_SECRET=preliminary-session-secret-replace-before-production-01
```

`SESSION_SECRET` must be at least 32 characters and must not contain one of the
placeholder strings the backend rejects (`change-me-session-secret`,
`please-generate-a-32-byte-hex-secret`, `phase-0-placeholder`); the value above
satisfies both.

> **These are throw-away placeholders, not secrets.** They exist only so the
> stack comes up and the database is created. Replace them with real values
> before the deployment is used by anyone.

Then resolve and start locally:

```bash
docker compose -f docker-compose.portainer.yml config -q   # must exit 0
docker compose -f docker-compose.portainer.yml up -d
```

**Replacing the preliminary values later.** A repository-managed Portainer stack
does **not** read a git-ignored `.env` from the repository; the values are taken
from the stack's **Environment variables** editor (or an `.env` uploaded there).
So the two placeholders are replaced in Portainer, not in Git:

1. Portainer → **Stacks** → the `zeropeek` stack → **Environment variables**.
2. `SESSION_SECRET` → a fresh `openssl rand -hex 32`.
3. `POSTGRES_PASSWORD` → see below, because of the existing volume.
4. **Update the stack**.

> **`POSTGRES_PASSWORD` is special.** On an **existing** `db-data` volume the
> stack value does not change the password stored in the database — PostgreSQL
> applies it only on first initialisation. If the volume already exists, set the
> stack value to the password the volume **already** uses (section 5.3). Only a
> brand-new volume adopts the preliminary password, in which case you should set
> the real password **before** the first start rather than afterwards. To replace
> a preliminary password on a volume that was created with it, follow the
> approved `ALTER ROLE … WITH PASSWORD` path in section 5.3.

### 5.5 Creating the first administrator

A fresh deployment has no user, so nobody can sign in. Set these two variables in
the stack's **Environment variables** editor to have the backend create the first
`ADMIN` account automatically on start:

| Variable                   | Value                                    |
| -------------------------- | ---------------------------------------- |
| `BOOTSTRAP_ADMIN_USER`     | the username you want, e.g. `admin`      |
| `BOOTSTRAP_ADMIN_PASSWORD` | a password of **at least 10 characters** |

How it behaves:

- It runs on start and creates **exactly one** `ADMIN` user — but only when
  **both** variables are set **and** no active administrator exists yet.
- The password is stored as an **Argon2id** hash; the plain value is never
  written to the database or to a log.
- The password must meet the same rule as everywhere else in ZeroPeek: at least
  **10 characters**. A shorter value is rejected and the account is not created
  (the backend logs an error and keeps running — check the log, then fix the value
  and restart).
- **Existing administrators are never touched.** If an active administrator
  already exists, the step does nothing: no overwrite, no change, no duplicate.
  Restarting the stack is therefore safe and idempotent.
- Leave **both** empty to skip automatic creation entirely.

> **Remove the values after the first successful start.** The account persists in
> the database, so the variables are no longer needed. Blanking them (or removing
> them from the stack) keeps the admin working and stops the password from sitting
> in the stack environment. This is recommended, but optional.

Verification after the first start:

```bash
docker logs zero_peek-backend-1 2>&1 | grep -i "bootstrap administrator"
# bootstrap administrator created
```

Then sign in at `https://<your-host>/admin` with the username and password above.

## 6. First start

After deploying, Portainer starts the services in dependency order: `db` and
`cache` become healthy first, then `backend`, then `proxy`. All five services
show a green **healthy** state when the stack is up.

Verification:

```bash
# The proxy publishes host port 3737 by default. Replace 3737 with your
# HTTP_PORT if you changed it.
curl -s http://<host>:3737/api/health
# {"status":"ok","service":"zeropeek-backend","version":"0.0.0","questionTypes":13}
```

Open `http://<host>:3737/` in a browser to see the ZeroPeek start page.

### 6.1 Enabling HTTPS (TLS)

ZeroPeek is published at **`https://zeropeek.xubi.org`**. The stack ships plain
HTTP by default so it works on any host immediately; for the public domain set
these variables in the stack environment **together**:

```env
ZP_SITE_ADDRESS=zeropeek.xubi.org
CADDY_CONTAINER_PORT=443
HTTP_PORT=443
ZP_HTTP_CHALLENGE_PORT=80
APP_BASE_URL=https://zeropeek.xubi.org
CORS_ORIGIN=https://zeropeek.xubi.org
COOKIE_SECURE=true
```

Then **Update the stack**. Caddy obtains and renews a Let's Encrypt certificate
for `ZP_SITE_ADDRESS` automatically. Two conditions must hold:

1. `zeropeek.xubi.org` resolves to the host in public DNS.
2. Ports **80 and 443** are both reachable from the internet. Caddy validates the
   certificate over the **HTTP-01 challenge on port 80** and redirects HTTP to
   HTTPS there; the site itself listens on 443. The compose file maps container
   port 80 to host port `ZP_HTTP_CHALLENGE_PORT` for exactly this (it defaults to
   `HTTP_PORT`, and in TLS mode you set it to `80`).
   If host port 80 is already taken, set `ZP_HTTP_CHALLENGE_PORT` to a free port
   and forward the host's public port 80 to it.

> **Why port 80 matters.** Caddy also supports the `tls-alpn-01` challenge on
> port 443, but the automatic HTTP→HTTPS redirect always binds port 80. Without
> it a certificate can still be issued via ALPN yet the redirect breaks, so the
> stack publishes port 80 on purpose. Keeping it published is the simplest,
> most reliable setup.

`COOKIE_SECURE=true` is set explicitly for clarity; it is also derived from the
`https://` `APP_BASE_URL` automatically.

> **Test with the staging directory first.** Set
> `ZP_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory` while
> validating the setup, then remove it for a trusted certificate. Let's Encrypt
> allows **50 certificates per registered domain per week**; a configuration that
> is redeployed repeatedly can exhaust the quota and then fails with
> `too many certificates (50) already issued for "<domain>"`.

> **Certificates persist in the `caddy-data` volume.** Caddy stores issued
> certificates and the ACME account under `/data`, mounted from `caddy-data`
> (and `/config` from `caddy-config`). Because the volume survives restarts and
> redeploys, Caddy only requests a new certificate when one actually expired –
> this is what prevents the rate-limit error. Do **not** remove these volumes
> during updates.

> Do not set `HTTP_PORT=443` while leaving `ZP_SITE_ADDRESS` empty: Caddy would
> then serve plain HTTP on a port clients expect to speak TLS on.

Verify:

```bash
curl -s https://zeropeek.xubi.org/api/health
# {"status":"ok","service":"zeropeek-backend","version":"0.0.0","questionTypes":13}
```

## 7. Updating to a new image

A push to `main` publishes new images tagged `sha-<short>`, `main` and `latest`
(see [GITHUB_ACTIONS.md](./GITHUB_ACTIONS.md)).

### Automatic (optional)

Configure the stack webhook secret `PORTAINER_WEBHOOK_URL` in GitHub; the
`deploy` job then triggers the redeploy after a successful publish. Portainer
re-pulls the images and recreates the containers.

### Manual

1. Portainer → **Stacks** → `zeropeek`.
2. Either:
   - **Update the stack** and re-deploy (Portainer re-pulls the images), or
   - Set `ZEROPEEK_IMAGE_TAG` to the new `sha-<short>` and **Update the stack**.
3. Portainer recreates only the containers whose image changed.

Pinning an explicit `sha-` tag is the more predictable option: you always know
exactly which commit is running, and a rollback is trivial
(see [ROLLBACK.md](./ROLLBACK.md)).

> If you run with `ZEROPEEK_IMAGE_TAG=latest`, remember to **pull** before
> redeploying, otherwise Docker keeps the cached `latest`.

## 8. Portainer compatibility notes

- **No build context required.** Every service uses `image:`; there are no
  `build:` keys, so the stack works from the web editor, from Git, and from
  Portainer's API without a repository checkout.
- **Self-contained proxy config.** The Caddyfile is embedded with the Compose
  `configs:` `content:` field, so the stack needs no host bind mounts.
- **Named volumes** `db-data` for PostgreSQL and `caddy-data` / `caddy-config`
  for Caddy's certificates and ACME account; Portainer shows them under
  **Volumes** and they survive stack updates. Do not remove `caddy-data` on
  update, or Caddy re-requests certificates (see section 6.1).
- **Healthchecks** on all five services; Portainer displays the health column.
- **Restart policy** `unless-stopped` on `db`, `cache`, `frontend` and `proxy`,
  and `on-failure:5` on `backend`. The backend exits non-zero on a
  misconfiguration, so a bounded `on-failure` policy avoids an endless restart
  loop while still restarting after a host reboot.
- **Secrets** come from the stack environment only; the compose file contains
  no credentials.

## 9. Troubleshooting

| Symptom                                                        | Cause / fix                                                                                                                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `denied` / `unauthorized` when pulling                         | Private package without registry credentials → add GHCR credentials (section 4)                                                                                                    |
| `pull access denied` for `zeropeek-backend`                    | Image not published yet → check the actions run in GitHub                                                                                                                          |
| Stack up but `/api/health` returns 502                         | `backend` not healthy yet, or the database credentials are wrong → check backend logs                                                                                              |
| Data lost after redeploy                                       | The `db-data` volume was removed → avoid "remove volumes" on update                                                                                                                |
| `failed to bind port 0.0.0.0:80/tcp`                           | Host port 80 is already in use → set `ZP_HTTP_CHALLENGE_PORT` to a free port and forward public port 80 to it, or set `HTTP_PORT` to a free port (default 3737) in plain-HTTP mode |
| `failed to bind port 0.0.0.0:443/tcp` (TLS)                    | `ZP_HTTP_CHALLENGE_PORT` defaults to `HTTP_PORT`; with `HTTP_PORT=443` also set `ZP_HTTP_CHALLENGE_PORT=80` so the challenge port does not collide with the TLS listener           |
| Deployment stops with `required variable … is missing a value` | A required variable is empty → set the named variable (section 5.1) and redeploy                                                                                                   |

### Backend container keeps restarting

The backend validates its configuration on start and prints a readable message.
Look at the top of the log:

```bash
docker logs zero_peek-backend-1
```

| Log message                                                        | Cause / fix                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `ZeroPeek backend cannot start: the configuration is incomplete …` | One or more required values are missing; the following lines name each variable and how to fix it      |
| `DATABASE_URL is missing or empty and cannot be derived`           | Set `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`, or set `DATABASE_URL` explicitly           |
| `SESSION_SECRET is missing or empty`                               | Set `SESSION_SECRET` (`openssl rand -hex 32`)                                                          |
| `Redis is not reachable at cache:6379 …`                           | The `cache` service is down. Not fatal – the app keeps serving → check `docker logs zero_peek-cache-1` |
| `APP_BASE_URL … localhost`                                         | Set `APP_BASE_URL` to the public origin, not a localhost address                                       |

### Redis warning in the backend log

`Redis is not reachable at cache:6379 …` is a **warning, not an error**: Redis is
optional (Socket.IO scaling and rate limiting only), so the backend starts and
serves normally. Check the cache container:

```bash
docker logs zero_peek-cache-1
```

### Backend cannot reach the database

The entrypoint waits for PostgreSQL and prints the Prisma error code and a hint
on every attempt; after a bounded number of attempts it stops with a clear
message and **leaves the volume untouched**:

```bash
docker logs zero_peek-backend-1
```

| Log line                                                            | Cause / fix                                                                      |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `waiting for the database (attempt …): P1000 authentication failed` | The stack password does not match the volume → see section 5.3                   |
| `… P1001 cannot reach the database server`                          | The `db` service is not running → check `docker logs zero_peek-db-1`             |
| `… P1003 the database does not exist`                               | `POSTGRES_DB` does not match the database in the volume → set the original value |
| `FATAL: the database is not reachable after 15 attempts`            | Fix the values above and redeploy; no data was changed                           |

### Database container stays `unhealthy`

`dependency failed to start: container zero_peek-db-1 is unhealthy` almost always
means the database could not initialise. Check the container log:

```bash
docker logs zero_peek-db-1
```

| Log message                                                         | Cause / fix                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `Database is uninitialized and superuser password is not specified` | `POSTGRES_PASSWORD` is empty → set a strong password in the stack (section 5.1) and redeploy          |
| `required variable POSTGRES_PASSWORD is missing a value`            | Same, but the `:?` guard caught it before the container started → set the variable                    |
| `database files are incompatible with server`                       | The volume was created by another PostgreSQL major version → migrate or use the matching image        |
| `FATAL: role "<user>" does not exist` (repeating)                   | `POSTGRES_USER` does not match the user inside the existing volume → set the original value           |
| Log is empty and the container keeps restarting                     | The password is empty; nothing is written because initdb aborts immediately → set `POSTGRES_PASSWORD` |

If the stack was deployed with an **empty** password against a **fresh** volume,
the volume stays empty, so simply setting the password and redeploying recovers
cleanly – no data is lost and no volume needs to be removed.
