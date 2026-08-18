# Fix Remaining Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Goal:** Fix all 14 remaining issues in the AI Document System backend and frontend
> **Architecture:** Backend fixes are independent and can be parallelized. Frontend changes depend on backend auth. Each task is self-contained with its own commit.
> **Tech Stack:** TypeScript, Express, Prisma, PostgreSQL+pgvector, Next.js, FastAPI, Python

---

## File Structure

| File | Change |
|------|--------|
| `backend/src/routes/admin/training.ts` | Fix SQL injection + replace simulated training |
| `backend/src/services/rag_service.ts` | Fix SQL syntax + fix regex + remove formdata-node |
| `backend/src/middleware/admin_auth.ts` | Fix dev auth bypass |
| `backend/src/middleware/errorHandler.ts` | Fix stack trace exposure |
| `backend/src/services/feedback_service.ts` | Replace simple diff |
| `backend/src/services/orchestrator.ts` | Add streaming to Planner/Researcher |
| `backend/src/routes/qa.ts` | Fix QA fallback text |
| `backend/src/utils/retry.ts` | **Create** — connection retry wrapper |
| `backend/.env` | Add `ALLOW_DEV_AUTH`, `ALLOW_STACK_TRACES` |
| `backend/.env.example` | Add new env vars |
| `init.sql` | Uncomment HNSW index |
| `backend/prisma/schema.prisma` | Uncomment HNSW index |
| `docling-service/main.py` | Add OCR fallback |
| `frontend/app/admin/login/page.tsx` | **Create** — admin login page |
| `frontend/lib/api.ts` | Add login API function + auth context |
| `frontend/app/layout.tsx` | Add auth provider |

---

### Task 1: Fix SQL Injection in Training Route (CRITICAL)

**Files:**
- Modify: `backend/src/routes/admin/training.ts:159-185`
- Test: Manual verification

- [ ] **Step 1: Replace `$executeRawUnsafe` with `prisma.modelVersion.create()`**

Replace the raw SQL INSERT in `createModelVersion()` with Prisma ORM call:

```typescript
// BEFORE (lines 159-185):
async function createModelVersion(jobId: string) {
  try {
    const job = await prisma.trainingJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    // Create model version record
    const modelVersion = await prisma.$executeRawUnsafe(`
      INSERT INTO "ModelVersion" (id, version, trainingJobId, status, createdAt, isActive)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT DO NOTHING
    `, uuidv4(), `v${new Date().toISOString().slice(0, 10)}`, jobId, 'active', new Date(), true);
    // ...
  }
}

// AFTER:
async function createModelVersion(jobId: string) {
  try {
    const job = await prisma.trainingJob.findUnique({ where: { id: jobId } });
    if (!job) return;

    const version = `v${new Date().toISOString().slice(0, 10)}-${jobId.slice(0, 8)}`;

    // Check if version already exists
    const existing = await prisma.modelVersion.findUnique({
      where: { version },
      select: { id: true },
    });
    if (existing) return;

    const modelVersion = await prisma.modelVersion.create({
      data: {
        version,
        baseModel: 'lora-finetuned',
        trainingJobId: jobId,
        status: 'candidate',
        isActivated: false,
        lmStudioModelName: `lora-${version}`,
      },
    });

    // Update job with model version reference
    await prisma.trainingJob.update({
      where: { id: jobId },
      data: { modelVersionId: modelVersion.id },
    });

    console.log(`[createModelVersion] Created model version ${modelVersion.version} for job ${jobId}`);
  } catch (error) {
    console.warn('[createModelVersion] Failed to create model version:', error);
    // Don't fail the training job if model version creation fails
  }
}
```

- [ ] **Step 2: Verify no other `$executeRawUnsafe` calls exist**

Run: `grep -rn '\$executeRawUnsafe' backend/src/`
Expected: No results (or only in test files)

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/admin/training.ts
git commit -m "fix: replace SQL injection in createModelVersion with Prisma ORM

Replace prisma.\$executeRawUnsafe() INSERT with prisma.modelVersion.create()
to eliminate SQL injection vulnerability in training route.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Fix SQL Syntax Error in RAG Search (CRITICAL)

**Files:**
- Modify: `backend/src/services/rag_service.ts:49`

- [ ] **Step 1: Fix the extra quote in SQL query**

```typescript
// BEFORE (line 49):
c.article",

// AFTER (line 49):
c.article,
```

The full corrected query block (lines 44-60):

```typescript
const chunks = await prisma.$queryRaw<Chunk[]>(Prisma.sql`
  SELECT
  c.id,
  c."documentId",
  c.level,
  c.article,
  c.clause,
  c.point,
  c.content,
  c."createdAt"
  FROM "Chunk" c
  JOIN "Document" d ON d.id = c."documentId"
  WHERE c.embedding IS NOT NULL
  ${docTypeFilter}
  ORDER BY c.embedding <=> ${queryVector}::vector
  LIMIT ${safeTopK}
`);
```

- [ ] **Step 2: Verify the fix compiles**

Run: `cd backend && npx tsc --noEmit src/services/rag_service.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/rag_service.ts
git commit -m "fix: correct SQL syntax error in RAG vector search query

Remove extra quote after c.article on line 49 that caused PostgreSQL
syntax error during vector similarity search.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Add Missing HNSW Index (CRITICAL)

**Files:**
- Modify: `init.sql:176`
- Modify: `backend/prisma/schema.prisma:176-177`

- [ ] **Step 1: Uncomment HNSW index in `init.sql`**

```sql
-- BEFORE (line 176, commented out):
-- Run: CREATE INDEX CONCURRENTLY idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);

-- AFTER (uncomment and add to the indexes section after line 148):
CREATE INDEX CONCURRENTLY idx_chunks_embedding_hnsw
  ON "Chunk" USING hnsw (embedding vector_cosine_ops);
```

- [ ] **Step 2: Add `@@index` for embedding in `schema.prisma`**

```prisma
// BEFORE (lines 49-51):
@@index([documentId])
@@index([level])
}

// AFTER:
@@index([documentId])
@@index([level])
@@index([embedding(ops: vector_cosine_ops)], type: Hash)
}
```

Note: Prisma's `vector_cosine_ops` support may vary by version. If the `ops` syntax isn't supported, use a plain `@@index([embedding])` and create the HNSW index via raw SQL migration instead.

- [ ] **Step 3: Generate Prisma migration**

Run: `cd backend && npx prisma migrate dev --name add-hnsw-index`
Expected: Migration file created with index addition

- [ ] **Step 4: Commit**

```bash
git add init.sql backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat: add HNSW index for vector similarity search

Uncomment HNSW index creation in init.sql and add @@index for embedding
column in Prisma schema. Dramatically improves RAG query performance.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Replace Simulated Training with Real LoRA Integration (CRITICAL)

**Files:**
- Modify: `backend/src/routes/admin/training.ts:89-154`
- Read: `lora-service/main.py` endpoints (already exists at port 8003)

- [ ] **Step 1: Add lora-service HTTP client function**

Replace the `simulateTrainingProgress` function and `startTrainingJob` with real HTTP calls to lora-service:

```typescript
// Add at top of file with other imports:
import axios from 'axios';

const LORA_SERVICE_URL = process.env.LORA_SERVICE_URL || 'http://localhost:8003';

// Replace startTrainingJob (lines 89-124) and simulateTrainingProgress (lines 129-154)
// with this implementation:
async function startTrainingJob(jobId: string, feedbackIds: string[], config: any) {
  try {
    // Update job status to RUNNING
    await prisma.trainingJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', totalEpochs: config.epochs },
    });
    await updateJobStatusInRedis(jobId, 'RUNNING', 0);

    console.log(`[TrainingJob] Starting training job ${jobId} with ${feedbackIds.length} feedback items`);

    // Submit training to lora-service
    const loraResponse = await axios.post(`${LORA_SERVICE_URL}/train`, {
      training_data_path: `/tmp/training-${jobId}.jsonl`,
      output_dir: `/models/lora/${jobId}`,
      epochs: config.epochs || 10,
      learning_rate: config.learningRate || 0.0001,
      batch_size: config.batchSize || 8,
      lora_r: config.loraR || 16,
      lora_alpha: config.loraAlpha || 32,
      target_modules: config.targetModules || ['q_proj', 'v_proj'],
    }, { timeout: 30000 });

    const loraJobId = loraResponse.data.job_id;

    // Poll for progress
    pollTrainingProgress(jobId, loraJobId);
  } catch (error) {
    console.error('[startTrainingJob] Failed to start training:', error);
    await prisma.trainingJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}

async function pollTrainingProgress(dbJobId: string, loraJobId: string) {
  const pollInterval = setInterval(async () => {
    try {
      const response = await axios.get(`${LORA_SERVICE_URL}/train/${loraJobId}`);
      const loraStatus = response.data;

      const progress = loraStatus.progress || 0;
      const status = mapLoraStatus(loraStatus.status);

      await prisma.trainingJob.update({
        where: { id: dbJobId },
        data: {
          status,
          progress,
          epoch: loraStatus.epoch || 0,
          currentLoss: loraStatus.current_loss,
        },
      });

      await updateJobStatusInRedis(dbJobId, status, progress);

      if (['completed', 'failed', 'cancelled'].includes(status)) {
        clearInterval(pollInterval);
        if (status === 'completed') {
          await createModelVersion(dbJobId);
        }
      }
    } catch (error) {
      console.error(`[pollTrainingProgress] Error polling job ${loraJobId}:`, error);
    }
  }, 5000); // Poll every 5 seconds
}

function mapLoraStatus(loraStatus: string): string {
  const statusMap: Record<string, string> = {
    'queued': 'QUEUED',
    'running': 'RUNNING',
    'training': 'TRAINING',
    'evaluating': 'EVALUATING',
    'completed': 'COMPLETED',
    'failed': 'FAILED',
    'cancelled': 'CANCELLED',
  };
  return statusMap[loraStatus] || 'RUNNING';
}
```

- [ ] **Step 2: Remove `simulateTrainingProgress` and old `createModelVersion`**

Delete the old `simulateTrainingProgress` function (lines 129-154) and replace `createModelVersion` with the version from Task 1.

- [ ] **Step 3: Verify lora-service is reachable**

Run: `curl http://localhost:8003/health`
Expected: `{"status":"healthy",...}`

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/admin/training.ts
git commit -m "feat: replace simulated training with real lora-service integration

Replace setTimeout-based simulation with HTTP calls to lora-service
(/train, /train/{jobId}) for actual LoRA fine-tuning orchestration.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Fix Dev Auth Bypass (SECURITY)

**Files:**
- Modify: `backend/src/middleware/admin_auth.ts:189,234,270,312,346`
- Modify: `backend/.env`
- Modify: `backend/.env.example`

- [ ] **Step 1: Add `ALLOW_DEV_AUTH` env var check**

Create a helper function and replace all 4 `NODE_ENV === 'development'` checks:

```typescript
// Add after line 53 (after JWT_EXPIRES_IN):
const ALLOW_DEV_AUTH = process.env.ALLOW_DEV_AUTH === 'true';

function devAuthEnabled(): boolean {
  return ALLOW_DEV_AUTH;
}
```

Replace all 4 occurrences of:
```typescript
if (process.env.NODE_ENV === 'development') {
```
with:
```typescript
if (devAuthEnabled()) {
```

Locations: lines 189, 234, 270, 312, 346 (5 occurrences total — `optionalAdmin` at line 312 also has it).

- [ ] **Step 2: Update `.env`**

```bash
# Add to backend/.env:
ALLOW_DEV_AUTH=false
```

- [ ] **Step 3: Update `.env.example`**

```bash
# Add to backend/.env.example:
# ALLOW_DEV_AUTH=false  # Set to true ONLY for local development
```

- [ ] **Step 4: Verify no remaining unconditional bypasses**

Run: `grep -n "NODE_ENV.*development" backend/src/middleware/admin_auth.ts`
Expected: No results

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/admin_auth.ts backend/.env backend/.env.example
git commit -m "security: replace unconditional dev auth bypass with ALLOW_DEV_AUTH flag

Dev mode no longer auto-authenticates. Requires explicit ALLOW_DEV_AUTH=true
env var. Defaults to false for security.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Create Admin Login Page

**Files:**
- Create: `frontend/app/admin/login/page.tsx`
- Modify: `frontend/lib/api.ts` (add login function)
- Modify: `frontend/app/layout.tsx` (add auth provider)

- [ ] **Step 1: Add login API function to `frontend/lib/api.ts`**

Add after the `setAuthToken`/`getAuthToken` functions (around line 491):

```typescript
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  user?: {
    userId: string;
    username: string;
    role: 'admin' | 'reviewer';
    permissions: string[];
  };
  error?: string;
}

export async function adminLogin(
  credentials: LoginRequest,
): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE}/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  const data = await response.json();
  if (data.token) {
    setAuthToken(data.token);
  }
  return data;
}

export async function adminLogout(): void {
  setAuthToken(null);
}
```

- [ ] **Step 2: Create `frontend/app/admin/login/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { adminLogin, LoginRequest } from '../../lib/api';
import { useRouter } from 'next/navigation';

export default function AdminLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await adminLogin({ username, password });
      if (result.success && result.token) {
        router.push('/admin/feedback');
      } else {
        setError(result.error || 'Login failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Admin Login</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              required
            />
          </div>
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add login link to navigation**

Modify `frontend/app/layout.tsx` to add admin login link (only visible when not authenticated):

```tsx
// Add to the nav links div:
<Link href="/admin/login" className="text-sm text-gray-600 hover:text-blue-600 transition-colors">
  Admin
</Link>
```

- [ ] **Step 4: Commit**

```bash
git add frontend/app/admin/login/page.tsx frontend/lib/api.ts frontend/app/layout.tsx
git commit -m "feat: add admin login page with JWT authentication

Create /admin/login page, add login/logout API functions, and add
admin link to navigation.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Fix Fragile Vietnamese Chunking Regex

**Files:**
- Modify: `backend/src/services/rag_service.ts:179`

- [ ] **Step 1: Replace the fragile regex with a more permissive pattern**

```typescript
// BEFORE (line 179):
const articleRegex = /(Điều\s+\d+[a-z]?\s*(?:về|thì|,\s*)?[^Hđ]*?)(?=Điều\s+\d+|$)/gi;

// AFTER:
// Match "Điều X" header + content up to next "Điều Y" or end of string
// [\s\S]*? is non-greedy match of any character including newlines
const articleRegex = /(Điều\s+\d+[a-z]?(?:\s*\.\s*\d+)?(?:\s*[–\-]\s*[^\n]*)?)[\s\S]*?(?=Điều\s+\d+|$)/gi;
```

The key change: `[^Hđ]*` → `[\s\S]*?` — the old pattern excluded any text containing `H` or `đ`, which broke on common Vietnamese words like "Hà Nội", "hành chính", "điều kiện", etc.

- [ ] **Step 2: Test the regex**

Run this in Node.js to verify:
```bash
node -e "
const text = 'Điều 1. Phạm vi điều chỉnh\nNội dung văn bản hành chính.\nĐiều 2. Đối tượng áp dụng\nNội dung khác.';
const regex = /(Điều\s+\d+[a-z]?(?:\s*\.\s*\d+)?(?:\s*[–\-]\s*[^\n]*)?)[\s\S]*?(?=Điều\s+\d+|$)/gi;
let m; while ((m = regex.exec(text)) !== null) console.log('---\n', m[0].substring(0, 50));
"
```
Expected: Two article matches with correct content

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/rag_service.ts
git commit -m "fix: replace fragile Vietnamese chunking regex

Replace [^Hđ]* pattern (which broke on common Vietnamese chars like
Hà, hành, điều) with [\\s\\S]*? non-greedy any-char match.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Add Streaming to Planner/Researcher

**Files:**
- Modify: `backend/src/services/orchestrator.ts:108-190`

- [ ] **Step 1: Convert `PlannerAgent.createOutline` to async generator**

```typescript
// BEFORE (lines 108-154):
async createOutline(prompt: string, docType?: string): Promise<string> {
  // ... non-streaming axios call
  return response.data.choices[0].message.content;
}

// AFTER:
async *createOutline(prompt: string, docType?: string): AsyncGenerator<string> {
  const templateInfo = docType ? getTemplateContent(docType) : '';
  const docTypeName = docType ? getDocumentTypeName(docType) : 'document';

  const systemPrompt = `You are a professional document planner...`; // same as before

  try {
    const response = await axios.post(
      `${LM_STUDIO_URL}/v1/chat/completions`,
      {
        model: LM_STUDIO_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `User request: ${prompt}\nDocument type: ${docType || 'Not specified'}` },
        ],
        stream: true,
        temperature: 0.7,
        max_tokens: 4096,
      },
      { responseType: 'stream', timeout: 120_000 },
    );

    for await (const chunk of response.data) {
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) yield content;
      if (chunk.choices?.[0]?.finish_reason === 'stop') return;
    }
  } catch (error) {
    console.error('Planner agent error:', error);
    throw error;
  }
}
```

- [ ] **Step 2: Convert `ResearcherAgent.research` to async generator with progress**

```typescript
// BEFORE (lines 168-190):
async research(outline: string, docType?: string): Promise<any[]> {
  // ... synchronous research
  return results.filter((r) => r !== null).map((r) => r?.data);
}

// AFTER:
async *research(outline: string, docType?: string): AsyncGenerator<any> {
  const topics = this.extractTopics(outline);

  yield { stage: 'researching', message: `Đang tìm kiếm ${topics.length} chủ đề...` };

  const results = await Promise.all(
    topics.map((topic) =>
      axios
        .post(`${this.ragUrl}/search`, { query: topic, topK: 3, docType })
        .catch((err) => {
          console.warn(`Research topic failed: ${topic}`, err.message);
          return null;
        }),
    ),
  );

  const validResults = results.filter((r) => r !== null).map((r) => r!.data);

  yield {
    stage: 'researching',
    message: `Đã tìm thấy ${validResults.length} kết quả nghiên cứu`,
    results: validResults,
  };
}
```

- [ ] **Step 3: Update callers in workflow route**

Check `backend/src/routes/workflow.ts` (or equivalent) for calls to `planner.createOutline()` and `researcher.research()`. Update to use `for await` loops:

```typescript
// BEFORE:
const outline = await planner.createOutline(prompt, docType);

// AFTER:
let outline = '';
for await (const chunk of planner.createOutline(prompt, docType)) {
  outline += chunk;
  // Optionally send progress to client via SSE
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/orchestrator.ts
git commit -m "feat: add streaming to Planner and Researcher agents

Convert createOutline() and research() to async generators with
progress callbacks for real-time UI updates.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Add OCR for Scanned PDFs

**Files:**
- Modify: `docling-service/main.py:76-112`

- [ ] **Step 1: Add Tesseract OCR fallback when PyMuPDF returns empty text**

```python
# Add import at top:
try:
    import pytesseract
    from PIL import Image
    import io as _io
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False

# Modify the parse_pdf function (around line 76-112):
# After PyMuPDF extraction, check if text is empty and try OCR:

# Try to import PyMuPDF for PDF parsing
try:
    import fitz  # PyMuPDF

    # Open PDF and extract text
    doc = fitz.open(file_path)
    text = ""
    page_count = len(doc)

    for page in doc:
        text += page.get_text()

    doc.close()

    # OCR fallback for scanned PDFs (empty text extraction)
    if not text.strip() and TESSERACT_AVAILABLE:
        logger.info(f'No text extracted from {safe_filename}, attempting OCR...')
        doc = fitz.open(file_path)
        text = ""
        for page_num, page in enumerate(doc):
            pix = page.get_pixmap(dpi=300)
            img_data = pix.tobytes("png")
            img = Image.open(_io.BytesIO(img_data))
            ocr_text = pytesseract.image_to_string(img, lang='vie+eng')
            text += f"\n--- Page {page_num + 1} ---\n{ocr_text}"
        doc.close()
        logger.info(f'OCR completed for {safe_filename}: {len(text)} chars extracted')
    elif not text.strip():
        logger.warning(f'No text extracted from {safe_filename} and Tesseract not available')

    return ParseResult(
        success=True,
        filename=safe_filename,
        text=text,
        tables=None,
        metadata={
            "pages": page_count,
            "parser": "PyMuPDF" + (" + Tesseract OCR" if not text.strip() and TESSERACT_AVAILABLE else ""),
            "ocr_used": not text.strip() and TESSERACT_AVAILABLE,
        }
    )

except ImportError:
    return ParseResult(...)  # same as before
```

- [ ] **Step 2: Add Tesseract to requirements**

```txt
# Add to docling-service/requirements.txt:
pytesseract>=0.3.10
Pillow>=10.0.0
```

- [ ] **Step 3: Commit**

```bash
git add docling-service/main.py docling-service/requirements.txt
git commit -m "feat: add Tesseract OCR fallback for scanned PDFs

When PyMuPDF returns empty text, fall back to OCR via pytesseract
with Vietnamese language support for scanned document parsing.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Fix QA "General Knowledge" Fallback

**Files:**
- Modify: `backend/src/routes/qa.ts:67`

- [ ] **Step 1: Replace fallback text**

```typescript
// BEFORE (line 67):
: 'Không tìm thấy tài liệu liên quan trong cơ sở dữ liệu. Trả lời dựa trên kiến thức chung.',

// AFTER:
: 'Không tìm thấy tài liệu liên quan trong cơ sở dữ liệu. Không thể trả lời câu hỏi này dựa trên các văn bản hiện có.',
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/routes/qa.ts
git commit -m "fix: update QA fallback to refuse answering without context

Change fallback from 'Trả lời dựa trên kiến thức chung' to clearly
state inability to answer without relevant documents.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Remove `formdata-node` Dependency

**Files:**
- Modify: `backend/src/services/rag_service.ts:4,94-98`
- Modify: `backend/package.json:25`

- [ ] **Step 1: Replace `formdata-node` imports with native APIs**

```typescript
// BEFORE (line 4):
import { FormData, Blob } from 'formdata-node';

// AFTER:
// Node.js 18+ has native FormData and Blob — no import needed
```

```typescript
// BEFORE (lines 94-98):
const formData = new FormData();
formData.append(
  'file',
  new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }),
  'document.pdf',
);

// AFTER:
const formData = new FormData();
formData.append('file', new Blob([Buffer.from(pdfBuffer)], { type: 'application/pdf' }), 'document.pdf');
```

- [ ] **Step 2: Remove from package.json**

Remove the line `"formdata-node": "^6.0.3",` from dependencies.

- [ ] **Step 3: Install and verify**

Run: `cd backend && npm install`
Expected: No errors, `formdata-node` removed from node_modules

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/rag_service.ts backend/package.json
git commit -m "chore: remove formdata-node dependency, use native FormData/Blob

Node.js 18+ includes native FormData and Blob. Replace formdata-node
imports with built-in globals and Buffer.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Add Connection Retry Logic

**Files:**
- Create: `backend/src/utils/retry.ts`

- [ ] **Step 1: Create retry utility**

```typescript
/**
 * Retry configuration options
 */
export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;      // Initial delay in ms
  maxDelay: number;       // Max delay in ms
  backoffFactor: number;  // Exponential backoff multiplier
  retryableStatuses?: number[]; // HTTP status codes to retry
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffFactor: 2,
  retryableStatuses: [502, 503, 504],
};

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = DEFAULT_RETRY_OPTIONS,
  context?: string,
): Promise<T> {
  let lastError: Error | unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on last attempt
      if (attempt === options.maxRetries) break;

      // Check if error is retryable
      if (error instanceof Error) {
        const axiosError = error as any;
        // Retry on network errors or specific HTTP status codes
        const isRetryable =
          !axiosError.response ||
          options.retryableStatuses?.includes(axiosError.response.status);

        if (!isRetryable) {
          throw error;
        }
      }

      const delay = Math.min(
        options.baseDelay * Math.pow(options.backoffFactor, attempt),
        options.maxDelay,
      );

      const contextMsg = context ? ` (${context})` : '';
      console.warn(
        `Retry attempt ${attempt + 1}/${options.maxRetries}${contextMsg} after ${delay}ms:`,
        error instanceof Error ? error.message : error,
      );

      await sleep(delay);
    }
  }

  throw lastError;
}
```

- [ ] **Step 2: Apply retry to external service calls**

In `rag_service.ts`, wrap the embeddings call:
```typescript
import { retry, DEFAULT_RETRY_OPTIONS } from '../utils/retry';

private async getEmbedding(text: string): Promise<number[]> {
  return retry(
    async () => {
      const response = await axios.post(`${EMBEDDINGS_URL}/embed`, { text, task_type: 'query' }, { timeout: 10000 });
      return response.data.embedding;
    },
    { ...DEFAULT_RETRY_OPTIONS, maxRetries: 3 },
    'embeddings-service',
  );
}
```

In `orchestrator.ts`, wrap LM Studio calls:
```typescript
import { retry } from '../utils/retry';

// In createOutline:
const response = await retry(
  async () => await axios.post(`${LM_STUDIO_URL}/v1/chat/completions`, ...),
  { ...DEFAULT_RETRY_OPTIONS, maxRetries: 2 },
  'lm-studio-planner',
);
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/utils/retry.ts backend/src/services/rag_service.ts backend/src/services/orchestrator.ts
git commit -m "feat: add connection retry logic with exponential backoff

Create retry utility for Redis, LM Studio, Embeddings, and Docling
service calls. Retries on network errors and 502/503/504 status codes.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: Fix Error Handler Stack Traces

**Files:**
- Modify: `backend/src/middleware/errorHandler.ts:14`

- [ ] **Step 1: Replace NODE_ENV check with explicit env var**

```typescript
// BEFORE:
import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error('[error]', err.message, { path: req.path, method: req.method });
  const statusCode = err.message.toLowerCase().includes('not found') ? 404 : 500;
  res.status(statusCode).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

// AFTER:
import { Request, Response, NextFunction } from 'express';

const ALLOW_STACK_TRACES = process.env.ALLOW_STACK_TRACES === 'true';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const is404 = err.message.toLowerCase().includes('not found');
  const statusCode = is404 ? 404 : 500;

  // Always log full error server-side
  console.error('[error]', err.message, {
    path: req.path,
    method: req.method,
    stack: err.stack,
  });

  // Never expose stack traces unless explicitly enabled
  const response: Record<string, unknown> = {
    error: is404 ? err.message : err.message || 'Internal server error',
  };

  if (ALLOW_STACK_TRACES) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}
```

- [ ] **Step 2: Add env var to `.env.example`**

```bash
# Add to backend/.env.example:
# ALLOW_STACK_TRACES=false  # Never enable in production
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/middleware/errorHandler.ts backend/.env.example
git commit -m "fix: strip stack traces from error responses by default

Replace NODE_ENV check with explicit ALLOW_STACK_TRACES env var.
Stack traces are never sent to clients unless ALLOW_STACK_TRACES=true.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Replace Simple Diff with Proper Algorithm

**Files:**
- Modify: `backend/src/services/feedback_service.ts:195-224`
- Modify: `backend/package.json` (add `diff` package)

- [ ] **Step 1: Install diff package**

Run: `cd backend && npm install diff`
Expected: `diff` package added to node_modules and package.json

- [ ] **Step 2: Replace `computeDiff` with proper diff algorithm**

```typescript
// BEFORE (lines 195-224):
computeDiff(original: string, edited: string): {
  additions: string[]; deletions: string[]; modifications: string[];
} {
  const originalLines = original.split('\n');
  const editedLines = edited.split('\n');
  const additions: string[] = []; const deletions: string[] = []; const modifications: string[] = [];
  const maxLen = Math.max(originalLines.length, editedLines.length);
  for (let i = 0; i < maxLen; i++) {
    const orig = originalLines[i] || '';
    const edit = editedLines[i] || '';
    if (orig && !edit) deletions.push(orig);
    else if (!orig && edit) additions.push(edit);
    else if (orig !== edit) modifications.push(`Line ${i + 1}: "${orig}" → "${edit}"`);
  }
  return { additions, deletions, modifications };
}

// AFTER:
import * as Diff from 'diff';

computeDiff(original: string, edited: string): {
  additions: string[];
  deletions: string[];
  modifications: string[];
  similarityScore: number;
} {
  const diff = Diff.diffLines(original, edited);
  const additions: string[] = [];
  const deletions: string[] = [];
  const modifications: string[] = [];
  let addedChars = 0;
  let removedChars = 0;

  for (const part of diff) {
    if (part.added) {
      additions.push(part.value.trim());
      addedChars += part.value.length;
    } else if (part.removed) {
      deletions.push(part.value.trim());
      removedChars += part.value.length;
    }
  }

  // Compute similarity score (Jaccard-like)
  const totalChanged = addedChars + removedChars;
  const totalOriginal = original.length || 1;
  const similarityScore = Math.max(0, 1 - totalChanged / (totalOriginal + totalChanged));

  return { additions, deletions, modifications, similarityScore };
}
```

- [ ] **Step 3: Add `diff` types to devDependencies**

Run: `cd backend && npm install -D @types/diff`
Expected: Types installed

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/feedback_service.ts backend/package.json
git commit -m "feat: replace line-based diff with Myers algorithm via diff package

Use the 'diff' library's diffLines() for proper line-level diffing with
added/removed/modified classification and similarity scoring.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Execution Order

| Priority | Tasks | Rationale |
|----------|-------|-----------|
| 1 | Task 1, 2, 3 | CRITICAL bugs — SQL injection, syntax error, missing index |
| 2 | Task 5, 13 | SECURITY — auth bypass, stack trace exposure |
| 3 | Task 4 | CRITICAL — simulated training must use real lora-service |
| 4 | Task 7, 11, 10 | Code quality — regex, dependency, fallback text |
| 5 | Task 12, 14 | Resilience — retry logic, proper diff |
| 6 | Task 8, 9, 6 | Features — streaming, OCR, login page |

Tasks within the same priority row can be done in parallel.

---

## Verification Checklist

After all tasks complete, verify:

```bash
# 1. No SQL injection patterns remain
grep -rn '\$executeRawUnsafe' backend/src/
# Expected: no results

# 2. No dev auth bypasses remain
grep -rn "NODE_ENV.*development" backend/src/middleware/
# Expected: no results

# 3. No formdata-node imports remain
grep -rn 'formdata-node' backend/src/
# Expected: no results

# 4. No simulateTrainingProgress references remain
grep -rn 'simulateTrainingProgress' backend/src/
# Expected: no results

# 5. HNSW index present in schema
grep -n 'hnsw\|HNSW' backend/prisma/schema.prisma init.sql
# Expected: both files have HNSW index

# 6. Retry utility exists
ls backend/src/utils/retry.ts
# Expected: file exists

# 7. Admin login page exists
ls frontend/app/admin/login/page.tsx
# Expected: file exists

# 8. Backend compiles
cd backend && npx tsc --noEmit
# Expected: no errors

# 9. All tests pass
cd backend && npm test
# Expected: tests pass (or skip if none exist)
```

---

Plan complete and saved to `docs/superpowers/plans/2026-06-08-fix-remaining-issues.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
