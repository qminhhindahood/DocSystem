#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ProjectId,
  [Parameter(Mandatory)][string]$Region,
  [string]$FrontendUrl,
  [string]$BackendUrl,
  [string]$FixturePath,
  [string]$TemplateFixturePath
)

$ErrorActionPreference = 'Stop'
foreach ($service in @('docai-backend', 'docai-frontend')) {
  $revisions = @(& gcloud run revisions list --service $service --project $ProjectId --region $Region `
    --sort-by='~metadata.creationTimestamp' --format='value(metadata.name)')
  if ($LASTEXITCODE -ne 0 -or $revisions.Count -lt 2) { throw "No previous compatible revision exists for $service" }
  $previous = $revisions[1].Trim()
  & gcloud run services update-traffic $service --project $ProjectId --region $Region --to-revisions "$previous=100" --quiet
  if ($LASTEXITCODE -ne 0) { throw "Rollback failed for $service" }
  Write-Host "PASS: $service rolled back to $previous" -ForegroundColor Yellow
}

if ($FrontendUrl -and $BackendUrl -and $FixturePath -and $TemplateFixturePath) {
  & (Join-Path $PSScriptRoot 'smoke-production.ps1') -ProjectId $ProjectId -Region $Region `
    -FrontendUrl $FrontendUrl -BackendUrl $BackendUrl -FixturePath $FixturePath `
    -TemplateFixturePath $TemplateFixturePath
  if ($LASTEXITCODE -ne 0) { throw 'Post-rollback smoke failed' }
} else {
  Write-Warning 'Traffic was restored without smoke; provide FrontendUrl, BackendUrl, FixturePath (PDF), and TemplateFixturePath (DOCX) to verify the rollback.'
}
