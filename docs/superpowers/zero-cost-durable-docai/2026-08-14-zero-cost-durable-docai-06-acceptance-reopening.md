# Zero-Cost Durable DocAI Acceptance and Reopening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn all design claims into schema-validated evidence, rehearse recovery and rollback, execute the maintenance-window migration safely, reopen only after explicit approval, and retire legacy resources after a clean observation window.

**Architecture:** A release-manifest builder accepts only checksummed artifacts for 24 named acceptance controls and maps them to all 17 success criteria. Production smoke/benchmark tools emit data-free JSON. Cutover remains in maintenance through private acceptance and destructive transition; reopening is a separate command requiring the accepted manifest hash. A 14-day observation gate precedes source-bucket, legacy-secret, registry, and old-table cleanup.

**Tech Stack:** PowerShell 7/Pester, JSON Schema, gcloud/Terraform/Wrangler, PostgreSQL tools, Jest/Vitest/pytest/xUnit, Cloud Run/Tasks/Storage, Neon, Cloudflare Workers.

**Spec:** `docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-design.md`

## Global Constraints

- Plans 01–05 and the complete local verification gate must be green.
- There are no acceptance waivers. Missing, failed, stale, unhashed, or secret-bearing evidence keeps status `blocked` and maintenance enabled.
- Every exact production identity is re-resolved and displayed immediately before mutation.
- Maintenance must be externally verified and direct-origin bypass denied before quiescence.
- No new heavy work is admitted after quiescence begins; both databases are never writable at once.
- The database and object recovery sets must be encrypted, checksummed, and restore-rehearsed before Cloud SQL deletion.
- Target GCS object counts, total bytes, CRC32C, MD5 when present, owner paths, reads, renders, and downloads must pass before mount switching.
- Private target smoke, concurrency, restart, cancellation, duplicate-delivery, Redis-degraded, rollback, capacity, and copy evidence must pass before destructive transition.
- Public reopening requires an explicit user approval tied to the exact release-manifest SHA-256.
- A failed public smoke or capacity refresh immediately re-enables maintenance.
- Provider/model latency is reported separately from DocAI queue/wake/retrieval/render time.
- UI percentages must equal persisted checkpoints; a visual timer is not evidence.
- Claims from `docs/docai-vietnamese-copywriting-improvements.md` ship only when their matrix row has a passing capability test.
- Unsupported DOCX ingestion, PDF export, automatic learning, fixed legal-component counts, guaranteed legal compliance, absolute extraction accuracy, and fixed completion-time claims remain absent.
- Legacy source buckets and old `IngestionJob` are retained for at least 14 consecutive clean days after reopening.

---

## File Map

- Create `ops/schemas/release-manifest.schema.json`: 24-control acceptance schema.
- Create `ops/gcp/build-release-manifest.ps1` and Pester tests.
- Create `docs/copy-capability-matrix.md` and frontend claim contract test.
- Modify only verified copy surfaces in landing/dashboard/sidebar/generate/documents/templates/Q&A/settings.
- Create `ops/gcp/benchmark-production.ps1`.
- Modify `ops/gcp/smoke-production.ps1`.
- Create `ops/tests/ProductionAcceptance.Tests.ps1`.
- Modify `ops/tests/GcpRunbooks.Tests.ps1`.
- Create `ops/gcp/reopen-production.ps1`.
- Modify `ops/gcp/rollback.ps1`.
- Modify production/rollback runbooks.
- Modify `ops/verify-all.ps1` to aggregate the complete local gate.
- After observation only: create `20260828000000_drop_legacy_ingestion_jobs`, remove legacy Prisma/repository code, and run a second release.

---

### Task 1: Create a Manifest That Covers All Acceptance Controls and Success Criteria

**Files:**

- Create: `ops/schemas/release-manifest.schema.json`
- Create: `ops/gcp/build-release-manifest.ps1`
- Create: `ops/tests/ReleaseManifest.Tests.ps1`

**Interfaces:**

- Consumes: `.artifacts/releases/$ReleaseSha/00-preflight` through `06-reopen`.
- Produces: `.artifacts/releases/$ReleaseSha/release-manifest.json`.
- Script:

~~~text
build-release-manifest.ps1
  -ReleaseSha 40-hex
  -SpecPath exact path
  -EvidenceRoot safe ignored path
  -OutputPath safe ignored path
~~~

- [ ] **Step 1: Write failing schema/coverage tests**

~~~powershell
Describe 'Release manifest coverage' {
  It 'requires exactly the 24 design evidence controls' {
    $schema = Get-Content $SchemaPath -Raw
    foreach ($id in 1..24 | ForEach-Object { 'E{0:d2}' -f $_ }) {
      $schema | Should -Match [regex]::Escape($id)
    }
  }

  It 'blocks a missing or failed control' {
    $fixture = New-ManifestFixture -AllPassed
    $fixture.controls.E10.status = 'failed'
    $result = Build-ReleaseManifest $fixture
    $result.status | Should -Be 'blocked'
  }

  It 'rejects evidence with a mismatched hash' {
    { Build-ReleaseManifest (New-ManifestFixture -BadHash E03) } |
      Should -Throw '*checksum mismatch*'
  }
}
~~~

Also assert all 17 `S01`–`S17` success IDs are present, every success maps to one or more evidence IDs, no unknown controls are allowed, and secret scan failure blocks output.

- [ ] **Step 2: Run and verify failure**

Run:

~~~powershell
Invoke-Pester ops/tests/ReleaseManifest.Tests.ps1 -Output Detailed
~~~

Expected: FAIL because schema/builder are absent.

- [ ] **Step 3: Define the 24 evidence controls exactly**

The manifest requires:

| ID | Required evidence |
|---|---|
| E01 | exact source/target identities |
| E02 | deployed image digests and revisions |
| E03 | Artifact Registry bytes at or below 400 MiB, or a matching official-pricing estimate within the exact approved recurring monthly cap and `zeroCostFeasible: false` |
| E04 | fresh `runtime_actual` `CapacityEvidenceV2` with progressive metrics below 70%, non-Artifact hard limits at or below ceiling, any Artifact Registry exception within cap, accepted import, and stale/failed-refresh fail-closed behavior |
| E05 | Terraform target invariants and no Cloud SQL |
| E06 | maintenance and direct-origin denial |
| E07 | Neon restore/count/checksum/ownership/vector/decryption |
| E08 | GCS copy/count/byte/checksum/mount/download |
| E09 | provider coexistence/catalog/activation/config-in-use/retry |
| E10 | generation idempotency/hash/lease/restart/cancel/render-retry/duplicate |
| E11 | five deliveries and two-running-per-user invariant |
| E12 | capacity deferral consumes zero work attempts |
| E13 | durable ingestion and template compilation |
| E14 | searchable/mixed/table/scanned PDF routing |
| E15 | Q&A calls/timing/citations/abstention/faithfulness |
| E16 | complete-field zero-completion-call |
| E17 | progress accessibility/monotonicity/refresh/reconnect/terminal states |
| E18 | renderer isolation/checksum/immutable template/verified publication |
| E19 | cold and warm latency samples |
| E20 | Redis-disconnected readiness and completion |
| E21 | encrypted database/object/credential recovery rehearsal |
| E22 | application rollback and maintenance re-entry rehearsal |
| E23 | truthful-copy capability matrix |
| E24 | explicit reopening approval and public smoke |

Map `S01`–`S17` in the exact order of design section 28. Each control has `status: "pending" | "passed" | "failed" | "blocked"`, evidence paths, SHA-256 values, `observedAt`, and a safe summary. The top-level manifest status is `building`, `blocked`, `blocked_for_reopening_approval`, or `accepted`. A building manifest may index pending controls; `blocked_for_reopening_approval` requires E01–E23 passed and only E24 pending; `accepted` requires E01–E24 passed. Any failed/blocked required control forces top-level `blocked`.

- [ ] **Step 4: Implement checksummed aggregation**

The builder:

1. resolves paths inside the exact release evidence root;
2. verifies every SHA-256;
3. validates nested evidence `releaseSha`;
4. rejects evidence older than its control-specific maximum age;
5. rejects any `failed`, `blocked`, or unknown status;
6. scans all text/JSON for secret patterns;
7. computes the spec SHA-256;
8. derives each success status from mapped controls; and
9. writes `status = "accepted"` only when E01–E24 and S01–S17 all pass.

Before reopening, E24 is intentionally pending and the manifest status is `blocked_for_reopening_approval`; after approval/public smoke the builder emits final `accepted`.

- [ ] **Step 5: Run and commit**

Run:

~~~powershell
Invoke-Pester ops/tests/ReleaseManifest.Tests.ps1 -Output Detailed
Test-Json -Json (Get-Content ops/schemas/release-manifest.schema.json -Raw) -ErrorAction Stop
git diff --check
~~~

Expected: tests pass and schema parses.

Commit:

~~~powershell
git add -- ops/schemas/release-manifest.schema.json ops/gcp/build-release-manifest.ps1 ops/tests/ReleaseManifest.Tests.ps1
git commit -m "test: require complete release acceptance evidence"
~~~

---

### Task 2: Gate Every Vietnamese Claim on a Capability Test

**Files:**

- Read only: `docs/docai-vietnamese-copywriting-improvements.md`
- Create: `docs/copy-capability-matrix.md`
- Create: `frontend/test/copy-capability.test.ts`
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/app/(app)/dashboard/page.tsx`
- Modify: `frontend/components/layout/Sidebar.tsx`
- Modify: `frontend/app/(app)/generate/page.tsx`
- Modify: `frontend/app/(app)/documents/page.tsx`
- Modify: `frontend/app/(app)/templates/page.tsx`
- Modify: `frontend/app/(app)/qa/page.tsx`
- Modify: `frontend/components/settings/LLMSettingsForm.tsx`
- Modify: `frontend/components/settings/LLMProviderForm.tsx`

**Interfaces:**

- Consumes: the proposal document plus passing test names from Plans 02–04.
- Produces: one matrix row per proposed claim:

~~~text
ID | exact proposed copy | decision | final copy | route/component |
backing capability | test file | exact test name | status | approval
~~~

- [ ] **Step 1: Write a failing copy contract test**

~~~typescript
it.each([
  'Xuất bản đa định dạng (.docx, .pdf)',
  'Tải lên tệp PDF hoặc DOCX',
  'Hệ thống sẽ tự động học hỏi',
  'kiểm tra 9 thành phần',
  'đối soát dữ liệu tuyệt đối chính xác',
  'sẵn sàng phê duyệt chỉ trong vài phút',
])('does not ship unsupported claim: %s', phrase => {
  expect(renderedProductCopy()).not.toContain(phrase);
});
~~~

Add positive assertions for exact approved progress, reconnect, durable-leave-page, provider, OCR-skip, and honest-abstention copy backed by named tests.

- [ ] **Step 2: Run and verify failure**

Run:

~~~powershell
npm --prefix frontend test -- --run test/copy-capability.test.ts
~~~

Expected: FAIL until the capability matrix and truthful replacements exist.

- [ ] **Step 3: Build the complete matrix**

For every proposal row, choose:

- `ship`: exact capability and passing test exist;
- `rewrite`: retain the intent but remove unsupported certainty/scope;
- `defer`: capability absent.

Required rewrites:

| Unsupported proposal | Truthful replacement |
|---|---|
| guaranteed legal/absolute correctness | `Hỗ trợ rà soát thể thức và hiển thị kết quả để bạn kiểm tra.` |
| PDF export | `Tải DOCX` |
| DOCX reference ingestion | `Tải PDF làm tài liệu nguồn` |
| automatic learning | `Bạn có thể gửi phản hồi chỉnh sửa để xem xét.` |
| fixed nine components | `Kiểm tra các thành phần được mẫu và quy tắc hiện tại hỗ trợ.` |
| completion in minutes | no fixed-time claim; show durable stages |

- [ ] **Step 4: Apply only approved copy**

Use consistent glossary:

- `Soạn thảo văn bản`;
- `Văn bản hành chính`;
- `Rà soát thể thức`;
- `Khung bố cục`;
- `Trường dữ liệu`;
- `Căn cứ pháp lý / Tài liệu nguồn`;
- `Yêu cầu nghiệp vụ`;
- `Địa chỉ API`;
- `Nhà cung cấp mô hình AI`.

Do not alter behavior in this task.

- [ ] **Step 5: Run and commit**

Run:

~~~powershell
npm --prefix frontend test -- --run test/copy-capability.test.ts test/landing-page.test.tsx test/dashboard-page.test.tsx test/documents-page.test.tsx test/templates-page.test.tsx test/qa-page.test.tsx test/settings-page.test.tsx
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
git diff --check
~~~

Expected: copy and affected UI tests/build pass.

Commit:

~~~powershell
git add -- docs/copy-capability-matrix.md frontend/test/copy-capability.test.ts frontend/app/page.tsx 'frontend/app/(app)/dashboard/page.tsx' frontend/components/layout/Sidebar.tsx 'frontend/app/(app)/generate/page.tsx' 'frontend/app/(app)/documents/page.tsx' 'frontend/app/(app)/templates/page.tsx' 'frontend/app/(app)/qa/page.tsx' frontend/components/settings/LLMSettingsForm.tsx frontend/components/settings/LLMProviderForm.tsx
git commit -m "docs: gate Vietnamese product claims on capabilities"
~~~

---

### Task 3: Build Production Smoke, Benchmark, and Concurrency Evidence

**Files:**

- Create: `ops/gcp/benchmark-production.ps1`
- Modify: `ops/gcp/smoke-production.ps1`
- Create: `ops/tests/ProductionAcceptance.Tests.ps1`
- Modify: `ops/tests/GcpRunbooks.Tests.ps1`

**Interfaces:**

- Consumes exact project/region/service URLs, smoke user credentials from secret environment, deterministic PDF/DOCX fixtures, and an evidence directory.
- Produces:
  - `private-smoke.json`
  - `latency-samples.json`
  - `concurrency.json`
  - `restart-recovery.json`
  - `redis-degraded.json`
  - `call-counts.json`
- Scripts default to read-only/preview and require `-ExecuteAcceptanceLoad` for task creation.

- [ ] **Step 1: Write failing script-contract tests**

~~~powershell
Describe 'Production acceptance scripts' {
  It 'requires exact project, us-central1, release, and evidence scope' {
    $raw = Get-Content $BenchmarkScript -Raw
    $raw | Should -Match '\[Parameter\(Mandatory\)\]\[string\]\$ProjectId'
    $raw | Should -Match '\[ValidateSet\(''us-central1''\)\]'
    $raw | Should -Match '\[ValidatePattern\(''\^\[a-f0-9\]\{40\}\$''\)\]'
  }

  It 'does not create load in preview' {
    Mock Invoke-RestMethod {}
    & $BenchmarkScript @SafeArgs
    Should -Invoke Invoke-RestMethod -ParameterFilter { $Method -eq 'Post' } -Times 0
  }
}
~~~

Assert output redaction, deterministic fixture paths, exact sample counts, separate provider latency, and no document/prompt text in evidence.

- [ ] **Step 2: Run and verify failure**

Run:

~~~powershell
Invoke-Pester ops/tests/ProductionAcceptance.Tests.ps1 -Output Detailed
~~~

Expected: FAIL because benchmark tooling is absent.

- [ ] **Step 3: Extend authenticated smoke coverage**

Smoke covers both providers and catalogs, explicit activation, config-in-use mutation block, complete-field skip, bounded generation, one-call Q&A, abstention, searchable/mixed/table/scanned PDFs, template compilation, progress reconnect, cancellation race, duplicate task delivery, render-only retry, document open/download, and owned cleanup.

Record IDs/hashes/counts only. Never record question, answer, fields, document content, provider response, or credentials.

- [ ] **Step 4: Implement cold/warm latency sampling**

Capture one cold and three warm samples for:

- service readiness/startup;
- embeddings response;
- Q&A first progress, retrieval, first answer token, provider call, total;
- job acceptance, queue delay, first worker checkpoint, draft, render, total;
- searchable PDF, mixed PDF, complex-table PDF, scanned PDF;
- template compilation.

Hard gates:

- first Q&A progress at most 1 second;
- retrieval at most 15 seconds;
- answer provider at most 240 seconds;
- Q&A total at most 300 seconds;
- job submission at most 5 seconds;
- generation/processing internal execution at most 1,500 seconds;
- renderer at most 180 seconds;
- embeddings at most 180 seconds;
- Docling request at most 900 seconds.

Provider latency is a separate field and does not count as an infrastructure regression explanation.

- [ ] **Step 5: Implement concurrency, restart, and Redis-degraded exercises**

Concurrency submits five generation deliveries with at least three for one owner, waits for worker claims, and queries Neon evidence proving global running/delivery at most five and owner running at most two. It verifies deferred deliveries do not change `workAttempt`.

Restart exercise starts a controlled acceptance job, deploys the same immutable worker image as a new revision while the lease is active, and verifies reclaim/resume without a second draft or duplicate document.

Redis exercise uses a private candidate revision with an unreachable Redis endpoint, verifies readiness is degraded HTTP 200, and completes one admitted job from Neon. It then restores the exact accepted revision and verifies it.

- [ ] **Step 6: Run tests and commit**

Run:

~~~powershell
Invoke-Pester -Path @('ops/tests/ProductionAcceptance.Tests.ps1','ops/tests/GcpRunbooks.Tests.ps1') -Output Detailed
git diff --check
~~~

Expected: Pester tests pass; production calls are still previewed.

Commit:

~~~powershell
git add -- ops/gcp/benchmark-production.ps1 ops/gcp/smoke-production.ps1 ops/tests/ProductionAcceptance.Tests.ps1 ops/tests/GcpRunbooks.Tests.ps1
git commit -m "test: add production durability and latency evidence"
~~~

---

### Task 4: Implement Evidence-Gated Rollback and Reopening

**Files:**

- Create: `ops/gcp/reopen-production.ps1`
- Modify: `ops/gcp/rollback.ps1`
- Create: `ops/tests/Reopening.Tests.ps1`
- Modify: `docs/operations/gcp-production-runbook.md`
- Modify: `docs/operations/gcp-rollback.md`
- Modify: `ops/verify-all.ps1`

**Interfaces:**

- Consumes:
  - exact release manifest and SHA-256;
  - explicit `-ApprovalId` matching a user-recorded approval artifact;
  - Cloudflare account/Worker identity from environment;
  - target project/region/revision identities.
- Produces:
  - `rollback-rehearsal.json`
  - `reopening-approval.json`
  - `public-smoke.json`
  - `maintenance-reentry.json`.

- [ ] **Step 1: Write failing rollback/reopen safety tests**

~~~powershell
Describe 'Reopening gate' {
  It 'refuses a blocked or hash-mismatched manifest' {
    { & $ReopenScript -ProjectId $Project -Region us-central1 `
        -ReleaseManifestPath $BlockedManifest -ReleaseManifestSha256 ('0' * 64) `
        -ApprovalId 'approval-1' -Execute } |
      Should -Throw
  }

  It 'does not deploy the Worker without -Execute' {
    Mock Invoke-NativeChecked {}
    & $ReopenScript @SafeArgs
    Should -Invoke Invoke-NativeChecked -ParameterFilter {
      $FilePath -match 'wrangler' -and $Arguments -contains 'deploy'
    } -Times 0
  }
}
~~~

Assert rollback requires schema-compatible previous digests, maintenance re-entry remains available, and no script restores Neon writes to Cloud SQL.

- [ ] **Step 2: Run and verify failure**

Run:

~~~powershell
Invoke-Pester ops/tests/Reopening.Tests.ps1 -Output Detailed
~~~

Expected: FAIL because reopening script/gates are absent.

- [ ] **Step 3: Harden application rollback**

`rollback.ps1` previews exact current/previous frontend/API/generation/processing revisions and their image digests. With `-Execute`, it:

1. enables Cloudflare maintenance;
2. verifies direct-origin denial;
3. shifts to explicitly supplied schema-compatible target revisions;
4. runs authenticated private smoke;
5. records results; and
6. leaves maintenance on until separate approval.

If compatibility evidence is absent, only maintenance re-entry is allowed.

- [ ] **Step 4: Implement reopening**

`reopen-production.ps1`:

1. validates exact project `project-96fe5a5e-a0df-4a2f-902`, region `us-central1`, manifest hash, and approval artifact;
2. requires E01–E23 passed and E24 pending only for public smoke;
3. displays target Worker/service/revisions;
4. deploys the Worker with `MAINTENANCE_MODE=off` only under `-Execute`;
5. immediately tests public live/login/status/settings plus authenticated generation/Q&A/download;
6. refreshes capacity;
7. on any failure redeploys maintenance-on and writes failure evidence;
8. on success records E24 and rebuilds the final manifest.

- [ ] **Step 5: Extend the complete verifier and runbooks**

`ops/verify-all.ps1` runs backend/frontend/Python/.NET/Worker tests, builds, Compose contracts, Terraform fmt/validate/static Pester, all operations Pester, optional cutover rehearsal, optional renderer container, and `git diff --check`.

Runbooks include exact environment-variable names, preview commands, approval stops, rollback decision tree, recovery asset locations, and redaction rules.

- [ ] **Step 6: Run and commit**

Run:

~~~powershell
Invoke-Pester -Path @('ops/tests/Reopening.Tests.ps1','ops/tests/GcpRunbooks.Tests.ps1') -Output Detailed
pwsh -NoProfile -File ops/verify-all.ps1
git diff --check
~~~

Expected: all verification passes; no external mutation occurs.

Commit:

~~~powershell
git add -- ops/gcp/reopen-production.ps1 ops/gcp/rollback.ps1 ops/tests/Reopening.Tests.ps1 docs/operations/gcp-production-runbook.md docs/operations/gcp-rollback.md ops/verify-all.ps1
git commit -m "ops: gate rollback and public reopening on evidence"
~~~

---

### Task 5: Execute Maintenance, Recovery, Private Deployment, and Destructive Transition

**Files:**

- Runtime evidence only: `.artifacts/releases/$ReleaseSha/`
- No source edits in this task.

**Interfaces:**

- Consumes: accepted Plan 01 GO, reviewed Terraform plan/hash, immutable image digests, five secret payload variables, exact source/target identities.
- Produces: E01–E23 evidence with status passed; E24 remains pending.

- [ ] **Step 1: Re-resolve exact variables**

Run outside a captured/shared terminal:

~~~powershell
$ProjectId = 'project-96fe5a5e-a0df-4a2f-902'
$BillingAccountId = $env:DOC_AI_BILLING_ACCOUNT_ID
$SourceRegion = 'asia-southeast1'
$TargetRegion = 'us-central1'
$ReleaseSha = (git rev-parse HEAD).Trim()
$EvidenceRoot = ".artifacts/releases/$ReleaseSha"
if ($ReleaseSha -notmatch '^[a-f0-9]{40}$') { throw 'Release SHA must be full length' }
if ([string]::IsNullOrWhiteSpace($BillingAccountId)) { throw 'DOC_AI_BILLING_ACCOUNT_ID is required' }
~~~

Load secrets into the five documented runtime-bundle environment variables without echoing them. Also load operator-only `DOC_AI_NEON_DIRECT_URL`, `DOC_AI_CAPACITY_DATABASE_URL`, `DOC_AI_EXPECTED_CAPACITY_IDENTITIES_JSON`, the Neon/Upstash/Cloudflare credentials and exact resource IDs defined by Plan 01, and a fresh `DOC_AI_NEON_CU_USAGE_EXPORT_PATH`; the capacity URL may equal the direct URL during cutover and uses a pooled TLS URL for later refreshes. Verify required variables by presence/length only and clear all database URLs, provider credentials, and export paths immediately after each approved command.

- [ ] **Step 2: Re-run local and preflight gates**

~~~powershell
pwsh -NoProfile -File ops/verify-all.ps1 -IncludeCutoverRehearsal -IncludeRendererContainer
npm --prefix cloudflare-worker test
pwsh -NoProfile -File ops/gcp/invoke-preflight.ps1 `
  -ProjectId $ProjectId -BillingAccountId $BillingAccountId `
  -SourceRegion $SourceRegion -TargetRegion $TargetRegion `
  -ReleaseSha $ReleaseSha -AgeRecipient $env:DOC_AI_AGE_RECIPIENT `
  -PricingApprovalSha256 $env:DOC_AI_PRICING_APPROVAL_SHA256 `
  -ExecuteRehearsal `
  -EvidenceDirectory "$EvidenceRoot/00-preflight"
~~~

Expected: all local verification passes and preflight remains `GO`. Otherwise stop.

- [ ] **Step 3: Enable and externally verify maintenance**

Deploy the reviewed Worker with maintenance on, then verify from a network path outside GCP:

~~~powershell
pwsh -NoProfile -File ops/gcp/invoke-cutover.ps1 `
  -ProjectId $ProjectId -SourceRegion $SourceRegion -TargetRegion $TargetRegion `
  -ReleaseSha $ReleaseSha -EvidenceDirectory $EvidenceRoot `
  -Phase Maintenance -ExecuteMaintenance
~~~

Expected: public domain returns 503 maintenance; direct origin returns 404 for application/API routes; `/internal/live` contains only process liveness; client-supplied origin header cannot bypass.

- [ ] **Step 4: Quiesce and create recovery sets**

Stop new heavy admission, drain all nonterminal jobs, and record zero active writers. Create the data-only dump, Cloud SQL export, encrypted offline dump, all-version object inventory, and historical encrypted archive. Rehearse decrypt/restore into the disposable Neon branch and verify E07/E21.

Expected: every recovery hash matches and restore status is passed. Otherwise keep maintenance and stop.

- [ ] **Step 5: Copy and verify target objects**

Run `copy-storage-region.ps1 -ExecuteCopy` and `verify-storage-copy.ps1`; accept only equal live names/counts/bytes/checksums and successful owner/read/render/download smoke.

Expected: E08 passed. Do not delete source buckets.

- [ ] **Step 6: Apply the reviewed private target**

First build a provisional manifest so the accepted preflight artifact has a release-scoped checksum entry:

~~~powershell
pwsh -NoProfile -File ops/gcp/build-release-manifest.ps1 `
  -ReleaseSha $ReleaseSha `
  -SpecPath 'docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-design.md' `
  -EvidenceRoot $EvidenceRoot `
  -OutputPath "$EvidenceRoot/release-manifest.json"
~~~

Expected: manifest status `building`, and the exact `00-preflight/preflight-decision.json` path/hash is indexed.

Verify the Terraform plan binary SHA matches reviewed evidence, inject the five target bundle versions, apply only that plan, run migration/import through the direct endpoint, deploy immutable images, and pass light target readiness with maintenance on. Disable the direct and obsolete legacy secret versions, then use `refresh-capacity-snapshots.ps1 -Execute` with the exact recurring-cost disposition, if any, to collect/index/import fresh `runtime_actual` `CapacityEvidenceV2` before private heavy-work smoke. Use the Plan 05 cutover command with `-ReleaseManifestPath "$EvidenceRoot/release-manifest.json"`; it preserves the `preflight_projection` artifact for audit but gates work on the post-deploy `runtime_actual` refresh index.

Expected: exact service/job limits, private IAM, task queues, bundle versions, region, bucket mounts, image digests, no Cloud SQL attachment, exactly five active target bundle versions, and fresh release-bound `CapacitySnapshot` rows match E02/E04/E05. Direct/obsolete versions are disabled but recoverable; clear database/credential environment variables.

- [ ] **Step 7: Run full private acceptance and rollback rehearsal**

Run smoke/benchmark with `-ExecuteAcceptanceLoad`, concurrency, restart, Redis-degraded candidate, application rollback, and maintenance re-entry. Rebuild the manifest.

Expected: E01–E23 passed; manifest status `blocked_for_reopening_approval`; E24 only pending. Verify the accepted credential-recovery archive checksum and rehearsal record again, then destroy only the already-disabled direct/obsolete secret versions named in that evidence and retain the encrypted archive under the documented recovery retention policy.

- [ ] **Step 8: Perform the pre-reopen destructive transition**

Present exact deletion preview and recovery assets. Obtain explicit destructive approval. Then run:

~~~powershell
pwsh -NoProfile -File ops/gcp/retire-legacy-resources.ps1 `
  -ProjectId $ProjectId -SourceRegion $SourceRegion -TargetRegion $TargetRegion `
  -ReleaseSha $ReleaseSha -EvidenceDirectory $EvidenceRoot `
  -Scope PreReopen -ConfirmDestruction
~~~

Expected: old Cloud Run compute and exact Cloud SQL instance are removed; source buckets, encrypted recovery, and target resources remain. Report what was removed and recoverability.

- [ ] **Step 9: Stop for explicit reopening approval**

Present:

- release SHA/spec SHA;
- E01–E23 summaries and hashes;
- all failed/blocked checks (must be none);
- current progressive capacity ratios below 70% and every hard-limit metric at or below its ceiling;
- image/storage/secret totals;
- latency/call counts;
- rollback rehearsal;
- exact remaining recovery assets;
- exact target URLs/revisions.

Do not proceed without a user statement approving this exact manifest SHA.

---

### Task 6: Reopen, Observe for 14 Days, and Remove Legacy Data

**Files:**

- Create: `backend/prisma/migrations/20260828000000_drop_legacy_ingestion_jobs/migration.sql` (at observation close only)
- Modify: `backend/prisma/schema.prisma` (at observation close only)
- Delete: `backend/src/services/ingestion_job_repository.ts` (at observation close only)
- Delete: `backend/src/services/ingestion_job_repository.test.ts` (at observation close only)
- Modify: `backend/scripts/check_migration_integrity.test.ts` (at observation close only)
- Runtime evidence: `.artifacts/releases/$ReleaseSha/06-reopen` and `07-observation`

**Interfaces:**

- Consumes: explicit approval artifact and its accepted pre-open manifest hash.
- Produces: final accepted E24, 14-day observation report, post-observation retirement record, and later additive cleanup migration.

- [ ] **Step 1: Reopen with the approved manifest**

~~~powershell
pwsh -NoProfile -File ops/gcp/reopen-production.ps1 `
  -ProjectId $ProjectId -Region $TargetRegion -ReleaseSha $ReleaseSha `
  -ReleaseManifestPath "$EvidenceRoot/release-manifest.json" `
  -ReleaseManifestSha256 $env:DOC_AI_APPROVED_MANIFEST_SHA256 `
  -ApprovalId $env:DOC_AI_REOPENING_APPROVAL_ID `
  -EvidenceDirectory "$EvidenceRoot/06-reopen" -Execute
~~~

Expected: public smoke/capacity pass, E24 passed, final manifest status accepted. Any failure restores maintenance.

- [ ] **Step 2: Monitor the exact 14-day observation window**

Run `refresh-capacity-snapshots.ps1 -Execute` at least every four hours using a securely loaded pooled `DOC_AI_CAPACITY_DATABASE_URL`; clear it immediately afterward. The command must produce a fresh checksummed capacity index and import record, and the earliest expiry alert must remain more than 60 minutes away. For 14 consecutive 24-hour periods, aggregate and record:

- capacity ratios and freshness;
- queue depth/oldest age/retries;
- worker/API/frontend 5xx;
- failed/stuck jobs and lease recovery;
- provider-separated latency;
- OCR routing distribution;
- Neon storage/CU/transfer;
- GCS/Artifact Registry/Secret Manager/Cloud Run/Tasks/Logging usage;
- rollback compatibility.

A day with missing evidence, a hard/95% capacity block, unrecovered job, integrity mismatch, or security incident resets the clean-window count to zero.

- [ ] **Step 3: Preview post-observation retirement**

Run `retire-legacy-resources.ps1 -Scope PostObservation` without confirmation. Verify only exact source buckets, old region registry manifests, unused secret versions/containers, and other named legacy artifacts appear. Target `-uc1-` buckets and current/rollback images must not appear.

- [ ] **Step 4: Obtain a second explicit destructive approval and retire sources**

After approval, run with `-ConfirmDestruction`. Preserve accepted database/object encrypted recovery through its documented retention date. Report deleted targets and recoverability.

- [ ] **Step 5: Only now write the old-table cleanup test and migration**

Add:

~~~typescript
test('legacy ingestion cleanup occurs only in the post-observation migration', () => {
  const sql = migrationSql('20260828000000_drop_legacy_ingestion_jobs');
  expect(sql).toContain('DROP TABLE "IngestionJob"');
  expect(sql).toContain('DO $$');
  expect(sql).toContain("RAISE EXCEPTION 'Legacy ingestion rows were not fully migrated'");
});
~~~

The migration verifies equal legacy/`legacyImported` processing counts and no nonterminal legacy row before dropping the table. Remove the old Prisma relation/repository only in this separate post-observation release.

- [ ] **Step 6: Run cleanup-release verification**

Run:

~~~powershell
npm --prefix backend test -- --runInBand scripts/check_migration_integrity.test.ts src/services/processing_job_repository.test.ts
npm --prefix backend run prisma:generate
npm --prefix backend run build
pwsh -NoProfile -File ops/verify-all.ps1
git diff --check
~~~

Expected: all tests/builds pass and no runtime code references `IngestionJob`.

- [ ] **Step 7: Commit the later cleanup release**

~~~powershell
git add -- backend/prisma/migrations/20260828000000_drop_legacy_ingestion_jobs/migration.sql backend/prisma/schema.prisma backend/scripts/check_migration_integrity.test.ts backend/src/services/ingestion_job_repository.ts backend/src/services/ingestion_job_repository.test.ts
git commit -m "chore: remove observed legacy ingestion queue"
~~~

## Final Completion Gate

The migration is complete only after:

- final manifest status is `accepted`;
- E01–E24 and S01–S17 all pass;
- public smoke and capacity refresh pass;
- 14 clean observation days are recorded;
- post-observation deletions are explicitly approved and reported;
- cleanup release verification passes; and
- retained encrypted recovery assets have an owner and destruction date.
