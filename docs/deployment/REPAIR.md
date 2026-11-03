# Repairing a ZeroPeek stack that cannot reach its database

This runbook fixes a deployed ZeroPeek Portainer stack whose backend stops with
`FATAL: database not reachable after … attempts`, **without touching the existing
PostgreSQL volume**. It assumes the current deployment already has a `db-data`
volume with real data.

Related: [PORTAINER.md](./PORTAINER.md) · [ENVIRONMENT.md](./ENVIRONMENT.md) ·
[ROLLBACK.md](./ROLLBACK.md) · [../reports/portainer-database-credentials-fix.md](../reports/portainer-database-credentials-fix.md)

---

## 0. The one rule

**Never delete, replace or re-initialise the `db-data` volume to fix a login
problem.** PostgreSQL only applies `POSTGRES_DB` / `POSTGRES_USER` /
`POSTGRES_PASSWORD` when it initialises an **empty** volume. On an existing
volume those values are ignored, so changing them cannot change the password and
removing the volume only destroys the data. Line the stack up with the database
that already exists instead.

## 1. Read the backend log first

The backend now prints exactly what it is trying to reach before it connects:

```bash
docker logs zero_peek-backend-1 | head -20
```

```text
database target: zeropeek@db:5432/zeropeek (source: derived)
WARNING: DATABASE_URL is set explicitly and points at "user@db:5432/zeropeek",
         but the POSTGRES_* values describe "zeropeek@db:5432/zeropeek". …
```

- `source: derived` – the connection string was built from `POSTGRES_*`. Good.
- `source: explicit` – an explicit `DATABASE_URL` is in force and **wins**. If it
  does not match the `POSTGRES_*` values, that is the bug: clear `DATABASE_URL`
  (section 3).

The log never prints the password, so it is safe to paste into a ticket.

## 2. Confirm what the volume actually contains

```bash
# Which roles and databases exist inside the volume?
docker exec zero_peek-db-1 psql -U postgres -c '\du'
docker exec zero_peek-db-1 psql -U postgres -c '\l'

# Does the password you intend to use actually work? (no change is made)
docker exec -e PGPASSWORD='<the-password>' zero_peek-db-1 \
  psql -w -h 127.0.0.1 -U <user> -d <db> -tAc 'SELECT 1'
```

`SELECT 1` means the credentials are correct; a `password authentication failed`
error means they are not.

> `psql -U postgres` succeeds even when the app user's password is wrong, because
> the official image trusts local `postgres` connections. Use the
> `PGPASSWORD=… psql -w` probe above to test the **app** credentials.

## 3. Align the stack with the existing database (no password change)

Enter the values the volume already uses – the **original** password, not a new
one – in the Portainer stack environment:

```env
POSTGRES_DB=zeropeek          # the database that exists
POSTGRES_USER=zeropeek        # the role that exists
POSTGRES_PASSWORD=<original>  # the password already inside the volume
# DATABASE_URL – leave EMPTY so it is derived from the three values above
SESSION_SECRET=<openssl rand -hex 32>
```

Leaving `DATABASE_URL` empty is the fix for the most common case: a leftover
placeholder (often the one from `.env.example`) silently overrode the correct
`POSTGRES_*` values. Redeploy. The backend log should now show
`source: derived` and a target that matches the volume.

## 4. Only if the original password is lost

Changing the password is a change to the running database and must be approved
first. It is the **only** supported way to fix a lost password without deleting
data:

```sql
-- 1. Run against the existing cluster (the container's postgres role is trusted
--    locally). This does NOT drop or re-create anything.
ALTER ROLE "<user>" WITH PASSWORD '<new-password>';
```

```bash
docker exec -it zero_peek-db-1 psql -U postgres -c "ALTER ROLE \"<user>\" WITH PASSWORD '<new-password>';"
```

2. Set `POSTGRES_PASSWORD=<new-password>` in the stack environment to the **same**
   value, leave `DATABASE_URL` empty, and redeploy.

Special characters (`@`, `:`, `/`, `?`, `#`, `%`, spaces, …) are fine in the
password: the backend percent-encodes them when it builds the connection string.
If you instead set `DATABASE_URL` by hand, you must percent-encode the password
yourself.

## 5. Verify

```bash
docker logs zero_peek-backend-1 | head -5     # "database target: … (source: derived)"
docker compose -f docker-compose.portainer.yml --env-file .env ps   # all healthy
curl -s https://<your-host>/api/health
# {"status":"ok","service":"zeropeek-backend",…}
```

## 6. What this runbook never does

- It never removes or re-creates the `db-data` volume.
- It never runs `prisma migrate reset` or any destructive SQL. Migrations are
  applied forward-only with `prisma migrate deploy` (inside the entrypoint), which
  only adds missing migrations.
- It never prints a password or a secret.
