#!/bin/sh
# ZeroPeek backend entrypoint.
#
# 1. Validates the environment through the compiled `loadConfig` (same rules the
#    server uses). A missing or invalid value aborts immediately with a readable
#    message instead of a restart loop. `DATABASE_URL` is derived from the
#    `POSTGRES_*` values when it is not set, so the connection string always
#    matches the database container and a password with special characters is
#    encoded safely.
# 2. Waits for PostgreSQL to accept a real connection, printing the Prisma error
#    code and a hint on every attempt. A credential mismatch is reported with the
#    matching Prisma code (P1000) instead of an endless "not reachable" message.
# 3. Applies pending Prisma migrations with `prisma migrate deploy`, the safe,
#    non-interactive command: it only adds missing migrations and never resets
#    or drops the database.
# 4. Starts the server.
#
# No password or secret is ever printed.
set -e

# --- 1. Validate the configuration and resolve DATABASE_URL -------------------
config_output=$(
  node -e '
    const { loadConfig, ConfigError } = require("./packages/backend/dist/config.js");
    try {
      const config = loadConfig(process.env);
      if (!config.databaseUrl) {
        console.error(
          "FATAL: DATABASE_URL is not set and could not be derived. Set DATABASE_URL, or set POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB so it is built automatically.",
        );
        process.exit(1);
      }
      process.stdout.write("ZP_DATABASE_URL:" + config.databaseUrl + "\n");
    } catch (error) {
      if (error instanceof ConfigError) {
        console.error(error.message);
        process.exit(1);
      }
      console.error(
        "FATAL: could not read the configuration: " + (error && error.message ? error.message : error),
      );
      process.exit(1);
    }
  '
) || exit 1

DATABASE_URL=$(printf '%s\n' "$config_output" | sed -n 's/^ZP_DATABASE_URL://p')
if [ -z "$DATABASE_URL" ]; then
  echo "FATAL: DATABASE_URL could not be resolved from the environment." >&2
  exit 1
fi
export DATABASE_URL

# --- 2. Wait for PostgreSQL, diagnosing the reason ----------------------------
# Exit code 0 = reachable. On failure a single `ZP_DB_ERROR:<code> <hint>` line
# is printed to stdout so the shell loop can show it.
probe_db() {
  node -e '
    const { PrismaClient } = require("@prisma/client");
    const client = new PrismaClient();
    client.$queryRaw`SELECT 1`
      .then(() => client.$disconnect().then(() => process.exit(0)))
      .catch((error) => {
        // Prisma does not always expose a `code` (an auth failure is a
        // PrismaClientInitializationError without one), so match the message
        // text as well. The password is never part of any of these strings.
        const code = error && error.code ? error.code : "";
        const message = error && error.message ? String(error.message) : "";
        const byCode = {
          P1000: "authentication failed - check POSTGRES_USER, POSTGRES_PASSWORD and DATABASE_URL",
          P1001: "cannot reach the database server - check that the db service is running",
          P1002: "the database server timed out - it is not ready yet",
          P1003: "the database does not exist - check POSTGRES_DB and DATABASE_URL",
          P1017: "the connection was closed by the server",
        };
        let hint = byCode[code];
        if (!hint && message.includes("Environment variable not found: DATABASE_URL")) {
          hint = "DATABASE_URL is not set and could not be derived - check the POSTGRES_* values";
        } else if (!hint && /authentication failed/i.test(message)) {
          hint = "authentication failed - check POSTGRES_USER, POSTGRES_PASSWORD and DATABASE_URL";
        } else if (!hint && /(can.t reach database server|ECONNREFUSED)/i.test(message)) {
          hint = "cannot reach the database server - check that the db service is running";
        } else if (!hint && /database .* does not exist/i.test(message)) {
          hint = "the database does not exist - check POSTGRES_DB and DATABASE_URL";
        } else if (!hint) {
          const firstLine = message.split("\n").map((line) => line.trim()).find(Boolean);
          hint = firstLine || "unknown error";
        }
        process.stdout.write("ZP_DB_ERROR:" + (code || "connection") + " " + hint + "\n");
        process.exit(1);
      });
  ' 2>/dev/null
}

attempt=0
max_attempts=15
until err=$(probe_db); do
  attempt=$((attempt + 1))
  detail=${err#ZP_DB_ERROR:}
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "FATAL: the database is not reachable after ${max_attempts} attempts." >&2
    echo "       ${detail:-unknown error}" >&2
    echo "       The PostgreSQL volume was left untouched. Correct DATABASE_URL and the POSTGRES_* values in the stack, then redeploy." >&2
    exit 1
  fi
  echo "waiting for the database (attempt ${attempt}/${max_attempts}): ${detail:-connecting...}"
  sleep 2
done

# --- 3. Apply migrations (never resets or drops) ------------------------------
echo "applying database migrations..."
if ! npx prisma migrate deploy --schema packages/backend/prisma/schema.prisma; then
  echo "FATAL: 'prisma migrate deploy' failed. No migration was applied and no data was reset - see the error above." >&2
  exit 1
fi

# --- 4. Start the server ------------------------------------------------------
echo "starting ZeroPeek backend..."
exec node packages/backend/dist/server.js
