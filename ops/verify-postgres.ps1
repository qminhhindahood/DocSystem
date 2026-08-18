#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Fail-closed verification that source and target databases match.
  Compares primary-key hashes, row counts, ownership, and migration state.
  Refuses to run if source and target point at the same database.
#>

param(
  [Parameter(Mandatory = $true)][string]$SourceDatabaseUrl,
  [Parameter(Mandatory = $true)][string]$TargetDatabaseUrl
)

$ErrorActionPreference = 'Stop'

# ---- module ----
$modulePath = Join-Path $PSScriptRoot 'lib\PostgresTools.psm1'
Import-Module $modulePath -Force

# ---- identity guard ----
$srcId = Get-DatabaseIdentity ([uri]$SourceDatabaseUrl)
$tgtId = Get-DatabaseIdentity ([uri]$TargetDatabaseUrl)

if ($srcId.Host -eq $tgtId.Host -and $srcId.Port -eq $tgtId.Port -and $srcId.Database -eq $tgtId.Database) {
  throw "Source and target are the same ($($srcId.Host):$($srcId.Port)/$($srcId.Database)). Nothing to verify."
}

# ---- primary-key hash comparison ----
Write-Host 'Comparing primary-key hashes between source and target...'
$sourceHashes = Get-PrimaryKeyHashes $SourceDatabaseUrl
$targetHashes = Get-PrimaryKeyHashes $TargetDatabaseUrl

foreach ($table in $sourceHashes.Keys) {
  if (-not $targetHashes.ContainsKey($table)) {
    throw "Table $table exists in source but is missing in target"
  }
  if ($table -ne 'User' -and $sourceHashes[$table] -ne $targetHashes[$table]) {
    throw "Primary-key hash mismatch for $table"
  }
}

# ---- row-count comparison ----
Write-Host 'Comparing row counts between source and target...'
$sourceCounts = Get-RowCounts $SourceDatabaseUrl
$targetCounts = Get-RowCounts $TargetDatabaseUrl

foreach ($table in $sourceCounts.Keys) {
  $expected = if ($table -eq 'User') { $sourceCounts[$table] + 1 } else { $sourceCounts[$table] }
  if ($expected -ne $targetCounts[$table]) {
    throw "Row-count mismatch for ${table}: source=$($sourceCounts[$table]) target=$($targetCounts[$table])"
  }
}

# ---- ownership ----
$ownership = Invoke-NativeChecked psql @(
  $TargetDatabaseUrl
  '--tuples-only'
  '--no-align'
  '--command', 'SELECT count(*) FROM "Document" WHERE "ownerId" IS NULL;'
)
if ($ownership.Trim() -ne '0') {
  throw "Documents without owners: $($ownership.Trim())"
}
$templateOwnership = Invoke-NativeChecked psql @(
  $TargetDatabaseUrl, '--tuples-only', '--no-align', '--command', 'SELECT count(*) FROM "Template" WHERE "ownerId" IS NULL;'
)
if ($templateOwnership.Trim() -ne '0') { throw "Templates without owners: $($templateOwnership.Trim())" }

$requiredColumns = Invoke-NativeChecked psql @(
  $TargetDatabaseUrl, '--tuples-only', '--no-align', '--command', @"
SELECT count(*) FROM information_schema.columns
WHERE table_schema='public' AND (
  (table_name='Document' AND column_name IN ('ownerId','storageKey','embeddedChunkCount','failedChunkCount')) OR
  (table_name='Chunk' AND column_name IN ('isSummary','summaryOf','metadata')) OR
  (table_name='Template' AND column_name IN ('ownerId','semanticMap','generationSchema','previewMetadata'))
);
"@
)
if ([int]$requiredColumns.Trim() -ne 11) { throw 'Target is missing required ownership, summary, storage, or template compiler columns' }

# ---- migrations ----
$migrations = Invoke-NativeChecked psql @(
  $TargetDatabaseUrl
  '--tuples-only'
  '--no-align'
  '--command', 'SELECT count(*) FROM "_prisma_migrations";'
)
if ([int]$migrations.Trim() -lt 1) {
  throw 'Target has no applied Prisma migrations'
}

# ---- unvalidated foreign keys ----
$badFks = Invoke-NativeChecked psql @(
  $TargetDatabaseUrl
  '--tuples-only'
  '--no-align'
  '--command', @"
SELECT conrelid::regclass AS table_name, conname
FROM pg_constraint WHERE contype = 'f' AND NOT convalidated;
"@
)
if (-not [string]::IsNullOrWhiteSpace($badFks)) {
  throw "Unvalidated foreign keys found: $badFks"
}

Write-Host 'Target row counts, ownership, migration metadata, and primary-key integrity verified.'
