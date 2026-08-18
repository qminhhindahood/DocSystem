$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

function Assert-True([object]$Condition, [string]$Message) {
  if (-not [bool]$Condition) { throw "GCP runbook invariant failed: $Message" }
}

$documents = @(
  'docs/operations/gcp-production-runbook.md',
  'docs/operations/gcp-restore-drill.md',
  'docs/operations/gcp-rollback.md',
  'docs/operations/gcp-october-exit.md'
)
$scripts = @(
  'ops/gcp/create-predeploy-backup.ps1',
  'ops/gcp/restore-drill.ps1',
  'ops/gcp/export-and-shutdown.ps1',
  'ops/gcp/reset-production-password.ps1'
)
foreach ($path in $documents + $scripts) {
  Assert-True (Test-Path -LiteralPath (Join-Path $root $path)) "missing $path"
}

$docs = ($documents | ForEach-Object { Get-Content -LiteralPath (Join-Path $root $_) -Raw }) -join "`n"
Assert-True ($docs -match '(?i)RTO.{0,30}4 hours' -and $docs -match '(?i)RPO.{0,30}24 hours') 'RTO 4 hours and RPO 24 hours must be explicit'
Assert-True ($docs -match '(?i)pre-(deployment|migration) backup') 'a pre-migration backup gate is required'
Assert-True ($docs -match '(?i)restore.{0,80}new instance') 'database recovery must restore to a new instance'
Assert-True ($docs -match '(?i)(never|do not).{0,50}(edit|modify).{0,40}Prisma migration') 'Prisma migration history must never be edited during recovery'
Assert-True ($docs -match '(?i)(all versions|versioned).{0,50}(bucket|object).{0,30}inventory') 'versioned bucket inventory is required'
Assert-True ($docs -match '(?i)encrypted offline.{0,80}LLM encryption key') 'encrypted offline LLM key recovery must be verified'
Assert-True ($docs -match '\$225' -and $docs -match '(?i)forecast') 'the $225 forecast response threshold is required'
Assert-True ($docs -match 'September 15' -and $docs -match 'September 25') 'October exit decision and rehearsal dates are required'
Assert-True ($docs -match '(?i)default.{0,100}export.{0,100}shut ?down') 'the default no-decision path must export and shut down'

foreach ($path in $scripts) {
  $raw = Get-Content -LiteralPath (Join-Path $root $path) -Raw
  Assert-True ($raw -match '\[Parameter\(Mandatory\)\]\[string\]\$ProjectId') "$path requires ProjectId"
  Assert-True ($raw -match '\[Parameter\(Mandatory\)\]\[string\]\$Region') "$path requires Region"
  Assert-True ($raw -notmatch '(?i)secrets versions access.*Write-(Host|Output)|Write-(Host|Output).*password') "$path must not print secret payloads"
}

$backup = Get-Content -LiteralPath (Join-Path $root $scripts[0]) -Raw
Assert-True ($backup -match 'gcloud sql backups create' -and $backup -match 'ReleaseSha') 'pre-deployment backup must be release-addressable'

$restore = Get-Content -LiteralPath (Join-Path $root $scripts[1]) -Raw
Assert-True ($restore -match 'DrillInstance' -and $restore -match 'restore-instance') 'restore drill must target an explicit disposable instance'
Assert-True ($restore -match "docai-restore-") 'restore drill must enforce a disposable name prefix'

$shutdown = Get-Content -LiteralPath (Join-Path $root $scripts[2]) -Raw
Assert-True ($shutdown -match '\[switch\]\$ConfirmShutdown' -and $shutdown -match 'if \(-not \$ConfirmShutdown\)') 'shutdown requires an explicit confirmation switch'
Assert-True ($shutdown -match 'gcloud storage ls --all-versions') 'shutdown must inventory every object version'
Assert-True ($shutdown -match 'gcloud sql export sql') 'shutdown must export the database before deletion'
Assert-True ($shutdown.IndexOf('gcloud sql export sql') -lt $shutdown.IndexOf('gcloud sql instances delete')) 'database export must precede instance deletion'

$resetScript = Get-Content -LiteralPath (Join-Path $root 'ops/gcp/reset-production-password.ps1') -Raw
$resetModule = Get-Content -LiteralPath (Join-Path $root 'ops/lib/AdminPasswordReset.psm1') -Raw
$resetSource = "$resetScript`n$resetModule"
Assert-True ($resetScript -match 'Read-Host\s+.*-AsSecureString') 'password reset must prompt for a SecureString'
Assert-True ($resetScript -notmatch '(?m)^\s*\[SecureString\]\$Password|(?m)^\s*\[string\]\$Password') 'interactive reset script must not accept a password parameter'
Assert-True ($resetSource -match 'RESET_PASSWORD=\$\{SecretId\}:\$Version') 'reset job must bind an exact secret version'
Assert-True ($resetSource -match '--remove-secrets["'']?\s*,?\s*["'']RESET_PASSWORD|--remove-secrets\s+RESET_PASSWORD') 'reset job must remove its temporary secret binding'
Assert-True ($resetSource -match 'secrets[''"],?\s*[''"]versions[''"],?\s*[''"]disable|secrets versions disable') 'temporary reset secret version must be disabled'
Assert-True ($resetSource -notmatch '(?i)--password|--update-env-vars\s+RESET_PASSWORD|Write-Host\s+\$Password|secrets versions access') 'reset helper must not expose or retrieve the password'
Assert-True ($resetModule -match '\$Version\s+-notmatch\s+[''"]\^\\d\+\$') 'reset helper must reject nonnumeric secret versions'

$smoke = Get-Content -LiteralPath (Join-Path $root 'ops/gcp/smoke-production.ps1') -Raw
Assert-True ($smoke -match '/api/session/forgot-password' -and $smoke -match '/api/session/reset-password') 'production smoke must exercise both recovery endpoints'
Assert-True ($smoke -match '/api/session/signup' -and $smoke -match 'TURNSTILE_REQUIRED') 'production smoke must prove signup rejects a missing Turnstile challenge'
Assert-True ($smoke.IndexOf('frontend readiness') -lt $smoke.IndexOf('/api/session/signup') -and $smoke.IndexOf('/api/session/signup') -lt $smoke.IndexOf('/api/session/login')) 'protected signup smoke must run after readiness and before login'
Assert-True (([regex]::Matches($smoke, 'Assert-Status\s+[''"][^''"]*recovery disabled[''"][^\r\n]*@\(503\)')).Count -eq 2) 'both recovery smoke requests must require HTTP 503'
Assert-True (([regex]::Matches($smoke, 'PASSWORD_RESET_DISABLED')).Count -ge 2) 'both recovery smoke responses must require PASSWORD_RESET_DISABLED'
Assert-True ($smoke -match '\$resetToken\s*=\s*''([A-Za-z0-9_-]{43})''') 'recovery smoke must use a canonical 43-character token'
Assert-True ($smoke.IndexOf('frontend readiness') -lt $smoke.IndexOf('/api/session/forgot-password') -and $smoke.IndexOf('/api/session/reset-password') -lt $smoke.IndexOf('/api/session/login')) 'disabled recovery smoke must run after readiness and before login'
Assert-True ($smoke -match 'SMOKE_SERVICE_ACCOUNT' -and $smoke -match 'generateIdToken') 'production smoke must support local service-account ID token generation'
Assert-True ($smoke -match '\$backendAudience\s*=\s*\[Environment\]::GetEnvironmentVariable\(''BACKEND_AUDIENCE''\)' -and $smoke -match 'Get-IdentityHeaders \$backendAudience') 'direct candidate backend polling must mint its Cloud Run token for the canonical backend audience'
Assert-True ($smoke -match 'application/pdf' -and $smoke -match 'application/vnd\.openxmlformats-officedocument\.wordprocessingml\.document') 'production smoke must send explicit safe multipart MIME types'
Assert-True ($smoke -match 'FixturePath must reference a PDF' -and $smoke -match 'TemplateFixturePath must reference a DOCX') 'production smoke fixtures must match the ingestion and template API contracts'
Assert-True ($smoke -match 'Start-Sleep -Seconds 15') 'production smoke must poll below the API rate limit'
Assert-True ($smoke -match '\$readinessDeadline' -and $smoke -match "frontend readiness warm-up") 'production smoke must tolerate bounded scale-from-zero warm-up'
Assert-True ($smoke -match '\$templateFixture\s*=\s*\(Resolve-Path') 'production smoke must compile the tracked real DOCX fixture rather than its PDF ingestion fixture'
Assert-True ($smoke -match '\$hasLlmConfig' -and $smoke -match 'VISION_MODEL_REQUIRED') 'production smoke must distinguish healthy renderer analysis from missing user LLM configuration'
Assert-True ($smoke -match 'SKIP: LLM-dependent template fusion and Q&A') 'production smoke must report conditional LLM coverage explicitly'

$workflow = Get-Content -LiteralPath (Join-Path $root '.github/workflows/deploy-production.yml') -Raw
Assert-True ($workflow -match 'Giay_moi_hop_27_GM-DU\.pdf' -and $workflow -match 'docs/generated-templates/quyet-dinh\.docx') 'production smoke must use committed deterministic PDF and typography-compliant DOCX fixtures'
Assert-True ($workflow -match '(?s)service:\s*embeddings\s+context:\s*embeddings-service') 'production deploy must build the pinned local Jina v5 embeddings service'
Assert-True ($workflow -notmatch '(?s)service:\s*embeddings\s+context:\s*deploy/embeddings-jina-proxy') 'production deploy must not replace v5 vectors with the legacy Jina proxy'

$ownerGuide = Get-Content -LiteralPath (Join-Path $root 'docs/operations/gcp-owner-action-guide.md') -Raw
$remainingMatch = [regex]::Match($ownerGuide, '(?s)## Remaining launch secrets\s+```text\s+(.*?)\s+```')
Assert-True $remainingMatch.Success 'owner guide must have a machine-checkable remaining launch secrets block'
$remainingSecrets = @($remainingMatch.Groups[1].Value -split '\r?\n' | Where-Object { $_ } | Sort-Object)
Assert-True (($remainingSecrets -join ',') -eq 'docai-turnstile-secret-key') 'only the Turnstile secret remains for protected registration'
Assert-True ($ownerGuide -notmatch '(?i)docai-smtp-user|docai-smtp-pass|Gmail|SendPulse') 'initial owner setup must not require an SMTP provider or SMTP secret version'
Assert-True ($ownerGuide -match 'reset-production-password\.ps1' -and $ownerGuide -match '(?i)temporary.+version.+disabl') 'owner guide must document the temporary-version reset helper'
Assert-True ($ownerGuide -match '(?i)Turnstile' -and $ownerGuide -match 'DISABLE_PUBLIC_REGISTER=true') 'owner guide must document Turnstile setup and emergency registration rollback'

$productionRunbook = Get-Content -LiteralPath (Join-Path $root 'docs/operations/gcp-production-runbook.md') -Raw
Assert-True ($productionRunbook -match '(?i)no SMTP.{0,80}domain.{0,80}requirement') 'single-operator release must explicitly have no SMTP or domain requirement'
Assert-True ($productionRunbook -match '(?i)bootstrap secrets.{0,80}(present|enabled)') 'bootstrap secrets must be a release gate'
Assert-True ($productionRunbook -match '(?i)disabled recovery smoke.{0,80}(pass|required)') 'disabled recovery smoke must be a release gate'
Assert-True ($productionRunbook -match '(?i)disposable data' -and $productionRunbook -match '(?i)never.{0,80}(deployment smoke|smoke action)') 'reset rehearsal must use disposable data and never be a live deployment smoke action'

Push-Location $root
try {
  & git check-ignore '.artifacts/releases/example/evidence.json' 'infra/terraform/tfplan' 'infra/terraform/bootstrap.tfplan' | Out-Null
  Assert-True ($LASTEXITCODE -eq 0) 'runtime release evidence and named Terraform plans must remain ignored'
} finally { Pop-Location }

Write-Host 'PASS: GCP recovery, cost, and exit runbook contracts' -ForegroundColor Green
