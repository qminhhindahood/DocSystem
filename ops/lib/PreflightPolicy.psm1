function Test-CapacityMetric {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Metric,
    [Parameter(Mandatory)][ValidateSet('progressive','hard_limit')][string]$Policy,
    [Parameter(Mandatory)][AllowNull()]$Value,
    [Parameter(Mandatory)][double]$Ceiling
  )

  $errorCode = $null
  $numericValue = $null
  if ($Ceiling -le 0 -or [double]::IsNaN($Ceiling) -or [double]::IsInfinity($Ceiling)) {
    $errorCode = 'INVALID_INTERNAL_CEILING'
  } elseif ($null -eq $Value) {
    $errorCode = 'AUTHORITATIVE_OBSERVATION_MISSING'
  } else {
    try { $numericValue = [double]$Value } catch { $errorCode = 'OBSERVATION_NOT_NUMERIC' }
    if (-not $errorCode -and ($numericValue -lt 0 -or [double]::IsNaN($numericValue) -or
        [double]::IsInfinity($numericValue))) {
      $errorCode = 'OBSERVATION_NOT_FINITE_NONNEGATIVE'
    }
  }

  if ($errorCode) {
    return [pscustomobject][ordered]@{
      metric = $Metric
      policy = $Policy
      measuredValue = if ($null -eq $Value) { $null } else { $numericValue }
      ratio = $null
      status = 'blocked'
      safeCollectionError = $errorCode
    }
  }

  $ratio = $numericValue / $Ceiling
  return [pscustomobject][ordered]@{
    metric = $Metric
    policy = $Policy
    measuredValue = $numericValue
    ratio = $ratio
    status = if ($ratio -le 1.0) { 'passed' } else { 'blocked' }
    safeCollectionError = if ($ratio -le 1.0) { $null } else { 'INTERNAL_CEILING_EXCEEDED' }
  }
}

function Get-IdentitySha256 {
  param([Parameter(Mandatory)][string]$Value)
  $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
  return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

function New-CapacityRecord {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Metric,
    [Parameter(Mandatory)][ValidateSet('progressive','hard_limit')][string]$Policy,
    [Parameter(Mandatory)][AllowNull()]$Value,
    [Parameter(Mandatory)][string]$Unit,
    [Parameter(Mandatory)][double]$Ceiling,
    [Parameter(Mandatory)][AllowNull()]$OfficialAllowance,
    [Parameter(Mandatory)][string]$SafeSourceName,
    [Parameter(Mandatory)][string]$AccountIdentity,
    [Parameter(Mandatory)][datetime]$ObservedAt,
    [Parameter(Mandatory)][datetime]$ValidUntil,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ReleaseSha,
    [AllowNull()][string]$SafeCollectionError,
    [AllowNull()]$ApprovedException
  )

  $evaluation = Test-CapacityMetric -Metric $Metric -Policy $Policy -Value $Value -Ceiling $Ceiling
  if ($SafeCollectionError) {
    $evaluation.status = 'blocked'
    $evaluation.safeCollectionError = $SafeCollectionError
  }
  $zeroCostStatus = $evaluation.status
  $normalizedException = $null
  if ($null -ne $ApprovedException) {
    if ($Metric -ne 'artifactRegistryBytes' -or $Policy -ne 'hard_limit') {
      throw 'Only Artifact Registry supports a recurring-cost exception'
    }
    if ($SafeCollectionError -or $evaluation.safeCollectionError -ne 'INTERNAL_CEILING_EXCEEDED') {
      throw 'Artifact Registry exception requires only a measured ceiling overage'
    }
    $kind = [string](Get-RecordValue $ApprovedException 'kind')
    $pricingHash = [string](Get-RecordValue $ApprovedException 'pricingSourceSha256')
    try {
      [decimal]$estimatedCost = Get-RecordValue $ApprovedException 'estimatedMonthlyCostUsd'
      [decimal]$approvedCap = Get-RecordValue $ApprovedException 'approvedMonthlyCapUsd'
    } catch {
      throw 'Artifact Registry recurring-cost exception values are invalid'
    }
    if ($kind -ne 'artifact_registry_recurring_cost_cap' -or
        $pricingHash -notmatch '^[a-f0-9]{64}$' -or $estimatedCost -le 0 -or
        $approvedCap -lt $estimatedCost) {
      throw 'Artifact Registry recurring-cost cap is invalid or insufficient'
    }
    $normalizedException = [ordered]@{
      kind = $kind
      estimatedMonthlyCostUsd = $estimatedCost
      approvedMonthlyCapUsd = $approvedCap
      pricingSourceSha256 = $pricingHash
    }
    $evaluation.status = 'passed'
    $evaluation.safeCollectionError = $null
  }
  [ordered]@{
    metric = $Metric
    policy = $Policy
    measuredValue = $evaluation.measuredValue
    unit = $Unit
    internalCeiling = $Ceiling
    officialAllowance = if ($null -eq $OfficialAllowance) { $null } else { [double]$OfficialAllowance }
    ratio = $evaluation.ratio
    zeroCostStatus = $zeroCostStatus
    approvedException = $normalizedException
    accountIdentityHash = Get-IdentitySha256 $AccountIdentity
    source = $SafeSourceName
    observedAt = $ObservedAt.ToUniversalTime().ToString('o')
    validUntil = $ValidUntil.ToUniversalTime().ToString('o')
    releaseId = $ReleaseSha
    safeCollectionError = $evaluation.safeCollectionError
    status = $evaluation.status
  }
}

function Measure-GcsOperationClasses {
  [CmdletBinding()]
  param([Parameter(Mandatory)][Collections.IDictionary]$MethodCounts)

  # Cloud Monitoring exposes service method names, while Cloud Storage pricing
  # defines the billable classes by API operation. Keep this mapping explicit so
  # a new provider method cannot be silently assigned to a cheaper class.
  $classAMethods = @(
    'ComposeObject', 'CopyObject', 'CreateBucket', 'CreateFolder', 'CreateHmacKey',
    'CreateManagedFolder', 'CreateNotification', 'CreateObject',
    'DeleteBucketAccessControl', 'DeleteDefaultObjectAccessControl',
    'DeleteNotification', 'DeleteObjectAccessControl', 'ListBuckets', 'ListFolders',
    'ListHmacKeys', 'ListManagedFolders', 'ListObjects', 'LockBucketRetentionPolicy',
    'MoveObject', 'PatchBucketMetadata', 'PatchFolder', 'PatchManagedFolder',
    'PatchObjectMetadata', 'RenameFolder', 'RenameManagedFolder', 'RestoreObject',
    'RewriteObject', 'SetIamPolicy', 'UpdateBucketMetadata', 'UpdateFolder',
    'UpdateManagedFolder', 'UpdateObjectMetadata', 'WatchAllObjects', 'WriteObject'
  )
  $classBMethods = @(
    'GetBucketAccessControl', 'GetBucketMetadata', 'GetBucketStorageLayout',
    'GetDefaultObjectAccessControl', 'GetFolder', 'GetIamPolicy', 'GetManagedFolder',
    'GetNotification', 'GetObject', 'GetObjectAccessControl', 'GetObjectMetadata',
    'ListBucketAccessControls', 'ListDefaultObjectAccessControls', 'ListNotifications',
    'ListObjectAccessControls', 'ReadObject', 'TestIamPermissions'
  )
  $freeMethods = @(
    'DeleteBucket', 'DeleteChannel', 'DeleteFolder', 'DeleteHmacKey',
    'DeleteManagedFolder', 'DeleteObject', 'StopChannel'
  )

  [double]$classA = 0
  [double]$classB = 0
  [double]$free = 0
  $unknown = @()
  foreach ($entry in $MethodCounts.GetEnumerator()) {
    $method = [string]$entry.Key
    try { [double]$count = $entry.Value } catch {
      throw "Cloud Storage method count must be finite nonnegative: $method"
    }
    if (-not $method -or $count -lt 0 -or [double]::IsNaN($count) -or
        [double]::IsInfinity($count)) {
      throw "Cloud Storage method count must be finite nonnegative: $method"
    }
    if ($count -eq 0) { continue }
    if ($classAMethods -contains $method) { $classA += $count; continue }
    if ($classBMethods -contains $method) { $classB += $count; continue }
    if ($freeMethods -contains $method) { $free += $count; continue }
    $unknown += $method
  }

  [pscustomobject][ordered]@{
    classAOperations = $classA
    classBOperations = $classB
    freeOperations = $free
    unknownMethods = @($unknown | Sort-Object -Unique)
    status = if ($unknown.Count -eq 0) { 'passed' } else { 'blocked' }
    safeCollectionError = if ($unknown.Count -eq 0) {
      $null
    } else {
      'GCS_OPERATION_CLASSIFICATION_INCOMPLETE'
    }
  }
}

function Convert-CloudflareCpuMicrosecondsToMilliseconds {
  [CmdletBinding()]
  param([Parameter(Mandatory)][double]$Microseconds)

  if ($Microseconds -lt 0 -or [double]::IsNaN($Microseconds) -or
      [double]::IsInfinity($Microseconds)) {
    throw 'Cloudflare CPU quantile must be finite nonnegative'
  }
  return $Microseconds / 1000.0
}

function Select-NeonRegion {
  [CmdletBinding()]
  param([Parameter(Mandatory)][Collections.IDictionary]$Benchmarks)

  $baselineName = 'aws-us-east-2'
  if (-not $Benchmarks.Contains($baselineName)) { throw 'Ohio benchmark is required' }
  $baseline = $Benchmarks[$baselineName]
  if ([int]$baseline.samples -ne 20 -or [double]$baseline.medianMs -le 0 -or
      [double]$baseline.p95Ms -le 0) {
    throw 'Ohio benchmark must contain 20 valid samples'
  }

  $eligible = foreach ($name in $Benchmarks.Keys) {
    if ($name -eq $baselineName) { continue }
    $candidate = $Benchmarks[$name]
    $available = -not $candidate.ContainsKey('availableOnFreePlan') -or
      [bool]$candidate.availableOnFreePlan
    if (-not $available -or [int]$candidate.samples -ne 20) { continue }
    $median = [double]$candidate.medianMs
    $p95 = [double]$candidate.p95Ms
    if ($median -le ([double]$baseline.medianMs * 0.85) -and
        $p95 -le ([double]$baseline.p95Ms * 1.10)) {
      [pscustomobject]@{ name = [string]$name; medianMs = $median; p95Ms = $p95 }
    }
  }
  $winner = @($eligible | Sort-Object medianMs, p95Ms, name | Select-Object -First 1)
  if ($winner.Count -eq 0) { return $baselineName }
  return $winner[0].name
}

function Measure-RetainedImageBytes {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][long[]]$ImageSizes,
    [Parameter(Mandatory)][long]$Ceiling
  )
  if ($Ceiling -le 0 -or @($ImageSizes | Where-Object { $_ -lt 0 }).Count -gt 0) {
    throw 'Image sizes and ceiling must be nonnegative with a positive ceiling'
  }
  [long]$retained = ($ImageSizes | Measure-Object -Sum).Sum * 2
  [pscustomobject][ordered]@{
    retainedBytes = $retained
    ceiling = $Ceiling
    status = if ($retained -le $Ceiling) { 'passed' } else { 'blocked' }
  }
}

function Get-Percentile {
  param(
    [Parameter(Mandatory)][double[]]$Values,
    [Parameter(Mandatory)][ValidateRange(0,1)][double]$Percentile
  )
  if ($Values.Count -eq 0) { throw 'At least one sample is required' }
  $sorted = @($Values | Sort-Object)
  $rank = [Math]::Ceiling($Percentile * $sorted.Count) - 1
  if ($rank -lt 0) { $rank = 0 }
  return [double]$sorted[$rank]
}

function Get-RecordValue {
  param([Parameter(Mandatory)]$Record, [Parameter(Mandatory)][string]$Name)
  if ($Record -is [Collections.IDictionary]) {
    if ($Record.Contains($Name)) { return $Record[$Name] }
    return $null
  }
  $property = $Record.PSObject.Properties[$Name]
  if ($property) { return $property.Value }
  return $null
}

function Get-ArtifactRegistryMonthlyCostEstimate {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][long]$RetainedBytes,
    [AllowNull()]$FreeBytes,
    [AllowNull()]$RatePerGiBMonth,
    [AllowNull()][string]$SourceSnapshotSha256
  )

  if ($RetainedBytes -lt 0) { throw 'Artifact Registry retained bytes must be nonnegative' }
  $ratesKnown = $null -ne $FreeBytes -and $null -ne $RatePerGiBMonth -and
    $SourceSnapshotSha256 -match '^[a-f0-9]{64}$'
  if ($ratesKnown) {
    try {
      [long]$free = $FreeBytes
      [decimal]$rate = $RatePerGiBMonth
    } catch {
      $ratesKnown = $false
    }
    if ($ratesKnown -and ($free -lt 0 -or $rate -lt 0)) { $ratesKnown = $false }
  }

  $cost = $null
  $zeroCostFeasible = $false
  if ($ratesKnown) {
    $zeroCostFeasible = $RetainedBytes -le $free
    [decimal]$billableBytes = [Math]::Max([decimal]0, [decimal]$RetainedBytes - [decimal]$free)
    [decimal]$raw = ($billableBytes / [decimal]1073741824) * $rate
    $cost = [Math]::Ceiling($raw * 100) / 100
  }

  [ordered]@{
    ratesKnown = $ratesKnown
    sourceSnapshotSha256 = if ($ratesKnown) { $SourceSnapshotSha256 } else { $null }
    freeBytes = if ($ratesKnown) { $free } else { $null }
    ratePerGiBMonth = if ($ratesKnown) { $rate } else { $null }
    monthlyCostUsd = $cost
    zeroCostFeasible = $zeroCostFeasible
    requiresApproval = -not $ratesKnown -or $cost -gt 0
  }
}

function Get-PreflightCapacityProjection {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ReleaseSha,
    [Parameter(Mandatory)]$ImageFootprint,
    [Parameter(Mandatory)]$StorageSummary,
    [Parameter(Mandatory)][int]$ProjectedSecretVersionCount
  )

  if ([int](Get-RecordValue $ImageFootprint 'schemaVersion') -ne 1 -or
      [string](Get-RecordValue $ImageFootprint 'status') -ne 'passed' -or
      [int](Get-RecordValue $ImageFootprint 'retentionCopies') -ne 2) {
    throw 'Preflight image footprint is incomplete or blocked'
  }
  if ([string](Get-RecordValue $ImageFootprint 'releaseSha') -ne $ReleaseSha -or
      [string](Get-RecordValue $StorageSummary 'releaseSha') -ne $ReleaseSha) {
    throw 'Preflight projection release identity mismatch'
  }
  if ([int](Get-RecordValue $StorageSummary 'schemaVersion') -ne 1) {
    throw 'Preflight storage summary schema is invalid'
  }
  if ($ProjectedSecretVersionCount -ne 5) {
    throw 'Preflight projection requires exactly five target secret versions'
  }

  [long]$artifactBytes = 0
  [long]$gcsBytes = 0
  if (-not [long]::TryParse([string](Get-RecordValue $ImageFootprint 'retainedBytes'),
      [ref]$artifactBytes) -or $artifactBytes -lt 0) {
    throw 'Preflight image retained bytes are invalid'
  }
  if (-not [long]::TryParse([string](Get-RecordValue $StorageSummary 'projectedTargetLiveBytes'),
      [ref]$gcsBytes) -or $gcsBytes -lt 0) {
    throw 'Preflight projected target storage bytes are invalid'
  }

  [ordered]@{
    artifactRegistryBytes = $artifactBytes
    gcsBytes = $gcsBytes
    secretManagerActiveVersions = $ProjectedSecretVersionCount
  }
}

function Test-PreflightCapacityAcceptance {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]$CapacityEvidence,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ReleaseSha,
    [Parameter(Mandatory)][string[]]$ExpectedMetrics,
    [Parameter(Mandatory)][AllowNull()]$RecurringCostUsd,
    [Parameter(Mandatory)][bool]$RecurringCostApproved,
    [AllowNull()]$ApprovedRecurringCostCapUsd
  )

  $blockedResult = [ordered]@{
    status = 'blocked'; zeroCostFeasible = $false; reason = 'CAPACITY_BLOCKED'
  }
  if ([int](Get-RecordValue $CapacityEvidence 'schemaVersion') -ne 2 -or
      [string](Get-RecordValue $CapacityEvidence 'releaseSha') -ne $ReleaseSha -or
      [string](Get-RecordValue $CapacityEvidence 'mode') -ne 'preflight_projection' -or
      [string](Get-RecordValue $CapacityEvidence 'status') -ne 'passed') {
    return $blockedResult
  }
  $Records = @((Get-RecordValue $CapacityEvidence 'records'))
  if ($Records.Count -eq 0) { return $blockedResult }
  $expected = @($ExpectedMetrics | Sort-Object -Unique)
  $byMetric = @{}
  foreach ($record in $Records) {
    $metric = [string](Get-RecordValue $record 'metric')
    if (-not $metric -or $byMetric.ContainsKey($metric)) { return $blockedResult }
    $byMetric[$metric] = $record
  }
  if ($byMetric.Count -ne $expected.Count -or
      @($expected | Where-Object { -not $byMetric.ContainsKey($_) }).Count -gt 0) {
    return $blockedResult
  }

  foreach ($record in $Records | Where-Object { [string](Get-RecordValue $_ 'policy') -eq 'progressive' }) {
    $ratioValue = Get-RecordValue $record 'ratio'
    if ($null -eq $ratioValue) { return $blockedResult }
    try { [double]$ratio = $ratioValue } catch { return $blockedResult }
    if ([double]::IsNaN($ratio) -or [double]::IsInfinity($ratio) -or $ratio -ge 0.70) {
      return $blockedResult
    }
  }

  if (@($Records | Where-Object { [string](Get-RecordValue $_ 'status') -ne 'passed' }).Count -gt 0 -or
      $null -eq $RecurringCostUsd) {
    return $blockedResult
  }
  try { [decimal]$recurring = $RecurringCostUsd } catch { return $blockedResult }
  if ($recurring -lt 0) { return $blockedResult }
  $exceptions = @($Records | Where-Object { $null -ne (Get-RecordValue $_ 'approvedException') })

  if ($recurring -eq 0) {
    if ($exceptions.Count -ne 0 -or
        -not [bool](Get-RecordValue $CapacityEvidence 'zeroCostFeasible')) {
      return $blockedResult
    }
    return [ordered]@{ status = 'passed'; zeroCostFeasible = $true; reason = $null }
  }

  if (-not $RecurringCostApproved -or $null -eq $ApprovedRecurringCostCapUsd -or
      [decimal]$ApprovedRecurringCostCapUsd -lt $recurring -or $exceptions.Count -ne 1 -or
      [bool](Get-RecordValue $CapacityEvidence 'zeroCostFeasible')) {
    return $blockedResult
  }
  $artifact = $exceptions[0]
  $exception = Get-RecordValue $artifact 'approvedException'
  try {
    [decimal]$evidenceEstimate = Get-RecordValue $exception 'estimatedMonthlyCostUsd'
    [decimal]$evidenceCap = Get-RecordValue $exception 'approvedMonthlyCapUsd'
  } catch { return $blockedResult }
  if ([string](Get-RecordValue $artifact 'metric') -ne 'artifactRegistryBytes' -or
      [string](Get-RecordValue $artifact 'policy') -ne 'hard_limit' -or
      [string](Get-RecordValue $artifact 'zeroCostStatus') -ne 'blocked' -or
      [string](Get-RecordValue $exception 'kind') -ne 'artifact_registry_recurring_cost_cap' -or
      [string](Get-RecordValue $exception 'pricingSourceSha256') -notmatch '^[a-f0-9]{64}$' -or
      $evidenceEstimate -ne $recurring -or
      $evidenceCap -ne [decimal]$ApprovedRecurringCostCapUsd) {
    return $blockedResult
  }

  [ordered]@{ status = 'passed'; zeroCostFeasible = $false
    reason = 'APPROVED_ARTIFACT_REGISTRY_RECURRING_COST' }
}

function Measure-ArtifactRepositoryBytes {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Repositories,
    [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ExpectedProjectId
  )

  [decimal]$total = 0
  $seen = @{}
  foreach ($repository in $Repositories) {
    $name = [string](Get-RecordValue $repository 'name')
    $match = [regex]::Match($name,
      '^projects/(?<project>[^/]+)/locations/(?<location>[^/]+)/repositories/(?<repository>[^/]+)$')
    if (-not $match.Success -or $match.Groups['project'].Value -ne $ExpectedProjectId) {
      throw 'Artifact Registry repository identity is invalid'
    }
    if ($seen.ContainsKey($name)) { throw 'Artifact Registry repository inventory contains a duplicate' }
    $seen[$name] = $true
    [long]$size = 0
    if (-not [long]::TryParse([string](Get-RecordValue $repository 'sizeBytes'), [ref]$size) -or
        $size -lt 0) {
      throw 'Artifact Registry repository sizeBytes must be a nonnegative int64'
    }
    $total += [decimal]$size
    if ($total -gt [long]::MaxValue) { throw 'Artifact Registry repository size total overflowed int64' }
  }

  [ordered]@{ measuredBytes = [long]$total; repositoryCount = $seen.Count }
}

function Convert-UpstashStatsObservation {
  [CmdletBinding()]
  param([Parameter(Mandatory)]$Stats)

  $values = @{}
  foreach ($name in 'current_storage','total_monthly_requests','total_monthly_bandwidth') {
    $raw = Get-RecordValue $Stats $name
    if ($null -eq $raw) { throw "Upstash stats field is missing: $name" }
    try { [double]$value = $raw } catch {
      throw "Upstash stats field must be finite nonnegative: $name"
    }
    if ($value -lt 0 -or [double]::IsNaN($value) -or [double]::IsInfinity($value)) {
      throw "Upstash stats field must be finite nonnegative: $name"
    }
    $values[$name] = $value
  }

  [pscustomobject][ordered]@{
    storageBytes = $values.current_storage
    commands = $values.total_monthly_requests
    bandwidthBytes = $values.total_monthly_bandwidth
  }
}

function Convert-GcloudStorageDuBytes {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string[]]$Lines,
    [Parameter(Mandatory)][string]$ExpectedBucket
  )

  $summaryLines = @($Lines | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($summaryLines.Count -ne 1) {
    throw 'GCS du must return exactly one summary line'
  }
  if ($summaryLines[0] -notmatch '^\s*(?<bytes>[0-9]+)\s+gs://(?<bucket>[^/\s]+)/?\s*$') {
    throw 'GCS du summary format is invalid'
  }
  if ($Matches.bucket -ne $ExpectedBucket) {
    throw 'GCS du bucket identity mismatch'
  }

  [long]$bytes = 0
  if (-not [long]::TryParse($Matches.bytes, [ref]$bytes)) {
    throw 'GCS du byte count is invalid'
  }
  return $bytes
}

function Convert-GcsObjectRecord {
  [CmdletBinding()]
  param([Parameter(Mandatory)]$Record)

  $bucket = [string](Get-RecordValue $Record 'bucket')
  $name = [string](Get-RecordValue $Record 'name')
  $generation = [string](Get-RecordValue $Record 'generation')
  $sizeValue = Get-RecordValue $Record 'size'
  $crc32c = [string](Get-RecordValue $Record 'crc32c')
  $storageClass = [string](Get-RecordValue $Record 'storageClass')
  $updatedValue = Get-RecordValue $Record 'updated'
  if ($bucket.StartsWith('gs://', [StringComparison]::OrdinalIgnoreCase)) {
    $bucket = $bucket.Substring(5).TrimEnd('/')
  }
  if (-not $bucket -or -not $name) { throw 'GCS object bucket and name are required' }
  if ($generation -notmatch '^[0-9]+$') { throw 'GCS object generation must be a decimal string' }
  try { [long]$size = $sizeValue } catch { throw 'GCS object size must be an integer' }
  if ($size -lt 0) { throw 'GCS object size must be nonnegative' }
  if (-not $crc32c) { throw 'GCS object CRC32C is required' }
  if (-not $storageClass) { throw 'GCS object storage class is required' }
  try { $updated = [datetimeoffset]::Parse([string]$updatedValue).ToUniversalTime() } catch {
    throw 'GCS object updated timestamp is invalid'
  }
  $deleted = Get-RecordValue $Record 'timeDeleted'
  if (-not $deleted) { $deleted = Get-RecordValue $Record 'softDeleteTime' }
  if (-not $deleted) { $deleted = Get-RecordValue $Record 'deleted' }
  [ordered]@{
    bucket = $bucket
    name = $name
    generation = $generation
    size = $size
    crc32c = $crc32c
    md5Hash = if (Get-RecordValue $Record 'md5Hash') { [string](Get-RecordValue $Record 'md5Hash') } else { $null }
    storageClass = $storageClass
    updated = $updated.ToString('o')
    live = -not [bool]$deleted
  }
}

function Get-MigrationCostEstimate {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][long]$LiveBytes,
    [Parameter(Mandatory)][long]$ArchiveBytes,
    [Parameter(Mandatory)][long]$ClassAOperations,
    [Parameter(Mandatory)][long]$ClassBOperations,
    [AllowNull()]$Rates,
    [AllowNull()][string]$SourceSnapshotSha256
  )
  if (@($LiveBytes,$ArchiveBytes,$ClassAOperations,$ClassBOperations | Where-Object { $_ -lt 0 }).Count) {
    throw 'Migration quantities must be nonnegative'
  }
  $required = 'transferPerGiB','classAPer1000','classBPer1000','archivePerGiBMonth'
  $known = $null -ne $Rates -and $SourceSnapshotSha256 -match '^[a-f0-9]{64}$'
  $values = @{}
  if ($known) {
    foreach ($name in $required) {
      $value = Get-RecordValue $Rates $name
      try { $values[$name] = [decimal]$value } catch { $known = $false; break }
      if ($values[$name] -lt 0) { $known = $false; break }
    }
  }
  $cost = $null
  if ($known) {
    [decimal]$gib = 1073741824
    $raw = ([decimal]$LiveBytes / $gib * $values.transferPerGiB) +
      ([decimal]$ClassAOperations / 1000 * $values.classAPer1000) +
      ([decimal]$ClassBOperations / 1000 * $values.classBPer1000) +
      ([decimal]$ArchiveBytes / $gib * $values.archivePerGiBMonth)
    $cost = [Math]::Ceiling($raw * 100) / 100
  }
  [ordered]@{
    ratesKnown = $known
    sourceSnapshotSha256 = if ($known) { $SourceSnapshotSha256 } else { $null }
    migrationCostUsd = $cost
    requiresApproval = -not $known -or $cost -gt 0
  }
}

function New-PreflightDecision {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][object[]]$Checks,
    [Parameter(Mandatory)][AllowNull()]$MigrationCostUsd,
    [Parameter(Mandatory)][bool]$NonZeroCostApproved,
    [AllowNull()]$ApprovedMigrationCostUsd,
    [Parameter(Mandatory)][AllowNull()]$RecurringCostUsd,
    [Parameter(Mandatory)][bool]$RecurringCostApproved,
    [AllowNull()]$ApprovedRecurringCostCapUsd
  )
  $mandatory = @('pricing','capacity','images','neon-region','embeddings',
    'database-restore','storage-inventory','legacy-transition')
  $byName = @{}
  foreach ($check in $Checks) { $byName[[string](Get-RecordValue $check 'name')] = $check }
  $checksPass = @($mandatory | Where-Object {
      -not $byName.ContainsKey($_) -or [string](Get-RecordValue $byName[$_] 'status') -ne 'passed'
    }).Count -eq 0
  $costKnown = $null -ne $MigrationCostUsd
  $cost = if ($costKnown) { [decimal]$MigrationCostUsd } else { $null }
  $costPass = $costKnown -and $cost -ge 0 -and (
    $cost -eq 0 -or ($NonZeroCostApproved -and $null -ne $ApprovedMigrationCostUsd -and
      [decimal]$ApprovedMigrationCostUsd -eq $cost))
  $recurringKnown = $null -ne $RecurringCostUsd
  $recurring = if ($recurringKnown) { [decimal]$RecurringCostUsd } else { $null }
  $recurringPass = $recurringKnown -and $recurring -ge 0 -and (
    $recurring -eq 0 -or ($RecurringCostApproved -and
      $null -ne $ApprovedRecurringCostCapUsd -and
      [decimal]$ApprovedRecurringCostCapUsd -ge $recurring))
  [ordered]@{
    decision = if ($checksPass -and $costPass -and $recurringPass) { 'GO' } else { 'NO_GO' }
    migrationCostUsd = $cost
    nonZeroCostApproved = [bool]($costKnown -and $cost -gt 0 -and $costPass)
    recurringCostUsd = $recurring
    recurringCostApproved = [bool]($recurringKnown -and $recurring -gt 0 -and $recurringPass)
    approvedRecurringCostCapUsd = if ($recurringKnown -and $recurring -gt 0 -and $recurringPass) {
      [decimal]$ApprovedRecurringCostCapUsd
    } else {
      $null
    }
    zeroCostFeasible = [bool]($recurringKnown -and $recurring -eq 0)
  }
}

function Assert-PreflightChildExitCode {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][int]$ExitCode,
    [Parameter(Mandatory)][string]$ScriptName
  )
  if ($ExitCode -notin @(0, 2)) {
    throw "Preflight child configuration error: $ScriptName exited with code $ExitCode"
  }
}

Export-ModuleMember -Function Test-CapacityMetric, New-CapacityRecord, Measure-GcsOperationClasses,
  Convert-CloudflareCpuMicrosecondsToMilliseconds, Convert-UpstashStatsObservation,
  Measure-ArtifactRepositoryBytes, Convert-GcloudStorageDuBytes,
  Select-NeonRegion,
  Measure-RetainedImageBytes, Get-ArtifactRegistryMonthlyCostEstimate,
  Get-PreflightCapacityProjection, Test-PreflightCapacityAcceptance, Get-Percentile,
  Convert-GcsObjectRecord, Get-MigrationCostEstimate,
  New-PreflightDecision, Assert-PreflightChildExitCode
