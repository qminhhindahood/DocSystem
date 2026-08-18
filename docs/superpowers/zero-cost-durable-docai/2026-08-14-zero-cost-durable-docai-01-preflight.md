# Zero-Cost Durable DocAI Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a fail-closed preflight that proves the selected topology, container footprint, recovery path, regional data-copy scope, and either the conditional USD 0 envelope or an explicitly capped Artifact Registry exception are feasible before migration implementation proceeds.

**Architecture:** PowerShell scripts collect authoritative, data-free observations into a checksummed evidence directory. A single orchestrator evaluates the design's hard ceilings, Neon-region rule, local-Jina cold/warm gate, encrypted database restore rehearsal, GCS inventory, and one-time migration estimate and emits a schema-valid `GO` or `NO_GO` decision.

**Tech Stack:** PowerShell 7, Pester 5, PostgreSQL 15 tools, Docker, gcloud CLI, Neon PostgreSQL, age encryption, JSON Schema.

**Spec:** `docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-design.md`

## Global Constraints

- Read-only discovery is allowed; production mutation is not part of this plan.
- Source identities are `project-96fe5a5e-a0df-4a2f-902` and `asia-southeast1`; the target GCP region is `us-central1`.
- Secret database URLs come only from `DOC_AI_SOURCE_DATABASE_URL`, `DOC_AI_NEON_DIRECT_URL`, `DOC_AI_NEON_CANDIDATE_URLS_JSON`, and `DOC_AI_CAPACITY_DATABASE_URL`; they are never command parameters or evidence values.
- The exact billing account ID comes from `DOC_AI_BILLING_ACCOUNT_ID`; evidence stores only its SHA-256 identity hash. The reviewed pricing hash comes from `DOC_AI_PRICING_APPROVAL_SHA256`.
- External usage collection reads credentials only from `DOC_AI_NEON_API_KEY`, `DOC_AI_UPSTASH_EMAIL`, `DOC_AI_UPSTASH_API_KEY`, and `DOC_AI_CLOUDFLARE_API_TOKEN`; IDs come from `DOC_AI_NEON_PROJECT_ID`, `DOC_AI_UPSTASH_DATABASE_ID`, `DOC_AI_CLOUDFLARE_ACCOUNT_TAG`, and `DOC_AI_CLOUDFLARE_SCRIPT_NAME`. This release enables Upstash even though the application treats Redis as disposable. Free-plan Neon CU-hours come from the schema-validated file at `DOC_AI_NEON_CU_USAGE_EXPORT_PATH` because the paid Consumption API is not assumed available.
- The age public recipient comes from `DOC_AI_AGE_RECIPIENT`; the private identity path comes only from `DOC_AI_AGE_IDENTITY_FILE`.
- All evidence paths must resolve inside the repository's ignored `.artifacts/releases/` directory.
- Mandatory observations fail closed when missing, stale, unparsable, or tied to the wrong billing/provider account hash.
- Internal hard ceilings are copied verbatim from design section 19.2; this plan never silently substitutes public allowance values.
- The container gate conservatively sums every retained current-and-rollback manifest without shared-layer deduplication. At or below 400 MiB it is zero-cost feasible; above 400 MiB it blocks unless current official pricing produces a known rounded-up estimate within an explicit operator-approved monthly cap.
- The local Jina service must pass one cold and three warm samples with its immutable revision and checksum; failure is `NO_GO`.
- A nonzero one-time migration estimate requires a recorded numeric approval and operator acknowledgment.
- A nonzero recurring Artifact Registry estimate requires a separate monthly cap approval; the decision must record `zeroCostFeasible: false`. No other hard-limit exception is permitted.
- The database rehearsal uses a custom-format data-only dump excluding `_prisma_migrations`, applies migrations before import, and refuses a nonempty target.
- Evidence contains no credentials, provider responses, prompt/document text, extracted chunks, or raw connection strings.
- Every mutation-capable script defaults to preview and requires a separate explicit confirmation switch.

---

## File Map

- Create `ops/lib/Evidence.psm1`: safe evidence paths, canonical JSON writing, hashing, secret scanning.
- Create `ops/lib/PreflightPolicy.psm1`: pure capacity, region-selection, storage-normalization, and decision functions shared by scripts and Pester.
- Create `ops/lib/BoundedProcess.psm1`: secret-safe native execution with explicit timeouts, process-tree termination, and Windows PowerShell-wrapper support.
- Create `ops/config/zero-cost-ceilings.json`: versioned internal thresholds and official source URLs.
- Create `ops/schemas/capacity-evidence.schema.json`: normalized import/refresh contract.
- Create `ops/schemas/preflight-decision.schema.json`: machine-enforced decision contract.
- Create `ops/gcp/audit-migration-capacity.ps1`: authoritative usage and projected-footprint collector.
- Create `ops/gcp/benchmark-feasibility.ps1`: Neon region, image, and embeddings measurements.
- Create `ops/gcp/inventory-storage.ps1`: all-version GCS manifest and copy-volume estimate.
- Create `ops/gcp/restore-to-neon.ps1`: empty-target migration and data-only restore.
- Create `ops/gcp/verify-neon-restore.ps1`: ownership, row, vector, provider-key, and smoke verification.
- Create `ops/gcp/invoke-preflight.ps1`: aggregate evidence and emit `GO`/`NO_GO`.
- Modify `ops/backup-postgres.ps1`: data-only dump plus age-encrypted duplicate.
- Modify `ops/import-postgres-data.ps1`: direct-TLS target and sequence-safe verification.
- Modify `ops/gcp/export-and-shutdown.ps1`: require accepted recovery evidence before its destructive switch.
- Create `ops/tests/Evidence.Tests.ps1`.
- Create `ops/tests/MigrationCapacity.Tests.ps1`.
- Create `ops/tests/Feasibility.Tests.ps1`.
- Create `ops/tests/NeonMigration.Tests.ps1`.
- Create `ops/tests/StorageInventory.Tests.ps1`.
- Modify `ops/verify-all.ps1`: include the new Pester suites without running production discovery.
- Modify `docs/operations/gcp-production-runbook.md`: document preflight variables, outputs, and stop conditions.

---

### Task 1: Create Safe Evidence Primitives and the Decision Schema

**Files:**

- Create: `ops/lib/Evidence.psm1`
- Create: `ops/config/zero-cost-ceilings.json`
- Create: `ops/schemas/capacity-evidence.schema.json`
- Create: `ops/schemas/preflight-decision.schema.json`
- Create: `ops/tests/Evidence.Tests.ps1`

**Interfaces:**

- Consumes: repository root and a requested evidence path.
- Produces:
  - `Resolve-EvidencePath([string] $Path, [string] $RepositoryRoot) -> [string]`
  - `Get-EvidenceSha256([string] $LiteralPath) -> [string]`
  - `Write-EvidenceJson([string] $LiteralPath, [hashtable] $Value) -> [void]`
  - `Assert-EvidenceContainsNoSecrets([string] $Directory) -> [void]`
  - `Test-EvidenceFresh([datetime] $ObservedAt, [datetime] $ValidUntil, [datetime] $Now) -> [bool]`
  - JSON Schemas `CapacityEvidenceV2` and `PreflightDecisionV2`.

- [ ] **Step 1: Write the failing evidence tests**

Create `ops/tests/Evidence.Tests.ps1` with these exact behaviors:

~~~powershell
BeforeAll {
  $Root = Split-Path $PSScriptRoot -Parent | Split-Path -Parent
  Import-Module (Join-Path $Root 'ops/lib/Evidence.psm1') -Force
}

Describe 'Evidence primitives' {
  It 'accepts only a descendant of .artifacts/releases' {
    $safe = Resolve-EvidencePath '.artifacts/releases/abc/00-preflight' $Root
    $safe | Should -Be (Join-Path $Root '.artifacts/releases/abc/00-preflight')
    { Resolve-EvidencePath '../outside' $Root } | Should -Throw '*outside .artifacts/releases*'
  }

  It 'writes deterministic UTF-8 JSON and a matching checksum' {
    $dir = Join-Path $Root '.artifacts/releases/test-evidence'
    $path = Join-Path $dir 'sample.json'
    Write-EvidenceJson $path ([ordered]@{ schemaVersion = 1; status = 'passed' })
    (Get-Content $path -Raw | ConvertFrom-Json).status | Should -Be 'passed'
    (Get-EvidenceSha256 $path) | Should -Match '^[a-f0-9]{64}$'
  }

  It 'rejects credential-shaped evidence' {
    $dir = Join-Path $Root '.artifacts/releases/test-secret-scan'
    New-Item -ItemType Directory -Force $dir | Out-Null
    Set-Content (Join-Path $dir 'bad.txt') 'postgresql://alice:secret@db.example/app'
    { Assert-EvidenceContainsNoSecrets $dir } | Should -Throw '*secret-shaped*'
  }
}
~~~

Also test that an existing symlink/junction/reparse-point component under `.artifacts/releases` is rejected before any write; skip only when the test platform cannot create a disposable link.

- [ ] **Step 2: Run the test and verify the intended failure**

Run:

~~~powershell
Invoke-Pester ops/tests/Evidence.Tests.ps1 -Output Detailed
~~~

Expected: FAIL because `ops/lib/Evidence.psm1` does not exist.

- [ ] **Step 3: Implement the evidence module**

Use resolved absolute paths and reject paths outside the exact evidence root:

~~~powershell
function Resolve-EvidencePath {
  param([string]$Path, [string]$RepositoryRoot)
  $allowed = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot '.artifacts/releases'))
  $allowed = $allowed.TrimEnd([IO.Path]::DirectorySeparatorChar) +
    [IO.Path]::DirectorySeparatorChar
  $resolved = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot $Path))
  if (-not ($resolved + [IO.Path]::DirectorySeparatorChar).StartsWith(
    $allowed, [StringComparison]::OrdinalIgnoreCase
  )) { throw 'Evidence path is outside .artifacts/releases' }
  $cursor = $resolved
  while ($cursor -and $cursor.StartsWith($allowed.TrimEnd([IO.Path]::DirectorySeparatorChar),
      [StringComparison]::OrdinalIgnoreCase)) {
    if ((Test-Path -LiteralPath $cursor) -and
        ((Get-Item -LiteralPath $cursor -Force).Attributes -band
          [IO.FileAttributes]::ReparsePoint)) {
      throw 'Evidence path contains a reparse point'
    }
    $cursor = Split-Path $cursor -Parent
  }
  return $resolved
}

function Get-EvidenceSha256 {
  param([string]$LiteralPath)
  return (Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Write-EvidenceJson {
  param([string]$LiteralPath, [hashtable]$Value)
  New-Item -ItemType Directory -Force (Split-Path $LiteralPath -Parent) | Out-Null
  $Value | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $LiteralPath -Encoding utf8NoBOM
}

function Assert-EvidenceContainsNoSecrets {
  param([string]$Directory)
  $patterns = @(
    'postgres(?:ql)?://', 'Bearer\s+\S+', 'sk-[A-Za-z0-9_-]+',
    'AIza[0-9A-Za-z_-]{20,}', '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'
  )
  $textExtensions = '.json','.jsonl','.txt','.log','.md','.csv','.xml','.yml','.yaml'
  foreach ($file in Get-ChildItem -LiteralPath $Directory -File -Recurse |
      Where-Object Extension -In $textExtensions) {
    $text = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($text -and $patterns.Where({ $text -match $_ }, 'First').Count) {
      throw "Evidence contains secret-shaped material: $($file.FullName)"
    }
  }
}

function Test-EvidenceFresh {
  param([datetime]$ObservedAt, [datetime]$ValidUntil, [datetime]$Now)
  return $ObservedAt.Kind -eq 'Utc' -and $ValidUntil.Kind -eq 'Utc' -and
    $ObservedAt -le $Now -and $Now -lt $ValidUntil
}

Export-ModuleMember -Function Resolve-EvidencePath, Get-EvidenceSha256,
  Write-EvidenceJson, Assert-EvidenceContainsNoSecrets, Test-EvidenceFresh
~~~

Encrypted `.age`, database dump, archive, plan binary, and container artifacts are never decoded as text by the scanner; their producing tasks must verify format/magic, encryption or plan type, size, and checksum separately. Pester includes a large binary fixture proving the scanner does not load it into memory and a textual sidecar fixture proving secret-shaped output is still rejected.

- [ ] **Step 4: Add the exact ceilings and decision schema**

`ops/config/zero-cost-ceilings.json` must contain the 20 resource ceilings from design section 19.2, including `artifactRegistryBytes = 419430400`, `cloudRunCpuSecondsPerMonth = 126000`, `gcsBytes = 3758096384`, `neonBytes = 367001600`, `upstashBytes = 134217728`, `cloudflareRequestsPerDay = 70000`, and `cloudflareWorkerCpuP95Ms = 7`.

The schema requires:

~~~json
{
  "schemaVersion": 1,
  "releaseSha": "^[a-f0-9]{40}$",
  "decision": "GO or NO_GO",
  "selectedNeonRegion": "nonempty string",
  "embeddingFeasible": true,
  "migrationCostUsd": 0,
  "nonZeroCostApproved": false,
  "capacityEvidence": { "path": "safe relative path", "sha256": "64 lowercase hex" },
  "checks": "nonempty array",
  "evidence": "nonempty array of path and sha256"
}
~~~

`CapacityEvidenceV2` requires `schemaVersion: 2`, 40-hex `releaseSha`, `mode: "preflight_projection" | "runtime_actual"`, `status: "passed" | "blocked"`, boolean `zeroCostFeasible`, UTC `createdAt`, earliest UTC `validUntil`, and a nonempty `records` array. Each record requires `metric`, `policy: "progressive" | "hard_limit"`, nullable `measuredValue`, `unit`, finite positive `internalCeiling`, nullable finite-positive `officialAllowance`, nullable `ratio`, `zeroCostStatus`, nullable `approvedException`, `accountIdentityHash`, `source`, UTC `observedAt`, UTC `validUntil`, `releaseId`, nullable `safeCollectionError`, and `status`, with no additional properties. A normal passed record requires a finite nonnegative value, ratio from 0 through 1, null error, `zeroCostStatus: "passed"`, and null exception. The only over-ceiling passed form is `artifactRegistryBytes` with ratio above one, `zeroCostStatus: "blocked"`, and an `artifact_registry_recurring_cost_cap` exception containing a 64-hex official-pricing snapshot hash, positive rounded-up monthly estimate, and cap at or above the estimate. A null measurement requires blocked status and a nonempty safe error. Collector and importer tests recompute `measuredValue / internalCeiling` and reject a ratio difference above `1e-9`. `PreflightDecisionV2.capacityEvidence` stores the safe relative path and SHA-256 of that artifact and separately requires recurring estimate, approval state, approval cap, and `zeroCostFeasible`. Use JSON Schema `additionalProperties: false` at every object level and constrain every hash and decision enum exactly.

- [ ] **Step 5: Run and commit**

Run:

~~~powershell
Invoke-Pester ops/tests/Evidence.Tests.ps1 -Output Detailed
Test-Json -Json (Get-Content ops/config/zero-cost-ceilings.json -Raw) -ErrorAction Stop
git diff --check
~~~

Expected: all Pester tests pass and JSON parsing succeeds.

Commit:

~~~powershell
git add -- ops/lib/Evidence.psm1 ops/config/zero-cost-ceilings.json ops/schemas/capacity-evidence.schema.json ops/schemas/preflight-decision.schema.json ops/tests/Evidence.Tests.ps1
git commit -m "test: add fail-closed migration evidence contracts"
~~~

---

### Task 2: Audit Capacity, Pricing, Image Footprint, and Runtime Feasibility

**Files:**

- Create: `ops/lib/PreflightPolicy.psm1`
- Create: `ops/lib/BoundedProcess.psm1`
- Create: `ops/gcp/audit-migration-capacity.ps1`
- Create: `ops/gcp/benchmark-feasibility.ps1`
- Create: `ops/tests/MigrationCapacity.Tests.ps1`
- Create: `ops/tests/Feasibility.Tests.ps1`

**Interfaces:**

- Consumes:
  - `DOC_AI_SOURCE_DATABASE_URL`
  - `DOC_AI_NEON_CANDIDATE_URLS_JSON`, a secret JSON object mapping region ID to direct TLS URL
  - Docker daemon
  - authenticated read-only gcloud session
  - the external provider credential/identity variables named in Global Constraints
  - a Neon console CU-usage export observed within six hours
  - `ops/config/zero-cost-ceilings.json`
- Produces:
  - `capacity-snapshot.json`
  - `image-footprint.json`
  - `neon-region-benchmark.json`
  - `embeddings-benchmark.json`
  - `pricing-revalidation.json`
- Script contracts:
  - `audit-migration-capacity.ps1 -ProjectId -BillingAccountId -ReleaseSha -EvidenceDirectory -PricingApprovalSha256 [-Mode Preflight|Runtime] [-ApproveRecurringCost -ApprovedRecurringCostCapUsd decimal]`
  - `benchmark-feasibility.ps1 -ReleaseSha -EvidenceDirectory`.
- Module exports added in this task:
  - `Test-CapacityMetric`
  - `Select-NeonRegion`.

- [ ] **Step 1: Write failing capacity and feasibility tests**

Create table-driven Pester cases:

~~~powershell
BeforeAll {
  $Root = Split-Path $PSScriptRoot -Parent | Split-Path -Parent
  Import-Module (Join-Path $Root 'ops/lib/PreflightPolicy.psm1') -Force
}

Describe 'Zero-cost capacity policy' {
  $cases = @(
    @{ metric = 'artifactRegistryBytes'; policy = 'hard_limit'; value = 419430401; ceiling = 419430400 },
    @{ metric = 'gcsBytes'; policy = 'progressive'; value = 3758096385; ceiling = 3758096384 },
    @{ metric = 'neonCuHours'; policy = 'progressive'; value = 70.01; ceiling = 70 },
    @{ metric = 'cloudTasksOperations'; policy = 'progressive'; value = 700001; ceiling = 700000 }
  )
  It 'marks <metric> over its internal ceiling as blocking' -ForEach $cases {
    $result = Test-CapacityMetric -Metric $metric -Policy $policy `
      -Value $value -Ceiling $ceiling
    $result.status | Should -Be 'blocked'
  }

  It 'blocks an absent authoritative observation' {
    (Test-CapacityMetric -Metric 'loggingBytes' -Policy progressive `
      -Value $null -Ceiling 37580963840).status |
      Should -Be 'blocked'
  }

  It 'allows the exact intended binary hard limit' {
    $result = Test-CapacityMetric -Metric 'secretManagerActiveVersions' `
      -Policy hard_limit -Value 5 -Ceiling 5
    $result.status | Should -Be 'passed'
    $result.ratio | Should -Be 1.0
  }
}

Describe 'Neon region selection' {
  It 'keeps Ohio unless both improvement constraints pass' {
    Select-NeonRegion @{
      'aws-us-east-2' = @{ medianMs = 100; p95Ms = 150; samples = 20 }
      'aws-us-east-1' = @{ medianMs = 86; p95Ms = 140; samples = 20 }
    } | Should -Be 'aws-us-east-2'

    Select-NeonRegion @{
      'aws-us-east-2' = @{ medianMs = 100; p95Ms = 150; samples = 20 }
      'aws-us-east-1' = @{ medianMs = 84; p95Ms = 160; samples = 20 }
    } | Should -Be 'aws-us-east-1'
  }
}
~~~

The second case selects Virginia because median improves 16% and p95 regresses only 6.7%; the first improves only 14%.

- [ ] **Step 2: Run the tests and verify they fail**

Run:

~~~powershell
Invoke-Pester -Path @('ops/tests/MigrationCapacity.Tests.ps1','ops/tests/Feasibility.Tests.ps1') -Output Detailed
~~~

Expected: FAIL because the scripts/functions are absent.

- [ ] **Step 3: Implement authoritative collection and fail-closed evaluation**

Implement `Test-CapacityMetric` with a required `-Policy` argument and `Select-NeonRegion` as pure exported module functions, and have both collectors call those functions. The capacity script must collect and normalize:

| Metric | Source | Maximum age |
|---|---|---:|
| database bytes | parameterized `psql` query | 24 hours |
| maximum/global chunk counts and maximum nonterminal jobs per user | parameterized `psql` queries | 6 hours |
| GCS bytes and Class A/B operation observations | `gcloud storage` inventory plus Cloud Monitoring | 24 hours for bytes, 6 hours for operations |
| Artifact Registry retained manifest bytes | `gcloud artifacts docker images list --include-tags --format=json` | 6 hours |
| Cloud Run CPU/RAM/request/egress | Cloud Monitoring API | 6 hours |
| Cloud Tasks operations | Cloud Monitoring API | 6 hours |
| Secret Manager active versions/accesses | Secret Manager API and Cloud Monitoring | 6 hours |
| Logging ingestion | Cloud Monitoring API | 6 hours |
| Neon storage/transfer | `GET https://console.neon.tech/api/v2/projects/{projectId}` plus `pg_database_size`; use the larger safe storage observation | 6 hours |
| Neon CU-hours | schema-validated free-plan console export at `DOC_AI_NEON_CU_USAGE_EXPORT_PATH`; do not assume paid Consumption API access | 6 hours |
| Upstash storage/commands/bandwidth | `GET https://api.upstash.com/v2/redis/stats/{databaseId}` with Basic auth | 6 hours |
| Cloudflare requests/CPU | Workers Analytics GraphQL filtered to the exact account tag and script name | 6 hours |

Each observation uses:

~~~powershell
[ordered]@{
  metric = $Metric
  policy = $Policy
  measuredValue = $Value
  unit = $Unit
  internalCeiling = $Ceiling
  officialAllowance = $OfficialAllowance
  ratio = if ($null -eq $Value) { $null } else { $Value / $Ceiling }
  source = $SafeSourceName
  accountIdentityHash = $AccountIdentityHash
  observedAt = $ObservedAt.ToUniversalTime().ToString('o')
  validUntil = $ValidUntil.ToUniversalTime().ToString('o')
  releaseId = $ReleaseSha
  safeCollectionError = $SafeCollectionError
  status = $Status
}
~~~

Write `capacity-snapshot.json` as `CapacityEvidenceV2`, validate it against `ops/schemas/capacity-evidence.schema.json`, and set its top-level `validUntil` to the earliest record expiry. In `Preflight` mode, generate target projections only after schema-valid `image-footprint.json` and `source-storage-summary.json` exist: use conservative two-release image bytes, projected target live GCS bytes, and exactly five target secret versions. Write current Artifact Registry and Secret Manager usage separately to `legacy-transition-capacity.json`; collection failure blocks transition review, and overages require explicit retirement steps. In `Runtime` mode, measure actual post-deployment capacity. Any absent, errored, stale, over-ceiling, or wrong-account mandatory record blocks except an Artifact Registry overage with a valid explicit cost-cap exception. Never store a raw billing, Neon, Upstash, or Cloudflare account identifier.

`zero-cost-ceilings.json` declares the policy, unit, internal ceiling, and preflight projection of exactly five target secret versions. Use `hard_limit` only for Artifact Registry retained bytes, Secret Manager active versions, maximum embedded chunks per user, global embedded chunks, and maximum nonterminal generation jobs per user; every other collected usage metric is `progressive`. A `hard_limit` record passes at ratio 1.0 and normally blocks above 1.0. Only Artifact Registry may convert a measured overage into a passed record through the documented recurring-cost exception; it remains non-zero-cost. Preflight GO additionally requires every progressive ratio below 0.70, while runtime evidence may be imported up to the hard ceiling or the exact approved Artifact Registry cap so the backend can apply its 70/85/95 tiers.

`Mode` defaults to `Preflight`, where database observations use `DOC_AI_SOURCE_DATABASE_URL` and capacity mode is `preflight_projection`. `Runtime` is reusable only after target deployment and legacy cleanup, reads the target connection only from `DOC_AI_CAPACITY_DATABASE_URL`, emits `runtime_actual`, and still satisfies the complete `CapacityEvidenceV2` metric contract. Neither URL is accepted as a parameter. Runtime collection re-estimates any Artifact Registry overage from the approved official-pricing snapshot and blocks when the estimate is unknown or exceeds the recorded cap.

Use authorization headers, never query parameters or command arguments. Validate provider response schemas, paginate where offered, require exact project/database/script identity, hash those identities before evidence output, and reject HTTP errors, truncated pagination, future timestamps, or counter resets that cannot be tied to the current billing window. Aggregate each mandatory metric across its exact project or account scope and emit exactly one record per metric, release, and identity hash. Never log response bodies.

The Neon CU export path must resolve outside `.artifacts/releases`; the collector records only its SHA-256, approved project-identity hash, billing-window timestamps, and numeric CU-hours. It never copies the raw console export into release evidence.

- [ ] **Step 4: Implement the conservative image gate**

Build these exact contexts and tags:

~~~powershell
docker build -t local/docai-backend:preflight backend
docker build -t local/docai-frontend:preflight frontend
docker build -t local/docai-docling:preflight docling-service
docker build -t local/docai-embeddings:preflight embeddings-service
docker build -t local/docai-renderer:preflight document-renderer
~~~

For each image, read `.Size` from `docker image inspect`, multiply by two for current plus rollback retention, sum without layer deduplication, and block above 419,430,400 bytes. Record the immutable base-image digests and application image IDs, not registry credentials.

- [ ] **Step 5: Implement Neon and embeddings benchmarks**

For each Neon candidate, perform exactly 20 sequential `SELECT 1` connect-and-query samples with a 15-second connect timeout. Redact URLs before errors are persisted. Select Ohio unless another candidate improves median by at least 15%, has no more than 10% worse p95, has 20 successful samples, and is available on the free plan.

For embeddings:

1. start a new `local/docai-embeddings:preflight` container with 2 CPUs, 4 GiB, port bound to loopback, and an empty temporary model cache;
2. measure process start to HTTP 200 `/ready`;
3. POST `{"text":"Kiểm tra embedding tiếng Việt","task_type":"query"}` to `/embed`;
4. require 1,024 finite numbers and HTTP 200 within 180 seconds;
5. send three warm calls and record each duration;
6. record model ID, exact 40-character revision, and a SHA-256 manifest of cached model files;
7. stop and remove only the exact preflight container in a `finally` block.

Any failed sample sets `embeddingFeasible = false`.

- [ ] **Step 6: Revalidate pricing sources**

Fetch every official URL in design section 30. Record status code, retrieval time, response ETag/Last-Modified when available, and SHA-256 of the response body. A first run without `PricingApprovalSha256` writes `pricing-revalidation.json` and returns the safe blocking code `PRICING_APPROVAL_REQUIRED`. After review, the operator hashes that exact file and reruns with the hash; a changed source or file without a new approval blocks the decision.

- [ ] **Step 7: Run and commit**

Run:

~~~powershell
Invoke-Pester -Path @('ops/tests/MigrationCapacity.Tests.ps1','ops/tests/Feasibility.Tests.ps1') -Output Detailed
git diff --check
~~~

Expected: all policy tests pass. Network- and Docker-dependent benchmark execution is not part of the unit-test run.

Commit:

~~~powershell
git add -- ops/lib/PreflightPolicy.psm1 ops/lib/BoundedProcess.psm1 ops/gcp/audit-migration-capacity.ps1 ops/gcp/benchmark-feasibility.ps1 ops/tests/MigrationCapacity.Tests.ps1 ops/tests/Feasibility.Tests.ps1
git commit -m "feat: add migration capacity and feasibility gates"
~~~

---

### Task 3: Make the Database Recovery Set Restorable and Encrypted

**Files:**

- Modify: `ops/backup-postgres.ps1`
- Modify: `ops/import-postgres-data.ps1`
- Create: `ops/gcp/restore-to-neon.ps1`
- Create: `ops/gcp/verify-neon-restore.ps1`
- Create: `ops/tests/NeonMigration.Tests.ps1`
- Modify: `ops/gcp/export-and-shutdown.ps1`

**Interfaces:**

- Consumes:
  - `DOC_AI_SOURCE_DATABASE_URL`
  - `DOC_AI_NEON_DIRECT_URL`
  - `DOC_AI_AGE_RECIPIENT`
  - `DOC_AI_AGE_IDENTITY_FILE` only during rehearsal decryption
  - checksummed quiescence evidence
- Produces:
  - `legacy-data.dump`
  - `legacy-data.dump.sha256`
  - `legacy-data.dump.age`
  - `manifest.json`
  - `restore-evidence.json`
  - `restore-verification.json`
- `restore-to-neon.ps1 -DumpDirectory -QuiescenceEvidencePath -ReleaseSha -EvidenceDirectory -Execute`.
- `verify-neon-restore.ps1 -SourceManifestPath -ReleaseSha -EvidenceDirectory`.

- [ ] **Step 1: Write the failing Pester safety tests**

Use command stubs to assert preview behavior and argument redaction:

~~~powershell
Describe 'Neon restore safety' {
  It 'does not invoke pg_restore without -Execute' {
    Mock Invoke-NativeChecked {}
    & $RestoreScript -DumpDirectory $FixtureDump -QuiescenceEvidencePath $Quiescence `
      -ReleaseSha ('a' * 40) -EvidenceDirectory $Evidence
    Should -Invoke Invoke-NativeChecked -ParameterFilter { $FilePath -eq 'pg_restore' } -Times 0
  }

  It 'rejects identical source and target identities' {
    $env:DOC_AI_NEON_DIRECT_URL = $env:DOC_AI_SOURCE_DATABASE_URL
    { & $RestoreScript -DumpDirectory $FixtureDump -QuiescenceEvidencePath $Quiescence `
        -ReleaseSha ('a' * 40) -EvidenceDirectory $Evidence -Execute } |
      Should -Throw '*same database*'
  }

  It 'requires accepted restore evidence before shutdown' {
    { & $ShutdownScript @ShutdownArgs -ConfirmShutdown } |
      Should -Throw '*accepted Neon restore evidence*'
  }
}
~~~

Also assert that script source never passes a URL-shaped value to `Write-Host`, never accepts a database URL parameter, uses `--data-only`, excludes `_prisma_migrations`, and verifies SHA-256 before import.

- [ ] **Step 2: Run tests and verify failure**

Run:

~~~powershell
Invoke-Pester ops/tests/NeonMigration.Tests.ps1 -Output Detailed
~~~

Expected: FAIL because restore/verification scripts and the new shutdown gate are absent.

- [ ] **Step 3: Correct the backup contract**

Change `pg_dump` arguments to:

~~~powershell
@(
  $env:DOC_AI_SOURCE_DATABASE_URL
  '--format=custom'
  '--data-only'
  '--no-owner'
  '--no-privileges'
  '--exclude-table=public._prisma_migrations'
  "--file=$dump"
)
~~~

Add source schema list, per-table row counts, stable scalar checksums, vector dimension/non-null counts, and provider-key decryptability count without plaintext. Encrypt the verified dump:

~~~powershell
Invoke-NativeChecked age @('-r', $env:DOC_AI_AGE_RECIPIENT, '-o', $encryptedDump, $dump)
if (-not (Test-Path -LiteralPath $encryptedDump)) { throw 'Encrypted backup was not created' }
~~~

The manifest records hashes for the plaintext dump, encrypted dump, row counts, schema list, and quiescence evidence.

- [ ] **Step 4: Implement empty-target Neon restore**

`restore-to-neon.ps1` must:

1. validate both database identities without persisting credentials;
2. require target TLS mode and a direct, non-pooled Neon hostname;
3. verify all manifest hashes;
4. query the target and require no application tables and no applied migrations;
5. run `npm --prefix backend run prisma:deploy:fresh` with `DATABASE_URL` set only in the child process environment;
6. run `ops/import-postgres-data.ps1` with `-Execute`;
7. run `SELECT setval(...)` for imported sequences;
8. write safe target identity hash, migration count, import duration, and status.

It must never restore schema objects from the data-only dump.

- [ ] **Step 5: Implement restore verification**

`verify-neon-restore.ps1` compares:

- every table count in the source manifest;
- deterministic SHA-256 checksums for `User`, `Document`, `Template`, `Chunk`, and `UserLLMConfig` stable scalar projections;
- no null/dangling owner references;
- vector dimension exactly 1,024 and matching non-null counts;
- owner-scoped representative document/template queries;
- provider ciphertext decryptability using the application encryption key without emitting plaintext;
- a bounded vector nearest-neighbor query;
- Prisma migration history; and
- backend readiness against the restored branch.

Any mismatch writes `status = "failed"` and exits nonzero.

- [ ] **Step 6: Gate destructive shutdown**

Add mandatory `-AcceptedRestoreEvidencePath` and `-AcceptedRestoreEvidenceSha256` parameters to `export-and-shutdown.ps1`. When `-ConfirmShutdown` is present, require:

~~~powershell
$Restore = Get-Content -LiteralPath $AcceptedRestoreEvidencePath -Raw | ConvertFrom-Json
if ($Restore.status -ne 'passed') { throw 'Accepted Neon restore evidence is not passed' }
if ((Get-EvidenceSha256 $AcceptedRestoreEvidencePath) -ne $AcceptedRestoreEvidenceSha256) {
  throw 'Accepted Neon restore evidence checksum mismatch'
}
~~~

Preview remains non-destructive.

- [ ] **Step 7: Run and commit**

Run:

~~~powershell
Invoke-Pester ops/tests/NeonMigration.Tests.ps1 -Output Detailed
git diff --check
~~~

Expected: all Pester tests pass and no database command executes in preview tests.

Commit:

~~~powershell
git add -- ops/backup-postgres.ps1 ops/import-postgres-data.ps1 ops/gcp/restore-to-neon.ps1 ops/gcp/verify-neon-restore.ps1 ops/gcp/export-and-shutdown.ps1 ops/tests/NeonMigration.Tests.ps1
git commit -m "feat: add encrypted Neon restore rehearsal gate"
~~~

---

### Task 4: Inventory Regional Objects and Estimate the One-Time Copy

**Files:**

- Modify: `ops/lib/PreflightPolicy.psm1`
- Create: `ops/gcp/inventory-storage.ps1`
- Create: `ops/tests/StorageInventory.Tests.ps1`

**Interfaces:**

- Consumes: exact project ID and the three source bucket names discovered from Terraform outputs or gcloud.
- Produces:
  - `source-all-versions.jsonl`
  - `source-live-objects.jsonl`
  - `source-storage-summary.json`
  - `migration-cost-estimate.json`
- Script: `inventory-storage.ps1 -ProjectId -SourceRegion -TemplatesBucket -UploadsBucket -RagStateBucket -ReleaseSha -EvidenceDirectory`.
- Module export added in this task: `Convert-GcsObjectRecord`.

- [ ] **Step 1: Write failing inventory tests**

~~~powershell
BeforeAll {
  $Root = Split-Path $PSScriptRoot -Parent | Split-Path -Parent
  Import-Module (Join-Path $Root 'ops/lib/PreflightPolicy.psm1') -Force
}

Describe 'Storage inventory' {
  It 'rejects a bucket outside the exact project scope' {
    { & $Script -ProjectId 'project-96fe5a5e-a0df-4a2f-902' `
        -SourceRegion asia-southeast1 -TemplatesBucket 'unrelated' `
        -UploadsBucket 'docai-uploads-project-96fe5a5e-a0df-4a2f-902' `
        -RagStateBucket 'docai-rag-state-project-96fe5a5e-a0df-4a2f-902' `
        -ReleaseSha ('a' * 40) -EvidenceDirectory $Evidence } |
      Should -Throw '*not scoped*'
  }

  It 'requires generation, size, CRC32C, storage class, and timestamp' {
    $row = Convert-GcsObjectRecord $FixtureObject
    $row.PSObject.Properties.Name | Should -Contain 'generation'
    $row.PSObject.Properties.Name | Should -Contain 'crc32c'
    $row.PSObject.Properties.Name | Should -Contain 'size'
  }
}
~~~

- [ ] **Step 2: Run and verify failure**

Run:

~~~powershell
Invoke-Pester ops/tests/StorageInventory.Tests.ps1 -Output Detailed
~~~

Expected: FAIL because `inventory-storage.ps1` is absent.

- [ ] **Step 3: Implement all-version and live manifests**

Implement `Convert-GcsObjectRecord` as a pure exported module function. Use `gcloud storage ls --all-versions --recursive --json` for every exact bucket. Normalize each row to:

~~~json
{
  "bucket": "safe bucket name",
  "name": "object name",
  "generation": "decimal string",
  "size": 123,
  "crc32c": "base64 checksum",
  "md5Hash": "base64 checksum or null",
  "storageClass": "STANDARD",
  "updated": "UTC ISO-8601 timestamp",
  "live": true
}
~~~

Sort by bucket, name, then numeric generation before writing JSON Lines. Compute total versions, live objects, bytes by prefix, projected target live bytes, Class A copy operations, Class B verification operations, and historical archive bytes.

- [ ] **Step 4: Produce a fail-closed migration-cost estimate**

The estimate records:

- exact source and target regions;
- live and archive bytes;
- projected copy/read/write/list operations;
- operator-entered official per-unit prices and source snapshot hash;
- calculated USD amount rounded upward to the nearest cent;
- `requiresApproval = true` whenever amount is greater than zero or a rate is unknown.

An unknown rate is not treated as zero.

- [ ] **Step 5: Run and commit**

Run:

~~~powershell
Invoke-Pester ops/tests/StorageInventory.Tests.ps1 -Output Detailed
git diff --check
~~~

Expected: all tests pass.

Commit:

~~~powershell
git add -- ops/lib/PreflightPolicy.psm1 ops/gcp/inventory-storage.ps1 ops/tests/StorageInventory.Tests.ps1
git commit -m "feat: inventory regional storage migration scope"
~~~

---

### Task 5: Aggregate a Single GO or NO_GO Preflight Decision

**Files:**

- Modify: `ops/lib/PreflightPolicy.psm1`
- Create: `ops/gcp/invoke-preflight.ps1`
- Create: `ops/tests/Preflight.Tests.ps1`
- Modify: `ops/verify-all.ps1`
- Modify: `docs/operations/gcp-production-runbook.md`

**Interfaces:**

- Consumes: outputs from Tasks 1–4, optional `-ApprovedMigrationCostUsd` plus `-ApproveNonZeroMigrationCost`, and optional `-ApprovedRecurringCostCapUsd` plus `-ApproveRecurringCost`.
- Produces: schema-valid `PreflightDecisionV2` at `00-preflight/preflight-decision.json`.
- Module export added in this task: `New-PreflightDecision`.
- Script:

~~~text
invoke-preflight.ps1
  -ProjectId string
  -BillingAccountId string
  -SourceRegion asia-southeast1
  -TargetRegion us-central1
  -ReleaseSha 40-hex
  -AgeRecipient age public recipient
  -EvidenceDirectory safe path
  -PricingApprovalSha256 64-hex
  [-ApprovedMigrationCostUsd decimal]
  [-ApproveNonZeroMigrationCost]
  [-ApprovedRecurringCostCapUsd decimal]
  [-ApproveRecurringCost]
  [-ExecuteRehearsal]
~~~

- [ ] **Step 1: Write failing aggregate tests**

~~~powershell
BeforeAll {
  $Root = Split-Path $PSScriptRoot -Parent | Split-Path -Parent
  Import-Module (Join-Path $Root 'ops/lib/PreflightPolicy.psm1') -Force
}

Describe 'Preflight decision' {
  It 'returns NO_GO when any mandatory check is not passed' {
    $decision = New-PreflightDecision -Checks @(
      @{ name = 'images'; status = 'passed' },
      @{ name = 'embeddings'; status = 'failed' }
    ) -MigrationCostUsd 0 -NonZeroCostApproved:$false `
      -RecurringCostUsd 0 -RecurringCostApproved:$false
    $decision.decision | Should -Be 'NO_GO'
  }

  It 'requires explicit approval for a nonzero migration estimate' {
    (New-PreflightDecision -Checks @(@{ name = 'all'; status = 'passed' }) `
      -MigrationCostUsd 0.01 -NonZeroCostApproved:$false `
      -RecurringCostUsd 0 -RecurringCostApproved:$false).decision | Should -Be 'NO_GO'
  }

  It 'returns GO only when every mandatory check and recovery rehearsal pass' {
    $checks = 'pricing','capacity','images','neon-region','embeddings','database-restore',
      'storage-inventory','legacy-transition' |
      ForEach-Object { @{ name = $_; status = 'passed' } }
    (New-PreflightDecision -Checks $checks -MigrationCostUsd 0 `
      -NonZeroCostApproved:$false -RecurringCostUsd 0 `
      -RecurringCostApproved:$false).decision | Should -Be 'GO'
  }
}
~~~

- [ ] **Step 2: Run and verify failure**

Run:

~~~powershell
Invoke-Pester ops/tests/Preflight.Tests.ps1 -Output Detailed
~~~

Expected: FAIL because the orchestrator is absent.

- [ ] **Step 3: Implement the orchestrator**

Implement `New-PreflightDecision` as a pure exported module function. The orchestrator:

1. validates tools and required environment variables without printing values;
2. resolves the evidence directory;
3. invokes image/Neon/embeddings and storage inventory first, then pricing/capacity so the latter can construct a target projection and a separately reviewable legacy-transition inventory; it invokes the disposable database restore only with `-ExecuteRehearsal`, otherwise records a blocking preview result;
4. hashes every child evidence file;
5. independently schema-validates `CapacityEvidenceV2`, freshness, release identity, complete metric set, account hashes, and progressive ratios, then stores the safe relative path and checksum of `capacity-snapshot.json` as `capacityEvidence`;
6. separately evaluates the exact one-time migration approval and the monthly Artifact Registry cap, preserving `zeroCostFeasible: false` for the latter;
7. scans all evidence for secret-shaped material;
8. validates the final JSON with `preflight-decision.schema.json`;
9. writes `GO` only when every required check—including the legacy-transition inventory—is `passed`; and
10. exits 0 for `GO`, 2 for `NO_GO`, and 1 for script/configuration error.

It must write a `NO_GO` file before exiting 2 so the blocker is reviewable.

- [ ] **Step 4: Wire offline verification and document execution**

Add the Pester files to `ops/verify-all.ps1`; do not invoke networked scripts from that verifier.

Update the runbook with this executable setup:

~~~powershell
function Read-SecretText([string] $Prompt) {
  Read-Host $Prompt -AsSecureString | ConvertFrom-SecureString -AsPlainText
}
$env:DOC_AI_SOURCE_DATABASE_URL = Read-SecretText 'Source direct TLS URL'
$env:DOC_AI_NEON_DIRECT_URL = Read-SecretText 'Disposable Neon direct TLS URL'
$env:DOC_AI_NEON_CANDIDATE_URLS_JSON = Read-SecretText 'Candidate region URL JSON'
$env:DOC_AI_AGE_RECIPIENT = Read-Host 'age public recipient'
$env:DOC_AI_AGE_IDENTITY_FILE = Read-SecretText 'age identity path'
$ArtifactRegistryPricingPath = Read-Host 'reviewed Artifact Registry pricing JSON path'
$env:DOC_AI_ARTIFACT_REGISTRY_PRICING_JSON = Get-Content -LiteralPath $ArtifactRegistryPricingPath -Raw
$env:DOC_AI_PRICING_APPROVAL_SHA256 = Read-Host 'reviewed pricing evidence SHA-256'
$ReleaseSha = (git rev-parse HEAD).Trim()
$Evidence = ".artifacts/releases/$ReleaseSha/00-preflight"
~~~

The runbook must state that entering secrets into a captured terminal session is prohibited and that the variables are removed after execution.

It must also show the two-pass pricing flow: run once without the pricing hash to produce blocking evidence, review `pricing-revalidation.json`, set `DOC_AI_PRICING_APPROVAL_SHA256` to `Get-EvidenceSha256` of that exact file, then rerun the full preflight with `-ExecuteRehearsal`.

- [ ] **Step 5: Run the complete Plan 01 verification**

Run:

~~~powershell
Invoke-Pester -Path @(
  'ops/tests/Evidence.Tests.ps1',
  'ops/tests/MigrationCapacity.Tests.ps1',
  'ops/tests/Feasibility.Tests.ps1',
  'ops/tests/NeonMigration.Tests.ps1',
  'ops/tests/StorageInventory.Tests.ps1',
  'ops/tests/Preflight.Tests.ps1'
) -Output Detailed
pwsh -NoProfile -File ops/verify-all.ps1
git diff --check
~~~

Expected: all Pester tests and repository verification pass. No production discovery runs during `verify-all.ps1`.

- [ ] **Step 6: Commit**

~~~powershell
git add -- ops/lib/PreflightPolicy.psm1 ops/gcp/invoke-preflight.ps1 ops/tests/Preflight.Tests.ps1 ops/verify-all.ps1 docs/operations/gcp-production-runbook.md
git commit -m "feat: enforce a single DocAI migration preflight gate"
~~~

## Plan 01 Exit Gate

Run the real preflight only with the exact production identifiers and a disposable Neon branch. Do not begin Plan 02 until:

- `preflight-decision.json` validates against its schema;
- `decision` is `GO`;
- every referenced evidence hash matches;
- the evidence secret scan passes;
- image storage is at most 400 MiB conservatively, or the official recurring estimate is known and within the exact user-approved monthly cap with `zeroCostFeasible: false`;
- the local Jina gate passes;
- the encrypted restore rehearsal passes;
- all mandatory progressive values are below 70%, all non-Artifact hard limits are at or below ceiling, and any Artifact Registry exception is valid and within cap; and
- the user accepts the decision, any exact one-time cost, and any explicit recurring monthly cap.
