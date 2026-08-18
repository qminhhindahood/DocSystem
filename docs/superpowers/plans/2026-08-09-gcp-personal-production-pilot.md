# Google Cloud Personal Production Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the reconciled DocAI source to a private GitHub repository and deploy a secure personal production pilot to Google Cloud project `project-96fe5a5e-a0df-4a2f-902`.

**Architecture:** A public Next.js Cloud Run service acts as the only browser entry point and invokes a private Express backend with a Google-signed ID token. The backend invokes private Docling, Jina embeddings proxy, and renderer services, stores durable data in Cloud SQL PostgreSQL 15 plus three regional Cloud Storage mounts, and uses Upstash Redis only for transient coordination. Terraform owns Google Cloud resources; GitHub Actions uses Workload Identity Federation, immutable image tags, migration/bootstrap jobs, tagged smoke tests, and traffic promotion.

**Tech Stack:** Git/GitHub, GitHub Actions OIDC, Terraform Google provider, Google Cloud Run v2, Cloud SQL PostgreSQL 15 with pgvector, Artifact Registry, Cloud Storage, Secret Manager, Cloud Monitoring, Node.js 22, Next.js 16, Express/TypeScript, Prisma 5, Python 3.11, .NET 10, Docker.

## Global Constraints

- Production source repository: private GitHub repository `DocAI`; GitLab remains an archive and is not overwritten.
- Google Cloud project: `project-96fe5a5e-a0df-4a2f-902`; default region: `asia-southeast1`.
- Only `docai-frontend` is unauthenticated; every other Cloud Run service requires IAM invocation.
- `docai-backend` uses min/max instances `1/1`, instance-based CPU, and concurrency `20` while its polling workers remain in-process.
- Docling and renderer use concurrency `1`, max instances `1`, and scale to zero.
- Cloud SQL is PostgreSQL 15, single-zone `db-g1-small`, 10 GiB SSD, automatic storage growth disabled, daily backups, PITR, and seven retained backups.
- No service-account JSON key, production `.env`, bootstrap password, database URL, or runtime API key may enter Git or GitHub secrets when WIF or Secret Manager applies.
- Images use immutable Git commit SHA tags; application containers never run migrations during startup.
- Public registration remains disabled; operator creation is an audited, idempotent Cloud Run Job.
- Maximum-instance settings are the primary workload cost guard; budget alerts are informational and never shut down active work automatically.
- Implementation uses red-green TDD for behavior changes and evidence-based verification before commits, traffic promotion, or completion claims.
- No subagents are used because repository instructions require explicit user authorization and none was given.

---

### Task 1: Reconcile the working tree and establish private GitHub source control

**Files:**
- Modify: `.gitignore`
- Modify: `docs/superpowers/specs/2026-08-09-gcp-personal-production-pilot-design.md`
- Create: `docs/superpowers/plans/2026-08-09-gcp-personal-production-pilot.md`

**Interfaces:**
- Consumes: current branch `fix/code-review-findings`, GitLab `origin/master`, current tracked and untracked working files.
- Produces: a verified reconciled snapshot, archived GitLab history, a new root commit on local `master`, GitLab archive remote named `gitlab`, private GitHub `origin` pointing to `DocAI`, and a clean pushed baseline.

- [ ] **Step 1: Add repository-only artifact exclusions**

Add these exact root-relative patterns while retaining all existing ignore rules:

```gitignore
/docs/generated-templates/
/docs/rag-results/
/docs/templates-gemini/
/frontend/.artifacts/
```

- [ ] **Step 2: Verify no intended source files are hidden**

Run:

```powershell
git status --short
git check-ignore -v .env docs/templates-gemini/manifest.json frontend/.artifacts
git ls-files | rg '(^|/)(\.env$|.*\.pem$|.*\.key$|service-account.*\.json$)'
```

Expected: `.env` and generated/reference artifacts are ignored; no real `.env`, private key, or service-account JSON file is tracked.

- [ ] **Step 3: Scan the snapshot and history for credentials**

Run:

```powershell
git add -A
$scanRoot = Join-Path $env:TEMP ("docai-gitleaks-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scanRoot | Out-Null
git checkout-index --all --prefix="$scanRoot\"
docker run --rm -v "${scanRoot}:/repo" zricethezav/gitleaks:v8.24.3 dir /repo --redact --no-banner
Remove-Item -LiteralPath $scanRoot -Recurse -Force
```

Expected: exit `0`. The GitLab history contains legacy `.env` secrets and must not be pushed to GitHub; all future production values are newly generated. Any finding in the staged snapshot must be removed or explicitly marked as a deterministic test placeholder before continuing.

- [ ] **Step 4: Preserve and commit the intended working state**

Run:

```powershell
git add -A
git diff --cached --check
git status --short
git commit -m "chore: consolidate DocAI production baseline"
git branch codex/pre-github-backup-20260809
```

Expected: every intended source/test/doc change is committed; ignored generated/reference data remains local; the backup branch points to the consolidation commit.

- [ ] **Step 5: Reconcile the latest GitLab master**

Run:

```powershell
git fetch origin master
git merge --no-ff origin/master -m "merge: reconcile GitLab master before GitHub migration"
```

Resolve conflicts by retaining the current production-hardening behavior while incorporating the four remote-only commits. Run `git diff --check` after resolving and commit the merge. Preserve the reconciled history locally with `git branch codex/gitlab-history-reconciled`.

- [ ] **Step 6: Verify the reconciled source**

Run:

```powershell
pwsh -NoProfile -File ops/verify-all.ps1
git status --short
```

Expected: verifier prints `All verification steps passed.` and the working tree is clean.

- [ ] **Step 7: Create a secret-free root commit and private GitHub repository**

Run:

```powershell
git branch codex/gitlab-history-master master
$tree = git rev-parse 'HEAD^{tree}'
$rootCommit = "chore: establish DocAI production baseline`n" | git commit-tree $tree
git branch -f master $rootCommit
git switch master
winget install --id GitHub.cli --exact --source winget --accept-package-agreements --accept-source-agreements
gh auth login --hostname github.com --git-protocol https --web
git remote rename origin gitlab
gh repo create DocAI --private --source . --remote origin
git push --set-upstream origin master
```

Expected: `origin` is the new private GitHub repository, `gitlab` is unchanged, GitHub receives only the new root commit, and GitHub `master` matches local `master`.

- [ ] **Step 8: Verify the remote without exposing it publicly**

Run:

```powershell
gh repo view --json nameWithOwner,visibility,defaultBranchRef,url
git ls-remote --heads origin master
```

Expected: repository name is `DocAI`, visibility is `PRIVATE`, default branch is `master`, and the remote SHA equals `git rev-parse master`.

---

### Task 2: Add Google-signed service-to-service identity

**Files:**
- Create: `frontend/lib/server/cloud-run-auth.ts`
- Create: `frontend/test/cloud-run-auth.test.ts`
- Modify: `frontend/lib/server/backend.ts`
- Modify: `frontend/app/api/proxy/[...path]/route.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `backend/src/utils/cloud_run_auth.ts`
- Create: `backend/src/utils/cloud_run_auth.test.ts`
- Modify: `backend/src/utils/embeddings_client.ts`
- Modify: `backend/src/services/ingestion_service.ts`
- Modify: `backend/src/services/rag_service.ts`
- Modify: `backend/src/services/readiness_service.ts`
- Modify: `backend/src/services/template_service_client.ts`
- Modify: `backend/src/services/template_generation_service.ts`
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`

**Interfaces:**
- Consumes: `BACKEND_API_URL`, `DOCLING_URL`, `EMBEDDINGS_URL`, `DOCUMENT_RENDERER_URL`, and Application Default Credentials on Cloud Run.
- Produces: `getCloudRunAuthorization(targetUrl: string): Promise<Record<string,string>>`, returning `{}` locally and `{ 'X-Serverless-Authorization': 'Bearer <id-token>' }` when `K_SERVICE` is set.

- [ ] **Step 1: Write frontend identity tests**

Test these exact cases in `frontend/test/cloud-run-auth.test.ts`:

```ts
it('returns no platform header outside Cloud Run', async () => {
  delete process.env.K_SERVICE;
  await expect(getCloudRunAuthorization('http://localhost:3001')).resolves.toEqual({});
});

it('uses the backend origin as the ID-token audience on Cloud Run', async () => {
  process.env.K_SERVICE = 'docai-frontend';
  mockFetchIdToken.mockResolvedValue('signed-token');
  await expect(getCloudRunAuthorization('https://backend.run.app/api/health')).resolves.toEqual({
    'X-Serverless-Authorization': 'Bearer signed-token',
  });
  expect(mockGetIdTokenClient).toHaveBeenCalledWith('https://backend.run.app');
});
```

- [ ] **Step 2: Run the frontend test and observe failure**

Run: `npm --prefix frontend test -- --run test/cloud-run-auth.test.ts`

Expected: FAIL because `cloud-run-auth.ts` does not exist.

- [ ] **Step 3: Implement and wire frontend identity**

Install `google-auth-library` and implement:

```ts
export async function getCloudRunAuthorization(targetUrl: string): Promise<Record<string, string>> {
  if (!process.env.K_SERVICE) return {};
  const audience = new URL(targetUrl).origin;
  const client = await new GoogleAuth().getIdTokenClient(audience);
  const token = await client.idTokenProvider.fetchIdToken(audience);
  return { 'X-Serverless-Authorization': `Bearer ${token}` };
}
```

Merge this header into both `forwardToBackend` and the streaming proxy handler without replacing the user's application `Authorization: Bearer <session>` header.

- [ ] **Step 4: Write backend identity and caller tests**

Assert local no-op, Cloud Run audience derivation, header caching through `google-auth-library`, and presence of the platform header on Docling, embeddings, renderer, and readiness calls. The renderer request must contain both `X-Serverless-Authorization` and `x-renderer-token`.

- [ ] **Step 5: Run backend identity tests and observe failure**

Run:

```powershell
npm --prefix backend test -- --runInBand src/utils/cloud_run_auth.test.ts src/utils/embeddings_client.test.ts src/services/readiness_service.test.ts
```

Expected: FAIL because private service callers do not yet inject Google identity.

- [ ] **Step 6: Implement and wire backend identity**

Install `google-auth-library`; add the same exported interface to `backend/src/utils/cloud_run_auth.ts`; await the header immediately before each internal request. Preserve caller-specific content headers, timeouts, cancellation, and renderer defense-in-depth token.

- [ ] **Step 7: Verify and commit service identity**

Run:

```powershell
npm --prefix frontend test -- --run test/cloud-run-auth.test.ts test/proxy-route.test.ts test/session-routes.test.ts
npm --prefix frontend run build
npm --prefix backend test -- --runInBand src/utils/cloud_run_auth.test.ts src/utils/embeddings_client.test.ts src/services/readiness_service.test.ts src/services/ingestion_service.test.ts src/services/rag_service.test.ts
npm --prefix backend run build
git add frontend backend
git commit -m "feat: authenticate private Cloud Run service calls"
git push origin master
```

---

### Task 3: Separate application startup, migration, and operator bootstrap

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `backend/package.json`
- Modify: `backend/scripts/deploy_fresh_database.ts`
- Modify: `backend/scripts/deploy_fresh_database.test.ts`
- Create: `backend/src/scripts/bootstrap_user.ts`
- Create: `backend/src/scripts/bootstrap_user.test.ts`
- Modify: `backend/src/utils/validateEnv.ts`
- Modify: `backend/src/utils/validateEnv.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL`, `BOOTSTRAP_USERNAME`, `BOOTSTRAP_EMAIL`, and `BOOTSTRAP_PASSWORD` supplied to one-shot Cloud Run Jobs.
- Produces: normal container command `node dist/index.js`; migration command `node dist/scripts/prepare_database.js && npx prisma migrate deploy && node dist/scripts/assert_owner_integrity.js`; idempotent bootstrap command `node dist/scripts/bootstrap_user.js`.

- [ ] **Step 1: Write failing bootstrap tests**

Test that bootstrap validates the same username/email/password rules as registration, stores lowercase email, uses `hashPassword`, creates exactly one user, exits successfully when the matching username/email already identify the same user, and fails on conflicting identities. Spy on logging and assert no password value is emitted.

- [ ] **Step 2: Verify bootstrap tests fail**

Run: `npm --prefix backend test -- --runInBand src/scripts/bootstrap_user.test.ts`

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement bootstrap and lifecycle commands**

Add package scripts:

```json
"start": "node dist/index.js",
"deploy:migrate": "node dist/scripts/prepare_database.js && prisma migrate deploy && node dist/scripts/assert_owner_integrity.js",
"deploy:bootstrap": "node dist/scripts/bootstrap_user.js"
```

Change the Docker runtime command to `CMD ["node", "dist/index.js"]`. Copy the Prisma CLI from production dependencies instead of globally installing a mismatched version.

- [ ] **Step 4: Extend repository contracts**

Update lifecycle tests to assert the backend image command contains no `migrate`, `prepare_database`, or shell chain; assert the migration command orders pgvector preflight, Prisma deployment, and ownership integrity.

- [ ] **Step 5: Verify and commit lifecycle separation**

Run:

```powershell
npm --prefix backend test -- --runInBand src/scripts/bootstrap_user.test.ts scripts/deploy_fresh_database.test.ts scripts/check_migration_integrity.test.ts
npm --prefix backend run build
docker build -t docai-backend:lifecycle backend
docker inspect docai-backend:lifecycle --format '{{json .Config.Cmd}}'
git add backend
git commit -m "feat: separate runtime migration and bootstrap jobs"
git push origin master
```

Expected image command: `["node","dist/index.js"]`.

---

### Task 4: Implement password reset and login-first authentication

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260809000000_add_password_recovery/migration.sql`
- Create: `backend/src/services/password_reset_service.ts`
- Create: `backend/src/services/password_reset_service.test.ts`
- Create: `backend/src/services/password_reset_mailer.ts`
- Create: `backend/src/services/password_reset_mailer.test.ts`
- Modify: `backend/src/routes/auth.ts`
- Modify: `backend/src/routes/auth.contract.test.ts`
- Modify: `backend/src/middleware/user_auth.ts`
- Modify: `backend/src/middleware/user_auth_security.test.ts`
- Modify: `backend/src/middleware/ratelimit.ts`
- Modify: `backend/src/utils/validateEnv.ts`
- Modify: `backend/.env.example`
- Modify: `frontend/components/auth/AuthForm.tsx`
- Create: `frontend/components/auth/ForgotPasswordForm.tsx`
- Create: `frontend/components/auth/ResetPasswordForm.tsx`
- Create: `frontend/app/(auth)/forgot-password/page.tsx`
- Create: `frontend/app/(auth)/reset-password/page.tsx`
- Create: `frontend/app/api/session/forgot-password/route.ts`
- Create: `frontend/app/api/session/reset-password/route.ts`
- Modify: `frontend/app/api/session/signup/route.ts`
- Modify: `frontend/lib/auth.ts`
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/test/auth-pages.test.tsx`
- Modify: `frontend/test/session-routes.test.ts`

**Interfaces:**
- Consumes: the approved password-reset design, SMTP configuration, and `PASSWORD_RESET_BASE_URL`.
- Produces: required registration email; enumeration-safe `POST /api/auth/forgot-password`; one-time `POST /api/auth/reset-password`; session-version revocation; `/forgot-password` and `/reset-password` UI.

- [ ] **Step 1: Add the additive schema test and migration**

The schema must contain exactly:

```prisma
email          String? @unique
sessionVersion Int     @default(0)
resetTokens    PasswordResetToken[]
```

and `PasswordResetToken` with unique `tokenHash`, `expiresAt`, nullable `usedAt`, cascade deletion, `[userId, createdAt]`, and `[expiresAt]` indexes. Run `npm --prefix backend run test:migrations` first to see the missing-contract failure, then add the migration.

- [ ] **Step 2: Write password-reset service tests**

Cover SHA-256-only token storage, 32-byte base64url raw tokens, 30-minute expiry, 60-second cooldown, invalidation of older tokens, identical public results for missing/disabled/email-null users, SMTP failure invalidation, single successful concurrent claim, password hash change, and `sessionVersion` increment.

- [ ] **Step 3: Implement backend recovery behavior**

Use a transaction that atomically claims `usedAt: null` and `expiresAt > now`, updates `passwordHash`, increments `sessionVersion`, and marks all user tokens used. Add forgot limit `5/15m` and reset limit `10/15m`. The forgot route always returns HTTP `202` with:

```json
{"success":true,"message":"Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi."}
```

- [ ] **Step 4: Implement SMTP and environment validation**

Add `nodemailer`; require valid `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and HTTPS `PASSWORD_RESET_BASE_URL` in production. Require `SMTP_USER` and `SMTP_PASS` together. Redact email, token, reset URL, password, and SMTP credentials from errors.

- [ ] **Step 5: Add session-version tests and implementation**

JWTs must carry `sessionVersion`; verification must load the user and compare the claim. Treat a missing legacy claim as `0`, so it becomes invalid after the first reset.

- [ ] **Step 6: Write and implement frontend recovery tests**

Assert required normalized signup email, login-first landing CTAs, forgot link ordering, enumeration-safe persistent success, missing/invalid reset token state, matching-password validation, same-origin proxy enforcement, backend-error redaction, and session-cookie expiry after success.

- [ ] **Step 7: Verify and commit password recovery**

Run:

```powershell
npm --prefix backend test -- --runInBand src/services/password_reset_service.test.ts src/services/password_reset_mailer.test.ts src/routes/auth.contract.test.ts src/middleware/user_auth_security.test.ts scripts/check_migration_integrity.test.ts
npm --prefix backend run build
npm --prefix frontend test -- --run test/auth-pages.test.tsx test/session-routes.test.ts test/landing-page.test.tsx
npm --prefix frontend run lint
npm --prefix frontend run build
git add backend frontend
git commit -m "feat: add secure password recovery"
git push origin master
```

---

### Task 5: Add production logging and complete readiness contracts

**Files:**
- Create: `backend/src/utils/logger.ts`
- Create: `backend/src/utils/logger.test.ts`
- Create: `backend/src/middleware/request_logging.ts`
- Create: `backend/src/middleware/request_logging.test.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/src/services/readiness_service.ts`
- Modify: `backend/src/services/readiness_service.test.ts`
- Create: `frontend/app/api/live/route.ts`
- Create: `frontend/app/api/ready/route.ts`
- Create: `frontend/test/health-routes.test.ts`

**Interfaces:**
- Consumes: request IDs, `K_SERVICE`, `K_REVISION`, database/Redis/storage/service probes.
- Produces: redacted Pino JSON request logs; process-only `/live`; complete dependency `/ready`; public frontend health endpoints suitable for Cloud Run probes and uptime checks.

- [ ] **Step 1: Write failing log-redaction and request-log tests**

Assert JSON fields `timestamp`, `severity`, `service`, `revision`, `requestId`, `route`, `status`, and `duration`; assert cookies, authorization headers, passwords, reset tokens, API keys, document bodies, and raw upstream payloads never appear.

- [ ] **Step 2: Implement logger and replace startup console output**

Configure Pino redact paths for `req.headers.authorization`, `req.headers.cookie`, `password`, `passwordConfirmation`, `token`, `apiKey`, `smtpPass`, and nested equivalents. Hash authenticated user IDs with a process-stable SHA-256 digest before logging.

- [ ] **Step 3: Separate `/live` and `/ready` semantics**

Keep `/live` process-only and return `503` from `/ready` when any configured dependency, worker, Redis, or writable mount is unavailable. Internal readiness requests must carry Cloud Run identity from Task 2.

- [ ] **Step 4: Add frontend health routes**

`/api/live` returns process status without calling the backend. `/api/ready` invokes backend `/ready` through `forwardToBackend` and maps non-2xx/unreachable results to `503` without returning backend addresses or credentials.

- [ ] **Step 5: Verify and commit observability behavior**

Run:

```powershell
npm --prefix backend test -- --runInBand src/utils/logger.test.ts src/middleware/request_logging.test.ts src/services/readiness_service.test.ts src/index.health_wiring.test.ts
npm --prefix frontend test -- --run test/health-routes.test.ts
npm --prefix backend run build
npm --prefix frontend run build
git add backend frontend
git commit -m "feat: add structured logs and production readiness"
git push origin master
```

---

### Task 6: Define Google Cloud infrastructure in Terraform

**Files:**
- Create: `infra/terraform/versions.tf`
- Create: `infra/terraform/providers.tf`
- Create: `infra/terraform/variables.tf`
- Create: `infra/terraform/apis.tf`
- Create: `infra/terraform/artifact_registry.tf`
- Create: `infra/terraform/storage.tf`
- Create: `infra/terraform/sql.tf`
- Create: `infra/terraform/secrets.tf`
- Create: `infra/terraform/iam.tf`
- Create: `infra/terraform/cloud_run.tf`
- Create: `infra/terraform/monitoring.tf`
- Create: `infra/terraform/budgets.tf`
- Create: `infra/terraform/outputs.tf`
- Create: `infra/terraform/prod.tfvars.example`
- Create: `ops/tests/TerraformPlan.Tests.ps1`
- Modify: `ops/verify-all.ps1`

**Interfaces:**
- Consumes: project ID, GitHub owner/repository, billing account ID, notification email/channel IDs, immutable image tags, Secret Manager versions, and externally created Upstash/SMTP values.
- Produces: Artifact Registry, three buckets and mounts, Cloud SQL, service accounts/IAM/WIF, five Cloud Run services, migration/bootstrap jobs, monitoring/alerts/dashboard, budgets, and deployment outputs.

- [ ] **Step 1: Install and pin Terraform tooling**

Run:

```powershell
winget install --id Hashicorp.Terraform --exact --source winget --accept-package-agreements --accept-source-agreements
terraform version
```

Declare Terraform `>= 1.8, < 2.0`, Google provider `~> 7.0`, Google-beta provider `~> 7.0`, and Random provider `~> 3.6`; commit `.terraform.lock.hcl` after initialization.

- [ ] **Step 2: Write failing rendered-plan assertions**

`TerraformPlan.Tests.ps1` must parse `terraform show -json tfplan` and assert region, public/private IAM, service accounts, min/max instances, CPU allocation, concurrency, timeouts, probes, secret versions, Cloud SQL attachment, GCS mounts, immutable non-`latest` image tags, database backup/PITR/storage settings, bucket versioning/lifecycle, WIF branch/repository restrictions, and four budget thresholds.

- [ ] **Step 3: Define foundational APIs and storage**

Enable Service Usage, IAM, IAM Credentials, STS, Artifact Registry, Cloud Run, Cloud SQL Admin, Secret Manager, Cloud Monitoring, Cloud Logging, Cloud Storage, Cloud Resource Manager, and Cloud Billing Budget APIs. Create `docai` Docker repository and buckets `docai-templates-${project_id}`, `docai-uploads-${project_id}`, and `docai-rag-state-${project_id}` with uniform access, public-access prevention, regional placement, versioning/retention rules from the spec.

- [ ] **Step 4: Define Cloud SQL and secrets**

Create PostgreSQL 15 `db-g1-small`, 10 GiB `PD_SSD`, disk autoresize `false`, deletion protection `true`, daily backups, PITR, seven retained backups, and a random database password stored as a Secret Manager version. Define secret containers for all runtime secrets but never place user-provided secret values in Terraform state; those versions are added with `gcloud secrets versions add` during bootstrap.

- [ ] **Step 5: Define least-privilege identities and WIF**

Create frontend, backend, renderer, migration, and deployer service accounts. Grant invoker roles per service, scoped bucket roles, Cloud SQL client, and secret accessor only to consuming identities. Create GitHub OIDC pool/provider restricted to the exact `owner/DocAI` repository and `refs/heads/master`; allow the deployer identity no runtime-secret read.

- [ ] **Step 6: Define Cloud Run services and jobs**

Use `google_cloud_run_v2_service` and `google_cloud_run_v2_job`; configure resources and scaling exactly from the design. Mount buckets at `/data/templates`, `/data/uploads`, and `/data/rag-state`; set the existing container UID/GID mount options; attach Cloud SQL; reference explicit secret versions; use startup/liveness probes; set backend `cpu_idle = false`; keep processing services request billed and scale-to-zero.

- [ ] **Step 7: Define monitoring and budgets**

Create frontend uptime check, notification channels supplied by variable, log/metric alerts for 5xx, latency, unhealthy readiness, workers, saturation, SQL CPU/storage/connections, failed deployment/migration, a release dashboard, and budget thresholds `$50`, `$150`, `$225`, `$275` against billing account `01CC42-D509AB-1F4CB9`.

- [ ] **Step 8: Validate a non-mutating plan and commit**

Run:

```powershell
terraform -chdir=infra/terraform fmt -recursive -check
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform plan -refresh=false -out=tfplan -var-file=prod.tfvars
pwsh -NoProfile -File ops/tests/TerraformPlan.Tests.ps1 -PlanPath infra/terraform/tfplan
git add infra/terraform ops
git commit -m "feat: define DocAI Google Cloud infrastructure"
git push origin master
```

Expected: formatting, validation, and every rendered-plan invariant pass. `prod.tfvars` and `tfplan` remain ignored.

---

### Task 7: Add immutable GitHub CI and production delivery

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy-production.yml`
- Create: `.github/dependabot.yml`
- Create: `ops/gcp/smoke-production.ps1`
- Create: `ops/gcp/promote-traffic.ps1`
- Create: `ops/gcp/rollback.ps1`
- Create: `ops/tests/GitHubWorkflow.Tests.ps1`
- Modify: `ops/verify-all.ps1`

**Interfaces:**
- Consumes: GitHub OIDC provider/deployer service account outputs, Artifact Registry, Terraform plan artifact, commit SHA images, Secret Manager, Cloud Run revision tags.
- Produces: mutation-free PR checks and ordered protected-`master` production deployment with migration gate, authenticated smoke evidence, promotion, and rollback.

- [ ] **Step 1: Write failing workflow contract tests**

Parse workflow YAML and assert PR jobs for backend/frontend/renderer/Python/Terraform/container scans/repository contracts; production `permissions: id-token: write, contents: read`; no JSON key secret; `${{ github.sha }}` image tags; Terraform plan/apply artifact; migration before deploy; no-traffic revision tags; authenticated smoke before promotion; workflow summary evidence.

- [ ] **Step 2: Implement pull-request verification**

Use pinned major action versions, dependency caching, `ops/verify-all.ps1`, Terraform fmt/validate, Docker Buildx, and Trivy severity `CRITICAL,HIGH` with failure on unfixed findings. Do not authenticate to GCP in PR workflows.

- [ ] **Step 3: Implement production deployment ordering**

Authenticate with `google-github-actions/auth`, configure Docker, build changed service images under `${{ github.sha }}`, create/review/apply Terraform plan, execute `docai-migrate`, deploy private processors, deploy backend/frontend without traffic, run smoke tests on tags, then promote 100% traffic.

- [ ] **Step 4: Implement smoke and rollback scripts**

Smoke must verify frontend live/ready, private-service unauthenticated `403`, operator login, settings, templates, fixture upload/ingestion/render/download, SSE completion, and cleanup. Rollback selects the previous compatible frontend/backend revisions, restores traffic, and reruns smoke checks without reverting migration history.

- [ ] **Step 5: Verify and commit CI/CD**

Run:

```powershell
pwsh -NoProfile -File ops/tests/GitHubWorkflow.Tests.ps1
pwsh -NoProfile -File ops/verify-all.ps1
git add .github ops
git commit -m "ci: add keyless Google Cloud production delivery"
git push origin master
```

---

### Task 8: Add recovery, cost, and launch runbooks

**Files:**
- Create: `docs/operations/gcp-production-runbook.md`
- Create: `docs/operations/gcp-restore-drill.md`
- Create: `docs/operations/gcp-rollback.md`
- Create: `docs/operations/gcp-october-exit.md`
- Create: `ops/gcp/create-predeploy-backup.ps1`
- Create: `ops/gcp/restore-drill.ps1`
- Create: `ops/gcp/export-and-shutdown.ps1`
- Create: `ops/tests/GcpRunbooks.Tests.ps1`

**Interfaces:**
- Consumes: Terraform outputs, deployed revision metadata, Cloud SQL backup IDs, bucket inventories, release SHA.
- Produces: reproducible backup/restore, rollback, budget response, and October exit evidence without embedding data or secrets.

- [ ] **Step 1: Write failing runbook contract tests**

Assert exact RTO/RPO, pre-migration backup, restore-to-new-instance rule, no Prisma history editing, versioned bucket inventory, encrypted key recovery, `$225` forecast response, September 15 decision, September 25 rehearsal, and default export/shutdown path.

- [ ] **Step 2: Implement idempotent operational scripts**

Scripts accept explicit `-ProjectId`, `-Region`, and named resource parameters; refuse empty/broad targets; display resources before deletion; require `-ConfirmShutdown` for the October shutdown path; never print secret values or database contents.

- [ ] **Step 3: Verify and commit operations**

Run:

```powershell
pwsh -NoProfile -File ops/tests/GcpRunbooks.Tests.ps1
git add docs/operations ops
git commit -m "docs: add GCP recovery and exit operations"
git push origin master
```

---

### Task 9: Provision, deploy, and prove the personal production pilot

**Files:**
- Runtime-only, ignored: `infra/terraform/prod.tfvars`
- Runtime-only, ignored: `.artifacts/releases/<git-sha>/`
- No committed credential files.

**Interfaces:**
- Consumes: authenticated Google account, authenticated GitHub account, Upstash `rediss://` URL, Jina API key, SMTP relay values, operator username/email/password, and recovery copy of the LLM encryption key.
- Produces: live production URL, private internal services, release record, restore evidence, rollback evidence, and disabled bootstrap password version.

- [ ] **Step 1: Enable APIs and create Terraform state storage**

Enable required APIs with `gcloud services enable`; create a versioned regional state bucket with uniform access and public-access prevention; migrate Terraform from local initialization to the GCS backend. Record bucket name but no credentials.

- [ ] **Step 2: Apply foundational infrastructure**

Create a reviewed `terraform plan`, save its JSON and human-readable output under the ignored release artifact directory, apply the exact plan, and record Terraform outputs. Stop if any rendered invariant differs from Task 6.

- [ ] **Step 3: Add external runtime secret versions**

Generate JWT, renderer, database, and LLM encryption values locally with cryptographic randomness; add all runtime values through stdin to Secret Manager; add Upstash/Jina/SMTP/operator bootstrap values; verify versions exist without printing payloads. Save the LLM encryption key in the user's encrypted offline recovery location before deployment.

- [ ] **Step 4: Configure GitHub production controls**

Add only non-secret repository variables for project, region, WIF provider, deployer account, and Terraform state bucket. Protect `master` with required CI and deployment environment review. Verify no service-account JSON or runtime secret exists in GitHub Actions configuration.

- [ ] **Step 5: Trigger the immutable deployment**

Run the production workflow for the current `master` SHA. Monitor build, scan, Terraform, migration, processor deployment, no-traffic revisions, authenticated smoke, and promotion. A failure stops before production traffic and retains evidence.

- [ ] **Step 6: Bootstrap and verify the operator**

Execute `docai-bootstrap-user`; rerun to prove idempotency; verify login and password reset; disable the bootstrap-password secret version after successful login. Do not delete the secret container so audit metadata remains.

- [ ] **Step 7: Perform security and workload acceptance**

Verify frontend HTTPS reachability; unauthenticated backend/processor calls return `403`; two concurrent documents complete; upload, ingestion, template compilation, generation, rendering, download, Q&A, SSE, settings, logout, and reset work; remove smoke data afterward.

- [ ] **Step 8: Perform restore and rollback rehearsals**

Restore the latest backup into a disposable Cloud SQL instance, verify migrations/ownership/representative metadata, delete the disposable instance after capturing data-free evidence, roll frontend/backend traffic to previous compatible revisions, smoke, then return to the release revisions and smoke again.

- [ ] **Step 9: Verify monitoring, budgets, and final release evidence**

Trigger test notifications; confirm dashboard data, uptime, 5xx/latency/readiness/worker/SQL alerts, and `$50/$150/$225/$275` budgets. Record image digests, revisions, migration IDs, smoke output, restore/rollback results, current spend/forecast, and September gates in the GitHub workflow summary and ignored release artifact directory.

- [ ] **Step 10: Run the final verification gate**

Run:

```powershell
pwsh -NoProfile -File ops/verify-all.ps1 -IncludeCutoverRehearsal -IncludeRendererContainer
docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:v8.24.3 detect --source=/repo --redact --no-banner
git status --short
git rev-parse HEAD
git ls-remote origin refs/heads/master
```

Expected: full verifier and secret scan pass, local tree is clean, local and GitHub `master` SHAs match, production smoke/restore/rollback evidence is complete, and forecast spend remains below `$225`.
