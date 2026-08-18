# LLM Project Review & Improvement Plan
*Generated 2026-07-03 — comprehensive audit across backend, frontend, infra, and Python services.*

This document consolidates every verified finding into a ranked list and a phased implementation plan. Review it, then approve (or edit) before implementation begins.

---

## How this was produced
Four parallel read-only audits: (1) backend core services, (2) routes & middleware, (3) utils/schema/Python services, (4) frontend+infra (this one failed at the provider; the critical frontend files — API proxy, package.json, api.ts, init SQL — were read directly). ~100 raw findings, deduplicated and ranked below.

---

## Part 1 — Findings (ranked, most severe first)

### 🔴 CRITICAL — fix before any deployment

**S1. Real secrets committed in `backend/.env`.**
`.env` ships `DATABASE_URL` password `meomeo`, a live `LM_STUDIO_API_KEY`, `JWT_SECRET="dev-jwt-secret-do-not-use-in-production"`, and the `LLM_CONFIG_ENCRYPTION_KEY`. If the repo was pushed to a remote (GitLab MR !2 per session memory), all of these are leaked. Rotate every one. Move `.env` to `.env.example` with placeholders, gitignore `.env`, and purge history (`git filter-repo` / BFG) if pushed.

**S2. Dev-auth bypass is live: `ALLOW_DEV_AUTH="true"` + `NODE_ENV="development"`.**
`backend/.env:13` and `middleware/admin_auth.ts:204-214` + `user_auth.ts:37-44`: when this flag is on, **every** admin and user middleware short-circuits and injects a full `admin`/`reviewer` identity (`userId: 'dev-user'`) for all requests — `/api/admin/*`, `/api/settings/llm`, `/api/training/*`. The entire RBAC system is void as shipped. Set `ALLOW_DEV_AUTH="false"`; enforce in `validateEnv` (reject `ALLOW_DEV_AUTH==="true"` when `NODE_ENV==="production"`).

**S3. [RESOLVED] Two admin routers are fully implemented but never mounted.**
*(Update from code review: This was already resolved. `index.ts:195-196` correctly mounts `adminFeedbackRoutes` and `adminTrainingRoutes` under `/api/admin`. This is no longer a bug.)*

**S4. No HNSW index on the Prisma migration path.**
`init-hnsw.sql` *does* create the index. However, the README quickstart tells users to run `npx prisma migrate dev`, whose `migration.sql` creates `embedding vector(1024)` with **no** vector index. Currently, `index.ts` works around this by running `CREATE INDEX CONCURRENTLY` on startup, but this is bad practice for a migration. Add an HNSW index migration to the canonical Prisma path.

**S5. Template table drift between init.sql and schema.prisma.**
`init.sql` creates `CREATE TABLE "Template" (...)` with `Template_docType_key` unique index; `schema.prisma` has **no** `Template` model. `prisma migrate dev` on a fresh DB diverges from an existing DB; `migrate reset`/`db push` would drop the table. Either re-add the model (if template logic stays in Postgres) or add a migration dropping it (if it moved to the Python `template-service`). Currently `docx_service`/`template_service` live outside this table, so it's likely orphaned.

**S6. Prompt-injection + retrieval-poisoning in `workflow.ts` and `qa.ts`.**
`workflow.ts:214,231,246,253` interpolates the raw user `prompt` into LLM calls with no delimiter/role separation. `qa.ts:109,123-126` concatenates retrieved DB chunks (up to 1500 chars each) directly into the `systemPrompt` string and uses the user `question` as the retrieval query. A poisoned uploaded PDF can inject instructions into the system prompt. The README claims "JSON only, LLM never sees markdown" — violated here. Wrap untrusted content in delimiters and treat as data, not instructions; pass QA context as a distinct structured message, not concatenated text.

**S7. `structured_output_service.ts:245-249` leaks LLM raw output to the API client on JSON parse failure.**
The error message includes `raw.substring(0, 200)` of LLM-generated text → prompt-injection exfiltration vector. `workflow.ts` returns `error.message` verbatim to the client. Log the snippet server-side only; return a generic message to the client.

**S8. `feedback_rag_promotion.ts:174-206` creates one Document per chunk.**
RAG promotion calls `prisma.document.create` **per chunk**, so a 10-chunk approved feedback becomes 10 fake `Document` rows titled `Approved feedback <8chars>`, all indexed and returned by vector search. Fragments a single source across fake documents, corrupts RAG quality, contradicts the hierarchical-RAG design. Create **one** Document per feedback, attach all chunks to it.

**S9. RAG promotion worker destructively pops jobs → lost work on crash.**
`feedback_rag_promotion.ts:252-278` does `rPop` (destructive) then processes. A crash between pop and `createDocumentWithChunk` permanently loses the promotion job; a poison JSON message is consumed and destroyed. Use a reliable queue (Redis Streams with consumer groups, or `BRPOPLPUSH` to a processing list with ack/requeue).

**S10. `docling-service/Dockerfile` missing `curl` → perpetual "unhealthy".**
The Dockerfile apt-installs `tesseract-ocr` but not `curl`; the `HEALTHCHECK` and `docker-compose.yml` both call `curl -f http://localhost:8001/health`. Exit 127 every interval → container stuck unhealthy, and any `depends_on: { condition: service_healthy }` blocks. Add `curl` to the install list.

**S11. Hard `throw` at module import if `LM_STUDIO_MODEL` unset → server won't boot.**
`orchestrator.ts:13-17` and `qa.ts:14-17` throw at import time. Express imports run before `validateEnv()` (`index.ts:27`), so a missing model name crashes the whole process with a qa-specific message. (Currently masked because `.env` sets the var.) Resolve lazily inside the call path; return 503, don't crash.

### 🟠 HIGH — fix before production traffic

**H1. `getTrainingSamples` ignores approval filter → unapproved feedback enters training corpus.**
`feedback_service.ts:178-191` `findMany` has no `where`; `getTrainingReadiness` counts only `approvedForTraining: true` but the exporter ships pending/rejected feedback too → pollutes LoRA fine-tuning. Add `where: { approvedForTraining: true }`.

**H2. `feedback_analysis.ts:201-228` `computeLineDiff` is a naive position diff → misclassifies every shifted line as a modification.**
An insertion at the top makes every subsequent line pair "modified". Corrupts `subType`/`priority` and the ≥50-example self-learning trigger quality. Replace with a real Myers/LCS diff (the `diff` package is already a dependency).

**H3. `cmd_parser.ts:69` intent ordering makes `issue` unreachable.**
`INTENT_PATTERNS.create` matches `/ban h[aà]nh/`; `issue` also matches it. `intentOrder = ['revoke','modify','create',...]` puts `create` before `issue`, so any "ban hành" prompt classifies as `create` — issuance commands are systematically mis-parsed. Remove `/ban h[aà]nh/` from the create pattern or order `issue` before `create`.

**H4. `rag_service.ts:52-54` NaN embeddings pass validation.**
`typeof NaN === 'number'` is true, so a broken embeddings service writing NaN vectors passes the guard and corrupts cosine ranking. Add `Number.isFinite(n)`.

**H5. `rag_service.ts:236-241` content-key collision loses chunks.**
Key is `content.substring(0,100)`; the first `set` wins, so chunks sharing a 100-char prefix (common in VN legal boilerplate) never get embeddings updated — silent data loss. Use `crypto.createHash('sha256')` of full content.

**H6. `rag_service.ts:104-112` `expandParentContext` lacks `ORDER BY` → wrong parent for duplicate article labels.**
No deterministic ordering; may map the wrong parent row. Add `ORDER BY "createdAt" ASC` scoped per document.

**H7. `validateEnv.ts` doesn't enforce `JWT_SECRET` length.**
Only checks presence; CLAUDE.md requires "min 32 chars". A short secret passes validation and signs tokens. Add `length < 32` check; reject the docker-compose default `dev-jwt-secret-change-in-production` in prod.

**H8. Two competing `lmStudioBreaker` instances.**
`lmstudio_client.ts:15-18` defines its own `CircuitBreaker` (threshold 10) shadowing `circuit_breaker.ts:81` (threshold 5). Half-open probes and fault counts are tracked against whichever module the caller imports. Delete the duplicate; import the shared one.

**H9. `circuit_breaker.ts:83-87` inverted `is503` → a permanently-down embeddings service never opens the breaker.**
Returns `false` for 503s (so they don't count toward opening) — every request still hits the dead service. Rename, inspect `err.response.status` not `err.message`, and decide explicitly.

**H10. `lmstudio_client.ts:86-108` retries a non-idempotent streaming call.**
`withRetry(..., { maxRetries: 1 })` on a streaming POST: a mid-stream drop re-issues the request, re-emitting tokens from the start → the client sees a prefix then a second full stream. Set `maxRetries: 0` for streams.

**H11. Unauthenticated, rate-unbounded upload/feedback endpoints.**
`rag.ts:191-192` `/index` & `/upload` and `feedback.ts:16` `/submit` have no auth and only the global 100 req/15min limiter. Anyone can write PDFs to disk (`rag.ts:157`) and spam Feedback rows into Postgres — the latter taints `getTrainingReadiness` and can auto-trigger LoRA training on garbage. Require auth, add per-user upload/submit limiters, cap `originalContent`/`editedContent` length, clean up orphaned files on failure.

**H12. SSRF in `llm-settings.ts:141-170` POST `/test`.**
`baseUrl` is `z.string().url()` only — accepts `http://169.254.169.254/...`, `http://localhost:1234`, internal hostnames. A logged-in user can probe internal networks. Resolve and reject private/loopback/link-local/metadata IPs unless `provider==='lmstudio'` and host is allowlisted.

**H13. Training webhooks require admin JWT but no shared secret.**
`training.ts:147,164,...` webhook routes use `requireAdminAuth`; the LoRA service calls them back. No per-job HMAC/secret, no IP allowlist, and `:id` is taken from the URL unsigned. Combined with S2, an unauthenticated party can POST `/api/training/webhook/:id/completed` with `outputPath: <anything>`. Issue a per-job webhook secret at creation; verify it in the handler.

**H14. [RESOLVED] Two competing admin auth systems on `/api/admin`.**
*(Update from code review: This was already resolved. `index.ts:175-181` correctly delegates auth to sub-routers via JWT `requireAdminAuth`, and the static `ADMIN_TOKEN` gate was removed.)*

**H15. `training.ts:13-24` accepts arbitrary client `outputDir` → path injection into training pipeline.**
`config.outputDir` is free-form, passed straight to the LoRA service. `admin/training.ts:337` correctly hardcodes `/models/lora/${jobId}`. Drop `outputDir` from the public schema or validate against a strict allowlist.

**H16. `feedback_utils.ts:191-209` `withLock` releases a lock it may not own.**
No fencing token, no compare-and-delete. If the body outlives the TTL, `finally` deletes the *next* holder's lock. Use a random `lockValue` + Lua compare-and-delete on release.

**H17. `encryption.ts` no AAD bound to identity, key read each call.**
GCM IV/auth-tag handling is correct, but no `userId` AAD → ciphertext rows are swappable across users. No `keyVersion` → can't rotate. Bind `userId` as AAD; add `keyVersion` if rotation is planned. Resolve and cache the 32-byte key once at module load.

**H18. SSE parser swallows malformed JSON and ignores error events.**
`sse_parser.ts:15-32` drops non-JSON `data:` lines silently and never inspects `data.error`. A failed upstream generation looks identical to a successful short one. Inspect `data.error`; log malformed lines at `warn`.

**H19. `prisma.ts` wrong graceful-shutdown hook + naive connection_limit append.**
`process.on('beforeExit')` doesn't fire on SIGTERM/SIGINT (docker stop). And `${baseUrl}${separator}connection_limit=...` doubles the param if `DATABASE_URL` already has it. Register SIGTERM/SIGINT handlers; parse the URL and set params cleanly.

**H20. `embeddings_client.ts` no batch chunking + loses AbortError.**
`generateBatchEmbeddings` sends all texts in one POST (120s timeout) → large ingestions OOM or time out and fail the whole batch. On `controller.abort()` the error is rewrapped, losing `AbortError` → `withRetry` won't recognize it as retryable. Chunk to 32-64 per request; preserve `error.name==='AbortError'` (set `.code='ETIMEDOUT'`).

**H21. `lora-service/requirements.txt` missing `trl`.**
The generated training script (`main.py:362`) imports `SFTTrainer` from `trl`, but `trl` isn't in requirements → `ModuleNotFoundError` on first training run. Add `trl>=0.8.0`.

### 🟡 MEDIUM

- **M1.** `training_state.ts` casing disagrees across TS/Prisma/Python: enum is uppercase (`QUEUED...`), `schema.prisma:111` defaults `"created"` (lowercase), `lora-service/main.py` uses lowercase. State transitions silently mismatch. Align on one casing; add `CREATED` or default to `queued`.
- **M2.** `training_state.ts:149-151` `canRetry` Allows retry from `CANCELLED` — re-runs a user-cancelled job. Restrict to `FAILED`.
- **M3.** `feedback_analysis.ts:306-319` pure-formatting rule unreachable — Rule 4 (`similarity>=0.95`) fires first → classified as `correction`. Move formatting-only rule before the correction rule.
- **M4.** `feedback_analysis.ts:61` `text.match(pattern)` with `/u` flag can throw on a lone surrogate (from a bad PDF parse) → 500. Wrap in try/catch returning `[]`.
- **M5.** `orchestrator.ts:42-53` `status` hardcodes `'pending'`; `planning`/`researching`/`writing` are declared but never set by the agents → stage tracking is cosmetic. Have agents set their stage, or remove dead union members.
- **M6.** `structured_output_service.ts:139` recursive `$ref: '#/properties/blocks/items'` is non-standard; LM Studio's strict `json_schema` rejects it → nested `children` not enforced. Move to `#/$defs/block`.
- **M7.** `documents.ts:20-24` `q` unbounded + `offset` uncapped → expensive ILIKE / huge offsets. Bound `q` (≤200), cap `offset`.
- **M8.** `admin/training.ts:436-437` `limit`/`page` parsed raw → NaN crashes, no `.max()` → full-table dump. Use a zod schema as `admin/feedback.ts` does.
- **M9.** `admin/feedback.ts:414-434` batch review overwrites each row's `metadata` instead of merging → wipes per-row audit history. Re-read existing metadata per row or move audit to an append-only table.
- **M10.** `sanitize.ts` regex HTML sanitizer is bypassable; only effective if every write path calls it. Use `isomorphic-dompurify`; enforce via a Prisma `.$extend` hook on content fields.
- **M11.** `middleware/sanitize.ts` HTML-escapes feedback content **before** diffing → diffs computed against escaped text, mismatching the unsanitized original. Sanitize at the render boundary only.
- **M12.** `model-versions.ts` `/rollback` and `PUT /status` lack `requirePermission` (other model routes have it) → any admin (even a `reviewer` lacking `models:*`) can rollback. Add `requirePermission('models:deploy'|'models:write')`.
- **M13.** `documents.ts` mounted at `/api/documents` with local `requireAdminAuth`, not under `/api/admin` → inconsistent auth model, no RBAC granularity. Reorganize or apply `requirePermission('documents:read'|'documents:write')`.
- **M14.** `index.ts:115-120` health returns 503 if any single service is degraded — LoRA being down (only for training) fails the readiness probe for the whole API. Distinguish core (db/redis/lmstudio) from auxiliary (lora).
- **M15.** `errorHandler.ts:10` logs `err.stack` even in production. Gate on `NODE_ENV!=='production'`.
- **M16.** `requestId.ts:19-21` accepts client `X-Request-ID` verbatim → log injection. Validate `^[A-Za-z0-9_-]{1,64}$` or generate.
- **M17.** `lora-service/main.py` `request.dict()` deprecated in Pydantic v2; `MODEL_NAME_PATTERN` allows `/`. Use `.model_dump()`; tighten the pattern.
- **M18.** `lora-service/main.py:21` `active_subprocesses: Dict[str, subprocess.Popen]` stores `asyncio.subprocess.Process`; `proc` unbound in the `finally` if spawn raised. Fix the type hint; init `proc: Optional[...] = None`.
- **M19.** `rag_service.ts:269-275` one `$transaction` for N chunk updates can exhaust the pool for large docs. Batch with a `VALUES`/`CASE` update or chunk into batches of ~50.
- **M20.** `feedback_service.ts:103-131` `storeFeedback` recomputes `computeDiff` even when `analysis.diff` exists; stored `diff` may mismatch the analysis-derived classification. Gate the block on `data.analysis`.
- **M21.** `feedback_service.ts:178` no validation that supplied `analysis` matches the `originalContent`/`editedContent` — caller can pass mismatched analysis. Assert a content hash or recompute.
- **M22.** `feedback_rag_promotion.ts:186-193` uses raw `gen_random_uuid()` SQL (requires pgcrypto, diverges from the no-embedding Prisma path). Use Prisma `chunk.create` then a separate `UPDATE ... SET embedding=`.
- **M23.** `docling-service` parsing returns flat Markdown — the 3-level Article/Clause/Point hierarchical chunker is **not** in this service; it must live in `ingestion_service.ts` (the "old broken chunker" note in `CLAUDE.md` refers to backend chunking). Verify the hierarchy is actually produced there; the CLAUDE.md "next steps" already flag re-indexing.
- **M24.** `frontend/package.json` dependency mismatches: `next ^16.2.9` with `react ^18.2.0` (Next 16 expects React 19) and `eslint-config-next 14.0.4` (way behind). Verify `npm install` + `next build` succeed; align React to 19 and eslint-config-next to 16.
- **M25.** `frontend/package.json` version specifiers that may not exist on npm: `uuid ^14.0.1` (latest is ~11.x), `lucide-react ^1.17.0` (latest is ~0.4xx). Verify; `npm install` may fail.
- **M26.** README/CLAUDE.md "Key Files" lists `routes/ingestion.ts`, `routes/structured-output.ts`, `routes/model-versions.ts` as top-level files — they don't exist (ingestion is in `rag.ts`, structured-output in `workflow.ts`, model-versions under `admin/`). Update docs.
- **M27.** Project root has throwaway migration scripts `fix_poll.py`, `fix_rename.py`, `fix_similarity.py`, `rename_similarity.py` with hardcoded `C:\Users\PC\...` paths — committed throwaway. Remove or move to a `scripts/oneoff/` dir.
- **M28.** Two schema-creation systems (`init.sql` for docker, Prisma `migration.sql`) can conflict: the README tells users to run both `docker compose up -d postgres` **and** `npx prisma migrate dev` → double table creation errors. Document one canonical path.

### 🟢 LOW (batch later)
- `redis.ts` in-memory `setNx` returns string not boolean; type the lock fns against `RedisClient`, not `any`.
- `errors.ts` no `statusCode`/`captureStackTrace`; `errorHandler` switches on `err.name` strings.
- `feedback_utils.ts:82,132` diacritic regex order; use `NFKD` + `\p{Diacritic}`.
- `evaluate_rag.ts:22-24` `expectedLevel` declared, never used.
- `circuit_breaker.ts` no half-open success threshold (one lucky success closes).
- `UserLLMConfig` `apiKeyIv`/`apiKeyAuthTag` use `@db.Text` — `VarChar(64)` suffices.
- `template-service/main.py` `allow_headers=["*"]` with credentials — replace with explicit list.
- `docling-service/requirements.txt` already includes `docling>=2.0.0` (refutes the "missing docling" suspicion) — the rebuild concern is about the *image*, not the requirements.
- `docker-compose.yml` doesn't wire `CORS_ORIGIN`, `LLM_CONFIG_ENCRYPTION_KEY`, `TRUST_PROXY_HOPS` into backend env (though `env_file: ./backend/.env` covers it if that file exists in deploy).
- `documents.ts:133-137` `Content-Disposition` lacks `filename*=UTF-8''...` for Vietnamese titles.

---

## Part 2 — Core Improvement Suggestions (beyond fixing bugs)

1. **Single Source of Truth for Database Schema & Migrations**:
   - Standardize on Prisma migrations as the canonical source of truth for both schema changes and indexing.
   - Re-introduce the `Template` model to `schema.prisma` mapping to Postgres metadata, and generate a migration `add_template_model` to create the table cleanly. Seed the database with the default Decree 30/2020 templates.
   - Define a single path for database initialization and schema setup using `npx prisma migrate dev`, rendering `init.sql` deprecated or keeping it purely as a DB-setup entry point for pgvector.

2. **Harden the LLM Trust Boundary**:
   - Introduce a structured `prompt_builder.ts` to build LLM prompts safely. Wrap all untrusted context (user prompts, retrieved text, chunk data) inside tagged delimiters like `<USER_DATA>...</USER_DATA>` and instruct the LLM to treat it strictly as data.
   - Avoid direct interpolation/concatenation of chunks into system prompts. Pass them as structured role-based messages or distinct inputs.
   - Sanitize all LLM output before returning it to the client or saving it to the database to prevent injection payloads.

3. **Robust Event-Driven Self-Learning Loop**:
   - Convert the RAG promotion and LoRA training triggers to be fully automated.
   - Wire `training_auto_check.ts` to feedback approval events. When approved feedback counts hit the threshold (>= 50), auto-trigger the LoRA training job.
   - Switch the RAG worker queue from a destructive `rPop` to a reliable message-passing pattern using Redis Streams with consumer groups (or `BRPOPLPUSH` with processing queues) to avoid message loss.

4. **Align the Orchestrator with the 8-Step Pipeline**:
   - Update `orchestrator.ts` to implement the full 8-step pipeline defined in the user documentation:
     1. **Parse**: Parse user command (using `cmd_parser.ts`) to extract intent and entities.
     2. **Extract**: Determine if additional document structure needs extraction.
     3. **Retrieve**: Run RAG retrieval over reference templates and relevant documents.
     4. **Build**: Assemble target template guidelines and construct LLM prompts.
     5. **Outline**: Generate a structured section-by-section outline.
     6. **Content**: Generate draft content for all sections.
     7. **Validate**: Perform strict schema/legal validation on generated output.
     8. **Format**: Pass the generated JSON data to the Python template service to produce the final `.docx` using `docxtpl`.

5. **Align with Google's Document-Processing Best Practices**:
   - Bring standard notebook capabilities into the product, including structured QA responses, summarization, HTML table parsing, and end-to-end page-level citations.

---

## Part 2.5 — Document-Processing Gap Analysis & Notebook Alignment

To bridge the gap between the current codebase and Google's standard document-processing patterns, we will introduce:
1. **Structured QA Responses (`routes/qa.ts`)**: Replace plain-text streams with structured JSON responses containing answer details, page-level citations, and model confidence scores.
2. **Summarization Endpoint (`routes/summarize.ts`)**: A new endpoint that uses RAG to retrieve document chunks, runs summarization, and lists used chunk IDs for auditability.
3. **HTML Table Extraction (`docling-service`)**: Extend the Python service to return parsed tables as HTML (`pandas.to_html()`), allowing the Node template service to inject tables directly into DOCX.
4. **End-to-End Page Metadata**: Update `ingestion_service.ts` to track chunk page boundaries (splitting by Markdown form feeds `\f`), add a `page` field to the Postgres `Chunk` table, and expose page citations in RAG results.
5. **Page-Aware Ranking**: When querying the database, boost the scores of retrieved chunks that belong to the same page or document, and expand context to include adjacent pages (e.g., `page+1`).

---

## Part 3 — Unified Phased Implementation Plan (AI-Ready)

This section provides a sequential, step-by-step implementation guide with explicit file paths, code changes, and verification commands. It is optimized for execution by an AI coding assistant.

### Phase 0 — Security, Secrets, & Authorization (Blocker)

- [ ] **Rotate and Clean Env Secrets**
  - Locate `backend/.env` and replace all real secrets with placeholder variables.
  - Create a standard `backend/.env.example` file.
  - Add `.env` to the global `.gitignore` in the project root.
  - **Git History Purge**: Execute a git history cleaning tool (`git-filter-repo` or BFG) to wipe historical occurrences of `backend/.env` from `https://gitlab.com/miralph/LLM`, then perform a mirror force push.
- [ ] **Strengthen Environment Validation (`validateEnv.ts`)**
  - Require a minimum length of 32 characters for `JWT_SECRET`.
  - Reject the placeholder secret value (`dev-jwt-secret-do-not-use-in-production`) when `NODE_ENV === "production"`.
  - Throw an error if `ALLOW_DEV_AUTH === "true"` in production mode.
  - Force `ALLOW_DEV_AUTH` to `false` in development/production by default to disable dev authentication bypass.
- [ ] **Secure Webhook and Admin Endpoints**
  - **Admin Auth Consolidation**: Unify `/api/admin` routes on JWT-based `requireAdminAuth` and drop the legacy static `ADMIN_TOKEN` mount in `index.ts`.
  - **SSRF Mitigation (`llm-settings.ts`)**: Validate `baseUrl` values passed to `/test`. Reject link-local (`169.254.*.*`), private (`10.*.*.*`, `172.16.*.*`, `192.168.*.*`), and loopback (`127.*.*.*`) IPs unless the LLM provider is allowlisted.
  - **Secure Training Webhooks (`training.ts`)**: Generate a per-job webhook HMAC secret upon training job initialization. Require and verify this secret in the webhook callback endpoint `/api/training/webhook/:id/completed` instead of expecting an admin JWT.
- [ ] **Rate Limiting & File Cleanup (`rag.ts`, `feedback.ts`)**
  - Implement a dedicated rate limiter for `/upload`, `/index`, and `/submit` routes.
  - Require user authentication for document uploads and feedback submission.
  - Enforce max size limits on incoming files and input length guards.
  - Ensure orphaned/failed uploads are deleted from local disk on extraction errors.
- **Verify**: Run `npm run dev` to confirm the backend boots clean, admin login JWT works, all admin endpoints are reachable, and unauthenticated uploads/feedback are rejected.

### Phase 1 — Database Schema, Data Integrity, & RAG Correctness

- [ ] **Re-add the Template Model**
  - Add `model Template` to `backend/prisma/schema.prisma` matching the fields: `id`, `name`, `docType` (unique), `header`, `signatureBlock`, `isActive`, `createdAt`, `updatedAt` (or direct parity with the `init.sql` definition).
  - Generate a new migration: `npx prisma migrate dev --name add_template_model`.
  - Create `backend/prisma/seed.ts` to seed the database with the 6 core templates from `template_service.ts`. Wire seed script to `package.json` and run `npx prisma db seed`.
- [ ] **HNSW Vector Indexing**
  - Create a migration to add an HNSW index to the `Chunk` table's `embedding` vector:
    `CREATE INDEX "Chunk_embedding_hnsw_idx" ON "Chunk" USING hnsw (embedding vector_cosine_ops);`
  - Remove table definitions from `init.sql` to keep Prisma migrations as the single source of truth; document `prisma migrate dev` as the canonical database setup path.
- [ ] **Enhance RAG Service (`rag_service.ts`)**
  - **NaN Embedding Guard (H4)**: Implement `Number.isFinite(n)` checks inside the embedding array validator to prevent corrupt vector calculations.
  - **Content-Key Hash (H5)**: Replace the naive 100-character substring content key with a SHA-256 hash of the full text content to prevent collision-based data loss.
  - **Deterministic Parent Context (H6)**: Add an `ORDER BY "createdAt" ASC` clause to `expandParentContext` queries to resolve the correct hierarchy.
  - **Batch Updates (M19)**: Batch large chunk status updates in `rag_service.ts` into groups of 50 inside transactions instead of sending one giant single-transaction operation.
- [ ] **Robust Feedback Pipeline (`feedback_service.ts`, `feedback_analysis.ts`, `feedback_rag_promotion.ts`)**
  - **Single Document Promotion (S8)**: Rewrite RAG promotion to create exactly **one** `Document` per approved feedback and attach all chunks to it, rather than creating a duplicate document per chunk.
  - **Myers/LCS Diff implementation (H2)**: Replace naive line diffs in `feedback_analysis.ts` with Myers/LCS diffs using the project's existing `diff` library dependency.
  - **Approval Filters (H1)**: Add `where: { approvedForTraining: true }` filters to `getTrainingSamples` to keep unapproved feedback out of the training dataset.
  - **Intent Ordering (H3)**: Re-order intent checks in `cmd_parser.ts` to check `issue` before `create` (or remove overlapping phrases) to make `issue` commands reachable.
- **Verify**: Ingest a fresh PDF via Prisma path → check that the HNSW index is used in query logs; upload feedback → verify a single Document is created; verify `evaluate_rag.ts` baseline numbers improve.

### Phase 2 — Resilience, Circuit Breakers, & Queue Robustness

- [ ] **Circuit Breaker Refactoring (`circuit_breaker.ts`, `lmstudio_client.ts`)**
  - Collapse duplicate circuit breakers: delete the duplicate breaker in `lmstudio_client.ts` and use the shared `CircuitBreaker` class.
  - **Fix 503 Inversion (H9)**: Update `circuit_breaker.ts` to correctly record 503 errors so the breaker opens when downstream services fail.
  - Add a configurable half-open success threshold to ensure multiple consecutive successful requests are required before closing the breaker.
- [ ] **Robust Embedding Client & LLM Stream Handling**
  - **Stream Retry Guard (H10)**: In `lmstudio_client.ts`, set `maxRetries: 0` for token streaming requests to prevent duplicated stream prefixes when retrying.
  - **Embedding Request Chunking (H20)**: Modify `embeddings_client.ts` to chunk batch embedding requests into sizes of 32-64 to prevent OOM/timeouts. Ensure `AbortError` name is preserved for standard retry handling.
- [ ] **Docker & LoRA Training Cleanup (`docling-service`, `lora-service`)**
  - **Add Curl to Docker (S10)**: Add `curl` to the apt-get installation list in the `docling-service` Dockerfile to pass compose health checks.
  - **LoRA Requirements & Pydantic (H21, M17, M18)**: Add `trl>=0.8.0` to `lora-service/requirements.txt`. Refactor `main.py` to use Pydantic v2 `.model_dump()` instead of `.dict()`. Properly initialize `proc` variables in `finally` blocks.
  - **State Casing Alignment (M1, M2)**: Unify all `TrainingJob` status string checks across TypeScript and Python to use UPPERCASE (`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`). Prevent retries on `CANCELLED` statuses.
- [ ] **Locking and Parsing Resilience (`feedback_utils.ts`, `sse_parser.ts`)**
  - **Fencing Tokens (H16)**: Implement random fencing tokens and Lua-based compare-and-delete on redis lock releases in `withLock` to prevent releasing locks owned by other processes.
  - **SSE Error Handling (H18)**: Modify `sse_parser.ts` to check `data.error` fields and throw an error when upstream generations fail, rather than silently dropping them.
- **Verify**: Run `docker compose up` and verify all service health checks pass; check that a simulated 503 opens the embeddings breaker.

### Phase 3 — Orchestrator Alignment & Full 8-Step Pipeline

- [ ] **Step 1: CMD Parser Integration**
  - Wire `cmd_parser.ts` into `orchestrator.ts` as the very first step. Input user prompts are parsed into intents and entities, and then passed down as context.
- [ ] **Step 8: DOCX Formatter Integration**
  - Wire `docx_service.ts` and the Python template service into the end of `orchestrator.ts`. Once LLM content validation passes, pass the structured JSON output directly to the template formatter to compile a `.docx` file and return its storage key/binary stream to the client.
- [ ] **Assemble and Feed Template Context**
  - Implement RAG retrieval for templates: retrieve target template metadata based on the parsed `docType` from Postgres, then feed the template field definitions (`sections`, `fields`) to the LLM prompt builder (`prompt_builder.ts`).
  - Instruct the LLM to output structured JSON fields conforming precisely to the retrieved template metadata.
- [ ] **Extend Workflow State Schema**
  - Update `WorkflowState` (or DB schemas) to store fields: `intent`, `entities`, `documentType`, `templateId`, `formatResult` (path to generated DOCX).
  - Clear out dead/unused stages from the status tracking enum in `orchestrator.ts`. Cleanly track state changes as: `parsing → extracting → retrieving → building → outlining → writing → validating → formatting`.
- **Verify**: Send a document generation request to `/api/workflow/generate` and verify that the full 8 steps run successfully, and a completed `.docx` is returned.

### Phase 4 — Document-Processing Additions (Notebook Alignment)

- [ ] **End-to-End Page Metadata Ingestion**
  - **Prisma Schema Update**: Add `page Int?` to the `Chunk` model. Generate a migration: `npx prisma migrate dev --name add_page_to_chunk`.
  - **Split by Form Feeds**: In `ingestion_service.ts`, parse the markdown returned from Docling and split it by form feed characters (`\f`) to assign page numbers to each chunk before embedding.
- [ ] **Page-Aware RAG & Page Context Expansion**
  - **Pagination Context**: Update `rag_service.ts` search queries. When a chunk is retrieved, fetch the chunk at `page + 1` from the same document and append it as extra context to avoid sentence truncation across page breaks.
  - **Page Score Boosting**: Apply page-aware ranking. Chunks appearing on the same page or document have their similarity scores boosted dynamically.
- [ ] **HTML Table Parsing**
  - **Python Table Parser**: Extend `docling-service/main.py` with a `/parse/table-html` endpoint. Parse PDF tables using Docling, load them into a pandas DataFrame, and export them using `df.to_html()`.
  - **Fill HTML in DOCX**: In the Node template/docx service, detect table fields, convert the parsed HTML tables into native DOCX table structures, and inject them into the document layout.
- [ ] **Structured QA Responses (`routes/qa.ts`)**
  - Update `routes/qa.ts` to return structured JSON. The LLM output should follow a schema like:
    ```ts
    interface QaAnswer {
      answer: string;
      citations: Array<{ documentId: string; chunkId: string; page?: number; snippet: string }>;
      confidence: number;
    }
    ```
  - Parse LLM output using `structured_output_service.ts` with Zod. Include safety fallbacks if JSON parsing fails (e.g. output plain text as a fallback with a parse error flag in metadata).
- [ ] **Multi-Doc Summarization Endpoint (`routes/summarize.ts`)**
  - Create a new endpoint: `POST /api/workflow/summarize` taking `documentIds: string[]` and `maxLength?: number`.
  - Fetch chunks across all requested documents, compile a summary via RAG prompts, and return the summary along with a list of the chunk IDs used.
- **Verify**: Verify that `POST /api/qa/ask` returns citations with correct page numbers; verify `/api/workflow/summarize` returns document summaries correctly; verify `/parse/table-html` returns valid HTML markup.

### Phase 5 — Cleanup, Validation & Testing

- [ ] **Centralized Validation Middleware**
  - Replace inline `zod.safeParse` blocks in `admin/feedback.ts`, `admin/training.ts`, and `model-versions.ts` with a centralized express request validation middleware.
  - Resolve parsing/casing inconsistencies in endpoints and enforce proper parameter bounds.
- [ ] **Frontend Dependency Alignment (`frontend/package.json`)**
  - Align frontend package versions: upgrade React to 19, `eslint-config-next` to 16, and correct the non-existent npm version specifiers for `uuid` and `lucide-react`.
  - Verify that `npm install` and `next build` execute and complete with zero errors.
- [ ] **Remove Dead Scripts**
  - Delete or relocate one-off throwaway scripts (`fix_poll.py`, `fix_rename.py`, `fix_similarity.py`, `rename_similarity.py`) in the root directory to a dedicated folder like `scripts/oneoff/`.
- [ ] **Final Verification & Test Coverage**
  - Run regression tests: `npm run test` (backend Jest suites) to confirm all tests pass successfully.
  - Run the evaluation script `npx tsx src/scripts/evaluate_rag.ts` to record baseline numbers for RAG retrieval quality post-index creation.
- **Verify**: Run `npx jest` to check that all tests pass, and complete a full frontend production build without errors.

---

## Part 4 — Resolved Decisions & Project Governance

1. **Git History Purge**: Complete history rewriting (`git-filter-repo` / BFG) on `https://gitlab.com/miralph/LLM` is approved to purge `backend/.env`. All production credentials must be rotated immediately afterward.
2. **8-Step Pipeline**: We are actively implementing the full 8-step pipeline in `orchestrator.ts` rather than simplifying the documentation to match the current 4-step execution.
3. **Template Database Storage**: The `Template` model will be restored in Prisma, maintaining Postgres as the persistent metadata database that the LLM queries via RAG.
4. **Independent Phased Releases**: Each phase is designed to be shippable and verifiable independently. No manual review gates are required between phases unless architectural blocker conflicts arise.
