#!/bin/sh
# ZeroPeek backend entrypoint.
#
# Applies pending Prisma migrations, then starts the server. Running migrations
# here (rather than only at build time) means a redeploy with a new image
# upgrades the existing database in place – it never drops or recreates it.
#
# `prisma migrate deploy` is the safe, non-interactive command: it applies only
# migrations that are not yet recorded, and it never resets the database.
set -e

if [ -z "${DATABASE_URL:-}" ]; then
  echo "FATAL: DATABASE_URL is not set." >&2
  exit 1
fi

# Wait for PostgreSQL to accept connections. The compose healthcheck usually
# guarantees this already, but a slow first boot would otherwise crash the
# container before the database is ready.
attempt=0
max_attempts=30
until node -e "
const { PrismaClient } = require('@prisma/client');
const client = new PrismaClient();
client.\$queryRaw\`SELECT 1\`.then(() => process.exit(0)).catch(() => process.exit(1));
" 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "FATAL: database not reachable after ${max_attempts} attempts." >&2
    exit 1
  fi
  echo "waiting for the database (attempt ${attempt}/${max_attempts})..."
  sleep 2
done

echo "applying database migrations..."
# The schema lives under packages/backend, while the working directory is /app.
npx prisma migrate deploy --schema packages/backend/prisma/schema.prisma

echo "starting ZeroPeek backend..."
exec node packages/backend/dist/server.js
