#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
  [Parameter(Mandatory)][string]$BillingAccountId,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ReleaseSha,
  [Parameter(Mandatory)][string]$EvidenceDirectory,
  [ValidatePattern('^$|^[a-f0-9]{64}$')][string]$PricingApprovalSha256 = '',
  [AllowNull()][decimal]$ApprovedRecurringCostCapUsd,
  [switch]$ApproveRecurringCost,
  [ValidateSet('Preflight','Runtime')][string]$Mode = 'Preflight'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Import-Module (Join-Path $Root 'ops/lib/Evidence.psm1') -Force
Import-Module (Join-Path $Root 'ops/lib/PreflightPolicy.psm1') -Force
Import-Module (Join-Path $Root 'ops/lib/BoundedProcess.psm1') -Force

$EvidenceDirectory = Resolve-EvidencePath $EvidenceDirectory $Root
New-Item -ItemType Directory -Force $EvidenceDirectory | Out-Null
$Config = Get-Content (Join-Path $Root 'ops/config/zero-cost-ceilings.json') -Raw |
  ConvertFrom-Json -AsHashtable
$Now = [datetime]::UtcNow

if (-not $env:DOC_AI_BILLING_ACCOUNT_ID -or
    $env:DOC_AI_BILLING_ACCOUNT_ID -ne $BillingAccountId) {
  throw 'DOC_AI_BILLING_ACCOUNT_ID must match the requested billing account'
}

function Get-TextSha256([string]$Text) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
  [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

function Invoke-PsqlScalar {
  param([Parameter(Mandatory)][string]$DatabaseUrl, [Parameter(Mandatory)][string]$Query)
  $psql = Get-Command psql -ErrorAction Stop
  $uri = [uri]$DatabaseUrl
  if ($uri.Scheme -notin 'postgres','postgresql') { throw 'Database URL scheme is invalid' }
  $old = @{}
  foreach ($name in 'PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE',
      'PGCONNECT_TIMEOUT','PGOPTIONS') {
    $old[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
  try {
    $credentials = $uri.UserInfo.Split(':', 2)
    $env:PGHOST = $uri.DnsSafeHost
    $env:PGPORT = if ($uri.Port -gt 0) { [string]$uri.Port } else { '5432' }
    $env:PGDATABASE = $uri.AbsolutePath.TrimStart('/')
    $env:PGUSER = [uri]::UnescapeDataString($credentials[0])
    $env:PGPASSWORD = if ($credentials.Count -gt 1) { [uri]::UnescapeDataString($credentials[1]) } else { '' }
    $env:PGSSLMODE = 'require'
    $env:PGCONNECT_TIMEOUT = '15'
    $env:PGOPTIONS = '-c statement_timeout=30000 -c lock_timeout=5000'
    $text = Invoke-BoundedNativeText -FilePath $psql.Source -Arguments @(
      '--no-psqlrc','--tuples-only','--no-align','--set','ON_ERROR_STOP=1','--command',$Query
    ) -TimeoutSeconds 45 -SafeError 'psql scalar query failed'
    $values = @($text -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($values.Count -ne 1) { throw 'psql scalar query failed' }
    return [double]$values[0].Trim()
  } finally {
    foreach ($name in $old.Keys) {
      [Environment]::SetEnvironmentVariable($name, $old[$name], 'Process')
    }
  }
}

function Invoke-GcloudJson([string[]]$Arguments) {
  $gcloud = Get-Command gcloud -ErrorAction Stop
  $text = Invoke-BoundedNativeText -FilePath $gcloud.Source -Arguments $Arguments `
    -TimeoutSeconds 60 -SafeError 'gcloud command failed'
  if ([string]::IsNullOrWhiteSpace($text)) { return @() }
  return $text | ConvertFrom-Json -Depth 30
}

function Get-GcloudAccessToken {
  $gcloud = Get-Command gcloud -ErrorAction Stop
  $token = (Invoke-BoundedNativeText -FilePath $gcloud.Source `
      -Arguments @('auth','print-access-token') -TimeoutSeconds 30 `
      -SafeError 'gcloud access token unavailable').Trim()
  if (-not $token -or $token -match '\s') { throw 'gcloud access token unavailable' }
  return $token
}

function Get-MonitoringSum {
  param([string]$MetricType, [datetime]$Start, [datetime]$End)
  $token = Get-GcloudAccessToken
  $filter = [uri]::EscapeDataString("metric.type=`"$MetricType`"")
  $startText = [uri]::EscapeDataString($Start.ToUniversalTime().ToString('o'))
  $endText = [uri]::EscapeDataString($End.ToUniversalTime().ToString('o'))
  $uri = "https://monitoring.googleapis.com/v3/projects/$ProjectId/timeSeries?filter=$filter&interval.startTime=$startText&interval.endTime=$endText&view=FULL&pageSize=1000"
  $sum = 0.0
  $seenTokens = @{}
  $pageCount = 0
  do {
    $pageCount++
    if ($pageCount -gt 100) { throw 'PROVIDER_PAGINATION_LIMIT_EXCEEDED' }
    $response = Invoke-RestMethod -Uri $uri -Headers @{ Authorization = "Bearer $token" } `
      -Method Get -TimeoutSec 30
    foreach ($series in @($response.timeSeries)) {
      foreach ($point in @($series.points)) {
        $value = if ($null -ne $point.value.doubleValue) { [double]$point.value.doubleValue } `
          elseif ($null -ne $point.value.int64Value) { [double]$point.value.int64Value } else { 0.0 }
        $sum += $value
      }
    }
    $next = [string]$response.nextPageToken
    if ($next -and $seenTokens.ContainsKey($next)) {
      throw 'PROVIDER_PAGINATION_TOKEN_REPEATED'
    }
    if ($next) { $seenTokens[$next] = $true }
    $uri = if ($next) { $uri.Split('&pageToken=')[0] + '&pageToken=' + [uri]::EscapeDataString($next) } else { $null }
  } while ($uri)
  return $sum
}

function Get-MonitoringMethodSums {
  param([string]$MetricType, [datetime]$Start, [datetime]$End)
  $token = Get-GcloudAccessToken
  $filterExpression = 'metric.type="{0}"' -f $MetricType
  $filter = [uri]::EscapeDataString($filterExpression)
  $startText = [uri]::EscapeDataString($Start.ToUniversalTime().ToString('o'))
  $endText = [uri]::EscapeDataString($End.ToUniversalTime().ToString('o'))
  $uri = "https://monitoring.googleapis.com/v3/projects/$ProjectId/timeSeries?filter=$filter&interval.startTime=$startText&interval.endTime=$endText&view=FULL&pageSize=1000"
  $sums = @{}
  $seenTokens = @{}
  $pageCount = 0
  do {
    $pageCount++
    if ($pageCount -gt 100) { throw 'PROVIDER_PAGINATION_LIMIT_EXCEEDED' }
    $response = Invoke-RestMethod -Uri $uri -Headers @{ Authorization = "Bearer $token" } `
      -Method Get -TimeoutSec 30
    foreach ($series in @($response.timeSeries)) {
      $method = [string]$series.metric.labels.method
      if (-not $method) { $method = '<missing>' }
      if (-not $sums.ContainsKey($method)) { $sums[$method] = 0.0 }
      foreach ($point in @($series.points)) {
        $value = if ($null -ne $point.value.doubleValue) {
          [double]$point.value.doubleValue
        } elseif ($null -ne $point.value.int64Value) {
          [double]$point.value.int64Value
        } else {
          0.0
        }
        $sums[$method] += $value
      }
    }
    $next = [string]$response.nextPageToken
    if ($next -and $seenTokens.ContainsKey($next)) {
      throw 'PROVIDER_PAGINATION_TOKEN_REPEATED'
    }
    if ($next) { $seenTokens[$next] = $true }
    $uri = if ($next) {
      $uri.Split('&pageToken=')[0] + '&pageToken=' + [uri]::EscapeDataString($next)
    } else {
      $null
    }
  } while ($uri)
  return $sums
}

$Observations = @{}
foreach ($metric in $Config.metrics.Keys) {
  $Observations[$metric] = [ordered]@{
    value = $null
    source = 'not-collected'
    identity = "billing:$BillingAccountId"
    observedAt = $Now
    maxAgeHours = 6
    error = 'AUTHORITATIVE_OBSERVATION_NOT_COLLECTED'
  }
}

function Set-Observation {
  param(
    [string]$Metric, [AllowNull()]$Value, [string]$Source, [string]$Identity,
    [double]$MaxAgeHours, [AllowNull()][string]$ErrorCode,
    [datetime]$ObservedAt = $Now
  )
  if (-not $Observations.ContainsKey($Metric)) { throw "Unknown capacity metric: $Metric" }
  $Observations[$Metric] = [ordered]@{
    value = $Value; source = $Source; identity = $Identity; observedAt = $ObservedAt
    maxAgeHours = $MaxAgeHours; error = $ErrorCode
  }
}

$BillingScopeVerified = $false
$BillingScopeSafeError = 'BILLING_SCOPE_COLLECTION_FAILED'
try {
  $billingProjects = @(Invoke-GcloudJson @(
      'billing','projects','list',"--billing-account=$BillingAccountId",'--format=json'))
  $linkedProjectIds = @($billingProjects |
      Where-Object { $null -eq $_.billingEnabled -or [bool]$_.billingEnabled } |
      ForEach-Object { [string]$_.projectId } |
      Where-Object { $_ } | Sort-Object -Unique)
  if ($linkedProjectIds.Count -ne 1 -or $linkedProjectIds[0] -ne $ProjectId) {
    throw 'BILLING_SCOPE_AGGREGATION_REQUIRED'
  }
  $BillingScopeVerified = $true
  $BillingScopeSafeError = $null
} catch {
  if ($_.Exception.Message -eq 'BILLING_SCOPE_AGGREGATION_REQUIRED') {
    $BillingScopeSafeError = 'BILLING_SCOPE_AGGREGATION_REQUIRED'
  }
}

# Database-scoped metrics. Connection material remains in process environment only.
$DatabaseUrl = if ($Mode -eq 'Runtime') { $env:DOC_AI_CAPACITY_DATABASE_URL } else { $env:DOC_AI_SOURCE_DATABASE_URL }
if ($DatabaseUrl) {
  try {
    Set-Observation neonBytes (Invoke-PsqlScalar $DatabaseUrl 'SELECT pg_database_size(current_database());') `
      'postgres-pg_database_size' "project:$ProjectId" 24 $null
  } catch { }
  try {
    $query = 'SELECT COALESCE(MAX(n),0) FROM (SELECT d."ownerId", count(*)::bigint n FROM "Chunk" c JOIN "Document" d ON d.id=c."documentId" GROUP BY d."ownerId") q;'
    Set-Observation maxEmbeddedChunksPerUser (Invoke-PsqlScalar $DatabaseUrl $query) `
      'postgres-owner-chunk-count' "project:$ProjectId" 6 $null
  } catch { }
  try {
    Set-Observation globalEmbeddedChunks (Invoke-PsqlScalar $DatabaseUrl 'SELECT count(*)::bigint FROM "Chunk";') `
      'postgres-global-chunk-count' "project:$ProjectId" 6 $null
  } catch { }
  try {
    $query = @'
SELECT CASE WHEN to_regclass('public."GenerationJob"') IS NULL THEN 0 ELSE
  (SELECT COALESCE(MAX(n),0) FROM (SELECT "ownerId", count(*)::bigint n FROM "GenerationJob"
    WHERE status NOT IN ('completed','failed','cancelled') GROUP BY "ownerId") q) END;
'@
    Set-Observation maxNonterminalGenerationJobsPerUser (Invoke-PsqlScalar $DatabaseUrl $query) `
      'postgres-generation-job-count' "project:$ProjectId" 6 $null
  } catch { }
}

# Current Artifact Registry and Secret Manager usage is transition debt during
# preflight and becomes authoritative runtime capacity after cutover.
$legacyArtifactBytes = $null
$legacyArtifactRepositoryCount = $null
$legacyArtifactError = 'ARTIFACT_REGISTRY_COLLECTION_FAILED'
$legacySecretVersions = $null
$legacySecretError = 'SECRET_MANAGER_COLLECTION_FAILED'
try {
  if (-not $BillingScopeVerified) { throw $BillingScopeSafeError }
  $repositories = @(Invoke-GcloudJson @('artifacts','repositories','list','--project', $ProjectId,
      '--location=all','--format=json'))
  $measurement = Measure-ArtifactRepositoryBytes -Repositories $repositories `
    -ExpectedProjectId $ProjectId
  $legacyArtifactBytes = $measurement.measuredBytes
  $legacyArtifactRepositoryCount = $measurement.repositoryCount
  $legacyArtifactError = $null
  if ($Mode -eq 'Runtime') {
    Set-Observation artifactRegistryBytes $measurement.measuredBytes `
      'artifact-registry-repository-size-bytes' "billing:$BillingAccountId" 6 $null
  }
} catch {
  $legacyArtifactError = if ($BillingScopeSafeError) { $BillingScopeSafeError } else {
    'ARTIFACT_REGISTRY_COLLECTION_FAILED'
  }
  if ($Mode -eq 'Runtime') {
    Set-Observation artifactRegistryBytes $null 'artifact-registry-repository-size-bytes' `
      "billing:$BillingAccountId" 6 $legacyArtifactError
  }
}

try {
  if (-not $BillingScopeVerified) { throw $BillingScopeSafeError }
  $secrets = @(Invoke-GcloudJson @('secrets','list','--project', $ProjectId,'--format=json'))
  $active = 0
  foreach ($secret in $secrets) {
    $name = ([string]$secret.name).Split('/')[-1]
    $versions = @(Invoke-GcloudJson @('secrets','versions','list', $name,'--project', $ProjectId,
        '--filter=state=ENABLED','--format=json'))
    $active += $versions.Count
  }
  $legacySecretVersions = $active
  $legacySecretError = $null
  if ($Mode -eq 'Runtime') {
    Set-Observation secretManagerActiveVersions $active 'secret-manager-api' `
      "billing:$BillingAccountId" 6 $null
  }
} catch {
  $legacySecretError = if ($BillingScopeSafeError) { $BillingScopeSafeError } else {
    'SECRET_MANAGER_COLLECTION_FAILED'
  }
  if ($Mode -eq 'Runtime') {
    Set-Observation secretManagerActiveVersions $null 'secret-manager-api' `
      "billing:$BillingAccountId" 6 $legacySecretError
  }
}

# Monitoring observations cover the current UTC calendar month/day as appropriate.
$monthStart = [datetime]::new($Now.Year, $Now.Month, 1, 0, 0, 0, [DateTimeKind]::Utc)
$monitoring = @{
  secretManagerAccessOperations = 'secretmanager.googleapis.com/api/request_count'
  cloudRunCpuSecondsPerMonth = 'run.googleapis.com/container/cpu/allocation_time'
  cloudRunRamGibSecondsPerMonth = 'run.googleapis.com/container/memory/allocation_time'
  cloudRunRequestsPerMonth = 'run.googleapis.com/request_count'
  cloudRunEgressBytesPerMonth = 'run.googleapis.com/container/network/sent_bytes_count'
  gcsNorthAmericaTransferBytes = 'storage.googleapis.com/network/sent_bytes_count'
  cloudTasksOperations = 'cloudtasks.googleapis.com/api/request_count'
  loggingBytes = 'logging.googleapis.com/billing/bytes_ingested'
}
foreach ($entry in $monitoring.GetEnumerator()) {
  try {
    if (-not $BillingScopeVerified) { throw $BillingScopeSafeError }
    $value = Get-MonitoringSum $entry.Value $monthStart $Now
    Set-Observation $entry.Key $value "cloud-monitoring:$($entry.Value)" "billing:$BillingAccountId" 6 $null
  } catch { }
}

try {
  if (-not $BillingScopeVerified) { throw $BillingScopeSafeError }
  $methodCounts = Get-MonitoringMethodSums 'storage.googleapis.com/api/request_count' $monthStart $Now
  $classes = Measure-GcsOperationClasses -MethodCounts $methodCounts
  $source = 'cloud-monitoring:storage.googleapis.com/api/request_count:method-classified'
  if ($classes.status -eq 'passed') {
    Set-Observation gcsClassAOperations $classes.classAOperations $source "billing:$BillingAccountId" 6 $null
    Set-Observation gcsClassBOperations $classes.classBOperations $source "billing:$BillingAccountId" 6 $null
  } else {
    Set-Observation gcsClassAOperations $null $source "billing:$BillingAccountId" 6 $classes.safeCollectionError
    Set-Observation gcsClassBOperations $null $source "billing:$BillingAccountId" 6 $classes.safeCollectionError
  }
} catch {
  $methodError = if ($BillingScopeSafeError) { $BillingScopeSafeError } else {
    'GCS_OPERATION_CLASS_COLLECTION_FAILED'
  }
  Set-Observation gcsClassAOperations $null 'cloud-monitoring:gcs-method-classification' "billing:$BillingAccountId" 6 $methodError
  Set-Observation gcsClassBOperations $null 'cloud-monitoring:gcs-method-classification' "billing:$BillingAccountId" 6 $methodError
}

try {
  if (-not $BillingScopeVerified) { throw $BillingScopeSafeError }
  $buckets = @(Invoke-GcloudJson @('storage','buckets','list','--project', $ProjectId,'--format=json'))
  [double]$bytes = 0
  foreach ($bucket in $buckets) {
    $name = [string]$bucket.name
    $gcloud = Get-Command gcloud -ErrorAction Stop
    $duText = Invoke-BoundedNativeText -FilePath $gcloud.Source -Arguments @(
      'storage','du','--summarize','--all-versions',"gs://$name"
    ) -TimeoutSeconds 60 -SafeError 'GCS inventory failed'
    $duLines = @($duText -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $bytes += Convert-GcloudStorageDuBytes -Lines $duLines -ExpectedBucket $name
  }
  Set-Observation gcsBytes $bytes 'gcloud-storage-inventory' "project:$ProjectId" 24 $null
} catch { }

if ($Mode -eq 'Preflight') {
  $imagePath = Join-Path $EvidenceDirectory 'image-footprint.json'
  $storagePath = Join-Path $EvidenceDirectory 'source-storage-summary.json'
  try {
    $imageFootprint = Get-Content -LiteralPath $imagePath -Raw | ConvertFrom-Json
    $storageSummary = Get-Content -LiteralPath $storagePath -Raw | ConvertFrom-Json
    $projection = Get-PreflightCapacityProjection -ReleaseSha $ReleaseSha `
      -ImageFootprint $imageFootprint -StorageSummary $storageSummary `
      -ProjectedSecretVersionCount ([int]$Config.preflightProjection.secretManagerActiveVersions)
    Set-Observation artifactRegistryBytes $projection.artifactRegistryBytes `
      "preflight-projection:image-footprint-sha256:$((Get-EvidenceSha256 $imagePath))" `
      "billing:$BillingAccountId" 6 $null
    Set-Observation gcsBytes $projection.gcsBytes `
      "preflight-projection:storage-summary-sha256:$((Get-EvidenceSha256 $storagePath))" `
      "project:$ProjectId" 24 $null
    Set-Observation secretManagerActiveVersions $projection.secretManagerActiveVersions `
      'preflight-projection:five-runtime-bundles' "billing:$BillingAccountId" 6 $null
  } catch {
    foreach ($metric in 'artifactRegistryBytes','gcsBytes','secretManagerActiveVersions') {
      Set-Observation $metric $null 'preflight-target-projection' "billing:$BillingAccountId" 6 `
        'PREFLIGHT_TARGET_PROJECTION_FAILED'
    }
  }

  Write-EvidenceJson (Join-Path $EvidenceDirectory 'legacy-transition-capacity.json') ([ordered]@{
      schemaVersion = 1
      releaseSha = $ReleaseSha
      observedAt = $Now.ToString('o')
      status = if ($null -eq $legacyArtifactError -and $null -eq $legacySecretError) {
        'passed'
      } else {
        'blocked'
      }
      currentArtifactRegistryBytes = $legacyArtifactBytes
      artifactRegistryRepositoryCount = $legacyArtifactRepositoryCount
      artifactRegistrySizeSource = 'repository.sizeBytes'
      artifactRegistrySafeError = $legacyArtifactError
      currentSecretManagerActiveVersions = $legacySecretVersions
      secretManagerSafeError = $legacySecretError
      requiresArtifactRetirement = [bool]($null -ne $legacyArtifactBytes -and
        $legacyArtifactBytes -gt [double]$Config.metrics.artifactRegistryBytes.internalCeiling)
      requiresSecretRetirement = [bool]($null -ne $legacySecretVersions -and
        $legacySecretVersions -gt [double]$Config.metrics.secretManagerActiveVersions.internalCeiling)
    })
}

# Neon: storage uses the larger of the project API and direct pg_database_size.
if ($env:DOC_AI_NEON_API_KEY -and $env:DOC_AI_NEON_PROJECT_ID) {
  try {
    $headers = @{ Authorization = "Bearer $($env:DOC_AI_NEON_API_KEY)" }
    $project = Invoke-RestMethod -Method Get -Headers $headers `
      -Uri "https://console.neon.tech/api/v2/projects/$($env:DOC_AI_NEON_PROJECT_ID)" `
      -TimeoutSec 30
    if ([string]$project.project.id -ne $env:DOC_AI_NEON_PROJECT_ID) { throw 'Neon project identity mismatch' }
    $apiBytes = [double]$project.project.synthetic_storage_size
    $dbBytes = if ($env:DOC_AI_NEON_DIRECT_URL) {
      Invoke-PsqlScalar $env:DOC_AI_NEON_DIRECT_URL 'SELECT pg_database_size(current_database());'
    } else { 0 }
    Set-Observation neonBytes ([Math]::Max($apiBytes, $dbBytes)) 'neon-project-api+postgres' `
      "neon:$($env:DOC_AI_NEON_PROJECT_ID)" 6 $null
    if ($null -ne $project.project.data_transfer_bytes) {
      Set-Observation neonTransferBytes ([double]$project.project.data_transfer_bytes) 'neon-project-api' `
        "neon:$($env:DOC_AI_NEON_PROJECT_ID)" 6 $null
    }
  } catch { }
}

if ($env:DOC_AI_NEON_CU_USAGE_EXPORT_PATH -and $env:DOC_AI_NEON_PROJECT_ID) {
  try {
    $exportPath = [IO.Path]::GetFullPath($env:DOC_AI_NEON_CU_USAGE_EXPORT_PATH)
    if ($exportPath.StartsWith([IO.Path]::GetFullPath((Join-Path $Root '.artifacts/releases')),
        [StringComparison]::OrdinalIgnoreCase)) { throw 'CU export must be outside release evidence' }
    $exportJson = Get-Content -LiteralPath $exportPath -Raw
    if (-not (Test-Json -Json $exportJson `
        -SchemaFile (Join-Path $Root 'ops/schemas/neon-cu-usage-export.schema.json'))) {
      throw 'Neon CU export does not validate against NeonCuUsageExportV1'
    }
    $export = $exportJson | ConvertFrom-Json
    $exportObservedAt = ([datetimeoffset]$export.observedAt).UtcDateTime
    if ([string]$export.projectId -ne $env:DOC_AI_NEON_PROJECT_ID -or
        $exportObservedAt -lt $Now.AddHours(-6) -or $exportObservedAt -gt $Now.AddMinutes(5)) {
      throw 'Neon CU export is stale, future-dated, or mismatched'
    }
    Set-Observation neonCuHours ([double]$export.cuHours) `
      "neon-console-export-sha256:$((Get-EvidenceSha256 $exportPath))" `
      "neon:$($env:DOC_AI_NEON_PROJECT_ID)" 6 $null -ObservedAt $exportObservedAt
  } catch { }
}

if ($env:DOC_AI_UPSTASH_EMAIL -and $env:DOC_AI_UPSTASH_API_KEY -and $env:DOC_AI_UPSTASH_DATABASE_ID) {
  try {
    $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(
        "$($env:DOC_AI_UPSTASH_EMAIL):$($env:DOC_AI_UPSTASH_API_KEY)"))
    $stats = Invoke-RestMethod -Method Get -Headers @{ Authorization = "Basic $basic" } `
      -Uri "https://api.upstash.com/v2/redis/stats/$($env:DOC_AI_UPSTASH_DATABASE_ID)" `
      -TimeoutSec 30
    $usage = Convert-UpstashStatsObservation $stats
    Set-Observation upstashBytes $usage.storageBytes 'upstash-stats-api' `
      "upstash:$($env:DOC_AI_UPSTASH_DATABASE_ID)" 6 $null
    Set-Observation upstashCommands $usage.commands 'upstash-stats-api' `
      "upstash:$($env:DOC_AI_UPSTASH_DATABASE_ID)" 6 $null
    Set-Observation upstashBandwidthBytes $usage.bandwidthBytes 'upstash-stats-api' `
      "upstash:$($env:DOC_AI_UPSTASH_DATABASE_ID)" 6 $null
  } catch { }
}

if ($env:DOC_AI_CLOUDFLARE_API_TOKEN -and $env:DOC_AI_CLOUDFLARE_ACCOUNT_TAG -and
    $env:DOC_AI_CLOUDFLARE_SCRIPT_NAME) {
  try {
    $query = @'
query WorkerUsage($account: String!, $script: String!, $start: Time!, $end: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    workersInvocationsAdaptive(limit: 10000, filter: { scriptName: $script, datetime_geq: $start, datetime_leq: $end }) {
      sum { requests }
      quantiles { cpuTimeP95 }
    }
  } }
}
'@
    $body = @{ query = $query; variables = @{
        account = $env:DOC_AI_CLOUDFLARE_ACCOUNT_TAG; script = $env:DOC_AI_CLOUDFLARE_SCRIPT_NAME
        start = $Now.Date.ToString('o'); end = $Now.ToString('o') } } | ConvertTo-Json -Depth 8
    $cf = Invoke-RestMethod -Method Post -ContentType 'application/json' -Body $body `
      -Headers @{ Authorization = "Bearer $($env:DOC_AI_CLOUDFLARE_API_TOKEN)" } `
      -Uri 'https://api.cloudflare.com/client/v4/graphql' -TimeoutSec 30
    if (@($cf.errors).Count -gt 0) { throw 'Cloudflare GraphQL returned errors' }
    if (@($cf.data.viewer.accounts).Count -ne 1) {
      throw 'Cloudflare account scope is missing or ambiguous'
    }
    $groups = @($cf.data.viewer.accounts[0].workersInvocationsAdaptive)
    $requests = ($groups | ForEach-Object { [double]$_.sum.requests } | Measure-Object -Sum).Sum
    $p95Microseconds = if ($groups.Count -gt 0) {
      ($groups | ForEach-Object { [double]$_.quantiles.cpuTimeP95 } |
        Measure-Object -Maximum).Maximum
    } else {
      $null
    }
    $p95Milliseconds = if ($null -ne $p95Microseconds) {
      Convert-CloudflareCpuMicrosecondsToMilliseconds $p95Microseconds
    } else {
      $null
    }
    $identity = "cloudflare:$($env:DOC_AI_CLOUDFLARE_ACCOUNT_TAG):$($env:DOC_AI_CLOUDFLARE_SCRIPT_NAME)"
    Set-Observation cloudflareRequestsPerDay $requests 'cloudflare-graphql' $identity 6 $null
    Set-Observation cloudflareWorkerCpuP95Ms $p95Milliseconds 'cloudflare-graphql' $identity 6 $null
  } catch { }
}

# Revalidate pricing without persisting source bodies.
$PricingPath = Join-Path $EvidenceDirectory 'pricing-revalidation.json'
$approvedSnapshot = $null
if ($PricingApprovalSha256 -and (Test-Path -LiteralPath $PricingPath) -and
    (Get-EvidenceSha256 $PricingPath) -eq $PricingApprovalSha256) {
  $approvedSnapshot = Get-Content -LiteralPath $PricingPath -Raw | ConvertFrom-Json
}
$pricingRows = @()
foreach ($source in $Config.officialSources) {
  try {
    $response = Invoke-WebRequest -Uri $source.url -Method Get -MaximumRedirection 5 `
      -TimeoutSec 30
    $pricingRows += [ordered]@{
      name = $source.name; url = $source.url; statusCode = [int]$response.StatusCode
      retrievedAt = $Now.ToString('o'); etag = [string]$response.Headers.ETag
      lastModified = [string]$response.Headers.'Last-Modified'
      bodySha256 = Get-TextSha256 ([string]$response.Content); status = 'passed'; safeError = $null
    }
  } catch {
    $pricingRows += [ordered]@{
      name = $source.name; url = $source.url; statusCode = $null; retrievedAt = $Now.ToString('o')
      etag = $null; lastModified = $null; bodySha256 = $null; status = 'blocked'
      safeError = 'OFFICIAL_PRICING_SOURCE_UNAVAILABLE'
    }
  }
}
$pricingStatus = 'blocked'
if ($approvedSnapshot) {
  $oldByName = @{}; foreach ($row in $approvedSnapshot.sources) { $oldByName[$row.name] = $row }
  $changed = @($pricingRows | Where-Object {
      $_.status -ne 'passed' -or -not $oldByName.ContainsKey($_.name) -or
      $oldByName[$_.name].bodySha256 -ne $_.bodySha256 }).Count -gt 0
  if (-not $changed) { $pricingStatus = 'passed' }
}
if (-not $approvedSnapshot -or $pricingStatus -ne 'passed') {
  Write-EvidenceJson $PricingPath ([ordered]@{
      schemaVersion = 1; releaseSha = $ReleaseSha; status = 'blocked'
      safeError = 'PRICING_APPROVAL_REQUIRED'; sources = $pricingRows })
}

$artifactException = $null
$artifactObservation = $Observations.artifactRegistryBytes
if ($ApproveRecurringCost -and $null -ne $ApprovedRecurringCostCapUsd -and
    $null -ne $artifactObservation.value -and
    [double]$artifactObservation.value -gt [double]$Config.metrics.artifactRegistryBytes.internalCeiling) {
  try {
    $artifactCost = $null
    if ($Mode -eq 'Preflight') {
      $imageEvidence = Get-Content -LiteralPath (Join-Path $EvidenceDirectory 'image-footprint.json') `
        -Raw | ConvertFrom-Json
      if ([long]$imageEvidence.retainedBytes -ne [long]$artifactObservation.value -or
          -not $imageEvidence.recurringCost.ratesKnown) {
        throw 'Preflight image cost evidence mismatch'
      }
      $artifactCost = $imageEvidence.recurringCost
    } else {
      if (-not $env:DOC_AI_ARTIFACT_REGISTRY_PRICING_JSON) {
        throw 'Artifact Registry pricing input is unavailable'
      }
      $artifactPricing = $env:DOC_AI_ARTIFACT_REGISTRY_PRICING_JSON | ConvertFrom-Json
      $artifactCost = Get-ArtifactRegistryMonthlyCostEstimate `
        -RetainedBytes ([long]$artifactObservation.value) -FreeBytes $artifactPricing.freeBytes `
        -RatePerGiBMonth $artifactPricing.ratePerGiBMonth `
        -SourceSnapshotSha256 ([string]$artifactPricing.sourceSnapshotSha256)
    }
    if (-not $artifactCost.ratesKnown -or $null -eq $artifactCost.monthlyCostUsd -or
        [decimal]$artifactCost.monthlyCostUsd -le 0 -or
        [decimal]$artifactCost.monthlyCostUsd -gt $ApprovedRecurringCostCapUsd) {
      throw 'Artifact Registry recurring cost exceeds or lacks its approval cap'
    }
    $artifactException = [ordered]@{
      kind = 'artifact_registry_recurring_cost_cap'
      estimatedMonthlyCostUsd = [decimal]$artifactCost.monthlyCostUsd
      approvedMonthlyCapUsd = [decimal]$ApprovedRecurringCostCapUsd
      pricingSourceSha256 = [string]$artifactCost.sourceSnapshotSha256
    }
  } catch {
    $artifactException = $null
  }
}

$records = @()
foreach ($metric in @($Config.metrics.Keys | Sort-Object)) {
  $definition = $Config.metrics[$metric]
  $observation = $Observations[$metric]
  $record = New-CapacityRecord -Metric $metric -Policy $definition.policy `
    -Value $observation.value -Unit $definition.unit -Ceiling ([double]$definition.internalCeiling) `
    -OfficialAllowance $null -SafeSourceName $observation.source -AccountIdentity $observation.identity `
    -ObservedAt $observation.observedAt -ValidUntil $observation.observedAt.AddHours($observation.maxAgeHours) `
    -ReleaseSha $ReleaseSha -SafeCollectionError $observation.error `
    -ApprovedException $(if ($metric -eq 'artifactRegistryBytes') { $artifactException } else { $null })
  $records += $record
}

$blocked = @($records | Where-Object {
    $_.status -ne 'passed' -or ($Mode -eq 'Preflight' -and $_.policy -eq 'progressive' -and $_.ratio -ge 0.70)
}).Count -gt 0 -or $pricingStatus -ne 'passed'
$validUntil = ($records | ForEach-Object { [datetime]$_.validUntil } | Sort-Object | Select-Object -First 1)
$snapshot = [ordered]@{
  schemaVersion = 2; releaseSha = $ReleaseSha
  mode = if ($Mode -eq 'Preflight') { 'preflight_projection' } else { 'runtime_actual' }
  status = if ($blocked) { 'blocked' } else { 'passed' }
  zeroCostFeasible = @($records | Where-Object zeroCostStatus -ne 'passed').Count -eq 0
  createdAt = $Now.ToString('o'); validUntil = $validUntil.ToUniversalTime().ToString('o'); records = $records
}
$SnapshotPath = Join-Path $EvidenceDirectory 'capacity-snapshot.json'
Write-EvidenceJson $SnapshotPath $snapshot
if (-not (Test-Json -Json (Get-Content $SnapshotPath -Raw) `
    -SchemaFile (Join-Path $Root 'ops/schemas/capacity-evidence.schema.json'))) {
  throw 'Capacity evidence does not validate against CapacityEvidenceV2'
}
Assert-EvidenceContainsNoSecrets $EvidenceDirectory
if ($snapshot.status -ne 'passed') { exit 2 }
