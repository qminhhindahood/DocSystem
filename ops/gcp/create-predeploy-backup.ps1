#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ProjectId,
  [Parameter(Mandatory)][string]$Region,
  [Parameter(Mandatory)][string]$InstanceName,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{7,40}$')][string]$ReleaseSha,
  [string]$EvidenceDirectory
)

$ErrorActionPreference = 'Stop'
if ($ProjectId -notmatch '^[a-z][a-z0-9-]{4,28}[a-z0-9]$') { throw 'ProjectId is not a scoped Google Cloud project ID' }
if ($Region -notmatch '^[a-z]+-[a-z]+[0-9]$') { throw 'Region is invalid' }
if ($InstanceName -notmatch '^docai-[a-z0-9-]+$') { throw 'InstanceName must start with docai-' }

$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $EvidenceDirectory) { $EvidenceDirectory = Join-Path $root ".artifacts/releases/$ReleaseSha" }
$description = "predeploy-$ReleaseSha"

$instance = & gcloud sql instances describe $InstanceName --project=$ProjectId --format=json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $instance) { throw "Cloud SQL instance $InstanceName was not found" }
if ($instance.region -ne $Region) { throw "$InstanceName is in $($instance.region), not $Region" }
$instance | Select-Object name, region, databaseVersion, state | Format-List

$backups = @(& gcloud sql backups list --instance=$InstanceName --project=$ProjectId --format=json | ConvertFrom-Json)
$backup = $backups | Where-Object { $_.description -eq $description -and $_.status -eq 'SUCCESSFUL' } |
  Sort-Object id -Descending | Select-Object -First 1
if (-not $backup) {
  & gcloud sql backups create --instance=$InstanceName --description=$description --project=$ProjectId --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Pre-deployment backup creation failed' }
  $backups = @(& gcloud sql backups list --instance=$InstanceName --project=$ProjectId --format=json | ConvertFrom-Json)
  $backup = $backups | Where-Object { $_.description -eq $description -and $_.status -eq 'SUCCESSFUL' } |
    Sort-Object id -Descending | Select-Object -First 1
}
if (-not $backup) { throw 'A successful release-addressable backup could not be verified' }

New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
[pscustomobject]@{
  projectId = $ProjectId
  region = $Region
  instance = $InstanceName
  releaseSha = $ReleaseSha
  backupId = [string]$backup.id
  status = $backup.status
  createdAt = $backup.startTime
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'predeploy-backup.json') -Encoding utf8
Write-Host "PASS: backup $($backup.id) is ready for release $ReleaseSha" -ForegroundColor Green
