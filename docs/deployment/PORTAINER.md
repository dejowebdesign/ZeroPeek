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
- A free host port for the proxy (**3737** by default, **443** for TLS).

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
5. **Environment variables:** add the six values from section 5.1. At minimum
   set `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `SESSION_SECRET` and
   `APP_BASE_URL`. Leave `DATABASE_URL` empty so it is built from the PostgreSQL
   values. `REDIS_URL` and `CORS_ORIGIN` already default correctly.
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

## 5. Environment variables

Set them in the stack's **Environment variables** section. The complete list and
meaning is in [ENVIRONMENT.md](./ENVIRONMENT.md).

### 5.1 The minimal set (recommended)

Only six values have to be entered by hand; everything else has a safe default.
`DATABASE_URL` is **not** among them – it is built automatically from the
PostgreSQL values, which keeps the credentials in exactly one place.

| Variable            | Required | Example                            | Notes                                                    |
| ------------------- | -------- | ---------------------------------- | -------------------------------------------------------- |
| `POSTGRES_DB`       | yes      | `zeropeek`                         | Name of the existing database.                           |
| `POSTGRES_USER`     | yes      | `zeropeek`                         | User that already exists in the volume.                  |
| `POSTGRES_PASSWORD` | yes      | `openssl rand -base64 32`          | Must match the password already inside the volume.       |
| `SESSION_SECRET`    | yes      | `openssl rand -hex 32`             | Long random value; never reuse or commit.                |
| `APP_BASE_URL`      | yes      | `https://quiz.example.com`         | Public origin; must not be a localhost address.          |
| `ZEROPEEK_IMAGE_TAG`| no       | `sha-1a2b3c4` (or `latest`)        | Pin a commit tag for reproducible deployments.           |

Optional, only when needed:

| Variable          | When to set it                                                             |
| ----------------- | -------------------------------------------------------------------------- |
| `CORS_ORIGIN`     | Defaults to `APP_BASE_URL`; set only if the browser origin differs.        |
| `DATABASE_URL`    | Only if the database is **not** the `db` service (e.g. an external host).  |
| `HTTP_PORT`       | `3737` (plain HTTP, default) or `443` (with TLS).                          |
| `ZP_SITE_ADDRESS` | Empty (plain HTTP, default) or the public domain (enables TLS).            |
| `CADDY_CONTAINER_PORT` | `80` (plain HTTP, default) or `443` (with TLS).                       |
| `COOKIE_SECURE`   | `true` (default) behind TLS; `false` only for plain-HTTP testing.          |

> The stack refuses to deploy when `POSTGRES_DB`, `POSTGRES_USER`,
> `POSTGRES_PASSWORD`, `APP_BASE_URL`, `REDIS_URL` or `SESSION_SECRET` is missing
> or empty (Compose `:?` guards). `REDIS_URL` and `CORS_ORIGIN` already have the
> correct values in the compose file, so they normally need no entry.

### 5.2 Setting the PostgreSQL credentials in Portainer

`POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD` are **required and must
not be empty**. The stack file guards them with Compose's `:?` operator, so a
missing or empty value stops the deployment with a clear error instead of
starting a database that can never become healthy.

Step by step:

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
8. Set `SESSION_SECRET` (`openssl rand -hex 32`) and `APP_BASE_URL`.
9. Click **Deploy the stack** (or **Update the stack**).

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

The stack ships **plain HTTP** by default so it works on any host immediately.
To serve HTTPS, set three variables in the stack environment together:

```env
ZP_SITE_ADDRESS=quiz.example.com
CADDY_CONTAINER_PORT=443
HTTP_PORT=443
```

Then **Update the stack**. Caddy obtains and renews a Let's Encrypt certificate
for `ZP_SITE_ADDRESS` automatically. Two conditions must hold:

1. `ZP_SITE_ADDRESS` resolves to the host in public DNS.
2. Ports **80 and 443** are both reachable from the internet — Caddy uses port
   80 for the ACME challenge and the HTTP→HTTPS redirect.

Also update `APP_BASE_URL` and `CORS_ORIGIN` to the `https://` origin and set
`COOKIE_SECURE=true`, otherwise the session cookie is not marked `Secure`.

> Do not set `HTTP_PORT=443` while leaving `ZP_SITE_ADDRESS` empty: Caddy would
> then serve plain HTTP on a port clients expect to speak TLS on.

Verify:

```bash
curl -s https://<domain>/api/health
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
- **Named volume** `db-data` for PostgreSQL; Portainer shows it under
  **Volumes** and it survives stack updates.
- **Healthchecks** on all five services; Portainer displays the health column.
- **Restart policy** `unless-stopped` on `db`, `cache`, `frontend` and `proxy`,
  and `on-failure:5` on `backend`. The backend exits non-zero on a
  misconfiguration, so a bounded `on-failure` policy avoids an endless restart
  loop while still restarting after a host reboot.
- **Secrets** come from the stack environment only; the compose file contains
  no credentials.

## 9. Troubleshooting

| Symptom                                     | Cause / fix                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `denied` / `unauthorized` when pulling      | Private package without registry credentials → add GHCR credentials (section 4) |
| `pull access denied` for `zeropeek-backend` | Image not published yet → check the actions run in GitHub                       |
| Stack up but `/api/health` returns 502      | `backend` not healthy yet, or the database credentials are wrong → check backend logs |
| Data lost after redeploy                    | The `db-data` volume was removed → avoid "remove volumes" on update             |
| `failed to bind port 0.0.0.0:80/tcp`        | Host port 80 is already in use → set `HTTP_PORT` to a free port (default 3737)  |
| Deployment stops with `required variable … is missing a value` | A required variable is empty → set the named variable (section 5.1) and redeploy |

### Backend container keeps restarting

The backend validates its configuration on start and prints a readable message.
Look at the top of the log:

```bash
docker logs zero_peek-backend-1
```

| Log message                                                             | Cause / fix                                                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `ZeroPeek backend cannot start: the configuration is incomplete …`      | One or more required values are missing; the following lines name each variable and how to fix it |
| `DATABASE_URL is missing or empty and cannot be derived`                | Set `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`, or set `DATABASE_URL` explicitly      |
| `SESSION_SECRET is missing or empty`                                    | Set `SESSION_SECRET` (`openssl rand -hex 32`)                                                     |
| `REDIS_URL is missing or empty`                                         | Set `REDIS_URL=redis://cache:6379`                                                                |
| `APP_BASE_URL … localhost`                                              | Set `APP_BASE_URL` to the public origin, not a localhost address                                  |

### Backend cannot reach the database

The entrypoint waits for PostgreSQL and prints the Prisma error code and a hint
on every attempt; after a bounded number of attempts it stops with a clear
message and **leaves the volume untouched**:

```bash
docker logs zero_peek-backend-1
```

| Log line                                                    | Cause / fix                                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `waiting for the database (attempt …): P1000 authentication failed` | The stack password does not match the volume → see section 5.3                     |
| `… P1001 cannot reach the database server`                  | The `db` service is not running → check `docker logs zero_peek-db-1`               |
| `… P1003 the database does not exist`                       | `POSTGRES_DB` does not match the database in the volume → set the original value   |
| `FATAL: the database is not reachable after 15 attempts`    | Fix the values above and redeploy; no data was changed                             |

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
