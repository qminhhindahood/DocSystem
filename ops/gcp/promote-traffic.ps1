#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ProjectId,
  [Parameter(Mandatory)][string]$Region,
  [Parameter(Mandatory)][ValidatePattern('^candidate-[a-f0-9]{8}$')][string]$CandidateTag
)

$ErrorActionPreference = 'Stop'
foreach ($service in @('docai-backend', 'docai-frontend')) {
  & gcloud run services update-traffic $service --project $ProjectId --region $Region --to-tags "$CandidateTag=100" --quiet
  if ($LASTEXITCODE -ne 0) { throw "Traffic promotion failed for $service" }
  $serviceState = & gcloud run services describe $service --project $ProjectId --region $Region --format=json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "Unable to verify traffic promotion for $service" }
  $candidateTraffic = @($serviceState.status.traffic | Where-Object { $_.tag -eq $CandidateTag })
  if ($candidateTraffic.Count -ne 1 -or [int]$candidateTraffic[0].percent -ne 100) {
    throw "$service did not reach 100% candidate traffic"
  }
  Write-Host "PASS: $service promoted to $CandidateTag" -ForegroundColor Green
}
