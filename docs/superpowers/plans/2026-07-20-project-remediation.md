# Project Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagents are prohibited by repository instruction, so all steps execute inline.

**Goal:** Fix all ten reviewed deployment, durability, security, correctness, verification, and hygiene issues in the current working copy.

**Architecture:** Keep Next.js as the browser BFF and PostgreSQL as the durable ingestion queue. Add a leased, retrying ingestion worker that atomically claims jobs with PostgreSQL, while preserving the existing owner-scoped ingestion pipeline and RAG indexing behavior. Correct the remaining issues with narrow regression-tested changes.

**Tech Stack:** TypeScript, Express, Prisma/PostgreSQL, Jest, Next.js/React, Vitest, Python/FastAPI/pytest, PowerShell/Pester, Docker Compose, Nginx.

## Global Constraints

- Preserve all pre-existing modified and untracked user files; never reset or discard them.
- Do not use subagents.
- Use test-driven development for every behavioral change.
- Do not add BullMQ or another queue service.
- Do not expose renderer, Docling, or embeddings publicly.
- Do not commit implementation files that contain pre-existing user changes unless the user explicitly requests it.

---

### Task 1: Repair and contract-test production deployment

**Files:**
- Create: `ops/test-prod-compose.ps1`
- Create: `ops/tests/ProductionCompose.Tests.ps1`
- Modify: `deploy/docker-compose.prod.yml`
- Modify: `deploy/nginx/default.conf.template`
- Modify: `ops/verify-all.ps1`

**Interfaces:**
- Consumes: Docker Compose JSON from `docker compose -f deploy/docker-compose.prod.yml config --format json`.
- Produces: `ops/test-prod-compose.ps1`, a fail-closed contract command used by `verify-all.ps1`.

- [ ] **Step 1: Write failing production contract tests**

Assert that all build contexts and bind sources exist, BFF namespaces precede the generic API route, and service healthchecks use installed commands. The key assertions are:

```powershell
$buildServices = @('frontend','backend','docling','embeddings','document-renderer','nginx')
foreach ($service in $buildServices) {
  $context = $config.services.$service.build.context
  if (-not (Test-Path -LiteralPath $context)) { throw "Missing build context: $service -> $context" }
}
if ($nginx -notmatch 'location /api/session/' -or $nginx -notmatch 'location /api/proxy/') {
  throw 'Next.js BFF routes are not explicitly routed'
}
```

- [ ] **Step 2: Run the contract and verify it fails**

Run: `pwsh -NoProfile -File ops/test-prod-compose.ps1`

Expected: FAIL on `deploy/frontend` or another nonexistent context.

- [ ] **Step 3: Correct Compose paths, healthchecks, and Nginx precedence**

Use `../<service>` build contexts, `./nginx` for Nginx assets, and `curl` for the three Debian-based service healthchecks. Add exact BFF locations before the generic API location:

```nginx
location ~ ^/api/(session|proxy|analytics)/ {
    proxy_pass http://frontend:3000;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 900s;
    proxy_send_timeout 900s;
}
```

- [ ] **Step 4: Add the production contract to the main verifier**

Invoke `ops/test-prod-compose.ps1` in the existing Compose verification step and fail on a non-zero result.

- [ ] **Step 5: Run focused verification**

Run:

```powershell
pwsh -NoProfile -File ops/test-prod-compose.ps1
Invoke-Pester -Script ops/tests/ProductionCompose.Tests.ps1
```

Expected: all production deployment checks pass.

---

### Task 2: Add the durable ingestion job schema and migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260720000000_add_ingestion_jobs/migration.sql`
- Modify: `backend/scripts/check_migration_integrity.test.ts`

**Interfaces:**
- Produces: Prisma model `IngestionJob` related one-to-one with `Document` through `documentId`.
- Produces states: `queued | running | retrying | completed | failed`.

- [ ] **Step 1: Add failing migration integrity assertions**

Test for the table, unique document relation, due-job index, lease index, and cascade deletion:

```typescript
const sql = migrationSql('20260720000000_add_ingestion_jobs');
expect(sql).toContain('CREATE TABLE "IngestionJob"');
expect(sql).toContain('UNIQUE ("documentId")');
expect(sql).toContain('ON DELETE CASCADE');
expect(sql).toContain('"IngestionJob_status_availableAt_idx"');
expect(sql).toContain('"IngestionJob_leaseExpiresAt_idx"');
```

- [ ] **Step 2: Run the migration test and verify it fails**

Run: `npm test -- scripts/check_migration_integrity.test.ts --runInBand`

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Add the Prisma model and additive SQL migration**

Use this model contract:

```prisma
model IngestionJob {
  id             String    @id @default(uuid())
  documentId     String    @unique
  document       Document  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  status         String    @default("queued")
  attempts       Int       @default(0)
  maxAttempts    Int       @default(5)
  availableAt    DateTime  @default(now())
  leaseOwner     String?
  leaseExpiresAt DateTime?
  lastError      String?   @db.Text
  completedAt    DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([status, availableAt])
  @@index([leaseExpiresAt])
}
```

Add `ingestionJob IngestionJob?` to `Document`.

- [ ] **Step 4: Verify schema and migration**

Run:

```powershell
npx prisma format
npx prisma validate
npm run check-schema
npm test -- scripts/check_migration_integrity.test.ts --runInBand
```

Expected: all commands pass.

---

### Task 3: Implement the leased PostgreSQL ingestion worker

**Files:**
- Create: `backend/src/services/ingestion_job_repository.ts`
- Create: `backend/src/services/ingestion_job_repository.test.ts`
- Create: `backend/src/services/ingestion_worker.ts`
- Create: `backend/src/services/ingestion_worker.test.ts`
- Modify: `backend/src/services/ingestion_service.ts`
- Modify: `backend/src/services/ingestion_service.test.ts`
- Modify: `backend/src/index.ts`

**Interfaces:**
- `claimNextJob(workerId: string, leaseMs: number): Promise<ClaimedIngestionJob | null>`
- `renewLease(jobId: string, workerId: string, leaseMs: number): Promise<boolean>`
- `completeJob(jobId: string, workerId: string): Promise<boolean>`
- `retryOrFailJob(job: ClaimedIngestionJob, workerId: string, error: unknown): Promise<'retrying' | 'failed'>`
- `startIngestionWorker(options?): IngestionWorkerHandle`
- `IngestionWorkerHandle.stop(): Promise<void>`

- [ ] **Step 1: Write failing repository claim tests**

Cover due queued jobs, delayed retries, expired running leases, atomic ownership, attempt increments, lease-owner guarded renewal, and lease-owner guarded completion.

- [ ] **Step 2: Run repository tests and verify failure**

Run: `npm test -- src/services/ingestion_job_repository.test.ts --runInBand`

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement atomic PostgreSQL claims**

Use one parameterized raw query with `FOR UPDATE SKIP LOCKED`:

```sql
WITH candidate AS (
  SELECT "id" FROM "IngestionJob"
  WHERE (("status" IN ('queued','retrying') AND "availableAt" <= NOW())
    OR ("status" = 'running' AND "leaseExpiresAt" < NOW()))
    AND "attempts" < "maxAttempts"
  ORDER BY "availableAt", "createdAt"
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE "IngestionJob" AS job
SET "status"='running', "attempts"=job."attempts"+1,
    "leaseOwner"=$1, "leaseExpiresAt"=NOW()+($2 * INTERVAL '1 millisecond'),
    "updatedAt"=NOW()
FROM candidate WHERE job."id"=candidate."id"
RETURNING job.*;
```

Use Prisma parameter binding rather than string interpolation.

- [ ] **Step 4: Write failing worker lifecycle tests**

Use injected repository, processor, clock/timers, and cleanup function to cover heartbeat, success, retry backoff, terminal failure, expired-lease replay, polling, and graceful stop.

- [ ] **Step 5: Refactor ingestion to propagate failures and defer cleanup**

`processIngestion(documentId, access)` must throw after marking the current pipeline state/error; it must not remove the upload. Export `cleanupIngestionFile(documentId, access)` for worker-controlled terminal cleanup.

- [ ] **Step 6: Implement and start the worker**

Start after Redis initialization and before listening. On SIGTERM/SIGINT, stop the worker before disconnecting Prisma. Use a bounded poll interval, 15-minute lease, 30-second heartbeat, and retry delays of 5s, 30s, 2m, and 10m capped thereafter.

- [ ] **Step 7: Run worker and ingestion tests**

Run:

```powershell
npm test -- src/services/ingestion_job_repository.test.ts src/services/ingestion_worker.test.ts src/services/ingestion_service.test.ts --runInBand
npm run build
```

Expected: tests and TypeScript build pass.

---

### Task 4: Make upload creation transactional and validate PDF signatures

**Files:**
- Modify: `backend/src/routes/rag.ts`
- Modify: `backend/src/routes/rag.contract.test.ts`
- Modify: `docling-service/main.py`
- Modify: `docling-service/tests/test_upload_isolation.py`

**Interfaces:**
- Backend accepts only `.pdf`, `application/pdf`, size-limited buffers beginning `%PDF-`.
- One Prisma transaction creates both `Document` and `IngestionJob`.

- [ ] **Step 1: Add failing backend upload tests**

Add cases for a MIME-spoofed payload, wrong extension, transactional job creation, and no direct `processIngestion` call:

```typescript
formData.append('file', new Blob([Buffer.from('not-pdf')], { type: 'application/pdf' }), 'fake.pdf');
expect(response.status).toBe(400);
expect(mockTransaction).not.toHaveBeenCalled();
```

- [ ] **Step 2: Add failing Docling signature tests**

Assert `_validate_and_save(make_fake_upload('fake.pdf', b'not-pdf'))` raises HTTP 400 and leaves no file.

- [ ] **Step 3: Run focused tests and verify failure**

Run backend Jest and Docling pytest for the named files.

- [ ] **Step 4: Implement validation and transactional enqueue**

Validate `file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))`, then create both records inside `prisma.$transaction`. Remove the fire-and-forget call. Preserve orphan cleanup if file or transaction handling fails.

- [ ] **Step 5: Run focused tests**

Expected: backend and Docling upload tests pass.

---

### Task 5: Repair prompt-role and document-query boundaries

**Files:**
- Modify: `backend/src/routes/qa.ts`
- Modify: `backend/src/routes/qa.contract.test.ts`
- Modify: `backend/src/routes/documents.ts`
- Modify: `backend/src/routes/documents.contract.test.ts`

- [ ] **Step 1: Add failing QA role-separation test**

Capture LLM messages and assert the exact question appears only in a `role: 'user'` message and not the system content.

- [ ] **Step 2: Add failing document query-bound tests**

Cover `limit=20junk`, negative and over-10,000 offsets, search strings over 200 chars, and valid boundary values.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `npm test -- src/routes/qa.contract.test.ts src/routes/documents.contract.test.ts --runInBand`

- [ ] **Step 4: Implement the narrow fixes**

Remove the question block from `systemPrompt`. Add a Zod preprocessing/query schema that rejects partial integers and caps all reviewed parameters before building the Prisma query.

- [ ] **Step 5: Run focused tests and build**

Expected: tests and `npm run build` pass.

---

### Task 6: Restore the public-header design contract

**Files:**
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/test/design-system.test.ts`
- Modify: `frontend/test/landing-page.test.tsx`

- [ ] **Step 1: Replace the brittle count with a failing targeted assertion**

Render the landing page and assert its `header` has `surface-vibrant`, semantic sticky z-index, hairline border, and compact height. Remove only the `toHaveLength(8)` assertion; keep the legacy-decoration prohibition.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run test/design-system.test.ts test/landing-page.test.tsx`

- [ ] **Step 3: Implement the compact semantic header**

Remove `mixBlendMode: 'difference'` and the 80px height. Apply the existing semantic classes while preserving navigation behavior and accessible controls.

- [ ] **Step 4: Run frontend verification**

Run focused tests, full Vitest, lint, and build. Expected: zero failures and zero lint warnings.

---

### Task 7: Repair Python test setup and repository hygiene

**Files:**
- Create: `docling-service/requirements-dev.txt`
- Create: `embeddings-service/requirements-dev.txt`
- Modify: `README.md`
- Modify: `ops/verify-all.ps1`
- Modify: `add_header.py`
- Delete: `fix_poll.py`
- Delete: `fix_rename.py`
- Delete: `fix_similarity.py`
- Delete: `rename_similarity.py`

- [ ] **Step 1: Prove obsolete scripts have no consumers**

Run: `rg -n 'fix_poll|fix_rename|fix_similarity|rename_similarity' -g '!docs/**' -g '!ori/**' .`

Expected: only the scripts themselves.

- [ ] **Step 2: Add development dependency files**

Each contains:

```text
-r requirements.txt
pytest
pytest-asyncio
httpx
```

Update the README and verifier error message to point to `pip install -r <service>/requirements-dev.txt`.

- [ ] **Step 3: Make `add_header.py` portable and remove obsolete scripts**

Resolve its default template directory from `Path(__file__).resolve().parent / 'templates'` and preserve any CLI override. Delete only the four confirmed-unused mutation scripts.

- [ ] **Step 4: Verify hygiene**

Run:

```powershell
rg -n 'C:\\Users\\PC|Documents\\LLM' add_header.py backend frontend docling-service embeddings-service document-renderer ops deploy
python -m pytest docling-service/tests -q
python -m pytest embeddings-service/tests -q
```

Expected: no active workstation path; Python tests pass when dev dependencies are installed.

---

### Task 8: Full verification and handoff

**Files:** No planned source changes; fix only defects exposed by verification, test-first.

- [ ] **Step 1: Run backend verification**

Run tests, Prisma validation, schema sync, migration tests, build, and audit.

- [ ] **Step 2: Run frontend verification**

Run full tests, lint, build, and audit.

- [ ] **Step 3: Run service and operations verification**

Run Python tests, .NET tests/build if an SDK is available, root and production Compose contracts, Pester tests, and optional container smoke checks only when dependencies are available.

- [ ] **Step 4: Verify the worktree**

Run `git diff --check`, inspect `git status --short`, and confirm no unrelated user changes were staged, reverted, or overwritten.

- [ ] **Step 5: Report exact evidence and limitations**

Report pass/fail counts, unavailable toolchains, migrations added, files removed, and any remaining live-integration limitation. Do not claim unavailable checks passed.
