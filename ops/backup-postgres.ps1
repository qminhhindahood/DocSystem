#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [string]$OutputDir = ".artifacts/releases/$((git rev-parse HEAD).Trim())/00-preflight/database-backup",
  [Parameter(Mandatory)][string]$QuiescenceEvidencePath,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
Import-Module (Join-Path $PSScriptRoot 'lib/PostgresTools.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'lib/Evidence.psm1') -Force

$DatabaseUrl = $env:DOC_AI_SOURCE_DATABASE_URL
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) { throw 'DOC_AI_SOURCE_DATABASE_URL is required' }
if (-not (Test-Path -LiteralPath $QuiescenceEvidencePath)) { throw 'Quiescence evidence file is required' }
$identity = Get-DatabaseIdentity ([uri]$DatabaseUrl)
$quiescence = Get-Content -LiteralPath $QuiescenceEvidencePath -Raw | ConvertFrom-Json
if ($quiescence.writesStopped -ne $true) { throw 'Quiescence evidence does not confirm writes are stopped' }
if ($quiescence.sourceHost -ne $identity.Host -or [int]$quiescence.sourcePort -ne $identity.Port -or
    $quiescence.sourceDatabase -ne $identity.Database) {
  throw 'Quiescence evidence does not match the source database identity'
}

$OutputDir = Resolve-EvidencePath $OutputDir $Root
if (-not $Execute) {
  Write-Host "PREVIEW: would create an encrypted data-only backup under $OutputDir"
  return
}
if (-not $env:DOC_AI_AGE_RECIPIENT) { throw 'DOC_AI_AGE_RECIPIENT is required' }
if (-not (Get-Command age -ErrorAction SilentlyContinue)) { throw 'age CLI is required' }

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$dump = Join-Path $OutputDir 'legacy-data.dump'
$encryptedDump = Join-Path $OutputDir 'legacy-data.dump.age'
$checksumPath = Join-Path $OutputDir 'legacy-data.dump.sha256'
$countsPath = Join-Path $OutputDir 'legacy-row-counts.json'
$schemaPath = Join-Path $OutputDir 'schema-metadata.txt'
$manifestPath = Join-Path $OutputDir 'manifest.json'

Invoke-NativeChecked pg_dump @(
  $DatabaseUrl, '--format=custom', '--data-only', '--no-owner', '--no-privileges',
  '--exclude-table=public._prisma_migrations', "--file=$dump"
)
if (-not (Test-Path -LiteralPath $dump) -or (Get-Item $dump).Length -le 0) {
  throw 'PostgreSQL dump was not created'
}

function Invoke-SourceQuery([string]$Query) {
  $output = @(Invoke-NativeChecked psql @(
      $DatabaseUrl, '--no-psqlrc', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1',
      '--command', $Query
    ))
  return @($output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
}

$rowCounts = [ordered]@{}
foreach ($row in Invoke-SourceQuery @'
SELECT table_name || E'\t' || (xpath('/row/c/text()', query_to_xml(
  'SELECT count(*) AS c FROM ' || quote_ident(table_schema) || '.' || quote_ident(table_name),
  true, false, '')))[1]::text::bigint
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY table_name;
'@) {
  $parts = $row.Split("`t", 2); $rowCounts[$parts[0]] = [long]$parts[1]
}
Write-EvidenceJson $countsPath $rowCounts

$stableChecksums = [ordered]@{}
$projections = [ordered]@{
  User = 'SELECT id, username, email, "isDisabled", "sessionVersion" FROM "User" ORDER BY id'
  Document = 'SELECT id, "ownerId", "docType", title, status, "ingestionStatus" FROM "Document" ORDER BY id'
  Template = 'SELECT id, "ownerId", name, "docType", status FROM "Template" ORDER BY id'
  Chunk = 'SELECT id, "documentId", level, article, clause, point, "contentHash" FROM "Chunk" ORDER BY id'
  UserLLMConfig = 'SELECT id, "userId", provider, model, "baseUrl" FROM "UserLLMConfig" ORDER BY id'
}
foreach ($entry in $projections.GetEnumerator()) {
  $lines = Invoke-SourceQuery "COPY ($($entry.Value)) TO STDOUT WITH (FORMAT csv, HEADER false, NULL '\N');"
  $bytes = [Text.Encoding]::UTF8.GetBytes([string]::Join("`n", $lines))
  $stableChecksums[$entry.Key] = [Convert]::ToHexString(
    [Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

$vectorRow = (Invoke-SourceQuery @'
SELECT count(*) FILTER (WHERE embedding IS NOT NULL)::bigint || E'\t' ||
       COALESCE(max(vector_dims(embedding)) FILTER (WHERE embedding IS NOT NULL), 0)::int
FROM "Chunk";
'@)[0].Split("`t", 2)
$providerRows = @(Invoke-SourceQuery @'
SELECT "encryptedApiKey" || E'\t' || "apiKeyIv" || E'\t' || "apiKeyAuthTag"
FROM "UserLLMConfig" WHERE "encryptedApiKey" <> '' ORDER BY id;
'@)
$providerDecryptableCount = 0
if ($providerRows.Count -gt 0) {
  if ($env:LLM_CONFIG_ENCRYPTION_KEY -notmatch '^[a-fA-F0-9]{64}$') {
    throw 'LLM_CONFIG_ENCRYPTION_KEY is required to verify provider ciphertext recovery'
  }
  $key = [Convert]::FromHexString($env:LLM_CONFIG_ENCRYPTION_KEY)
  foreach ($row in $providerRows) {
    $parts = $row.Split("`t", 3)
    if ($parts.Count -ne 3) { throw 'Provider ciphertext record is malformed' }
    $ciphertext = [Convert]::FromBase64String($parts[0])
    $nonce = [Convert]::FromBase64String($parts[1])
    $tag = [Convert]::FromBase64String($parts[2])
    $plaintext = [byte[]]::new($ciphertext.Length)
    try {
      $aes = [Security.Cryptography.AesGcm]::new($key, $tag.Length)
      try { $aes.Decrypt($nonce, $ciphertext, $tag, $plaintext) } finally { $aes.Dispose() }
      $providerDecryptableCount++
    } finally { [Array]::Clear($plaintext, 0, $plaintext.Length) }
  }
  [Array]::Clear($key, 0, $key.Length)
}

Invoke-NativeChecked pg_restore @('--list', $dump) | Set-Content -LiteralPath $schemaPath -Encoding utf8NoBOM
$dumpSha = Get-Sha256Hash $dump
Set-Content -LiteralPath $checksumPath -Value $dumpSha -Encoding ascii
Invoke-NativeChecked age @('-r', $env:DOC_AI_AGE_RECIPIENT, '-o', $encryptedDump, $dump)
if (-not (Test-Path -LiteralPath $encryptedDump) -or (Get-Item $encryptedDump).Length -le 0) {
  throw 'Encrypted backup was not created'
}

$manifest = [ordered]@{
  version = 2
  backupTimestamp = [datetime]::UtcNow.ToString('o')
  sourceIdentity = [ordered]@{ host = $identity.Host; port = $identity.Port; database = $identity.Database }
  dump = [ordered]@{ file = 'legacy-data.dump'; sha256 = $dumpSha; format = 'postgres-custom-data-only' }
  encryptedDump = [ordered]@{
    file = 'legacy-data.dump.age'; sha256 = Get-Sha256Hash $encryptedDump; format = 'age'
  }
  rowCounts = $rowCounts
  rowCountsSha256 = Get-EvidenceSha256 $countsPath
  stableScalarChecksums = $stableChecksums
  vectors = [ordered]@{ nonNullCount = [long]$vectorRow[0]; dimensions = [int]$vectorRow[1] }
  providerCiphertextCount = $providerRows.Count
  providerDecryptableCount = $providerDecryptableCount
  schemaMetadata = [ordered]@{ file = 'schema-metadata.txt'; sha256 = Get-EvidenceSha256 $schemaPath }
  quiescenceEvidenceSha256 = Get-EvidenceSha256 $QuiescenceEvidencePath
}
Write-EvidenceJson $manifestPath $manifest
Assert-EvidenceContainsNoSecrets $OutputDir
Write-Host "Encrypted data-only backup written under $OutputDir"
