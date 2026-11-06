-- Phase 6.3 – voluntary player registration.
--
-- Purely additive: the new role is appended to the enum, `email_verified_at`
-- is nullable, and the token table is new. No existing row, column or
-- constraint is changed or dropped, so ADMIN/TRAINER accounts and all existing
-- data keep working untouched.
--
-- Existing accounts are treated as already confirmed (`email_verified_at`
-- backfilled to `created_at`) so a deployment upgrade can never lock a current
-- user out of their own account. Only new self-registered players start out
-- unconfirmed.

-- 1. Append PLAYER to the role enum (additive).
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PLAYER';

-- 2. Nullable confirmation timestamp on users.
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3);

-- 3. Backfill: everything that exists today is considered confirmed.
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;

-- 4. Single-use e-mail verification tokens (only the hash is stored).
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key"
    ON "email_verification_tokens"("token_hash");

CREATE INDEX "email_verification_tokens_user_id_idx"
    ON "email_verification_tokens"("user_id");

CREATE INDEX "email_verification_tokens_expires_at_idx"
    ON "email_verification_tokens"("expires_at");

ALTER TABLE "email_verification_tokens"
    ADD CONSTRAINT "email_verification_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
