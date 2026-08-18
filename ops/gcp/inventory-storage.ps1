#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
  [Parameter(Mandatory)][ValidateSet('asia-southeast1')][string]$SourceRegion,
  [Parameter(Mandatory)][string]$TemplatesBucket,
  [Parameter(Mandatory)][string]$UploadsBucket,
  [Parameter(Mandatory)][string]$RagStateBucket,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ReleaseSha,
  [Parameter(Mandatory)][string]$EvidenceDirectory
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Import-Module (Join-Path $Root 'ops/lib/Evidence.psm1') -Force
Import-Module (Join-Path $Root 'ops/lib/PreflightPolicy.psm1') -Force
$EvidenceDirectory = Resolve-EvidencePath $EvidenceDirectory $Root
New-Item -ItemType Directory -Force $EvidenceDirectory | Out-Null

$expected = [ordered]@{
  templates = "docai-templates-$ProjectId"
  uploads = "docai-uploads-$ProjectId"
  ragState = "docai-rag-state-$ProjectId"
}
$provided = [ordered]@{ templates = $TemplatesBucket; uploads = $UploadsBucket; ragState = $RagStateBucket }
foreach ($name in $expected.Keys) {
  if ($provided[$name] -ne $expected[$name]) {
    throw "Bucket $($provided[$name]) is not scoped to the exact project role $name"
  }
}

$gcloud = Get-Command gcloud -ErrorAction Stop
$records = @()
foreach ($bucket in $provided.Values) {
  $bucketDescription = & $gcloud.Source storage buckets describe "gs://$bucket" `
    --project=$ProjectId --format=json 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Unable to describe scoped bucket $bucket" }
  $description = [string]::Join("`n", @($bucketDescription)) | ConvertFrom-Json
  if ([string]$description.name -ne $bucket -or
      [string]$description.location -notin $SourceRegion, $SourceRegion.ToUpperInvariant()) {
    throw "Bucket $bucket identity or source region does not match"
  }
  $json = & $gcloud.Source storage ls --all-versions --recursive --json "gs://$bucket/**" `
    --project=$ProjectId 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Unable to inventory scoped bucket $bucket" }
  $text = [string]::Join("`n", @($json))
  if (-not [string]::IsNullOrWhiteSpace($text)) {
    foreach ($row in @($text | ConvertFrom-Json -Depth 30)) {
      $normalized = Convert-GcsObjectRecord $row
      if ($normalized.bucket -ne $bucket) { throw "Inventory returned an object outside bucket $bucket" }
      $records += $normalized
    }
  }
}

$records = @($records | Sort-Object bucket, name, @{ Expression = { [decimal]$_.generation } })
$live = @($records | Where-Object live)
$allPath = Join-Path $EvidenceDirectory 'source-all-versions.jsonl'
$livePath = Join-Path $EvidenceDirectory 'source-live-objects.jsonl'
function Write-JsonLines([string]$Path, [object[]]$Rows) {
  $safe = Resolve-EvidencePath $Path $Root
  $writer = [IO.StreamWriter]::new($safe, $false, [Text.UTF8Encoding]::new($false))
  try {
    foreach ($row in $Rows) { $writer.WriteLine(($row | ConvertTo-Json -Compress -Depth 10)) }
  } finally { $writer.Dispose() }
}
Write-JsonLines $allPath $records
Write-JsonLines $livePath $live

$bytesByPrefix = [ordered]@{}
foreach ($row in $records) {
  $prefix = if ($row.name.Contains('/')) { $row.name.Split('/')[0] } else { '(root)' }
  $key = "$($row.bucket)/$prefix"
  if (-not $bytesByPrefix.Contains($key)) { $bytesByPrefix[$key] = 0L }
  $bytesByPrefix[$key] = [long]$bytesByPrefix[$key] + [long]$row.size
}
$liveBytes = [long](($live | Measure-Object size -Sum).Sum ?? 0)
$allBytes = [long](($records | Measure-Object size -Sum).Sum ?? 0)
$archiveBytes = $allBytes - $liveBytes
$classA = [long]$live.Count
$classB = [long]$live.Count + [long]$provided.Count
$summary = [ordered]@{
  schemaVersion = 1; releaseSha = $ReleaseSha; observedAt = [datetime]::UtcNow.ToString('o')
  sourceRegion = $SourceRegion; buckets = @($provided.Values); totalVersions = $records.Count
  liveObjects = $live.Count; totalBytes = $allBytes; projectedTargetLiveBytes = $liveBytes
  historicalArchiveBytes = $archiveBytes; projectedClassAOperations = $classA
  projectedClassBOperations = $classB; bytesByPrefix = $bytesByPrefix
  manifests = [ordered]@{
    allVersions = [ordered]@{ path = [IO.Path]::GetRelativePath($Root, $allPath).Replace('\','/'); sha256 = Get-EvidenceSha256 $allPath }
    liveObjects = [ordered]@{ path = [IO.Path]::GetRelativePath($Root, $livePath).Replace('\','/'); sha256 = Get-EvidenceSha256 $livePath }
  }
}
Write-EvidenceJson (Join-Path $EvidenceDirectory 'source-storage-summary.json') $summary

$rates = $null; $sourceHash = $null
if ($env:DOC_AI_MIGRATION_PRICING_JSON) {
  try {
    $pricing = $env:DOC_AI_MIGRATION_PRICING_JSON | ConvertFrom-Json -AsHashtable
    $rates = $pricing.rates; $sourceHash = [string]$pricing.sourceSnapshotSha256
  } catch { $rates = $null; $sourceHash = $null }
}
$estimate = Get-MigrationCostEstimate -LiveBytes $liveBytes -ArchiveBytes $archiveBytes `
  -ClassAOperations $classA -ClassBOperations $classB -Rates $rates `
  -SourceSnapshotSha256 $sourceHash
$costEvidence = [ordered]@{
  schemaVersion = 1; releaseSha = $ReleaseSha; observedAt = [datetime]::UtcNow.ToString('o')
  sourceRegion = $SourceRegion; targetRegion = 'us-central1'; liveBytes = $liveBytes
  archiveBytes = $archiveBytes; projectedCopyOperations = $classA
  projectedVerificationOperations = $classB; ratesKnown = $estimate.ratesKnown
  sourceSnapshotSha256 = $estimate.sourceSnapshotSha256
  migrationCostUsd = $estimate.migrationCostUsd; requiresApproval = $estimate.requiresApproval
}
Write-EvidenceJson (Join-Path $EvidenceDirectory 'migration-cost-estimate.json') $costEvidence
Assert-EvidenceContainsNoSecrets $EvidenceDirectory
