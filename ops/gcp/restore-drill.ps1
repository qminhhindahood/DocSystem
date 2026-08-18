#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ProjectId,
  [Parameter(Mandatory)][string]$Region,
  [Parameter(Mandatory)][string]$SourceInstance,
  [Parameter(Mandatory)][ValidatePattern('^docai-restore-[a-z0-9-]+$')][string]$DrillInstance,
  [string]$BackupId,
  [switch]$Execute,
  [string]$EvidenceDirectory
)

$ErrorActionPreference = 'Stop'
if ($ProjectId -notmatch '^[a-z][a-z0-9-]{4,28}[a-z0-9]$') { throw 'ProjectId is not a scoped Google Cloud project ID' }
if ($Region -notmatch '^[a-z]+-[a-z]+[0-9]$') { throw 'Region is invalid' }
if ($SourceInstance -notmatch '^docai-[a-z0-9-]+$' -or $SourceInstance -eq $DrillInstance) {
  throw 'SourceInstance must be a distinct DocAI instance'
}

$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $EvidenceDirectory) { $EvidenceDirectory = Join-Path $root ".artifacts/restore-drills/$DrillInstance" }
$source = & gcloud sql instances describe $SourceInstance --project=$ProjectId --format=json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $source) { throw "Source instance $SourceInstance was not found" }
if ($source.region -ne $Region) { throw "$SourceInstance is in $($source.region), not $Region" }

$backups = @(& gcloud sql backups list --instance=$SourceInstance --project=$ProjectId --format=json | ConvertFrom-Json)
if (-not $BackupId) {
  $BackupId = [string](($backups | Where-Object status -eq 'SUCCESSFUL' | Sort-Object id -Descending | Select-Object -First 1).id)
}
$backup = $backups | Where-Object { [string]$_.id -eq $BackupId -and $_.status -eq 'SUCCESSFUL' } | Select-Object -First 1
if (-not $backup) { throw "Successful backup $BackupId was not found on $SourceInstance" }
[pscustomobject]@{ source = $SourceInstance; region = $Region; backupId = $BackupId; target = $DrillInstance } | Format-List

$target = & gcloud sql instances describe $DrillInstance --project=$ProjectId --format=json 2>$null | ConvertFrom-Json
if (-not $Execute) {
  Write-Host 'PREVIEW: no resources changed. Re-run with -Execute to create/restore the disposable instance.' -ForegroundColor Yellow
  exit 0
}
if (-not $target) {
  & gcloud sql instances create $DrillInstance --project=$ProjectId --region=$Region `
    --database-version=POSTGRES_15 --tier=db-g1-small --storage-size=10 --storage-type=SSD `
    --no-storage-auto-increase --availability-type=zonal --quiet
  if ($LASTEXITCODE -ne 0) { throw "Unable to create disposable instance $DrillInstance" }
  $target = & gcloud sql instances describe $DrillInstance --project=$ProjectId --format=json | ConvertFrom-Json
}
if ($target.region -ne $Region) { throw "$DrillInstance exists outside $Region" }
$restoredBackup = [string]$target.settings.userLabels.restore_backup
if ($restoredBackup -ne $BackupId) {
  & gcloud sql backups restore $BackupId --backup-instance=$SourceInstance `
    --restore-instance=$DrillInstance --project=$ProjectId --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Restore into the disposable instance failed' }
  & gcloud sql instances patch $DrillInstance --project=$ProjectId `
    --update-labels="purpose=restore-drill,restore_backup=$BackupId" --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Unable to label restored drill instance' }
}

$verified = & gcloud sql instances describe $DrillInstance --project=$ProjectId --format=json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $verified.state -ne 'RUNNABLE') { throw 'Restored drill instance is not RUNNABLE' }
New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
[pscustomobject]@{
  projectId = $ProjectId
  region = $Region
  sourceInstance = $SourceInstance
  drillInstance = $DrillInstance
  backupId = $BackupId
  state = $verified.state
  completedAt = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'restore-metadata.json') -Encoding utf8
Write-Host 'PASS: restore completed. Perform the documented Prisma, ownership, and representative-record checks before deleting the drill instance.' -ForegroundColor Green
