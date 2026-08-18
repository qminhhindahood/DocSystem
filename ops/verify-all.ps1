#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [switch]$IncludeCutoverRehearsal,
  [switch]$IncludeRendererContainer,
  [switch]$ContractsOnly
)

if ($PSVersionTable.PSEdition -eq 'Desktop') {
  $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
  if (-not $pwsh) { throw 'PowerShell 7 is required for UTF-8-safe repository verification' }
  $forwarded = @('-NoProfile', '-File', $PSCommandPath)
  if ($IncludeCutoverRehearsal) { $forwarded += '-IncludeCutoverRehearsal' }
  if ($IncludeRendererContainer) { $forwarded += '-IncludeRendererContainer' }
  if ($ContractsOnly) { $forwarded += '-ContractsOnly' }
  & $pwsh.Source @forwarded
  exit $LASTEXITCODE
}

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$env:DATABASE_URL = if ($env:DATABASE_URL) {
  $env:DATABASE_URL
} else {
  'postgresql://verification:verification@localhost:5432/docai_verification'
}
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

if (-not $ContractsOnly) {
Invoke-Step 'Backend tests, schema, Prisma, build, and production dependency audit' {
  Push-Location (Join-Path $root 'backend')
  try {
    Invoke-NativeChecked npm @('test','--','--runInBand')
    Invoke-NativeChecked npx @('prisma','validate')
    Invoke-NativeChecked npm @('run','check-schema')
    Invoke-NativeChecked npm @('run','test:migrations')
    Invoke-NativeChecked npm @('run','build')
    Invoke-NativeChecked npm @('audit','--omit=dev','--audit-level=moderate')
  } finally { Pop-Location }
}

Invoke-Step 'Frontend tests, lint, build, and production dependency audit' {
  Push-Location (Join-Path $root 'frontend')
  try {
    Invoke-NativeChecked npm @('test','--','--run','--maxWorkers=4')
    Invoke-NativeChecked npm @('run','lint')
    Invoke-NativeChecked npm @('run','build')
    Invoke-NativeChecked npm @('audit','--omit=dev','--audit-level=moderate')
  } finally { Pop-Location }
}

$dotnetCandidates = @($env:DOTNET_EXE, (Join-Path $HOME '.dotnet10/dotnet.exe'), 'dotnet') | Where-Object { $_ }
$dotnet = $dotnetCandidates | Where-Object {
  if ($_ -ne 'dotnet' -and -not (Test-Path -LiteralPath $_)) { return $false }
  $sdks = & $_ --list-sdks 2>$null
  $LASTEXITCODE -eq 0 -and $sdks
} | Select-Object -First 1
if (-not $dotnet) { throw 'A .NET 10 SDK is required for renderer verification' }
Invoke-Step '.NET renderer tests and Release build' {
  Invoke-NativeChecked $dotnet @('test',(Join-Path $root 'document-renderer/DocumentRenderer.sln'))
  Invoke-NativeChecked $dotnet @('build',(Join-Path $root 'document-renderer/DocumentRenderer.sln'),'-c','Release','--no-restore')
}

$pythonCandidates = @()
if ($env:PYTHON_EXE) { $pythonCandidates += [pscustomobject]@{ File = $env:PYTHON_EXE; Prefix = @() } }
if (Get-Command python -ErrorAction SilentlyContinue) { $pythonCandidates += [pscustomobject]@{ File = 'python'; Prefix = @() } }
if (Get-Command py -ErrorAction SilentlyContinue) {
  foreach ($version in @('-3.14','-3.13','-3.12','-3.11')) {
    $pythonCandidates += [pscustomobject]@{ File = 'py'; Prefix = @($version) }
  }
}
$pythonRuntime = $pythonCandidates | Where-Object {
  $candidatePrefix = $_.Prefix
  & $_.File @candidatePrefix -c 'import pytest, werkzeug, torch' *> $null
  $LASTEXITCODE -eq 0
} | Select-Object -First 1
if (-not $pythonRuntime) {
  throw 'No Python interpreter has the service test dependencies installed. Run pip install -r docling-service/requirements-dev.txt and pip install -r embeddings-service/requirements-dev.txt.'
}
Invoke-Step 'Python service tests and compileall' {
  foreach ($service in @('docling-service','embeddings-service')) {
    Push-Location (Join-Path $root $service)
    try {
      Invoke-NativeChecked $pythonRuntime.File ($pythonRuntime.Prefix + @('-m','pytest','tests','-q'))
      Invoke-NativeChecked $pythonRuntime.File ($pythonRuntime.Prefix + @('-m','compileall','-q','main.py'))
    } finally { Pop-Location }
  }
}
}

Invoke-Step 'Compose and migration contracts' {
  if (-not $env:DB_PASSWORD) { $env:DB_PASSWORD = 'verification-only-password' }
  if (-not $env:RENDERER_INTERNAL_TOKEN) { $env:RENDERER_INTERNAL_TOKEN = 'verification-only-renderer-token-32-chars' }
  Push-Location $root
  try {
    Invoke-NativeChecked docker @('compose','config','--quiet')
    & (Join-Path $PSScriptRoot 'test-compose.ps1')
    if (-not $?) { throw 'Compose contract failed' }
    & (Join-Path $PSScriptRoot 'test-prod-compose.ps1')
    if (-not $?) { throw 'Production Compose contract failed' }
  } finally { Pop-Location }
}

Invoke-Step 'Terraform formatting and validation' {
  $terraform = Get-Command terraform -ErrorAction SilentlyContinue
  if (-not $terraform) {
    $terraform = Get-ChildItem "$env:LOCALAPPDATA/Microsoft/WinGet/Packages" -Recurse -Filter terraform.exe -ErrorAction SilentlyContinue |
      Select-Object -First 1
  }
  if (-not $terraform) { throw 'Terraform is required for infrastructure verification' }
  $terraformExe = if ($terraform.Source) { $terraform.Source } else { $terraform.FullName }
  $terraformDataDir = Join-Path ([IO.Path]::GetTempPath()) "docai-terraform-verify-$PID-$([guid]::NewGuid().ToString('N'))"
  $previousTerraformDataDir = $env:TF_DATA_DIR
  New-Item -ItemType Directory -Path $terraformDataDir | Out-Null
  try {
    # An isolated data directory prevents a prior production/backend init in this
    # checkout from overriding the deliberately offline validation below.
    $env:TF_DATA_DIR = $terraformDataDir
    Invoke-NativeChecked $terraformExe @("-chdir=$(Join-Path $root 'infra/terraform')", 'fmt', '-recursive', '-check')
    Invoke-NativeChecked $terraformExe @("-chdir=$(Join-Path $root 'infra/terraform')", 'init', '-backend=false', '-input=false')
    Invoke-NativeChecked $terraformExe @("-chdir=$(Join-Path $root 'infra/terraform')", 'validate')
  } finally {
    $env:TF_DATA_DIR = $previousTerraformDataDir
    Remove-Item -LiteralPath $terraformDataDir -Recurse -Force
  }
}

Invoke-Step 'Operations and offline preflight unit tests' {
  $requiredPreflightSuites = @(
    'Evidence.Tests.ps1', 'MigrationCapacity.Tests.ps1', 'Feasibility.Tests.ps1',
    'NeonMigration.Tests.ps1', 'StorageInventory.Tests.ps1', 'Preflight.Tests.ps1'
  )
  foreach ($suite in $requiredPreflightSuites) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "tests/$suite"))) {
      throw "Required offline preflight suite is missing: $suite"
    }
  }
  $result = Invoke-Pester (Join-Path $PSScriptRoot 'tests') -PassThru
  if ($result.FailedCount -gt 0) { throw "$($result.FailedCount) Pester tests failed" }
  $failedContainers = @($result.Containers | Where-Object Result -eq 'Failed')
  if ($failedContainers.Count -gt 0) { throw "$($failedContainers.Count) Pester test containers failed during discovery or execution" }
}

if ($IncludeCutoverRehearsal) {
  Invoke-Step 'Disposable database cutover rehearsal' { & (Join-Path $PSScriptRoot 'rehearse-cutover.ps1') }
}

if ($IncludeRendererContainer) {
  Invoke-Step 'Disposable renderer container smoke' { & (Join-Path $PSScriptRoot 'test-renderer-container.ps1') }
}

Invoke-Step 'Git whitespace integrity' {
  Push-Location $root
  try { Invoke-NativeChecked git @('diff','--check') } finally { Pop-Location }
}

Write-Host 'All verification steps passed.' -ForegroundColor Green
