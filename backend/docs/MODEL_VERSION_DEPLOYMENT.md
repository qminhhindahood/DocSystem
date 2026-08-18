# Model Version Deployment Workflow

This document describes the model version tracking, deployment, and rollback workflow for the AI Document System.

## Overview

The Model Version Service provides:
- **Version tracking**: Track fine-tuned model versions with metadata
- **Manual activation**: Admin-controlled activation of model versions
- **Deployment workflow**: Register and hot-swap models in Ollama
- **Rollback capability**: Quick rollback to previous working versions

## Schema Design

### ModelVersion Table

```sql
CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" TEXT NOT NULL UNIQUE,      -- Semantic version (e.g., "v1.0.0", "v1.1.0-lora")
    "modelPath" TEXT NOT NULL,            -- Path to LoRA adapter or full model
    "baseModel" TEXT NOT NULL,            -- Base model (e.g., "qwen3.6:14b")
    "trainingJobId" TEXT REFERENCES "TrainingJob",
    "status" ModelStatus NOT NULL DEFAULT 'PENDING',
    "isActivated" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "metadata" JSONB NOT NULL,            -- Training metrics, dataset info
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TYPE ModelStatus AS ENUM (
    'PENDING',    -- Model files being prepared
    'READY',      -- Model available for activation
    'ACTIVE',     -- Currently deployed
    'DEPRECATED', -- Replaced by newer version
    'FAILED'      -- Deployment failed
);
```

### Metadata Structure

```typescript
{
  trainingMetrics: {
    finalLoss: number;      // Final training loss
    epochs: number;         // Number of epochs trained
    datasetSize: number;    // Number of training examples
  },
  performanceBenchmarks?: {
    'format-accuracy': number;   // Format compliance score
    'legal-accuracy': number;    // Legal correctness score
    'fluency': number;           // Language fluency score
  },
  trainingConfig?: {
    learningRate: number;
    batchSize: number;
    loraRank: number;
  },
  datasetInfo?: {
    feedbackIds: string[];      // IDs of feedback used for training
    dateRange: { start: string; end: string };
  }
}
```

## Deployment Workflow

### 1. Training Completion → Version Creation

When a training job completes successfully, the `TrainingJobService` should:

```typescript
// In training_job_service.ts (to be implemented)
const modelVersion = await modelVersionService.createVersion(trainingJobId, {
  version: 'v1.1.0-lora',
  modelPath: `/models/lora/qwen3.6-14b/v1.1.0/adapters/`,
  baseModel: 'qwen3.6:14b',
  metadata: {
    trainingMetrics: {
      finalLoss: 0.0234,
      epochs: 10,
      datasetSize: 500,
    },
    performanceBenchmarks: {
      'format-accuracy': 0.92,
      'legal-accuracy': 0.88,
    },
    trainingConfig: {
      learningRate: 1e-4,
      batchSize: 16,
      loraRank: 32,
    },
  },
  notes: 'Improved format compliance on Vietnamese government documents',
});

// Update version status to PENDING
await modelVersionService.updateStatus(modelVersion.id, ModelStatus.PENDING);
```

### 2. Manual Deployment

Admin deploys the model via API:

```bash
curl -X POST http://localhost:3001/api/admin/models/versions/:versionId/deploy \
  -H "Authorization: Bearer <admin-token>"
```

**Deployment Steps:**
1. **Validate model files** exist at `modelPath`
2. **Register in Ollama** - Create Ollama model with adapter
3. **Trigger hot-swap** - Warm-up request to load model
4. **Update status** to READY

### 3. Activation

Admin activates the deployed version:

```bash
curl -X POST http://localhost:3001/api/admin/models/versions/:versionId/activate \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"activatedBy": "admin@agency.gov.vn"}'
```

**Activation Behavior:**
- Deactivates all other active versions (sets status to DEPRECATED)
- Sets `isActivated = true`, `activatedAt = now()`, `activatedBy = <user>`
- Updates status to ACTIVE
- Invalidates Redis cache

### 4. Hot-Swap Integration

The deployment uses Ollama's model registration:

```typescript
// Creates Ollama Modelfile
FROM qwen3.6:14b
ADAPTER /models/lora/qwen3.6-14b/v1.1.0/adapters/

PARAMETER version v1.1.0-lora
```

Then triggers a warm-up request to load the model into memory.

## Rollback Strategy

### Quick Rollback

To rollback to a previous version:

```bash
curl -X POST http://localhost:3001/api/admin/models/versions/:versionId/rollback \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"rolledBackBy": "admin@agency.gov.vn"}'
```

**Rollback Behavior:**
1. Checks version is READY or ACTIVE
2. Deploys version if not already active
3. Activates the version (deactivating current)
4. Returns immediately upon success

### Automatic Fallback (Future Enhancement)

Consider implementing automatic health checks:

```typescript
// Pseudo-code for automatic health check
async function healthCheckActiveVersion() {
  const active = await modelVersionService.getActiveVersion();
  if (!active) return;

  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: `lora-${active.version}`,
    prompt: 'Test',
    stream: false,
    options: { num_predict: 1 },
  }, { timeout: 5000 });

  if (response.status !== 200) {
    // Find last known good version
    const lastGood = await modelVersionService.listVersions({
      status: ModelStatus.READY,
      isActivated: false,
    });

    if (lastGood.length > 0) {
      await modelVersionService.rollbackToVersion(
        lastGood[0].id,
        'system-health-check'
      );
    }
  }
}
```

## API Endpoints

### List Versions
```
GET /api/admin/models/versions
Query: status, isActive, baseModel, limit, offset
```

### Get Version Details
```
GET /api/admin/models/versions/:versionId
```

### Get Active Version
```
GET /api/admin/models/versions/active
```

### Deploy Version
```
POST /api/admin/models/versions/:versionId/deploy
```

### Activate Version
```
POST /api/admin/models/versions/:versionId/activate
Body: { activatedBy: string }
```

### Deactivate Version
```
POST /api/admin/models/versions/:versionId/deactivate
Body: { deactivatedBy: string }
```

### Rollback to Version
```
POST /api/admin/models/versions/:versionId/rollback
Body: { rolledBackBy: string }
```

### Update Status
```
PUT /api/admin/models/versions/:versionId/status
Body: { status: ModelStatus }
```

## Integration Points

### TrainingJobService Integration

When training completes:

```typescript
// In training_job_service.ts
async completeTraining(jobId: string, metrics: TrainingMetrics) {
  const job = await this.getJob(jobId);
  
  // Create model version
  const version = await modelVersionService.createVersion(jobId, {
    version: `v${job.config.version}`,
    modelPath: job.outputPath,
    baseModel: job.config.baseModel,
    metadata: {
      trainingMetrics: metrics,
    },
  });

  // Update job with version reference
  await this.updateJob(jobId, { modelVersionId: version.id });
}
```

### Ollama Integration

Model registration uses Ollama API:

```bash
# Create model
curl -X POST http://localhost:11434/api/create \
  -d '{
    "name": "lora-v1.1.0-lora",
    "modelfile": "FROM qwen3.6:14b\nADAPTER /path/to/adapter"
  }'

# Warm-up
curl -X POST http://localhost:11434/api/generate \
  -d '{
    "model": "lora-v1.1.0-lora",
    "prompt": "test",
    "stream": false
  }'
```

### Redis Cache

Active version is cached in Redis:

```
Key: model:active_version
TTL: 300 seconds (5 minutes)
Value: { id, version, status, ... }
```

Cache is invalidated on:
- Version activation
- Version deactivation
- Manual cache clear

## Environment Variables

```env
# Ollama integration
OLLAMA_URL=http://localhost:11434

# Redis cache
REDIS_URL=redis://localhost:6379

# Admin authentication
JWT_SECRET=<secret>
```

## Best Practices

### Version Naming
- Use semantic versioning: `v1.0.0`
- Add suffix for LoRA: `v1.1.0-lora`
- Include date for experiments: `v1.2.0-exp-2026-05-19`

### Metadata Documentation
Always include:
- Training metrics (loss, epochs, dataset size)
- Performance benchmarks
- Training configuration
- Dataset information
- Release notes

### Activation Workflow
1. Deploy version
2. Test manually (API calls)
3. Activate when verified
4. Monitor for issues

### Rollback Preparation
- Keep at least one known-good version ready
- Document rollback procedures
- Test rollback regularly

## Troubleshooting

### Deployment Fails
1. Check model files exist at `modelPath`
2. Verify Ollama is running
3. Check Ollama logs for errors
4. Verify base model is installed

### Activation Issues
1. Ensure version status is READY
2. Check model deployed successfully
3. Verify Ollama model exists
4. Check Redis connection

### Hot-Swap Not Working
1. Check Ollama service is running
2. Verify model registered in Ollama
3. Check Ollama logs
4. Restart Ollama if needed