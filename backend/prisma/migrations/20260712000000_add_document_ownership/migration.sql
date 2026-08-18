-- Private-by-default document ownership. The fixed identity is intentionally
-- disabled and is used only as the owner for imported legacy corpus data.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isDisabled" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "User" ("id", "username", "passwordHash", "role", "isDisabled", "createdAt", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'system-owner', '!system-owner-disabled!', 'user', true, NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET "isDisabled" = true;

ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "ownerId" TEXT;
ALTER TABLE "Document" ALTER COLUMN "ownerId" SET DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE "Document" SET "ownerId" = '00000000-0000-0000-0000-000000000001' WHERE "ownerId" IS NULL;
ALTER TABLE "Document" ALTER COLUMN "ownerId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "Document_ownerId_idx" ON "Document"("ownerId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Document_ownerId_fkey') THEN
    ALTER TABLE "Document" ADD CONSTRAINT "Document_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
