# Zero-Cost Durable DocAI Infrastructure and Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed Cloudflare/Cloud Run trust boundary, a us-central1 scale-to-zero Terraform target with Cloud Tasks and five runtime secret bundles, immutable deployment wiring, and preview-safe regional storage/cutover tooling.

**Architecture:** Cloudflare injects a rotating origin token and defaults to maintenance when its configuration is incomplete. Terraform forgets legacy regional resources without destroying them, then creates separately addressed us-central1 resources so private acceptance can coexist with recoverable sources. Operational scripts copy and verify current GCS objects, encrypt historical generations, inject secret versions through stdin, and expose destructive actions only behind evidence hashes and explicit switches.

**Tech Stack:** Cloudflare Workers/Wrangler, Next.js 16, Terraform 1.8+/Google provider 7, Cloud Run, Cloud Tasks, GCS FUSE/Storage API, Secret Manager, Artifact Registry, GitHub Actions, PowerShell 7/Pester/gcloud.

**Spec:** `docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-design.md`

## Global Constraints

- Plans 01–04 must be green before a target Terraform plan is approved.
- Cloudflare is the only public application edge; the Cloud Run frontend remains technically public but returns 404 for every route except `/internal/live` without a valid origin token.
- The Worker removes a client-supplied origin-token header before adding its secret value.
- The frontend accepts current and previous tokens; previous expires no later than 15 minutes after rotation.
- Missing Worker upstream/token/maintenance configuration fails closed to maintenance and never proxies.
- Every new GCP runtime, queue, registry, job, and bucket uses `us-central1`.
- All Cloud Run services use request billing, CPU idle, minimum zero, immutable image references, and exact spec limits.
- API is private to frontend/smoke identities. Task invoker identities can invoke only their matching worker. Generation invokes only renderer; processing invokes Docling/embeddings for ingestion and renderer for template compilation.
- Frontend-to-API proxy calls use the existing ADC ID-token client with the canonical API origin as audience and `X-Serverless-Authorization`, leaving the user's `Authorization` header intact.
- Target bucket names contain `-uc1-`; location change is never an in-place update.
- Target buckets use Standard regional storage, uniform access, public-access prevention, object versioning, disabled soft delete, `force_destroy = false`, and exact lifecycle rules.
- Source Cloud SQL, services, buckets, registry, and secrets remain intact/unmanaged during private acceptance.
- Terraform must contain no secret payload. Runtime secret versions are added through stdin and pinned numerically.
- Steady state has no more than five active Secret Manager versions across the reserved billing allocation.
- The scale-to-zero topology has no always-on capacity collector; an authenticated operator runs the release-bound refresh/import command at least every four hours, and stale evidence closes heavy admission.
- Artifact Registry retains the current and rollback manifests. A footprint above 400 MiB requires known official pricing and must remain within the exact user-approved recurring monthly cap; it is never labeled zero cost.
- GCP budgets at approximately USD 1, 5, and 10 are alerts, not spend caps.
- Implementation never runs `terraform apply`, `wrangler deploy`, a production copy, or a deletion command.

---

## File Map

- Modify Cloudflare Worker source/tests/config for maintenance and origin injection.
- Create frontend origin-token guard/tests and `/internal/live`; remove direct public `/api/live`.
- Create backend/frontend/renderer runtime-bundle loaders and tests.
- Refactor Terraform to separately addressed target resources and `removed { destroy = false }` legacy declarations.
- Create Cloud Tasks queues, workers, service identities, least-privilege IAM, monitors, budgets, target outputs, and target GCS lifecycle.
- Modify GitHub CI/deployment workflows and Pester contracts.
- Create storage/credential archive and verification, secret injection, cutover preview, and legacy-retirement scripts/tests.
- Create release-bound capacity-snapshot publication tooling and tests.
- Create a capacity refresh command that preserves any explicit Artifact Registry cost cap; missed refreshes deliberately fail heavy admission closed.
- Rewrite production and rollback runbooks to the evidence-gated sequence.

---

### Task 1: Enforce Cloudflare Maintenance and Rotating Origin Authentication

**Files:**

- Modify: `cloudflare-worker/src/index.mjs`
- Modify: `cloudflare-worker/src/proxy.mjs`
- Modify: `cloudflare-worker/test/proxy.test.mjs`
- Create: `cloudflare-worker/test/maintenance.test.mjs`
- Modify: `cloudflare-worker/test/configuration.test.mjs`
- Modify: `cloudflare-worker/wrangler.jsonc`
- Create: `frontend/lib/server/origin-token.ts`
- Create: `frontend/test/origin-token.test.ts`
- Modify: `frontend/proxy.ts`
- Modify: `frontend/test/proxy.test.ts`
- Create: `frontend/app/internal/live/route.ts`
- Delete: `frontend/app/api/live/route.ts`
- Modify: `frontend/test/health-routes.test.ts`

**Interfaces:**

- Consumes Worker environment:

~~~text
UPSTREAM_ORIGIN
MAINTENANCE_MODE=on|off
DOC_AI_ORIGIN_TOKEN (secret)
~~~

- Consumes frontend `DOC_AI_FRONTEND_ORIGIN_JSON`:

~~~json
{
  "current": "at least 32 random bytes encoded base64url",
  "previous": "optional prior token",
  "previousValidUntil": "UTC ISO-8601 timestamp or null"
}
~~~

- Produces:
  - `createWorkerHandler(env, fetchUpstream) -> (Request) => Promise<Response>`
  - `hasValidOriginToken(request, now?) -> boolean`.

- [ ] **Step 1: Write failing Worker tests**

~~~javascript
test('missing configuration fails closed without reaching upstream', async () => {
  let calls = 0;
  const handler = createWorkerHandler({}, async () => { calls += 1; });
  const response = await handler(new Request('https://docai.dpdns.org/generate'));
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});

test('normal proxy strips a client token and injects the Worker secret', async () => {
  const seen = [];
  const handler = createWorkerHandler({
    UPSTREAM_ORIGIN: 'https://frontend.run.app',
    MAINTENANCE_MODE: 'off',
    DOC_AI_ORIGIN_TOKEN: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  }, async request => {
    seen.push(request.headers.get('x-docai-origin-token'));
    return new Response('ok');
  });
  await handler(new Request('https://docai.dpdns.org/', {
    headers: { 'x-docai-origin-token': 'attacker-value' },
  }));
  assert.deepEqual(seen, ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']);
});
~~~

Also assert maintenance returns 503, `Retry-After: 300`, `Cache-Control: no-store`, safe Vietnamese HTML/text, no upstream call, and normal Location rewriting.

- [ ] **Step 2: Run and verify Worker failure**

Run:

~~~powershell
npm --prefix cloudflare-worker test
~~~

Expected: FAIL because the Worker hardcodes the origin and has no maintenance/token behavior.

- [ ] **Step 3: Implement fail-closed Worker routing**

`index.mjs` passes runtime `env` to `createWorkerHandler`. `proxy.mjs`:

1. validates HTTPS upstream;
2. returns maintenance unless `MAINTENANCE_MODE === "off"`;
3. returns maintenance unless the token is valid base64url decoding to at least 32 bytes;
4. removes client `x-docai-origin-token`;
5. adds the secret header;
6. preserves streaming request/response bodies and redirect rewriting; and
7. never reflects the token.

Keep `wrangler.jsonc` free of secrets. Declare only non-secret `UPSTREAM_ORIGIN` and default `MAINTENANCE_MODE = "on"` vars.

- [ ] **Step 4: Write failing frontend origin tests**

~~~typescript
it('accepts current and unexpired previous tokens in constant time', () => {
  vi.stubEnv('DOC_AI_FRONTEND_ORIGIN_JSON', JSON.stringify({
    current: CURRENT,
    previous: PREVIOUS,
    previousValidUntil: '2026-08-14T00:15:00Z',
  }));
  expect(hasValidOriginToken(requestWith(CURRENT), new Date('2026-08-14T00:10:00Z'))).toBe(true);
  expect(hasValidOriginToken(requestWith(PREVIOUS), new Date('2026-08-14T00:10:00Z'))).toBe(true);
  expect(hasValidOriginToken(requestWith(PREVIOUS), new Date('2026-08-14T00:15:00Z'))).toBe(false);
  expect(hasValidOriginToken(requestWith('wrong'), new Date('2026-08-14T00:10:00Z'))).toBe(false);
});
~~~

Add route tests proving direct `/`, `/login`, `/api/session/login`, `/_next/static/...`, and `/api/ready` return 404 without a token; only `/internal/live` returns process liveness with no dependency/configuration fields.

- [ ] **Step 5: Implement frontend guard before session routing**

In `frontend/proxy.ts`, check `/internal/live` first, then require `hasValidOriginToken` for every other path before auth/session logic. Configure matcher for all paths. Compare equal-length buffers with `timingSafeEqual`; malformed JSON or tokens fail closed.

Return a bodyless 404 with `Cache-Control: no-store`; never reveal why the request was rejected.

- [ ] **Step 6: Run and commit**

Run:

~~~powershell
npm --prefix cloudflare-worker test
npm --prefix frontend test -- --run test/origin-token.test.ts test/proxy.test.ts test/health-routes.test.ts
npm --prefix frontend run typecheck
git diff --check
~~~

Expected: Worker/frontend tests and typecheck pass.

Commit:

~~~powershell
git add -- cloudflare-worker/src/index.mjs cloudflare-worker/src/proxy.mjs cloudflare-worker/test/proxy.test.mjs cloudflare-worker/test/maintenance.test.mjs cloudflare-worker/test/configuration.test.mjs cloudflare-worker/wrangler.jsonc frontend/lib/server/origin-token.ts frontend/test/origin-token.test.ts frontend/proxy.ts frontend/test/proxy.test.ts frontend/app/internal/live/route.ts frontend/app/api/live/route.ts frontend/test/health-routes.test.ts
git commit -m "feat: protect the frontend origin behind Cloudflare"
~~~

---

### Task 2: Load Five Service-Scoped Runtime Secret Bundles

**Files:**

- Create: `backend/src/utils/runtime_secrets.ts`
- Create: `backend/src/utils/runtime_secrets.test.ts`
- Modify: `backend/src/utils/prisma.ts`
- Modify: `backend/src/utils/validateEnv.ts`
- Modify: `backend/src/utils/validateEnv.test.ts`
- Create: `frontend/lib/server/runtime-secrets.ts`
- Create: `frontend/test/runtime-secrets.test.ts`
- Modify: `frontend/lib/server/origin-token.ts`
- Modify: `frontend/lib/server/backend.ts`
- Modify: `frontend/lib/server/cloud-run-auth.ts`
- Modify: `frontend/test/cloud-run-auth.test.ts`
- Modify: `frontend/test/proxy-route.test.ts`
- Modify: `document-renderer/src/DocumentRenderer.Api/Program.cs`
- Create: `document-renderer/tests/DocumentRenderer.Tests/RuntimeSecretTests.cs`

**Interfaces:**

- Consumes:

~~~text
DOC_AI_DATABASE_RUNTIME_JSON
DOC_AI_API_RUNTIME_JSON
DOC_AI_WORKER_RUNTIME_JSON
DOC_AI_RENDERER_RUNTIME_JSON
DOC_AI_FRONTEND_ORIGIN_JSON
~~~

- Produces:

~~~typescript
export function hydrateRuntimeSecrets(
  role: 'api' | 'generation-worker' | 'processing-worker' | 'migration',
  env?: NodeJS.ProcessEnv,
): void;
~~~

The five JSON payload contracts are exactly design section 18.

- [ ] **Step 1: Write failing bundle tests**

~~~typescript
it('hydrates only keys allowed for the API role', () => {
  const env = {
    DOC_AI_DATABASE_RUNTIME_JSON: JSON.stringify({ databaseUrl: POOLED_URL }),
    DOC_AI_API_RUNTIME_JSON: JSON.stringify({
      jwtSecret: JWT, redisUrl: REDIS, llmEncryptionKey: KEY,
      turnstileSecretKey: TURNSTILE, smtpUser: '', smtpPass: '',
    }),
  };
  hydrateRuntimeSecrets('api', env);
  expect(env.DATABASE_URL).toBe(POOLED_URL);
  expect(env.JWT_SECRET).toBe(JWT);
  expect(env.RENDERER_INTERNAL_TOKEN).toBeUndefined();
});
~~~

Assert malformed/unknown/missing fields fail, database URLs are pooled TLS for runtime, direct URLs are migration-only, and errors mention field names but never values. Frontend tests additionally set `K_SERVICE` and prove startup/configuration rejects a missing or non-HTTPS `BACKEND_API_URL`, a missing audience, and an audience whose origin differs from the canonical backend URL; local non-Cloud-Run development may retain the localhost fallback.

- [ ] **Step 2: Run and verify failure**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/utils/runtime_secrets.test.ts
npm --prefix frontend test -- --run test/runtime-secrets.test.ts
dotnet test document-renderer/DocumentRenderer.sln --filter RuntimeSecretTests
~~~

Expected: FAIL because bundle loaders do not exist.

- [ ] **Step 3: Implement role-scoped parsing before client construction**

Call `hydrateRuntimeSecrets` at the top of `backend/src/utils/prisma.ts` before PrismaClient construction and at worker/API entry points before configuration validation. Use strict key allowlists; do not log payloads.

Generation and processing workers consume database plus worker bundles. The worker bundle supplies the shared encryption material and renderer token; IAM still limits calls so generation reaches renderer only, while processing reaches Docling/embeddings and renderer only for template compilation. API consumes database plus API bundle.

- [ ] **Step 4: Implement frontend and renderer bundle readers**

Frontend parses only the origin bundle. In Cloud Run, `frontend/lib/server/backend.ts` requires explicit canonical `BACKEND_API_URL` and `BACKEND_ID_TOKEN_AUDIENCE` values with the same HTTPS origin before forwarding; `cloud-run-auth.ts` obtains an ADC ID token for that audience and uses `X-Serverless-Authorization` so the user's `Authorization` header remains available to the application. Never send either token to browser code. The renderer parses `rendererToken` from its bundle during startup and never stores the JSON in logs/options dumps. C# errors name the missing property but not its value.

- [ ] **Step 5: Run and commit**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/utils/runtime_secrets.test.ts src/utils/validateEnv.test.ts src/utils/prisma.test.ts
npm --prefix backend run build
npm --prefix frontend test -- --run test/runtime-secrets.test.ts test/origin-token.test.ts test/cloud-run-auth.test.ts test/proxy-route.test.ts
npm --prefix frontend run typecheck
dotnet test document-renderer/DocumentRenderer.sln
git diff --check
~~~

Expected: all tests/builds pass.

Commit:

~~~powershell
git add -- backend/src/utils/runtime_secrets.ts backend/src/utils/runtime_secrets.test.ts backend/src/utils/prisma.ts backend/src/utils/validateEnv.ts backend/src/utils/validateEnv.test.ts frontend/lib/server/runtime-secrets.ts frontend/test/runtime-secrets.test.ts frontend/lib/server/origin-token.ts frontend/lib/server/backend.ts frontend/lib/server/cloud-run-auth.ts frontend/test/cloud-run-auth.test.ts frontend/test/proxy-route.test.ts document-renderer/src/DocumentRenderer.Api/Program.cs document-renderer/tests/DocumentRenderer.Tests/RuntimeSecretTests.cs
git commit -m "feat: load service-scoped runtime secret bundles"
~~~

---

### Task 3: Refactor Terraform to Safe us-central1 Target Resources

**Files:**

- Modify: `infra/terraform/variables.tf`
- Modify: `infra/terraform/apis.tf`
- Delete: `infra/terraform/sql.tf`
- Create: `infra/terraform/retired_resources.tf`
- Modify: `infra/terraform/artifact_registry.tf`
- Modify: `infra/terraform/storage.tf`
- Modify: `infra/terraform/secrets.tf`
- Create: `infra/terraform/cloud_tasks.tf`
- Modify: `infra/terraform/cloud_run.tf`
- Modify: `infra/terraform/iam.tf`
- Modify: `infra/terraform/monitoring.tf`
- Modify: `infra/terraform/budgets.tf`
- Modify: `infra/terraform/outputs.tf`
- Modify: `infra/terraform/prod.tfvars.example`
- Create: `ops/tests/TerraformConfig.Tests.ps1`
- Modify: `ops/tests/TerraformPlan.Tests.ps1`

**Interfaces:**

- Consumes: runtime names/env/contracts from Plans 02–04 and accepted Plan 01 region/image decision.
- Produces:
  - generation and processing queue names/URLs;
  - seven target service URLs and four manually invoked target job names;
  - three target bucket names;
  - five Secret Manager bundle IDs;
  - target image repository;
  - a plan with no destroy actions for legacy resources during private deployment.

- [ ] **Step 1: Write failing static Terraform contracts**

Create `ops/tests/TerraformConfig.Tests.ps1`:

~~~powershell
Describe 'Target Terraform source contract' {
  It 'locks the target region and contains no managed Cloud SQL resource' {
    $all = (Get-ChildItem $TerraformRoot -Filter '*.tf' | Sort-Object FullName |
      ForEach-Object { Get-Content $_.FullName -Raw }) -join "`n"
    $all | Should -Match 'default\s*=\s*"us-central1"'
    $all | Should -Not -Match 'resource\s+"google_sql_'
    $all | Should -Not -Match 'cloud_sql_instance'
  }

  It 'forgets legacy resources without destroying them' {
    $retired = Get-Content (Join-Path $TerraformRoot 'retired_resources.tf') -Raw
    $retired | Should -Match 'from\s*=\s*google_sql_database_instance\.main'
    $retired | Should -Match 'destroy\s*=\s*false'
    $retired | Should -Match 'from\s*=\s*google_storage_bucket\.persistent'
    $retired | Should -Match 'from\s*=\s*google_cloud_run_v2_service\.backend'
  }
}
~~~

Add static checks for Cloud Tasks API, exact target bucket name fragments, disabled soft delete, five runtime secret resources, no secret versions/payloads in Terraform, no `min_instance_count` other than zero, and exact frontend `BACKEND_API_URL`/`BACKEND_ID_TOKEN_AUDIENCE` values derived from the canonical private API URL.

- [ ] **Step 2: Run and verify failure**

Run:

~~~powershell
Invoke-Pester ops/tests/TerraformConfig.Tests.ps1 -Output Detailed
~~~

Expected: FAIL because current Terraform manages Cloud SQL and asia-southeast1 resources.

- [ ] **Step 3: Retire legacy state without deletion**

Delete managed Cloud SQL definitions and add Terraform 1.8 `removed` blocks with `lifecycle { destroy = false }` for:

- Cloud SQL instance/database/user/random password/database secret version;
- legacy five Cloud Run service addresses and four jobs whose resources are replaced;
- legacy `google_storage_bucket.persistent`;
- legacy asia-southeast1 Artifact Registry address; and
- legacy per-secret resources replaced by bundles.

Use separately named target addresses such as `google_cloud_run_v2_service.target`, `google_storage_bucket.target`, and `google_artifact_registry_repository.target` so removed and new resources never share an address. Rendered-plan tests require state forget plus creates, with zero legacy destroy actions.

- [ ] **Step 4: Create exact regional storage and registry**

Create:

~~~text
docai-templates-uc1-{project_id}
docai-uploads-uc1-{project_id}
docai-rag-state-uc1-{project_id}
~~~

Use `location = "US-CENTRAL1"`, `storage_class = "STANDARD"`, uniform access, public-access prevention, versioning, `soft_delete_policy.retention_duration_seconds = 0`, and `force_destroy = false`.

Lifecycle:

- `uploads/incoming/`: 1 day;
- `abandoned/`: 7 days;
- generated preview prefixes: 7 days;
- noncurrent versions: 14 days;
- `reports/`: 30 days.

Do not add deletion rules for live originals, source PDFs, or completed generated documents.

Configure Artifact Registry cleanup to keep current/previous tagged manifests for each package and delete only untagged/older manifests after evidence proves rollback retention is either at most 400 MiB or within the exact approved recurring monthly cap. Cleanup must never discard the rollback manifests merely to manufacture a zero-cost result.

- [ ] **Step 5: Create exactly five runtime secret containers**

Create metadata only:

~~~text
docai-database-runtime
docai-api-runtime
docai-worker-runtime
docai-renderer-runtime
docai-frontend-origin
~~~

No `google_secret_manager_secret_version`, `secret_data`, random password, or database URL string may exist in Terraform. Services accept explicit numeric version variables for these five bundles.

- [ ] **Step 6: Create exact queues**

`cloud_tasks.tf`:

| Setting | Generation | Processing |
|---|---:|---:|
| max concurrent dispatches | 5 | 1 |
| max dispatches/second | 2 | 1 |
| min backoff | 15s | 30s |
| max backoff | 120s | 300s |
| max doublings | 3 | 3 |
| max attempts | 100 | 3 |
| max retry duration | 21600s | 7200s |

Task dispatch deadline remains an application-created task property of 1,680 seconds and is asserted in backend tests.

- [ ] **Step 7: Create exact Cloud Run services**

| Service | CPU | Memory | Min/max | Concurrency | Timeout |
|---|---:|---:|---:|---:|---:|
| frontend | 1 | 512 MiB | 0/2 | 40 | 300s |
| backend API | 1 | 1 GiB | 0/2 | 20 | 300s |
| generation worker | 2 | 2 GiB | 0/2 | 3 | 1560s |
| processing worker | 2 | 2 GiB | 0/1 | 1 | 1560s |
| Docling | 2 | 4 GiB | 0/1 | 1 | 900s |
| embeddings | 2 | 4 GiB | 0/1 | 10 | 180s |
| renderer | 2 | 2 GiB | 0/1 | 1 | 180s |

Every container has `cpu_idle = true`, startup CPU boost, immutable SHA image, `/internal/live` for frontend and `/live` for private services, and role-appropriate `/ready`. API and relevant workers set `DB_CONNECTION_LIMIT=5`. The API receives immutable non-secret `DOC_AI_DEPLOYED_RELEASE_SHA` and `DOC_AI_EXPECTED_CAPACITY_IDENTITIES_JSON` settings matching the accepted capacity evidence; neither may default to another release/account.

The frontend receives `BACKEND_API_URL` and `BACKEND_ID_TOKEN_AUDIENCE` from the same canonical API service-URI output. Terraform tests reject tagged/candidate URLs as the audience, and `frontend/test/cloud-run-auth.test.ts` plus `frontend/test/proxy-route.test.ts` prove the server-side proxy keeps user authorization separate from platform invocation authorization.

API/processing/renderer mounts use target buckets and exact paths. There is no Cloud SQL volume.

Create four manually invoked target jobs in us-central1: `docai-migrate`, `docai-bootstrap-user`, `docai-bootstrap-smoke-user`, and `docai-reset-password`. Each uses the immutable backend digest, task count and parallelism one, zero automatic retries, `DB_CONNECTION_LIMIT=1`, and no public invoker. Migration/operator jobs may pin a short-lived direct-database secret version; ordinary services remain pinned to the pooled runtime version. No bootstrap or password-reset job runs as deployment smoke.

- [ ] **Step 8: Enforce least-privilege IAM**

Create separate identities:

~~~text
docai-generation-worker
docai-processing-worker
docai-generation-task
docai-processing-task
~~~

Bindings:

- allUsers invokes frontend only;
- frontend invokes backend only;
- API enqueues both queues but invokes no worker directly;
- generation-task invokes generation worker only;
- processing-task invokes processing worker only;
- generation worker invokes renderer and accesses generated/abandoned objects;
- processing worker invokes Docling/embeddings plus renderer for template compilation and accesses upload/template/preview objects;
- renderer accesses template originals, previews, and abandoned staging;
- smoke identity may invoke private services;
- runtime identities access only their bundle/database bundle.

No runtime identity has Secret Manager admin, project editor, or storage admin.

- [ ] **Step 9: Replace monitoring and budget contracts**

Remove Cloud SQL metrics. Add queue depth/oldest age, delivery retry, worker 5xx, duration, OCR route, readiness, capacity-guard signals, and an alert when the earliest mandatory capacity expiry is under 60 minutes without logging task bodies/content. The public uptime check targets the Cloudflare hostname at `/internal/live`; private `/ready` probes use an authenticated smoke identity and never make a protected run.app route public.

Budget thresholds are approximately USD 1, 5, and 10 with documentation that alerts do not hard-stop charges. Logging exclusion/sampling must preserve errors, security events, terminal job transitions, and capacity failures while keeping the 35 GiB internal ceiling measurable.

- [ ] **Step 10: Run Terraform verification and commit**

Run:

~~~powershell
terraform -chdir=infra/terraform fmt -recursive
$TaskTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$TaskTempPrefix = $TaskTempRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$TerraformDataDir = [IO.Path]::GetFullPath((Join-Path $TaskTempRoot ('docai-tf-' + [guid]::NewGuid().ToString('N'))))
if (-not $TerraformDataDir.StartsWith($TaskTempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Unsafe Terraform data directory'
}
$PreviousTerraformDataDir = [Environment]::GetEnvironmentVariable('TF_DATA_DIR', 'Process')
try {
  $env:TF_DATA_DIR = $TerraformDataDir
  terraform -chdir=infra/terraform init -backend=false -input=false
  terraform -chdir=infra/terraform validate
  Invoke-Pester ops/tests/TerraformConfig.Tests.ps1 -Output Detailed
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

Expected: Terraform formatted/valid, Pester green, and no remote backend/apply operation.

Commit:

~~~powershell
git add -- infra/terraform/variables.tf infra/terraform/apis.tf infra/terraform/sql.tf infra/terraform/retired_resources.tf infra/terraform/artifact_registry.tf infra/terraform/storage.tf infra/terraform/secrets.tf infra/terraform/cloud_tasks.tf infra/terraform/cloud_run.tf infra/terraform/iam.tf infra/terraform/monitoring.tf infra/terraform/budgets.tf infra/terraform/outputs.tf infra/terraform/prod.tfvars.example ops/tests/TerraformConfig.Tests.ps1 ops/tests/TerraformPlan.Tests.ps1
git commit -m "infra: add scale-to-zero us-central1 target"
~~~

---

### Task 4: Make CI/CD Build and Update the Exact Target Services

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy-production.yml`
- Modify: `ops/tests/GitHubWorkflow.Tests.ps1`
- Create: `ops/gcp/inject-runtime-secrets.ps1`
- Create: `ops/tests/RuntimeSecrets.Tests.ps1`

**Interfaces:**

- Consumes: five JSON payloads through process stdin/environment and Terraform-created secret containers/services.
- Produces:
  - immutable image digests for backend, frontend, Docling, embeddings, renderer;
  - generation/processing services using the backend digest;
  - numeric secret version evidence without payloads.

- [ ] **Step 1: Write failing workflow and secret-injection tests**

Pester requires:

~~~powershell
$workflow | Should -Match 'docai-generation-worker'
$workflow | Should -Match 'docai-processing-worker'
$workflow | Should -Match 'context:\s*embeddings-service'
$workflow | Should -Not -Match 'deploy/embeddings-jina-proxy'
$workflow | Should -Not -Match 'gcloud run deploy'
$workflow | Should -Match 'gcloud run services update'
$workflow | Should -Match 'us-central1'
~~~

Secret tests assert preview creates no version, payload comes from stdin, version output is numeric, exactly one target version for each of the five bundles is created, temporary project-wide excess is recorded against the approved migration-cost evidence, and logs never contain payload substrings.

- [ ] **Step 2: Run and verify failure**

Run:

~~~powershell
Invoke-Pester -Path @('ops/tests/GitHubWorkflow.Tests.ps1','ops/tests/RuntimeSecrets.Tests.ps1') -Output Detailed
~~~

Expected: FAIL because workers and bundle injection are not wired.

- [ ] **Step 3: Update CI**

CI runs:

- backend tests/build including two worker entry points;
- frontend tests/typecheck/lint/build;
- Docling and local `embeddings-service` pytest;
- renderer tests/build;
- Worker tests;
- Terraform static/fmt/validate;
- Pester;
- five container builds/scans.

Backend image is built once and reused for API/generation/processing. Record manifest size evidence so retained image bytes can be checked before push.

- [ ] **Step 4: Implement preview-safe secret injection**

`inject-runtime-secrets.ps1` takes project, release SHA, evidence directory, and `-Execute`. It reads each bundle from these environment variables:

~~~text
DOC_AI_DATABASE_RUNTIME_JSON
DOC_AI_API_RUNTIME_JSON
DOC_AI_WORKER_RUNTIME_JSON
DOC_AI_RENDERER_RUNTIME_JSON
DOC_AI_FRONTEND_ORIGIN_JSON
~~~

For execution, pipe bytes to:

~~~powershell
$Payload | gcloud secrets versions add $SecretId --project=$ProjectId --data-file=-
~~~

Capture only secret ID/version/state. Injection may temporarily exceed five project-wide active versions while maintenance is on; record the exact temporary total and require its approved one-time cost evidence. Before any private heavy-work admission, disable the direct and obsolete legacy versions so exactly five target bundle versions remain active. Rotation uses current/previous values inside the frontend JSON, not extra Secret Manager versions.

- [ ] **Step 5: Update deployment workflow**

The workflow authenticates with existing branch-restricted WIF, builds/pushes immutable SHA images, verifies digests/sizes, and updates only Terraform-created services:

~~~text
docai-docling
docai-embeddings
docai-renderer
docai-generation-worker
docai-processing-worker
docai-backend
docai-frontend
~~~

It updates private processors/workers first, runs the migration job with the direct URL short-lived secret, updates API/frontend while Cloudflare maintenance is on, performs authenticated private smoke, and never changes IAM or creates services.

- [ ] **Step 6: Run and commit**

Run:

~~~powershell
Invoke-Pester -Path @('ops/tests/GitHubWorkflow.Tests.ps1','ops/tests/RuntimeSecrets.Tests.ps1') -Output Detailed
git diff --check
~~~

Expected: tests pass and workflow source contains no credential payload.

Commit:

~~~powershell
git add -- .github/workflows/ci.yml .github/workflows/deploy-production.yml ops/tests/GitHubWorkflow.Tests.ps1 ops/gcp/inject-runtime-secrets.ps1 ops/tests/RuntimeSecrets.Tests.ps1
git commit -m "ci: deploy immutable durable worker services"
~~~

---

### Task 5: Build Verified Regional Copy, Cutover, and Retirement Tooling

**Files:**

- Create: `ops/gcp/copy-storage-region.ps1`
- Create: `ops/gcp/archive-storage-versions.ps1`
- Create: `ops/gcp/archive-secret-versions.ps1`
- Create: `ops/gcp/verify-storage-copy.ps1`
- Create: `ops/gcp/invoke-cutover.ps1`
- Create: `ops/gcp/publish-capacity-snapshots.ps1`
- Create: `ops/gcp/refresh-capacity-snapshots.ps1`
- Create: `ops/gcp/retire-legacy-resources.ps1`
- Create: `ops/schemas/capacity-refresh-index.schema.json`
- Create: `ops/tests/StorageMigration.Tests.ps1`
- Create: `ops/tests/CutoverSafety.Tests.ps1`
- Create: `ops/tests/CapacityPublication.Tests.ps1`
- Modify: `ops/gcp/export-and-shutdown.ps1`
- Modify: `ops/gcp/rollback.ps1`
- Modify: `docs/operations/gcp-production-runbook.md`
- Modify: `docs/operations/gcp-rollback.md`

**Interfaces:**

- Consumes:
  - Plan 01 source manifests and accepted restore evidence;
  - exact source/target bucket map;
  - target Terraform plan hash;
  - provisional release-manifest path/hash containing the accepted preflight entry;
  - maintenance/quiescence evidence;
  - `DOC_AI_AGE_RECIPIENT`;
  - `DOC_AI_AGE_IDENTITY_FILE` only for local recovery rehearsal;
  - `DOC_AI_CAPACITY_DATABASE_URL` and `DOC_AI_EXPECTED_CAPACITY_IDENTITIES_JSON` through environment only;
  - `DOC_AI_BILLING_ACCOUNT_ID`, `DOC_AI_PRICING_APPROVAL_SHA256`, the exact Neon/Upstash/Cloudflare credential and identity variables defined by Plan 01, and a fresh `DOC_AI_NEON_CU_USAGE_EXPORT_PATH`;
  - explicit `-ExecuteCopy`, `-ExecutePrivateDeploy`, or `-ConfirmDestruction` switches.
- Produces:
  - `target-live-objects.jsonl`;
  - `storage-copy-verification.json`;
  - `historical-objects.tar.age` and checksum;
  - `legacy-secrets.json.age`, checksum, and value-free credential-recovery evidence;
  - `private-deploy.json`;
  - `capacity-publication.json` containing only release/hash/count/freshness outcomes;
  - periodic `capacity-evidence.json` plus `capacity-refresh-index.json`;
  - `legacy-retirement-preview.json` or confirmed deletion record.

- [ ] **Step 1: Write failing storage-copy safety tests**

~~~powershell
Describe 'Regional copy safety' {
  It 'rejects identical source and target buckets' {
    { & $CopyScript -ProjectId $Project -SourceManifest $Manifest `
        -TemplatesTarget $TemplatesSource -UploadsTarget $UploadsTarget `
        -RagStateTarget $RagTarget -EvidenceDirectory $Evidence } |
      Should -Throw '*source and target*'
  }

  It 'does not invoke gcloud storage cp without -ExecuteCopy' {
    Mock Invoke-NativeChecked {}
    & $CopyScript @SafeArgs
    Should -Invoke Invoke-NativeChecked -ParameterFilter {
      $Arguments -contains 'cp'
    } -Times 0
  }
}
~~~

Add tests for exact project/bucket prefixes, target region, `force_destroy=false`, missing checksum, object-count mismatch, unencrypted archive, credential archive preview making zero secret-access calls, payload substrings absent from output/evidence, missing maintenance/quiescence, capacity publication without `-Execute`, release/account/hash/freshness mismatch, and destruction without all accepted evidence hashes.

- [ ] **Step 2: Run and verify failure**

Run:

~~~powershell
Invoke-Pester -Path @('ops/tests/StorageMigration.Tests.ps1','ops/tests/CutoverSafety.Tests.ps1','ops/tests/CapacityPublication.Tests.ps1') -Output Detailed
~~~

Expected: FAIL because the scripts are absent.

- [ ] **Step 3: Implement current-live-object copy and verification**

Read the accepted source JSONL; copy exactly the current live generation of every required object into the corresponding target bucket/name. Never use an unconstrained recursive source glob.

For every target object, record and compare name, size, CRC32C, and MD5 when present. Require equal object count and total bytes. Run owner-path validation against DB records and smoke reads for template, source PDF, retrieval, render, and download before `status = "passed"`.

- [ ] **Step 4: Implement encrypted historical-generation and credential archives**

Resolve a unique, permission-restricted directory under the OS temporary root, verify its absolute path remains below that root, download only historical generations listed in the source manifest, write a deterministic tar manifest, stream the tar through age, verify encrypted checksum, then re-resolve and remove only that exact temporary directory in `finally`. Never put a plaintext object or tar below the evidence directory.

`archive-secret-versions.ps1` accepts the exact project, release SHA, approved secret/version inventory path/hash, evidence directory, and `-Execute`. Preview validates/display hashes and makes zero secret-access calls. Execution reads the five target payload variables already in memory plus only the exact direct/legacy versions listed in the approved inventory, builds canonical JSON in memory, and pipes its UTF-8 bytes directly to age as `legacy-secrets.json.age`; no plaintext credential file is created. It records only secret IDs, numeric versions, archive hash/size, and rehearsal status. Clear payload/value variables in `finally`.

The private age identity is read from `DOC_AI_AGE_IDENTITY_FILE` only for rehearsal; its path/value is never written to evidence. Rehearsal decrypts into one resolved OS-temporary file, validates exact IDs/versions and nonempty payloads without printing values, and re-resolves/removes only that file in `finally`. Destruction is forbidden until `credential-recovery.json` and its archive checksum are accepted.

- [ ] **Step 5: Implement release-bound capacity publication**

`publish-capacity-snapshots.ps1` accepts release SHA, `runtime_actual` `CapacityEvidenceV2` path, evidence-index path, evidence directory, and `-Execute`. The index is either the provisional/final release manifest or `CapacityRefreshIndexV1`, and must contain the exact capacity path/hash. Preview validates and displays only safe hashes/identities and rejects `preflight_projection`. Execution requires `DOC_AI_CAPACITY_DATABASE_URL` and `DOC_AI_EXPECTED_CAPACITY_IDENTITIES_JSON`, sets `DATABASE_URL` only in the child-process environment, and runs:

~~~powershell
npm --prefix backend run capacity:import -- `
  --input $CapacityEvidencePath --manifest $EvidenceIndexPath
~~~

Set `DOC_AI_DEPLOYED_RELEASE_SHA` to the exact release for the child process, capture only release SHA/imported count, restore or remove every temporary environment variable in `finally`, and write checksummed `capacity-publication.json`. A rejected import writes no snapshot and leaves heavy admission closed.

`refresh-capacity-snapshots.ps1` is the ongoing capacity operator command. It invokes Plan 01's capacity audit with `-Mode Runtime`, validates `runtime_actual` `CapacityEvidenceV2`, writes a schema-valid `CapacityRefreshIndexV1`, then delegates to the publisher. When Artifact Registry is above 400 MiB, the command requires the reviewed pricing JSON plus explicit `-ApproveRecurringCost -ApprovedRecurringCostCapUsd`; it recomputes the estimate and blocks if unknown or above cap. The index contains only `schemaVersion`, release SHA, UTC creation time, capacity valid-until time, `status: "passed" | "blocked"`, and exactly one `{ path, sha256, kind: "capacity" }` artifact. It is preview-only without `-Execute`; execution is documented at least every four hours. Tests freeze time and prove a missed/failed refresh does not reuse or relabel stale evidence.

- [ ] **Step 6: Implement cutover orchestration through private deployment**

`invoke-cutover.ps1` requires `-ReleaseManifestPath` for private deployment and verifies its hash before mutation. Its phases:

1. resolve/display exact Worker environment, project, source region/resources, target region/resources, Neon branch identity hash, and evidence root;
2. require externally verified maintenance and origin-bypass denial;
3. stop heavy admission, drain jobs, and write checksummed quiescence;
4. create and rehearse database, object, and credential recovery sets;
5. copy/verify target objects;
6. review Terraform plan with no unexpected destroy;
7. inject secrets;
8. apply target Terraform only with `-ExecutePrivateDeploy`;
9. run direct-endpoint migrations/data import;
10. deploy immutable images and pass light readiness without heavy admission;
11. disable—but do not destroy—the short-lived direct and obsolete legacy secret versions, leaving exactly five active target bundle versions;
12. run `refresh-capacity-snapshots.ps1 -Execute` with the exact recurring-cost disposition, if any, to collect and publish fresh `runtime_actual` `CapacityEvidenceV2`;
13. run authenticated private heavy-work smoke backed by those fresh rows;
14. destroy short-lived/obsolete secret versions only after accepted migration, credential-recovery, and rollback evidence; and
15. stop before any other legacy deletion or public reopening.

Every phase is idempotent by evidence hash and refuses mismatched reruns.

- [ ] **Step 7: Implement exact legacy-retirement preview**

`retire-legacy-resources.ps1` resolves and lists:

- asia-southeast1 legacy Cloud Run services/jobs;
- exact Cloud SQL instance;
- three exact source buckets;
- legacy asia-southeast1 registry manifests;
- obsolete secret versions/containers.

Without `-ConfirmDestruction`, write preview only. With the switch, require accepted private deployment, restore, storage copy, rollback rehearsal, reopening approval, and—for source buckets—post-reopen observation approval. Delete no target matching `us-central1` or `-uc1-`.

- [ ] **Step 8: Rewrite runbooks and rollback boundaries**

Document:

- before reopen: maintenance, previous compatible image/revision, source DB only while quiescent;
- after reopen: image rollback only when Neon schema-compatible, otherwise maintenance;
- never write both databases;
- never reverse new Neon writes into Cloud SQL;
- source buckets remain until public observation approval;
- exactly what each destructive action removes and which encrypted assets recover it.

- [ ] **Step 9: Run and commit**

Run:

~~~powershell
Invoke-Pester -Path @('ops/tests/StorageMigration.Tests.ps1','ops/tests/CutoverSafety.Tests.ps1','ops/tests/CapacityPublication.Tests.ps1','ops/tests/GcpRunbooks.Tests.ps1') -Output Detailed
pwsh -NoProfile -File ops/verify-all.ps1
git diff --check
~~~

Expected: all tests/verification pass; no production mutation occurs.

Commit:

~~~powershell
git add -- ops/gcp/copy-storage-region.ps1 ops/gcp/archive-storage-versions.ps1 ops/gcp/archive-secret-versions.ps1 ops/gcp/verify-storage-copy.ps1 ops/gcp/publish-capacity-snapshots.ps1 ops/gcp/refresh-capacity-snapshots.ps1 ops/gcp/invoke-cutover.ps1 ops/gcp/retire-legacy-resources.ps1 ops/schemas/capacity-refresh-index.schema.json ops/tests/StorageMigration.Tests.ps1 ops/tests/CutoverSafety.Tests.ps1 ops/tests/CapacityPublication.Tests.ps1 ops/gcp/export-and-shutdown.ps1 ops/gcp/rollback.ps1 docs/operations/gcp-production-runbook.md docs/operations/gcp-rollback.md
git commit -m "ops: add evidence-gated regional cutover tooling"
~~~

## Plan 05 Exit Gate

Run the master Plan Task 5 offline gate. Then generate a real authenticated Terraform plan without applying it and require:

- only us-central1 target creates/updates;
- legacy resources are forgotten with `destroy = false`, not deleted;
- no Cloud SQL resource or volume;
- exactly one public Cloud Run binding;
- exact queue/service limits;
- exact three target buckets and five bundle secret IDs;
- no secret payload in plan JSON;
- no `latest` image tag;
- no unexpected destroy action.

Store the plan binary, JSON, human summary, and SHA-256 under `04-private-deploy/` for Plan 06.
