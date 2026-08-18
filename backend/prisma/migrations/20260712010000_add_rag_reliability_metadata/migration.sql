-- Additive metadata for legal provenance and retry-safe ingestion.
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "embeddedChunkCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "failedChunkCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "issuingAuthority" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "effectiveFrom" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "effectiveTo" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "repealedAt" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "sourceVersion" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;
ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS "pageNumber" INTEGER;
ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
CREATE INDEX IF NOT EXISTS "Chunk_contentHash_idx" ON "Chunk"("contentHash");
-- Partial uniqueness protects newly ingested/retried chunks without rejecting
-- historical rows whose hashes were unavailable at import time.
CREATE UNIQUE INDEX IF NOT EXISTS "Chunk_documentId_contentHash_key"
  ON "Chunk"("documentId", "contentHash")
  WHERE "contentHash" IS NOT NULL;
