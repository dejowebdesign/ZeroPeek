-- Phase 6.6.3: separate host and player identity contexts.
--
-- `kind` tags every session as either a host session (the existing `zp_session`
-- cookie, staff surfaces) or a player session (`zp_player_session`, the player
-- profile). It defaults to 'host', so every session that already exists keeps
-- working as a host session and no existing login is invalidated.
--
-- Purely additive: one column with a default and one index. No row is changed,
-- no table is rewritten, nothing is dropped.

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'host';

-- CreateIndex
CREATE INDEX "sessions_kind_idx" ON "sessions"("kind");
