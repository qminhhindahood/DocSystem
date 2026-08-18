-- Rename similarityScore to jaccardSimilarity for clarity (it's Jaccard text similarity, not vector)
ALTER TABLE "Feedback" RENAME COLUMN "similarityScore" TO "jaccardSimilarity";