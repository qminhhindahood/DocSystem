-- Preserve legacy columns for audit compatibility while allowing the dynamic
-- template writer (which uses originalPath/generationSchema) to insert rows.
-- These columns were renamed in the schema (filePath → originalPath, schema → generationSchema)
-- and may not exist on fresh deploys. Only run if the legacy columns exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='Template' AND column_name='filePath'
  ) THEN
    ALTER TABLE "Template" ALTER COLUMN "filePath" DROP NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='Template' AND column_name='schema'
  ) THEN
    ALTER TABLE "Template" ALTER COLUMN "schema" DROP NOT NULL;
  END IF;
END $$;
