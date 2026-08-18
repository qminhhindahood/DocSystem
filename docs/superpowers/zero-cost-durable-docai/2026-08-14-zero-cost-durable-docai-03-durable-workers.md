# Zero-Cost Durable DocAI Workers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace in-process polling and synchronous heavy admission with fail-closed capacity checks, commit-before-dispatch Cloud Tasks delivery, owner-scoped durable-job APIs, and private idempotent generation and processing workers.

**Architecture:** The API validates and commits immutable jobs before enqueuing identifier-only Cloud Tasks. Separate worker processes claim exact job IDs from Neon, renew 90-second leases, enforce cancellation and three real attempts, and return HTTP status codes that leave delivery backoff with Cloud Tasks. Dispatch generation and reconciliation recover missing/exhausted tasks without unbounded redelivery.

**Tech Stack:** TypeScript 7, Express 4, Prisma 5/PostgreSQL, `@google-cloud/tasks`, `@google-cloud/storage`, Google OIDC/IAM, Jest 29/Supertest.

**Spec:** `docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-design.md`

## Global Constraints

- Plan 02 repository/type interfaces are immutable inputs to this plan.
- Job input canonical JSON is at most 64 KiB; prompt 16,384 characters; 128 fields; field keys 128 characters; scalar strings 8,192 characters; 128 locked fields; 20 reference IDs; no unknown top-level properties.
- Submission commits Neon before contacting Cloud Tasks and returns HTTP 202 even when dispatch remains pending.
- Task bodies contain exactly `jobId` and `operation`, serialize below 1 KiB, and never contain owner IDs, input, keys, provider/model, object paths, or document content.
- Task names are `generation-{jobId}-d{dispatchGeneration}` and `processing-{jobId}-d{dispatchGeneration}`.
- Enqueue makes one immediate attempt plus at most three retries at 100, 300, and 900 millisecond jittered delays: four CreateTask calls maximum.
- A missing task is replaced only after its retry window elapsed, `GetTask` returned NotFound, no lease is active, and dispatch generation can atomically advance.
- `dispatchGeneration` is inclusive 0 through 3: four bounded task identities and no generation 4.
- Every task name is committed with the job before CreateTask; all reconciliation callers share the persisted dispatch-check throttle.
- Generation claims use the repository's owner advisory lock and never exceed two running jobs per owner.
- Admission permits at most ten nonterminal generation jobs and 20 nonterminal processing jobs per owner.
- Capacity deferral and future `availableAt` return HTTP 429 without incrementing `workAttempt`.
- Duplicate terminal/actively leased deliveries return HTTP 204.
- Transient work failure returns HTTP 503 only when another real attempt remains; terminal outcomes persist and return HTTP 204.
- Authentication, quota, invalid input, missing configuration, cancellation, and deterministic validation are terminal.
- The worker internal deadline is 1,500 seconds; lease renewal failure aborts irreversible work.
- API and workers use a process database connection limit of five and pooled TLS Neon URLs.
- Redis failure is degraded only; it cannot fail readiness or durable work.
- No task queue or Cloud Run deployment occurs in this plan.

---

## File Map

- Modify `backend/package.json` and `backend/package-lock.json`: Cloud Tasks and Storage clients plus worker scripts.
- Create `backend/src/utils/canonical_json.ts` and tests: deterministic request hash.
- Create `backend/src/services/capacity_guard.ts` and tests: snapshot-based admission.
- Create `backend/src/routes/capacity.ts` and contract tests: safe current decision.
- Create `backend/src/scripts/import_capacity_snapshots.ts` and tests: release-bound preflight evidence import.
- Create `backend/src/services/cloud_tasks_service.ts` and tests: dispatch/reconciliation.
- Modify `backend/src/middleware/validation.ts` and tests: exact job input bounds.
- Create `backend/src/routes/generation-jobs.ts` and contract tests.
- Create `backend/src/routes/processing-jobs.ts` and contract tests.
- Create `backend/src/services/job_failures.ts` and tests: safe classification.
- Create `backend/src/services/generation_job_worker.ts` and tests.
- Create `backend/src/services/processing_job_worker.ts` and tests.
- Create `backend/src/services/generation_executor.ts`: adapter boundary consumed by Plan 04.
- Create `backend/src/services/object_identity_service.ts` and tests: GCS generation/checksum.
- Modify `backend/src/routes/rag.ts` and tests: processing submission.
- Modify `backend/src/routes/templates.ts` and tests: compilation submission.
- Create `backend/src/generation-worker.ts`.
- Create `backend/src/processing-worker.ts`.
- Modify `backend/src/index.ts` and worker wiring tests: API-only process.
- Modify `backend/src/services/readiness_service.ts` and tests.
- Modify `backend/src/utils/validateEnv.ts` and tests.
- Create `backend/src/scripts/compact_job_history.ts` and tests.

---

### Task 1: Implement Canonical Requests and Capacity Admission

**Files:**

- Create: `backend/src/utils/canonical_json.ts`
- Create: `backend/src/utils/canonical_json.test.ts`
- Create: `backend/src/services/capacity_guard.ts`
- Create: `backend/src/services/capacity_guard.test.ts`
- Create: `backend/src/routes/capacity.ts`
- Create: `backend/src/routes/capacity.contract.test.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/package.json`
- Create: `backend/src/scripts/import_capacity_snapshots.ts`
- Create: `backend/src/scripts/import_capacity_snapshots.test.ts`

**Interfaces:**

- Consumes: `CapacitySnapshotRepository` from Plan 02.
- Produces:

~~~typescript
export function canonicalJson(value: unknown): string;
export function requestSha256(value: unknown): string;

export type HeavyOperation =
  | 'generation'
  | 'upload'
  | 'template_compilation'
  | 'preview_regeneration';
export type GuardLevel = 'normal' | 'warning' | 'restricted' | 'blocked';
export interface CapacityDecision {
  allowed: boolean;
  level: GuardLevel;
  code: 'CAPACITY_OK' | 'CAPACITY_WARNING' | 'CAPACITY_RESTRICTED'
    | 'CAPACITY_EXHAUSTED' | 'CAPACITY_UNKNOWN';
  message: string;
  worstRatio: number | null;
  observedAt: string | null;
}
export interface CapacityGuard {
  evaluate(operation: HeavyOperation, now?: Date): Promise<CapacityDecision>;
}

export interface CapacityImportOptions {
  inputPath: string;
  manifestPath: string;
  expectedReleaseSha: string;
  expectedAccountIdentityHashes: Record<string, string>;
  now: Date;
}
export function importCapacitySnapshots(
  options: CapacityImportOptions,
  repository: CapacitySnapshotRepository,
): Promise<{ imported: number; releaseSha: string }>;
~~~

- [ ] **Step 1: Write failing canonicalization tests**

~~~typescript
it('sorts object keys recursively but preserves array order', () => {
  expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 }, a: [2, 1] }))
    .toBe('{"a":[2,1],"nested":{"a":1,"b":2},"z":1}');
});

it('rejects non-JSON and ambiguous numeric values', () => {
  expect(() => canonicalJson({ x: undefined })).toThrow('Non-JSON value');
  expect(() => canonicalJson({ x: Number.NaN })).toThrow('Non-finite number');
});
~~~

- [ ] **Step 2: Run and verify failure**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/utils/canonical_json.test.ts
~~~

Expected: FAIL because the utility is absent.

- [ ] **Step 3: Implement canonical JSON and SHA-256**

Recursively sort plain-object keys by Unicode code-point order, preserve arrays, encode dates as invalid rather than silently stringifying, reject prototypes other than `Object.prototype`/null, reject undefined/functions/symbols/bigints/non-finite numbers, and hash UTF-8 bytes with Node `createHash('sha256')`.

- [ ] **Step 4: Write failing capacity policy tests**

~~~typescript
it.each([
  [0.69, 'normal', true],
  [0.70, 'warning', true],
  [0.85, 'restricted', true],
  [0.95, 'blocked', false],
  [1.00, 'blocked', false],
] as const)('maps ratio %s to %s', async (ratio, level, allowed) => {
  const guard = createCapacityGuard(fakeSnapshotsAtRatio(ratio));
  await expect(guard.evaluate('generation', NOW)).resolves.toMatchObject({ level, allowed });
});

it('fails closed when a mandatory snapshot is missing or expired', async () => {
  const guard = createCapacityGuard(fakeSnapshots({ cloudTasksOperations: null }));
  await expect(guard.evaluate('upload', NOW)).resolves.toMatchObject({
    allowed: false, code: 'CAPACITY_UNKNOWN',
  });
});

it('allows an exact hard limit without promoting it to progressive exhaustion', async () => {
  const guard = createCapacityGuard(fakeSnapshots({
    secretManagerActiveVersions: { policy: 'hard_limit', ratio: 1.0 },
    cloudTasksOperations: { policy: 'progressive', ratio: 0.69 },
  }));
  await expect(guard.evaluate('generation', NOW)).resolves.toMatchObject({
    allowed: true, level: 'normal',
  });
});
~~~

Assert that an exceeded hard-limit record fails closed, 85% progressive usage disables `preview_regeneration`, 95% progressive usage blocks uploads/generation/template compilation, and reads/downloads/settings/status are not passed through this guard.

- [ ] **Step 5: Implement the guard and owner-scoped status route**

Configure the guard with `DOC_AI_DEPLOYED_RELEASE_SHA` and the metric-family account hashes from `DOC_AI_EXPECTED_CAPACITY_IDENTITIES_JSON`. Fetch only matching rows, require every hard-limit ratio to be at most one, and evaluate guard levels from the worst progressive ratio only; a fresh row for another release/account is missing evidence, not a fallback. Add exact Vietnamese messages:

~~~typescript
const CAPACITY_MESSAGES = {
  CAPACITY_WARNING: 'Hệ thống đang gần giới hạn miễn phí.',
  CAPACITY_RESTRICTED: 'Một số tác vụ phụ đã tạm dừng để giữ mức sử dụng miễn phí.',
  CAPACITY_EXHAUSTED: 'Đã tạm dừng tác vụ mới để tránh phát sinh chi phí.',
  CAPACITY_UNKNOWN: 'Chưa xác minh được hạn mức hiện tại; tác vụ mới tạm thời bị khóa.',
} as const;
~~~

`GET /api/capacity` requires user authentication and returns only the decision, no allowance price, account hash, or other-project usage.

- [ ] **Step 6: Write failing release-bound capacity import tests**

Test an accepted `runtime_actual` `CapacityEvidenceV2` import plus rejection of `preflight_projection`, blocked status, inconsistent top-level `zeroCostFeasible`, an Artifact Registry exception with the wrong kind/hash/nonpositive estimate/cap below estimate, an exception on any other metric, index checksum mismatch, release mismatch, unexpected account-identity hash, missing mandatory metric, unknown/mismatched policy, stale observation, invalid internal/official allowance, a ratio inconsistent with `measuredValue / internalCeiling`, nonfinite/negative values, and partial writes. Assert a normal passed record has ratio at most one and null exception, while the sole permitted over-ceiling passed record is Artifact Registry with `zeroCostStatus: "blocked"` and a valid recurring-cost-cap exception. Assert the CLI accepts only `--input` and `--manifest`; release/account expectations and `DATABASE_URL` come from environment, and no database URL appears in `process.argv`, output, or evidence.

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/scripts/import_capacity_snapshots.test.ts
~~~

Expected: FAIL because the importer is absent.

- [ ] **Step 7: Implement an atomic, fail-closed importer**

Parse and schema-check `CapacityEvidenceV2`, find its exact path and SHA-256 in the supplied release manifest or capacity-refresh index, require `mode = "runtime_actual"` and `status = "passed"`, require the deployed 40-hex release SHA and every expected account-identity hash to match, recompute each ratio from `measuredValue / internalCeiling` with maximum difference `1e-9`, validate `zeroCostStatus`/`approvedException` consistency, and evaluate every record for freshness at database time. Validate the complete mandatory metric set before opening one repository transaction; upsert all records or none, including the normalized Artifact Registry cost-cap disposition required for audit. The CLI reads only `DATABASE_URL`, `DOC_AI_DEPLOYED_RELEASE_SHA`, and `DOC_AI_EXPECTED_CAPACITY_IDENTITIES_JSON` from the environment and prints only the safe release SHA and imported count. Add `"capacity:import": "node dist/scripts/import_capacity_snapshots.js"`.

- [ ] **Step 8: Run and commit**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/utils/canonical_json.test.ts src/services/capacity_guard.test.ts src/routes/capacity.contract.test.ts src/scripts/import_capacity_snapshots.test.ts
npm --prefix backend run build
git diff --check
~~~

Expected: all focused tests and build pass.

Commit:

~~~powershell
git add -- backend/src/utils/canonical_json.ts backend/src/utils/canonical_json.test.ts backend/src/services/capacity_guard.ts backend/src/services/capacity_guard.test.ts backend/src/routes/capacity.ts backend/src/routes/capacity.contract.test.ts backend/src/scripts/import_capacity_snapshots.ts backend/src/scripts/import_capacity_snapshots.test.ts backend/src/index.ts backend/package.json
git commit -m "feat: add fail-closed heavy-work admission"
~~~

---

### Task 2: Implement Cloud Tasks Dispatch and Exhaustion Recovery

**Files:**

- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Create: `backend/src/services/cloud_tasks_service.ts`
- Create: `backend/src/services/cloud_tasks_service.test.ts`
- Modify: `backend/src/utils/validateEnv.ts`
- Modify: `backend/src/utils/validateEnv.test.ts`

**Interfaces:**

- Consumes: generation/processing repository dispatch methods from Plan 02.
- Produces:

~~~typescript
export interface TasksTransport {
  createTask(request: CreateTaskRequest): Promise<'created' | 'already_exists'>;
  getTask(name: string): Promise<'present' | 'not_found'>;
}

export interface EnqueueInput {
  jobId: string;
  operation: 'generation' | 'processing';
  dispatchGeneration: number;
  taskName: string;
  scheduleTime?: Date;
}

export interface CloudTasksService {
  enqueue(input: EnqueueInput): Promise<{ taskName: string }>;
  reconcile(jobId: string, operation: 'generation' | 'processing',
    now: Date): Promise<'queued' | 'unchanged' | 'exhausted'>;
}
~~~

Required environment:

~~~text
GCP_PROJECT_ID
GCP_REGION=us-central1
GENERATION_QUEUE_ID=docai-generation
PROCESSING_QUEUE_ID=docai-processing
GENERATION_WORKER_URL
PROCESSING_WORKER_URL
GENERATION_TASK_SERVICE_ACCOUNT
PROCESSING_TASK_SERVICE_ACCOUNT
~~~

- [ ] **Step 1: Install clients and write failing task-construction tests**

Run:

~~~powershell
npm --prefix backend install @google-cloud/tasks @google-cloud/storage
~~~

Then write:

~~~typescript
it('creates the exact identifier-only generation task', async () => {
  const transport = fakeTransport('created');
  const service = createCloudTasksService(config, repositories, transport);
  await service.enqueue({
    jobId: JOB_ID, operation: 'generation', dispatchGeneration: 0,
    taskName: `generation-${JOB_ID}-d0`,
  });
  const request = transport.createTask.mock.calls[0][0];
  expect(request.task.name.endsWith(`/tasks/generation-${JOB_ID}-d0`)).toBe(true);
  expect(JSON.parse(Buffer.from(request.task.httpRequest.body, 'base64').toString()))
    .toEqual({ jobId: JOB_ID, operation: 'generation' });
  expect(Buffer.from(request.task.httpRequest.body, 'base64').byteLength)
    .toBeLessThan(1024);
  expect(request.task.httpRequest.oidcToken.audience)
    .toBe(config.generationWorkerUrl);
  expect(Number(request.task.dispatchDeadline.seconds)).toBe(1680);
});
~~~

Also assert processing queue/account/audience, `Content-Type: application/json`, no secret/input fields, a four-call maximum across retryable failures, no retry for terminal transport failures, rejection when the supplied name differs from the persisted DB identity, and `AlreadyExists` success only for the same persisted operation/generation/task identity.

- [ ] **Step 2: Run tests and verify failure**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/services/cloud_tasks_service.test.ts
~~~

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement deterministic enqueue with bounded local retry**

Build the full queue/task names with the Google client helpers and assert the input name equals the deterministic name already persisted by submission. Set the per-task dispatch deadline to 1,680 seconds. Make one immediate CreateTask call, then retry only transport-unavailable/deadline errors at most three times with jittered delays centered on 100, 300, and 900 ms. Do not retry invalid arguments, permission denial, or task-body validation.

On `created` or validated `already_exists`, call repository `markQueued` with task name and database time. If all local attempts fail, call `markDispatchFailed` and return a typed `DispatchDelayedError`; routes translate it to HTTP 202 with persisted `dispatch_pending`.

- [ ] **Step 4: Implement exact reconciliation**

Reconciliation has two explicit paths:

1. Load the nonterminal dispatch row and return unchanged for an active lease.
2. For `dispatch_pending` with null `taskCreatedAt`, atomically reserve the check using a 30-second `lastDispatchCheckAt` interval, call CreateTask with the already persisted name, and mark queued on Created or identity-validated AlreadyExists.
3. For `queued`, return unchanged until `taskCreatedAt + retryWindow`; then atomically reserve a five-minute check interval shared across browser, startup, and operator callers.
4. Call `GetTask`; return unchanged if present.
5. If NotFound, atomically advance the expected dispatch generation, persist the next deterministic task name, clear `taskCreatedAt`, and commit before CreateTask.
6. Create that persisted name and mark queued on Created or identity-validated AlreadyExists.
7. Treat dispatch generation 3 as final and mark `DISPATCH_EXHAUSTED` instead of creating generation 4.

The API-startup reconciler scans at most 100 oldest `dispatch_pending` or retry-window-expired rows.

- [ ] **Step 5: Validate role-specific environment**

`validateEnv('api')` requires queue configuration, worker URLs, `DOC_AI_DEPLOYED_RELEASE_SHA`, and `DOC_AI_EXPECTED_CAPACITY_IDENTITIES_JSON`. `validateEnv('generation-worker')` requires pooled DB, renderer, task audience, and work-timeout values. `validateEnv('processing-worker')` requires pooled DB, Docling, embeddings, renderer, upload/template bucket identities, and task audience. Every role requires `DB_CONNECTION_LIMIT=5`.

- [ ] **Step 6: Run and commit**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/services/cloud_tasks_service.test.ts src/utils/validateEnv.test.ts
npm --prefix backend run build
git diff --check
~~~

Expected: focused tests and build pass; lockfile pins both Google clients.

Commit:

~~~powershell
git add -- backend/package.json backend/package-lock.json backend/src/services/cloud_tasks_service.ts backend/src/services/cloud_tasks_service.test.ts backend/src/utils/validateEnv.ts backend/src/utils/validateEnv.test.ts
git commit -m "feat: add bounded Cloud Tasks dispatch"
~~~

---

### Task 3: Add Generation Job Submission, Status, Cancellation, and Retry

**Files:**

- Modify: `backend/src/middleware/validation.ts`
- Modify: `backend/src/middleware/validation.test.ts`
- Create: `backend/src/routes/generation-jobs.ts`
- Create: `backend/src/routes/generation-jobs.contract.test.ts`
- Modify: `backend/src/index.ts`

**Interfaces:**

- Consumes: capacity guard, canonical request hashing, provider preference, generation repository, and Cloud Tasks service.
- Produces:

~~~typescript
export type FieldValue = string | number | boolean | null;
export interface GenerationJobInput {
  operationType: 'template_generation' | 'freeform_generation';
  prompt: string;
  docType?: string;
  templateId?: string;
  fieldValues?: Record<string, FieldValue>;
  lockedFields?: string[];
  referenceDocumentIds?: string[];
}

export interface GenerationJobView {
  id: string;
  state: JobState;
  currentStage: GenerationStage;
  confirmedProgress: number;
  stageCurrent: number | null;
  stageTotal: number | null;
  progressVersion: number;
  provider: 'openrouter' | 'gemini';
  model: string;
  safeError: { code: string; message: string } | null;
  allowedActions: Array<'cancel' | 'retry' | 'open' | 'download'>;
  resultDocumentId: string | null;
  updatedAt: string;
  completedAt: string | null;
}
~~~

Routes:

~~~text
POST /api/generation-jobs
GET  /api/generation-jobs/:id
POST /api/generation-jobs/:id/cancel
POST /api/generation-jobs/:id/retry
POST /api/generation-jobs/:id/reconcile-dispatch
~~~

- [ ] **Step 1: Write failing validation and contract tests**

~~~typescript
it('returns the same job for the same idempotency key and request hash', async () => {
  const first = await request(app).post('/api/generation-jobs')
    .set(auth()).set('Idempotency-Key', KEY).send(validInput);
  const second = await request(app).post('/api/generation-jobs')
    .set(auth()).set('Idempotency-Key', KEY).send(validInput);
  expect(first.status).toBe(202);
  expect(second.status).toBe(202);
  expect(second.body.job.id).toBe(first.body.job.id);
  expect(tasks.enqueue).toHaveBeenCalledTimes(1);
});

it('returns 409 when an idempotency key is reused with different input', async () => {
  await submit(validInput);
  const response = await submit({ ...validInput, prompt: 'changed' });
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('IDEMPOTENCY_CONFLICT');
});
~~~

Add boundary cases for every input limit, unknown keys, owner-scoped references, processing readiness, ten nonterminal jobs, stale capacity, missing active config, `304` ETag behavior, explicit cancellation, and retry creating a new UUID/provider snapshot. Prove same-key resubmission of a `dispatch_pending` row enters the shared 30-second reconciliation path. A concurrent fixture submitting 11 generation requests for one owner must commit exactly ten nonterminal jobs.

- [ ] **Step 2: Run tests and verify failure**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/middleware/validation.test.ts src/routes/generation-jobs.contract.test.ts
~~~

Expected: FAIL because validation and routes are absent.

- [ ] **Step 3: Implement strict Zod validation**

Use `.strict()` at every request object level. Validate `Idempotency-Key` against `^[A-Za-z0-9_-]{16,128}$`. Serialize the parsed body with `canonicalJson` and reject above 65,536 UTF-8 bytes. Keep locked field order sorted/unique in the persisted input.

- [ ] **Step 4: Implement transactional submission**

Within one Prisma transaction:

1. check an existing `(owner, operation, key)`;
2. return it on matching hash or throw conflict;
3. acquire `pg_advisory_xact_lock(hashtextextended(ownerId, 71702482))` and count fewer than ten nonterminal owner jobs;
4. verify template/reference ownership and that every reference processing job succeeded;
5. lock/resolve the active provider configuration;
6. derive `generation-{jobId}-d0` and create the job at `accepted`, 2%, dispatch generation 0 with that required taskName.

After commit, enqueue. Translate dispatch failure to:

~~~json
{
  "job": { "state": "dispatch_pending", "confirmedProgress": 2 },
  "warning": { "code": "DISPATCH_DELAYED", "message": "Công việc đã được lưu và đang chờ kết nối hàng đợi." }
}
~~~

- [ ] **Step 5: Implement status, cancellation, retry, and reconciliation**

GET uses `ETag: "progress-{progressVersion}"` and returns HTTP 304 when `If-None-Match` matches. It opportunistically reconciles `dispatch_pending` through the shared 30-second reservation and queued/retry-window-expired rows through the shared five-minute reservation.

Cancellation calls the repository timestamp transition. Retry accepts an optional `providerConfigId`, requires terminal failed/cancelled source ownership, re-runs capacity and the same owner admission lock/count, creates a new UUID/idempotency key/retry link with its deterministic generation-zero task name, snapshots the selected provider/model, and never mutates the old job.

- [ ] **Step 6: Run and commit**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/middleware/validation.test.ts src/routes/generation-jobs.contract.test.ts
npm --prefix backend run build
git diff --check
~~~

Expected: all generation route tests and build pass.

Commit:

~~~powershell
git add -- backend/src/middleware/validation.ts backend/src/middleware/validation.test.ts backend/src/routes/generation-jobs.ts backend/src/routes/generation-jobs.contract.test.ts backend/src/index.ts
git commit -m "feat: add durable generation job API"
~~~

---

### Task 4: Implement Idempotent Generation Worker Delivery

**Files:**

- Create: `backend/src/services/job_failures.ts`
- Create: `backend/src/services/job_failures.test.ts`
- Create: `backend/src/services/generation_executor.ts`
- Create: `backend/src/services/generation_job_worker.ts`
- Create: `backend/src/services/generation_job_worker.test.ts`
- Create: `backend/src/generation-worker.ts`
- Modify: `backend/package.json`

**Interfaces:**

- Consumes: `GenerationJobRepository`, `WorkFailure`, `TaskMetadata`, and immutable claimed job from Plan 02.
- Produces:

~~~typescript
export interface LeaseContext {
  workerId: string;
  signal: AbortSignal;
  checkpoint(value: ProgressCheckpoint<GenerationStage>): Promise<void>;
  assertLease(): Promise<void>;
  assertNotCancelled(): Promise<void>;
}

export interface GenerationExecutor {
  execute(job: ClaimedGenerationJob, lease: LeaseContext):
    Promise<GenerationResult>;
}

export interface TaskHttpResult {
  status: 204 | 429 | 503;
  retryAfterSeconds?: number;
}

export function handleGenerationTask(
  payload: TaskPayload,
  metadata: TaskMetadata,
  dependencies: GenerationWorkerDependencies,
): Promise<TaskHttpResult>;
~~~

- [ ] **Step 1: Write failing failure-classification tests**

~~~typescript
it.each([
  [new ProviderAuthError(), 'terminal', 'PROVIDER_AUTH'],
  [new ProviderQuotaError(), 'terminal', 'PROVIDER_QUOTA'],
  [new DeterministicValidationError(), 'terminal', 'VALIDATION_FAILED'],
  [Object.assign(new Error('reset'), { code: 'ECONNRESET' }), 'transient', 'NETWORK'],
  [new RendererUnavailableError(), 'transient', 'RENDERER_UNAVAILABLE'],
] as const)('classifies %p', (error, kind, code) => {
  expect(classifyWorkFailure(error)).toMatchObject({ kind, code });
});
~~~

Assert sanitization removes bearer/API-key/database URL material and caps Vietnamese-safe messages.

- [ ] **Step 2: Write failing worker state-machine tests**

Cover:

- malformed payload/header returns terminal 204 without lookup;
- parse and require `X-CloudTasks-TaskName`, `X-CloudTasks-QueueName`, `X-CloudTasks-TaskRetryCount`, and `X-CloudTasks-TaskExecutionCount`; OIDC audience authentication remains Cloud Run IAM's responsibility;
- record `deliveryOrdinal = Math.max(retryCount, executionCount) + 1` through the repository's task-identity-checked monotonic telemetry update without consuming a work attempt;
- a matching task may claim the persisted `dispatch_pending` crash-window row, while a task-name mismatch does no work;
- terminal and actively leased claims return 204;
- user capacity/future availability returns 429 and does not increment attempts;
- transient attempt one/two returns 503 after durable retry state;
- attempt three persists failed and returns 204;
- cancellation before/after executor call never completes;
- 30-second renewal aborts executor after lease loss;
- internal 1,500-second abort persists a transient timeout when lease remains;
- duplicate completion is a no-op;
- task name metadata must match job dispatch identity.

- [ ] **Step 3: Run tests and verify failure**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/services/job_failures.test.ts src/services/generation_job_worker.test.ts
~~~

Expected: FAIL because classifier and worker are absent.

- [ ] **Step 4: Implement the worker state machine**

Use a random UUID worker ID per request. Start lease renewal only after a `claimed` result. Renewal failure aborts the shared controller and prevents completion/publication.

Use delays 30, 120, and 300 seconds for actual work attempts one through three. Return 429 with safe `Retry-After` for capacity/future availability. Always durably record terminal outcomes before 204.

The initial `GenerationExecutor` adapts current generation services without changing their fast-path behavior; Plan 04 replaces its internal orchestration while preserving this exact interface. It must honor `AbortSignal`, return one `GenerationResult`, and never select a provider different from the claimed snapshot.

- [ ] **Step 5: Create the private HTTP entry point**

`generation-worker.ts`:

- calls `validateEnv('generation-worker')`;
- exposes `/live`, `/ready`, and `POST /internal/tasks/generation`;
- accepts JSON at most 1 KiB;
- requires all four Cloud Tasks name/queue/retry/execution headers and exact configured queue identity as defense in depth; OIDC audience authentication is enforced by Cloud Run IAM, not a request header;
- has no browser routes or CORS;
- uses graceful shutdown to abort active work and release resources; and
- maps only `TaskHttpResult` to HTTP.

Add package scripts:

~~~json
{
  "start:generation-worker": "node dist/generation-worker.js",
  "dev:generation-worker": "tsx watch src/generation-worker.ts"
}
~~~

- [ ] **Step 6: Run and commit**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/services/job_failures.test.ts src/services/generation_job_worker.test.ts
npm --prefix backend run build
git diff --check
~~~

Expected: all worker tests pass and `backend/dist/generation-worker.js` exists.

Commit:

~~~powershell
git add -- backend/src/services/job_failures.ts backend/src/services/job_failures.test.ts backend/src/services/generation_executor.ts backend/src/services/generation_job_worker.ts backend/src/services/generation_job_worker.test.ts backend/src/generation-worker.ts backend/package.json
git commit -m "feat: add idempotent generation task worker"
~~~

---

### Task 5: Move Upload and Template Processing to Exact-ID Tasks

**Files:**

- Create: `backend/src/services/object_identity_service.ts`
- Create: `backend/src/services/object_identity_service.test.ts`
- Create: `backend/src/services/object_validation_service.ts`
- Create: `backend/src/services/object_validation_service.test.ts`
- Create: `backend/src/routes/processing-jobs.ts`
- Create: `backend/src/routes/processing-jobs.contract.test.ts`
- Modify: `backend/src/routes/rag.ts`
- Modify: `backend/src/routes/rag.contract.test.ts`
- Modify: `backend/src/routes/templates.ts`
- Modify: `backend/src/routes/templates.contract.test.ts`
- Create: `backend/src/services/processing_job_worker.ts`
- Create: `backend/src/services/processing_job_worker.test.ts`
- Create: `backend/src/processing-worker.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/src/index.worker_wiring.test.ts`
- Modify: `backend/src/services/readiness_service.ts`
- Modify: `backend/src/services/readiness_service.test.ts`
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`

**Interfaces:**

- Consumes: processing repository, Cloud Tasks service, current `processIngestion`, and current `fuseTemplate`.
- Produces:

~~~typescript
export interface ObjectIdentity {
  bucket: string;
  objectName: string;
  generation: string;
  sha256: string;
  size: number;
}
export interface ObjectIdentityService {
  persistUpload(input: {
    bucket: string; objectName: string; localPath: string; expectedSha256: string;
  }): Promise<ObjectIdentity>;
  stat(bucket: string, objectName: string): Promise<ObjectIdentity>;
  removeGeneration(bucket: string, objectName: string, generation: string): Promise<void>;
}

export interface ObjectValidationService {
  inspectPdf(localPath: string): Promise<{ pageCount: number }>;
  inspectDocx(localPath: string): Promise<{ entryCount: number; expandedBytes: number }>;
}

export interface ProcessingJobView {
  id: string;
  state: JobState;
  operationType: ProcessingOperation;
  currentStage: ProcessingStage;
  confirmedProgress: number;
  stageCurrent: number | null;
  stageTotal: number | null;
  progressVersion: number;
  resource: { kind: 'document' | 'template'; id: string };
  parserSummary: {
    route: 'pymupdf_text' | 'selective_ocr' | 'docling_structural';
    pageCount: number;
    ocrPageCount: number;
    skippedOcrReason: 'clean_text_layer' | null;
  } | null;
  safeError: { code: string; message: string } | null;
  allowedActions: Array<'cancel' | 'open'>;
  updatedAt: string;
  completedAt: string | null;
}

export function handleProcessingTask(
  payload: TaskPayload,
  metadata: TaskMetadata,
  dependencies: ProcessingWorkerDependencies,
): Promise<TaskHttpResult>;
~~~

Routes:

~~~text
GET  /api/processing-jobs/:id
POST /api/processing-jobs/:id/cancel
POST /api/processing-jobs/:id/reconcile-dispatch
~~~

- [ ] **Step 1: Write failing object identity and submission tests**

Install a lazy central-directory reader without extracting entries:

~~~powershell
npm --prefix backend install yauzl
npm --prefix backend install --save-dev @types/yauzl
~~~

Configure it with lazy entries and entry-size validation. Count/sum declared sizes first, then stream every member into a non-persisting counting sink with per-entry and cumulative aborts at 100 MiB so actual inflation and size/CRC corruption are detected without filesystem extraction. Reject encryption, symlink-like attributes, absolute/parent/drive paths, macros, malformed content types, and external relationships before accepting the package; parse only bounded XML parts after the full streaming pass.

~~~typescript
it('persists an upload before committing its immutable generation', async () => {
  storage.save.mockResolvedValue({
    bucket: 'docai-uploads-uc1-project',
    objectName: `uploads/source/${OWNER_ID}/${DOCUMENT_ID}.pdf`,
    generation: '1723600000000000',
    sha256: SHA,
    size: 1024,
  });
  const response = await uploadPdf(app, auth(), fixture);
  expect(response.status).toBe(202);
  expect(processingRepo.create).toHaveBeenCalledWith(expect.objectContaining({
    sourceGeneration: '1723600000000000',
    sourceSha256: SHA,
  }));
  expect(tasks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
    operation: 'processing',
  }));
});
~~~

Assert exact paths:

- `uploads/source/{ownerId}/{documentId}.pdf`;
- `originals/{ownerId}/{templateId}.docx`.

Also assert DB failure deletes only the exact uploaded generation, idempotency conflict behavior, rejection at 20 existing nonterminal processing jobs, 21 concurrent submissions commit exactly 20 jobs, PDF/DOCX MIME-signature mismatch, encrypted/active-content input, 20 MiB/200-page PDF handoff, bounded DOCX package handoff, DOCX traversal/absolute/symlink/macro/external-relationship rejection, forged size and CRC mismatch rejection, early cumulative-inflation abort, and no in-process worker start.

- [ ] **Step 2: Run tests and verify failure**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/services/object_identity_service.test.ts src/services/object_validation_service.test.ts src/routes/rag.contract.test.ts src/routes/templates.contract.test.ts
~~~

Expected: FAIL because immutable object identity and task submission are absent.

- [ ] **Step 3: Implement GCS-backed identity and atomic job creation**

Calculate SHA-256 while receiving the upload. Persist to the exact object path, then read GCS metadata until generation/size/checksum are visible or the bounded 15-second verification timeout expires. Before DB creation, run the bounded PDF signature/encryption/page-count check or DOCX package-safety check from the spec; a rejected input removes only that exact GCS generation.

Create the `Document`/`Template` and `ProcessingJob` in one DB transaction only after object verification. Within that transaction, acquire `pg_advisory_xact_lock(hashtextextended(ownerId, 71702482))` before confirming the owner has fewer than 20 nonterminal processing jobs. Derive and persist `processing-{jobId}-d0` in that transaction. On DB failure, remove the exact generation. After commit, enqueue the persisted name; a dispatch failure still returns 202 with `dispatch_pending`.

The processing request hash includes object owner, object generation, SHA-256, operation, and compiler version for templates.

- [ ] **Step 4: Write and implement processing worker tests**

Cover exact-ID claim, ingestion/template operation switch, terminal duplicate 204, transient retry, attempt-three failure, cancellation, lease loss, chunk deduplication transaction, template artifact deduplication, and preservation of source objects.

The worker calls:

~~~typescript
if (job.operationType === 'document_ingestion') {
  await processIngestionJob(job, lease);
} else {
  await compileTemplateJob(job, lease);
}
~~~

Both adapters accept `LeaseContext`, checkpoint only durable work, and verify the stored object generation/SHA before reading. `compileTemplateJob` calls the private renderer; document ingestion calls Docling and embeddings.

- [ ] **Step 5: Create processing status and entry point**

Status mirrors the safe progress contract and exposes bounded parser telemetry only. `processing-worker.ts` uses `/internal/tasks/processing`, JSON limit 1 KiB, task metadata checks, role-specific readiness, and graceful shutdown. Add:

~~~json
{
  "start:processing-worker": "node dist/processing-worker.js",
  "dev:processing-worker": "tsx watch src/processing-worker.ts"
}
~~~

- [ ] **Step 6: Remove API polling workers and correct readiness**

Delete worker creation/start/stop from `backend/src/index.ts`; the API process only dispatches. Update `index.worker_wiring.test.ts` to require zero references to `createDefaultIngestionWorker` and `createDefaultTemplateCompilationWorker`.

API readiness requires Neon, schema version, and required secret bundle. Redis failure yields `status: "degraded"` but HTTP 200. Generation-worker readiness checks renderer configuration and writable `/tmp`; processing-worker readiness checks Docling/embeddings endpoints, renderer configuration for template compilation, and writable `/tmp`.

- [ ] **Step 7: Run and commit**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/services/object_identity_service.test.ts src/services/object_validation_service.test.ts src/routes/rag.contract.test.ts src/routes/templates.contract.test.ts src/routes/processing-jobs.contract.test.ts src/services/processing_job_worker.test.ts src/index.worker_wiring.test.ts src/services/readiness_service.test.ts
npm --prefix backend run build
git diff --check
~~~

Expected: all tests pass; both worker entry points build; API wiring starts no polling loop.

Commit:

~~~powershell
git add -- backend/src/services/object_identity_service.ts backend/src/services/object_identity_service.test.ts backend/src/services/object_validation_service.ts backend/src/services/object_validation_service.test.ts backend/src/routes/processing-jobs.ts backend/src/routes/processing-jobs.contract.test.ts backend/src/routes/rag.ts backend/src/routes/rag.contract.test.ts backend/src/routes/templates.ts backend/src/routes/templates.contract.test.ts backend/src/services/processing_job_worker.ts backend/src/services/processing_job_worker.test.ts backend/src/processing-worker.ts backend/src/index.ts backend/src/index.worker_wiring.test.ts backend/src/services/readiness_service.ts backend/src/services/readiness_service.test.ts backend/package.json backend/package-lock.json
git commit -m "feat: move processing to exact-id task workers"
~~~

---

### Task 6: Add Bounded Job Retention and Startup Reconciliation

**Files:**

- Create: `backend/src/scripts/compact_job_history.ts`
- Create: `backend/src/scripts/compact_job_history.test.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/src/index.worker_wiring.test.ts`
- Modify: `backend/package.json`

**Interfaces:**

- Consumes: job repositories and Cloud Tasks reconciliation.
- Produces:
  - `compactJobHistory({ now, limit: 100 }) -> { compacted, deleted, tombstonesDeleted }`
  - `reconcilePendingDispatches({ now, limit: 100 }) -> ReconcileSummary`.

- [ ] **Step 1: Write failing retention tests**

~~~typescript
it('compacts only terminal resumability data older than 30 days', async () => {
  const result = await compactJobHistory({ now: NOW, limit: 100 }, deps);
  expect(deps.generation.compact).toHaveBeenCalledWith(expect.objectContaining({
    terminalBefore: daysBefore(NOW, 30), limit: 100,
  }));
  expect(deps.generation.compact).not.toHaveBeenCalledWith(
    expect.objectContaining({ states: expect.arrayContaining(['running']) }),
  );
  expect(result.compacted).toBeGreaterThanOrEqual(0);
});
~~~

Assert metadata deletion only after 180 days, snapshots after 90 days, tombstone deletion only when unreferenced, and no live `Document` deletion.

- [ ] **Step 2: Run and verify failure**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/scripts/compact_job_history.test.ts
~~~

Expected: FAIL because the script is absent.

- [ ] **Step 3: Implement explicit and opportunistic cleanup**

At 30 days, null `input`, `lockedFields`, and `persistedDraft` for terminal jobs. At 180 days, delete compacted job metadata only when result documents and audit policy permit; never delete the result document. At 90 days, delete expired capacity snapshots. Delete a provider tombstone only when no job references it.

The API startup hook processes at most 100 cleanup rows and 100 reconciliation rows after listen succeeds. Failure logs a safe warning and never fails readiness or scans again in the same process.

- [ ] **Step 4: Add the operator script and package command**

Add:

~~~json
{
  "jobs:compact": "tsx src/scripts/compact_job_history.ts"
}
~~~

The CLI prints counts only and supports `--limit` from 1–1000 and `--execute`; without `--execute` it previews candidate counts.

- [ ] **Step 5: Run and commit**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/scripts/compact_job_history.test.ts src/index.worker_wiring.test.ts
npm --prefix backend run build
git diff --check
~~~

Expected: tests/build pass and preview performs no writes.

Commit:

~~~powershell
git add -- backend/src/scripts/compact_job_history.ts backend/src/scripts/compact_job_history.test.ts backend/src/index.ts backend/src/index.worker_wiring.test.ts backend/package.json
git commit -m "feat: add bounded durable-job maintenance"
~~~

## Plan 03 Exit Gate

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/utils/canonical_json.test.ts src/services/capacity_guard.test.ts src/services/cloud_tasks_service.test.ts src/routes/generation-jobs.contract.test.ts src/routes/processing-jobs.contract.test.ts src/services/generation_job_worker.test.ts src/services/processing_job_worker.test.ts src/index.worker_wiring.test.ts src/services/readiness_service.test.ts src/scripts/compact_job_history.test.ts
npm --prefix backend run build
git diff --check
~~~

Expected: all commands exit 0, task bodies are below 1 KiB, and API startup contains no background polling worker.
