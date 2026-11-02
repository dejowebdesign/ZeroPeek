# Phase 0.5 Report – CI, GHCR and Portainer deployment

**Project:** ZeroPeek
**Phase:** 0.5 – Build, container, CI and deployment infrastructure
**Branch:** `feat/ci-docker-portainer`
**Date:** 2026-11-02
**Status:** Complete, awaiting approval

---

## 1. Objective

Add a fully automated build-and-deploy pipeline: a push to GitHub runs
verification, builds the Docker images, publishes them to GHCR, and lets
Portainer start or update the whole stack **without building anything on the
production host**. No product features were added and the game architecture was
not changed.

## 2. Deliverables

| File                                   | Purpose                                                                |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `.github/workflows/docker-publish.yml` | Verify → build → push both images to GHCR → optional Portainer webhook |
| `.github/workflows/ci.yml`             | Narrowed to `pull_request` only (removed the duplicate `push` trigger) |
| `docker-compose.portainer.yml`         | Self-contained production stack: db, cache, backend, frontend, proxy   |
| `.env.portainer.example`               | Full production environment template (no real values)                  |
| `docs/deployment/GITHUB_ACTIONS.md`    | Pipeline, tags, permissions, secrets, troubleshooting                  |
| `docs/deployment/PORTAINER.md`         | Stack setup, GHCR access, updates, rollback, compatibility notes       |
| `docs/deployment/ENVIRONMENT.md`       | Every variable, defaults, backward-compatibility notes                 |
| `docs/deployment/ROLLBACK.md`          | Tag strategy and step-by-step rollback                                 |

Supporting changes: `package.json` (fresh-checkout fix), backend `config.ts`
(new variable names with legacy fallbacks) and its tests, `.env.example`,
`.gitignore`, `docker-compose.yml` (dev).

## 3. Image and tag strategy

```
ghcr.io/dejowebdesign/zeropeek-backend
ghcr.io/dejowebdesign/zeropeek-frontend
```

| Situation      | Tags                                    |
| -------------- | --------------------------------------- |
| Push to `main` | `sha-<short>`, `main`, `latest`         |
| Tag `v1.2.3`   | `sha-<short>`, `1.2.3`, `1.2`, `latest` |

Production should pin `sha-<short>` (immutable → trivial rollback). Images are
published **only** after `verify` passes (`publish` has `needs: verify`).

## 4. Verification evidence

### Static checks

| Check              | Command                                                 | Result                                      |
| ------------------ | ------------------------------------------------------- | ------------------------------------------- |
| Workflow lint      | `actionlint .github/workflows/*.yml`                    | clean                                       |
| Workflow job graph | `act -l`                                                | verify → publish → deploy, CI separate      |
| Dev compose        | `docker compose config`                                 | valid                                       |
| Portainer compose  | `docker compose -f docker-compose.portainer.yml config` | valid                                       |
| No host builds     | `grep -c 'build:' docker-compose.portainer.yml`         | `0`                                         |
| Rollback tag       | `ZEROPEEK_IMAGE_TAG=sha-1a2b3c4 ... config`             | both images resolve to that tag             |
| Unit tests         | `npm test`                                              | 21 passed (7 backend, 5 frontend, 9 shared) |

### Real container execution of the workflow

`act` ran the `verify` job of `docker-publish.yml` in a real runner container.
This surfaced **two real defects** that static review missed:

1. **Fresh checkout broke typecheck.** `packages/shared/dist` does not exist in
   a clean clone, so `@zeropeek/shared` could not be resolved by backend and
   frontend typechecking (`TS2307`). Fixed by making the root `typecheck` and
   `test` scripts build the shared package first (`build:shared`).
2. **Formatting gate failed** on the new documentation. Fixed with
   `prettier --write`.

After the fixes the `verify` job completed with **“🏁 Job succeeded”**.

### End-to-end stack acceptance

Images built with the exact GHCR names, then the Portainer compose file started:

```
backend   Up (healthy)   ghcr.io/dejowebdesign/zeropeek-backend:latest
cache     Up (healthy)   redis:7-alpine
db        Up (healthy)   postgres:16-alpine
frontend  Up (healthy)   ghcr.io/dejowebdesign/zeropeek-frontend:latest
proxy     Up (healthy)   caddy:2-alpine
```

| Assertion                            | Result                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `GET /api/health` via proxy          | `{"status":"ok","service":"zeropeek-backend","version":"0.0.0","questionTypes":13}` |
| `/`, `/host.html`, `/editor.html`    | 200 / 200 / 200                                                                     |
| `/socket.io/*` routed to backend     | reaches backend (404 until Phase 4 attaches the server)                             |
| Only the proxy publishes a host port | confirmed (db, cache, backend, frontend expose container ports only)                |
| Single internal network              | `project_zeropeek` (bridge) with all 5 services                                     |
| PostgreSQL volume persists           | marker row survived `down` (volume kept) + `up`                                     |
| Rollback                             | retagged `sha-old123`, redeployed, container ran that image, health OK              |
| Restart policy                       | `unless-stopped` on all services                                                    |

### Webhook deploy step

The deploy shell logic was exercised against a local fake endpoint:

| Case                 | Expected     | Result              |
| -------------------- | ------------ | ------------------- |
| Secret unset         | skip, exit 0 | ✅                  |
| HTTP 200             | success      | ✅                  |
| HTTP 500             | fail the job | ✅                  |
| Host unreachable     | fail the job | ✅                  |
| Token leak in output | none         | ✅ `grep` count = 0 |

## 5. Decisions

- **Two workflows, disjoint triggers.** `ci.yml` = pull requests;
  `docker-publish.yml` = `main` + tags. Avoids running identical checks twice
  per commit.
- **`provenance: false`** — attestation manifests break older Docker engines
  and some proxies; documented as re-enableable.
- **Inline Caddyfile via Compose `configs.content`** — the stack is fully
  self-contained, needs no repository checkout and no host bind mounts, which
  is what makes it work in Portainer's web editor and API.
- **`linux/amd64` only** — documented how to add `linux/arm64` + QEMU.
- **Legacy env fallbacks** — `APP_BASE_URL`/`COOKIE_NAME` are the documented
  names; `PUBLIC_BASE_URL`/`SESSION_COOKIE_NAME` still work.

## 6. Constraints respected

- No new product features; no change to the game architecture.
- No credentials in any committed file; only `secrets.GITHUB_TOKEN` and the
  optional `PORTAINER_WEBHOOK_URL` secret.
- Least privilege: default `contents: read`, `packages: write` only on `publish`.
- Nothing is published unless verification passes.

## 7. Known limitations

- Images were built and run locally under the exact GHCR names; the actual
  `docker push` to GHCR could not be executed here because this sandbox has no
  registry credentials. The workflow steps are the standard, linted
  `docker/login-action` + `docker/build-push-action` pair.
- No ARM build yet (see Decisions).
- The `deploy` job requires you to create the `PORTAINER_WEBHOOK_URL` secret in
  GitHub; without it the step skips cleanly and manual updates still work.

## 8. Result

- Branch `feat/ci-docker-portainer` pushed; **PR #1** opened against `main`:
  https://github.com/dejowebdesign/ZeroPeek/pull/1
- The PR triggered **only** the `CI` workflow (`pass`, 26 s) — the publish
  workflow correctly did not run, confirming the disjoint-trigger design.

## 9. Recommendation

Phase 0.5 is complete and verified end to end. Recommended next steps after
merge:

1. Confirm the first real `docker-publish.yml` run on `main` publishes both
   images to GHCR.
2. Create the Portainer stack from `docker-compose.portainer.yml` (see
   `docs/deployment/PORTAINER.md`).
3. Optionally add the `PORTAINER_WEBHOOK_URL` secret to enable auto-deploy.
