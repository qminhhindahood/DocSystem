#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ProjectId,
  [Parameter(Mandatory)][string]$Region,
  [Parameter(Mandatory)][string]$InstanceName,
  [Parameter(Mandatory)][string]$DatabaseName,
  [Parameter(Mandatory)][string]$ExportBucket,
  [Parameter(Mandatory)][string]$TemplatesBucket,
  [Parameter(Mandatory)][string]$UploadsBucket,
  [Parameter(Mandatory)][string]$RagStateBucket,
  [Parameter(Mandatory)][string]$LlmEncryptionKeySecret,
  [switch]$ConfirmShutdown,
  [string]$EvidenceDirectory,
  [string]$AcceptedRestoreEvidencePath,
  [ValidatePattern('^$|^[a-f0-9]{64}$')][string]$AcceptedRestoreEvidenceSha256
)

$ErrorActionPreference = 'Stop'
if ($ProjectId -notmatch '^[a-z][a-z0-9-]{4,28}[a-z0-9]$') { throw 'ProjectId is not a scoped Google Cloud project ID' }
if ($Region -notmatch '^[a-z]+-[a-z]+[0-9]$') { throw 'Region is invalid' }
if ($InstanceName -notmatch '^docai-[a-z0-9-]+$' -or $DatabaseName -notmatch '^docai[a-z0-9_-]*$') { throw 'SQL targets must be explicitly DocAI-scoped' }
foreach ($bucket in @($ExportBucket, $TemplatesBucket, $UploadsBucket, $RagStateBucket)) {
  if ($bucket -notmatch "^docai-[a-z0-9-]+-$([regex]::Escape($ProjectId))$") { throw "Bucket $bucket is not scoped to $ProjectId" }
}
if ($LlmEncryptionKeySecret -ne 'docai-llm-config-encryption-key') { throw 'Unexpected LLM encryption-key secret target' }

$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Import-Module (Join-Path $root 'ops/lib/Evidence.psm1') -Force
if ($ConfirmShutdown) {
  if (-not $AcceptedRestoreEvidencePath -or
      -not (Test-Path -LiteralPath $AcceptedRestoreEvidencePath)) {
    throw 'Accepted Neon restore evidence is required before shutdown'
  }
  $restore = Get-Content -LiteralPath $AcceptedRestoreEvidencePath -Raw | ConvertFrom-Json
  if ($restore.status -ne 'passed') { throw 'Accepted Neon restore evidence is not passed' }
  if (-not $AcceptedRestoreEvidenceSha256 -or
      (Get-EvidenceSha256 $AcceptedRestoreEvidencePath) -ne $AcceptedRestoreEvidenceSha256) {
    throw 'Accepted Neon restore evidence checksum mismatch'
  }
}
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
if (-not $EvidenceDirectory) { $EvidenceDirectory = Join-Path $root ".artifacts/october-exit/$stamp" }
New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null

Write-Host 'Resources in the controlled exit scope:' -ForegroundColor Yellow
& gcloud sql instances describe $InstanceName --project=$ProjectId --format='table(name,region,state,settings.tier)'
if ($LASTEXITCODE -ne 0) { throw "Cloud SQL instance $InstanceName was not found" }
& gcloud run services list --project=$ProjectId --region=$Region --filter='metadata.name:docai-' --format='table(metadata.name,status.url)'
& gcloud run jobs list --project=$ProjectId --region=$Region --filter='metadata.name:docai-' --format='table(metadata.name)'
foreach ($bucket in @($ExportBucket, $TemplatesBucket, $UploadsBucket, $RagStateBucket) | Select-Object -Unique) {
  & gcloud storage buckets describe "gs://$bucket" --project=$ProjectId --format='table(name,location,versioning_enabled,public_access_prevention)'
  if ($LASTEXITCODE -ne 0) { throw "Bucket $bucket was not found" }
}

foreach ($item in @{
  templates = $TemplatesBucket
  uploads = $UploadsBucket
  rag_state = $RagStateBucket
}.GetEnumerator()) {
  & gcloud storage ls --all-versions --recursive "gs://$($item.Value)" 2>$null |
    Set-Content -LiteralPath (Join-Path $EvidenceDirectory "$($item.Key)-all-versions.txt") -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "Unable to inventory $($item.Value)" }
}

$keyVersions = @(& gcloud secrets versions list $LlmEncryptionKeySecret --project=$ProjectId `
  --filter='state=ENABLED' --format='value(name)')
if ($LASTEXITCODE -ne 0 -or $keyVersions.Count -lt 1) { throw 'No enabled LLM encryption-key recovery version exists' }
[pscustomobject]@{ secret = $LlmEncryptionKeySecret; enabledVersionCount = $keyVersions.Count; payloadRead = $false } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'llm-key-recovery-check.json') -Encoding utf8

$exportUri = "gs://$ExportBucket/exports/docai-$stamp.sql.gz"
& gcloud sql export sql $InstanceName $exportUri --project=$ProjectId --database=$DatabaseName --offload --quiet
if ($LASTEXITCODE -ne 0) { throw 'Encrypted-at-rest Cloud SQL export failed' }
& gcloud storage objects describe $exportUri --project=$ProjectId --format=json |
  Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'database-export-object.json') -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'Export object could not be verified' }

if (-not $ConfirmShutdown) {
  Write-Host "PREVIEW COMPLETE: export and inventories are safe at $EvidenceDirectory. No compute or database was deleted." -ForegroundColor Yellow
  Write-Host 'Re-run with -ConfirmShutdown only after encrypted offline copies and restore instructions are verified.' -ForegroundColor Yellow
  exit 0
}

Write-Host 'Confirmed deletion targets (buckets, secrets, exports, and Terraform state are retained):' -ForegroundColor Red
& gcloud run services list --project=$ProjectId --region=$Region --filter='metadata.name:docai-' --format='value(metadata.name)'
& gcloud run jobs list --project=$ProjectId --region=$Region --filter='metadata.name:docai-' --format='value(metadata.name)'
Write-Host $InstanceName
foreach ($service in @('docai-frontend', 'docai-backend', 'docai-docling', 'docai-embeddings', 'docai-renderer')) {
  & gcloud run services describe $service --project=$ProjectId --region=$Region --format='value(metadata.name)' 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    & gcloud run services delete $service --project=$ProjectId --region=$Region --quiet
    if ($LASTEXITCODE -ne 0) { throw "Unable to delete $service" }
  }
}
foreach ($job in @('docai-migrate', 'docai-bootstrap-user', 'docai-bootstrap-smoke-user')) {
  & gcloud run jobs describe $job --project=$ProjectId --region=$Region --format='value(metadata.name)' 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    & gcloud run jobs delete $job --project=$ProjectId --region=$Region --quiet
    if ($LASTEXITCODE -ne 0) { throw "Unable to delete $job" }
  }
}
& gcloud sql instances patch $InstanceName --project=$ProjectId --no-deletion-protection --quiet
if ($LASTEXITCODE -ne 0) { throw 'Unable to disable SQL deletion protection' }
& gcloud sql instances delete $InstanceName --project=$ProjectId --quiet
if ($LASTEXITCODE -ne 0) { throw 'Unable to delete the exported Cloud SQL instance' }
Write-Host 'PASS: controlled shutdown completed; recovery buckets, secrets, export, and evidence were retained.' -ForegroundColor Green
