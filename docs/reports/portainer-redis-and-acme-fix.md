# Portainer deployment fix – REDIS_URL, cookies and Let's Encrypt

**Project:** ZeroPeek
**Scope:** Make the Portainer stack deploy end-to-end. Fix the reported
`REDIS_URL` interpolation error, the plain-HTTP cookie behaviour and the
`too many certificates (50) already issued` ACME error. **No product features
were added.**
**Branch:** `fix/portainer-redis-and-acme`

Related: [PORTAINER.md](../deployment/PORTAINER.md) ·
[ENVIRONMENT.md](../deployment/ENVIRONMENT.md) ·
[portainer-config-fix.md](./portainer-config-fix.md) ·
[postgresql-password-fix.md](./postgresql-password-fix.md)

---

## 1. Exact cause of the reported error

```
failed to load the compose file:
error while interpolating services.backend.environment.REDIS_URL:
required variable REDIS_URL is missing a value:
REDIS_URL muss gesetzt sein (z. B. redis://cache:6379)
```

`docker-compose.portainer.yml` declared

```yaml
REDIS_URL: ${REDIS_URL:?REDIS_URL muss gesetzt sein (z. B. redis://cache:6379)}
```

The `:?` operator aborts the whole deployment when the variable is missing **or
empty**. But:

- `docs/deployment/PORTAINER.md` §5.1 told the operator to enter only
  `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `SESSION_SECRET`,
  `APP_BASE_URL` and optionally `ZEROPEEK_IMAGE_TAG`, and stated that
  “`REDIS_URL` … already default[s] correctly”;
- `docs/deployment/ENVIRONMENT.md` and `packages/backend/src/config.ts` both
  default `REDIS_URL` to `redis://cache:6379`.

So the compose file demanded a variable that the documentation told the operator
not to set and that the code did not need. **Following the documentation exactly
produced the failure.** Reproduced locally:

```bash
printf 'POSTGRES_DB=zeropeek\nPOSTGRES_USER=zeropeek\nPOSTGRES_PASSWORD=…\n
SESSION_SECRET=…\nAPP_BASE_URL=https://quiz.example.com\n' > /tmp/zp-minimal.env
docker compose -f docker-compose.portainer.yml --env-file /tmp/zp-minimal.env config
# -> required variable REDIS_URL is missing a value
```

There is a second, latent problem: `REDIS_URL` was never actually used by the
backend. It is read into `AppConfig.redisUrl` and passed to `attachSocketIO`, but
the Socket.IO server is created without a Redis adapter and no code opens a Redis
connection. Redis is therefore fully optional, which makes a hard `:?` guard even
less justified.

## 2. Changes

| File                                           | Change                                                                                                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.portainer.yml`                 | `REDIS_URL` is now optional with a default (`${REDIS_URL:-redis://cache:6379}`), no `:?` guard. `COOKIE_SECURE` defaults to empty so it is derived. Added `caddy-data`/`caddy-config` volumes and `ZP_ACME_CA`. |
| `packages/backend/src/config.ts`               | `REDIS_URL` no longer required in production; `COOKIE_SECURE` derived from `APP_BASE_URL`; a localhost `APP_BASE_URL` is a warning, not a fatal error; new `warnings` field.                                    |
| `packages/backend/src/server.ts`               | Logs config warnings and probes Redis on start with a bounded, credential-free `PING`; an unreachable cache is a warning, never a crash.                                                                        |
| `packages/backend/src/config.test.ts`          | Tests updated for the optional Redis, the localhost warning and the cookie derivation.                                                                                                                          |
| `.env.portainer.example`                       | `REDIS_URL` and `COOKIE_SECURE` commented/emptied with explanations; `ZP_ACME_CA` added; `APP_BASE_URL` note about localhost.                                                                                   |
| `docs/deployment/ENVIRONMENT.md`               | Redis marked optional; `COOKIE_SECURE` derivation; `ZP_ACME_CA`; a new section on certificate storage and the rate limit.                                                                                       |
| `docs/deployment/PORTAINER.md`                 | §5.1 corrected (no `REDIS_URL` entry); §5.2 steps; §6.1 staging + persistence notes; troubleshooting rows for the Redis warning.                                                                                |
| `docs/reports/portainer-redis-and-acme-fix.md` | **New.** This report.                                                                                                                                                                                           |

No file was deleted, renamed or moved. The product logic is unchanged; the
`REDIS_URL` default (`redis://cache:6379`) is the same value the docs already
prescribed.

### 2.1 Why the Redis probe is a warning

Redis is only used for Socket.IO scaling and rate limiting. If the cache is down,
the correct behaviour is to keep serving, not to refuse to start. The probe
prints the host and port and a hint, never a password:

```
{"level":40,"msg":"Redis is not reachable at cache:6379 (ENOTFOUND). The backend continues without it – Socket.IO scaling and rate limiting degrade gracefully."}
```

### 2.2 Cookie `Secure` flag

`COOKIE_SECURE` defaulted to `true` in the Portainer stack. A cookie marked
`Secure` is silently dropped by the browser over plain HTTP, which breaks login
on a plain-HTTP deployment. It is now **derived from `APP_BASE_URL`**: an
`https://` origin sets it, plain HTTP does not. An explicit `COOKIE_SECURE` still
wins, so a TLS terminator that leaves `APP_BASE_URL` on `http://` can force
`true`.

### 2.3 `APP_BASE_URL` localhost

The previous branch made a localhost `APP_BASE_URL` a **fatal** error. That
blocks a legitimate internal/plain-HTTP deployment, where `http://localhost:3737`
is the only reachable origin. It is now a **warning**: the backend starts and
logs that links and QR codes only work on the host.

## 3. Let's Encrypt – `too many certificates (50) already issued`

Let's Encrypt allows **50 certificates per registered domain per week**. The
limit is hit when the same certificate is requested again and again. The cause
was storage, not request volume:

- Caddy keeps issued certificates and the ACME account under `/data`;
- the `proxy` service had **no volume** on `/data` (or `/config`);
- so every container recreation — an image update, `--force-recreate`, a
  redeploy — started with an empty `/data`, forgot the certificate and the
  account, and requested a brand-new certificate.

A handful of redeploys within a week is enough to reach 50.

### Fix

```yaml
proxy:
  volumes:
    - caddy-data:/data
    - caddy-config:/config
```

and the matching top-level volumes. Caddy now reuses the stored certificate and
only requests a new one when it has actually expired.

A staging switch was added so the setup can be validated without touching the
production quota:

```env
ZP_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory
```

`ZP_ACME_CA` is empty by default (Let's Encrypt production) and is wired into the
embedded Caddyfile as `acme_ca ${ZP_ACME_CA:-https://acme-v02.api.letsencrypt.org/directory}`.

> **Compose trap (cost real debugging time):** the embedded Caddyfile is a
> Compose `configs.content` block, so Compose substitutes `$VAR` inside it. The
> existing `ZP_SITE_ADDRESS` already relies on this (`${ZP_SITE_ADDRESS:-:80}`).
> The Caddy-native syntax `{$ZP_ACME_CA:default}` is **not** usable here — Compose
> rewrites `{$ZP_ACME_CA:…}` to `{:…}`, producing an invalid Caddyfile. Use the
> Compose form `${VAR:-default}` instead. (Verified: the rendered Caddyfile
> contains a valid `acme_ca` line.)

No production certificate was requested during this work. All TLS checks used the
default plain-HTTP mode; the ACME wiring was verified by rendering the compose
file, not by contacting Let's Encrypt.

## 4. Complete Portainer variable list

**Required:**

| Variable            | Example                    | Notes                                                       |
| ------------------- | -------------------------- | ----------------------------------------------------------- |
| `POSTGRES_DB`       | `zeropeek`                 | Name of the existing database.                              |
| `POSTGRES_USER`     | `zeropeek`                 | User that already exists in the volume.                     |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32`  | Must match the password already inside the volume.          |
| `SESSION_SECRET`    | `openssl rand -hex 32`     | Long random value; never reuse or commit.                   |
| `APP_BASE_URL`      | `https://quiz.example.com` | Any absolute http(s) URL; `localhost` is allowed but warns. |

**Optional (correct default in the compose file):**

| Variable               | Default                     | When to change                              |
| ---------------------- | --------------------------- | ------------------------------------------- |
| `REDIS_URL`            | `redis://cache:6379`        | Only for external Redis.                    |
| `CORS_ORIGIN`          | `APP_BASE_URL`              | Only if the browser origin differs.         |
| `DATABASE_URL`         | derived from `POSTGRES_*`   | Only for an external database.              |
| `COOKIE_SECURE`        | derived from `APP_BASE_URL` | Only to override the derivation.            |
| `ZEROPEEK_IMAGE_TAG`   | `latest`                    | Pin `sha-<short>` for reproducible deploys. |
| `HTTP_PORT`            | `3737`                      | `443` with TLS.                             |
| `CADDY_CONTAINER_PORT` | `80`                        | `443` with TLS.                             |
| `ZP_SITE_ADDRESS`      | empty (plain HTTP)          | The public domain to enable TLS.            |
| `ZP_ACME_CA`           | Let's Encrypt production    | The staging URL while testing TLS.          |
| `SESSION_TTL_HOURS`    | `72`                        | Session lifetime.                           |
| `LOG_LEVEL`            | `info`                      | Pino log level.                             |

**Never commit credentials.** Enter them only in Portainer.

## 5. Verification

All commands were run in this branch.

| Check                                                        | Result                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| Reproduce the reported error with the documented minimal set | `required variable REDIS_URL is missing a value` (confirmed)        |
| Same minimal set **after** the fix                           | `docker compose config` exits 0; stack deploys                      |
| Full stack (minimal env, password `p@ss:w/rd?#%!*`)          | all five services **healthy**                                       |
| `GET /api/health` through the proxy                          | `200 {"status":"ok",…}`                                             |
| `/`, `/host.html`, `/editor.html`, `/admin.html`             | `200`                                                               |
| Derived `DATABASE_URL` in the container                      | host `db`, port `5432`, db `zeropeek`, password round-trips exactly |
| CORS preflight from `APP_BASE_URL` origin                    | `204` + matching `Access-Control-Allow-Origin`                      |
| `COOKIE_SECURE` with `http://` origin                        | `false` (derived)                                                   |
| Redis reachable                                              | `Redis is reachable at cache:6379.`                                 |
| Redis unreachable (bad host)                                 | warning logged, server still `listening`                            |
| Missing `SESSION_SECRET` / `APP_BASE_URL`                    | readable `ConfigError`, exit `1`                                    |
| Localhost `APP_BASE_URL`                                     | warning logged, server still `listening`                            |
| Compose `:?` guards (one variable emptied at a time)         | all five abort with a readable message                              |
| `caddy-data` / `caddy-config` volumes                        | mounted at `/data` and `/config`                                    |
| `/data` survives `--force-recreate`                          | marker file still present                                           |
| `acme_ca` line in the rendered Caddyfile                     | production URL by default, staging URL when `ZP_ACME_CA` is set     |
| Data persistence across a full `--force-recreate`            | marker row survived; second run `No pending migrations to apply.`   |
| `npm run typecheck`                                          | 3 workspaces clean                                                  |
| `npm run format:check`                                       | clean                                                               |
| `npm test` (throwaway DB, special-char password)             | **136 passed** (backend 55, frontend 19, shared 62)                 |
| Backend image build + frontend image build                   | both succeed                                                        |

## 6. Safe update procedure (existing volumes preserved)

1. **Do not remove any volume** on update — not `db-data`, and now not
   `caddy-data` either.
2. In Portainer, set `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
   `SESSION_SECRET` and `APP_BASE_URL`. Leave `DATABASE_URL`, `REDIS_URL` and
   `COOKIE_SECURE` empty.
3. **Update the stack.** The backend applies pending migrations with
   `prisma migrate deploy` (additive only) and Caddy reuses its stored
   certificate.
4. Verify all five services are healthy and `curl http://<host>:3737/api/health`
   returns `{"status":"ok",…}`.
5. For TLS: set `ZP_SITE_ADDRESS`, `CADDY_CONTAINER_PORT=443`, `HTTP_PORT=443`
   and `ZP_ACME_CA=<staging>` first; once the staging certificate loads, clear
   `ZP_ACME_CA` to obtain a trusted one.

## 7. Remaining manual steps (need approval)

1. **Portainer:** enter the required variables (section 4) and update the stack.
   This branch does not touch the running instance.
2. **Let's Encrypt quota:** if it is currently exhausted, wait for it to reset
   (one week from the first request) and redeploy with the volume in place. Do
   not delete the volume in a loop.
3. **Database password:** no change required. Only if the original password is
   lost is an `ALTER ROLE … PASSWORD` needed, which changes the running database
   and is out of scope here.
4. **Merge:** not done. The pull request is open for review.
