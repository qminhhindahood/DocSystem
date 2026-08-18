-- Organization profiles supply reusable Decree 30 identity and contact blocks.
ALTER TABLE "UserDocumentProfile"
  ADD COLUMN IF NOT EXISTS "supervisingAgency" TEXT,
  ADD COLUMN IF NOT EXISTS "agencyAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "agencyEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "agencyWebsite" TEXT,
  ADD COLUMN IF NOT EXISTS "agencyPhone" TEXT;
