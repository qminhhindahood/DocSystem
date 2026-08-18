CREATE TABLE "IngestionJob" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "documentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IngestionJob_documentId_key" UNIQUE ("documentId"),
    CONSTRAINT "IngestionJob_documentId_fkey"
        FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "IngestionJob_status_availableAt_idx"
    ON "IngestionJob"("status", "availableAt");

CREATE INDEX "IngestionJob_leaseExpiresAt_idx"
    ON "IngestionJob"("leaseExpiresAt");
