-- Phase 6.6 – player profiles and the optional account link on a game seat.
--
-- Additive and data-preserving. No table, column or row is deleted, and no
-- existing question, answer, quiz, game or player is modified.
--
-- Two changes:
--
--   * `player_profiles` is new. One row per registered account (`user_id` is
--     unique), created lazily on the first profile read. It holds only the chosen
--     character id; every statistic is computed on demand from the persisted game
--     data, so nothing here can drift. **No IP address is stored** (product
--     decision Q5, Phase 6.6). The XP/level/inventory columns belong to Phase 6.8
--     and are deliberately absent.
--
--   * `game_players.user_id` is new, **nullable**, and references `users` with
--     ON DELETE SET NULL. It links a seat to the account that played the round so
--     the profile can count that account's own finished games. Every existing
--     row keeps `user_id = NULL` (a guest seat) and stays valid, so no historical
--     guest participation is attributed to anyone. A deleted account leaves the
--     seat intact with a null link rather than destroying the game history.
--
-- Both are additive: no existing column changes type or nullability, and no
-- constraint on an existing column is touched.

-- 1. The durable player profile.
CREATE TABLE "player_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "selected_character_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "player_profiles_user_id_key" ON "player_profiles"("user_id");

ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. The optional account link on a game seat (nullable, so guests are unchanged).
ALTER TABLE "game_players" ADD COLUMN "user_id" TEXT;

CREATE INDEX "game_players_user_id_idx" ON "game_players"("user_id");

ALTER TABLE "game_players" ADD CONSTRAINT "game_players_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
