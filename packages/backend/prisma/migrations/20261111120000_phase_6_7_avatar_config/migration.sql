-- Phase 6.7 – avatar configuration on the player profile.
--
-- Purely additive and data-preserving. One nullable JSONB column is added to
-- `player_profiles`; no table, column or row is deleted, and no existing column
-- changes type or nullability.
--
-- `avatar_config` holds the player's chosen character and the item equipped in
-- each of the five slots (`visor`, `outfit`, `backpack`, `neckAccessory`,
-- `wristAccessory`). Its shape is validated by `@zeropeek/shared`
-- (`validateAvatarConfig`); the server is the only writer, so a client cannot
-- smuggle another character's item in. Because the column is **nullable**, every
-- profile that exists before this phase keeps working unchanged: `NULL` means
-- "no avatar configured yet", which the API reports as an empty configuration.

-- AlterTable
ALTER TABLE "player_profiles" ADD COLUMN "avatar_config" JSONB;
