-- Add ingestion status tracking to Document table
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "ingestionStatus" TEXT NOT NULL DEFAULT 'uploaded';
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "processingError" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "processedAt" TIMESTAMP;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "chunkCount" INTEGER NOT NULL DEFAULT 0;

-- Create index on ingestionStatus for filtering
CREATE INDEX IF NOT EXISTS "Document_ingestionStatus_idx" ON "Document"("ingestionStatus");

-- Create User table for multi-user support
CREATE TABLE "User" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'user',
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- Create unique index on username
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
CREATE INDEX IF NOT EXISTS "User_username_idx" ON "User"("username");
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");

-- Create UserLLMConfig table for per-user LLM settings
CREATE TABLE "UserLLMConfig" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "encryptedApiKey" TEXT NOT NULL,
  "apiKeyIv" TEXT NOT NULL,
  "apiKeyAuthTag" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT "UserLLMConfig_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint on userId (one config per user)
CREATE UNIQUE INDEX IF NOT EXISTS "UserLLMConfig_userId_key" ON "UserLLMConfig"("userId");

-- Add foreign key constraint
ALTER TABLE "UserLLMConfig" ADD CONSTRAINT "UserLLMConfig_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
