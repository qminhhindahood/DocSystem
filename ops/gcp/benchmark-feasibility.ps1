#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ReleaseSha,
  [Parameter(Mandatory)][string]$EvidenceDirectory
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Import-Module (Join-Path $Root 'ops/lib/Evidence.psm1') -Force
Import-Module (Join-Path $Root 'ops/lib/PreflightPolicy.psm1') -Force
$EvidenceDirectory = Resolve-EvidencePath $EvidenceDirectory $Root
New-Item -ItemType Directory -Force $EvidenceDirectory | Out-Null
$Now = [datetime]::UtcNow
$Config = Get-Content (Join-Path $Root 'ops/config/zero-cost-ceilings.json') -Raw |
  ConvertFrom-Json -AsHashtable

function Invoke-NativeChecked {
  param([string]$FilePath, [string[]]$Arguments)
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$FilePath failed" }
}

function Invoke-PsqlLatency([string]$DatabaseUrl) {
  $psql = Get-Command psql -ErrorAction Stop
  $uri = [uri]$DatabaseUrl
  if ($uri.Scheme -notin 'postgres','postgresql') { throw 'Database URL scheme is invalid' }
  $old = @{}
  foreach ($name in 'PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGCONNECT_TIMEOUT') {
    $old[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
  try {
    $credentials = $uri.UserInfo.Split(':', 2)
    $env:PGHOST = $uri.DnsSafeHost
    $env:PGPORT = if ($uri.Port -gt 0) { [string]$uri.Port } else { '5432' }
    $env:PGDATABASE = $uri.AbsolutePath.TrimStart('/')
    $env:PGUSER = [uri]::UnescapeDataString($credentials[0])
    $env:PGPASSWORD = if ($credentials.Count -gt 1) { [uri]::UnescapeDataString($credentials[1]) } else { '' }
    $env:PGSSLMODE = 'require'; $env:PGCONNECT_TIMEOUT = '15'
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $result = & $psql.Source --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 `
      --command 'SELECT 1;' 2>$null
    $timer.Stop()
    if ($LASTEXITCODE -ne 0 -or ([string]$result).Trim() -ne '1') { throw 'Neon query sample failed' }
    return [double]$timer.Elapsed.TotalMilliseconds
  } finally {
    foreach ($name in $old.Keys) { [Environment]::SetEnvironmentVariable($name, $old[$name], 'Process') }
  }
}

function Get-FreeTcpPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

function Get-DirectoryManifestSha256([string]$Directory) {
  $rows = foreach ($file in Get-ChildItem -LiteralPath $Directory -File -Recurse | Sort-Object FullName) {
    $relative = [IO.Path]::GetRelativePath($Directory, $file.FullName).Replace('\','/')
    "$relative`t$((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant())"
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes([string]::Join("`n", @($rows)))
  [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

# Build every retained image and conservatively count current plus rollback.
$docker = Get-Command docker -ErrorAction Stop
$contexts = [ordered]@{
  backend = 'backend'; frontend = 'frontend'; docling = 'docling-service'
  embeddings = 'embeddings-service'; renderer = 'document-renderer'
}
$imageRows = @()
$imageErrors = @()
foreach ($name in $contexts.Keys) {
  $tag = "local/docai-$name`:preflight"
  $context = Join-Path $Root $contexts[$name]
  try {
    Invoke-NativeChecked $docker.Source @('build','-t',$tag,$context)
    $inspectText = & $docker.Source image inspect $tag --format '{{json .}}'
    if ($LASTEXITCODE -ne 0) { throw 'Docker image inspection failed' }
    $inspect = $inspectText | ConvertFrom-Json
    $dockerfile = Join-Path $context 'Dockerfile'
    $digests = @([regex]::Matches((Get-Content $dockerfile -Raw),
        '(?im)^FROM\s+\S+@sha256:([a-f0-9]{64})') | ForEach-Object { $_.Groups[1].Value } |
        Sort-Object -Unique)
    if ($digests.Count -eq 0) { $imageErrors += "UNPINNED_BASE_IMAGE:$name" }
    $imageRows += [ordered]@{
      name = $name; tag = $tag; imageId = [string]$inspect.Id; sizeBytes = [long]$inspect.Size
      baseImageDigests = $digests; status = if ($digests.Count) { 'passed' } else { 'blocked' }
    }
  } catch {
    $imageErrors += "IMAGE_BUILD_FAILED:$name"
    $imageRows += [ordered]@{
      name = $name; tag = $tag; imageId = $null; sizeBytes = $null
      baseImageDigests = @(); status = 'blocked'
    }
  }
}
$validSizes = @($imageRows | Where-Object { $null -ne $_.sizeBytes } | ForEach-Object { [long]$_.sizeBytes })
$footprint = if ($validSizes.Count -eq $contexts.Count) {
  Measure-RetainedImageBytes -ImageSizes $validSizes `
    -Ceiling ([long]$Config.metrics.artifactRegistryBytes.internalCeiling)
} else {
  [pscustomobject]@{ retainedBytes = $null; ceiling = [long]$Config.metrics.artifactRegistryBytes.internalCeiling; status = 'blocked' }
}
$recurringCost = [ordered]@{
  ratesKnown = $false; sourceSnapshotSha256 = $null; freeBytes = $null
  ratePerGiBMonth = $null; monthlyCostUsd = $null; requiresApproval = $true
}
if ($null -ne $footprint.retainedBytes -and $env:DOC_AI_ARTIFACT_REGISTRY_PRICING_JSON) {
  try {
    $pricing = $env:DOC_AI_ARTIFACT_REGISTRY_PRICING_JSON | ConvertFrom-Json
    $estimate = Get-ArtifactRegistryMonthlyCostEstimate `
      -RetainedBytes ([long]$footprint.retainedBytes) -FreeBytes $pricing.freeBytes `
      -RatePerGiBMonth $pricing.ratePerGiBMonth `
      -SourceSnapshotSha256 ([string]$pricing.sourceSnapshotSha256)
    $recurringCost = [ordered]@{
      ratesKnown = $estimate.ratesKnown
      sourceSnapshotSha256 = $estimate.sourceSnapshotSha256
      freeBytes = $estimate.freeBytes
      ratePerGiBMonth = $estimate.ratePerGiBMonth
      monthlyCostUsd = $estimate.monthlyCostUsd
      requiresApproval = $estimate.requiresApproval
    }
  } catch { }
}
$imageStatus = if ($validSizes.Count -eq $contexts.Count -and $imageErrors.Count -eq 0) {
  'passed'
} else {
  'blocked'
}
Write-EvidenceJson (Join-Path $EvidenceDirectory 'image-footprint.json') ([ordered]@{
    schemaVersion = 1; releaseSha = $ReleaseSha; observedAt = $Now.ToString('o')
    status = $imageStatus; retainedBytes = $footprint.retainedBytes; ceiling = $footprint.ceiling
    zeroCostFeasible = [bool]($footprint.status -eq 'passed')
    retentionCopies = 2; recurringCost = $recurringCost
    images = $imageRows; safeErrors = $imageErrors
  })

# Benchmark every declared Neon candidate exactly twenty times.
$regionRows = [ordered]@{}
$regionStatus = 'blocked'; $selectedRegion = 'aws-us-east-2'
try {
  if (-not $env:DOC_AI_NEON_CANDIDATE_URLS_JSON) { throw 'Candidate URLs are unavailable' }
  $candidates = $env:DOC_AI_NEON_CANDIDATE_URLS_JSON | ConvertFrom-Json -AsHashtable
  foreach ($region in @($candidates.Keys | Sort-Object)) {
    $candidate = $candidates[$region]
    $url = if ($candidate -is [string]) { $candidate } else { $candidate.url }
    $available = if ($candidate -is [string] -or $null -eq $candidate.availableOnFreePlan) {
      $true
    } else { [bool]$candidate.availableOnFreePlan }
    $samples = @()
    $safeError = $null
    try {
      1..20 | ForEach-Object { $samples += Invoke-PsqlLatency $url }
    } catch { $safeError = 'NEON_BENCHMARK_SAMPLE_FAILED' }
    $regionRows[$region] = [ordered]@{
      samples = $samples.Count; medianMs = if ($samples.Count) { Get-Percentile $samples 0.50 } else { $null }
      p95Ms = if ($samples.Count) { Get-Percentile $samples 0.95 } else { $null }
      availableOnFreePlan = $available
      status = if ($samples.Count -eq 20) { 'passed' } else { 'blocked' }; safeError = $safeError
    }
  }
  $selectedRegion = Select-NeonRegion $regionRows
  if (@($regionRows.Values | Where-Object { $_.status -ne 'passed' }).Count -eq 0) { $regionStatus = 'passed' }
} catch { }
Write-EvidenceJson (Join-Path $EvidenceDirectory 'neon-region-benchmark.json') ([ordered]@{
    schemaVersion = 1; releaseSha = $ReleaseSha; observedAt = $Now.ToString('o')
    status = $regionStatus; selectedRegion = $selectedRegion; regions = $regionRows
  })

# Cold-start one exact Jina container, prove one cold and three warm 1,024-dimension vectors.
$container = "docai-preflight-embeddings-$($ReleaseSha.Substring(0,12))-$([guid]::NewGuid().ToString('N'))"
$containerCreated = $false
$cache = Join-Path ([IO.Path]::GetTempPath()) "docai-preflight-model-$([guid]::NewGuid().ToString('N'))"
$embeddingResult = [ordered]@{
  schemaVersion = 1; releaseSha = $ReleaseSha; observedAt = $Now.ToString('o'); status = 'blocked'
  embeddingFeasible = $false; modelId = $null; revision = $null; cacheManifestSha256 = $null
  coldReadyMs = $null; coldEmbedMs = $null; warmEmbedMs = @(); dimensions = $null
  safeError = 'EMBEDDING_BENCHMARK_NOT_RUN'
}
New-Item -ItemType Directory -Force $cache | Out-Null
try {
  $port = Get-FreeTcpPort
  $timer = [Diagnostics.Stopwatch]::StartNew()
  Invoke-NativeChecked $docker.Source @('run','-d','--name',$container,'--cpus=2','--memory=4g',
    '--label',"docai.preflight.release=$ReleaseSha",
    '-p',"127.0.0.1:$port`:8002",'-v',"$cache`:/models/huggingface",
    'local/docai-embeddings:preflight')
  $containerCreated = $true
  $deadline = [datetime]::UtcNow.AddSeconds(180)
  $ready = $null
  while ([datetime]::UtcNow -lt $deadline) {
    try {
      $ready = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$port/ready" -TimeoutSec 5
      if ($ready.status -eq 'ready') { break }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  $timer.Stop()
  if (-not $ready -or $ready.status -ne 'ready') { throw 'Embedding readiness timeout' }
  if ([string]$ready.revision -notmatch '^[a-f0-9]{40}$') { throw 'Embedding revision is not immutable' }

  $body = @{ text = 'Kiểm tra embedding tiếng Việt'; task_type = 'query' } | ConvertTo-Json
  $coldTimer = [Diagnostics.Stopwatch]::StartNew()
  $cold = Invoke-RestMethod -Method Post -ContentType 'application/json' -Body $body `
    -Uri "http://127.0.0.1:$port/embed" -TimeoutSec 180
  $coldTimer.Stop()
  if ([int]$cold.dimensions -ne 1024 -or @($cold.embedding).Count -ne 1024 -or
      @($cold.embedding | Where-Object { [double]::IsNaN([double]$_) -or [double]::IsInfinity([double]$_) }).Count) {
    throw 'Embedding vector contract failed'
  }
  $warm = @()
  1..3 | ForEach-Object {
    $warmTimer = [Diagnostics.Stopwatch]::StartNew()
    $response = Invoke-RestMethod -Method Post -ContentType 'application/json' -Body $body `
      -Uri "http://127.0.0.1:$port/embed" -TimeoutSec 180
    $warmTimer.Stop()
    if ([int]$response.dimensions -ne 1024 -or @($response.embedding).Count -ne 1024) {
      throw 'Warm embedding vector contract failed'
    }
    $warm += [double]$warmTimer.Elapsed.TotalMilliseconds
  }
  $embeddingResult.status = 'passed'; $embeddingResult.embeddingFeasible = $true
  $embeddingResult.modelId = [string]$ready.model; $embeddingResult.revision = [string]$ready.revision
  $embeddingResult.cacheManifestSha256 = Get-DirectoryManifestSha256 $cache
  $embeddingResult.coldReadyMs = [double]$timer.Elapsed.TotalMilliseconds
  $embeddingResult.coldEmbedMs = [double]$coldTimer.Elapsed.TotalMilliseconds
  $embeddingResult.warmEmbedMs = $warm; $embeddingResult.dimensions = 1024; $embeddingResult.safeError = $null
} catch {
  $embeddingResult.safeError = 'EMBEDDING_BENCHMARK_FAILED'
} finally {
  if ($containerCreated) { & $docker.Source rm -f $container *> $null }
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $cacheFull = [IO.Path]::GetFullPath($cache)
  if ($cacheFull.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path $cacheFull -Leaf).StartsWith('docai-preflight-model-', [StringComparison]::Ordinal)) {
    Remove-Item -LiteralPath $cacheFull -Recurse -Force -ErrorAction SilentlyContinue
  }
}
Write-EvidenceJson (Join-Path $EvidenceDirectory 'embeddings-benchmark.json') $embeddingResult
Assert-EvidenceContainsNoSecrets $EvidenceDirectory

if ($imageStatus -ne 'passed' -or $regionStatus -ne 'passed' -or
    $embeddingResult.status -ne 'passed') { exit 2 }
