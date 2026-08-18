-- Rename ollamaModelName to lmStudioModelName in ModelVersion table
ALTER TABLE "ModelVersion" RENAME COLUMN "ollamaModelName" TO "lmStudioModelName";
