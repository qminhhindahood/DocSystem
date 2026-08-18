-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "docType" TEXT NOT NULL,
    "docNumber" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "documentId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "article" TEXT,
    "clause" TEXT,
    "point" TEXT,
    "content" TEXT NOT NULL,
    "embedding" vector(1024),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "documentId" TEXT NOT NULL,
    "originalContent" TEXT NOT NULL,
    "editedContent" TEXT NOT NULL,
    "diff" JSONB NOT NULL DEFAULT '{}',
    "editType" TEXT,
    "confidence" DOUBLE PRECISION,
    "subType" TEXT,
    "priority" TEXT,
    "similarityScore" DOUBLE PRECISION,
    "affectsCompliance" BOOLEAN NOT NULL DEFAULT false,
    "classificationConfidence" DOUBLE PRECISION,
    "approvedForTraining" BOOLEAN NOT NULL DEFAULT false,
    "approvedForRag" BOOLEAN NOT NULL DEFAULT false,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "sessionId" TEXT,
    "modelName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "header" TEXT NOT NULL,
    "signatureBlock" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingJob" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "threshold" INTEGER NOT NULL DEFAULT 50,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "exportPath" TEXT,
    "outputPath" TEXT,
    "error" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "epoch" INTEGER NOT NULL DEFAULT 0,
    "totalEpochs" INTEGER NOT NULL DEFAULT 10,
    "currentLoss" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "feedbackIds" JSONB,
    "config" JSONB,
    "name" TEXT,
    "description" TEXT,
    "createdBy" TEXT,
    "modelVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TrainingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "baseModel" TEXT NOT NULL,
    "adapterPath" TEXT,
    "modelPath" TEXT,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "isActivated" BOOLEAN NOT NULL DEFAULT false,
    "trainingJobId" TEXT,
    "feedbackCount" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB,
    "ollamaModelName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "activatedBy" TEXT,

    CONSTRAINT "ModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingJob_jobId_key" ON "TrainingJob"("jobId");

-- CreateIndex
CREATE INDEX "TrainingJob_status_idx" ON "TrainingJob"("status");

-- CreateIndex
CREATE INDEX "TrainingJob_createdAt_idx" ON "TrainingJob"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModelVersion_version_key" ON "ModelVersion"("version");

-- CreateIndex
CREATE INDEX "ModelVersion_status_idx" ON "ModelVersion"("status");

-- CreateIndex
CREATE INDEX "ModelVersion_isActivated_idx" ON "ModelVersion"("isActivated");

-- CreateIndex
CREATE INDEX "ModelVersion_createdAt_idx" ON "ModelVersion"("createdAt");

-- CreateIndex
CREATE INDEX "Document_docType_idx" ON "Document"("docType");

-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");

-- CreateIndex
CREATE INDEX "Document_createdAt_idx" ON "Document"("createdAt");

-- CreateIndex
CREATE INDEX "Chunk_documentId_idx" ON "Chunk"("documentId");

-- CreateIndex
CREATE INDEX "Chunk_level_idx" ON "Chunk"("level");

-- CreateIndex
CREATE INDEX "Feedback_documentId_idx" ON "Feedback"("documentId");

-- CreateIndex
CREATE INDEX "Feedback_editType_idx" ON "Feedback"("editType");

-- CreateIndex
CREATE INDEX "Feedback_priority_idx" ON "Feedback"("priority");

-- CreateIndex
CREATE INDEX "Feedback_reviewStatus_idx" ON "Feedback"("reviewStatus");

-- CreateIndex
CREATE INDEX "Feedback_approvedForTraining_idx" ON "Feedback"("approvedForTraining");

-- CreateIndex
CREATE INDEX "Feedback_approvedForRag_idx" ON "Feedback"("approvedForRag");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Template_docType_key" ON "Template"("docType");

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelVersion" ADD CONSTRAINT "ModelVersion_trainingJobId_fkey"
    FOREIGN KEY ("trainingJobId") REFERENCES "TrainingJob"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
