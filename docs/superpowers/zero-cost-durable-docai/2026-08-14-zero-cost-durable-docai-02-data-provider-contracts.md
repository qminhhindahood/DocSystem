# Zero-Cost Durable DocAI Data and Provider Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish additive, migration-safe Neon contracts for generation jobs, processing jobs, capacity observations, and simultaneous OpenRouter/Gemini configuration, then expose matching repository, API, and frontend types.

**Architecture:** Prisma declares durable records while hand-reviewed SQL preserves legacy data and adds database constraints/indexes. Repository methods perform owner scoping, idempotency, leases, monotonic checkpoints, conditional completion, and serialized per-user generation claims. Provider settings use one row per user/provider plus an active configuration foreign key; keys stay encrypted and deletions erase key material while retaining referenced tombstones.

**Tech Stack:** TypeScript 7, Prisma 5.22/PostgreSQL 15/pgvector, Express 4, Jest 29/Supertest, Next.js 16, React 19, Vitest 4.

**Spec:** `docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-design.md`

## Global Constraints

- Plan 01 must have an accepted `GO` decision before this plan is merged.
- Database changes are additive through public reopening and the observation window.
- Published migrations are immutable; create new migration directories and extend integrity tests.
- `GenerationJob` and `ProcessingJob` use UUID primary keys, six exact states, dispatch generation 0–3, work attempt 0–3, 90-second leases, monotonic progress, bounded safe errors, and terminal timestamps.
- Idempotency uniqueness is `(ownerId, operationType, idempotencyKey)` and a repeated key with a different request hash is a conflict.
- A generation job references a provider configuration and snapshots provider/model; it never stores key ciphertext or plaintext.
- `ProcessingJob` snapshots immutable object generation and SHA-256 for new work.
- Legacy `IngestionJob` data is preserved until post-reopen cleanup; migration refuses a nonterminal legacy row at cutover rather than inventing a source checksum.
- Only `openrouter` and `gemini` are selectable production providers. Production callers cannot supply a base URL.
- Provider save, rotation, and deletion return `409 CONFIG_IN_USE` while a nonterminal generation job references the row.
- Provider deletion clears all encrypted key columns, sets `deletedAt`, and leaves a foreign-key-safe tombstone.
- Model catalogs cache for ten minutes and use an HMAC credential fingerprint; plaintext keys and raw hashes never enter storage or logs.
- Every browser-facing query and mutation is owner-scoped.
- Use red-green TDD, focused tests, package build/typecheck, and task-scoped commits.

---

## File Map

- Create `backend/src/types/jobs.ts`: shared backend job states, stages, payloads, and repository DTOs.
- Modify `backend/prisma/schema.prisma`: durable job, preference, and snapshot models and relations.
- Create `backend/prisma/migrations/20260814000000_add_durable_jobs_provider_preferences/migration.sql`: additive schema/backfill.
- Modify `backend/scripts/check_migration_integrity.test.ts`: migration order and safety assertions.
- Create `backend/src/services/generation_job_repository.ts`: generation persistence and atomic claims.
- Create `backend/src/services/generation_job_repository.test.ts`.
- Create `backend/src/services/processing_job_repository.ts`: processing persistence and claims.
- Create `backend/src/services/processing_job_repository.test.ts`.
- Create `backend/src/services/capacity_snapshot_repository.ts`.
- Create `backend/src/services/capacity_snapshot_repository.test.ts`.
- Modify `backend/src/services/llm_config_service.ts`: active configuration resolution and tombstones.
- Modify `backend/src/routes/llm-settings.ts`: provider-scoped endpoints.
- Create `backend/src/services/gemini_models.ts`.
- Create `backend/src/services/gemini_models.test.ts`.
- Modify `backend/src/services/openrouter_models.ts`.
- Modify `backend/src/routes/llm-settings.contract.test.ts`.
- Modify `backend/src/services/llm_config_service_urls.test.ts`.
- Modify `backend/src/services/llm_config_security.test.ts`.
- Modify `frontend/types/api.ts`: safe provider DTOs.
- Modify `frontend/lib/settings-api.ts`: provider-scoped client calls.
- Modify `frontend/lib/llm-providers.ts`: two-provider registry.
- Modify `frontend/components/settings/LLMProviderForm.tsx`: one provider card.
- Modify `frontend/components/settings/LLMSettingsForm.tsx`: simultaneous cards and activation.
- Modify `frontend/test/settings-dialogs.test.tsx`.
- Modify `frontend/test/settings-page.test.tsx`.
- Create `frontend/test/llm-providers.test.ts`.

---

### Task 1: Define Job Types and the Additive Prisma Migration

**Files:**

- Create: `backend/src/types/jobs.ts`
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260814000000_add_durable_jobs_provider_preferences/migration.sql`
- Modify: `backend/scripts/check_migration_integrity.test.ts`

**Interfaces:**

- Consumes: current `User`, `Document`, `Template`, `IngestionJob`, and `UserLLMConfig` models.
- Produces:
  - `JobState`, `GenerationOperation`, `ProcessingOperation`
  - `GenerationStage`, `ProcessingStage`
  - `TaskPayload`
  - `TaskMetadata`, `WorkFailure`
  - Prisma models `GenerationJob`, `ProcessingJob`, `CapacitySnapshot`, `UserLLMPreference`
  - migrated `UserLLMConfig`.

- [ ] **Step 1: Write failing migration-integrity assertions**

Append exact checks to `backend/scripts/check_migration_integrity.test.ts`:

~~~typescript
const durableJobsMigration =
  '20260814000000_add_durable_jobs_provider_preferences';

test('durable jobs migration is additive and preserves legacy ingestion rows', () => {
  const sql = migrationSql(durableJobsMigration);
  expect(sql).toContain('CREATE TABLE "GenerationJob"');
  expect(sql).toContain('CREATE TABLE "ProcessingJob"');
  expect(sql).toContain('CREATE TABLE "CapacitySnapshot"');
  expect(sql).toContain('CREATE TABLE "UserLLMPreference"');
  expect(sql).toContain('INSERT INTO "ProcessingJob"');
  expect(sql).toContain('FROM "IngestionJob"');
  expect(sql).toContain("RAISE EXCEPTION 'Nonterminal legacy ingestion jobs must be drained'");
  expect(sql).not.toMatch(/DROP TABLE "IngestionJob"|TRUNCATE|DELETE FROM "IngestionJob"/i);
  expect(sql).not.toMatch(/DROP TABLE "UserLLMConfig"/i);
  expect(sql).toContain('"lastDispatchCheckAt"');
  expect(sql).toContain('"CapacityPolicy"');
  expect(sql).toContain('"policy"');
  expect(sql).toContain('UNIQUE ("metric", "releaseId", "accountIdentityHash")');
});

test('provider preference points to a config and job foreign keys restrict deletion', () => {
  const sql = migrationSql(durableJobsMigration);
  expect(sql).toContain('UNIQUE ("userId", "provider")');
  expect(sql).toContain('FOREIGN KEY ("activeConfigId") REFERENCES "UserLLMConfig"("id")');
  expect(sql).toContain('FOREIGN KEY ("providerConfigId") REFERENCES "UserLLMConfig"("id") ON DELETE RESTRICT');
});
~~~

- [ ] **Step 2: Run the migration test and verify failure**

Run:

~~~powershell
npm --prefix backend test -- --runInBand scripts/check_migration_integrity.test.ts
~~~

Expected: FAIL because the migration is not present.

- [ ] **Step 3: Create the exact backend type contract**

`backend/src/types/jobs.ts` exports:

~~~typescript
export const JOB_STATES = [
  'dispatch_pending', 'queued', 'running', 'succeeded', 'failed', 'cancelled',
] as const;
export type JobState = typeof JOB_STATES[number];

export const GENERATION_STAGES = [
  'accepted', 'queued', 'worker_claimed', 'preparing_references',
  'filling_fields', 'retrieving', 'drafting', 'validating',
  'rendering', 'saving', 'succeeded',
] as const;
export type GenerationStage = typeof GENERATION_STAGES[number];

export const PROCESSING_STAGES = [
  'accepted', 'queued', 'checking_pdf', 'extracting_text', 'ocr_pages',
  'structural_recovery', 'chunking', 'embedding', 'analyzing_template',
  'generating_preview', 'persisting', 'ready',
] as const;
export type ProcessingStage = typeof PROCESSING_STAGES[number];

export type GenerationOperation =
  | 'template_generation'
  | 'freeform_generation';
export type ProcessingOperation =
  | 'document_ingestion'
  | 'template_compilation';
export type TaskOperation = 'generation' | 'processing';
export type CapacityPolicy = 'progressive' | 'hard_limit';

export interface TaskPayload {
  jobId: string;
  operation: TaskOperation;
}

export interface TaskMetadata {
  taskName: string;
  queueName: string;
  retryCount: number;
  executionCount: number;
}

export type WorkFailure =
  | { kind: 'transient'; code: string; safeMessage: string }
  | { kind: 'terminal'; code: string; safeMessage: string };

export interface ProgressCheckpoint<S extends string> {
  stage: S;
  confirmedProgress: number;
  stageCurrent?: number;
  stageTotal?: number;
  expectedProgressVersion: number;
}
~~~

Also export the immutable stage-floor maps exactly as design sections 10.1 and 10.2.

- [ ] **Step 4: Modify Prisma schema with exact fields and relations**

Use Prisma enums for state, operations, provider, stages, and `CapacityPolicy` (`progressive`, `hard_limit`). `GenerationJob` includes every field from design section 7.1. Store `input`, `lockedFields`, `providerSnapshot`, `modelSnapshot`, `persistedDraft`, `validationSummary`, and `timings` with the documented nullable/bounded semantics. Add:

~~~prisma
@@unique([ownerId, operationType, idempotencyKey])
@@index([ownerId, createdAt])
@@index([state, availableAt])
@@index([leaseExpiresAt])
@@index([providerConfigId, state])
@@index([completedAt])
~~~

`ProcessingJob` includes every field from design section 7.3 plus `legacyImported Boolean @default(false)` so terminal migrated rows may retain unknown historical object generations without weakening new-work validation. Add the same idempotency, state/availability, lease, and retention indexes.

For both job models, `taskName` is required for every newly created row, `taskCreatedAt` is nullable until Cloud Tasks acknowledges creation, and `lastDispatchCheckAt` is nullable. The additive migration supplies the deterministic generation-zero task name for imported rows before applying the non-null constraint. The two dispatch-generation constraints are inclusive 0 through 3.

`CapacitySnapshot` uses:

~~~prisma
model CapacitySnapshot {
  id                  String   @id @default(uuid())
  metric              String
  policy              CapacityPolicy
  measuredValue       Decimal  @db.Decimal(30, 6)
  unit                String
  internalCeiling     Decimal  @db.Decimal(30, 6)
  officialAllowance   Decimal? @db.Decimal(30, 6)
  accountIdentityHash String
  source              String
  observedAt          DateTime
  validUntil          DateTime
  releaseId           String
  safeCollectionError String?
  createdAt           DateTime @default(now())

  @@unique([metric, releaseId, accountIdentityHash])
  @@index([metric, observedAt])
  @@index([validUntil])
}
~~~

Change `User.llmConfig` to `llmConfigs UserLLMConfig[]` and add `llmPreference UserLLMPreference?`. Change `UserLLMConfig.userId @unique` to `@@unique([userId, provider])`, add `deletedAt DateTime?`, and keep encrypted key columns nullable only so cryptographic deletion can clear them. `UserLLMPreference.activeConfigId` is nullable and unique.

- [ ] **Step 5: Write the hand-reviewed SQL migration**

The SQL must:

1. create enums and tables with `CHECK` constraints for percentages, attempts, dispatch generations, paired stage counters, terminal timestamps, result requirements, and operation-specific document/template IDs;
2. drop only the old `UserLLMConfig_userId_key` index and create `(userId, provider)` uniqueness;
3. preserve every provider row without re-encryption;
4. create a preference for an existing `openrouter` or `gemini` row and leave unsupported legacy providers unselected;
5. abort if any legacy `IngestionJob.status` is not `completed` or `failed`;
6. copy every legacy row into `ProcessingJob` using the same UUID, attempts, availability, errors, and completion timestamp;
7. set `legacyImported = true`, `sourceGeneration = NULL`, and `sourceSha256 = NULL` only for those terminal historical rows;
8. retain `IngestionJob`; and
9. create all foreign keys with explicit delete behavior.

Add database checks that new nonterminal processing rows have a 64-hex SHA-256 and nonempty source generation, while terminal `legacyImported` rows are the only exception.

- [ ] **Step 6: Generate Prisma and run the migration tests**

Run:

~~~powershell
npm --prefix backend run prisma:generate
npm --prefix backend test -- --runInBand scripts/check_migration_integrity.test.ts
npm --prefix backend run check-schema
npm --prefix backend run build
git diff --check
~~~

Expected: migration tests, schema sync, and TypeScript build pass.

- [ ] **Step 7: Commit**

~~~powershell
git add -- backend/src/types/jobs.ts backend/prisma/schema.prisma backend/prisma/migrations/20260814000000_add_durable_jobs_provider_preferences/migration.sql backend/scripts/check_migration_integrity.test.ts
git commit -m "feat: add durable job and provider data contracts"
~~~

---

### Task 2: Implement Generation, Processing, and Capacity Repositories

**Files:**

- Create: `backend/src/services/generation_job_repository.ts`
- Create: `backend/src/services/generation_job_repository.test.ts`
- Create: `backend/src/services/processing_job_repository.ts`
- Create: `backend/src/services/processing_job_repository.test.ts`
- Create: `backend/src/services/capacity_snapshot_repository.ts`
- Create: `backend/src/services/capacity_snapshot_repository.test.ts`

**Interfaces:**

- Consumes: Prisma models and `backend/src/types/jobs.ts`.
- Produces:

~~~typescript
export type GenerationClaim =
  | { kind: 'claimed'; job: ClaimedGenerationJob }
  | { kind: 'terminal' | 'leased' | 'deferred' | 'user_capacity'
      | 'exhausted' | 'identity_mismatch' | 'not_claimable' };

export type GenerationJobRecord =
  Prisma.GenerationJobGetPayload<Prisma.GenerationJobDefaultArgs>;
export type ClaimedGenerationJob = GenerationJobRecord & {
  state: 'running'; leaseOwner: string; leaseExpiresAt: Date;
};

export interface CreateGenerationJobInput {
  ownerId: string;
  operationType: GenerationOperation;
  idempotencyKey: string;
  requestHash: string;
  input: Record<string, unknown>;
  lockedFields: string[];
  providerConfigId: string;
  providerSnapshot: 'openrouter' | 'gemini';
  modelSnapshot: string;
  referenceDocumentIds: string[];
  taskName: string;
}

export interface GenerationResult {
  resultDocumentId: string;
  resultStorageKey: string;
  resultSha256: string;
  timings: Record<string, number>;
}

export type DispatchCheck =
  | { kind: 'reserved'; taskName: string; dispatchGeneration: number;
      state: 'dispatch_pending' | 'queued'; taskCreatedAt: Date | null }
  | { kind: 'throttled' | 'leased' | 'terminal' | 'changed' };

export interface GenerationJobRepository {
  findOwned(jobId: string, ownerId: string): Promise<GenerationJobRecord | null>;
  findIdempotent(ownerId: string, operation: GenerationOperation,
    idempotencyKey: string): Promise<GenerationJobRecord | null>;
  create(input: CreateGenerationJobInput): Promise<GenerationJobRecord>;
  markQueued(jobId: string, dispatchGeneration: number,
    taskName: string, now: Date): Promise<boolean>;
  markDispatchFailed(jobId: string, reason: string): Promise<boolean>;
  recordDelivery(jobId: string, taskName: string, deliveryOrdinal: number):
    Promise<'recorded' | 'identity_mismatch' | 'not_found'>;
  reserveDispatchCheck(jobId: string, now: Date, minimumIntervalMs: number):
    Promise<DispatchCheck>;
  advanceDispatchGeneration(jobId: string, expectedGeneration: number,
    nextTaskName: string, now: Date):
    Promise<{ generation: number } | 'exhausted' | 'changed'>;
  claim(jobId: string, taskName: string, workerId: string,
    now: Date, leaseMs: number):
    Promise<GenerationClaim>;
  renewLease(jobId: string, workerId: string, now: Date, leaseMs: number):
    Promise<boolean>;
  checkpoint(jobId: string, workerId: string,
    value: ProgressCheckpoint<GenerationStage>): Promise<boolean>;
  requestCancellation(jobId: string, ownerId: string, now: Date):
    Promise<'requested' | 'already_terminal' | 'not_found'>;
  retryOrFail(jobId: string, workerId: string, failure: WorkFailure, now: Date):
    Promise<'retrying' | 'failed' | 'lease_lost'>;
  complete(jobId: string, workerId: string, result: GenerationResult,
    now: Date): Promise<'completed' | 'cancelled' | 'lease_lost'>;
}
~~~

`ProcessingJobRepository` has the same create, dispatch-reservation, persisted-next-task-name, lease, checkpoint, cancel, retry, and completion shapes, with `ProcessingStage`, but its claim has no per-owner generation count. Its create input requires `sourceGeneration`, `sourceSha256`, and the deterministic generation-zero `taskName`. `CapacitySnapshotRepository.latest(metric, expectedReleaseId, expectedAccountIdentityHash, now)` returns only a matching unexpired, error-free snapshot; `put` requires a valid `CapacityPolicy`, finite nonnegative measurement, positive internal ceiling, nullable positive official allowance, ratio no greater than one, and `validUntil > observedAt`. The importer uses an all-or-nothing transaction over idempotent upserts keyed by metric, release, and account hash.

- [ ] **Step 1: Write failing generation repository tests**

Include this SQL contract assertion:

~~~typescript
it('serializes the per-owner running cap before counting', async () => {
  const client = { $transaction: jest.fn() };
  const repository = createGenerationJobRepository(client as never);
  await repository.claim('job-1', 'worker-1', new Date(), 90_000).catch(() => undefined);
  const sql = capturedSql(client);
  expect(sql).toContain('pg_advisory_xact_lock');
  expect(sql).toContain('COUNT(*)');
  expect(sql).toContain(`"state" = 'running'`);
  expect(sql).toContain('>= 2');
});
~~~

Also cover:

- same idempotency hash returns the original job;
- different hash is surfaced for `IDEMPOTENCY_CONFLICT`;
- terminal/actively leased jobs are no-ops;
- a task may claim `dispatch_pending` only when its authenticated task name equals the persisted taskName;
- a mismatched task identity performs no work;
- delivery telemetry uses a monotonic maximum and never increments `workAttempt`;
- future `availableAt` and owner capacity do not increment `workAttempt`;
- a real claim increments once and sets a 90-second lease;
- expired leases are reclaimable;
- attempts stop at three;
- progress version/percentage cannot regress;
- completion requires current lease and no cancellation;
- all reconciliation callers share the atomic `lastDispatchCheckAt` throttle;
- advancing dispatch persists the next task name before any external CreateTask call; and
- a delayed `markQueued` cannot regress running or terminal state/progress after the task wins the enqueue race; and
- dispatch generation 3 is the final bounded task identity and cannot advance to 4.

- [ ] **Step 2: Run tests and verify failure**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/services/generation_job_repository.test.ts
~~~

Expected: FAIL because the repository is absent.

- [ ] **Step 3: Implement generation repository in conditional SQL**

Use parameterized `Prisma.sql` only. The claim transaction must:

~~~sql
SELECT pg_advisory_xact_lock(hashtextextended("ownerId", 71702481))
FROM "GenerationJob" WHERE "id" = $1;

SELECT count(*) FROM "GenerationJob"
WHERE "ownerId" = $2 AND "state" = 'running';
~~~

Lock the job row first, reject a task-name mismatch, accept only `queued` or the matching `dispatch_pending` crash-window state, then take the owner advisory lock and count. The final update includes the expected state/lease predicates and returns the complete claimed row. A hash collision may reduce concurrency but must never increase it.

`reserveDispatchCheck` conditionally writes `lastDispatchCheckAt` in the same transaction used to decide whether a caller owns the next check. `advanceDispatchGeneration` conditionally writes both the incremented generation and `nextTaskName`, clears `taskCreatedAt`, and commits before the caller invokes Cloud Tasks.

`checkpoint` uses one conditional update requiring matching lease owner, unexpired lease, greater `progressVersion`, nondecreasing `confirmedProgress`, and valid paired stage counters.

- [ ] **Step 4: Write and implement processing repository tests**

The focused test proves source identity is immutable:

~~~typescript
it('never updates source generation or checksum after creation', async () => {
  const client = fakeProcessingClient();
  const repository = createProcessingJobRepository(client as never);
  await repository.checkpoint('job-1', 'worker-1', {
    stage: 'extracting_text', confirmedProgress: 20, expectedProgressVersion: 1,
  });
  expect(serializedQueries(client)).not.toMatch(/sourceGeneration|sourceSha256/);
});
~~~

Processing claims exact IDs from task payloads; never implement `claimNextJob` polling. Duplicate terminal delivery returns `terminal`. Completion for ingestion replaces chunks and updates `Document` in the same transaction; template completion updates `Template` in the same transaction.

- [ ] **Step 5: Write and implement capacity snapshot tests**

~~~typescript
it('returns null for stale or errored capacity evidence', async () => {
  const repo = createCapacitySnapshotRepository(fakeClient({
    observedAt: new Date('2026-08-14T00:00:00Z'),
    validUntil: new Date('2026-08-14T06:00:00Z'),
    safeCollectionError: null,
  }) as never);
  await expect(repo.latest('cloudRunCpuSeconds', RELEASE_SHA, ACCOUNT_HASH,
    new Date('2026-08-14T06:00:00Z')))
    .resolves.toBeNull();
});
~~~

Also prove a fresh record from another release or account hash is rejected. Use database time for production writes; test-injected `now` exists only to make stale selection deterministic.

Add round-trip cases for both `progressive` and `hard_limit`, rejection of an unknown policy, acceptance of a hard-limit ratio exactly equal to one, and rejection of any persisted measurement above its ceiling.

- [ ] **Step 6: Run and commit**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/services/generation_job_repository.test.ts src/services/processing_job_repository.test.ts src/services/capacity_snapshot_repository.test.ts
npm --prefix backend run build
git diff --check
~~~

Expected: all repository tests and build pass.

Commit:

~~~powershell
git add -- backend/src/services/generation_job_repository.ts backend/src/services/generation_job_repository.test.ts backend/src/services/processing_job_repository.ts backend/src/services/processing_job_repository.test.ts backend/src/services/capacity_snapshot_repository.ts backend/src/services/capacity_snapshot_repository.test.ts
git commit -m "feat: add atomic durable job repositories"
~~~

---

### Task 3: Implement Provider-Scoped Configuration and Dynamic Catalog APIs

**Files:**

- Modify: `backend/src/services/llm_config_service.ts`
- Modify: `backend/src/routes/llm-settings.ts`
- Create: `backend/src/services/gemini_models.ts`
- Create: `backend/src/services/gemini_models.test.ts`
- Modify: `backend/src/services/openrouter_models.ts`
- Modify: `backend/src/routes/llm-settings.contract.test.ts`
- Modify: `backend/src/services/llm_config_service_urls.test.ts`
- Modify: `backend/src/services/llm_config_security.test.ts`

**Interfaces:**

- Consumes: `UserLLMConfig`, `UserLLMPreference`, and nonterminal job references.
- Produces:

~~~typescript
export type ProductionProvider = 'openrouter' | 'gemini';

export interface SafeLLMConfig {
  id: string;
  provider: ProductionProvider;
  model: string;
  hasApiKey: boolean;
  updatedAt: string;
}

export interface LLMSettingsView {
  configs: SafeLLMConfig[];
  activeConfigId: string | null;
}

export async function getLLMConfig(
  userId: string,
  configId?: string,
): Promise<LLMProviderConfig>;

export async function listGeminiModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<ModelCatalog>;
~~~

Routes:

| Method | Path | Body |
|---|---|---|
| GET | `/api/settings/llm` | none |
| PUT | `/api/settings/llm/:provider` | `{ apiKey?: string, model: string }` |
| POST | `/api/settings/llm/:provider/test` | `{ apiKey?: string, model: string }` |
| POST | `/api/settings/llm/:provider/models` | `{ apiKey?: string, query?: string }` |
| PUT | `/api/settings/llm/active` | `{ configId: UUID | null }` |
| DELETE | `/api/settings/llm/:provider` | `{ replacementConfigId?: UUID | null }` |

- [ ] **Step 1: Write failing coexistence and mutation-lock tests**

Add route tests:

~~~typescript
it('returns both provider summaries and the active config id', async () => {
  configFindMany.mockResolvedValue([
    savedConfig('cfg-or', 'openrouter'),
    savedConfig('cfg-g', 'gemini'),
  ]);
  preferenceFindUnique.mockResolvedValue({ activeConfigId: 'cfg-g' });
  const response = await request(app).get('/api/settings/llm').set(auth());
  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    configs: [
      expect.objectContaining({ id: 'cfg-or', provider: 'openrouter', hasApiKey: true }),
      expect.objectContaining({ id: 'cfg-g', provider: 'gemini', hasApiKey: true }),
    ],
    activeConfigId: 'cfg-g',
  });
  expect(JSON.stringify(response.body)).not.toMatch(/encrypted|apiKeyIv|apiKeyAuthTag|saved-secret/);
});

it.each(['PUT', 'DELETE'])('%s returns CONFIG_IN_USE for a referenced config', async method => {
  nonterminalJobCount.mockResolvedValue(1);
  const response = await issueProviderMutation(app, method, 'openrouter', auth());
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('CONFIG_IN_USE');
});
~~~

Add tests for explicit activation, same-provider saved-key reuse, cross-provider isolation, tombstone key erasure, unsupported provider rejection, and deleted-config resolution failure.

- [ ] **Step 2: Run tests and verify failure**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/routes/llm-settings.contract.test.ts src/services/llm_config_security.test.ts
~~~

Expected: FAIL because the old single-provider API does not satisfy the contract.

- [ ] **Step 3: Implement active configuration resolution and cryptographic soft deletion**

`getLLMConfig(userId, configId?)` resolves the explicit config for worker snapshots or the preference for new work, verifies ownership, supported provider, `deletedAt IS NULL`, and non-null encrypted key material, then decrypts.

Provider mutation executes in one transaction:

1. lock the configuration row;
2. count nonterminal generation references;
3. return `CONFIG_IN_USE` when count is nonzero;
4. for save/rotation, encrypt the submitted key or reuse only that same row's key;
5. for deletion, clear `encryptedApiKey`, `apiKeyIv`, and `apiKeyAuthTag`, set `deletedAt`, and atomically update preference to the validated replacement or null.

Never reuse a key from the other provider.

- [ ] **Step 4: Implement exact provider routes and compatibility removal**

Use `z.enum(['openrouter', 'gemini'])`; infer canonical base URLs server-side:

~~~typescript
const PROVIDER_BASE_URLS = {
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
} as const;
~~~

Return only `LLMSettingsView`. Remove the legacy root POST/DELETE and GET OpenRouter-only catalog after the provider-scoped route tests pass. Update the frontend proxy allowlist in Task 4 of this plan in the same commit as its client switch, so no shipped caller loses access.

- [ ] **Step 5: Implement the Gemini catalog and ten-minute credential cache**

Call `GET https://generativelanguage.googleapis.com/v1beta/models` with `x-goog-api-key` header and a 15-second timeout. Keep only models whose `supportedGenerationMethods` includes `generateContent`. Normalize:

~~~typescript
export interface CatalogModel {
  id: string;
  name: string;
  contextLength?: number;
  free?: boolean;
}
export interface ModelCatalog {
  models: CatalogModel[];
  fetchedAt: string;
  stale: boolean;
}
~~~

The cache key is:

~~~typescript
createHmac('sha256', encryptionKey)
  .update(provider)
  .update('\0')
  .update(apiKey)
  .digest('hex');
~~~

Never log the cache key. On catalog failure, the route returns the saved model as `stale: true` when one exists; it does not claim the model was observed.

- [ ] **Step 6: Run and commit**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/routes/llm-settings.contract.test.ts src/services/gemini_models.test.ts src/services/openrouter_models.test.ts src/services/llm_config_service_urls.test.ts src/services/llm_config_security.test.ts
npm --prefix backend run build
git diff --check
~~~

Expected: all provider tests pass and no response snapshot contains secret columns.

Commit:

~~~powershell
git add -- backend/src/services/llm_config_service.ts backend/src/routes/llm-settings.ts backend/src/services/gemini_models.ts backend/src/services/gemini_models.test.ts backend/src/services/openrouter_models.ts backend/src/routes/llm-settings.contract.test.ts backend/src/services/llm_config_service_urls.test.ts backend/src/services/llm_config_security.test.ts
git commit -m "feat: support simultaneous OpenRouter and Gemini configs"
~~~

---

### Task 4: Replace the Frontend's Single Provider Form with Explicit Provider Cards

**Files:**

- Modify: `frontend/types/api.ts`
- Modify: `frontend/lib/settings-api.ts`
- Modify: `frontend/lib/llm-providers.ts`
- Modify: `frontend/components/settings/LLMProviderForm.tsx`
- Modify: `frontend/components/settings/LLMSettingsForm.tsx`
- Modify: `frontend/app/api/proxy/[...path]/route.ts`
- Modify: `frontend/test/settings-dialogs.test.tsx`
- Modify: `frontend/test/settings-page.test.tsx`
- Modify: `frontend/test/proxy-policy.test.ts`
- Create: `frontend/test/llm-providers.test.ts`

**Interfaces:**

- Consumes: `LLMSettingsView` and provider-scoped routes from Task 3.
- Produces:

~~~typescript
export type LLMProviderId = 'openrouter' | 'gemini';
export interface ProviderCardState {
  provider: LLMProviderId;
  saved: SafeLLMConfig | null;
  selectedModel: string;
  keyInput: string;
  catalog: ModelCatalog | null;
  status: 'idle' | 'testing' | 'valid' | 'saving' | 'error';
}

export const getLLMSettings: () => Promise<LLMSettingsView>;
export const saveLLMProvider: (
  provider: LLMProviderId,
  input: { apiKey?: string; model: string },
) => Promise<SafeLLMConfig>;
export const activateLLMConfig: (configId: string | null) => Promise<void>;
export const deleteLLMProvider: (
  provider: LLMProviderId,
  replacementConfigId?: string | null,
) => Promise<void>;
~~~

- [ ] **Step 1: Write failing provider-card tests**

~~~tsx
it('keeps both saved providers and activates separately from saving', async () => {
  mockSettings({
    configs: [safeConfig('cfg-or', 'openrouter'), safeConfig('cfg-g', 'gemini')],
    activeConfigId: 'cfg-or',
  });
  render(<LLMSettingsForm />);
  expect(await screen.findByRole('heading', { name: /OpenRouter/i })).toBeVisible();
  expect(screen.getByRole('heading', { name: /Gemini/i })).toBeVisible();
  await user.click(screen.getByRole('button', { name: /Lưu Gemini/i }));
  expect(saveLLMProvider).toHaveBeenCalledWith('gemini', expect.any(Object));
  expect(activateLLMConfig).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /Dùng Gemini/i }));
  expect(activateLLMConfig).toHaveBeenCalledWith('cfg-g');
});
~~~

Also cover independent unsaved edits, saved-key reuse, catalog loading/empty/stale/error states, exact model ID display, delete replacement choice, and `CONFIG_IN_USE` messaging.

- [ ] **Step 2: Run tests and verify failure**

Run:

~~~powershell
npm --prefix frontend test -- --run test/llm-providers.test.ts test/settings-page.test.tsx test/settings-dialogs.test.tsx
~~~

Expected: FAIL because the UI assumes one mutable provider.

- [ ] **Step 3: Implement provider registry and typed client**

`frontend/lib/llm-providers.ts` exports exactly two immutable descriptors:

~~~typescript
export const LLM_PROVIDERS = [
  { id: 'openrouter', label: 'OpenRouter', keyLabel: 'OpenRouter API key' },
  { id: 'gemini', label: 'Gemini', keyLabel: 'Gemini API key' },
] as const;
~~~

The API client never persists key input in local/session storage and clears it after a successful save.

- [ ] **Step 4: Implement two independent cards and explicit activation**

Each card owns its edit buffer, test request, catalog, selected model, save, and delete dialog. The parent owns only the fetched settings and active ID. Saving a card refreshes safe summaries but does not activate. Activation has its own button and confirmation state.

Show:

- `Đang sử dụng` only when IDs match;
- `Đã lưu khóa` without key metadata;
- exact provider model ID;
- `Danh mục tạm thời không khả dụng` for a catalog error;
- saved model with `Dữ liệu đã lưu` when the catalog is stale; and
- `Cấu hình đang được công việc sử dụng` for `CONFIG_IN_USE`.

- [ ] **Step 5: Update the BFF proxy allowlist**

Replace the three legacy settings rules with:

~~~typescript
{ pattern: /^settings\/llm$/, methods: new Set(['GET']) },
{ pattern: new RegExp(`^settings\\/llm\\/${SEGMENT}$`), methods: new Set(['PUT', 'DELETE']) },
{ pattern: new RegExp(`^settings\\/llm\\/${SEGMENT}\\/(test|models)$`), methods: new Set(['POST']) },
{ pattern: /^settings\/llm\/active$/, methods: new Set(['PUT']) },
~~~

Add proxy-policy tests for every allowed method and one rejected arbitrary provider subpath.

- [ ] **Step 6: Run and commit**

Run:

~~~powershell
npm --prefix frontend test -- --run test/llm-providers.test.ts test/settings-page.test.tsx test/settings-dialogs.test.tsx test/proxy-policy.test.ts
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
git diff --check
~~~

Expected: focused tests, typecheck, lint, and production build pass.

Commit:

~~~powershell
git add -- frontend/types/api.ts frontend/lib/settings-api.ts frontend/lib/llm-providers.ts frontend/components/settings/LLMProviderForm.tsx frontend/components/settings/LLMSettingsForm.tsx 'frontend/app/api/proxy/[...path]/route.ts' frontend/test/settings-dialogs.test.tsx frontend/test/settings-page.test.tsx frontend/test/proxy-policy.test.ts frontend/test/llm-providers.test.ts
git commit -m "feat: add explicit multi-provider settings"
~~~

## Plan 02 Exit Gate

Run:

~~~powershell
npm --prefix backend test -- --runInBand scripts/check_migration_integrity.test.ts src/services/generation_job_repository.test.ts src/services/processing_job_repository.test.ts src/services/capacity_snapshot_repository.test.ts src/routes/llm-settings.contract.test.ts src/services/gemini_models.test.ts
npm --prefix backend run build
npm --prefix frontend test -- --run test/llm-providers.test.ts test/settings-page.test.tsx test/settings-dialogs.test.tsx test/proxy-policy.test.ts
npm --prefix frontend run typecheck
npm --prefix frontend run lint
git diff --check
~~~

Expected: all commands exit 0. Review the generated SQL before any non-disposable database receives it.
