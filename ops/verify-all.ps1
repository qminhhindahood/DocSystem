#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [switch]$ContractsOnly
)

# Slim standalone verification suite (ticket 08).
#
# The master stack ran backend/frontend/.NET/Python test suites, Terraform
# validation, production compose contracts, and GCP cutover rehearsals here.
# Those surfaces are deleted with the master-stack prune. What remains is the
# contract-level, offline verification of the standalone conversion product:
#   1. docker compose config + the standalone compose contract
#   2. the Pester operations tests (CI, hygiene, TypeScript 7, PostgresTools)
#   3. git whitespace integrity
#
# -ContractsOnly is accepted for CI compatibility; the slim suite is entirely
# contract-level, so both paths run the same steps.

if ($PSVersionTable.PSEdition -eq 'Desktop') {
  $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
  if (-not $pwsh) { throw 'PowerShell 7 is required for UTF-8-safe repository verification' }
  $forwarded = @('-NoProfile', '-File', $PSCommandPath)
  if ($ContractsOnly) { $forwarded += '-ContractsOnly' }
  & $pwsh.Source @forwarded
  exit $LASTEXITCODE
}

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Import-Module (Join-Path $PSScriptRoot 'lib/PostgresTools.psm1') -Force
$pesterModulePath = Join-Path $root '.artifacts/pester5/Pester/5.7.1/Pester.psd1'
if (-not (Test-Path -LiteralPath $pesterModulePath)) {
  $pesterModulePath = Get-Module Pester -ListAvailable |
    Where-Object Version -eq ([version]'5.7.1') |
    Select-Object -ExpandProperty Path -First 1
}
if (-not $pesterModulePath) {
  throw 'Pester 5.7.1 is required. Install-Module Pester -RequiredVersion 5.7.1 -Scope CurrentUser'
}
Import-Module $pesterModulePath -Force

function Invoke-Step([string]$Name, [scriptblock]$Run) {
  Write-Host "--- $Name ---" -ForegroundColor Cyan
  & $Run
  Write-Host "PASS: $Name" -ForegroundColor Green
}

Invoke-Step 'Compose config and standalone compose contract' {
  $overrides = @{
    DB_PASSWORD = 'verification-only-password'
    POSTGRES_VOLUME = 'standalone_verification_postgres_data'
    REDIS_VOLUME = 'standalone_verification_redis_data'
  }
  $saved = @{}
  foreach ($name in $overrides.Keys) {
    $saved[$name] = [pscustomobject]@{
      Exists = Test-Path -LiteralPath "Env:$name"
      Value = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    [Environment]::SetEnvironmentVariable($name, $overrides[$name], 'Process')
  }
  Push-Location $root
  try {
    Invoke-NativeChecked docker @('compose','config','--quiet')
    & (Join-Path $PSScriptRoot 'test-compose.ps1')
    if (-not $?) { throw 'Standalone compose contract failed' }
  } finally {
    Pop-Location
    foreach ($name in $overrides.Keys) {
      if ($saved[$name].Exists) {
        [Environment]::SetEnvironmentVariable($name, $saved[$name].Value, 'Process')
      } else {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
      }
    }
  }
}

Invoke-Step 'Operations unit tests' {
  $result = Invoke-Pester (Join-Path $PSScriptRoot 'tests') -PassThru
  if ($result.FailedCount -gt 0) { throw "$($result.FailedCount) Pester tests failed" }
  $failedContainers = @($result.Containers | Where-Object Result -eq 'Failed')
  if ($failedContainers.Count -gt 0) { throw "$($failedContainers.Count) Pester test containers failed during discovery or execution" }
}

Invoke-Step 'Git whitespace integrity' {
  Push-Location $root
  try { Invoke-NativeChecked git @('diff','--check') } finally { Pop-Location }
}

Write-Host 'All verification steps passed.' -ForegroundColor Green
