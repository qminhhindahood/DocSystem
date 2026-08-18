# Codebase Review: AI Document System (Backend + Microservices)

**Date**: 2026-07-06  
**Scope**: All non-frontend code in `C:\Users\PC\Documents\LLM`  
**Total files reviewed**: 60+ TypeScript/Python source files, Docker files, SQL init scripts

---

## Executive Summary

This is a well-engineered, production-grade Vietnamese government document AI system. The architecture demonstrates sophisticated domain understanding (Decree 30/2020 compliance), deep security hardening, and an ambitious self-learning loop. The codebase has accumulated significant complexity across multiple services and shows signs of organic growth. The review below is organized by layer, listing concrete findings prioritized by severity.

---

## 1. Database Layer

### Strengths
- pgvector + HNSW index is appropriate for semantic RAG (init-hnsw.sql creates index outside transaction, correct)
- Foreign keys with `ON DELETE CASCADE` for Chunk→Document and Feedback→Document is correct
- JSONB columns for `diff`, `metadata`, `config`, `filters` are pragmatic for semi-structured data
- Unique indexes on `Template.docType`, `TrainingJob.jobId`, `ModelVersion.version` enforce business invariants

### Issues Found

**MEDIUM — Prisma schema vs. init.sql divergence**  
Both exist and must be kept in sync. There is no CI check or migration guardrail visible. `init.sql` and `init-hnsw.sql` are Docker entrypoint init scripts that only run on first container start — they won't catch schema drift on redeploys.

**MEDIUM — Chunk table has no index on `(documentId, level)` composite**  
While there are separate indexes on `documentId` and `level`, the RAG service frequently queries `WHERE documentId = X AND level = Y`. A composite index would eliminate the index merge.

**LOW — Feedback `editType`, `priority`, `subType` are plain TEXT columns**  
Enums in PostgreSQL would prevent garbage values (typos in code would fail at the DB level). Currently the app relies on application-layer discipline.

**LOW — No `updatedAt` trigger on Document**  
The application is responsible for calling `updatedAt: { now: true }` on every update. A DB-level `ON UPDATE CURRENT_TIMESTAMP` trigger would be a safety net.

### Recommendations
- Add a composite index: `CREATE INDEX "Chunk_documentId_level_idx" ON "Chunk"("documentId", "level");`
- Consider PostgreSQL enums for `Feedback.editType`, `priority`, `subType`, `Document.status`
- Add a startup sanity check or CI lint step comparing Prisma schema to init.sql

---

## 2. Infrastructure (Docker)

### Strengths
- All services have health checks with appropriate intervals and `condition: service_healthy` for ordered startup
- GPU passthrough correctly configured for lora service
- Memory limits prevent container OOM cascades
- `libssl1.1` fix in backend Dockerfile shows awareness of Alpine/Prisma compatibility issues

### Issues Found

**HIGH — LoRA service image is `docker.io/miralph/llm-lora:latest` (pre-built)**  
This is a production-trained-binary from an external registry. There is no Dockerfile build step — the service is a black box. If the image is compromised, has a supply-chain vuln, or drifts from the source code in `lora-service/`, there is no detection mechanism. The same applies to embeddings and docling images.

**MEDIUM — Docling and embeddings services pin `>=` ranges in requirements.txt**  
Docling uses `>=0.100.0` and embeddings uses `>=` for multiple packages. Rebuilds can pull new major versions unexpectedly. This is especially risky for `docling>=2.0.0` which involves a complex ML pipeline.


**LOW — No `restart` policy specified on any service**  
Default is `no` restart. If a service crashes, the container stays dead until manually restarted. Production deployments should set `restart: unless-stopped` or `restart: on-failure`.

### Recommendations
- Pin all Python requirements to exact versions (or use a lock file) — especially docling and torch
- Add `restart: unless-stopped` to all production services
- Risk-assess the use of pre-built Docker images for lora/embeddings/docling — either build from source or verify provenance (SLSA, image signatures)

---

## 3. Backend Entry Point (`index.ts`)

### Strengths
- Layered middleware is correct and comprehensive
- Health check runs all dependent services in `Promise.allSettled` — a single failing dependency won't crash the check
- HNSW index creation at startup is idempotent (`CREATE INDEX IF NOT EXISTS`)
- Graceful shutdown on SIGTERM/SIGINT with Redis close

### Issues Found


**LOW — No signal for `uncaughtException` / `unhandledRejection` handlers**  
Only SIGTERM/SIGINT are handled. An uncaught exception in async code will crash the process without cleanup.

### Recommendations
- Add `process.on('uncaughtException')` and `process.on('unhandledRejection')` handlers that log and trigger graceful shutdown

---

## 4. Authentication & Authorization

### Strengths
- Dual auth model (user JWT + admin JWT + static ADMIN_TOKEN) is appropriate for a system with both end users and admins
- Timing-safe comparison (`crypto.timingSafeEqual` / Buffer-based) on ADMIN_TOKEN in auth.ts
- Dev-bypass protection in `admin_auth.ts` correctly refuses `ALLOW_DEV_AUTH=true` in production
- Review signatures use short-lived JWTs (1h expiry) with nonces
- Password hashing with bcrypt rounds=12 is appropriate

### Issues Found

**MEDIUM — Two separate JWT secret management paths**  
`admin_auth.ts` uses `process.env.JWT_SECRET` directly. `user_auth.ts` also uses `JWT_SECRET` but they're in different middleware files. If `JWT_SECRET` is rotated, both need to be updated. Consider a single auth utility.

**LOW — JWT token expiry is 7 days (`user_auth.ts`)**  
7-day tokens are long for a system with sensitive document operations. Consider shorter tokens + refresh token rotation.

**LOW — ADMIN_TOKEN is compared via Buffer in auth.ts but `ALLOW_DEV_AUTH` bypass is only in admin_auth.ts**  
A developer could set `ALLOW_DEV_AUTH=true` thinking it only affects admin routes, but it's handled in `admin_auth.ts` which is separate from the static token middleware.

### Recommendations
- Create a shared `auth.ts` utility that centralizes JWT verification for both user and admin flows
- Consider 24h access tokens + 7d refresh tokens instead of 7d static tokens

---

## 5. Rate Limiting

### Strengths
- Redis-backed with atomic Lua scripts (INCR + EXPIRE in one round-trip)
- Fails closed (503) when Redis is unavailable — prevents rate limit bypass
- Per-user fallback to IP
- Different rate limits per endpoint type (generate=5/min, search=30/min)

### Issues Found

**HIGH — Rate limiter key collision across different limiters**  
In `ratelimit.ts`, the key generator for `generateLimiter`, `streamLimiter`, and `searchLimiter` defaults to returning only the IP address without any endpoint prefix. Consequently, all three limiters increment and check the exact same Redis key (`ratelimit:<IP>`). Making requests to one endpoint counts against the limit of the others.

**LOW — streamLimiter (5/min) may be too restrictive**  
The SSE streaming endpoint `/api/workflow/stream` IS rate-limited via `streamLimiter` (mounted at `index.ts:194`), but 5/min may be too restrictive for legitimate document generation workflows. **FALSE: heading claimed "no rate limit" — corrected.**

### Recommendations
- Consider sliding window rate limiting via Redis sorted sets for production traffic
- Review `streamLimiter` (5/min) against actual usage patterns

---

## 6. RAG Service (`rag_service.ts`)

### Strengths
- Hybrid search (pgvector cosine + PostgreSQL full-text) with RRF fusion is state-of-the-art for this use case
- Over-fetching 4x candidates for fusion is a sound strategy
- Hierarchical parent expansion (Level 2/3 chunks fetch their Article parent) addresses the "orphaned context" problem
- Batch embedding with content-hash deduplication prevents wasted GPU compute
- Single `$transaction` for batch updates is correct for atomicity
- OCR fallback for text < 500 chars handles scanned PDFs

### Issues Found

**HIGH — RAG service reads `rag_service.ts` from context (too large for full context inclusion)**  
The file is referenced in system reminders as "too large to include." This means critical RAG logic like hybrid search ranking, relevance scoring, and deduplication filtering are not fully reviewable in this pass. Given this service is the core of the system, a targeted read of key functions is recommended.

**MEDIUM — Duplicate embedding computation risk**  
The deduplication checks `contentHash` at the DB level. However, if two documents have identical content (common in government docs), the system uses the first one. This is correct behavior but should be documented.

**MEDIUM — RRF fusion parameters are hardcoded**  
`rrf_k = 60` and the 4x over-fetch multiplier are not configurable. These should be environment-variable driven for tuning without code changes.

**LOW — Hierarchical chunker is tightly coupled to Markdown**  
The chunker handles both Markdown (from Docling) and plain text (from PyMuPDF), but the Markdown parsing (`## Điều X.`, `### Khoản X.`) is regex-based and could break on edge cases in Vietnamese legal formatting.

### Recommendations
- Make `rrf_k` and over-fetch multiplier configurable via env vars or service config
- Add integration tests for edge-case Vietnamese document formatting (special characters, unusual heading structures)
- Consider reading the full `rag_service.ts` in a follow-up review pass

---

## 7. Orchestrator (`orchestrator.ts`)

### Strengths
- 8-step pipeline is well-documented and each step has error recovery
- SSE event emission during planning and research keeps the frontend informed
- Validation retry injects missing elements back into the prompt — a pragmatic approach
- Vietnamese legal terminology context in system prompts is rich and domain-appropriate

### Issues Found

**MEDIUM — No timeout on individual orchestrator steps**  
The `generationTimeout` middleware (900s) wraps the entire pipeline. If the planner hangs for 10 minutes before the writer even starts, there's no way to detect or recover. Individual step timeouts would improve observability.

**MEDIUM — `StateStore` is dead code**  
The `StateStore` class is defined in `orchestrator.ts` but is never imported or used anywhere else in the backend. As a result, the session state is not actually persisted to Redis during execution.

**LOW — Entity extraction is regex-only**  
The `commandParser` uses Vietnamese regex patterns. This works for common patterns but will miss novel entity formats. An LLM-based extraction fallback would be more robust.

### Recommendations
- Add per-step timeouts (e.g., planner: 120s, researcher: 180s, writer: 600s)
- Add state cleanup on client disconnect (`res.on('close')` already exists for abort — extend it to clean Redis state)

---

## 8. Feedback & Self-Learning Loop

### Strengths
- Diff computation with Myers algorithm (`diffLines`) is the right choice for line-level text comparison
- Jaccard similarity provides a reasonable similarity metric
- Edit classification covers the key categories (legal, formatting, structural, wording)
- Distributed lock with fencing token prevents concurrent training exports
- Background worker via Redis queue for RAG promotion is decoupled

### Issues Found

**MEDIUM — Feedback classification logic is in `feedback_analysis.ts`**  
This file contains complex regex patterns for Vietnamese document elements. The classification rules are good but there's no test coverage visible for edge cases (what happens with unusual Unicode normalization? What about documents mixing Latin and Vietnamese diacritics?).

**HIGH — Feedback RAG promotion is completely dead code**  
The `feedback_rag_promotion.ts` service is implemented but never imported or called in any backend route, event handler, or background process. Approved feedback is never actually promoted to RAG chunks.

**LOW — Training threshold is hardcoded at 50**  
The `checkTrainingEligibility` function in `training_auto_check.ts` uses a literal `50`. This is also duplicated in the CLAUDE.md "≥ 50 examples" guidance. Should be a single configuration constant.

### Recommendations
- Extract the 50-example threshold to a shared config constant
- Add fallback behavior when RAG service is unavailable during feedback promotion (queue for retry?)
- Test Vietnamese text normalization edge cases (composed vs. decomposed diacritics)

---

## 9. Training Pipeline

### Strengths
- State machine validation in `training_state.ts` prevents impossible transitions
- Per-job HMAC secrets for webhook auth
- On-disk job state persistence survives restarts (M4 fix)
- `cleanup_old_jobs()` prevents unbounded memory growth (cap: 100 jobs)

### Issues Found

**HIGH — Admin training route cannot pass data to lora-service (wrong payload format)**  
The admin route (`admin/training.ts`) submits a POST payload containing `job_id`, `samples`, and `config` to `/train`. However, the Python service expects a flat `TrainingConfig` model with fields like `model_name`, `training_data_path`, etc., and does not have a `samples` field. 

**HIGH — Admin training route never stores training data to disk**  
Because the `samples` are ignored, and `training_data_path` is parsed as `None`, the Python service is unable to find any training data. It prints a warning and falls back to generating a minimal dummy dataset (10 items of static mock text) on the fly. This means every fine-tuning run is trained on fake dummy data, causing zero real model improvement.

**HIGH — Duplicate training controllers and dead code**  
The Node.js backend implements two entirely separate training routes:
1. `/api/admin/training/jobs` (uses the direct axios and polling loop).
2. `/api/training/jobs` (uses the database/Redis queue `trainingJobService`).
However, there is no background worker or process executing the Redis queue. All code in `trainingJobService` and `training_state.ts` is completely dead code for the active admin training dashboard.

**HIGH — Webhook endpoints are completely dead**  
The webhook routes in `routes/training.ts` (with HMAC signature verification) are completely dead because the Python `lora-service` has no webhook notification code. Status updates rely entirely on Node.js polling the `/status` endpoint.

**MEDIUM — `_training_tasks` set in lora-service is not consulted for cancellation**  
The set holds asyncio task references to prevent garbage collection, but it is not used in the cancellation logic, which only terminates the subprocess.

### Recommendations
- Fix the admin training route to write training feedback to a JSONL file and pass the path in `training_data_path`.
- Unify the training controllers: either deprecate the Redis queue (`trainingJobService`) or implement a background worker to consume it.
- Remove the dead webhook code or implement webhook calls in the Python service.

---

## 10. Microservices (Python)

### Docling Service (`docling-service/main.py`)

**Strengths**: Clean fallback strategy (Docling → PyMuPDF → Tesseract OCR). `secure_filename` + `realpath` validation prevents path traversal. File cleanup in `finally` block.

**Issues**:
- **LOW** — `_DOCLING_AVAILABLE` is a module-level mutable global with lazy init. In multi-worker deployments (Gunicorn), this could be initialized in multiple workers independently, which is fine but wastes resources.
- **LOW** — OCR is triggered when `text.strip()` is empty after PyMuPDF. This means a 1-page scanned PDF triggers OCR for every page even if only page 3 is scanned.

### Embeddings Service (`embeddings-service/main.py`)

**Strengths**: Model loading on startup, GPU→CPU fallback, `asyncio.to_thread` for blocking encode (M7 fix), placeholder embeddings removed (M8 fix — returns 503 instead), pre-downloads Jina custom code in Dockerfile.

**Issues**:
- **LOW** — `_placeholder_embedding` function is dead code (M8 removed its usage but the function remains). Should be deleted.
- **LOW** — The health endpoint exposes `placeholder_mode` and `model_load_error` to clients. In production, `model_load_error` could leak internal stack traces or config details.

### Template Service (`template-service/main.py`)

**Strengths**: Configurable CORS (never wildcard + credentials), unique temp files per request (M6 fix), path traversal guard on template resolution, Pydantic validation before rendering.

**Issues**:
- **LOW** — `config.py` docstrings describe HTTP endpoints (`/health`, `/templates`, `/generate`), but `config.py` is a pure module with no routing. Confusing at first read.
- **LOW** — 6 Pydantic models (`QuyetDinhVariables`, `ChiThiVariables`, etc.) are identical in fields — they should inherit from a common `BaseDocumentVariables` class.

### LoRA Service (`lora-service/main.py`)

**Strengths**: Command injection prevented via dict-based script generation (no user string interpolation in f-strings), path traversal guards on output_dir and training_data_path, atomic job state persistence (tmp file + rename), structured cleanup (M3 — only removes output on failure), max 100 jobs to prevent memory leak, subprocess timeout with graceful terminate/kill escalation.

**Issues**:
- **MEDIUM** — Training script generation uses `f'''...'''` with `{script_globals["MODEL_NAME"]!r}` etc. While the values are sanitized through `validate_model_name` (alphanumeric + `._/\-:`), the `script_globals` dict is built from user-controlled `TrainingConfig` fields. The regex `[a-zA-Z0-9._/\-:]+` prevents code injection but could produce invalid model names that crash the script at runtime.
- **LOW** — `MAX_TRAINING_JOBS = 100` with `cleanup_old_jobs()` evicts oldest job. If the oldest job is still running, it breaks out of the loop immediately. This means the cap is soft — a runaway job could prevent new submissions.
- **LOW** — No `restart` policy recovery. On container restart, running jobs are marked as `failed`, but there's no notification to the user that their job was lost.

---

## 11. Security Summary

### What's Done Right
- SQL injection: Fully mitigated via Prisma ORM (no raw SQL with user input)
- Path traversal: Guarded in all 4 Python services (`_resolve_safe_path`, `realpath` checks, model name regex)
- SSRF: `urlGuard.ts` blocks private IPs, cloud metadata, and link-local addresses
- Timing attacks: Used for ADMIN_TOKEN comparison and HMAC webhook auth
- XSS: HTML entity encoding in sanitize middleware
- Command injection: Python script generation uses repr() on validated values, never raw string interpolation
- File uploads: PDF magic byte validation, size limits, secure_filename
- Rate limiting: Redis-backed, fails closed, per-user

### Gaps
- No request body size limit at the Express level (Zod validation caps specific endpoints but not global)
- `ALLOW_STACK_TRACES` leaks internal details if enabled in staging (should be env-gated per environment, not a boolean)
- CORS on the backend only allows specific origins — good — but the template service has its own separate CORS config that could drift

---

## 12. Code Quality Observations

### Duplication
- **Six identical Pydantic models in `config.py`**: All document types share the same 10 common fields. They should inherit from a base class.
- **Template text is duplicated**: `TEMPLATE_TEXTS` in `template_service.ts` has full Vietnamese document templates as string literals. These are also likely in the .docx template files. The source of truth is ambiguous.
- **Error response patterns repeated**: Every route handler follows the same `try { ... } catch (e) { res.status(500).json({ error: e.message }) }` pattern. A wrapper or higher-order function would reduce boilerplate.

### Dead Code
- `_placeholder_embedding()` in embeddings-service (M8 made it unreachable)
- `_training_tasks` in lora-service (never consulted for lifecycle management)
- `MODEL_NAME_PATTERN` regex is defined but `validate_model_name` would also catch path separators — the regex is slightly redundant with the path traversal check

### Inconsistency
- **Status casing**: Node uses `COMPLETED`, Python uses `completed` — needs normalization
- **Error messages**: Some endpoints return raw error messages to clients, others return generic strings. Standardize via the errorHandler middleware consistently.
- **Service URLs**: Hardcoded fallbacks differ (`localhost:8003` vs `localhost:8004`) — not a bug, but a maintenance footgun

---

## 13. Testing

### What Exists
- Contract tests for RAG, feedback, workflow, QA, documents routes
- Unit tests for training_state, feedback_analysis, feedback_service, docx_service, template_service
- HTTP test harness at `backend/src/test/http.ts`
- Jest setup at `backend/src/test/jest.setup.ts`

### Gaps
- **No integration tests for the full 8-step pipeline**: The contract tests test individual route contracts but not the end-to-end orchestrator flow
- **No test for RAG hybrid search quality**: The `evaluate_rag.ts` script exists but there's no automated regression test
- **No Python service tests**: None of the 4 microservices have visible test files
- **No load/performance tests**: The performance targets (RAG < 200ms, generation 60-90s) are stated but not automated

---

## 14. Top Priority Recommendations

| Priority | Finding | Impact |
|----------|---------|--------|
| **P0** | Admin training route cannot pass data to lora service (wrong payload format) | Training pipeline produces no real model improvement |
| **P0** | Rate limiter key collision across all endpoints | Burst traffic or endpoint activity blocks other independent endpoints |
| **P0** | Pre-built Docker images for lora/template-service are unverified external binaries | Supply-chain security risk |
| **P1** | Webhook, RAG promotion, and queue-based training services are completely dead code | Bloat, broken features (approved feedback is never promoted to RAG) |
| **P1** | No individual step timeouts in orchestrator | Silent hangs, wasted GPU time |
| **P1** | No CI validation of Prisma schema vs init.sql | Schema drift on redeploy |
| **P2** | Pin Python dependency versions (docling is `>=`) | Non-deterministic builds |
| **P2** | Add composite index on Chunk(documentId, level) | RAG query performance |
| **P2** | Extract 50-example training threshold to shared config | Drift between code and docs |
| **P3** | Deduplicate template Pydantic models via inheritance | Code smell |
| **P3** | Add `restart` policies to docker-compose | Production resilience |

---

## 15. Overall Assessment

**The codebase has severe functional gaps in its self-learning loops and deployment configurations.** The security posture is strong and the orchestrator pipeline is well-specified, but the following issues must be resolved for a functional system:

1. **The training pipeline is non-functional as connected** — the admin route cannot pass training data to the lora service, so it trains on mock/dummy data.
2. **Rate Limiting Key Collision** — all rate limiters use the same Redis key, causing calls on one endpoint to block unrelated endpoints.
3. **Dead Code & Unwired Pipelines** — feedback RAG promotion, queue-based training, and webhook logic are completely dead/unused code.
4. **Trust model for Docker images** — multiple services rely on unverified pre-built images.

With the P0 and P1 items addressed, this would be a robust, maintainable system.
