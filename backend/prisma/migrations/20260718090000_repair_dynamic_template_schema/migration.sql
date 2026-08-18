DO $$ BEGIN
  CREATE TYPE "TemplateStatus" AS ENUM
    ('UPLOADED', 'ANALYZING', 'NEEDS_REVIEW', 'READY', 'REJECTED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Template"
  ADD COLUMN IF NOT EXISTS "header" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "signatureBlock" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "ownerId" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "originalPath" TEXT,
  ADD COLUMN IF NOT EXISTS "originalSha256" TEXT,
  ADD COLUMN IF NOT EXISTS "fileSize" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "status" "TemplateStatus" NOT NULL DEFAULT 'UPLOADED',
  ADD COLUMN IF NOT EXISTS "semanticMap" JSONB,
  ADD COLUMN IF NOT EXISTS "generationSchema" JSONB,
  ADD COLUMN IF NOT EXISTS "analysisConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "compatibilityReport" JSONB,
  ADD COLUMN IF NOT EXISTS "previewMetadata" JSONB,
  ADD COLUMN IF NOT EXISTS "rejectionCode" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;

DO $$
DECLARE
  current_status_type TEXT;
BEGIN
  SELECT udt_name
  INTO current_status_type
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'Template'
    AND column_name = 'status';

  IF current_status_type IS NOT NULL AND current_status_type <> 'TemplateStatus' THEN
    ALTER TABLE "Template" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "Template"
      ALTER COLUMN "status" TYPE "TemplateStatus"
      USING CASE
        WHEN "status"::TEXT IN ('UPLOADED', 'ANALYZING', 'NEEDS_REVIEW', 'READY', 'REJECTED', 'FAILED')
          THEN "status"::TEXT::"TemplateStatus"
        ELSE 'REJECTED'::"TemplateStatus"
      END;
  END IF;
END $$;

ALTER TABLE "Template" ALTER COLUMN "docType" DROP NOT NULL;

INSERT INTO "User" ("id", "username", "passwordHash", "role", "isDisabled", "createdAt", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'system-owner', '!system-owner-disabled!', 'user', true, NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET "isDisabled" = true;

UPDATE "Template"
SET "ownerId" = '00000000-0000-0000-0000-000000000001',
    "status" = 'REJECTED',
    "rejectionCode" = 'LEGACY_STATIC_RETIRED',
    "rejectionReason" = 'Mẫu cũ được giữ lại để đối soát và không dùng để tạo văn bản.'
WHERE "ownerId" IS NULL;

UPDATE "Template" SET "status" = 'REJECTED' WHERE "status" IS NULL;
UPDATE "Template" SET "fileSize" = 0 WHERE "fileSize" IS NULL;

DROP INDEX IF EXISTS "Template_docType_key";
ALTER TABLE "Template"
  ALTER COLUMN "ownerId" SET NOT NULL,
  ALTER COLUMN "ownerId" SET DEFAULT '00000000-0000-0000-0000-000000000001',
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'REJECTED',
  ALTER COLUMN "fileSize" SET NOT NULL,
  ALTER COLUMN "fileSize" SET DEFAULT 0,
  ALTER COLUMN "header" SET DEFAULT '',
  ALTER COLUMN "signatureBlock" SET DEFAULT '';

CREATE INDEX IF NOT EXISTS "Template_ownerId_status_idx" ON "Template"("ownerId", "status");
CREATE INDEX IF NOT EXISTS "Template_ownerId_createdAt_idx" ON "Template"("ownerId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Template_ownerId_fkey'
      AND conrelid = '"Template"'::regclass
  ) THEN
    ALTER TABLE "Template" ADD CONSTRAINT "Template_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "UserDocumentProfile" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "agencyName" TEXT,
  "agencyCode" TEXT,
  "defaultPlace" TEXT,
  "defaultRecipients" JSONB,
  "signatoryName" TEXT,
  "signatoryTitle" TEXT,
  "documentNumberPrefix" TEXT,
  "nextDocumentNumber" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserDocumentProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserDocumentProfile_userId_key" UNIQUE ("userId"),
  CONSTRAINT "UserDocumentProfile_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
