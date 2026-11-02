# Rollback

How to return the ZeroPeek stack to a previous version.

ZeroPeek publishes **immutable commit tags** (`sha-<short>`), which makes a
rollback deterministic: change one environment variable, redeploy, and the stack
runs exactly the images from that commit.

Related: [GITHUB_ACTIONS.md](./GITHUB_ACTIONS.md) ·
[PORTAINER.md](./PORTAINER.md) · [ENVIRONMENT.md](./ENVIRONMENT.md)

---

## 1. Tag strategy recap

Every push to `main` publishes both images with these tags:

| Tag            | Example       | Mutable? | Use                                  |
| -------------- | ------------- | -------- | ------------------------------------ |
| `sha-<short>`  | `sha-1a2b3c4` | no       | Pin a deployment; rollback target    |
| `main`         | `main`        | yes      | Latest successful build of `main`    |
| `latest`       | `latest`      | yes      | Same as `main` on the default branch |
| `1.2.3`, `1.2` | –             | no       | Only for `v*.*.*` tag releases       |

Because `sha-` and semver tags are immutable, a rollback is simply a matter of
pointing `ZEROPEEK_IMAGE_TAG` at an older one.

## 2. Find the target tag

1. GitHub → **Actions** → **Docker Publish (GHCR)**.
2. Open the run you want to return to (a green run).
3. The tag is `sha-<first 7 chars of the commit SHA>`. You can also read it
   from the commit itself, or list the published tags:
   GitHub → **Packages** → `zeropeek-backend` → **Versions**.

## 3. Rollback in Portainer (recommended)

1. Portainer → **Stacks** → `zeropeek` → **Editor**.
2. Set the environment variable:

   ```
   ZEROPEEK_IMAGE_TAG=sha-<short>
   ```

   (or edit the default in `docker-compose.portainer.yml` if you keep the tag
   pinned there).

3. **Update the stack**. Portainer pulls the tagged images and recreates the
   affected containers.
4. Verify:

   ```bash
   curl -s http://<host>/api/health
   ```

The database volume `db-data` is **not** touched, so data survives the
rollback.

## 4. Rollback via command line (without Portainer)

```bash
cd /path/to/compose
export ZEROPEEK_IMAGE_TAG=sha-1a2b3c4
docker compose -f docker-compose.portainer.yml pull backend frontend
docker compose -f docker-compose.portainer.yml up -d
```

`pull` forces the tagged images to be fetched before recreating the containers.

## 5. Rollback by re-running an older workflow

If you prefer GitHub to drive the rollback, re-run the publish workflow for an
older commit:

1. Actions → **Docker Publish (GHCR)** → select the older run → **Re-run all
   jobs**.

This republishes `sha-<short>`, `main` and `latest` from that commit. Since
`latest` is a moving tag, this effectively makes the older version current —
useful when the stack runs `latest`.

> Prefer pinning `sha-` tags in production: it makes the running version
> explicit and avoids accidentally moving `latest`.

## 6. Database considerations

The image rollback does not revert database migrations. If a newer version
applied a migration that an older image cannot handle:

1. Take a backup **before** upgrading in the first place:

   ```bash
   docker compose -f docker-compose.portainer.yml exec -T db \
     pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-$(date +%F).sql
   ```

2. To restore after a rollback:

   ```bash
   cat backup-2026-01-01.sql | docker compose -f docker-compose.portainer.yml exec -T db \
     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
   ```

Keep backups outside the Docker volume. Restoring is a destructive operation —
confirm the target before running it.

## 7. Checklist

- [ ] Target `sha-<short>` tag identified from a green Actions run
- [ ] `ZEROPEEK_IMAGE_TAG` updated in the stack environment
- [ ] Stack updated / recreated
- [ ] `/api/health` returns `{"status":"ok", ...}`
- [ ] A database backup was taken if a migration is involved
