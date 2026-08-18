# DocAI Google Cloud production runbook

## Service objective and ownership

This personal production pilot has an RTO of 4 hours and an RPO of 24 hours. Point-in-time recovery may provide a smaller loss window, but 24 hours is the committed recovery objective. The operator owns deployment approval, incident response, recovery evidence, budget response, and the October exit gate.

Production is `project-96fe5a5e-a0df-4a2f-902` in `asia-southeast1`. Only `docai-frontend` is public. Backend, Docling, embeddings, and renderer must return HTTP 403 when called without Google identity.

## Normal release

The single-operator phase has no SMTP or domain requirement. Email recovery remains intentionally disabled; the owner-only reset helper is the break-glass path.

1. Require green CI on protected `master`; do not bypass tests, audits, image scans, or Terraform validation.
2. Confirm the three operator bootstrap secrets are present with enabled numeric versions. Verify metadata only and never read their payloads into a terminal log.
3. Require the disabled recovery smoke to pass: both same-origin recovery endpoints must return HTTP 503 with `PASSWORD_RESET_DISABLED`.
4. Rehearse `ops/gcp/reset-production-password.ps1` only against disposable data before launch. Never run the live reset job as a deployment smoke action.
5. For a migration-bearing release, create a pre-deployment backup with `ops/gcp/create-predeploy-backup.ps1` and retain its metadata under the ignored release evidence directory.
6. The authenticated human operator reviews and applies the exact Terraform plan locally. GitHub cannot read Terraform state or apply IAM changes.
7. Approve the protected GitHub production environment only after Terraform pins the migration and reset jobs to the release SHA.
8. Run `docai-migrate`, deploy processors, and create no-traffic backend/frontend candidates.
9. Require authenticated fixture ingestion, rendering/download, Q&A SSE completion, and cleanup before promoting traffic.
10. Record commit, image digests, revision names, migration result, disabled recovery result, authenticated smoke result, and backup ID.

Never put service-account keys or runtime secret payloads in GitHub. GitHub deploys through branch-restricted Workload Identity Federation. Runtime values stay in Secret Manager.

## Health and incident triage

- `/live` proves only that the process is alive. `/ready` must be healthy before promotion.
- A 503 readiness response requires checking Cloud SQL, Redis, private processor identity, writable mounts, and worker state.
- Keep failed candidates at zero traffic. Use the rollback runbook for an unhealthy promoted revision.
- Do not edit Prisma migration history. Database recovery always restores a backup to a new instance, then verifies the restored state.

## Storage and recovery controls

- Cloud SQL has daily backups, PITR, seven retained backups, and a pre-migration backup gate.
- Templates and uploads use object versioning with 30-day noncurrent-version retention.
- Recovery and exit evidence includes an all versions bucket object inventory; it never embeds object contents.
- Maintain an encrypted offline recovery copy of the LLM encryption key. Verify that a usable copy exists without printing it. Losing this key makes saved per-user provider credentials unrecoverable.

## Budget response

Review billing forecast weekly and after load tests. A forecast above $225, or a daily run rate that consumes the trial before September 25, is over budget. Reduce warm capacity where safe, stop nonessential load tests, inspect Cloud SQL and backend fixed spend, and advance the paid/migrate/export decision. Budget alerts notify; they do not automatically stop production.

External Gemini, Jina, and Upstash paid usage are tracked separately from the Google Cloud trial.

## Zero-cost migration preflight

Plan 01 is fail-closed. Run it only from an uncaptured local PowerShell 7 session. Do not enter credentials into a terminal that records commands, transcripts, scrollback uploads, or remote support logs. Evidence belongs only under `.artifacts/releases/<release>/00-preflight`; the scripts reject paths outside that directory and scan textual evidence for secret-shaped material.

Set credentials interactively and remove them immediately after the run:

```powershell
function Read-SecretText([string] $Prompt) {
  Read-Host $Prompt -AsSecureString | ConvertFrom-SecureString -AsPlainText
}
$env:DOC_AI_SOURCE_DATABASE_URL = Read-SecretText 'Source direct TLS URL'
$env:DOC_AI_NEON_DIRECT_URL = Read-SecretText 'Disposable Neon direct TLS URL'
$env:DOC_AI_NEON_CANDIDATE_URLS_JSON = Read-SecretText 'Candidate region URL JSON'
$env:DOC_AI_BILLING_ACCOUNT_ID = Read-SecretText 'Billing account ID'
$env:DOC_AI_NEON_API_KEY = Read-SecretText 'Neon API key'
$env:DOC_AI_NEON_PROJECT_ID = Read-Host 'Neon project ID'
$env:DOC_AI_NEON_CU_USAGE_EXPORT_PATH = Read-Host 'Fresh Neon CU usage export path'
$env:DOC_AI_UPSTASH_EMAIL = Read-SecretText 'Upstash account email'
$env:DOC_AI_UPSTASH_API_KEY = Read-SecretText 'Upstash API key'
$env:DOC_AI_UPSTASH_DATABASE_ID = Read-Host 'Upstash database ID'
$env:DOC_AI_CLOUDFLARE_API_TOKEN = Read-SecretText 'Cloudflare analytics token'
$env:DOC_AI_CLOUDFLARE_ACCOUNT_TAG = Read-Host 'Cloudflare account tag'
$env:DOC_AI_CLOUDFLARE_SCRIPT_NAME = Read-Host 'Cloudflare Worker script name'
$MigrationPricingPath = Read-Host 'Reviewed migration-rate JSON path'
$env:DOC_AI_MIGRATION_PRICING_JSON = Get-Content -LiteralPath $MigrationPricingPath -Raw
$ArtifactRegistryPricingPath = Read-Host 'Reviewed Artifact Registry pricing JSON path'
$env:DOC_AI_ARTIFACT_REGISTRY_PRICING_JSON = Get-Content -LiteralPath $ArtifactRegistryPricingPath -Raw
$env:DOC_AI_AGE_RECIPIENT = Read-Host 'age public recipient'
$env:DOC_AI_AGE_IDENTITY_FILE = Read-SecretText 'age identity path'
$env:DOC_AI_QUIESCENCE_EVIDENCE_PATH = Read-Host 'Checksummed quiescence evidence path'
$ReleaseSha = (git rev-parse HEAD).Trim()
$Evidence = ".artifacts/releases/$ReleaseSha/00-preflight"
```

The Artifact Registry pricing input is a reviewed local JSON object containing `freeBytes`, `ratePerGiBMonth`, and `sourceSnapshotSha256`; the hash identifies the locally retained response body from the official Artifact Registry pricing page. Do not reuse it after the official source changes.

Pricing approval is deliberately two-pass. The first pass builds the conservative two-release image footprint and source-storage inventory before collecting the target capacity projection. It writes reviewable evidence but blocks:

```powershell
pwsh -NoProfile -File ops/gcp/benchmark-feasibility.ps1 `
  -ReleaseSha $ReleaseSha -EvidenceDirectory $Evidence
pwsh -NoProfile -File ops/gcp/inventory-storage.ps1 `
  -ProjectId 'project-96fe5a5e-a0df-4a2f-902' `
  -SourceRegion 'asia-southeast1' `
  -TemplatesBucket 'docai-templates-project-96fe5a5e-a0df-4a2f-902' `
  -UploadsBucket 'docai-uploads-project-96fe5a5e-a0df-4a2f-902' `
  -RagStateBucket 'docai-rag-state-project-96fe5a5e-a0df-4a2f-902' `
  -ReleaseSha $ReleaseSha -EvidenceDirectory $Evidence
pwsh -NoProfile -File ops/gcp/audit-migration-capacity.ps1 `
  -ProjectId 'project-96fe5a5e-a0df-4a2f-902' `
  -BillingAccountId $env:DOC_AI_BILLING_ACCOUNT_ID `
  -ReleaseSha $ReleaseSha -EvidenceDirectory $Evidence
```

Review every entry in `pricing-revalidation.json`, the `image-footprint.json` recurring estimate, and `legacy-transition-capacity.json`. Then approve only that exact pricing-revalidation file:

```powershell
Import-Module ./ops/lib/Evidence.psm1 -Force
$env:DOC_AI_PRICING_APPROVAL_SHA256 = Get-EvidenceSha256 `
  (Join-Path $Evidence 'pricing-revalidation.json')
pwsh -NoProfile -File ops/gcp/invoke-preflight.ps1 `
  -ProjectId 'project-96fe5a5e-a0df-4a2f-902' `
  -BillingAccountId $env:DOC_AI_BILLING_ACCOUNT_ID `
  -SourceRegion 'asia-southeast1' -TargetRegion 'us-central1' `
  -ReleaseSha $ReleaseSha -AgeRecipient $env:DOC_AI_AGE_RECIPIENT `
  -EvidenceDirectory $Evidence `
  -PricingApprovalSha256 $env:DOC_AI_PRICING_APPROVAL_SHA256 `
  -ExecuteRehearsal
```

If `image-footprint.json` reports a positive known monthly cost, stop and obtain explicit approval for a numeric monthly cap. Only then rerun the same command with `-ApproveRecurringCost -ApprovedRecurringCostCapUsd <approved-cap>`. If `migration-cost-estimate.json` is positive, separately obtain approval for that exact one-time amount and use `-ApproveNonZeroMigrationCost -ApprovedMigrationCostUsd <exact-estimate>`. Never infer either approval from a general instruction.

Exit `0` means schema-valid `GO`; exit `2` means reviewable `NO_GO`; exit `1` means a tool or configuration error. Stop on any missing/stale provider observation, progressive ratio at or above 70%, non-Artifact hard-limit overage, unknown or over-cap Artifact Registry cost, unpinned image base, failed Jina cold/warm gate, failed encrypted restore verification, unknown migration rate, or unapproved nonzero cost. A passed over-400-MiB Artifact Registry projection must say `zeroCostFeasible: false`; it is not a USD 0 result. Never proceed to Plan 02 without the user's acceptance of the exact `preflight-decision.json` and all referenced SHA-256 values.

Clear the session after collecting evidence:

```powershell
'DOC_AI_SOURCE_DATABASE_URL','DOC_AI_NEON_DIRECT_URL','DOC_AI_NEON_CANDIDATE_URLS_JSON',
'DOC_AI_BILLING_ACCOUNT_ID','DOC_AI_NEON_API_KEY','DOC_AI_NEON_PROJECT_ID',
'DOC_AI_NEON_CU_USAGE_EXPORT_PATH','DOC_AI_UPSTASH_EMAIL','DOC_AI_UPSTASH_API_KEY',
'DOC_AI_UPSTASH_DATABASE_ID','DOC_AI_CLOUDFLARE_API_TOKEN','DOC_AI_CLOUDFLARE_ACCOUNT_TAG',
'DOC_AI_CLOUDFLARE_SCRIPT_NAME','DOC_AI_MIGRATION_PRICING_JSON','DOC_AI_ARTIFACT_REGISTRY_PRICING_JSON',
'DOC_AI_AGE_RECIPIENT','DOC_AI_AGE_IDENTITY_FILE',
'DOC_AI_QUIESCENCE_EVIDENCE_PATH','DOC_AI_PRICING_APPROVAL_SHA256' |
  ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
```
