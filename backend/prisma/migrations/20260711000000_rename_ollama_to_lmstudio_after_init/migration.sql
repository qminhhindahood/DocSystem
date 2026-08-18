DO $$
BEGIN
  IF to_regclass('public."ModelVersion"') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ModelVersion' AND column_name='ollamaModelName')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ModelVersion' AND column_name='lmStudioModelName') THEN
    ALTER TABLE "ModelVersion" RENAME COLUMN "ollamaModelName" TO "lmStudioModelName";
  END IF;
END $$;
