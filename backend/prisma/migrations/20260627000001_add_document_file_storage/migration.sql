-- Add file storage fields for async ingestion pipeline
-- storageKey = relative path (uploads/<uuid>.pdf), resolved via UPLOAD_DIR

ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "storageKey" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "originalFilename" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "mimeType" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "fileSize" INTEGER NOT NULL DEFAULT 0;
