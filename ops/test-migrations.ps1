#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Rehearse Phase 1 migrations on a disposable PostgreSQL container.
.DESCRIPTION
  Creates a temporary PostgreSQL container, runs prisma:deploy:fresh,
  asserts owner-integrity defaults, then destroys the container.
  Safe to run against any host — uses uniquely named resources.
.PARAMETER ProjectRoot
  Root directory of the LLM project. Defaults to the parent of the ops/ folder.
.PARAMETER DatabaseUrl
  Override target DATABASE_URL. When omitted, a temporary container is created.
  Use this to point at an existing disposable database for debugging.
.PARAMETER KeepContainer
  Switch. If set, the container is NOT removed after the test so you can
  inspect it. You must clean up manually.
#>

[CmdletBinding()]
param(
  [string]$ProjectRoot = (Resolve-Path "$PSScriptRoot/.."),
  [string]$DatabaseUrl,
  [switch]$KeepContainer
)

# ---- module ----
$modulePath = Join-Path $PSScriptRoot 'lib\PostgresTools.psm1'
Import-Module $modulePath -Force

function Get-RandomSuffix {
  -join ((48..57) + (97..122) | Get-Random -Count 8 | ForEach-Object { [char]$_ })
}

# ---- resource names ----
$suffix = Get-RandomSuffix
$containerName = "llm-migration-rehearsal-$suffix"
$volumeName = "llm-migration-rehearsal-vol-$suffix"

# ---- cleanup handler ----
$cleanupDone = $false
function Remove-TestResources {
  if ($cleanupDone -or $KeepContainer) { return }
  $cleanupDone = $true
  Write-Host "`nCleaning up rehearsal resources..." -ForegroundColor Cyan
  $null = docker rm --force $containerName 2>$null
  $null = docker volume rm $volumeName 2>$null
  Write-Host "Cleanup complete." -ForegroundColor Green
}

try {
  if (-not $DatabaseUrl) {
    # ---- start disposable PostgreSQL ----
    Write-Host "Creating temporary PostgreSQL container: $containerName" -ForegroundColor Cyan
    Invoke-NativeChecked docker @(
      'run', '--detach',
      '--name', $containerName,
      '--volume', "${volumeName}:/var/lib/postgresql/data",
      '--publish', '127.0.0.1::5432',
      '--env', 'POSTGRES_DB=ai_docs_target',
      '--env', 'POSTGRES_USER=postgres',
      '--env', 'POSTGRES_PASSWORD=rehearsal-password',
      '--health-cmd', 'pg_isready -U postgres',
      '--health-interval', '1s',
      '--health-retries', '30',
      'pgvector/pgvector:pg15',
      '-c', 'shared_preload_libraries=vector'
    )

    # ---- resolve dynamic port ----
    $port = docker container port $containerName 5432/tcp | ForEach-Object { $_ -split ':' | Select-Object -Last 1 }
    $DatabaseUrl = "postgresql://postgres:rehearsal-password@localhost:$port/ai_docs_target"
  } else {
    Write-Host "Using the explicitly provided disposable database." -ForegroundColor Cyan
  }

  if ($DatabaseUrl -like '*localhost*' -or $DatabaseUrl -like '*127.0.0.1*') {
    Write-Host "Waiting for PostgreSQL readiness..." -ForegroundColor Yellow
    $maxWait = 30
    $waiting = $true
    while ($waiting -and $maxWait -gt 0) {
      try {
        $connString = $DatabaseUrl -replace '^postgresql://', ''
        $user, $rest = $connString.Split(':', 2)
        $passAndHost, $db = $rest.Split('/', 2)
        $pass, $hostAndPort = $passAndHost.Split('@', 2)
        $hostName, $pgPort = $hostAndPort.Split(':', 2)
        # try a simple TCP test via docker exec or psql
        $result = docker exec $containerName pg_isready -U postgres 2>$null
        if ($LASTEXITCODE -eq 0) { $waiting = $false; break }
      } catch { }
      Start-Sleep -Seconds 1
      $maxWait--
    }
    if ($waiting) { throw "PostgreSQL did not become ready within 30 seconds" }
    Write-Host "PostgreSQL is ready." -ForegroundColor Green
    Start-Sleep -Seconds 2 # extra settle time
  }

  # ---- run fresh-database deployment ----
  Write-Host "`n--- Running fresh database deployment ---" -ForegroundColor Cyan
  Push-Location $ProjectRoot/backend
  try {
    $previousDatabaseUrl = $env:DATABASE_URL
    $env:DATABASE_URL = $DatabaseUrl
    Invoke-NativeChecked npx @('tsx', 'scripts/deploy_fresh_database.ts')
  } finally {
    $env:DATABASE_URL = $previousDatabaseUrl
    Pop-Location
  }

  # ---- run owner-integrity assertions ----
  Write-Host "`n--- Running owner-integrity assertions ---" -ForegroundColor Cyan
  Push-Location $ProjectRoot/backend
  try {
    Invoke-NativeChecked npx @('tsx', 'scripts/assert_owner_integrity.ts', '--database-url', $DatabaseUrl)
  } finally { Pop-Location }

  Write-Host "`n✓ All Phase 1 migration and ownership assertions passed!" -ForegroundColor Green

} catch {
  Write-Host "`n✗ Rehearsal failed: $_" -ForegroundColor Red
  $host.SetShouldExit(1)
} finally {
  Remove-TestResources
}
