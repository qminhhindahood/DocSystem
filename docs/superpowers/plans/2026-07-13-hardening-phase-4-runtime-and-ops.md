# RAG Reliability, Services, and Cutover Rehearsal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining retrieval/background/service defects, prove safe backup/import/cutover mechanics on disposable infrastructure, remove secret/dependency hygiene failures, and run the complete acceptance matrix.

**Architecture:** Pure functions enforce exact context/evaluation behavior, bounded jobs record failures and propagate cancellation, and auxiliary services expose truthful readiness. PowerShell operations wrap every native command, verify source/target identity, and rehearse against uniquely named disposable resources before any documented production switch.

**Tech Stack:** TypeScript/Jest, Python/FastAPI/Pytest, PostgreSQL 15 tools, PowerShell 7, Docker Compose, npm audit.

## Global Constraints

- Do not run production cutover commands, stop the live stack, alter live database writability, or remove any existing volume.
- Rehearsal resource names begin with `docai_rehearsal_<timestamp>_` and cleanup verifies that prefix before removal.
- Every native process failure is fatal; no script prints success after a failed `pg_dump`, `pg_restore`, `psql`, Prisma, Docker, or checksum command.
- The final data import is data-only and excludes `_prisma_migrations`; Prisma migrations are deployed to the empty target first.
- Source writers must be externally stopped and verified quiescent before the final backup; scripts do not pretend that a flag alone stops writes.
- Do not print `.runtime_env.txt` or secret values. Remove the artifact, ignore its name, and document rotation if any value was used beyond disposable testing.

---

### Task 1: Enforce the Exact Context Budget and Summary-Safe Evaluation

**Files:**
- Modify: `backend/src/services/context_packer.ts`
- Modify: `backend/src/services/context_packer.test.ts`
- Modify: `backend/src/scripts/evaluate_rag.ts`
- Create: `backend/src/scripts/evaluate_rag.test.ts`

**Interfaces:**
- Preserves: `packRetrievalContext(chunks, { maxChars, maxPerDocument?, maxChunks? }): PackedContext`.
- Produces: exported `selectEvaluationEvidence(chunks, topK)` that removes summaries before taking K.

- [ ] **Step 1: Add failing full-render budget tests**

```ts
it.each([0, 1, 32, 128, 8000])('never exceeds maxChars=%i', (maxChars) => {
  const packed = packRetrievalContext(fixturesWithLongLabelsSummariesAndProvenance, { maxChars });
  expect(packed.context.length).toBeLessThanOrEqual(maxChars);
});

it('takes the first K evidence chunks, never summary rows', () => {
  expect(selectEvaluationEvidence([summary, evidence1, summary2, evidence2], 2))
    .toEqual([evidence1, evidence2]);
});
```

Include wrappers, separators, summary labels, title, page, article/clause/point, authority, version, and effective/repealed dates in the budget fixtures.

- [ ] **Step 2: Run and observe overflow/current top-K behavior**

Run: `cd backend && npx jest src/services/context_packer.test.ts src/scripts/evaluate_rag.test.ts --runInBand`

Expected: FAIL because selection currently budgets raw chunk content before rendering labels/wrappers.

- [ ] **Step 3: Budget complete rendered blocks**

Build each summary/evidence block first. Reserve wrapper lengths, then append only a whole block plus its separator when the complete candidate remains within `maxChars`. If `maxChars` is shorter than the wrappers, return empty context. Set `truncated` when any summary/evidence candidate is omitted. Evaluation filters `!isSummary && level !== 0` before `.slice(0, topK)` and uses that array for ranks, IDs, precision, and generated context.

- [ ] **Step 4: Rerun tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/context_packer.ts backend/src/services/context_packer.test.ts backend/src/scripts/evaluate_rag.ts backend/src/scripts/evaluate_rag.test.ts
git commit -m "fix: enforce rendered RAG context budgets"
```

### Task 2: Broaden Weak Queries Without Requiring the LLM Rewriter

**Files:**
- Modify: `backend/src/services/query_rewriter.ts`
- Modify: `backend/src/services/self_correct.ts`
- Modify: `backend/src/services/self_correct.test.ts`

**Interfaces:**
- Produces: `broadenQuery(query: string, userId?: string): Promise<string>`.
- Behavior: deterministic synonym expansion always runs; optional LLM rewriting may improve it but cannot disable broadening.

- [ ] **Step 1: Add failing flag-combination tests**

Test all four combinations of `ENABLE_SELF_CORRECT` and `ENABLE_QUERY_REWRITER`. When self-correction is enabled and evidence is weak, assert the second search query differs from the first even when the LLM rewriter is disabled. Assert at most one retry and no retry when self-correction is disabled.

- [ ] **Step 2: Run and observe unchanged retry query**

Run: `cd backend && npx jest src/services/self_correct.test.ts src/services/query_rewriter.test.ts --runInBand`

Expected: FAIL for enabled-self-correct/disabled-rewriter.

- [ ] **Step 3: Implement deterministic-first broadening**

```ts
export async function broadenQuery(query: string, userId?: string): Promise<string> {
  const expanded = expandSynonyms(query).trim();
  if (!ENABLE_REWRITER()) return expanded === query.trim() ? `${query.trim()} quy định hướng dẫn liên quan` : expanded;
  const rewritten = (await rewriteQuery(expanded, userId)).trim();
  return rewritten && rewritten !== query.trim() ? rewritten : expanded;
}
```

Use `broadenQuery` once in `retryRetrieve`. Keep the bounded retry count at one.

- [ ] **Step 4: Rerun tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/query_rewriter.ts backend/src/services/self_correct.ts backend/src/services/self_correct.test.ts
git commit -m "fix: broaden weak retrieval queries deterministically"
```

### Task 3: Bound Embedding Backfill and Record Per-Chunk Failures

**Files:**
- Refactor: `backend/src/scripts/backfill_embeddings.ts`
- Create: `backend/src/scripts/backfill_embeddings.test.ts`

**Interfaces:**
- Produces: `backfillEmbeddings(options): Promise<BackfillReport>`.
- `BackfillReport = { total, embedded, failed: Array<{ chunkId, attempts, errorCode }> }`.

- [ ] **Step 1: Write failing poison-chunk and continuation tests**

Mock chunks A/B/C where B always fails. Assert B is attempted exactly twice, A and C are embedded, the loop terminates, B's metadata gets `embeddingBackfill` failure information, and the final report contains stable code `EMBEDDING_FAILED` without stack text.

- [ ] **Step 2: Run and observe infinite-selection behavior**

Run: `cd backend && npx jest src/scripts/backfill_embeddings.test.ts --runInBand`

Expected: FAIL or timeout because the current query repeatedly selects the same null-embedding row.

- [ ] **Step 3: Implement keyset pagination and bounded attempts**

Query batches ordered by ID with `id > lastSeenId`, process each row at most twice with existing retry utilities, and advance the cursor regardless of success. On final failure, merge this object into `Chunk.metadata` with a parameterized query:

```ts
const failureMetadata = {
  embeddingBackfill: {
    attempts: 2,
    errorCode: 'EMBEDDING_FAILED',
    failedAt: new Date().toISOString(),
  },
};
```

Export the function and keep CLI execution behind `if (require.main === module)`. Exit code is 2 when the report contains failures, 0 otherwise.

- [ ] **Step 4: Rerun focused test**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/scripts/backfill_embeddings.ts backend/src/scripts/backfill_embeddings.test.ts
git commit -m "fix: bound embedding backfill failures"
```

### Task 4: Propagate Cancellation Through Workflow and LLM Calls

**Files:**
- Replace: `backend/src/middleware/timeout.ts`
- Modify: `backend/src/middleware/timeout.test.ts`
- Modify: `backend/src/services/llm_config_service.ts`
- Modify: `backend/src/services/orchestrator.ts`
- Modify: `backend/src/routes/workflow.ts`
- Modify: `backend/src/routes/qa.ts`
- Modify: `backend/src/services/orchestrator.test.ts`
- Modify: `backend/src/routes/workflow.contract.test.ts`
- Modify: `backend/src/routes/qa.contract.test.ts`

**Interfaces:**
- Produces: `withAbortTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T>`.
- `callLLM`, `streamLLM`, orchestrator agents, RAG calls, and generators accept `signal?: AbortSignal`.

- [ ] **Step 1: Add failing timeout/disconnect tests**

Use a never-resolving fake operation that records `signal.abort`; assert timeout aborts it before rejecting. Simulate client disconnect during research/writing and assert no later phase starts, no additional `res.write` occurs, Axios receives the signal, generators execute `finally`, and no unhandled rejection remains after the test.

- [ ] **Step 2: Run and observe work continuing after timeout**

Run: `cd backend && npx jest src/middleware/timeout.test.ts src/services/orchestrator.test.ts src/routes/workflow.contract.test.ts src/routes/qa.contract.test.ts --runInBand`

Expected: FAIL.

- [ ] **Step 3: Implement linked abort controllers**

```ts
export async function withAbortTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Operation timed out')), timeoutMs);
  try { return await run(controller.signal); }
  finally { clearTimeout(timer); parent?.removeEventListener('abort', onParentAbort); }
}
```

Request handlers create one root controller, abort on `req.aborted`/`res.close`, pass it to every phase, and check before writes. Axios uses `signal`; async generators receive and check the same signal. Remove `Promise.race` timeout wrappers that leave work alive.

- [ ] **Step 4: Rerun tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/timeout.ts backend/src/middleware/timeout.test.ts backend/src/services/llm_config_service.ts backend/src/services/orchestrator.ts backend/src/routes/workflow.ts backend/src/routes/qa.ts backend/src/services/orchestrator.test.ts backend/src/routes/workflow.contract.test.ts backend/src/routes/qa.contract.test.ts
git commit -m "fix: cancel timed-out generation work"
```

### Task 5: Isolate Docling Uploads and Expose Truthful Embeddings Readiness

**Files:**
- Modify: `docling-service/main.py`
- Create: `docling-service/tests/test_upload_isolation.py`
- Create: `docling-service/tests/conftest.py`
- Modify: `docling-service/requirements.txt`
- Modify: `embeddings-service/main.py`
- Create: `embeddings-service/tests/test_health.py`
- Create: `embeddings-service/tests/conftest.py`
- Modify: `embeddings-service/requirements.txt`
- Modify: `docker-compose.yml`
- Modify: `backend/src/index.ts`

**Interfaces:**
- Docling `_validate_and_save` creates a unique path per request regardless of original filename.
- Embeddings `GET /live` always reports process liveness; `GET /ready` returns 200 only when `_model` is loaded, otherwise 503.

- [ ] **Step 1: Add concurrent-upload and readiness tests**

Post two simultaneous files both named `same.pdf` with different bytes; assert parse functions receive different paths and cleanup removes both. Set `_model=None`; assert `/live` is 200, `/ready` is 503, and `/embed` is 503. Set a fake model; assert `/ready` is 200.

- [ ] **Step 2: Run and observe collision/false-health behavior**

Run: `python -m pytest docling-service/tests embeddings-service/tests -q`

Expected: FAIL.

- [ ] **Step 3: Implement unique temp files and readiness**

```py
suffix = Path(secure_filename(file.filename or "upload.pdf")).suffix.lower() or ".pdf"
with tempfile.NamedTemporaryFile(prefix="docling_", suffix=suffix, dir=UPLOAD_DIR, delete=False) as target:
    shutil.copyfileobj(file.file, target)
    return target.name
```

Keep containment checks and size limits. Add `/live` and `/ready`; make legacy `/health` delegate to readiness during one compatibility release. Point Compose and backend dependency health checks to `/ready`.

- [ ] **Step 4: Rerun Python tests and syntax checks**

Run: `python -m pytest docling-service/tests embeddings-service/tests -q && python -m compileall -q docling-service embeddings-service`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docling-service/main.py docling-service/tests docling-service/requirements.txt embeddings-service/main.py embeddings-service/tests embeddings-service/requirements.txt docker-compose.yml backend/src/index.ts
git commit -m "fix: isolate parsing and report embedding readiness"
```

### Task 6: Make Backup, Import, and Verification Scripts Fail Closed

**Files:**
- Replace: `ops/backup-postgres.ps1`
- Replace: `ops/import-postgres-data.ps1`
- Replace: `ops/verify-postgres.ps1`
- Create: `ops/lib/PostgresTools.psm1`
- Create: `ops/tests/PostgresTools.Tests.ps1`
- Modify: `docs/database-cutover.md`

**Interfaces:**
- Backup output: custom-format dump, `.sha256`, `manifest.json`, schema metadata, row counts, and primary-key-set hashes.
- Import requires distinct normalized source/target identities and an explicit quiescence evidence file.

- [ ] **Step 1: Write failing Pester tests for native failures and identity comparison**

Test source/target URLs on the same server/database are rejected even when query-string/order differs; a failing fake `pg_dump`/`pg_restore`/`psql` throws; missing/old quiescence evidence rejects import; checksum mismatch rejects; and cleanup cannot remove a name without the rehearsal prefix.

- [ ] **Step 2: Run and observe current script defects**

Run: `Invoke-Pester ops/tests/PostgresTools.Tests.ps1 -Output Detailed`

Expected: FAIL, including the existing PowerShell array-comparison behavior.

- [ ] **Step 3: Implement typed helpers and fail-closed scripts**

`PostgresTools.psm1` exports:

```powershell
function Invoke-NativeChecked([string]$File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File failed with exit code $LASTEXITCODE" }
}
function Get-DatabaseIdentity([uri]$DatabaseUrl) {
  [pscustomobject]@{ Host=$DatabaseUrl.DnsSafeHost.ToLowerInvariant(); Port=$DatabaseUrl.Port; Database=$DatabaseUrl.AbsolutePath.TrimStart('/').ToLowerInvariant() }
}
function Assert-RehearsalName([string]$Name) {
  if (-not $Name.StartsWith('docai_rehearsal_')) { throw 'Unsafe rehearsal resource name' }
}
```

Backup creates both a full custom archive and a custom data-only archive using `pg_dump --format=custom --no-owner --no-privileges`; the data-only command adds `--exclude-table=_prisma_migrations`. It creates SHA-256 files for both archives, records PostgreSQL version/schema/tables/counts/ordered primary-key SHA-256 hashes, and includes the source identity. Import verifies checksums and identities, requires quiescence evidence younger than 15 minutes with zero application writers, runs the empty-target guard plus `prisma migrate resolve --applied 20250608000000_rename_ollama_to_lmstudio` and `prisma migrate deploy`, then restores the pre-filtered data archive with `pg_restore --data-only --single-transaction --exit-on-error`. The baseline helper refuses any target containing application tables and is never used for existing Prisma-managed databases. Verification compares every source table count and primary-key hash with a documented `User +1 system-owner` exception, checks target-only `UserDocumentProfile=0` and populated `_prisma_migrations`, checks IDs for Document/Chunk/Feedback/Template, asserts imported documents and templates use `system-owner` and imported templates are `REJECTED`, validates all FKs, and asserts required summary/ownership/template columns.

- [ ] **Step 4: Rerun Pester tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ops/backup-postgres.ps1 ops/import-postgres-data.ps1 ops/verify-postgres.ps1 ops/lib/PostgresTools.psm1 ops/tests/PostgresTools.Tests.ps1 docs/database-cutover.md
git commit -m "fix: fail closed during database cutover operations"
```

### Task 7: Rehearse the Full Cutover on Disposable Infrastructure

**Files:**
- Create: `ops/rehearse-cutover.ps1`
- Create: `ops/fixtures/legacy-schema.sql`
- Create: `ops/fixtures/legacy-data.sql`
- Create: `ops/tests/RehearseCutover.Tests.ps1`

**Interfaces:**
- Produces one command: `pwsh -File ops/rehearse-cutover.ps1`.

- [ ] **Step 1: Create a legacy fixture with stable IDs and expected counts**

Fixture contains the legacy application tables and no `_prisma_migrations` or new summary/ownership/compiler columns. Its exact expected counts are `User=1`, `UserLLMConfig=1`, `Document=2`, `Chunk=3`, `Feedback=1`, `Template=1`, `TrainingJob=1`, and `ModelVersion=1`; every row uses a committed deterministic UUID recorded in the Pester constants.

- [ ] **Step 2: Write the failing end-to-end rehearsal test**

The Pester test runs the script and asserts: unique source/target containers and volumes; source receives fixture only; backup checksum/manifest exist; target starts empty; `prisma migrate deploy` succeeds; data-only import excludes migrations; IDs/counts/hash/FKs pass; documents/templates have system owner; required columns exist; backend migration startup command exits 0; cleanup removes only prefixed rehearsal resources.

- [ ] **Step 3: Implement orchestration with `try/finally` and checked commands**

Create names from UTC timestamp plus random suffix, call `Assert-RehearsalName` before every cleanup operation, publish random loopback ports, wait with bounded readiness polling, and pass URLs explicitly—never load the root `.env`. Generate quiescence evidence after fixture loading and before backup. Save logs under a temporary rehearsal directory and redact URL passwords.

- [ ] **Step 4: Run the rehearsal twice**

Run: `Invoke-Pester ops/tests/RehearseCutover.Tests.ps1 -Output Detailed`; then `pwsh -File ops/rehearse-cutover.ps1`.

Expected: both PASS; `docker volume ls` shows no leaked `docai_rehearsal_` volume.

- [ ] **Step 5: Commit**

```bash
git add ops/rehearse-cutover.ps1 ops/fixtures ops/tests/RehearseCutover.Tests.ps1
git commit -m "test: rehearse non-destructive Prisma cutover"
```

### Task 8: Remove Secret Artifacts and Normalize Documentation/Environment

**Files:**
- Delete without reading/printing: `.runtime_env.txt`
- Modify: `.gitignore`
- Modify: `.env.example`
- Modify: `backend/.env.example`
- Modify: `README.md`
- Modify: `docs/database-cutover.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Documents user-only accounts/settings/templates, required renderer license/fonts, exact local-provider allowlist, readiness endpoints, and rollback retention.

- [ ] **Step 1: Add a failing secret/config scan**

Run: `git check-ignore .runtime_env.txt`; `rg -n "ADMIN_|LORA_|/api/admin|template-service|./templates:/app/templates|ALLOW_DEV_AUTH" .env.example backend/.env.example README.md CLAUDE.md docker-compose.yml docs/database-cutover.md`.

Expected before cleanup: ignore check fails and obsolete references are found.

- [ ] **Step 2: Remove the artifact safely and update ignore rules**

Resolve `.runtime_env.txt`, verify its absolute path is inside the repository root, and remove it without displaying contents. Add `.runtime_env.txt`, `fonts/`, `licenses/`, and renderer-generated storage to `.gitignore`. If any value in the artifact was used outside disposable verification, rotate it before deployment.

- [ ] **Step 3: Normalize examples and documentation**

Remove admin/LoRA/static-template variables and routes. Add `LOCAL_LLM_HOST_ALLOWLIST=host.docker.internal:1234`, `DOCUMENT_RENDERER_URL=http://document-renderer:8080`, `RENDERER_SERVICE_TOKEN`, `ASPOSE_LICENSE_PATH`, `RENDERER_FONT_DIR`, and `RENDERER_REQUIRED_FONTS=Times New Roman`. Document `/signup`, `/login`, settings, private templates, analysis states, fidelity rejection, `/live` vs `/ready`, disposable rehearsal, final writer quiescence, backend-only rebuild, and rollback window.

- [ ] **Step 4: Rerun scans and whitespace check**

Run Step 1 again, then `git diff --check`.

Expected: `.runtime_env.txt` is ignored/absent, no obsolete runtime references remain outside historical docs/specs/plans, and whitespace check passes.

- [ ] **Step 5: Commit**

```bash
git add -A .runtime_env.txt .gitignore .env.example backend/.env.example README.md docs/database-cutover.md CLAUDE.md
git commit -m "docs: secure deployment configuration"
```

### Task 9: Resolve Dependency Findings and Add One Verification Command

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `ops/verify-all.ps1`
- Modify: `README.md`

**Interfaces:**
- Produces: `pwsh -File ops/verify-all.ps1` with immediate failure and summarized command status.

- [ ] **Step 1: Capture audit failures without applying force downgrades**

Run: `cd backend && npm audit --audit-level=moderate`; `cd frontend && npm audit --audit-level=moderate`.

Expected before updates: frontend reports the known moderate/high dependency chain or version mismatch. Save package names/advisory IDs in commit notes, not secrets.

- [ ] **Step 2: Apply compatible direct updates and rerun focused suites**

Use `npm install` with explicit compatible versions; do not run `npm audit fix --force`. Keep Next/React/ESLint/Vitest versions pinned by Phase 3 and update backend packages only within compatible majors unless a migration is tested. Run backend and frontend tests/builds after each lockfile update.

- [ ] **Step 3: Implement the aggregate verifier**

`verify-all.ps1` uses `Invoke-NativeChecked` and runs, in order: backend tests/Prisma/build/audit; frontend tests/lint/build/audit; renderer test/build; Python tests/compileall; Compose config; migration-integrity test; Pester unit tests; `git diff --check`. It accepts `-IncludeCutoverRehearsal` to add Task 7; default never starts containers.

- [ ] **Step 4: Run both verification modes**

Run: `pwsh -File ops/verify-all.ps1`; then `pwsh -File ops/verify-all.ps1 -IncludeCutoverRehearsal`.

Expected: PASS with a status line for every command and no live service mutation.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json ops/verify-all.ps1 README.md
git commit -m "chore: close dependency and verification gates"
```

### Task 10: Final Integrated Review Without Live Cutover

**Files:**
- Modify only if verification finds a defect: files directly responsible for that defect
- Create: `docs/verification/2026-07-13-hardening-results.md`

**Interfaces:**
- Produces an evidence record with command, exit code, timestamp, and concise result; contains no secrets or absolute credential-bearing URLs.

- [ ] **Step 1: Run the full verifier with rehearsal**

Run: `pwsh -File ops/verify-all.ps1 -IncludeCutoverRehearsal`.

Expected: PASS.

- [ ] **Step 2: Use systematic debugging for any failure**

For each failure, reproduce with the smallest focused command, identify root cause, write a regression test, implement the minimum fix, and rerun the focused command before rerunning the aggregate verifier. Do not weaken assertions or skip license/font/fidelity tests.

- [ ] **Step 3: Run manual isolated service smoke checks**

Build images, start only uniquely named rehearsal services, verify PostgreSQL/Redis/Docling/embeddings/renderer/backend readiness, create two users, prove cross-user document/template/feedback 404s, compile the representative DOCX, generate/export it, and verify its fidelity report. Do not run `docker compose up` against the live project name.

- [ ] **Step 4: Record fresh evidence and inspect the final diff**

Write exact commands/timestamps/results to the verification document. Run `git diff --check`, `git status --short`, and inspect `git diff --stat` plus every security/migration/Compose change. Confirm old live image/volume is still present and was never labeled validated.

- [ ] **Step 5: Commit verification evidence**

```bash
git add docs/verification/2026-07-13-hardening-results.md
git commit -m "test: record project hardening verification"
```
