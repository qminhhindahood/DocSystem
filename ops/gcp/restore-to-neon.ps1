#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$DumpDirectory,
  [Parameter(Mandatory)][string]$QuiescenceEvidencePath,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ReleaseSha,
  [Parameter(Mandatory)][string]$EvidenceDirectory,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Import-Module (Join-Path $Root 'ops/lib/PostgresTools.psm1') -Force
Import-Module (Join-Path $Root 'ops/lib/Evidence.psm1') -Force
$EvidenceDirectory = Resolve-EvidencePath $EvidenceDirectory $Root
New-Item -ItemType Directory -Force $EvidenceDirectory | Out-Null
$EvidencePath = Join-Path $EvidenceDirectory 'restore-evidence.json'
$SourceUrl = $env:DOC_AI_SOURCE_DATABASE_URL
$TargetUrl = $env:DOC_AI_NEON_DIRECT_URL
if (-not $SourceUrl -or -not $TargetUrl) { throw 'Source and target database environment variables are required' }
$source = Get-DatabaseIdentity ([uri]$SourceUrl)
$targetUri = [uri]$TargetUrl
$target = Get-DatabaseIdentity $targetUri
if ($source.Host -eq $target.Host -and $source.Port -eq $target.Port -and $source.Database -eq $target.Database) {
  throw 'Source and target are the same database'
}
if (-not $targetUri.DnsSafeHost.EndsWith('.neon.tech', [StringComparison]::OrdinalIgnoreCase) -or
    $targetUri.DnsSafeHost.Contains('-pooler', [StringComparison]::OrdinalIgnoreCase) -or
    $targetUri.Query -notmatch '(?i)(?:^|[?&])sslmode=(?:require|verify-full)(?:&|$)') {
  throw 'Target must be a direct TLS Neon database URL'
}

$dump = Join-Path $DumpDirectory 'legacy-data.dump'
$manifestPath = Join-Path $DumpDirectory 'manifest.json'
$checksumPath = Join-Path $DumpDirectory 'legacy-data.dump.sha256'
foreach ($path in $dump, $manifestPath, $checksumPath, $QuiescenceEvidencePath) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Required recovery input is missing: $(Split-Path $path -Leaf)" }
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$dumpSha = Get-EvidenceSha256 $dump
if ((Get-Content $checksumPath -Raw).Trim() -ne $dumpSha -or $manifest.dump.sha256 -ne $dumpSha) {
  throw 'Recovery dump checksum mismatch'
}
if ((Get-EvidenceSha256 $QuiescenceEvidencePath) -ne $manifest.quiescenceEvidenceSha256) {
  throw 'Recovery quiescence evidence checksum mismatch'
}
$targetIdentityText = "$($target.Host):$($target.Port)/$($target.Database)"
$targetHashBytes = [Text.Encoding]::UTF8.GetBytes($targetIdentityText)
$targetHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($targetHashBytes)).ToLowerInvariant()
if (-not $Execute) {
  Write-EvidenceJson $EvidencePath ([ordered]@{
      schemaVersion = 1; releaseSha = $ReleaseSha; status = 'preview'; targetIdentityHash = $targetHash
      startedAt = [datetime]::UtcNow.ToString('o'); completedAt = $null; migrationCount = $null
      importDurationMs = $null; safeError = 'EXECUTE_REHEARSAL_REQUIRED'
    })
  return
}

function Invoke-WithTargetEnvironment([scriptblock]$Command) {
  $old = @{}
  foreach ($name in 'PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGCONNECT_TIMEOUT') {
    $old[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
  try {
    $credentials = $targetUri.UserInfo.Split(':', 2)
    $env:PGHOST = $targetUri.DnsSafeHost
    $env:PGPORT = if ($targetUri.Port -gt 0) { [string]$targetUri.Port } else { '5432' }
    $env:PGDATABASE = $targetUri.AbsolutePath.TrimStart('/')
    $env:PGUSER = [uri]::UnescapeDataString($credentials[0])
    $env:PGPASSWORD = if ($credentials.Count -gt 1) { [uri]::UnescapeDataString($credentials[1]) } else { '' }
    $env:PGSSLMODE = 'require'; $env:PGCONNECT_TIMEOUT = '15'
    & $Command
  } finally {
    foreach ($name in $old.Keys) { [Environment]::SetEnvironmentVariable($name, $old[$name], 'Process') }
  }
}

$started = [datetime]::UtcNow
try {
  Invoke-WithTargetEnvironment {
    $counts = @(Invoke-NativeChecked psql @('--no-psqlrc','--tuples-only','--no-align',
        '--set','ON_ERROR_STOP=1','--command', @'
SELECT count(*) FROM information_schema.tables WHERE table_schema='public';
SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='_prisma_migrations';
'@))
    if (@($counts).Count -ne 2 -or [int]([string]$counts[0]).Trim() -ne 0 -or
        [int]([string]$counts[1]).Trim() -ne 0) {
      throw 'Disposable Neon target is not empty'
    }
  }

  $oldDatabaseUrl = $env:DATABASE_URL
  try {
    $env:DATABASE_URL = $TargetUrl
    Invoke-NativeChecked npm @('--prefix', (Join-Path $Root 'backend'), 'run', 'prisma:deploy:fresh')
  } finally { $env:DATABASE_URL = $oldDatabaseUrl }

  $timer = [Diagnostics.Stopwatch]::StartNew()
  & (Join-Path $Root 'ops/import-postgres-data.ps1') -DumpDir $DumpDirectory `
    -QuiescenceEvidencePath $QuiescenceEvidencePath -Execute
  if (-not $?) { throw 'Data-only import failed' }
  $timer.Stop()
  $migrationCount = Invoke-WithTargetEnvironment {
    $value = @(Invoke-NativeChecked psql @('--no-psqlrc','--tuples-only','--no-align',
        '--set','ON_ERROR_STOP=1','--command','SELECT count(*) FROM "_prisma_migrations";'))
    [int]([string]$value[0]).Trim()
  }
  Write-EvidenceJson $EvidencePath ([ordered]@{
      schemaVersion = 1; releaseSha = $ReleaseSha; status = 'passed'; targetIdentityHash = $targetHash
      startedAt = $started.ToString('o'); completedAt = [datetime]::UtcNow.ToString('o')
      migrationCount = $migrationCount; importDurationMs = [double]$timer.Elapsed.TotalMilliseconds
      safeError = $null
    })
} catch {
  Write-EvidenceJson $EvidencePath ([ordered]@{
      schemaVersion = 1; releaseSha = $ReleaseSha; status = 'failed'; targetIdentityHash = $targetHash
      startedAt = $started.ToString('o'); completedAt = [datetime]::UtcNow.ToString('o')
      migrationCount = $null; importDurationMs = $null; safeError = 'NEON_RESTORE_REHEARSAL_FAILED'
    })
  throw
}
Assert-EvidenceContainsNoSecrets $EvidenceDirectory
