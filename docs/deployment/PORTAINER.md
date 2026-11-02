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
- A free host port for the proxy (80 by default, 443 for TLS).

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
5. **Environment variables:** add every key from `.env.portainer.example`
   (see section 5). At minimum change `POSTGRES_PASSWORD`, `DATABASE_URL`,
   `SESSION_SECRET`, `APP_BASE_URL` and `CORS_ORIGIN`.
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
meaning is in [ENVIRONMENT.md](./ENVIRONMENT.md). The critical ones:

| Variable             | Example                                                     |
| -------------------- | ----------------------------------------------------------- |
| `ZEROPEEK_IMAGE_TAG` | `sha-1a2b3c4` (or `latest`)                                 |
| `POSTGRES_PASSWORD`  | a long random value                                         |
| `DATABASE_URL`       | `postgresql://zeropeek:<pw>@db:5432/zeropeek?schema=public` |
| `SESSION_SECRET`     | `openssl rand -hex 32`                                      |
| `APP_BASE_URL`       | `https://quiz.example.com`                                  |
| `CORS_ORIGIN`        | `https://quiz.example.com`                                  |
| `HTTP_PORT`          | `80` (or `443` with TLS)                                    |

> The database host inside `DATABASE_URL` is the compose service name `db`, not
> `localhost`.

### 5.1 Setting the PostgreSQL credentials in Portainer

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
6. Set `POSTGRES_PASSWORD` to a strong, unique password
   (`openssl rand -base64 32`). Never leave it empty and never reuse the
   placeholder from `.env.portainer.example`.
7. Set `DATABASE_URL` so it repeats **exactly** those three values:
   `postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@db:5432/<POSTGRES_DB>?schema=public`.
8. Click **Deploy the stack** (or **Update the stack**).

> **Existing volume:** these three values are applied only the first time the
> `db-data` volume is initialised. If the volume already exists, PostgreSQL
> ignores them and the credentials stored inside the volume stay in force – the
> values in the stack must match them, otherwise the backend cannot log in.
> Never delete the volume to "reset" the password without backing up first.

> **Never commit credentials.** Enter them only in Portainer. `.env.portainer.example`
> contains placeholders, not real secrets.

## 6. First start

After deploying, Portainer starts the services in dependency order: `db` and
`cache` become healthy first, then `backend`, then `proxy`. All five services
show a green **healthy** state when the stack is up.

Verification:

```bash
# Replace 80 with your HTTP_PORT if you changed it.
curl -s http://<host>/api/health
# {"status":"ok","service":"zeropeek-backend","version":"0.0.0","questionTypes":13}
```

Open `http://<host>/` in a browser to see the ZeroPeek start page.

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
- **Restart policy** `unless-stopped` on every service.
- **Secrets** come from the stack environment only; the compose file contains
  no credentials.

## 9. Troubleshooting

| Symptom                                     | Cause / fix                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `denied` / `unauthorized` when pulling      | Private package without registry credentials → add GHCR credentials (section 4) |
| `pull access denied` for `zeropeek-backend` | Image not published yet → check the Actions run in GitHub                       |
| Stack up but `/api/health` returns 502      | `backend` not healthy yet, or `DATABASE_URL` wrong → check backend logs         |
| Data lost after redeploy                    | The `db-data` volume was removed → avoid "remove volumes" on update             |
| Port 80 already in use                      | Another service uses it → set `HTTP_PORT` to a free port                        |

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
