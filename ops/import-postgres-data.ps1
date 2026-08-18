#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$DumpDir,
  [Parameter(Mandatory)][string]$QuiescenceEvidencePath,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib/PostgresTools.psm1') -Force
$TargetDatabaseUrl = $env:DOC_AI_NEON_DIRECT_URL
if ([string]::IsNullOrWhiteSpace($TargetDatabaseUrl)) { throw 'DOC_AI_NEON_DIRECT_URL is required' }

$dump = Join-Path $DumpDir 'legacy-data.dump'
$manifestPath = Join-Path $DumpDir 'manifest.json'
$checksumPath = Join-Path $DumpDir 'legacy-data.dump.sha256'
foreach ($path in $dump, $manifestPath, $checksumPath, $QuiescenceEvidencePath) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Required recovery input is missing: $(Split-Path $path -Leaf)" }
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$quiescence = Get-Content -LiteralPath $QuiescenceEvidencePath -Raw | ConvertFrom-Json
if ($quiescence.writesStopped -ne $true) { throw 'Quiescence evidence does not confirm writes are stopped' }
if ((Get-Sha256Hash $QuiescenceEvidencePath) -ne $manifest.quiescenceEvidenceSha256) {
  throw 'Quiescence evidence differs from the evidence captured by the backup'
}
$expected = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
$actual = Get-Sha256Hash $dump
if ($expected -ne $actual -or $manifest.dump.sha256 -ne $actual) {
  throw 'Checksum mismatch for legacy-data.dump'
}

$targetUri = [uri]$TargetDatabaseUrl
if ($targetUri.Scheme -notin 'postgres','postgresql' -or
    -not $targetUri.DnsSafeHost.EndsWith('.neon.tech', [StringComparison]::OrdinalIgnoreCase) -or
    $targetUri.DnsSafeHost.Contains('-pooler', [StringComparison]::OrdinalIgnoreCase) -or
    $targetUri.Query -notmatch '(?i)(?:^|[?&])sslmode=(?:require|verify-full)(?:&|$)') {
  throw 'Target must be a direct TLS Neon database URL'
}
$target = Get-DatabaseIdentity $targetUri
if ($manifest.sourceIdentity.host -eq $target.Host -and [int]$manifest.sourceIdentity.port -eq $target.Port -and
    $manifest.sourceIdentity.database -eq $target.Database) {
  throw 'Source and target are the same database'
}
if (-not $Execute) { Write-Host 'PREVIEW: checksum and database identities passed; no restore executed.'; return }

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

Invoke-WithTargetEnvironment {
  $migrationCount = @(Invoke-NativeChecked psql @('--no-psqlrc','--tuples-only','--no-align',
      '--set','ON_ERROR_STOP=1','--command','SELECT count(*) FROM "_prisma_migrations";'))
  if ([int]([string]$migrationCount[0]).Trim() -lt 1) { throw 'Target is not Prisma-managed' }
  $targetRows = @(Invoke-NativeChecked psql @('--no-psqlrc','--tuples-only','--no-align',
      '--set','ON_ERROR_STOP=1','--command',
      'SELECT count(*) FROM "Document" UNION ALL SELECT count(*) FROM "Chunk" UNION ALL SELECT count(*) FROM "Feedback";'))
  if (($targetRows | ForEach-Object { [long]([string]$_).Trim() } | Measure-Object -Sum).Sum -ne 0) {
    throw 'Target application tables are not empty'
  }
  Invoke-NativeChecked pg_restore @('--data-only','--no-owner','--no-privileges',
    '--disable-triggers','--exit-on-error', $dump)
  Invoke-NativeChecked psql @('--no-psqlrc','--set','ON_ERROR_STOP=1','--command', @'
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT schemaname, sequencename FROM pg_sequences WHERE schemaname='public' LOOP
    EXECUTE format('SELECT setval(%L, COALESCE((SELECT max(id) FROM %I.%I), 1), true)',
      format('%I.%I', r.schemaname, r.sequencename), r.schemaname,
      regexp_replace(r.sequencename, '_id_seq$', ''));
  END LOOP;
END $$;
'@)
}
Write-Host 'Data-only import completed; migration history was preserved.'
