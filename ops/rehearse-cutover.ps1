#!/usr/bin/env pwsh
<# Rehearse backup, migrate, data-only import, and verification using only disposable resources. #>
[CmdletBinding()]
param(
  [string]$ProjectRoot = (Resolve-Path "$PSScriptRoot/.."),
  [switch]$KeepResources
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib/PostgresTools.psm1') -Force

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
$random = -join ((48..57) + (97..122) | Get-Random -Count 6 | ForEach-Object { [char]$_ })
$prefix = "docai_rehearsal_${stamp}_${random}"
$sourceContainer = "${prefix}_source"
$targetContainer = "${prefix}_target"
$sourceVolume = "${prefix}_source_vol"
$targetVolume = "${prefix}_target_vol"
$workDir = Join-Path $ProjectRoot "backups\$prefix"
$evidencePath = Join-Path $workDir 'quiescence.json'
$backupDir = Join-Path $workDir 'backup'
$password = 'rehearsal-only-password'

@($sourceContainer, $targetContainer, $sourceVolume, $targetVolume) | ForEach-Object { Assert-RehearsalName $_ }
New-Item -ItemType Directory -Force -Path $workDir | Out-Null

# Keep the rehearsal self-contained: all PostgreSQL client commands run in a
# disposable client container, while Prisma still connects through loopback.
function Invoke-RehearsalPgTool([string]$tool, [object[]]$arguments) {
  $resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
  $mapped = foreach ($argument in $arguments) {
    $value = $argument.ToString()
    if ($value.Contains($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
      $value.Replace($resolvedRoot, '/workspace', [StringComparison]::OrdinalIgnoreCase).Replace('\', '/')
    } else {
      $value.Replace('@127.0.0.1:', '@host.docker.internal:').Replace('@localhost:', '@host.docker.internal:')
    }
  }
  $mount = "${resolvedRoot}:/workspace"
  & docker run --rm --volume $mount pgvector/pgvector:pg15 $tool @mapped
}
function global:psql { Invoke-RehearsalPgTool 'psql' $args }
function global:pg_dump { Invoke-RehearsalPgTool 'pg_dump' $args }
function global:pg_restore { Invoke-RehearsalPgTool 'pg_restore' $args }

function Start-RehearsalPostgres([string]$name, [string]$volume, [string]$database) {
  Invoke-NativeChecked docker @(
    'run','--detach','--name',$name,'--volume',"${volume}:/var/lib/postgresql/data",
    '--publish','127.0.0.1::5432','--env',"POSTGRES_DB=$database",'--env','POSTGRES_USER=postgres',
    '--env',"POSTGRES_PASSWORD=$password",'--health-cmd','pg_isready -U postgres',
    '--health-interval','1s','--health-retries','45','pgvector/pgvector:pg15'
  ) | Out-Null
}

function Wait-RehearsalPostgres([string]$name) {
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $status = & docker inspect $name --format '{{.State.Health.Status}}' 2>$null
    if ($LASTEXITCODE -eq 0 -and $status -eq 'healthy') { return }
    Start-Sleep -Seconds 1
  }
  throw "Disposable PostgreSQL did not become healthy: $name"
}

function Get-LoopbackPort([string]$name) {
  $binding = Invoke-NativeChecked docker @('container','port',$name,'5432/tcp')
  $port = ($binding | Select-Object -First 1).ToString().Split(':')[-1]
  if ($port -notmatch '^\d+$') { throw "Could not resolve a loopback port for $name" }
  return $port
}

function Remove-RehearsalResources {
  if ($KeepResources) { return }
  foreach ($container in @($sourceContainer, $targetContainer)) {
    Assert-RehearsalName $container
    & docker inspect $container *> $null
    if ($LASTEXITCODE -eq 0) { Invoke-NativeChecked docker @('rm','--force',$container) | Out-Null }
  }
  foreach ($volume in @($sourceVolume, $targetVolume)) {
    Assert-RehearsalName $volume
    & docker volume inspect $volume *> $null
    if ($LASTEXITCODE -eq 0) { Invoke-NativeChecked docker @('volume','rm',$volume) | Out-Null }
  }
  $resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
  if (Test-Path -LiteralPath $workDir) {
    $resolvedWork = (Resolve-Path -LiteralPath $workDir).Path
    if (-not $resolvedWork.StartsWith($resolvedRoot + [IO.Path]::DirectorySeparatorChar) -or
        -not (Split-Path $resolvedWork -Leaf).StartsWith('docai_rehearsal_')) {
      throw "Unsafe rehearsal cleanup path: $resolvedWork"
    }
    Remove-Item -LiteralPath $resolvedWork -Recurse -Force
  }
}

try {
  Start-RehearsalPostgres $sourceContainer $sourceVolume 'legacy_source'
  Start-RehearsalPostgres $targetContainer $targetVolume 'prisma_target'
  Wait-RehearsalPostgres $sourceContainer
  Wait-RehearsalPostgres $targetContainer
  $sourcePort = Get-LoopbackPort $sourceContainer
  $targetPort = Get-LoopbackPort $targetContainer
  $sourceUrl = "postgresql://postgres:${password}@127.0.0.1:${sourcePort}/legacy_source"
  $targetUrl = "postgresql://postgres:${password}@127.0.0.1:${targetPort}/prisma_target"

  Invoke-NativeChecked psql @($sourceUrl,'--set','ON_ERROR_STOP=1','--file',(Join-Path $PSScriptRoot 'fixtures/legacy-schema.sql'))
  Invoke-NativeChecked psql @($sourceUrl,'--set','ON_ERROR_STOP=1','--file',(Join-Path $PSScriptRoot 'fixtures/legacy-data.sql'))
  Invoke-NativeChecked psql @($targetUrl,'--set','ON_ERROR_STOP=1','--file',(Join-Path $ProjectRoot 'init.sql'))
  [ordered]@{
    writesStopped = $true; sourceHost = '127.0.0.1'; sourcePort = [int]$sourcePort;
    sourceDatabase = 'legacy_source'; recordedAt = (Get-Date -Format o); scope = 'disposable-fixture'
  } | ConvertTo-Json | Set-Content -LiteralPath $evidencePath

  & (Join-Path $PSScriptRoot 'backup-postgres.ps1') -OutputDir $backupDir -DatabaseUrl $sourceUrl -QuiescenceEvidencePath $evidencePath
  if ($LASTEXITCODE -notin @(0, $null)) { throw 'Backup script failed' }

  Push-Location (Join-Path $ProjectRoot 'backend')
  try {
    $previousDatabaseUrl = $env:DATABASE_URL
    $env:DATABASE_URL = $targetUrl
    Invoke-NativeChecked npx @('tsx','scripts/deploy_fresh_database.ts')
  } finally {
    $env:DATABASE_URL = $previousDatabaseUrl
    Pop-Location
  }

  & (Join-Path $PSScriptRoot 'import-postgres-data.ps1') -DumpDir $backupDir -TargetDatabaseUrl $targetUrl -QuiescenceEvidencePath $evidencePath
  if ($LASTEXITCODE -notin @(0, $null)) { throw 'Import script failed' }
  & (Join-Path $PSScriptRoot 'verify-postgres.ps1') -SourceDatabaseUrl $sourceUrl -TargetDatabaseUrl $targetUrl
  if ($LASTEXITCODE -notin @(0, $null)) { throw 'Verification script failed' }

  Push-Location (Join-Path $ProjectRoot 'backend')
  try {
    $previousDatabaseUrl = $env:DATABASE_URL
    $env:DATABASE_URL = $targetUrl
    Invoke-NativeChecked npx @('prisma','migrate','deploy')
  } finally {
    $env:DATABASE_URL = $previousDatabaseUrl
    Pop-Location
  }
  Write-Output 'Disposable cutover rehearsal passed.'
} finally {
  Remove-RehearsalResources
}
