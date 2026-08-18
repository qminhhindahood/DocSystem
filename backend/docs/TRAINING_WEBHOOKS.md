# Training Job Webhook Integration Guide

This document provides examples of webhook payloads for integrating the LORA service with the Training Job Service.

## Overview

The LORA service reports training progress and status updates to the backend via webhooks. The Training Job Service handles state transitions, progress tracking, and job lifecycle management.

## Base URL

```
POST http://localhost:3001/api/training/webhook/:jobId/:event
```

## Webhook Events

### 1. Job Started

Triggered when the LORA service begins processing a queued job.

**Endpoint:** `POST /api/training/webhook/:jobId/started`

**Request:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Job started"
}
```

**State Transition:** `QUEUED` → `RUNNING`

---

### 2. Training Phase Started

Triggered when actual LoRA training begins.

**Endpoint:** `POST /api/training/webhook/:jobId/training-started`

**Request:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Training started"
}
```

**State Transition:** `RUNNING` → `TRAINING`

---

### 3. Progress Update

Sent periodically during training to report progress metrics.

**Endpoint:** `POST /api/training/webhook/:jobId/progress`

**Request:**
```json
{
  "epoch": 3,
  "totalEpochs": 10,
  "progress": 30,
  "currentLoss": 0.4523,
  "metrics": {
    "learningRate": 0.0001,
    "gradientNorm": 0.0234,
    "throughput": 12.5
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Progress updated"
}
```

**State:** `TRAINING` (stays in TRAINING for progress updates)

**Field Descriptions:**
| Field | Type | Description |
|-------|------|-------------|
| `epoch` | number | Current epoch number (1-indexed) |
| `totalEpochs` | number | Total epochs to train |
| `progress` | number | Overall progress percentage (0-100) |
| `currentLoss` | number | Current training loss |
| `metrics.learningRate` | number | Current learning rate |
| `metrics.gradientNorm` | number | Gradient norm for monitoring |
| `metrics.throughput` | number | Samples processed per second |

---

### 4. Evaluation Phase Started

Triggered when training completes and evaluation begins.

**Endpoint:** `POST /api/training/webhook/:jobId/evaluating`

**Request:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Evaluation started"
}
```

**State Transition:** `TRAINING` → `EVALUATING`

**Note:** Progress is automatically set to 85% when entering evaluation.

---

### 5. Training Completed

Triggered when training and evaluation complete successfully.

**Endpoint:** `POST /api/training/webhook/:jobId/completed`

**Request:**
```json
{
  "outputPath": "/models/lora/qwen3.6-v1.0.0",
  "modelVersionId": "mv_550e8400e29b41d4a716446655440000"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Training completed"
}
```

**State Transition:** `EVALUATING` → `COMPLETED`

**Field Descriptions:**
| Field | Type | Description |
|-------|------|-------------|
| `outputPath` | string | Filesystem path to trained LoRA adapter |
| `modelVersionId` | string | (Optional) Reference to ModelVersion record |

---

### 6. Training Failed

Triggered when training encounters an error.

**Endpoint:** `POST /api/training/webhook/:jobId/failed`

**Request:**
```json
{
  "error": "CUDA out of memory. Tried to allocate 2.00 GiB (GPU 0; 7.93 GiB total capacity; 5.12 GiB already allocated; 1.88 GiB free)"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Job marked as failed"
}
```

**State Transition:** Any active state → `FAILED`

---

## Complete Training Flow Example

```
┌─────────────────────────────────────────────────────────────────┐
│ Job ID: 550e8400-e29b-41d4-a716-446655440000                    │
│ Config: epochs=10, lr=0.001, batch=8, lora_rank=16              │
└─────────────────────────────────────────────────────────────────┘

1. Job Created (QUEUED, 0%)
   └─> Database record created
   └─> Added to Redis queue

2. Worker picks up job (RUNNING, 0%)
   POST /api/training/webhook/:jobId/started

3. Training begins (TRAINING, 10%)
   POST /api/training/webhook/:jobId/training-started

4. Progress updates (TRAINING, 10-85%)
   POST /api/training/webhook/:jobId/progress
   { epoch: 1, progress: 15, currentLoss: 0.8234 }
   POST /api/training/webhook/:jobId/progress
   { epoch: 5, progress: 50, currentLoss: 0.3421 }
   POST /api/training/webhook/:jobId/progress
   { epoch: 10, progress: 85, currentLoss: 0.1234 }

5. Evaluation starts (EVALUATING, 85%)
   POST /api/training/webhook/:jobId/evaluating

6. Training completes (COMPLETED, 100%)
   POST /api/training/webhook/:jobId/completed
   { outputPath: "/models/lora/v1.0.0", modelVersionId: "mv_xxx" }
```

---

## Error Handling

### Validation Errors

```json
// Response: 400 Bad Request
{
  "error": "Progress value 150 is not between 0 and 100"
}
```

### State Violation Errors

```json
// Response: 400 Bad Request
{
  "error": "Cannot update progress for job in state: COMPLETED"
}
```

### Not Found Errors

```json
// Response: 404 Not Found
{
  "error": "Training job not found: invalid-job-id"
}
```

---

## API Routes Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/training/jobs` | Create new training job |
| `GET` | `/api/training/jobs` | List training jobs |
| `GET` | `/api/training/jobs/:id` | Get job by ID |
| `POST` | `/api/training/jobs/:id/cancel` | Cancel job |
| `POST` | `/api/training/webhook/:id/started` | Mark job started |
| `POST` | `/api/training/webhook/:id/training-started` | Training phase started |
| `POST` | `/api/training/webhook/:id/progress` | Update progress |
| `POST` | `/api/training/webhook/:id/evaluating` | Evaluation started |
| `POST` | `/api/training/webhook/:id/completed` | Training completed |
| `POST` | `/api/training/webhook/:id/failed` | Training failed |
| `POST` | `/api/training/queue/next` | Queue next job (worker) |
| `GET` | `/api/training/stats` | Get job statistics |
| `POST` | `/api/training/cleanup` | Cleanup old jobs |
| `GET` | `/api/training/progress/:id` | Get cached progress (frontend polling) |

---

## Integration with Training Data Exporter

Before creating a training job, the `training_data_exporter.ts` should be called to generate the training dataset:

```typescript
// Example: Create training job with exported data
import { trainingDataExporter } from './services/training_data_exporter';
import { trainingJobService } from './services/training_job_service';

// 1. Export training data
const exportResult = await trainingDataExporter.exportToJSONL({
  feedbackIds: ['fb_1', 'fb_2', 'fb_3'],
  outputPath: '/data/training/dataset.jsonl',
});

// 2. Create training job
const job = await trainingJobService.createJob(['fb_1', 'fb_2', 'fb_3'], {
  epochs: 10,
  learningRate: 0.001,
  batchSize: 8,
  loraRank: 16,
  loraAlpha: 32,
  targetModules: ['q_proj', 'v_proj', 'k_proj'],
  outputDir: '/models/lora/v1.0.0',
});

// 3. Pass exportResult.datasetPath to LORA service
```

---

## State Machine Reference

```
┌──────────┐
│  QUEUED  │────────┐
└──────────┘        │
       │            │
       ▼            │
┌──────────┐   ┌────────────┐
│ RUNNING  │──►│ CANCELLED  │
└──────────┘   └────────────┘
       │
       ▼
┌──────────┐   ┌────────────┐
│ TRAINING │──►│   FAILED   │
└──────────┘   └────────────┘
       │
       ▼
┌──────────┐   ┌────────────┐
│EVALUATING│──►│ COMPLETED  │
└──────────┘   └────────────┘
```

**Terminal States:** `COMPLETED`, `FAILED`, `CANCELLED`
**Active States:** `QUEUED`, `RUNNING`, `TRAINING`, `EVALUATING`

---

## Example: Frontend Progress Polling

```typescript
// Frontend component polling job progress
async function pollJobProgress(jobId: string, intervalMs: number = 2000) {
  const response = await fetch(`http://localhost:3001/api/training/progress/${jobId}`);
  const data = await response.json();

  if (data.success && data.progress) {
    console.log(`Epoch ${data.progress.epoch}, Loss: ${data.progress.currentLoss}`);
  }
}
```

---

## Notes

1. **State Validation:** All state transitions are validated against the state machine. Invalid transitions return 400 errors.

2. **Progress Caching:** Progress updates are cached in Redis for real-time frontend polling (TTL: 1 hour).

3. **Job Queue:** Jobs are queued in Redis for priority-based processing.

4. **Cleanup:** Use `POST /api/training/cleanup` to remove old completed/failed jobs and maintain database size.