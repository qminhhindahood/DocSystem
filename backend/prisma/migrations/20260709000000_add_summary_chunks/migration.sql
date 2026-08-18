/*
  Warnings:
  - You are about to add 2 columns to the "Chunk" table: "isSummary" (Boolean) and "summaryOf" (String).
    These have non-nullable defaults (false / null) so existing rows are unaffected.
  - This is additive; no data migration required.

  Rollback (if needed):
    ALTER TABLE "Chunk" DROP COLUMN "isSummary";
    ALTER TABLE "Chunk" DROP COLUMN "summaryOf";
*/

-- Add summary-chunk support (Task B/H): per-document abstract chunks for
-- global-context recall. level 0 = summary, summaryOf points at doc/article.
ALTER TABLE "Chunk" ADD COLUMN "isSummary" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Chunk" ADD COLUMN "summaryOf" TEXT;
