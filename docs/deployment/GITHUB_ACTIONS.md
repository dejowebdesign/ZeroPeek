# GitHub Actions – build, verify and publish

This document describes how a commit travels from GitHub to GHCR and how the
images are consumed by Portainer. It covers the two workflows in
`.github/workflows/` and the tag strategy they produce.

Related documents:

- [PORTAINER.md](./PORTAINER.md) – deploying the published images
- [ENVIRONMENT.md](./ENVIRONMENT.md) – every environment variable
- [ROLLBACK.md](./ROLLBACK.md) – reverting to a previous image

---

## 1. Overview

```
 developer                GitHub Actions                         GHCR
 ─────────                ──────────────                         ────
 git push  ──────────▶  ┌──────────────────────┐
 (feature branch)       │ CI (ci.yml)          │   pull_request only
                        │ typecheck, test,     │   → no image
                        │ format, build        │
                        └──────────────────────┘

 git merge → main ───▶  ┌──────────────────────┐
                        │ Docker Publish       │   push to main / v* tag
                        │ 1. verify            │
                        │ 2. build + push  ────┼──▶  zeropeek-backend:<tags>
                        │ 3. deploy (optional) │     zeropeek-frontend:<tags>
                        └──────────┬───────────┘
                                   │ webhook (optional)
                                   ▼
                              Portainer stack
                              (pulls images, no build)
```

Two rules are enforced by the workflow structure:

1. **Nothing is published unless verification passed.** `publish` declares
   `needs: verify`, so a failing test, type error or formatting problem stops
   the pipeline before any image is built.
2. **No image is built on the production host.** Portainer only pulls.

## 2. Workflows

### `.github/workflows/ci.yml` — pull request gate

- **Trigger:** `pull_request` (any branch).
- **Purpose:** fast feedback before review.
- **Steps:** checkout → Node 22 → `npm ci` → typecheck → tests → format check →
  build all workspaces.
- **Publishes nothing** and needs no elevated permissions (`contents: read`).

### `.github/workflows/docker-publish.yml` — build and publish

- **Triggers:** push to `main`, push of a `v*.*.*` tag, manual
  `workflow_dispatch`.
- **Jobs:**

| Job       | Runs on                       | Permissions                         | Purpose                                       |
| --------- | ----------------------------- | ----------------------------------- | --------------------------------------------- |
| `verify`  | every trigger                 | `contents: read`                    | Same checks as CI. Gate for everything below. |
| `publish` | `needs: verify`               | `contents: read`, `packages: write` | Builds and pushes both images (matrix).       |
| `deploy`  | `needs: publish`, `main` only | `contents: read`                    | Optional Portainer webhook call.              |

The two workflows intentionally have **disjoint triggers** — `ci.yml` handles
`pull_request`, `docker-publish.yml` handles `push`/`tags`. One commit never
runs the same verification twice.

## 3. Image tags

Both images are pushed to GHCR:

```
ghcr.io/dejowebdesign/zeropeek-backend
ghcr.io/dejowebdesign/zeropeek-frontend
```

`docker/metadata-action` produces these tags:

| Situation            | Tags produced                                        |
| -------------------- | ---------------------------------------------------- |
| Push to `main`       | `sha-<short>` (e.g. `sha-1a2b3c4`), `main`, `latest` |
| Push of tag `v1.2.3` | `sha-<short>`, `1.2.3`, `1.2`, `latest`              |
| Manual run           | same as the selected branch                          |

Recommendation for production: **pin `ZEROPEEK_IMAGE_TAG=sha-<short>`** rather
than `latest`. A commit tag is immutable and makes a rollback a one-line change
(see [ROLLBACK.md](./ROLLBACK.md)). Use `latest` only if you always want the
newest `main` build.

## 4. Permissions and secrets

- The workflow uses the automatically provided `secrets.GITHUB_TOKEN`.
  `packages: write` is granted **only** to the `publish` job; the default is
  `contents: read`.
- No credentials, tokens or webhook URLs are stored in the repository.
- The only optional secret is `PORTAINER_WEBHOOK_URL` (see section 5). It is
  referenced as `${{ secrets.PORTAINER_WEBHOOK_URL }}` and is never printed:
  the deploy step redirects curl output and prints only the HTTP status code.

### Making the packages visible to Portainer

By default a package pushed with `GITHUB_TOKEN` inherits the repository's
visibility. For a **private** repository the packages are private and Portainer
needs credentials — see [PORTAINER.md](./PORTAINER.md#4-ghcr-access). For a
public repository no credentials are required to pull.

## 5. Automatic deployment (optional)

The `deploy` job calls a Portainer **stack webhook** after a successful publish
to `main`.

Requirements in Portainer:

1. Open the ZeroPeek stack → **Webhooks** → enable → copy the URL.
2. In GitHub: **Settings → Secrets and variables → Actions → New repository
   secret**, name `PORTAINER_WEBHOOK_URL`, value = the full webhook URL.

Behaviour:

- The job runs **only** on `push` to `main` and **only** after both images are
  published.
- If the secret is not set, the job prints a message and succeeds — it never
  fails the pipeline.
- A non-2xx response from Portainer fails the job, so a broken deployment is
  visible in the Actions log.
- The URL is never echoed, and curl's error output (which contains the URL) is
  suppressed.

If you prefer not to automate deployments, simply leave the secret unset and
follow the manual update procedure in
[PORTAINER.md](./PORTAINER.md#7-updating-to-a-new-image).

## 6. Build details

- **Build context is the repository root.** The Dockerfiles need the whole npm
  workspace: `packages/shared` is built first, then `packages/backend` /
  `packages/frontend`.
- **Caching:** `docker/build-push-action` with `cache-from`/`cache-to` of type
  `gha`, scoped per image (`scope=backend` / `scope=frontend`) so the two builds
  do not evict each other's cache.
- **`provenance: false`:** attestation manifests are omitted because some older
  Docker engines and proxies cannot pull them. Re-enable once every Portainer
  host runs a recent engine.
- **Architecture:** `linux/amd64`. For an ARM host, add `linux/arm64` (and a
  `docker/setup-qemu-action` step) in `docker-publish.yml`.

## 7. Verifying the pipeline locally

The workflows are plain YAML and can be checked without a runner:

```bash
# Lint all workflows (recommended; catches expression/syntax errors)
actionlint .github/workflows/*.yml

# List the jobs each workflow would run
act -l

# Dry-run a job (no side effects)
act push -W .github/workflows/docker-publish.yml -j verify -n
```

The image build itself is exactly what the local Dockerfiles do, so it can be
reproduced locally:

```bash
docker build -f docker/backend.Dockerfile  -t zeropeek-backend:local  .
docker build -f docker/frontend.Dockerfile -t zeropeek-frontend:local .
```

## 8. Troubleshooting

| Symptom                                                      | Cause                                                                               | Fix                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `TS2307: Cannot find module '@zeropeek/shared'` during build | `*.tsbuildinfo` or `dist/` leaked into the build context, so `tsc` skipped emitting | `.dockerignore` must contain `**/*.tsbuildinfo` and `**/dist`          |
| `denied: permission_denied` on push                          | `packages: write` missing, or the repository forbids `GITHUB_TOKEN` writes          | Check the job `permissions:` block and the repository Actions settings |
| Portainer cannot pull the image                              | Private package without credentials                                                 | Add GHCR credentials in Portainer (see PORTAINER.md)                   |
| Deploy job fails with HTTP 404                               | Wrong webhook URL or the stack was recreated                                        | Re-copy the webhook URL from Portainer                                 |
