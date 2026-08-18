#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$SourceManifestPath,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ReleaseSha,
  [Parameter(Mandatory)][string]$EvidenceDirectory
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Import-Module (Join-Path $Root 'ops/lib/PostgresTools.psm1') -Force
Import-Module (Join-Path $Root 'ops/lib/Evidence.psm1') -Force
$EvidenceDirectory = Resolve-EvidencePath $EvidenceDirectory $Root
New-Item -ItemType Directory -Force $EvidenceDirectory | Out-Null
$OutputPath = Join-Path $EvidenceDirectory 'restore-verification.json'
$TargetUrl = $env:DOC_AI_NEON_DIRECT_URL
if (-not $TargetUrl) { throw 'DOC_AI_NEON_DIRECT_URL is required' }
if (-not (Test-Path -LiteralPath $SourceManifestPath)) { throw 'Source manifest is required' }
$source = Get-Content -LiteralPath $SourceManifestPath -Raw | ConvertFrom-Json -AsHashtable
$targetUri = [uri]$TargetUrl

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
  } finally { foreach ($name in $old.Keys) { [Environment]::SetEnvironmentVariable($name, $old[$name], 'Process') } }
}

function Get-TargetLines([string]$Query) {
  Invoke-WithTargetEnvironment {
    @(Invoke-NativeChecked psql @('--no-psqlrc','--tuples-only','--no-align',
        '--set','ON_ERROR_STOP=1','--command', $Query)) |
      ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ }
  }
}

$checks = @()
function Add-Check([string]$Name, [bool]$Passed, [string]$SafeError = $null) {
  $script:checks += [ordered]@{
    name = $Name; status = if ($Passed) { 'passed' } else { 'failed' }
    safeError = if ($Passed) { $null } else { $SafeError }
  }
}

try {
  $targetCounts = [ordered]@{}
  foreach ($row in Get-TargetLines @'
SELECT table_name || E'\t' || (xpath('/row/c/text()', query_to_xml(
  'SELECT count(*) AS c FROM ' || quote_ident(table_schema) || '.' || quote_ident(table_name),
  true, false, '')))[1]::text::bigint
FROM information_schema.tables
WHERE table_schema='public' AND table_name <> '_prisma_migrations' ORDER BY table_name;
'@) {
    $parts = $row.Split("`t", 2); $targetCounts[$parts[0]] = [long]$parts[1]
  }
  Add-Check row-counts ((ConvertTo-Json $targetCounts -Compress) -eq
      (ConvertTo-Json $source.rowCounts -Compress)) 'ROW_COUNTS_MISMATCH'

  $projections = [ordered]@{
    User = 'SELECT id, username, email, "isDisabled", "sessionVersion" FROM "User" ORDER BY id'
    Document = 'SELECT id, "ownerId", "docType", title, status, "ingestionStatus" FROM "Document" ORDER BY id'
    Template = 'SELECT id, "ownerId", name, "docType", status FROM "Template" ORDER BY id'
    Chunk = 'SELECT id, "documentId", level, article, clause, point, "contentHash" FROM "Chunk" ORDER BY id'
    UserLLMConfig = 'SELECT id, "userId", provider, model, "baseUrl" FROM "UserLLMConfig" ORDER BY id'
  }
  foreach ($entry in $projections.GetEnumerator()) {
    $lines = Get-TargetLines "COPY ($($entry.Value)) TO STDOUT WITH (FORMAT csv, HEADER false, NULL '\N');"
    $bytes = [Text.Encoding]::UTF8.GetBytes([string]::Join("`n", $lines))
    $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
    Add-Check "checksum-$($entry.Key)" ($hash -eq $source.stableScalarChecksums[$entry.Key]) `
      'STABLE_SCALAR_CHECKSUM_MISMATCH'
  }

  $ownership = [long](Get-TargetLines @'
SELECT (SELECT count(*) FROM "Document" d LEFT JOIN "User" u ON u.id=d."ownerId" WHERE u.id IS NULL) +
       (SELECT count(*) FROM "Template" t LEFT JOIN "User" u ON u.id=t."ownerId" WHERE u.id IS NULL);
'@)[0]
  Add-Check owner-references ($ownership -eq 0) 'DANGLING_OWNER_REFERENCE'

  $vector = (Get-TargetLines @'
SELECT count(*) FILTER (WHERE embedding IS NOT NULL)::bigint || E'\t' ||
       COALESCE(max(vector_dims(embedding)) FILTER (WHERE embedding IS NOT NULL), 0)::int FROM "Chunk";
'@)[0].Split("`t", 2)
  Add-Check vectors ([long]$vector[0] -eq [long]$source.vectors.nonNullCount -and
      ([long]$vector[0] -eq 0 -or [int]$vector[1] -eq 1024)) 'VECTOR_CONTRACT_MISMATCH'

  $representative = [long](Get-TargetLines `
    'SELECT count(*) FROM (SELECT d.id FROM "Document" d JOIN "User" u ON u.id=d."ownerId" LIMIT 1) q;')[0]
  Add-Check owner-scoped-query ($representative -ge 0) 'OWNER_SCOPED_QUERY_FAILED'

  $migrationCount = [long](Get-TargetLines 'SELECT count(*) FROM "_prisma_migrations";')[0]
  Add-Check prisma-migrations ($migrationCount -gt 0) 'PRISMA_MIGRATIONS_MISSING'

  if ([long]$source.vectors.nonNullCount -gt 0) {
    $nearest = Get-TargetLines 'SELECT id FROM "Chunk" WHERE embedding IS NOT NULL ORDER BY embedding <=> embedding LIMIT 1;'
    Add-Check vector-query (@($nearest).Count -eq 1) 'VECTOR_QUERY_FAILED'
  } else { Add-Check vector-query $true }

  $providerRows = @(Get-TargetLines @'
SELECT "encryptedApiKey" || E'\t' || "apiKeyIv" || E'\t' || "apiKeyAuthTag"
FROM "UserLLMConfig" WHERE "encryptedApiKey" <> '' ORDER BY id;
'@)
  $decryptable = 0
  if ($providerRows.Count -gt 0 -and $env:LLM_CONFIG_ENCRYPTION_KEY -match '^[a-fA-F0-9]{64}$') {
    $key = [Convert]::FromHexString($env:LLM_CONFIG_ENCRYPTION_KEY)
    foreach ($row in $providerRows) {
      try {
        $parts = $row.Split("`t", 3)
        $ciphertext = [Convert]::FromBase64String($parts[0]); $nonce = [Convert]::FromBase64String($parts[1])
        $tag = [Convert]::FromBase64String($parts[2]); $plaintext = [byte[]]::new($ciphertext.Length)
        try {
          $aes = [Security.Cryptography.AesGcm]::new($key, $tag.Length)
          try { $aes.Decrypt($nonce, $ciphertext, $tag, $plaintext) } finally { $aes.Dispose() }
          $decryptable++
        } finally { [Array]::Clear($plaintext, 0, $plaintext.Length) }
      } catch { }
    }
    [Array]::Clear($key, 0, $key.Length)
  }
  Add-Check provider-ciphertexts ($providerRows.Count -eq [long]$source.providerCiphertextCount -and
      $decryptable -eq [long]$source.providerDecryptableCount) 'PROVIDER_CIPHERTEXT_RECOVERY_MISMATCH'

  if ($env:DOC_AI_RESTORED_BACKEND_URL) {
    try {
      $ready = Invoke-RestMethod -Method Get -Uri "$($env:DOC_AI_RESTORED_BACKEND_URL.TrimEnd('/'))/ready" -TimeoutSec 15
      Add-Check backend-readiness ($ready.status -in 'ready','ok') 'BACKEND_NOT_READY'
    } catch { Add-Check backend-readiness $false 'BACKEND_READINESS_FAILED' }
  } else { Add-Check backend-readiness $false 'BACKEND_READINESS_URL_MISSING' }
} catch {
  Add-Check verification-execution $false 'RESTORE_VERIFICATION_QUERY_FAILED'
}

$passed = @($checks | Where-Object { $_.status -ne 'passed' }).Count -eq 0
Write-EvidenceJson $OutputPath ([ordered]@{
    schemaVersion = 1; releaseSha = $ReleaseSha; status = if ($passed) { 'passed' } else { 'failed' }
    verifiedAt = [datetime]::UtcNow.ToString('o'); sourceManifestSha256 = Get-EvidenceSha256 $SourceManifestPath
    checks = $checks
  })
Assert-EvidenceContainsNoSecrets $EvidenceDirectory
if (-not $passed) { exit 2 }
