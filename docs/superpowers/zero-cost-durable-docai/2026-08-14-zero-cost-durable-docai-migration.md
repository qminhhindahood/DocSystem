# Zero-Cost Durable DocAI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate DocAI from Cloud SQL and in-process heavy work to a Neon-backed, Cloud Tasks-delivered, scale-to-zero deployment in us-central1, with durable generation and processing, protected Cloud Run origins, verified recovery, and a conditional USD 0 steady-state envelope.

**Architecture:** This is the orchestration plan for six independently reviewable implementation plans. Neon is the durable source of truth, Cloud Tasks owns delivery, private Cloud Run workers perform heavy work, GCS stores immutable inputs and verified outputs, Cloudflare protects the only public application origin, and an evidence manifest controls every destructive or public-traffic transition.

**Tech Stack:** TypeScript 7, Express 4, Prisma 5/PostgreSQL/pgvector, Next.js 16, React 19, Jest 29, Vitest 4, Python 3.11/FastAPI/PyMuPDF/Docling, .NET 10/Open XML, Terraform 1.8+, Google Cloud Run/Tasks/Storage/Secret Manager, Neon, Upstash, Cloudflare Workers, PowerShell 7/Pester.

**Spec:** `docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-design.md`

## Global Constraints

- The steady-state USD 0 objective is conditional; a stale, missing, or exceeded mandatory capacity snapshot disables new heavy work.
- Percentage guard tiers apply only to progressive usage metrics; binary hard-limit metrics pass at or below their ceiling, including exactly five active secret versions.
- A measured Artifact Registry overage is the only hard-limit exception: it requires current official pricing evidence, an explicit monthly approval cap, and `zeroCostFeasible: false`; all other hard limits remain non-waivable.
- Preflight capacity is a target projection. Legacy registry and secret usage is separate transition debt that must be retired and remeasured before runtime evidence can open heavy admission.
- An authenticated operator refreshes and imports release-bound capacity evidence at least every four hours; monitoring warns when the earliest mandatory expiry is under 60 minutes.
- All new Google Cloud runtime resources, queues, registry storage, and buckets use `us-central1`.
- Neon defaults to `aws-us-east-2`; another free region is permitted only after 20 connect-and-query samples satisfy the spec's 15% median-improvement and 10% p95-regression rule.
- Every Cloud Run service uses request-based billing, `min_instance_count = 0`, CPU idle enabled, and the exact maxima in the spec.
- The generation queue has concurrency 5, rate 2/s, 15–120 second backoff, 100 delivery attempts, a 6-hour retry window, and a 1,680-second dispatch deadline.
- The processing queue has concurrency 1, rate 1/s, 30–300 second backoff, 3 delivery attempts, a 2-hour retry window, and a 1,680-second dispatch deadline.
- API enqueue uses one immediate CreateTask attempt plus at most three retries delayed by jittered 100, 300, and 900 millisecond intervals.
- A user may have at most two running generation jobs and ten nonterminal generation jobs. The running limit is serialized with a transaction-scoped PostgreSQL advisory lock.
- A user may have at most 20 nonterminal processing jobs across ingestion and template compilation.
- `dispatchGeneration` ranges from 0 through 3, allowing four bounded task identities; a job still has at most three real work attempts. Capacity deferral does not consume a work attempt.
- Leases last 90 seconds, renew every 30 seconds, and all worker operations stop at an internal 1,500-second deadline.
- Cloud Tasks payloads contain exactly `{ "jobId": "UUID", "operation": "generation" | "processing" }` and remain below 1 KiB.
- Provider and model selection are immutable job snapshots. No automatic cross-provider failover is allowed.
- User-entered structured field values are authoritative. Complete input performs zero field-completion calls.
- Searchable PDF pages bypass OCR; uncertain/unusable pages alone receive OCR; Docling without OCR is reserved for the exact table/multicolumn recovery conditions in the spec.
- Progress comes only from monotonic Neon checkpoints. Browser timers never invent percentage progress.
- The renderer stages under `abandoned/{jobId}/result.docx` and exposes a final object only after checksum verification and conditional database completion.
- Upstash is optional and disposable. Redis failure cannot fail core readiness, erase progress, or stop already admitted work.
- The only unauthenticated direct frontend-origin route is `/internal/live`. Every other route requires the rotating Cloudflare origin token.
- GCS source buckets are never treated as in-place regional updates. New `-uc1-` buckets are copied and verified before mount switching.
- Steady state uses at most five active Secret Manager versions. Secret payloads never enter Terraform state, command arguments, logs, or evidence.
- No production deletion, shutdown, import, Terraform apply, Worker deployment, or reopening occurs without resolving and displaying exact targets immediately beforehand.
- Existing unrelated worktree changes belong to the user. Stage only files listed by the active task.
- Use red-green TDD for behavior changes and run `git diff --check` before every task commit.

---

## Plan Suite and Dependency Graph

| Order | Plan | Depends on | Independently reviewable output |
|---:|---|---|---|
| 1 | `2026-08-14-zero-cost-durable-docai-01-preflight.md` | Approved design | Accepted checksummed GO/NO_GO preflight, recovery tooling, feasibility evidence |
| 2 | `2026-08-14-zero-cost-durable-docai-02-data-provider-contracts.md` | Plan 01 GO for topology assumptions | Additive Prisma contracts, repositories, provider APIs and provider UI |
| 3 | `2026-08-14-zero-cost-durable-docai-03-durable-workers.md` | Plan 02 interfaces | Capacity guard, Cloud Tasks dispatch, generation and processing workers |
| 4 | `2026-08-14-zero-cost-durable-docai-04-fast-paths-progress.md` | Plans 02–03 | Missing-only fields, bounded retrieval/Q&A/PDF paths, staged rendering, durable UI |
| 5 | `2026-08-14-zero-cost-durable-docai-05-infrastructure-cutover.md` | Plans 01–04 | Origin protection, target Terraform, CI/CD, GCS copy and cutover tooling |
| 6 | `2026-08-14-zero-cost-durable-docai-06-acceptance-reopening.md` | Plans 01–05 | Full evidence gate, rehearsed rollback, controlled migration, reopening |

Execution is sequential unless the user explicitly authorizes subagents. Do not start a dependent plan while its predecessor's exit gate is red.

## Locked File and Interface Map

The child plans own these boundaries:

- Plan 01 owns `ops/lib/Evidence.psm1`, preflight/capacity/backup/restore scripts, and `preflight-decision.json`.
- Plan 02 owns `backend/src/types/jobs.ts`, Prisma job/provider/snapshot models, job repositories, provider API contracts, and frontend provider cards.
- Plan 03 owns `backend/src/services/cloud_tasks_service.ts`, `capacity_guard.ts`, job routes, task handlers, and worker entry points.
- Plan 04 owns generation/processing fast paths, the C# staged-render contract, and the frontend durable-progress client/view.
- Plan 05 owns Cloudflare origin enforcement, Terraform target resources, GitHub deployment wiring, object-copy/cutover scripts, and infrastructure runbooks.
- Plan 06 owns `ops/schemas/release-manifest.schema.json`, acceptance aggregation, production benchmarking/smoke, rollback/reopen commands, and the final release record.

No child plan may rename an interface produced by an earlier plan without updating that earlier plan and rerunning all downstream interface checks.

## Evidence Directory Contract

All generated operational evidence is ignored by Git and stored under:

    .artifacts/releases/$ReleaseSha/
      00-preflight/
      01-build/
      02-quiescence/
      03-recovery/
      04-private-deploy/
      05-acceptance/
      06-reopen/
      07-observation/
      release-manifest.json

Every JSON evidence file contains:

~~~json
{
  "schemaVersion": 1,
  "releaseSha": "40 lowercase hexadecimal characters",
  "createdAt": "UTC ISO-8601 timestamp",
  "status": "passed | failed | blocked",
  "subject": "safe non-secret identifier",
  "checks": [
    { "name": "stable check name", "status": "passed", "actual": "safe value" }
  ]
}
~~~

`release-manifest.json` additionally contains the spec SHA-256, deployed image digests, target identities, gate outcomes, and `{ path, sha256, kind }` entries for every accepted artifact. It must contain no URL credentials, secret values, document text, prompt text, extracted evidence, or provider responses.

## Definition of a Green Task

A task is green only when:

1. its new focused test failed for the intended missing behavior;
2. the minimal implementation makes that test pass;
3. the task's focused suites pass;
4. the package build/typecheck relevant to the task passes;
5. `git diff --check` passes;
6. `git status --short` shows no accidentally staged user files;
7. the task commit contains only its declared files; and
8. the stated interface/output can be consumed by the next task.

---

### Task 1: Execute the Preflight and Recovery-Tooling Plan

**Files:**

- Read: `docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-01-preflight.md`
- Produce at execution time: `.artifacts/releases/$ReleaseSha/00-preflight/preflight-decision.json`

**Interfaces:**

- Consumes: approved design specification and current read-only GCP/database/container inventories.
- Produces: `PreflightDecisionV2` with `decision: "GO" | "NO_GO"`, selected Neon region, embedding feasibility, projected one-time cost, known recurring Artifact Registry cost and approval cap, `zeroCostFeasible`, a checksummed `preflight_projection` `CapacityEvidenceV2` reference, legacy-transition inventory, and recovery-tool rehearsal evidence.

- [ ] **Step 1: Implement Plan 01 task-by-task**

Run each checkbox in the child plan with red-green verification and its stated commit boundary.

- [ ] **Step 2: Run the Plan 01 gate**

~~~powershell
$ReleaseSha = (git rev-parse HEAD).Trim()
if ($ReleaseSha -notmatch '^[a-f0-9]{40}$') { throw 'Release SHA must be full length' }
pwsh -NoProfile -File ops/gcp/invoke-preflight.ps1 `
  -ProjectId project-96fe5a5e-a0df-4a2f-902 `
  -BillingAccountId $env:DOC_AI_BILLING_ACCOUNT_ID `
  -SourceRegion asia-southeast1 `
  -TargetRegion us-central1 `
  -ReleaseSha $ReleaseSha `
  -AgeRecipient $env:DOC_AI_AGE_RECIPIENT `
  -PricingApprovalSha256 $env:DOC_AI_PRICING_APPROVAL_SHA256 `
  -ExecuteRehearsal `
  -EvidenceDirectory ".artifacts/releases/$ReleaseSha/00-preflight"
~~~

Expected: exit 0 and `preflight-decision.json` has `decision = "GO"`. Any hard ceiling failure, unmeasured image, failed local-Jina cold/warm gate, missing encrypted recovery rehearsal, or nonzero migration estimate without recorded approval produces `NO_GO` and a nonzero exit.

- [ ] **Step 3: Review the evidence**

Confirm no evidence file matches `postgres(?:ql)?://`, `Bearer `, `sk-`, `AIza`, or extracted document text. Confirm the chosen Neon region follows the exact sampling rule.

- [ ] **Step 4: Record the gate**

Do not continue to Task 2 until the user accepts the checksummed `GO` evidence.

---

### Task 2: Execute the Data and Provider Contract Plan

**Files:**

- Read: `docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-02-data-provider-contracts.md`

**Interfaces:**

- Consumes: accepted `PreflightDecisionV2` from Task 1, including the exact recurring-cost disposition and checksummed `CapacityEvidenceV2` reference.
- Produces: generated Prisma client plus `GenerationJobRepository`, `ProcessingJobRepository`, `CapacitySnapshotRepository`, provider-scoped backend routes, and the matching frontend types.

- [ ] **Step 1: Verify the preflight dependency**

~~~powershell
$Decision = Get-Content ".artifacts/releases/$ReleaseSha/00-preflight/preflight-decision.json" -Raw | ConvertFrom-Json
if ($Decision.decision -ne 'GO') { throw 'Preflight is not GO' }
~~~

Expected: no output and exit 0.

- [ ] **Step 2: Implement Plan 02 task-by-task**

Follow its migration-integrity, repository, route, and frontend TDD cycles. Apply migrations only to disposable local/test databases.

- [ ] **Step 3: Run the Plan 02 exit gate**

~~~powershell
npm --prefix backend test -- --runInBand `
  scripts/check_migration_integrity.test.ts `
  src/services/generation_job_repository.test.ts `
  src/services/processing_job_repository.test.ts `
  src/services/capacity_snapshot_repository.test.ts `
  src/routes/llm-settings.contract.test.ts
npm --prefix backend run build
npm --prefix frontend test -- --run test/llm-providers.test.ts test/settings-page.test.tsx
npm --prefix frontend run typecheck
git diff --check
~~~

Expected: all suites pass, both builds/typechecks exit 0, and no whitespace errors.

---

### Task 3: Execute the Durable Worker Plan

**Files:**

- Read: `docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-03-durable-workers.md`

**Interfaces:**

- Consumes: repositories and types emitted by Plan 02.
- Produces: `CloudTasksService`, `CapacityGuard`, owner-scoped job routes, idempotent generation/processing task handlers, and separate worker executables.

- [ ] **Step 1: Implement Plan 03 task-by-task**

Do not create real cloud tasks during unit tests; inject `TasksTransport`.

- [ ] **Step 2: Run the Plan 03 exit gate**

~~~powershell
npm --prefix backend test -- --runInBand `
  src/services/cloud_tasks_service.test.ts `
  src/services/capacity_guard.test.ts `
  src/scripts/import_capacity_snapshots.test.ts `
  src/routes/generation-jobs.contract.test.ts `
  src/routes/processing-jobs.contract.test.ts `
  src/services/object_validation_service.test.ts `
  src/services/generation_job_worker.test.ts `
  src/services/processing_job_worker.test.ts `
  src/index.worker_wiring.test.ts
npm --prefix backend run build
git diff --check
~~~

Expected: all tests pass and TypeScript emits both worker entry points.

---

### Task 4: Execute the Fast Paths and Durable Progress Plan

**Files:**

- Read: `docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-04-fast-paths-progress.md`

**Interfaces:**

- Consumes: immutable job snapshots, worker handler contracts, and provider APIs from Plans 02–03.
- Produces: bounded generation/Q&A/PDF pipelines, verified staging publication, and the frontend durable-job experience.

- [ ] **Step 1: Implement Plan 04 task-by-task**

Preserve the old synchronous workflow only as a compatibility surface until the new frontend tests are green; it must not receive new UI traffic afterward.

- [ ] **Step 2: Run the Plan 04 exit gate**

~~~powershell
npm --prefix backend test -- --runInBand `
  src/services/field_completion_service.test.ts `
  src/services/durable_generation_pipeline.test.ts `
  src/services/retrieval_plan.test.ts `
  src/routes/qa.contract.test.ts `
  src/services/qa_latency.test.ts
npm --prefix backend run build
python -m pytest docling-service/tests -q
dotnet test document-renderer/DocumentRenderer.sln
npm --prefix frontend test -- --run `
  test/generate-page-fast-path.test.tsx `
  test/generation-jobs.test.ts `
  lib/ui/job-progress.test.ts `
  test/generation-progress-card.test.tsx `
  test/generation-cancellation.test.tsx `
  test/qa-page.test.tsx `
  test/qa-cancellation.test.tsx
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
git diff --check
~~~

Expected: every command exits 0; complete-field fixtures record zero completion calls; searchable-PDF fixtures record zero OCR calls.

---

### Task 5: Execute the Infrastructure and Cutover-Tooling Plan

**Files:**

- Read: `docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-05-infrastructure-cutover.md`

**Interfaces:**

- Consumes: exact runtime entry points, environment names, queue contracts, object prefixes, and service dependencies from Plans 02–04.
- Produces: fail-closed edge/origin behavior, reviewed target Terraform, immutable deployment workflow, regional object-copy tooling, release-bound capacity publication/refresh, and preview-safe cutover commands.

- [ ] **Step 1: Implement Plan 05 task-by-task**

Do not apply Terraform, deploy Cloudflare, copy production objects, or delete legacy resources during implementation.

- [ ] **Step 2: Run the offline infrastructure gate**

~~~powershell
npm --prefix cloudflare-worker test
npm --prefix frontend test -- --run test/origin-token.test.ts test/proxy.test.ts test/proxy-route.test.ts test/cloud-run-auth.test.ts
$TaskTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$TaskTempPrefix = $TaskTempRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$TerraformDataDir = [IO.Path]::GetFullPath((Join-Path $TaskTempRoot ('docai-plan-' + [guid]::NewGuid().ToString('N'))))
if (-not $TerraformDataDir.StartsWith($TaskTempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Unsafe Terraform data directory'
}
$PreviousTerraformDataDir = [Environment]::GetEnvironmentVariable('TF_DATA_DIR', 'Process')
try {
  $env:TF_DATA_DIR = $TerraformDataDir
  terraform -chdir=infra/terraform fmt -recursive -check
  terraform -chdir=infra/terraform init -backend=false -input=false
  terraform -chdir=infra/terraform validate
  Invoke-Pester -Path @('ops/tests/TerraformConfig.Tests.ps1','ops/tests/TerraformPlan.Tests.ps1') -Output Detailed
  Invoke-Pester -Path @('ops/tests/CapacityPublication.Tests.ps1','ops/tests/GcpRunbooks.Tests.ps1') -Output Detailed
} finally {
  if (Test-Path -LiteralPath $TerraformDataDir) {
    $ResolvedTerraformDataDir = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $TerraformDataDir).Path)
    if (-not $ResolvedTerraformDataDir.StartsWith($TaskTempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Refusing unsafe Terraform cleanup'
    }
    Remove-Item -LiteralPath $ResolvedTerraformDataDir -Recurse -Force
  }
  if ($null -eq $PreviousTerraformDataDir) { Remove-Item Env:TF_DATA_DIR -ErrorAction SilentlyContinue }
  else { $env:TF_DATA_DIR = $PreviousTerraformDataDir }
}
git diff --check
~~~

Expected: Worker/frontend tests pass, Terraform is formatted and valid, Pester reports zero failures, and no production state changes occur.

---

### Task 6: Execute the Acceptance and Reopening Plan

**Files:**

- Read: `docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-06-acceptance-reopening.md`
- Produce at execution time: `.artifacts/releases/$ReleaseSha/release-manifest.json`

**Interfaces:**

- Consumes: all prior plan outputs and the exact `GO` preflight.
- Produces: a schema-valid checksummed release record, accepted private deployment, explicit reopening approval, public smoke evidence, and an observation/cleanup record.

- [ ] **Step 1: Re-run the complete local gate**

~~~powershell
pwsh -NoProfile -File ops/verify-all.ps1 -IncludeCutoverRehearsal -IncludeRendererContainer
npm --prefix cloudflare-worker test
git diff --check
git status --short
~~~

Expected: `All verification steps passed.`, Worker tests pass, and status contains only intentional changes.

- [ ] **Step 2: Execute Plan 06 through private acceptance**

Follow its exact target-resolution, maintenance, quiescence, recovery, copy, deployment, smoke, benchmark, capacity, and rollback-rehearsal steps. Stop at its reopening approval gate.

- [ ] **Step 3: Obtain explicit reopening approval**

Present the release manifest, all failed or waived checks, measured cost ratios, rollback result, and retained recovery assets. A missing answer is not approval.

- [ ] **Step 4: Reopen and verify**

Run only the Plan 06 reopening command after approval. If public smoke or the post-open capacity snapshot fails, immediately re-enter maintenance and preserve evidence.

- [ ] **Step 5: Close the migration**

After the observation window and a second explicit destructive approval, remove only the resolved legacy services, Cloud SQL instance, source buckets, obsolete registry images, secret versions, and the old `IngestionJob` table named in the cleanup preview. Record what was removed, whether it is recoverable, and the recovery-asset retention date.

## Final Acceptance Gate

The migration is complete only when all 24 evidence items and all 17 success criteria in the design specification map to a passing `release-manifest.json` check. Waivers are not success: any waiver keeps the manifest status `blocked` and Cloudflare maintenance enabled.

## Execution Handoff

Plan suite complete. Execute it inline with `superpowers:executing-plans` unless the user explicitly requests subagent-driven execution. Begin with Plan 01 and stop on its first `NO_GO` result.
