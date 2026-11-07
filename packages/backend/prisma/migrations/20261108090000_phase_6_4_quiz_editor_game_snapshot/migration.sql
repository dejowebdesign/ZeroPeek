-- Phase 6.4 – quiz editor metadata and the immutable game snapshot.
--
-- Additive and data-preserving. No table, column or row is deleted, and no
-- existing question, answer or quiz is modified.
--
-- Why the two foreign keys change:
--
--   * `games.quiz_id` becomes nullable and its FK becomes ON DELETE SET NULL.
--     A game must survive the deletion of the quiz it was started from
--     (product decision, `game-design-concept.md` §8.7). The questions a
--     started game uses live in `game_snapshots`, not in the live quiz, so a
--     deleted quiz simply leaves the game with `quiz_id = NULL`.
--
--   * `player_answers.question_id` stops being a foreign key to `questions`.
--     It was ON DELETE CASCADE, so deleting a quiz (which deletes its
--     questions) destroyed the answers of every game played with it – the R-3
--     history-loss risk. A started game answers against the snapshot's copied
--     questions, so the column keeps the id as a plain string and history is
--     preserved. The column and its data are untouched; only the constraint is
--     dropped.
--
--     Why not keep a foreign key with ON DELETE SET NULL instead? Because
--     `question_id` is the *only* link from an answer to the question it
--     answered: `reportService` attributes every answer by matching
--     `answer.question_id` against the snapshot's question ids. SET NULL would
--     erase that link the moment the source quiz is deleted (verified on a real
--     database: the id became NULL and the report then threw
--     `Error converting field "questionId" of expected non-nullable type
--     "String"`). It would also fire on an ordinary editor save, because
--     `updateQuiz` deletes and recreates the question rows – so a trainer
--     renaming a quiz would silently erase the attribution of past games. A
--     foreign key to the *live* question table cannot protect a *historical*
--     value; the value must survive the row it once pointed at. The snapshot,
--     not the live table, is the referential guarantee. A database-level
--     regression guard for both constraints lives in
--     `packages/backend/src/snapshot.integration.test.ts`.

-- 1. A game may outlive its quiz.
ALTER TABLE "games" DROP CONSTRAINT "games_quiz_id_fkey";
ALTER TABLE "games" ALTER COLUMN "quiz_id" DROP NOT NULL;
ALTER TABLE "games" ADD CONSTRAINT "games_quiz_id_fkey"
    FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Answers are no longer cascaded away when a quiz (and its questions) is
--    deleted. Existing rows keep their `question_id` value.
ALTER TABLE "player_answers" DROP CONSTRAINT "player_answers_question_id_fkey";

-- 3. Optional category / difficulty labels (free text; no taxonomy yet).
ALTER TABLE "quizzes"
    ADD COLUMN "category" TEXT,
    ADD COLUMN "difficulty" TEXT;
ALTER TABLE "questions"
    ADD COLUMN "category" TEXT,
    ADD COLUMN "difficulty" TEXT;

-- 4. The immutable snapshot: one row per game, written when the run starts.
CREATE TABLE "game_snapshots" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "quiz_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "question_count" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_snapshots_game_id_key" ON "game_snapshots"("game_id");
CREATE INDEX "game_snapshots_quiz_id_idx" ON "game_snapshots"("quiz_id");

ALTER TABLE "game_snapshots" ADD CONSTRAINT "game_snapshots_game_id_fkey"
    FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_snapshots" ADD CONSTRAINT "game_snapshots_quiz_id_fkey"
    FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
