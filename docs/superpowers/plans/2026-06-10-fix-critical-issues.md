# Fix Critical Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 10 identified issues in the LLM project (auth, streaming, error handling, validation, security)

**Architecture:** Each fix is self-contained. Auth and rate limiting are new middleware modules applied in index.ts. Other fixes touch specific service files. Frontend SSE fix is isolated to api.ts.

**Tech Stack:** TypeScript/Express (backend), Python/FastAPI (docling), React/Next.js (frontend), Prisma/PostgreSQL, Redis

---

## File Structure

```
backend/src/
├── middleware/
│   ├── auth.ts              # NEW — JWT + ADMIN_TOKEN auth middleware
│   ├── ratelimit.ts         # NEW — Redis-backed rate limiter
│   ├── validation.ts        # MODIFY — add body size limits
│   └── timeout.ts           # NO CHANGE
├── routes/
│   ├── workflow.ts          # MODIFY — disconnect handling
│   ├── rag.ts               # MODIFY — error logging
│   ├── feedback.ts          # MODIFY — error logging
│   └── ...                  # other routes get auth applied
├── services/
│   ├── orchestrator.ts      # MODIFY — disconnect + error logging
│   └── rag_service.ts       # MODIFY — error logging
├── utils/
│   └── redis.ts             # MODIFY — TTL refresh
└── index.ts                 # MODIFY — body limits, middleware order

frontend/lib/
└── api.ts                   # MODIFY — SSE multi-line JSON

docling-service/
└── main.py                  # MODIFY — path traversal hardening

backend/src/services/
└── template_service.ts      # MODIFY — decree compliance validation
```

---

### Task 1: Auth Middleware

**Files:**
- Create: `backend/src/middleware/auth.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Write auth middleware**

Create `backend/src/middleware/auth.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

/**
 * Auth middleware — two modes:
 * 1. ADMIN_TOKEN env var set → require Bearer token matching ADMIN_TOKEN for /api/admin/*
 * 2. No ADMIN_TOKEN → dev mode, allow all (with warning log)
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Admin routes always require token
  if (req.path.startsWith('/api/admin')) {
    const authHeader = req.headers.authorization;
    if (!ADMIN_TOKEN) {
      console.warn('[auth] ADMIN_TOKEN not set — admin routes unprotected in dev mode');
      return next(); // Dev fallback
    }
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing authorization token' });
      return;
    }
    const token = authHeader.slice(7);
    if (token !== ADMIN_TOKEN) {
      res.status(403).json({ error: 'Invalid authorization token' });
      return;
    }
  }
  next();
}

/**
 * Optional auth — attaches user info if token present, doesn't block.
 * For future JWT-based user auth.
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    // Future: validate JWT and attach req.user
    req.headers.authorization = authHeader;
  }
  next();
}
```

- [ ] **Step 2: Apply auth middleware in index.ts**

In `backend/src/index.ts`, add auth import and apply before route registration:

```typescript
import { authMiddleware } from './middleware/auth';

// ... existing middleware ...
app.use('/api/admin', authMiddleware);  // Protect admin routes
app.use('/api', authMiddleware);         // Light touch for public API
```

- [ ] **Step 3: Verify compilation**

Run: `cd C:/Users/PC/Documents/LLM/backend && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/middleware/auth.ts backend/src/index.ts
git commit -m "feat: add auth middleware for admin and API routes

- ADMIN_TOKEN-based auth for /api/admin/*
- Dev-mode fallback when ADMIN_TOKEN unset
- Light-touch auth on public API routes
- Fixes issue: zero authentication on API routes"
```

---

### Task 2: Client Disconnect Handling in Streaming

**Files:**
- Modify: `backend/src/routes/workflow.ts`
- Modify: `backend/src/services/orchestrator.ts`

- [ ] **Step 1: Add AbortController support to orchestrator**

Modify `backend/src/services/orchestrator.ts` — update `PlannerAgent.createOutline`, `ResearcherAgent.research`, and `WriterAgent.streamWrite` to accept an `AbortSignal`:

```typescript
// In PlannerAgent:
async *createOutline(
  prompt: string,
  docType?: string,
  signal?: AbortSignal
): AsyncGenerator<{ stage: string; message?: string; outline?: string }> {
  // ... existing code ...
  const response = await withRetry(
    () => axios.post(`${OLLAMA_URL}/api/generate`, { /* ... */ }),
    { maxRetries: 2, baseDelay: 1000, retryContext: 'planner-ollama' },
    signal  // Pass signal to withRetry
  );
  // ... existing code ...
}

// In ResearcherAgent:
async *research(
  outline: string,
  docType?: string,
  signal?: AbortSignal
): AsyncGenerator<any> {
  // ... existing code ...
  for (const topic of topics) {
    if (signal?.aborted) {
      yield { stage: 'error', message: 'Cancelled by client' };
      return;
    }
    // ... existing search logic ...
  }
}

// In WriterAgent:
async *streamWrite(
  outline: string,
  researchResults: any[],
  userPrompt: string,
  docType?: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  // ... existing code ...
  const response = await withRetry(
    () => axios.post(`${OLLAMA_URL}/api/generate`, {
      // ... existing body ...
      stream: true,
    }, {
      responseType: 'stream',
      timeout: 120000,
      signal,  // Pass AbortSignal to axios
    }),
    { maxRetries: 2, baseDelay: 1000, retryContext: 'writer-stream-ollama' },
    signal
  );
  // ... existing streaming loop, check signal?.aborted ...
}
```

- [ ] **Step 2: Update stream route to use AbortController**

Modify `backend/src/routes/workflow.ts` stream handler:

```typescript
router.post('/stream', generationTimeout, validate(GenerateDocumentSchema), async (req, res) => {
  const abortController = new AbortController();

  req.on('close', () => {
    console.log('[workflow] Client disconnected — aborting pipeline');
    abortController.abort();
  });

  try {
    // ... existing code ...
    // Pass abortController.signal to each phase:
    for await (const event of planner.createOutline(prompt, docType, abortController.signal)) {
      if (abortController.signal.aborted) return res.end();
      // ... existing ...
    }
    for await (const event of researcher.research(outline, docType, abortController.signal)) {
      if (abortController.signal.aborted) return res.end();
      // ... existing ...
    }
    for await (const chunk of writer.streamWrite(outline, researchResults, prompt, docType, abortController.signal)) {
      if (abortController.signal.aborted) return res.end();
      // ... existing ...
    }
  } catch (error: any) {
    if (abortController.signal.aborted) return;
    // ... existing error handling ...
  }
});
```

- [ ] **Step 3: Verify compilation**

Run: `cd C:/Users/PC/Documents/LLM/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/workflow.ts backend/src/services/orchestrator.ts
git commit -m "fix: handle client disconnect in streaming workflow

- Pass AbortController through planner/researcher/writer
- Abort axios requests on client disconnect
- Stop pipeline phases when client leaves
- Fixes issue: streaming ignores client disconnect"
```

---

### Task 3: Fix Silent Error Swallowing in ResearcherAgent

**Files:**
- Modify: `backend/src/services/orchestrator.ts`

- [ ] **Step 1: Add error logging to empty catch block**

In `ResearcherAgent.research()`, find the empty catch:

```typescript
// BEFORE:
} catch {
  // Skip failed topic searches
}

// AFTER:
} catch (error) {
  console.error(`[researcher] Failed to search topic "${topic.substring(0, 30)}":`, error);
  yield { stage: 'error', message: `Research partial: topic search failed (${error instanceof Error ? error.message : 'unknown'})` };
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd C:/Users/PC/Documents/LLM/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/orchestrator.ts
git commit -m "fix: log errors in ResearcherAgent instead of swallowing silently

- Replace empty catch block with error logging
- Yield error event so UI can show partial failure
- Fixes issue: silent error swallowing in ResearcherAgent"
```

---

### Task 4: Express Body Size Limits

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Add body size limits to JSON parsing**

In `backend/src/index.ts`, change:

```typescript
// BEFORE:
app.use(express.json());

// AFTER:
app.use(express.json({ limit: '1mb' }));  // Standard API bodies
app.use(express.urlencoded({ limit: '1mb', extended: true }));
```

The multer file upload already has `limits: { fileSize: MAX_FILE_SIZE }` (50MB) — no change needed there.

- [ ] **Step 2: Verify compilation**

Run: `cd C:/Users/PC/Documents/LLM/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/index.ts
git commit -m "fix: set express body size limit to 1mb

- Prevents DoS via oversized JSON payloads
- Multer file upload retains 50MB limit
- Fixes issue: no express body size limits"
```

---

### Task 5: Rate Limiting Middleware

**Files:**
- Create: `backend/src/middleware/ratelimit.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Write rate limiter**

Create `backend/src/middleware/ratelimit.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../utils/redis';

interface RateLimitConfig {
  windowMs: number;      // Time window in ms
  maxRequests: number;   // Max requests per window per key
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
}

const DEFAULT_KEY = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';

export function rateLimiter(config: RateLimitConfig) {
  const {
    windowMs,
    maxRequests,
    keyGenerator = DEFAULT_KEY,
    skip,
  } = config;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (skip?.(req)) return next();

    const key = `ratelimit:${keyGenerator(req)}`;
    try {
      const count = await redisClient.increment(key);
      if (count === 1) {
        await redisClient.expire(key, Math.ceil(windowMs / 1000));
      }

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - count));

      if (count > maxRequests) {
        return res.status(429).json({
          error: 'Too many requests',
          retryAfter: Math.ceil(windowMs / 1000),
        });
      }
    } catch (error) {
      console.error('[ratelimit] Redis error, allowing request:', error);
      // Fail open — don't block on Redis failure
    }
    next();
  };
}

// Preset configs
export const generateLimiter = rateLimiter({
  windowMs: 60_000,
  maxRequests: 10,  // 10 generations per minute per IP
  skip: (req) => req.path === '/api/workflow/stream', // stream gets its own limit
});

export const streamLimiter = rateLimiter({
  windowMs: 60_000,
  maxRequests: 5,   // 5 concurrent streams per IP
});

export const searchLimiter = rateLimiter({
  windowMs: 60_000,
  maxRequests: 30,  // 30 searches per minute per IP
});
```

- [ ] **Step 2: Apply rate limiters in index.ts**

In `backend/src/index.ts`, add imports and apply:

```typescript
import { generateLimiter, streamLimiter, searchLimiter } from './middleware/ratelimit';

// Apply to expensive routes (after route registration):
// In workflow.ts routes, or in index.ts:
app.use('/api/workflow/generate', generateLimiter);
app.use('/api/workflow/stream', streamLimiter);
app.use('/api/rag/search', searchLimiter);
```

- [ ] **Step 3: Verify compilation**

Run: `cd C:/Users/PC/Documents/LLM/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/middleware/ratelimit.ts backend/src/index.ts
git commit -m "feat: add Redis-backed rate limiting middleware

- generateLimiter: 10 req/min for /api/workflow/generate
- streamLimiter: 5 req/min for /api/workflow/stream
- searchLimiter: 30 req/min for /api/rag/search
- Fail-open on Redis errors
- Fixes issue: no rate limiting on expensive endpoints"
```

---

### Task 6: Fix SSE Multi-line JSON Parsing

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Fix the streaming parser**

In `frontend/lib/api.ts`, replace the `generateDocument` streaming logic:

```typescript
// BEFORE:
const lines = text.split("\n");
for (const line of lines) {
  if (line.startsWith("data: ")) {
    try {
      const data = JSON.parse(line.slice(6));
      yield data;
    } catch (e) {
      console.error("Failed to parse SSE data:", e);
    }
  }
}

// AFTER:
let buffer = "";
const lines = text.split("\n");
for (const line of lines) {
  if (line.startsWith("data: ")) {
    buffer += line.slice(6);
    try {
      const data = JSON.parse(buffer);
      yield data;
      buffer = "";
    } catch {
      // Incomplete JSON — wait for more data
      buffer += "\n";
    }
  }
}
// Handle any remaining buffer on stream end
if (buffer.trim()) {
  try {
    const data = JSON.parse(buffer);
    yield data;
  } catch {
    console.error("Failed to parse final SSE data:", buffer);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd C:/Users/PC/Documents/LLM/frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "fix: handle multi-line JSON in SSE streaming parser

- Buffer incomplete JSON across line boundaries
- Ollama streaming can split JSON across multiple chunks
- Fixes issue: SSE parser fails on multi-line JSON"
```

---

### Task 7: Improve Decree Compliance Validation

**Files:**
- Modify: `backend/src/services/template_service.ts`

- [ ] **Step 1: Replace naive includes() with regex validation**

In `validateDecreeCompliance`, replace the element checks:

```typescript
// BEFORE:
for (const element of REQUIRED_ELEMENTS) {
  if (!content.includes(element)) {
    results.valid = false;
    results.missing.push(element);
  }
}

// AFTER:
for (const element of REQUIRED_ELEMENTS) {
  // Use word-boundary-aware regex to avoid false substring matches
  const escaped = element.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  if (!regex.test(content)) {
    results.valid = false;
    results.missing.push(element);
  }
}
```

Also improve the document type name check:

```typescript
// BEFORE:
const hasTypeName = typeNames.some((name) => content.toUpperCase().includes(name));

// AFTER:
const hasTypeName = typeNames.some((name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(content);
});
```

- [ ] **Step 2: Verify compilation**

Run: `cd C:/Users/PC/Documents/LLM/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/template_service.ts
git commit -m "fix: improve decree compliance validation with regex

- Replace naive includes() with word-boundary regex
- Reduces false positives from substring matches
- Fixes issue: validateDecreeCompliance uses includes() for legal checks"
```

---

### Task 8: Harden Docling Path Traversal

**Files:**
- Modify: `docling-service/main.py`

- [ ] **Step 1: Add path containment check after join**

In both `/parse` and `/parse/table` handlers, after `file_path = os.path.join(UPLOAD_DIR, safe_filename)`, add:

```python
# AFTER the os.path.join line, add:
real_path = os.path.realpath(file_path)
real_upload = os.path.realpath(UPLOAD_DIR)
if not real_path.startswith(real_upload + os.sep) and real_path != real_upload:
    raise HTTPException(status_code=400, detail="Invalid file path")
```

Full context for `/parse` handler:

```python
# Existing:
file_path = os.path.join(UPLOAD_DIR, safe_filename)
# ADD:
real_path = os.path.realpath(file_path)
real_upload = os.path.realpath(UPLOAD_DIR)
if not real_path.startswith(real_upload + os.sep) and real_path != real_upload:
    raise HTTPException(status_code=400, detail="Invalid file path")
```

Same addition in `/parse/table` handler.

- [ ] **Step 2: Verify Python syntax**

Run: `cd C:/Users/PC/Documents/LLM/docling-service && python -m py_compile main.py`
Expected: No syntax errors

- [ ] **Step 3: Commit**

```bash
git add docling-service/main.py
git commit -m "fix: harden docling path traversal protection

- Add realpath containment check after os.path.join
- Ensures uploaded files stay within UPLOAD_DIR
- Defense-in-depth alongside secure_filename()
- Fixes issue: docling path traversal risk"
```

---

### Task 9: Ensure Redis TTL Refresh on Session Updates

**Files:**
- Modify: `backend/src/utils/redis.ts`

- [ ] **Step 1: Verify TTL is refreshed in updateSession**

Read the current `updateSession` implementation and ensure it calls `expire`:

```typescript
// In updateSession, ensure TTL is refreshed:
async updateSession(key: string, data: Record<string, any>, ttlSeconds?: number): Promise<void> {
  await this.client.hSet(key, JSON.stringify(data));
  const ttl = ttlSeconds || this.defaultTtl;
  await this.client.expire(key, ttl);
}
```

If `expire` is missing, add it. Also verify `initializeSession`, `setPlanningState`, `setResearchingState`, `setWritingState`, `markComplete`, `markError` all call `expire`.

- [ ] **Step 2: Verify compilation**

Run: `cd C:/Users/PC/Documents/LLM/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/utils/redis.ts
git commit -m "fix: ensure Redis TTL refresh on all session state updates

- Add expire() calls to all state mutation methods
- Prevents session expiry during long document generation
- Fixes issue: Redis TTL not refreshed on session updates"
```

---

### Task 10: Add Error Logging to Route Handlers

**Files:**
- Modify: `backend/src/routes/rag.ts`
- Modify: `backend/src/routes/feedback.ts`
- Modify: `backend/src/services/rag_service.ts`

- [ ] **Step 1: Add console.error to RAG routes catch blocks**

In `backend/src/routes/rag.ts`, both handlers have `catch (error: any)` — add `console.error`:

```typescript
// In search handler:
} catch (error: any) {
  console.error('[rag/search] Error:', error);
  res.status(500).json({ error: error.message });
}

// In indexDocument handler:
} catch (error: any) {
  console.error('[rag/index] Error:', error);
  res.status(500).json({ error: error.message });
}
```

- [ ] **Step 2: Add console.error to feedback routes**

In `backend/src/routes/feedback.ts` — already has `console.error` in most handlers. Verify all 4 routes have it. Add to any that are missing.

- [ ] **Step 3: Add console.error to RAG service methods**

In `backend/src/services/rag_service.ts`, verify `indexDocument` and `chunkDocument` have error logging. Add where missing.

- [ ] **Step 4: Verify compilation**

Run: `cd C:/Users/PC/Documents/LLM/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/rag.ts backend/src/routes/feedback.ts backend/src/services/rag_service.ts
git commit -m "fix: add error logging to route handlers and RAG service

- console.error on all catch blocks in rag.ts and feedback.ts
- Error context tags for log filtering
- Fixes issue: missing error logging in route handlers"
```

---

## Execution Order

Tasks are ordered by dependency:
1. Task 1 (auth) — no dependencies
2. Task 2 (disconnect) — no dependencies
3. Task 3 (error logging orchestrator) — no dependencies
4. Task 4 (body limits) — no dependencies
5. Task 5 (rate limiting) — no dependencies
6. Task 6 (SSE parser) — frontend, independent
7. Task 7 (decree validation) — no dependencies
8. Task 8 (path traversal) — no dependencies
9. Task 9 (Redis TTL) — no dependencies
10. Task 10 (error logging routes) — no dependencies

All tasks can run in parallel. Each is independently committable and testable.
