# Zero-Cost Durable DocAI Design

**Date:** 2026-08-14

**Status:** Review required

**Supersedes:** The earlier 2026-08-14 version of this document.

## 1. Goal

Rebuild DocAI as a durable, cloud-hosted, scale-to-zero service for a low-volume personal workload while improving:

- question-to-first-answer latency;
- form completion and preservation of user-entered values;
- document drafting and rendering;
- PDF ingestion and OCR routing;
- durable progress and cancellation;
- retry and duplicate-delivery safety;
- explicit OpenRouter and Gemini choice;
- truthful Vietnamese product copy; and
- operational evidence, recovery, and cost control.

The steady-state infrastructure objective is USD 0. This is a conditional operating envelope, not a permanent pricing promise. Provider pricing and free allowances can change, free allowances may be shared by other projects on the same account, and Google Cloud budgets do not hard-stop charges.

OpenRouter and Gemini are user-funded or free-quota inference dependencies. Their usage is excluded from the infrastructure USD 0 objective and must be labeled separately.

One-time migration transfer, storage, and API-operation charges are also outside the steady-state objective. They must be estimated before cutover, displayed to the operator, and explicitly approved if the estimate is greater than USD 0.

The preferred target remains USD 0. If the conservatively retained current-and-rollback image footprint exceeds the Artifact Registry free-storage allowance, the release may proceed only with current official pricing evidence and an explicit operator-approved monthly USD cap at or above the rounded-up estimate. Such a release records `zeroCostFeasible: false`; approval of a bounded recurring cost must never be labeled USD 0.

## 2. Release principles

1. Neon is the source of truth for jobs, progress, cancellation, attempts, and results.
2. Cloud Tasks owns delivery scheduling and delivery backoff. Database state owns business state and actual work-attempt limits.
3. Upstash is optional. Its failure cannot erase progress, fail core readiness, or prevent admitted work from completing.
4. User-entered form values are authoritative and cannot be overwritten by inference.
5. Provider and model choice is explicit. No automatic cross-provider failover is allowed.
6. A document becomes downloadable only after structural validation, verified object persistence, and an atomic success transition.
7. Progress advances only after durable checkpoints. Time passage never creates progress.
8. Every public claim must map to a passing capability test.
9. Heavy work fails closed when cost information is stale, missing, or above a guard.
10. Destructive migration actions require exact target resolution, accepted recovery evidence, and explicit operator approval.
11. The system does not claim zero cost when measurements show the selected stack cannot fit the free envelope.
12. Production traffic remains recoverable until private acceptance is complete.

## 3. Approved platform and regions

### 3.1 Google Cloud

All new Google Cloud runtime resources use us-central1:

- Cloud Run services and jobs;
- Cloud Tasks queues;
- Artifact Registry;
- Secret Manager regional policy where supported; and
- target Cloud Storage buckets.

All Cloud Run services use request-based billing, minimum instances zero, CPU idle enabled, and explicit maximum instances.

The system does not use Cloud SQL, Serverless VPC Access, Cloud NAT, an external Google Cloud load balancer, always-on workers, or a recurring scheduler that keeps Neon awake.

### 3.2 Neon

The Neon project uses AWS US East (Ohio), region identifier aws-us-east-2, by default. Preflight may select another currently available free-plan Neon region only after 20 TLS connect-and-query samples from us-central1 show at least 15% lower median latency with no more than 10% worse p95 latency.

The selected region is recorded in release evidence and cannot change after the restore begins.

Runtime services use the pooled TLS endpoint. Backup, restore, and destructive database administration use a direct TLS endpoint. Direct credentials are unavailable to ordinary runtime services.

The default compute:

- scales to zero after five minutes of inactivity;
- starts at 0.25 CU;
- has a maximum of 1 CU for the personal workload; and
- has no paid-plan auto-upgrade.

### 3.3 Upstash

This migration release enables Upstash Redis on the free plan in GCP us-central1 with TLS, eviction enabled for disposable keys, and auto-upgrade disabled. Upstash is optional to application correctness—not optional to this release's capacity evidence—so an outage degrades caching without becoming a data or job dependency.

An Upstash database in another region is not accepted at cutover.

### 3.4 Cloudflare

Cloudflare Workers Free remains the public edge. The Worker route is configured fail-closed. Its direct Cloud Run origin is protected by an origin token so the run.app URL cannot bypass maintenance mode.

## 4. Non-goals

- Guaranteed permanent USD 0 under arbitrary traffic or future pricing.
- Paying automatically when any free allowance is exhausted.
- Keeping Cloud Run or Neon warm.
- Automatic provider or model failover.
- Using Redis, browser memory, or Cloud Tasks as the authoritative job store.
- Storing binaries or verbose token/event histories in Neon.
- Displaying invented queue positions, token percentages, or completion estimates.
- Full progress-history retention.
- Replacing GCS FUSE with the object API during the first cutover.
- Claiming unsupported DOCX ingestion, PDF export, automatic learning, fixed legal-template coverage, or legal compliance.
- Performing a data rollback after new production writes have been accepted by Neon.
- Preserving every historical GCS object generation in the new regional buckets. Historical generations remain recoverable from the accepted migration archive.

## 5. Target architecture

    Vietnamese browser
        |
        v
    Cloudflare Worker
      - maintenance gate
      - origin token injection
        |
        v
    Public Cloud Run frontend
      min 0, max 2, concurrency 40
      rejects requests without the origin token, except operator-safe liveness
        |
        v
    Private Cloud Run API
      min 0, max 2, concurrency 20
        |              |                    |
        |              |                    +--> Optional Upstash
        |              |                         rate limits and disposable cache
        |              |
        |              +--> Cloud Storage target buckets
        |
        +--> Neon Postgres
        |
        +--> Generation Cloud Tasks queue
        |      max concurrent dispatches 5
        |      |
        |      v
        |    Private generation worker
        |      min 0, max 2, concurrency 3
        |      |
        |      +--> OpenRouter or Gemini
        |      +--> private renderer
        |
        +--> Processing Cloud Tasks queue
               max concurrent dispatches 1
               |
               v
             Private processing worker
               min 0, max 1, concurrency 1
               |
               +--> private Docling
               +--> private local Jina embeddings service
               +--> private renderer for template compilation only

Q&A remains a synchronous SSE request to the API because first-token latency is more important than disconnect recovery for a single answer.

Generation, document ingestion, and template compilation are durable asynchronous jobs.

## 6. Trust boundaries and origin protection

### 6.1 Public edge

The Cloudflare Worker adds X-DocAI-Origin-Token to every upstream request. It removes any client-supplied value for that header first.

The frontend performs a constant-time comparison against its current origin token before routing or rendering protected pages. Requests without a valid token return 404. The response never exposes whether the origin token was missing or incorrect.

The frontend accepts two tokens during a rotation window:

- current token;
- previous token, for no more than 15 minutes.

The Worker switches first, the frontend retains both during propagation, and the previous token is removed after verification.

The only unauthenticated direct-origin path is /internal/live. It returns only process liveness, contains no dependency information, and is not advertised publicly.

Maintenance tests must prove:

- the public domain returns maintenance responses;
- the direct run.app origin cannot reach application routes;
- maintenance cannot be bypassed with a client-supplied origin header;
- the operator-safe liveness path exposes no configuration; and
- normal proxying returns only after explicit approval.

### 6.2 Internal services

The API is private and accepts invocations from the frontend service account and designated smoke-test identity.

Every server-side frontend proxy call obtains a Google ID token through Application Default Credentials for the canonical API origin and sends it as `X-Serverless-Authorization`, preserving the user's application `Authorization` header separately. Production startup fails when the configured API URL/audience is absent, non-HTTPS, or not the exact Terraform output; the token and private API URL are never exposed to browser code.

Cloud Tasks invokes each worker with a Google-signed OIDC token whose audience equals that worker's canonical URL. IAM is the authentication boundary. Cloud Tasks metadata headers are validated only as defense in depth and are never treated as credentials.

Docling, embeddings, and renderer services are private. Each caller receives permission to invoke only the services required by its operation.

### 6.3 Application authorization

Every browser-facing read and mutation is owner-scoped.

Internal workers use a separate privileged repository interface that accepts an opaque job ID and does not accept an owner ID supplied by the task body.

Task payloads contain exactly:

    {
      "jobId": "UUID",
      "operation": "generation" | "processing"
    }

The serialized body must remain below 1 KiB. Provider keys, prompts, document contents, storage paths, owner IDs, and model IDs never appear in task bodies.

## 7. Durable data contracts

### 7.1 GenerationJob

GenerationJob contains:

| Field | Contract |
|---|---|
| id | UUID primary key |
| ownerId | Required owner foreign key |
| idempotencyKey | 16–128 URL-safe characters |
| requestHash | SHA-256 of canonical validated input |
| operationType | template_generation or freeform_generation |
| state | dispatch_pending, queued, running, succeeded, failed, or cancelled |
| dispatchReason | initial, capacity_deferred, dispatch_failed, or retry_backoff |
| dispatchGeneration | Integer 0–3 used only to recover an exhausted or missing task |
| taskName | Deterministic Cloud Tasks name; required while nonterminal |
| taskCreatedAt | Nullable timestamp |
| lastDispatchCheckAt | Nullable reconciliation-throttle timestamp |
| deliveryCount | Monotonic delivery telemetry; does not limit actual work |
| workAttempt | Integer 0–3; increments only when a lease is acquired for real work |
| availableAt | Earliest time an actual retry may claim work |
| leaseOwner | Nullable worker UUID |
| leaseExpiresAt | Nullable timestamp |
| cancellationRequestedAt | Nullable timestamp |
| currentStage | GenerationStage value |
| confirmedProgress | Integer 0–100 |
| stageCurrent | Nullable nonnegative integer |
| stageTotal | Nullable positive integer |
| progressVersion | Monotonic integer |
| input | Bounded validated JSON |
| lockedFields | Sorted unique field names supplied by the user |
| providerConfigId | Referenced saved configuration |
| providerSnapshot | openrouter or gemini |
| modelSnapshot | Exact provider model ID |
| referenceDocumentIds | At most 20 owner-scoped document IDs |
| persistedDraft | Nullable bounded draft required for render-only retry |
| validationSummary | Nullable safe JSON |
| resultDocumentId | Nullable owner-scoped document ID |
| resultStorageKey | Nullable verified object key |
| resultSha256 | Nullable lowercase SHA-256 |
| safeErrorCode | Nullable stable error code |
| safeErrorMessage | Nullable Vietnamese-safe message |
| timings | Bounded stage timing JSON |
| retryOfJobId | Nullable source job |
| createdAt, updatedAt, completedAt | Audit timestamps |

Database constraints enforce:

- unique ownerId, operationType, idempotencyKey;
- confirmedProgress between 0 and 100;
- workAttempt between 0 and 3;
- dispatchGeneration between 0 and 3;
- stageCurrent and stageTotal either both null or stageCurrent less than or equal to stageTotal;
- terminal jobs have completedAt;
- succeeded jobs have resultDocumentId, resultStorageKey, and resultSha256;
- failed jobs have safeErrorCode;
- cancelled jobs have cancellationRequestedAt;
- a lower progress stage, progress version, or percentage cannot overwrite a higher value.

### 7.2 Generation input bounds

The API rejects a generation request unless all limits pass:

- canonical serialized input at most 64 KiB;
- prompt at most 16,384 Unicode characters;
- fieldValues at most 128 keys;
- each key at most 128 characters;
- each scalar string at most 8,192 characters;
- lockedFields at most 128 unique known keys;
- referenceDocumentIds at most 20;
- templateId and docType at most 100 characters; and
- no unknown top-level properties.

Validated job input is permitted in Neon because it is required for resumability. Binaries, rendered documents, previews, raw provider responses, and token streams are not permitted in job rows.

### 7.3 ProcessingJob

ProcessingJob is the durable contract for both document ingestion and template compilation.

| Field | Contract |
|---|---|
| id | UUID primary key |
| ownerId | Required owner foreign key |
| operationType | document_ingestion or template_compilation |
| idempotencyKey | 16–128 URL-safe characters |
| requestHash | SHA-256 of canonical validated input |
| documentId | Required only for document_ingestion |
| templateId | Required only for template_compilation |
| sourceGeneration | Immutable GCS object generation selected at submission |
| sourceSha256 | Lowercase SHA-256 of the selected source object |
| state | dispatch_pending, queued, running, succeeded, failed, or cancelled |
| dispatchReason, dispatchGeneration | Same contract as GenerationJob |
| taskName, taskCreatedAt, lastDispatchCheckAt, deliveryCount | Dispatch telemetry |
| workAttempt | Integer 0–3 |
| availableAt, leaseOwner, leaseExpiresAt | Retry and lease fields |
| cancellationRequestedAt | Nullable timestamp |
| currentStage | ProcessingStage value |
| confirmedProgress | Integer 0–100 |
| stageCurrent, stageTotal, progressVersion | Durable progress fields |
| parserTelemetry | Nullable bounded safe JSON |
| safeErrorCode, safeErrorMessage | Nullable terminal error |
| createdAt, updatedAt, completedAt | Audit timestamps |

Exactly one of documentId or templateId is present and must match operationType.

The database enforces unique ownerId, operationType, idempotencyKey; dispatchGeneration and workAttempt between 0 and 3; the same terminal-state and monotonic-progress rules as GenerationJob; and immutability of sourceGeneration and sourceSha256 after insertion.

Existing IngestionJob rows are migrated to ProcessingJob without losing attempts, availability, or completion state. The old table is removed only after migration-integrity and rollback-compatibility checks pass.

### 7.4 Provider configuration

Only openrouter and gemini are supported as user-selectable production providers in this design.

UserLLMConfig has one row per ownerId and provider, including nullable deletedAt. UserLLMPreference stores activeConfigId as a foreign key, rather than an unconstrained provider string.

A GenerationJob references the selected configuration and snapshots provider and model. It never stores encrypted key material.

Save, key rotation, and deletion return 409 CONFIG_IN_USE while a nonterminal GenerationJob references that configuration. This deliberately favors deterministic queued work over changing credentials mid-job.

Deleting the active configuration requires either:

- activating another saved configuration in the same request; or
- explicitly setting the account to unconfigured.

Deletion is a cryptographic soft delete: after the nonterminal-reference check passes, the transaction clears encrypted key material, sets deletedAt, and changes the active preference as requested. The tombstone remains under foreign-key restrict semantics while any historical job references it, so audit identity survives without retaining the provider key. A later cleanup may physically remove only unreferenced tombstones.

### 7.5 CapacitySnapshot

CapacitySnapshot is a last-known authoritative usage observation, not a custom billing ledger.

Each record contains:

- metric;
- measured value and unit;
- internal hard ceiling used for admission;
- policy, either progressive usage or a binary hard limit;
- nullable official free allowance recorded separately for audit when the metric has one;
- billing account or provider account identity hash;
- source API or audit command;
- observedAt;
- validUntil;
- release identifier; and
- safe collection error, when unavailable.

Heavy admission requires all mandatory snapshots to be present and unexpired. GCP and provider-account snapshots expire after six hours. Bucket inventories and database-size snapshots expire after 24 hours.

Capacity observations are carried in a schema-valid `CapacityEvidenceV2` artifact. Its required `mode` is `preflight_projection` or `runtime_actual`, and its top-level `zeroCostFeasible` distinguishes a true free-envelope pass from an explicitly approved Artifact Registry recurring-cost exception. The preflight artifact projects the target release rather than treating legacy resources awaiting retirement as target steady state; current legacy Artifact Registry and Secret Manager usage is captured separately as transition debt. After target deployment and secret cleanup, a fresh runtime artifact—and every later refresh—is indexed by a checksummed, release-scoped capacity-refresh index. A release-scoped backend CLI imports that runtime artifact before heavy admission is enabled. The importer reads the Neon connection from an environment variable, never a command-line argument, and rejects the artifact unless its checksum matches the supplied index, its status is passed, its release identifier and account-identity hashes match the deployment, and every mandatory observation is still fresh. It upserts only the validated metric records; an expired or rejected import leaves heavy admission closed.

Runtime lookup is pinned to the deployed release identifier and the configured expected account-identity hash for each metric family. It never accepts an otherwise newer row from another release or account. Database uniqueness on metric, release identifier, and account-identity hash makes a repeated accepted import idempotent.

The scale-to-zero topology intentionally has no always-on capacity collector. An authenticated operator refresh command collects, indexes, and imports `CapacityEvidenceV2` at least every four hours; monitoring alerts when the earliest mandatory expiry is less than 60 minutes away. If that operational obligation is missed, heavy admission closes at expiry while status, cancellation, settings, reads, and downloads remain available.

## 8. Idempotent submission and dispatch

### 8.1 Submission

1. Authenticate the owner.
2. Validate the complete request, ownership, immutable source identity, and reference readiness.
3. Canonicalize the validated request and calculate requestHash.
4. Look up ownerId, operationType, and idempotencyKey.
5. If the key exists with the same hash, return the existing job.
6. If the key exists with a different hash, return 409 IDEMPOTENCY_CONFLICT.
7. Acquire a transaction-scoped owner admission advisory lock in a namespace distinct from the running-generation lock, then enforce at most ten nonterminal generation jobs or 20 nonterminal processing jobs per user, according to the requested operation.
8. Enforce current capacity guards.
9. For generation, resolve and snapshot the active provider and model in the same transaction. For processing, snapshot the source GCS generation and checksum.
10. Derive the generation-zero task name and insert the matching GenerationJob or ProcessingJob with that taskName, state dispatch_pending, dispatchGeneration zero, and progress 2.
11. Commit Neon before calling Cloud Tasks.
12. Create the already-persisted deterministic task name.
13. On Created or AlreadyExists, atomically set state queued, progress 5, and taskCreatedAt.
14. Return HTTP 202 with the durable job representation.

For document ingestion, the request hash includes documentId, sourceGeneration, and sourceSha256. For template compilation, it includes templateId, sourceGeneration, sourceSha256, and compiler version. A changed source therefore requires a new idempotency key and cannot silently mutate queued work.

Task creation is attempted once immediately and retried at most three times with jittered delays centered on 100, 300, and 900 milliseconds, for no more than four CreateTask calls total.

If all four calls fail, the API still returns HTTP 202 with state dispatch_pending and safe code DISPATCH_DELAYED. The browser polls the job and invokes the idempotent dispatch-reconciliation endpoint while that state persists. The repository atomically advances lastDispatchCheckAt so all callers combined can attempt this recovery at most once per job per 30 seconds.

Dispatch reconciliation is also performed:

- when the same idempotency key is resubmitted;
- by an authenticated operator command; and
- opportunistically during API startup without scanning more than 100 rows.

A job is never lost, but a completely idle system with Cloud Tasks unavailable may remain dispatch_pending until traffic or an operator returns. The UI states this honestly.

### 8.2 Task names

Task names use the job UUID, operation, and dispatch generation:

- generation-{jobId}-d{dispatchGeneration}
- processing-{jobId}-d{dispatchGeneration}

AlreadyExists is success only when the database row already contains the same operation, dispatch generation, and task identity. Persisting taskName before CreateTask closes the crash window in which Cloud Tasks accepts a task but Neon has no identity with which to validate AlreadyExists.

When a queued nonterminal job has no active lease, its task retry window has elapsed, and Cloud Tasks GetTask returns NotFound, reconciliation atomically increments dispatchGeneration, persists the next deterministic taskName, clears taskCreatedAt, and commits before CreateTask. The authenticated status path, API startup, and operator command atomically advance lastDispatchCheckAt so all callers combined perform task-presence checks at most once per job per five minutes. After dispatch generation three is exhausted, reconciliation marks the job failed with DISPATCH_EXHAUSTED instead of creating an unbounded series of tasks.

If a newly created task reaches a worker before the API records queued, the worker may claim the matching dispatch_pending row only when the authenticated Cloud Tasks task name equals the persisted taskName. That claim atomically transitions the row to running and makes the delayed queued update a no-op. A task whose identity does not match the row is rejected without work.

A new explicit retry creates a new job UUID and therefore a new task name.

## 9. Delivery, concurrency, and retry ownership

### 9.1 Queue configuration

Generation queue:

- maximum concurrent dispatches: 5;
- maximum dispatches per second: 2;
- minimum backoff: 15 seconds;
- maximum backoff: 120 seconds;
- maximum doublings: 3;
- maximum delivery attempts: 100;
- maximum retry duration: 6 hours;
- task dispatch deadline: 1,680 seconds.

Processing queue:

- maximum concurrent dispatches: 1;
- maximum dispatches per second: 1;
- minimum backoff: 30 seconds;
- maximum backoff: 300 seconds;
- maximum doublings: 3;
- maximum delivery attempts: 3;
- maximum retry duration: 2 hours;
- task dispatch deadline: 1,680 seconds.

The high generation delivery-attempt ceiling exists because a fast capacity deferral is not an actual generation attempt. Neon still permits at most three real work attempts.

After IAM authentication and strict metadata parsing, a worker derives `deliveryOrdinal = max(TaskRetryCount, TaskExecutionCount) + 1` and conditionally stores `deliveryCount = max(deliveryCount, deliveryOrdinal)` only when the task name matches the row. This telemetry update never increments workAttempt and never authorizes a claim.

### 9.2 Atomic generation claim

The worker claim transaction, after matching the authenticated Cloud Tasks task name to the persisted taskName:

1. Locks the job row.
2. Rejects a task identity mismatch without doing work.
3. Returns HTTP 204 for terminal jobs.
4. Permits queued or the matching dispatch_pending crash-window state and returns HTTP 204 for any other nonterminal state that is not claimable.
5. Returns HTTP 204 when a different unexpired lease already owns the job.
6. Returns HTTP 429 without changing workAttempt when availableAt is in the future.
7. Acquires a transaction-scoped Postgres advisory lock derived from ownerId and a fixed namespace.
8. Counts running GenerationJob rows for the same owner.
9. Returns HTTP 429 without changing workAttempt when the count is two.
10. Returns HTTP 204 after marking failed with ATTEMPTS_EXHAUSTED if workAttempt is already three.
11. Otherwise increments workAttempt, assigns a renewable lease, sets running, checkpoints worker_claimed at 10%, and commits.

Cloud Tasks schedules the next delivery after HTTP 429 or a retryable HTTP 503. Capacity deferral never increments workAttempt.

ProcessingJob uses the same claim, lease, and attempt rules without the per-owner running-generation count. The processing queue's single concurrent dispatch is its global execution lock.

### 9.3 Work failure

For a transient network, provider-availability, Cloud Run, renderer, Neon-after-claim, or storage failure:

- persist a safe error and stage;
- set availableAt using 30 seconds, 120 seconds, then 300 seconds for attempts one through three;
- release the lease;
- return HTTP 503 if another actual work attempt remains;
- otherwise mark failed and return HTTP 204.

Authentication, provider quota, invalid input, missing configuration, cancellation, and deterministic validation failures are terminal and return HTTP 204 after durable state is written.

Cloud Tasks never chooses a different provider.

### 9.4 Lease and restart

Generation and processing leases last 90 seconds and renew every 30 seconds. Renewal failure aborts further irreversible work.

Expired leases are reclaimable. Persisted drafts and completed checkpoints allow a later delivery to resume without repeating successful model work.

### 9.5 Cancellation and completion race

Cancellation is a Neon timestamp, not an HTTP connection abort.

Workers check cancellation:

- immediately after claim;
- before each provider call;
- after each provider call;
- before rendering;
- before object publication; and
- inside the final completion transaction.

The completion transaction succeeds only if cancellationRequestedAt is null and the lease is still owned. A concurrent cancellation therefore wins database visibility or receives 409 ALREADY_COMPLETED after success is committed. If cancellation wins after a final object copy began, the worker removes that unreachable final object or moves it under abandoned/{jobId}/; it never exposes a resultDocumentId.

Browser disconnect and refresh never request cancellation.

## 10. Durable progress contract

### 10.1 Generation stages

| Stage | Confirmed floor |
|---|---:|
| accepted | 2 |
| queued | 5 |
| worker_claimed | 10 |
| preparing_references | 15 |
| filling_fields | 25 |
| retrieving | 40 |
| drafting | 65 |
| validating | 80 |
| rendering | 90 |
| saving | 97 |
| succeeded | 100 |

The worker writes a checkpoint only after the corresponding work is durable.

Drafting remains visually active at 65% and does not simulate token progress.

Measurable work may advance within the current stage range using stageCurrent and stageTotal, but confirmedProgress cannot reach the next stage floor before that stage is durably complete.

### 10.2 Processing stages

| Stage | Confirmed floor |
|---|---:|
| accepted | 2 |
| queued | 5 |
| checking_pdf | 10 |
| extracting_text | 20 |
| ocr_pages | 35 |
| structural_recovery | 50 |
| chunking | 65 |
| embedding | 80 |
| persisting | 95 |
| ready | 100 |

Template compilation uses accepted, queued, analyzing_template at 20, generating_preview at 60, persisting at 95, and ready at 100.

### 10.3 Status API

GET /api/generation-jobs/{id} and GET /api/processing-jobs/{id} are owner-scoped.

Responses contain:

- safe job ID and state;
- current stage;
- confirmed progress;
- optional measurable units;
- progress version;
- selected provider and model for generation;
- processing operation and its owner-scoped document/template resource identity for processing;
- safe error;
- allowed actions;
- generated result document ID only after generation success; and
- updated and completion timestamps.

The endpoint returns ETag "progress-{progressVersion}". If If-None-Match matches, it returns HTTP 304 with no body.

### 10.4 Browser polling

The browser:

- polls immediately after submission;
- polls every three seconds while visible;
- after five unchanged versions, backs off to five, eight, then ten seconds;
- never exceeds ten seconds while active;
- pauses while hidden;
- refreshes immediately on visibility return;
- preserves the last confirmed value during read failure;
- shows Đang kết nối lại… while disconnected; and
- resumes from the job ID stored in route state and session storage.

The progress bar uses role="progressbar", a textual stage, aria-valuemin 0, aria-valuemax 100, and aria-valuenow equal to confirmedProgress. An aria-live="polite" region announces stage changes only. Reduced-motion mode removes continuous animation. State is never conveyed by color alone.

## 11. Structured fields and generation fast path

The browser submits fieldValues and lockedFields as structured JSON.

Generation executes:

1. Load the owner-scoped verified template schema.
2. Reject unknown fields.
3. Merge deterministic profile and system values into blank fields only.
4. Compute missing fields.
5. If no fields are missing, record completion_skipped and make zero completion-model calls.
6. Otherwise request only missing fields from the selected model.
7. Merge inferred values without changing locked or nonblank values.
8. Validate the completed schema once.
9. Draft prose only for fields marked generatedBody in the schema.
10. Persist the completed draft and values before rendering.
11. Render once.
12. If the renderer returns one field-specific verified length limit, shorten only that field and render once more.
13. If shortening or the second render fails, retain the first structurally valid deliverable and attach a warning.
14. Publish only after checksum and object persistence succeed.

When docType or templateId is explicit, command-parser rediscovery is forbidden.

When a verified template schema is complete, a separate model planning call is forbidden unless an offline quality evaluation demonstrates a material improvement and the design is amended.

## 12. Retrieval contract

Generation waits until every selected reference ProcessingJob is succeeded. An accepted or running upload is not searchable.

For one retrieval phase:

- create at most three query variants: original, deterministic Vietnamese legal normalization, and deterministic keyword form;
- run the variants concurrently;
- fetch at most 20 candidates per variant;
- deduplicate to at most 40 candidates;
- retain at most eight chunks per document;
- pack at most 12 chunks and 24,000 Unicode characters;
- preserve owner and document provenance for every chunk; and
- reuse the selected evidence for drafting and validation.

No model-based query rewrite runs by default.

Retrieval records query-embedding, lookup, fusion, packing, and total duration without recording query text or extracted evidence in logs.

## 13. PDF parsing and OCR routing

### 13.1 Input limits

PDF upload limits are:

- 20 MiB compressed file size;
- 200 pages;
- 100 MiB parser-expanded working data; and
- owner storage and chunk guards before acceptance.

The upload must have a PDF signature and must open as a PDF under the bounded parser. Encrypted/password-protected files, active-content actions, embedded files, invalid cross-reference structures that require unbounded repair, and a declared MIME/signature mismatch are rejected with safe terminal codes. Parsers run as non-root in a unique local temporary directory; artifacts are image-baked and the parser path performs no outbound fetch.

### 13.2 Page quality classification

PyMuPDF text extraction runs first for every page.

After Unicode normalization, a page is clean searchable text only when all are true:

- at least 80 letter-or-digit characters;
- replacement-character ratio at most 1%;
- control-character ratio at most 1%;
- no single repeated glyph accounts for more than 30% of non-whitespace characters; and
- at least three tokens contain two or more letters or digits.

A page is blank or unusable when it has fewer than 20 letter-or-digit characters or violates either character-quality limit by more than 5%.

Pages between the clean and unusable thresholds are uncertain and receive page-level OCR.

Thresholds are covered by fixed Vietnamese, English, mixed-language, malformed-font, blank, and scanned fixtures. Changing a threshold requires updating the fixtures and benchmark evidence.

### 13.3 Structural recovery

Docling without OCR runs only when a clean or OCR-recovered page has either:

- a detected table with at least two rows and two columns; or
- two or more text columns whose geometric reading order differs from extraction order.

Full-document OCR is permitted only when at least 80% of a document with ten or more pages is unusable and the full-document fixture benchmark is faster than page-level routing without reducing extraction accuracy. Otherwise only identified pages receive OCR.

### 13.4 Telemetry

Parser telemetry contains:

- parser route;
- page count;
- clean, uncertain, and unusable page counts;
- OCR page numbers and count;
- table count;
- structural-recovery page numbers;
- skipped-OCR reason;
- per-stage duration; and
- bounded error codes.

It never contains extracted text.

Docling runtime readiness verifies imports, required artifacts, and writable temporary storage. A real conversion is an image-build self-test and is not repeated during cold-start readiness.

## 14. Q&A fast path

Q&A remains synchronous SSE.

The normal path:

1. Flush SSE headers.
2. Emit a first progress event before retrieval.
3. Enforce a 4,096-character question limit.
4. Perform the single bounded retrieval phase defined above.
5. Apply deterministic sufficiency checks.
6. Make one streamed answer call.
7. Return citations tied to the selected evidence.

Evidence is insufficient when there are no chunks, or when both are true:

- fewer than two distinct supporting chunks remain; and
- no chunk has normalized lexical overlap of at least 0.25 with the deterministic keyword query.

Insufficient evidence returns an honest abstention without an answer-model call.

A single faithfulness call is allowed only when the answer:

- contains a concrete date, monetary value, document number, or quoted legal duty not present verbatim in selected evidence; or
- cites an evidence identifier absent from the selected set.

Answer deltas are explicitly provisional until a terminal SSE event. If no faithfulness trigger exists, `answer_final` commits the answer and citations. If a trigger exists, the server emits `verification_started`, makes one check, and then emits either `answer_final` or `answer_retracted`; the client clears provisional text on retraction and shows an abstention. Checker timeout/error also retracts. Unsupported provisional text is never persisted. No second faithfulness call or synchronous regeneration is allowed. A stricter retry is a new explicit user action.

Timeouts:

- retrieval: 15 seconds;
- first progress event: 1 second;
- total request: 5 minutes; and
- provider answer call: 4 minutes.

## 15. Provider settings and catalogs

The settings API returns safe summaries for both providers and activeConfigId.

Provider-scoped operations are:

- GET /api/settings/llm
- PUT /api/settings/llm/{provider}
- POST /api/settings/llm/{provider}/test
- POST /api/settings/llm/{provider}/models
- PUT /api/settings/llm/active
- DELETE /api/settings/llm/{provider}

Providers are an allowlist, not an arbitrary URL input. Production callers cannot supply base URLs.

OpenRouter models come from its public catalog.

Gemini models come from Google's official model-list endpoint using the submitted or saved Gemini key on the backend. Only models whose supported generation methods include generateContent are returned.

Catalog responses are cached for ten minutes. A credential-dependent cache key is an HMAC fingerprint using the application encryption key; plaintext keys and raw hashes are never stored or logged.

Catalog failures keep the saved model visible as stale but do not invent availability.

## 16. Renderer and object storage

### 16.1 Target buckets

New target buckets use globally distinct names:

- docai-templates-uc1-{project-id}
- docai-uploads-uc1-{project-id}
- docai-rag-state-uc1-{project-id}

All are regional us-central1 Standard storage with uniform access, public-access prevention, object versioning enabled, and force_destroy false. Bucket soft delete is disabled so its additional retained bytes cannot bypass the explicit 14-day noncurrent-version policy.

Object prefixes are:

- originals/{ownerId}/{templateId}.docx
- generated/{ownerId}/{documentId}.docx
- previews/{templateId}/baseline/
- previews/{templateId}/labeled/
- previews/{templateId}/generated/{documentId}/
- uploads/source/{ownerId}/{documentId}.pdf
- uploads/incoming/{ownerId}/
- reports/
- abandoned/{jobId}/

Template admission accepts only an OOXML `.docx` package with a valid content-types part, at most 20 MiB compressed, at most 100 MiB expanded, at most 10,000 ZIP entries, no encrypted entries, no macro project, no absolute/parent-traversal entry, and no external relationship. After central-directory bounds pass, validation streams every member into a non-persisting counting sink to enforce actual cumulative expanded bytes and detect size/CRC corruption before bounded XML inspection; it never extracts entries to the filesystem. Validation occurs before compilation or rendering. The renderer runs non-root and its render path never resolves or fetches network resources.

### 16.2 First-cutover FUSE policy

GCS FUSE remains for the first cutover.

Every render uses a unique container-local directory under /tmp/document-renderer/{jobId}. The renderer never edits an object-mounted original.

The renderer:

1. copies the immutable template to local temporary storage;
2. applies semantic insertions;
3. validates package structure and immutable parts;
4. calculates SHA-256;
5. writes to abandoned/{jobId}/result.docx as a private staging object;
6. verifies object existence, size, and checksum;
7. returns the verified staging-object contract; and
8. deletes local temporary files in a finally block.

The generation worker copies the verified staging object to generated/{ownerId}/{documentId}.docx, verifies the final object, and then performs the conditional completion transaction. Success exposes that final key and schedules staging cleanup. A lost cancellation or lease race removes the uncommitted final object; the abandoned-object lifecycle is the fallback if immediate cleanup fails.

GCS FUSE does not provide write locking. Safety comes from unique document IDs, deterministic object paths, and the GenerationJob completion transaction. Two jobs cannot publish the same result document ID.

Capability checks for LibreOffice, Poppler, fonts, and smoke rendering are cached for the process lifetime.

Renderer maximum instances and concurrency remain one.

### 16.3 Lifecycle rules

- uploads/incoming: delete after one day.
- abandoned: delete after seven days.
- generated preview pages: delete after seven days.
- noncurrent versions: delete after 14 days.
- reports: delete after 30 days.
- live source templates, source PDFs, and completed generated documents: retain while their database record exists.

Application deletion removes the owned live object before completing the database deletion, with compensating recovery if the database mutation fails.

## 17. Regional object migration

Changing a bucket location in Terraform is not treated as an in-place update.

Before target deployment:

1. Inventory every source bucket and every object generation.
2. Record object name, generation, size, CRC32C, MD5 when present, storage class, and timestamp.
3. Create the three new us-central1 buckets under new names.
4. Copy the current live generation of every required object.
5. Verify target names, counts, total bytes, CRC32C, and MD5 when present.
6. Run owner-path validation against database records.
7. Run template read, PDF read, retrieval, render, and download smoke tests against target buckets.
8. Create an encrypted offline archive and manifest for retained historical generations that are not copied.
9. Switch FUSE mounts only after the copy evidence is accepted.
10. Keep source buckets read-only during private acceptance.
11. Delete source buckets only after public reopening approval and explicit confirmation of the retained encrypted archive.

A copy mismatch blocks Cloud SQL deletion and traffic reopening.

## 18. Secret storage contract

Steady state permits at most five active Google Secret Manager versions across the billing account allocation reserved for DocAI. Disabled versions still count as active and therefore must be destroyed after their recovery window.

Service-scoped JSON bundles are:

1. docai-database-runtime: pooled Neon URL.
2. docai-api-runtime: JWT, Redis URL, LLM encryption key, Turnstile, and mail credentials.
3. docai-worker-runtime: LLM encryption key and renderer token.
4. docai-renderer-runtime: renderer token.
5. docai-frontend-origin: current and previous origin tokens.

The direct Neon URL and operator bootstrap credentials are injected as short-lived migration versions. They are destroyed after accepted migration evidence and retained only in the encrypted offline recovery set.

A service receives only its own bundle and, when required, docai-database-runtime. Secret payloads are added through stdin, never Terraform state, command arguments, logs, evidence, or source control.

Steady-state access operations are capped at 7,000 per month. Services load each bundle once per container process.

## 19. Zero-cost operating envelope

### 19.1 Preconditions

The USD 0 gate is valid only when:

- the Google billing account has enough unconsumed shared free allowance;
- Cloudflare Workers is on the Free plan with fail-closed routing;
- Neon and Upstash are on free plans with auto-upgrade disabled;
- no paid Cloud Run minimum instance or networking product is attached;
- all mandatory CapacitySnapshot values are fresh; and
- measured Artifact Registry storage fits the internal ceiling.

If any precondition is false or unknown, heavy admissions are disabled.

### 19.2 Internal hard ceilings

Where an official allowance exists, these values are deliberately below the allowance revalidated on 2026-08-14; the remaining rows are conservative application caps.

| Resource | Internal hard ceiling |
|---|---:|
| Artifact Registry stored image bytes across the billing account | 400 MiB |
| Secret Manager active versions across the billing account | 5 |
| Secret Manager access operations | 7,000/month |
| Cloud Run request-based CPU | 126,000 vCPU-seconds/month |
| Cloud Run request-based RAM | 252,000 GiB-seconds/month |
| Cloud Run container requests | 1,400,000/month |
| Cloud Run outbound internet transfer | 700 MiB/month |
| Cloud Storage Standard data | 3.5 GiB-month |
| Cloud Storage Class A operations | 3,500/month |
| Cloud Storage Class B operations | 35,000/month |
| Cloud Storage transfer from North America | 70 GiB/month |
| Cloud Tasks billable operations | 700,000/month |
| Cloud Logging ingestion | 35 GiB/month |
| Neon logical storage | 350 MiB |
| Neon compute | 70 CU-hours/month |
| Neon public network transfer | 3.5 GiB/month |
| Upstash data | 128 MiB |
| Upstash commands | 350,000/month |
| Upstash bandwidth | 7 GiB/month |
| Cloudflare Worker requests | 70,000/day |
| Cloudflare Worker CPU | 7 ms p95 per invocation |
| Embedded chunks | 1,000/user and 20,000 globally |
| Nonterminal generation jobs | 10/user |

The preflight Artifact Registry projection sums conservatively reported image sizes for every retained current and rollback manifest. Shared layers may be double-counted, so the projected cost can be high but cannot be understated by layer deduplication. Runtime evidence instead sums authoritative `Repository.sizeBytes` across every repository format in the exact project, matching the storage quantity Google uses for billing.

Every ceiling record declares one of two policies. `progressive` applies to metered usage and receives the percentage guard levels below. `hard_limit` applies only to Artifact Registry stored bytes, Secret Manager active versions, embedded-chunk counts, and per-user nonterminal-generation counts. A hard-limit metric passes at or below its ceiling—including the intended steady state of five active secret versions—and normally blocks when it is missing, stale, invalid, or above the ceiling. Hard-limit ratios never raise the 70/85/95 progressive tiers. The sole permitted exception is an Artifact Registry byte overage backed by a schema-valid `approvedException` containing the official pricing-snapshot hash, rounded-up monthly estimate, and explicit monthly approval cap. The record remains `zeroCostStatus: "blocked"` and the artifact remains `zeroCostFeasible: false`. No Secret Manager, database, storage, request, CPU, operation, or application-count ceiling is waivable through this mechanism.

`preflight_projection` derives Artifact Registry bytes from the conservative two-release image footprint, GCS bytes from the all-version source inventory's projected target live objects, and Secret Manager active versions from exactly five target runtime bundles. Current legacy registry bytes and active secret versions are emitted separately as transition evidence and must have executable cleanup/retirement steps; they do not impersonate the future target footprint. `runtime_actual` uses authoritative post-deployment measurements across the complete billing/provider scope and is the only mode importable for live heavy admission.

If the required current and rollback images exceed 400 MiB, the zero-cost claim stops. The operator must choose one of:

- reduce or externalize image contents and remeasure;
- accept the current official estimate under an explicit monthly USD cap recorded in both preflight and runtime evidence; or
- abandon this target architecture.

### 19.3 Guard levels

For each `progressive` internal ceiling:

- below 70%: normal operation;
- at 70%: administrator warning;
- at 85%: disable nonessential preview regeneration, shorten transient retention, and reduce new queued work;
- at 95%: reject new uploads and generation;
- at 100% or unknown/stale: reject all new heavy work.

Authentication, settings, reads, existing downloads, cancellation, and job status remain available whenever Neon itself is reachable.

GCP budgets at approximately USD 1, USD 5, and USD 10 are alerts only.

### 19.4 Capacity decision

Admission uses the worst guard ratio among mandatory `progressive` metrics. Every mandatory `hard_limit` metric must independently be at or below 1.0; an exceeded, missing, or stale hard limit blocks admission without being reclassified as a progressive warning. This separation prevents the exact five-version steady state from being treated as exhausted while preserving a fail-closed absolute cap.

A capacity response includes a stable reason code and Vietnamese message but never account IDs, pricing details tied to another project, or secrets.

Bucket and Artifact Registry usage comes from operator audit snapshots. Cloud Run, Tasks, Secret Manager, and Logging usage comes from official APIs or Cloud Monitoring. Neon and Upstash usage comes from their official account APIs or accepted console exports.

No locally estimated billing ledger is authoritative.

## 20. Runtime sizing and timeouts

| Service | CPU | Memory | Min/max | Concurrency | Timeout |
|---|---:|---:|---:|---:|---:|
| frontend | 1 | 512 MiB | 0/2 | 40 | 300 s |
| API | 1 | 1 GiB | 0/2 | 20 | 300 s |
| generation worker | 2 | 2 GiB | 0/2 | 3 | 1,560 s |
| processing worker | 2 | 2 GiB | 0/1 | 1 | 1,560 s |
| Docling | 2 | 4 GiB | 0/1 | 1 | 900 s |
| embeddings | 2 | 4 GiB | 0/1 | 10 | 180 s |
| renderer | 2 | 2 GiB | 0/1 | 1 | 180 s |

The embeddings implementation serializes local model access. Its concurrency of ten permits lightweight health and queued HTTP requests but does not claim ten parallel model executions.

The target also defines four manually invoked us-central1 Cloud Run jobs: schema migration, user bootstrap, smoke-user bootstrap, and password reset. Each runs one task with parallelism one, zero automatic retries, an immutable backend image digest, and a database connection limit of one. They are never part of readiness or ordinary deployment smoke. A migration/operator job may pin a short-lived direct-database secret version only for its approved execution; that version is disabled and destroyed after accepted migration evidence.

Worker operations have a 1,500-second internal deadline, leaving 60 seconds to persist failure before the Cloud Run request timeout and another 120 seconds before the Cloud Tasks dispatch deadline.

The first cutover retains the existing local Jina embeddings service. Before implementation proceeds, one cold and three warm samples must prove it can become ready and answer inside its timeout with an immutable model revision and verified model checksum. The evidence records whether model artifacts are image-baked or cold-downloaded, the exact cache strategy, total image bytes, startup time, and answer latency. Failure blocks migration and requires a separately approved embeddings design amendment; this specification does not silently substitute an external provider.

The API uses a process connection limit of five. Each worker uses five. Migration and operator jobs use one direct connection. Connection acquisition timeout is ten seconds and connection establishment timeout is fifteen seconds.

## 21. Readiness and degraded operation

API readiness requires:

- Neon connectivity over pooled TLS;
- successful schema-version check; and
- access to the service's required secret bundle.

Generation-worker readiness additionally requires renderer configuration and writable local temporary storage.

Processing-worker readiness additionally requires its parser and embedding endpoints plus renderer configuration for template compilation.

Renderer readiness verifies cached capabilities and writable local temporary storage.

Redis failure reports degraded and never fails readiness.

A GCS outage prevents new upload and result success but does not make authentication or settings unavailable.

A Neon outage returns 503 TEMPORARILY_UNAVAILABLE, prevents new admission, and allows Cloud Tasks to retry.

## 22. Retention and cleanup

- Nonterminal jobs are never compacted.
- Terminal job input, locked fields, and persisted draft are retained for 30 days.
- After 30 days, an operator cleanup command nulls sensitive resumability fields while preserving state, timing, safe error, result ID, and audit timestamps.
- Compacted job metadata is retained for 180 days.
- Capacity snapshots are retained for 90 days.
- Dispatch and provider response bodies are never retained.
- Cleanup is an explicit idempotent operator command and may also process at most 100 eligible rows during API startup.
- Cleanup failure cannot delete live documents or mark a job successful.

## 23. Vietnamese copy contract

The progress UI uses:

- Đã tiếp nhận
- Đang chờ lượt xử lý
- Đang chuẩn bị tài liệu tham chiếu
- Đang bổ sung trường còn thiếu
- Đang tìm căn cứ
- Đang soạn thảo
- Đang kiểm tra
- Đang tạo tệp
- Đang lưu kết quả
- Hoàn tất
- Đang kết nối lại…
- Bạn có thể rời trang; công việc vẫn tiếp tục.

PDF processing uses:

- Kiểm tra PDF
- Trích xuất văn bản
- OCR các trang cần thiết
- Khôi phục bảng và bố cục
- Tạo đoạn
- Tạo embedding
- Sẵn sàng
- Đã nhận dạng lớp văn bản — bỏ qua OCR

Every claim in docs/docai-vietnamese-copywriting-improvements.md is entered into a capability matrix containing:

- exact copy;
- route or component;
- backing capability;
- test file and test name;
- implementation status; and
- approval status.

Copy is not shipped before its capability test passes.

## 24. Backup, restore, and migration safety

### 24.1 Database recovery set

The recovery set contains:

- Cloud SQL export;
- custom-format, data-only pg_dump excluding _prisma_migrations;
- SHA-256 of the dump;
- schema list;
- per-table row counts;
- representative deterministic checksums for stable scalar columns;
- vector dimension and non-null counts;
- source identity;
- quiescence evidence;
- migration list;
- provider-key decryptability evidence without plaintext; and
- an age-encrypted offline duplicate; and
- an age-encrypted credential-recovery archive containing the five target bundle payloads plus only the exact direct/legacy secret versions approved for destruction, with no plaintext staging file.

The age recipient is supplied by the operator. The private identity is never placed in the workspace, terminal transcript, cloud bucket, or release evidence.

A restore rehearsal must decrypt to a temporary path, verify SHA-256, restore into an empty Neon branch through the direct endpoint, run migrations, import data only, and execute owner, vector, provider, retrieval, and generation smoke checks. Credential recovery is rehearsed separately into a resolved OS-temporary path: it verifies the exact secret/version manifest and nonempty payloads without printing values, then removes only that resolved file in `finally`.

### 24.2 Object recovery set

The object recovery set contains:

- all-version source inventory;
- current-live-object target manifest;
- copy verification;
- encrypted archive for historical generations not copied;
- template and generated-document checksum samples; and
- exact source and target bucket identities.

### 24.3 Destructive gate

Cloud SQL, old Cloud Run services, old buckets, and old Artifact Registry resources are not deleted until:

- Cloudflare maintenance is externally verified;
- origin bypass is denied;
- writes are quiescent;
- both recovery sets are accepted;
- the temporary Neon restore passes;
- target object-copy verification passes; and
- the target private deployment passes smoke tests.

Every destructive script defaults to preview and requires exact project, region, resource, evidence paths, evidence hashes, and an explicit confirmation switch.

## 25. Cutover sequence

### Phase 0: Cost and feasibility gate

Measure:

- current database and object size;
- every target container image;
- Artifact Registry projected storage;
- billing-account free-tier availability;
- Secret Manager active versions;
- Cloud Run projected CPU/RAM from p95 benchmarks;
- Neon storage, compute, and transfer; and
- Upstash and Cloudflare plan state.

Stop if any hard ceiling cannot be met.

This phase also runs the Neon region rule and the embeddings cold/warm gate. It occurs before implementation work that depends on the selected topology.

### Phase 1: Online implementation

Implement and test all code, schema migrations, Terraform, copy controls, maintenance mode, and runbooks without changing production traffic or deleting resources.

### Phase 2: Maintenance and quiescence

Enable Cloudflare maintenance, deny direct-origin bypass, stop new heavy admissions, drain active work, and record timestamped, checksummed quiescence evidence.

### Phase 3: Recovery and data migration

Create and verify database and object recovery sets. Restore into a temporary Neon branch. Create and verify new us-central1 buckets. Do not delete source resources.

### Phase 4: Private target deployment

Apply the reviewed target Terraform plan, inject secrets through stdin, run migrations using the direct Neon endpoint, deploy immutable images, and pass light authenticated readiness while maintenance remains active. Then disable—but do not yet destroy—the short-lived direct and obsolete legacy secret versions, collect/import fresh `runtime_actual` `CapacityEvidenceV2`, and run heavy private smoke. A failed smoke may re-enable the exact legacy versions during rollback. Destroy short-lived/obsolete versions only after accepted migration evidence.

### Phase 5: Destructive transition

After private acceptance, remove Cloud SQL and obsolete compute through controlled scripts while retaining encrypted recovery assets. Switch final mounts and runtime secrets to the accepted target.

### Phase 6: Reopen

Review all acceptance evidence with the user. Disable maintenance only after explicit approval. Immediately run public smoke tests and capacity checks.

After reopening, run the zero-cost capacity refresh command at least every four hours. Missing or rejected refresh evidence is a safe heavy-admission outage, not permission to reuse stale capacity.

## 26. Rollback

Before public reopening:

- re-enter or remain in maintenance;
- route back to the previous service revisions when they are schema-compatible;
- otherwise redeploy the recorded previous image digests;
- restore old mounts and database only while the source remains quiescent and intact; and
- never accept writes in both databases.

After public reopening:

- application rollback uses a previous image proven compatible with the Neon schema;
- database migrations are additive through the observation window;
- if compatibility is uncertain, maintenance mode is the rollback;
- new Neon writes are not reversed into Cloud SQL; and
- data repair requires a separately approved recovery plan.

Current and previous image digests are always retained for the rollback window. If their conservative footprint exceeds 400 MiB, the release cannot claim the USD 0 envelope and can proceed only while the measured cost remains within the explicitly approved recurring monthly cap.

## 27. Verification and acceptance evidence

The release record must contain:

1. exact source and target identities;
2. exact deployed image digests and Cloud Run revisions;
3. measured Artifact Registry bytes at or below 400 MiB, or a matching official-pricing estimate and explicit recurring monthly cap with `zeroCostFeasible: false`;
4. billing-account and external-provider `runtime_actual` `CapacityEvidenceV2` with every progressive metric below 70%, every non-Artifact hard limit at or below its ceiling, any Artifact Registry exception within its recorded cap, accepted import evidence, and a failed/stale-refresh test that closes heavy admission;
5. Terraform plan evidence for us-central1, request billing, zero minimum instances, exact maxima, private workers, and absence of Cloud SQL;
6. no direct-origin maintenance bypass;
7. accepted Neon restore, counts, checksums, ownership, vector, and decryption evidence;
8. accepted GCS copy counts, bytes, checksums, mounts, and download evidence;
9. provider coexistence, dynamic catalogs, activation, mutation blocking, and explicit retry tests;
10. generation idempotency, request-hash conflict, lease expiry, restart, cancellation race, render-only retry, and duplicate-delivery tests;
11. five global deliveries without more than two running jobs for one user;
12. capacity deferrals that do not consume workAttempt;
13. processing durability for ingestion and template compilation;
14. searchable, mixed, complex-table, and scanned PDF routing evidence;
15. normal Q&A call count, first progress, first token, citations, abstention, and conditional faithfulness evidence;
16. complete-field zero-completion-call evidence;
17. progress accessibility, monotonicity, refresh, hidden-tab, reconnect, failure, cancellation, and completion evidence;
18. renderer checksum, unique temporary directory, immutable template, and verified publication evidence;
19. cold and warm latency samples for every heavy path;
20. Redis-disconnected readiness and job-completion evidence;
21. encrypted database, object, and credential recovery rehearsal;
22. application rollback and maintenance re-entry rehearsal;
23. truthful-copy capability matrix; and
24. explicit reopening approval followed by public smoke results.

## 28. Success criteria

The migration succeeds only when all are true:

1. Cloud SQL is absent from the reopened target.
2. Every target GCP runtime and bucket is in us-central1.
3. Every Cloud Run service has minimum instances zero and request-based billing.
4. Measured steady-state resources fit every internal zero-cost ceiling.
5. A job survives browser disconnect, refresh, worker restart, duplicate delivery, Redis failure, and transient renderer/storage failure.
6. Per-user running generation never exceeds two; global generation delivery never exceeds five.
7. Capacity deferral does not consume the three-work-attempt budget.
8. User values are preserved and complete forms make zero completion calls.
9. OpenRouter and Gemini configurations coexist and switch explicitly.
10. Provider changes cannot reroute or break nonterminal jobs.
11. Normal Q&A uses one retrieval phase and one streamed answer call.
12. Searchable PDFs bypass OCR and mixed PDFs OCR only classified pages.
13. Template compilation and document ingestion are both durable ProcessingJobs.
14. Progress is accessible, durable, monotonic, and honest.
15. Results are downloadable only after structural and object verification.
16. Cloudflare maintenance cannot be bypassed at the direct origin.
17. Recovery, rollback, capacity, latency, security, and copy evidence is accepted before reopening.

## 29. Implementation-plan decomposition

This design is implemented through one orchestration plan and six focused child plans:

1. docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-01-preflight.md
2. docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-02-data-provider-contracts.md
3. docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-03-durable-workers.md
4. docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-04-fast-paths-progress.md
5. docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-05-infrastructure-cutover.md
6. docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-06-acceptance-reopening.md

The existing migration document becomes the dependency graph, phase gate, and execution handoff. Each child plan must produce independently reviewable, testable software or operational evidence and must use exact interfaces, commands, expected outcomes, and commit boundaries.

## 30. Pricing references frozen for preflight revalidation

The preflight audit revalidates these official sources on the execution date:

- Cloud Run pricing: https://cloud.google.com/run/pricing
- Artifact Registry pricing: https://cloud.google.com/artifact-registry/pricing
- Cloud Storage pricing: https://cloud.google.com/storage/pricing
- Cloud Tasks pricing: https://cloud.google.com/tasks/pricing
- Secret Manager pricing: https://cloud.google.com/secret-manager/pricing
- Cloud Logging pricing: https://cloud.google.com/logging/pricing
- Neon pricing: https://neon.com/pricing
- Neon network transfer: https://neon.com/docs/introduction/network-transfer
- Neon project usage fields: https://neon.com/docs/manage/projects
- Upstash Redis pricing: https://upstash.com/pricing/redis
- Upstash database stats API: https://upstash.com/docs/devops/developer-api/redis/get_database_stats
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Workers metrics API: https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/
