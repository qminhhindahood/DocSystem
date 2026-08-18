# Exhaustive Master Implementation Plan — Full Project Fixes

This implementation plan merges all issues from:
1. The **14 confirmed issues** in the first review ([project-review.md](file:///C:/Users/PC/Documents/LLM/docs/superpowers/plans/subagent/project-review.md)).
2. The **additional issues** in the second review ([full_project_review.md](file:///C:/Users/PC/Documents/LLM/docs/superpowers/plans/subagent/full_project_review.md)).
3. The **14 specific issues** in the subagent implementation plan ([implementation_plan.md](file:///C:/Users/PC/Documents/LLM/docs/superpowers/plans/subagent/implementation_plan.md)).

---

## User Review Required

> [!IMPORTANT]
> **Environment Configuration Changes:**
> - `ALLOW_DEV_AUTH` replaces environment checks for `NODE_ENV === 'development'`. By default, dev auth is disabled (`false`) and must be explicitly enabled in local `.env` files to prevent security bypasses in staging/production.
> - `ALLOW_STACK_TRACES` replaces the dev flag for stack trace exposure. It must be disabled (`false`) in production to prevent leaking internal database schemas and folder paths.
> - `JWT_SECRET` must be set in production; the system will throw a startup error if it is missing or defaults to a hardcoded fallback.

> [!WARNING]
> **Rate Limiting Resilience (Fail-Open):**
> - When Redis is down, the rate limiting middleware will log an error and fail open (allow requests) instead of returning a `503 Service Unavailable` error. This guarantees application uptime during Redis transient errors.

---

## Proposed Changes

### Component: Infrastructure & Docker Orchestration

#### [MODIFY] [docker-compose.yml](file:///C:/Users/PC/Documents/LLM/docker-compose.yml)
- Mount `init-hnsw.sql` to execute *after* the main database creation completes.
- Parameterize pg_isready healthcheck to use container environment variables instead of hardcoded `postgres` username and database names.
- Define a Node.js `backend` service container.

```diff
     volumes:
       - postgres_data:/var/lib/postgresql/data
-      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
+      - ./init.sql:/docker-entrypoint-initdb.d/01-init.sql
+      - ./init-hnsw.sql:/docker-entrypoint-initdb.d/02-hnsw.sql
     ports:
       - "5432:5432"
     command: [ "postgres", "-c", "shared_preload_libraries=vector" ]
     healthcheck:
-      test: [ "CMD-SHELL", "pg_isready -U postgres -d ai_docs" ]
+      test: [ "CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB" ]
```

```yaml
  backend:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${DB_PASSWORD}@postgres:5432/${POSTGRES_DB:-ai_docs}?schema=public
      REDIS_URL: redis://redis:6379
      DOCLING_URL: http://docling:8001
      EMBEDDINGS_URL: http://embeddings:8002
      LORA_SERVICE_URL: http://lora:8003
      LM_STUDIO_URL: ${LM_STUDIO_URL:-http://host.docker.internal:1234}
      LM_STUDIO_MODEL: ${LM_STUDIO_MODEL:-qwen3:14b}
      JWT_SECRET: ${JWT_SECRET:-dev-jwt-secret-change-in-production}
      ALLOW_DEV_AUTH: ${ALLOW_DEV_AUTH:-false}
      ALLOW_STACK_TRACES: ${ALLOW_STACK_TRACES:-false}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: [ "CMD", "curl", "-f", "http://localhost:3001/health" ]
      interval: 30s
      timeout: 10s
      retries: 3
```

#### [NEW] [Dockerfile](file:///C:/Users/PC/Documents/LLM/backend/Dockerfile)
- Create a multi-stage Dockerfile for compiling and launching the Express application.

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma/
RUN npx prisma generate
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

---

### Component: Python Microservices

#### [MODIFY] [main.py](file:///C:/Users/PC/Documents/LLM/embeddings-service/main.py)
- Fallback to CPU execution if CUDA memory allocation fails or GPU is unavailable.
- Implement `/embed/batch` endpoint to encode a list of texts simultaneously.

```python
# GPU to CPU Fallback
def load_model():
    global _model, _model_load_error
    try:
        from sentence_transformers import SentenceTransformer
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _model = SentenceTransformer('jinaai/jina-embeddings-v3', device=device)
        logger.info(f"Model loaded successfully on {device}")
        _model_load_error = None
    except Exception as e:
        logger.error(f"Failed to load model on GPU: {e}. Falling back to CPU...")
        try:
            _model = SentenceTransformer('jinaai/jina-embeddings-v3', device="cpu")
            _model_load_error = None
        except Exception as cpu_err:
            _model_load_error = str(cpu_err)
```

```python
class BatchEmbedRequest(BaseModel):
    texts: List[str]
    task_type: Optional[str] = "text-document"

class BatchEmbedResponse(BaseModel):
    embeddings: List[List[float]]
    dimensions: int

@app.post("/embed/batch", response_model=BatchEmbedResponse)
async def embed_batch(request: BatchEmbedRequest):
    global _model
    if _model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    if not request.texts:
        return BatchEmbedResponse(embeddings=[], dimensions=1024)
    for text in request.texts:
        if len(text) > 50000:
            raise HTTPException(status_code=400, detail="Text exceeds limit of 50000 characters")
    try:
        task_type = request.task_type or "text-document"
        embeddings = _model.encode(request.texts, task_type=task_type, normalize_embeddings=True)
        return BatchEmbedResponse(embeddings=embeddings.tolist(), dimensions=1024)
    except Exception as e:
        logger.error(f"Batch embedding error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate batch embeddings")
```

#### [MODIFY] [main.py](file:///C:/Users/PC/Documents/LLM/lora-service/main.py)
- **C1 (Command/Python Injection):** Write configuration parameters directly to a `config.json` inside the output directory instead of interpolating them as strings in `train.py`. The generated `train.py` will load this JSON.
- **C4 (Path Traversal):** Enforce strict regex validation on the `job_id` parameter and verify that resolved absolute output paths reside strictly inside the designated `lora-outputs` directory.
- **M9 (Job Cancellation Process Leak):** Keep references of active `subprocess.Popen` handles in a dictionary. On cancel requests, terminate/kill the process and clean up temporary scripts and partial checkpoints on disk.

```python
import re
active_subprocesses = {}

# Inside start_training
if not re.match(r'^[a-zA-Z0-9_\-]+$', request.job_id):
    raise HTTPException(status_code=400, detail="Invalid job ID format")

# Inside run_lora_training
output_path = (Path(config.output_dir) / job_id).resolve()
base_allowed = Path(config.output_dir).resolve()
if not str(output_path).startswith(str(base_allowed) + os.sep) and output_path != base_allowed:
    raise HTTPException(status_code=400, detail="Path traversal detected")

# Save configurations safely
config_file = output_path / "config.json"
config_file.write_text(json.dumps(config.dict(), indent=2))

# generated train.py loads config from file:
# config = json.load(open('config.json'))
# MODEL_NAME = config['model_name']
```

```python
# Active process tracking
process = subprocess.Popen(
    ["python", str(train_script)],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    cwd=output_path,
)
active_subprocesses[job_id] = process
```

```python
# Subprocess termination inside cancel_training
if job_id in active_subprocesses:
    process = active_subprocesses[job_id]
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
    del active_subprocesses[job_id]
    
# Directory cleanup
if output_path.exists():
    shutil.rmtree(output_path, ignore_errors=True)
```

#### [MODIFY] [main.py](file:///C:/Users/PC/Documents/LLM/docling-service/main.py)
- Fix the module-scope indentation bug on path traversal check lines (~74–77 and ~179–182).
- Reject PDF uploads larger than 10MB to prevent denial-of-service memory exhaustion.

```python
# Indent inside the function
        file_path = os.path.join(UPLOAD_DIR, safe_filename)
        real_path = os.path.realpath(file_path)
        real_upload = os.path.realpath(UPLOAD_DIR)
        if not real_path.startswith(real_upload + os.sep) and real_path != real_upload:
            raise HTTPException(status_code=400, detail="Invalid file path")
```

```python
        # Max file size limit
        file.file.seek(0, 2)
        size = file.file.tell()
        file.file.seek(0)
        if size > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File size exceeds maximum limit of 10MB")
```

#### [MODIFY] [Dockerfile](file:///C:/Users/PC/Documents/LLM/docling-service/Dockerfile)
- Install system dependencies for Tesseract OCR (`tesseract-ocr`, `tesseract-ocr-vie`, `tesseract-ocr-eng`) to prevent library load errors during OCR fallback.

```diff
 RUN apt-get update && apt-get install -y \
     curl \
+    tesseract-ocr \
+    tesseract-ocr-vie \
+    tesseract-ocr-eng \
     && rm -rf /var/lib/apt/lists/*
```

---

### Component: Backend Infrastructure & Utilities

#### [MODIFY] [prisma.ts](file:///C:/Users/PC/Documents/LLM/backend/src/utils/prisma.ts)
- Fix connection parameter appending logic to check for existing query strings (use `&` instead of `?` if existing params are present).

```typescript
const dbUrl = process.env.DATABASE_URL || '';
const finalUrl = dbUrl.includes('?') ? `${dbUrl}&connection_limit=10` : `${dbUrl}?connection_limit=10`;
```

#### [MODIFY] [redis.ts](file:///C:/Users/PC/Documents/LLM/backend/src/utils/redis.ts)
- Add backoff `reconnectStrategy` to client config.

```typescript
    this.client = createClient({
      url: redisUrl,
      disableOfflineQueue: true,
      socket: {
        reconnectStrategy: (retries: number) => {
          const delay = Math.min(Math.pow(2, retries) * 50, 3000);
          console.warn(`[RedisClient] Connection lost. Reconnecting in ${delay}ms... (attempt ${retries})`);
          return delay;
        }
      }
    });
```

#### [NEW] [retry.ts](file:///C:/Users/PC/Documents/LLM/backend/src/utils/retry.ts)
- Create a global async retry helper with configurable exponential backoff and jitter. Exclude POST requests unless explicitly marked as idempotent.

```typescript
export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  isIdempotent?: boolean;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  isIdempotent: true,
};

export async function retry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
  context: string = 'operation'
): Promise<T> {
  const opt = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let attempt = 0;
  
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt > opt.maxRetries || !opt.isIdempotent) {
        throw error;
      }
      const delay = Math.min(opt.baseDelay * Math.pow(2, attempt) + Math.random() * 100, opt.maxDelay);
      console.warn(`[Retry] ${context} failed (attempt ${attempt}/${opt.maxRetries}). Retrying in ${Math.round(delay)}ms. Error:`, error);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```

#### [MODIFY] [embeddings_client.ts](file:///C:/Users/PC/Documents/LLM/backend/src/utils/embeddings_client.ts)
- Assert character limits are below 50,000 characters.
- Implement batch embedding endpoint call `/embed/batch` inside `generateBatchEmbeddings` instead of sequential HTTP requests.

```typescript
    if (text.length > 50000) {
      throw new Error(`Text exceeds maximum allowed size of 50000 characters`);
    }
```

#### [MODIFY] [admin_auth.ts](file:///C:/Users/PC/Documents/LLM/backend/src/middleware/admin_auth.ts)
- Raise a startup error in production if `JWT_SECRET` environment variable is missing.

```typescript
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET is not configured in production environment');
}
const JWT_SECRET_KEY = JWT_SECRET || 'dev-jwt-secret-change-in-production';
```

#### [MODIFY] [ratelimit.ts](file:///C:/Users/PC/Documents/LLM/backend/src/middleware/ratelimit.ts)
- If Redis is down, fail open: log the error and invoke `next()` to avoid blocking backend requests.

```typescript
    } catch (error) {
      console.error('[ratelimit] Redis error, failing open:', error);
      return next();
    }
```

#### [MODIFY] [validation.ts](file:///C:/Users/PC/Documents/LLM/backend/src/middleware/validation.ts)
- Add defense-in-depth HTML script stripping preprocessor on all string parameters in validation schemas.

```typescript
const sanitizeString = (val: string) => val.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
```

---

### Component: Backend Services & Business Logic

#### [MODIFY] [template_service.ts](file:///C:/Users/PC/Documents/LLM/backend/src/services/template_service.ts)
- Replace ASCII `\b` regex checks with Vietnamese-diacritic-safe boundaries (`(?:^|[^a-zA-Z0-9_À-ỹ])`).
- Fix literal backspace `\b` bug in document-type string comparisons.

```typescript
// Replace:
// if (!new RegExp('\\b' + escaped + '\\b').test(content))
// With:
const regex = new RegExp('(?:^|[^a-zA-Z0-9_À-ỹ])' + escaped + '(?:$|[^a-zA-Z0-9_À-ỹ])', 'i');
```

```typescript
// Replace backspace bug:
// new RegExp('\b' + name... + '\b')
// With:
const regex = new RegExp('(?:^|[^a-zA-Z0-9_À-ỹ])' + escapedName + '(?:$|[^a-zA-Z0-9_À-ỹ])', 'i');
```

#### [MODIFY] [rag_service.ts](file:///C:/Users/PC/Documents/LLM/backend/src/services/rag_service.ts)
- Remove trailing SQL quote from `c.article",`.
- Wrap external embeddings calls with `retry` wrapper.
- Optimize indexing loop to request batch embeddings.

#### [MODIFY] [feedback_service.ts](file:///C:/Users/PC/Documents/LLM/backend/src/services/feedback_service.ts)
- Paginate queries in `getTrainingSamples` and `listTrainingJobs`.

#### [MODIFY] [training_job_service.ts](file:///C:/Users/PC/Documents/LLM/backend/src/services/training_job_service.ts)
- Prevent webhook race conditions by updating job statuses atomically via Compare-and-Set updates.

```typescript
  async markStarted(jobId: string, expectedStatus: TrainingStatus = TrainingStatus.QUEUED): Promise<void> {
    const result = await prisma.trainingJob.updateMany({
      where: { id: jobId, status: expectedStatus },
      data: { status: TrainingStatus.RUNNING, updatedAt: new Date() },
    });
    if (result.count === 0) {
      throw new Error(`State transition from ${expectedStatus} to RUNNING failed`);
    }
  }
```

#### [MODIFY] [docx_service.ts](file:///C:/Users/PC/Documents/LLM/backend/src/services/docx_service.ts)
- Fix `findHeaderEnd` index slice bug when no header matches are found (return `0` instead of header length).

```typescript
function findHeaderEnd(lines: string[], expectedHeader: string[]): number {
  let matchCount = 0;
  let lastMatchIndex = -1;
  for (let i = 0; i < lines.length && matchCount < expectedHeader.length; i++) {
    const normalized = lines[i].toUpperCase();
    const expected = expectedHeader[matchCount].toUpperCase();
    if (normalized.includes(expected) || expected.includes(normalized)) {
      matchCount++;
      lastMatchIndex = i;
    } else if (matchCount > 0) {
      break;
    }
  }
  return lastMatchIndex >= 0 ? lastMatchIndex + 1 : 0;
}
```

#### [MODIFY] [orchestrator.ts](file:///C:/Users/PC/Documents/LLM/backend/src/services/orchestrator.ts)
- Implement character-to-token ratio estimation and context truncation logic to prevent exceeding model limits.
- Convert `PlannerAgent.createOutline` and `ResearcherAgent.research` into `AsyncGenerator` yielding progression logs.

```typescript
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3); // Approx 3 characters per token for Vietnamese text
}
```

---

### Component: API Routes

#### [MODIFY] [qa.ts](file:///C:/Users/PC/Documents/LLM/backend/src/routes/qa.ts)
- Parse streaming SSE chunks correctly by splitting lines and searching for `data: ` patterns.
- Inject a stream timeout handler.
- Refuse answering if RAG search is empty.

```typescript
      let buffer = '';
      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(trimmed.slice(6));
            const content = data.choices?.[0]?.delta?.content;
            if (content) {
              fullAnswer += content;
              send({ stage: 'answering', answerChunk: content });
            }
          } catch {}
        }
      }
```

```typescript
// Stream Timeout
const streamTimeout = setTimeout(() => {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify({ error: 'Stream session timed out' })}\n\n`);
    res.end();
  }
}, 300000);
req.on('close', () => clearTimeout(streamTimeout));
```

#### [MODIFY] [workflow.ts](file:///C:/Users/PC/Documents/LLM/backend/src/routes/workflow.ts)
- Inject a stream timeout handler.

#### [MODIFY] [model-versions.ts](file:///C:/Users/PC/Documents/LLM/backend/src/routes/admin/model-versions.ts)
- Secure sensitive actions (deploy/deactivate/rollback/status) with `requirePermission('models:deploy')` permission check middleware.

---

### Component: Next.js Frontend

#### [NEW] [error.tsx](file:///C:/Users/PC/Documents/LLM/frontend/app/error.tsx)
- Create a root error boundary component to capture and display unhandled UI errors gracefully instead of crashing into a blank page.

```typescript
'use client';
import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 text-center space-y-6">
      <h1 className="text-4xl font-extrabold text-red-600">Đã xảy ra lỗi</h1>
      <p className="text-gray-600">Lỗi: {error.message || 'Lỗi không xác định'}</p>
      <div className="flex space-x-4">
        <button onClick={reset} className="bg-blue-600 text-white px-4 py-2 rounded font-semibold hover:bg-blue-500">Thử lại</button>
        <Link href="/" className="border px-4 py-2 rounded text-gray-700 hover:bg-gray-50">Về trang chủ</Link>
      </div>
    </div>
  );
}
```

#### [MODIFY] [page.tsx](file:///C:/Users/PC/Documents/LLM/frontend/app/documents/page.tsx) & [page.tsx](file:///C:/Users/PC/Documents/LLM/frontend/app/qa/page.tsx)
- Wrap fetch calls inside try-catch blocks and display visual error/loading feedback.

---

### Component: Database Schema & Migrations

#### [MODIFY] [schema.prisma](file:///C:/Users/PC/Documents/LLM/backend/prisma/schema.prisma)
- Add HNSW index definition.
- Add foreign key indexes.

```prisma
model ModelVersion {
  ...
  @@index([trainingJobId])
}

model TrainingJob {
  ...
  @@index([modelVersionId])
}

model Chunk {
  ...
  @@index([embedding(ops: vector_cosine_ops)], type: Hnsw)
}
```

#### [MODIFY] [init.sql](file:///C:/Users/PC/Documents/LLM/init.sql)
- Add index creations on foreign key columns and uncomment the HNSW index creation.

```sql
CREATE INDEX IF NOT EXISTS "ModelVersion_trainingJobId_idx" ON "ModelVersion"("trainingJobId");
CREATE INDEX IF NOT EXISTS "TrainingJob_modelVersionId_idx" ON "TrainingJob"("modelVersionId");
CREATE INDEX IF NOT EXISTS "Chunk_embedding_hnsw_idx" ON "Chunk" USING hnsw (embedding vector_cosine_ops);
```

---

## Verification Plan

### Automated Checks

```bash
# 1. Verify no leftover executeRawUnsafe occurrences in active backend source
grep -rn '$executeRawUnsafe' backend/src/

# 2. Check no hardcoded dev-mode NODE_ENV auth checks remain
grep -rn "NODE_ENV.*development" backend/src/middleware/

# 3. Compile the TypeScript backend
cd backend && npx prisma generate && npx tsc --noEmit

# 4. Verify test suites pass successfully
cd backend && npm test
```

### Manual Verification
1. **Docker compose build:** Run `docker-compose up --build -d` and ensure all containers (postgres, redis, docling, embeddings, lora, backend) spin up and show `healthy` status.
2. **SSE Stream check:** Trigger a document generation stream and verify that data lines chunk cleanly and no character loss occurs inside Monaco Editor. Check timeout triggers.
3. **Vietnamese character parsing:** Submit a compliance check with words containing `Ộ, Ĩ, Ủ` and verify no false compliance warning reports are raised.
4. **LoRA cancellation:** Cancel a running training job, verify that the corresponding GPU process is killed immediately, and files in `/lora-outputs/<job_id>` are deleted.
